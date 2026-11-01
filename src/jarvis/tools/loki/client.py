"""Loki HTTP API client.

Alloy ships every container's stdout to Loki with five stream labels —
``namespace``, ``pod``, ``container``, ``node`` and ``app`` — and Loki keeps it for
30 days. That is what the Kubernetes API cannot give: the log of a pod that has
already been replaced, or of a window that ended an hour ago.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import httpx
from quaerium.agents import get_logger

from jarvis.exceptions import UpstreamError
from jarvis.settings import Settings

logger = get_logger(__name__)

LogLine = tuple[datetime, dict[str, str], str]
"""One entry: timestamp, the stream's labels, the line."""


class LokiClient:
    """Async client for the Loki query API.

    Args:
        settings: Supplies ``loki_url``, e.g. ``http://loki.monitoring.svc.cluster.local:3100``.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.loki_url:
            raise UpstreamError("loki", "base URL is required")
        self._client = httpx.AsyncClient(base_url=settings.loki_url.rstrip("/"), timeout=httpx.Timeout(30.0))

    async def _get(self, path: str, **params: Any) -> Any:
        try:
            response = await self._client.get(path, params={k: v for k, v in params.items() if v is not None})
        except httpx.HTTPError as exc:
            raise UpstreamError("loki", f"request to {path} failed: {exc}") from exc
        if response.status_code >= 400:
            # A malformed LogQL query comes back as 400 with a plain-text parse error.
            raise UpstreamError("loki", response.text[:300].strip(), status=response.status_code)
        payload: dict[str, Any] = response.json()
        return payload.get("data") or {}

    async def query_range(
        self,
        logql: str,
        *,
        start: datetime,
        end: datetime,
        limit: int = 100,
        direction: Literal["forward", "backward"] = "backward",
    ) -> list[LogLine]:
        """Return log lines matching a LogQL selector, oldest first.

        Args:
            logql: A log query, e.g. ``{namespace="tickup"} |= "error"``.
            start: Window start.
            end: Window end.
            limit: Maximum lines Loki returns.
            direction: ``backward`` keeps the newest ``limit`` lines, ``forward`` the oldest.
        """
        data = await self._get(
            "/loki/api/v1/query_range",
            query=logql,
            start=int(start.timestamp() * 1e9),
            end=int(end.timestamp() * 1e9),
            limit=limit,
            direction=direction,
        )
        if data.get("resultType") != "streams":
            raise UpstreamError("loki", "expected a log query; metric queries belong in prometheus__query")
        lines: list[LogLine] = []
        for stream in data.get("result") or []:
            labels = stream.get("stream") or {}
            for ts, line in stream.get("values") or []:
                lines.append((datetime.fromtimestamp(int(ts) / 1e9).astimezone(), labels, line))
        lines.sort(key=lambda entry: entry[0])
        return lines

    async def aclose(self) -> None:
        await self._client.aclose()


__all__ = ["LogLine", "LokiClient"]
