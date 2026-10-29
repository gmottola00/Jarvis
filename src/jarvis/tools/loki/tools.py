"""Loki tools.

``search`` builds the LogQL itself, so the common case — "show me the errors in
tickup over the last hour" — cannot fail on syntax. ``query`` takes raw LogQL for
everything else. Both return lines oldest first, prefixed with time and pod,
each line cut at a readable length.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from jarvis.core.types import RiskLevel
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.loki.client import LogLine, LokiClient
from jarvis.tools.loki.fake import FakeLokiClient
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[Any] = ClientProvider(
    name="loki",
    real=lambda s: LokiClient(s),
    fake=FakeLokiClient,
    requires=lambda s: [] if s.loki_url else ["JARVIS_LOKI_URL"],
)

MAX_LINES = 500
MAX_MINUTES = 7 * 24 * 60
LINE_WIDTH = 300

_NAME = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")


def _quote(text: str) -> str:
    """A LogQL double-quoted string literal."""
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _render(lines: list[LogLine], *, empty: str) -> str:
    if not lines:
        return empty
    out = [f"{len(lines)} line(s), oldest first:"]
    for at, labels, raw in lines:
        line = raw.rstrip()
        text = line if len(line) <= LINE_WIDTH else line[:LINE_WIDTH] + " …"
        out.append(f"{at:%m-%d %H:%M:%S} {labels.get('pod', '?')} | {text}")
    return "\n".join(out)


async def _run(logql: str, minutes: int, limit: int) -> list[LogLine]:
    minutes = max(1, min(minutes, MAX_MINUTES))
    end = datetime.now(timezone.utc)
    result: list[LogLine] = await provider.get().query_range(
        logql, start=end - timedelta(minutes=minutes), end=end, limit=max(1, min(limit, MAX_LINES))
    )
    return result


@tool(namespace="loki", risk=RiskLevel.READ)
async def search(
    namespace: str, contains: str | None = None, pod: str | None = None, minutes: int = 60, limit: int = 100
) -> str:
    """Search stored logs for a namespace, including pods that no longer exist.

    Use this for past windows, crashes and restarts. For the live tail of a pod
    that is running now, k8s__get_logs is enough.

    Args:
        namespace: The namespace, e.g. "tickup".
        contains: Only lines containing this text, case-sensitive, e.g. "ERROR".
        pod: Pod name or prefix, e.g. "tickup-backend".
        minutes: Length of the window ending now. At most one week.
        limit: Maximum lines, newest kept. At most 500.
    """
    if not _NAME.match(namespace):
        raise ValueError(f"namespace {namespace!r} is not a valid Kubernetes name")
    selector = f'namespace="{namespace}"'
    if pod:
        if not _NAME.match(pod):
            raise ValueError(f"pod {pod!r} is not a valid Kubernetes name")
        selector += f', pod=~"{pod}.*"'
    logql = "{" + selector + "}"
    if contains:
        logql += f" |= {_quote(contains)}"
    lines = await _run(logql, minutes, limit)
    return _render(lines, empty=f"No lines matched {logql} in the last {minutes} minute(s).")


@tool(namespace="loki", risk=RiskLevel.READ)
async def query(logql: str, minutes: int = 60, limit: int = 100) -> str:
    """Run a raw LogQL log query. Prefer search unless you need a parser or regex filter.

    Stream labels are namespace, pod, container, node and app.

    Args:
        logql: A log query, e.g. '{app="tickup", container="backend"} |~ "(?i)timeout"'.
        minutes: Length of the window ending now. At most one week.
        limit: Maximum lines, newest kept. At most 500.
    """
    lines = await _run(logql, minutes, limit)
    return _render(lines, empty=f"No lines matched in the last {minutes} minute(s).")


TOOLS: list[ToolSpec] = [search, query]

__all__ = ["TOOLS", "provider"]
