"""Prometheus HTTP API client.

kube-prometheus-stack runs in ``monitoring`` and scrapes the kubelet, cAdvisor and
kube-state-metrics, which is everything Jarvis needs to answer "how full", "how
fast" and "how often". Results are returned in Prometheus's own shapes — a list of
``{"metric": {...}, "value": [ts, "v"]}`` or ``{"metric": {...}, "values": [...]}``
— and the tools turn them into something a model can read.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)


class PrometheusClient:
    """Async client for the Prometheus query API.

    Args:
        settings: Supplies ``prometheus_url``, e.g.
            ``http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090``.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.prometheus_url:
            raise UpstreamError("prometheus", "base URL is required")
        self._client = httpx.AsyncClient(base_url=settings.prometheus_url.rstrip("/"), timeout=httpx.Timeout(20.0))

    async def _get(self, path: str, **params: Any) -> Any:
        try:
            response = await self._client.get(path, params={k: v for k, v in params.items() if v is not None})
        except httpx.HTTPError as exc:
            raise UpstreamError("prometheus", f"request to {path} failed: {exc}") from exc
        if response.status_code >= 400:
            # A bad PromQL expression comes back as 400 with the parser's message,
            # which is exactly what the model needs to fix its query.
            try:
                detail = response.json().get("error") or response.text[:300]
            except ValueError:
                detail = response.text[:300]
            raise UpstreamError("prometheus", str(detail), status=response.status_code)
        payload: dict[str, Any] = response.json()
        if payload.get("status") != "success":
            raise UpstreamError("prometheus", str(payload.get("error") or payload)[:300])
        return payload.get("data")

    async def query(self, promql: str, *, at: datetime | None = None) -> list[dict[str, Any]]:
        """Evaluate an instant query.

        Args:
            promql: The expression.
            at: Evaluation time. None means now.

        Returns:
            The vector's samples. A scalar result is wrapped as one label-less sample.
        """
        data = await self._get("/api/v1/query", query=promql, time=at.timestamp() if at else None)
        if data.get("resultType") in ("scalar", "string"):
            return [{"metric": {}, "value": data.get("result")}]
        result: list[dict[str, Any]] = data.get("result") or []
        return result

    async def query_range(self, promql: str, *, start: datetime, end: datetime, step: str) -> list[dict[str, Any]]:
        """Evaluate a range query.

        Args:
            promql: The expression.
            start: Window start.
            end: Window end.
            step: Resolution, as a Prometheus duration such as ``"1m"``.
        """
        data = await self._get(
            "/api/v1/query_range", query=promql, start=start.timestamp(), end=end.timestamp(), step=step
        )
        result: list[dict[str, Any]] = data.get("result") or []
        return result

    async def targets_down(self) -> list[dict[str, Any]]:
        """Return the active scrape targets whose last scrape failed."""
        data = await self._get("/api/v1/targets", state="active")
        return [t for t in data.get("activeTargets") or [] if t.get("health") != "up"]

    async def aclose(self) -> None:
        await self._client.aclose()


__all__ = ["PrometheusClient"]
