"""Health and capability introspection."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends

from jarvis.api.deps import Services, services

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe. Matches the convention the other lab apps use."""
    return {"status": "ok"}


@router.get("/api/capabilities")
async def capabilities(svc: Services = Depends(services)) -> dict[str, Any]:
    """Describe what this Jarvis can do and how it is wired.

    The dashboard uses this to show which capabilities are live versus faked, and
    to render the tool list grouped by namespace.
    """
    return {
        "model": svc.settings.model,
        "gateway": bool(svc.settings.llm_gateway_url),
        "llm_ready": svc.llm_ready,
        "fake_tools": svc.settings.fake_tools,
        "durable": bool(svc.settings.database_url),
        "policy": {
            "read": "auto",
            "write": "confirm" if svc.policy.confirm_writes else "auto (pull request)",
            "destructive": "blocked" if svc.policy.block_destructive else "confirm",
        },
        "capabilities": {
            namespace: [{"name": spec.name, "risk": spec.risk.value, "description": spec.description} for spec in specs]
            for namespace, specs in svc.registry.by_namespace().items()
        },
    }


@router.get("/api/models")
async def models(svc: Services = Depends(services)) -> dict[str, Any]:
    """The models the chat can pick from, and whether the local ones are up.

    A local model shown as unavailable still works when picked: the run is
    answered by ``fallback`` instead.
    """
    return {
        "default": svc.models.default,
        "fallback": svc.settings.local_fallback_model,
        "models": [asdict(m) for m in await svc.models.entries()],
    }
