"""Alertmanager tools."""

from __future__ import annotations

from typing import Any

from quaerium.agents import ClientProvider, RiskLevel, ToolSpec, tool

from jarvis.core.console import AlertView
from jarvis.settings import Settings, get_settings
from jarvis.tools.alertmanager.client import AlertmanagerClient
from jarvis.tools.alertmanager.fake import FakeAlertmanagerClient
from jarvis.tools.fakes import FAKE_HINT, use_fake

provider: ClientProvider[Settings, Any] = ClientProvider(
    name="alertmanager",
    settings=get_settings,
    real=lambda s: AlertmanagerClient(s),
    fake=FakeAlertmanagerClient,
    use_fake=use_fake,
    requires=lambda s: [] if s.alertmanager_url else ["JARVIS_ALERTMANAGER_URL"],
    hint=FAKE_HINT,
)


def _since(seconds: float) -> str:
    if seconds < 3600:
        return f"{seconds / 60:.0f}m"
    if seconds < 86_400:
        return f"{seconds / 3600:.0f}h"
    return f"{seconds / 86_400:.0f}d"


def _line(alert: AlertView) -> str:
    where = "/".join(part for part in (alert.namespace, alert.target) if part) or "cluster-wide"
    head = f"[{alert.severity or '?'}] {alert.name} on {where}, firing {_since(alert.age)}"
    if alert.state != "active":
        head += f" ({alert.state})"
    body = alert.description or alert.summary
    return f"{head}\n    {body}" if body else head


@tool(namespace="alertmanager", risk=RiskLevel.READ)
async def list_alerts(namespace: str | None = None, include_silenced: bool = False) -> str:
    """List the alerts firing now, most severe first. The heartbeat alert (Watchdog) is left out.

    Args:
        namespace: Only alerts about this namespace, e.g. "tickup". Omit for all.
        include_silenced: Also list alerts that are silenced or inhibited.
    """
    alerts = await provider.get().alerts(include_suppressed=include_silenced)
    if namespace:
        alerts = [a for a in alerts if a.namespace == namespace]
    if not alerts:
        return f"No alerts firing{f' in {namespace}' if namespace else ''}."
    return f"{len(alerts)} alert(s) firing:\n" + "\n".join(_line(a) for a in alerts)


TOOLS: list[ToolSpec] = [list_alerts]

__all__ = ["TOOLS", "provider"]
