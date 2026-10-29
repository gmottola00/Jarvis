"""Offline stand-in for Prometheus.

Tells the same story as the Kubernetes fixtures: ``tickup-backend`` sits just under
its 512Mi limit with two OOM restarts in the last day, and its memory climbs
steadily across any range query — a leak, not a spike. ``tickup-web`` never
started, so it has no usage samples at all.

A fake cannot evaluate PromQL. It recognises the metric names the tools use and
honours ``namespace="..."`` and ``pod=~"..."`` matchers, which is enough for every
query the tools build themselves. Anything else returns an empty vector, the
same answer a real Prometheus gives for a metric it has never seen.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_MI = 1024 * 1024

_PODS: dict[str, tuple[str, dict[str, float]]] = {
    "trip-ai-backend-7d9c8f5b4-2xk9p": (
        "trip-ai",
        {"cpu": 0.042, "memory": 188 * _MI, "limit": 512 * _MI, "restarts": 0},
    ),
    "trip-ai-web-6b8d7c9f5-lm4rt": (
        "trip-ai",
        {"cpu": 0.001, "memory": 9 * _MI, "limit": 128 * _MI, "restarts": 0},
    ),
    "tickup-backend-5f7c8d9b6-qw3rt": (
        "tickup",
        {"cpu": 0.310, "memory": 498 * _MI, "limit": 512 * _MI, "restarts": 2},
    ),
}

_METRICS = {
    "container_cpu_usage_seconds_total": "cpu",
    "container_memory_working_set_bytes": "memory",
    "kube_pod_container_resource_limits": "limit",
    "kube_pod_container_status_restarts_total": "restarts",
}

_NAMESPACE = re.compile(r'namespace="([^"]*)"')
_POD = re.compile(r'pod=~"([^"]*)"')


def _samples(promql: str) -> list[tuple[dict[str, str], float]]:
    field = next((f for metric, f in _METRICS.items() if metric in promql), None)
    if field is None:
        return []
    namespace = _NAMESPACE.search(promql)
    pod = _POD.search(promql)
    out = []
    for name, (ns, values) in _PODS.items():
        if namespace and namespace.group(1) != ns:
            continue
        if pod and not re.fullmatch(pod.group(1), name):
            continue
        out.append(({"namespace": ns, "pod": name}, values[field]))
    return out


class FakePrometheusClient:
    """Serves the fixtures above."""

    async def query(self, promql: str, *, at: datetime | None = None) -> list[dict[str, Any]]:
        ts = (at or datetime.now()).timestamp()
        return [{"metric": labels, "value": [ts, str(value)]} for labels, value in _samples(promql)]

    async def query_range(self, promql: str, *, start: datetime, end: datetime, step: str) -> list[dict[str, Any]]:
        points = 30
        t0, t1 = start.timestamp(), end.timestamp()
        series = []
        for labels, value in _samples(promql):
            # tickup-backend leaks: it climbs from 60% to its current value. Everything
            # else is flat, so a trend in the summary means something.
            leaking = labels["pod"].startswith("tickup-backend") and value > 1
            values = []
            for i in range(points):
                v = value * (0.6 + 0.4 * i / (points - 1)) if leaking else value
                values.append([t0 + (t1 - t0) * i / (points - 1), str(v)])
            series.append({"metric": labels, "values": values})
        return series

    async def targets_down(self) -> list[dict[str, Any]]:
        return []

    async def aclose(self) -> None:
        return None


__all__ = ["FakePrometheusClient"]
