"""Lab overview: the dashboard's right-hand column.

Reads the capability clients directly rather than going through the tools. Tools
return prose shaped for a model; widgets want structured data, and rendering text
just to parse it back would be silly.

Every capability is fetched concurrently and its failure is captured rather than
raised: one unreachable upstream degrades one card, it does not blank the page.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, TypeVar

from fastapi import APIRouter, Depends

from jarvis.api.deps import Services, services
from jarvis.core.types import LabOverview
from jarvis.logging import get_logger
from jarvis.tools import argocd, k8s

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["lab"])

T = TypeVar("T")


async def _attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    """Run one capability fetch, recording the failure instead of propagating it."""
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a card, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("lab.capability_failed", capability=name, error=str(exc))
        return None


@router.get("/lab/overview", response_model=LabOverview)
async def overview(svc: Services = Depends(services)) -> LabOverview:
    """Cluster nodes, ArgoCD applications and anything unhealthy, in one call."""
    errors: dict[str, str] = {}

    nodes, apps, pods = await asyncio.gather(
        _attempt("k8s.nodes", lambda: k8s.provider.get().list_nodes(), errors),
        _attempt("argocd.apps", lambda: argocd.provider.get().list_apps(), errors),
        _attempt("k8s.pods", lambda: k8s.provider.get().unhealthy_pods(), errors),
    )

    result = LabOverview(
        nodes=nodes or [],
        apps=apps or [],
        unhealthy_pods=pods or [],
        errors=errors,
    )
    result.degraded = bool(
        errors
        or result.unhealthy_pods
        or any(not n.ready for n in result.nodes)
        or any(a.health != "Healthy" or a.sync != "Synced" for a in result.apps)
    )
    return result
