"""Alerts: what is firing, and the button that hands one to the agent.

``GET /api/alerts`` is console-style — capability clients called directly, no
model, each failure captured per source. ``GET /api/alerts/{fingerprint}/brief``
is the bridge to the agent half: it renders the investigation playbook for one
alert, and the page sends it as the first message of a new chat. Nothing here
starts a run by itself; a person decides to.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, TypeVar

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from jarvis.agent.playbooks import investigate_alert
from jarvis.core.console import AlertsOverview, AlertView, TargetView
from jarvis.logging import get_logger
from jarvis.tools import alertmanager, prometheus

logger = get_logger(__name__)
router = APIRouter(prefix="/api/alerts", tags=["alerts"])

T = TypeVar("T")


class AlertBrief(BaseModel):
    fingerprint: str
    prompt: str


async def _attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    """Run one fetch, recording the failure instead of propagating it."""
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a card, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("alerts.fetch_failed", target=name, error=str(exc))
        return None


def _target(raw: dict[str, Any]) -> TargetView:
    return TargetView(
        job=(raw.get("labels") or {}).get("job", ""),
        url=raw.get("scrapeUrl", ""),
        health=raw.get("health", ""),
        last_error=raw.get("lastError", ""),
    )


@router.get("", response_model=AlertsOverview)
async def overview(include_silenced: bool = False) -> AlertsOverview:
    """Firing alerts from Alertmanager and failing scrape targets from Prometheus."""
    errors: dict[str, str] = {}
    alerts, targets = await asyncio.gather(
        _attempt(
            "alertmanager.alerts",
            lambda: alertmanager.provider.get().alerts(include_suppressed=include_silenced),
            errors,
        ),
        _attempt("prometheus.targets", lambda: prometheus.provider.get().targets_down(), errors),
    )
    return AlertsOverview(alerts=alerts or [], targets_down=[_target(t) for t in targets or []], errors=errors)


@router.get("/{fingerprint}/brief", response_model=AlertBrief)
async def brief(fingerprint: str) -> AlertBrief:
    """The investigation prompt for one alert, ready to send as a chat message."""
    try:
        alerts: list[AlertView] = await alertmanager.provider.get().alerts(include_suppressed=True)
    except Exception as exc:  # noqa: BLE001 - surface as a gateway error the page can show
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    for alert in alerts:
        if alert.fingerprint == fingerprint:
            return AlertBrief(fingerprint=fingerprint, prompt=investigate_alert(alert))
    raise HTTPException(status_code=404, detail=f"no firing alert with fingerprint {fingerprint}; it may have resolved")
