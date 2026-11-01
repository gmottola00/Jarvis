"""Prometheus tools.

Raw PromQL results are big and numeric, and a model reads neither well. Instant
queries come back as a capped table; range queries come back as one summary line
per series — min, max, average, last value and the change across the window —
never as the points themselves.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from quaerium.agents import ClientProvider, RiskLevel, ToolSpec, tool

from jarvis.settings import Settings, get_settings
from jarvis.tools.fakes import FAKE_HINT, use_fake
from jarvis.tools.prometheus.client import PrometheusClient
from jarvis.tools.prometheus.fake import FakePrometheusClient

provider: ClientProvider[Settings, Any] = ClientProvider(
    name="prometheus",
    settings=get_settings,
    real=lambda s: PrometheusClient(s),
    fake=FakePrometheusClient,
    use_fake=use_fake,
    requires=lambda s: [] if s.prometheus_url else ["JARVIS_PROMETHEUS_URL"],
    hint=FAKE_HINT,
)

MAX_SERIES = 50
"""Series shown per result. Past this a query is too broad to be read, not just long."""

MAX_MINUTES = 7 * 24 * 60
"""Longest range window, a week. Retention is 15 days; anything longer is a dashboard."""

_NAME = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")


def _table(rows: list[list[str]], headers: list[str]) -> str:
    """Render a fixed-width text table."""
    widths = [
        max(len(headers[i]), *(len(r[i]) for r in rows)) if rows else len(headers[i]) for i in range(len(headers))
    ]
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    out = [line, "  ".join("-" * w for w in widths)]
    out.extend("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in rows)
    return "\n".join(out)


def _labels(metric: dict[str, str]) -> str:
    """``{a="1", b="2"}``, without ``__name__`` — the query already says which metric."""
    pairs = [f'{k}="{v}"' for k, v in sorted(metric.items()) if k != "__name__"]
    return "{" + ", ".join(pairs) + "}"


def _number(value: float) -> str:
    """A compact rendering that keeps small rates and large byte counts readable."""
    if value != value:  # NaN
        return "NaN"
    for scale, suffix in ((1e12, "T"), (1e9, "G"), (1e6, "M")):
        if abs(value) >= scale:
            return f"{value / scale:.3g}{suffix}"
    if abs(value) >= 100 or value == int(value):
        return f"{value:.0f}"
    return f"{value:.3g}"


def _bytes(value: float) -> str:
    for unit in ("B", "Ki", "Mi", "Gi"):
        if abs(value) < 1024 or unit == "Gi":
            return f"{value:.0f}{unit}" if unit == "B" else f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}Gi"  # pragma: no cover - loop always returns


def _check_name(kind: str, value: str) -> None:
    """Refuse anything that is not a Kubernetes name, so it cannot break out of a matcher."""
    if not _NAME.match(value):
        raise ValueError(f"{kind} {value!r} is not a valid Kubernetes name")


@tool(namespace="prometheus", risk=RiskLevel.READ)
async def query(promql: str) -> str:
    """Run an instant PromQL query and return the current value of each series.

    Prefer pod_resources for CPU, memory and restarts of a workload; use this for
    anything else. Aggregate with sum by (...) to keep the result small.

    Args:
        promql: The PromQL expression, e.g. 'sum by (namespace) (kube_pod_info)'.
    """
    samples = await provider.get().query(promql)
    if not samples:
        return "No series matched. Check the metric name and label matchers."
    rows = [[_labels(s.get("metric", {})), _number(float(s["value"][1]))] for s in samples[:MAX_SERIES]]
    out = f"{len(samples)} series:\n" + _table(rows, ["SERIES", "VALUE"])
    if len(samples) > MAX_SERIES:
        out += f"\n... {len(samples) - MAX_SERIES} more not shown. Aggregate with sum by (...) to narrow it."
    return out


@tool(namespace="prometheus", risk=RiskLevel.READ)
async def query_range(promql: str, minutes: int = 60, step: str = "1m") -> str:
    """Run a PromQL query over a time window and summarise each series.

    Returns min, max, average, last value and the change from first to last per
    series — enough to tell a leak from a spike. Points are not returned.

    Args:
        promql: The PromQL expression.
        minutes: Length of the window ending now. At most one week.
        step: Resolution as a Prometheus duration, e.g. "30s", "1m", "5m".
    """
    minutes = max(1, min(minutes, MAX_MINUTES))
    end = datetime.now(timezone.utc)
    series = await provider.get().query_range(promql, start=end - timedelta(minutes=minutes), end=end, step=step)
    if not series:
        return f"No series matched in the last {minutes} minute(s)."
    rows = []
    for s in series[:MAX_SERIES]:
        values = [float(v) for _, v in s.get("values") or []]
        if not values:
            continue
        change = values[-1] - values[0]
        rows.append(
            [
                _labels(s.get("metric", {})),
                _number(min(values)),
                _number(max(values)),
                _number(sum(values) / len(values)),
                _number(values[-1]),
                ("+" if change > 0 else "") + _number(change),
            ]
        )
    out = f"{len(series)} series over the last {minutes} minute(s):\n" + _table(
        rows, ["SERIES", "MIN", "MAX", "AVG", "LAST", "CHANGE"]
    )
    if len(series) > MAX_SERIES:
        out += f"\n... {len(series) - MAX_SERIES} more not shown. Aggregate with sum by (...) to narrow it."
    return out


@tool(namespace="prometheus", risk=RiskLevel.READ)
async def pod_resources(namespace: str, pod: str | None = None) -> str:
    """Show CPU, memory against its limit, and restarts in the last 24h for each pod.

    The quickest answer to "is it out of memory", "is it busy" and "is it
    crash-looping". Numbers come from cAdvisor and kube-state-metrics.

    Args:
        namespace: The namespace, e.g. "tickup".
        pod: Pod name or prefix, e.g. "tickup-backend". Omit for every pod in the namespace.
    """
    _check_name("namespace", namespace)
    matchers = f'namespace="{namespace}"'
    if pod:
        _check_name("pod", pod)
        # No re.escape: a backslash is a PromQL string escape, and a name's only
        # regex character is ".", which matching loosely does no harm.
        matchers += f', pod=~"{pod}.*"'
    client = provider.get()
    cpu, memory, limit, restarts = await asyncio.gather(
        client.query(f'sum by (pod) (rate(container_cpu_usage_seconds_total{{{matchers}, container!=""}}[5m]))'),
        client.query(f'sum by (pod) (container_memory_working_set_bytes{{{matchers}, container!=""}})'),
        client.query(f'sum by (pod) (kube_pod_container_resource_limits{{{matchers}, resource="memory"}})'),
        client.query(f"sum by (pod) (increase(kube_pod_container_status_restarts_total{{{matchers}}}[24h]))"),
    )

    def by_pod(samples: list[dict[str, Any]]) -> dict[str, float]:
        return {s["metric"].get("pod", "?"): float(s["value"][1]) for s in samples}

    cpu_, memory_, limit_, restarts_ = by_pod(cpu), by_pod(memory), by_pod(limit), by_pod(restarts)
    pods = sorted(set(cpu_) | set(memory_) | set(restarts_))
    if not pods:
        return f"No usage samples for {pod or 'any pod'} in {namespace}. A pod that never started has none."

    rows = []
    for name in pods:
        mem, lim = memory_.get(name), limit_.get(name)
        share = f"{100 * mem / lim:.0f}%" if mem is not None and lim else "-"
        rows.append(
            [
                name,
                f"{cpu_[name]:.3f}" if name in cpu_ else "-",
                _bytes(mem) if mem is not None else "-",
                _bytes(lim) if lim else "none",
                share,
                f"{restarts_.get(name, 0):.0f}",
            ]
        )
    return f"{namespace}, {len(pods)} pod(s):\n" + _table(
        rows, ["POD", "CPU (cores)", "MEMORY", "LIMIT", "OF LIMIT", "RESTARTS 24h"]
    )


@tool(namespace="prometheus", risk=RiskLevel.READ)
async def targets_down() -> str:
    """List scrape targets whose last scrape failed — a dead exporter or an unreachable pod."""
    targets = await provider.get().targets_down()
    if not targets:
        return "Every active scrape target is up."
    rows = [
        [
            t.get("labels", {}).get("job", "?"),
            t.get("scrapeUrl", "?"),
            t.get("health", "?"),
            (t.get("lastError") or "")[:120],
        ]
        for t in targets
    ]
    return f"{len(targets)} target(s) down:\n" + _table(rows, ["JOB", "URL", "HEALTH", "LAST ERROR"])


TOOLS: list[ToolSpec] = [query, query_range, pod_resources, targets_down]

__all__ = ["TOOLS", "provider"]
