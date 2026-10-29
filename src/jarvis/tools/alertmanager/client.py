"""Alertmanager API client.

Alertmanager in kube-prometheus-stack is installed with no receivers, on purpose:
nothing pages anyone yet. Its API still holds every firing alert, deduplicated
and with silences applied, which makes it the right place to ask "what is wrong
right now" — better than evaluating rules against Prometheus by hand.

Read-only. Creating a silence would be state that lives outside Git, so there is
no call for it here.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

from jarvis.core.console import AlertView, age_seconds
from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

HEARTBEATS = frozenset({"Watchdog", "InfoInhibitor"})
"""Alerts that fire forever by design, to prove the pipeline works. Never news."""

_WORKLOAD_LABELS = (
    ("deployment", "Deployment"),
    ("statefulset", "StatefulSet"),
    ("daemonset", "DaemonSet"),
    ("job_name", "Job"),
    ("persistentvolumeclaim", "PersistentVolumeClaim"),
)


def _target(labels: dict[str, str]) -> str:
    """The resource an alert is about, as ``Kind/name``.

    kube-state-metrics alerts carry the exporter's own pod in ``pod`` and
    ``container="kube-state-metrics"``; that pod is never the subject.
    """
    for label, kind in _WORKLOAD_LABELS:
        if labels.get(label):
            return f"{kind}/{labels[label]}"
    if labels.get("pod") and labels.get("container") != "kube-state-metrics":
        return f"Pod/{labels['pod']}"
    if labels.get("node"):
        return f"Node/{labels['node']}"
    return ""


_EMPTY_CLUSTER = re.compile(r"\s+on cluster\s*\.\s*$")


def _clean_text(text: str) -> str:
    """Drop the ``on cluster .`` that kube-prometheus rules render on a single, unnamed cluster."""
    return _EMPTY_CLUSTER.sub(".", text.strip())


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def to_view(raw: dict[str, Any]) -> AlertView:
    """Turn one ``/api/v2/alerts`` entry into an :class:`AlertView`."""
    labels: dict[str, str] = raw.get("labels") or {}
    annotations: dict[str, str] = raw.get("annotations") or {}
    starts = _parse_time(raw.get("startsAt"))
    container = labels.get("container", "")
    state = (raw.get("status") or {}).get("state", "active")
    return AlertView(
        fingerprint=raw.get("fingerprint", ""),
        name=labels.get("alertname", "?"),
        severity=labels.get("severity", ""),
        state=state if state in ("active", "suppressed", "unprocessed") else "active",
        namespace=labels.get("namespace", ""),
        target=_target(labels),
        container="" if container == "kube-state-metrics" else container,
        summary=_clean_text(annotations.get("summary", "")),
        description=_clean_text(annotations.get("description") or annotations.get("message", "")),
        runbook_url=annotations.get("runbook_url", ""),
        starts_at=starts,
        age=age_seconds(starts),
        labels=labels,
    )


class AlertmanagerClient:
    """Async client for the Alertmanager v2 API.

    Args:
        settings: Supplies ``alertmanager_url``, e.g.
            ``http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093``.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.alertmanager_url:
            raise UpstreamError("alertmanager", "base URL is required")
        self._client = httpx.AsyncClient(base_url=settings.alertmanager_url.rstrip("/"), timeout=httpx.Timeout(15.0))

    async def alerts(self, *, include_suppressed: bool = False, include_heartbeats: bool = False) -> list[AlertView]:
        """Return the firing alerts, most severe and then oldest first.

        Args:
            include_suppressed: Also return silenced and inhibited alerts.
            include_heartbeats: Also return ``Watchdog`` and friends.
        """
        params = {
            "active": "true",
            "silenced": str(include_suppressed).lower(),
            "inhibited": str(include_suppressed).lower(),
        }
        try:
            response = await self._client.get("/api/v2/alerts", params=params)
        except httpx.HTTPError as exc:
            raise UpstreamError("alertmanager", f"request failed: {exc}") from exc
        if response.status_code >= 400:
            raise UpstreamError("alertmanager", response.text[:300], status=response.status_code)
        views = [to_view(raw) for raw in response.json() or []]
        if not include_heartbeats:
            views = [v for v in views if v.name not in HEARTBEATS]
        return sort_alerts(views)

    async def aclose(self) -> None:
        await self._client.aclose()


_SEVERITY_ORDER = {"critical": 0, "error": 1, "warning": 2, "info": 3}


def sort_alerts(alerts: list[AlertView]) -> list[AlertView]:
    """Most severe first; within a severity, the one that has been firing longest."""
    return sorted(alerts, key=lambda a: (_SEVERITY_ORDER.get(a.severity, 4), -a.age, a.name))


__all__ = ["HEARTBEATS", "AlertmanagerClient", "sort_alerts", "to_view"]
