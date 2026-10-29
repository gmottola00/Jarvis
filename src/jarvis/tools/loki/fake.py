"""Offline stand-in for Loki.

The lines continue the ``tickup`` story: the backend's cache grows on every
request until the kernel kills it, twice, and each restart begins with the same
startup banner. A ``trip-ai`` backend chatters normally alongside, so a search has
something to filter out.

Like the Prometheus fake it does not parse LogQL. It honours the ``namespace``,
``pod`` (``=`` or ``=~``) and ``container`` matchers and ``|=`` line filters —
the subset the tools build — and ignores the rest.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from jarvis.tools.loki.client import LogLine

_TICKUP = {"namespace": "tickup", "pod": "tickup-backend-5f7c8d9b6-qw3rt", "container": "backend", "app": "tickup"}
_TRIP = {"namespace": "trip-ai", "pod": "trip-ai-backend-7d9c8f5b4-2xk9p", "container": "backend", "app": "trip-ai"}

# (minutes ago, labels, line)
_LINES: list[tuple[int, dict[str, str], str]] = [
    (52, _TICKUP, "INFO:     Started server process [1]"),
    (52, _TICKUP, "INFO:     Application startup complete."),
    (40, _TICKUP, "WARNING  cache.leaderboard size=41210 entries, no eviction configured"),
    (31, _TICKUP, "WARNING  cache.leaderboard size=88754 entries, no eviction configured"),
    (30, _TRIP, 'INFO:     10.42.0.1:51234 - "GET /api/health HTTP/1.1" 200 OK'),
    (24, _TICKUP, "ERROR    worker memory high: rss=497Mi limit=512Mi"),
    (23, _TICKUP, "INFO:     Started server process [1]"),
    (23, _TICKUP, "INFO:     Application startup complete."),
    (15, _TRIP, 'INFO:     10.42.0.1:51310 - "POST /api/trips HTTP/1.1" 201 Created'),
    (9, _TICKUP, "WARNING  cache.leaderboard size=90311 entries, no eviction configured"),
    (2, _TICKUP, "ERROR    worker memory high: rss=498Mi limit=512Mi"),
]

_MATCHER = re.compile(r'(namespace|pod|container|app)\s*(=~|=)\s*"([^"]*)"')
_CONTAINS = re.compile(r'\|=\s*"((?:[^"\\]|\\.)*)"')


class FakeLokiClient:
    """Serves the fixtures above."""

    async def query_range(
        self,
        logql: str,
        *,
        start: datetime,
        end: datetime,
        limit: int = 100,
        direction: Literal["forward", "backward"] = "backward",
    ) -> list[LogLine]:
        matchers = _MATCHER.findall(logql)
        needles = [n.replace('\\"', '"').replace("\\\\", "\\") for n in _CONTAINS.findall(logql)]
        now = datetime.now(timezone.utc)
        out: list[LogLine] = []
        for minutes, labels, line in _LINES:
            at = now - timedelta(minutes=minutes)
            if not start <= at <= end:
                continue
            if any(
                not (re.fullmatch(value, labels.get(key, "")) if op == "=~" else labels.get(key) == value)
                for key, op, value in matchers
            ):
                continue
            if any(n not in line for n in needles):
                continue
            out.append((at, labels, line))
        return out[-limit:] if direction == "backward" else out[:limit]

    async def aclose(self) -> None:
        return None


__all__ = ["FakeLokiClient"]
