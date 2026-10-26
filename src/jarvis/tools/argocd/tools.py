"""ArgoCD tools."""

from __future__ import annotations

from typing import Any, Literal

from jarvis.core.types import RiskLevel
from jarvis.tools.argocd.client import ArgoCDClient
from jarvis.tools.argocd.fake import FakeArgoCDClient
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[Any] = ClientProvider(
    name="argocd",
    real=lambda s: ArgoCDClient(s),
    fake=FakeArgoCDClient,
    requires=lambda s: [
        name
        for name, value in (("JARVIS_ARGOCD_BASE_URL", s.argocd_base_url), ("JARVIS_ARGOCD_TOKEN", s.argocd_token))
        if not value
    ],
)


@tool(namespace="argocd", risk=RiskLevel.READ)
async def list_apps() -> str:
    """List every ArgoCD Application with its sync status, health and current revision."""
    apps = await provider.get().list_apps()
    if not apps:
        return "No applications registered."
    lines = [f"{len(apps)} application(s):"]
    for app in apps:
        flag = "" if app.sync == "Synced" and app.health == "Healthy" else "  <-- needs attention"
        lines.append(f"  {app.name}: {app.sync} / {app.health} @ {app.revision or '?'} ({app.path}){flag}")
    return "\n".join(lines)


@tool(namespace="argocd", risk=RiskLevel.READ)
async def app_health(name: str) -> str:
    """Report one Application's sync status, health and the Git revision it is running.

    Args:
        name: Application name, e.g. "tickup".
    """
    app = await provider.get().get_app(name)
    return (
        f"{app.name}\n"
        f"  sync:     {app.sync}\n"
        f"  health:   {app.health}\n"
        f"  revision: {app.revision or '(unknown)'}\n"
        f"  source:   {app.repo} @ {app.path}"
    )


@tool(namespace="argocd", risk=RiskLevel.READ)
async def app_diff(name: str) -> str:
    """Show which managed resources have drifted from Git for an Application.

    Args:
        name: Application name, e.g. "tickup".
    """
    items = await provider.get().managed_resources(name)
    drifted = [i for i in items if i.get("diff")]
    if not drifted:
        return f"{name}: no drift — live state matches Git."
    lines = [f"{name}: {len(drifted)} resource(s) differ from Git:"]
    for item in drifted:
        lines.append(f"  {item.get('kind')}/{item.get('name')} in {item.get('namespace')}:")
        lines.extend(f"    {line}" for line in str(item.get("diff", "")).splitlines())
    return "\n".join(lines)


@tool(namespace="argocd", risk=RiskLevel.DESTRUCTIVE)
async def hard_refresh(name: str, mode: Literal["normal", "hard"] = "hard") -> str:
    """Force ArgoCD to re-read Git for an Application.

    Destructive because an Application with automated sync will act on what it
    finds: a refresh can start a rollout.

    Args:
        name: Application name.
        mode: "normal" re-reads the cache, "hard" re-clones the repository.
    """
    app = await provider.get().get_app(name, refresh=mode)
    return f"{name}: refreshed ({mode}). Now {app.sync} / {app.health} @ {app.revision or '?'}"


TOOLS: list[ToolSpec] = [list_apps, app_health, app_diff, hard_refresh]

__all__ = ["TOOLS", "provider"]
