"""Health and capability introspection."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from types import ModuleType
from typing import Any

from fastapi import APIRouter, Depends

from jarvis.api.deps import Services, services
from jarvis.tools import CAPABILITIES

router = APIRouter(tags=["health"])

USAGE_DAYS = 7
"""How far back ``/api/capabilities`` counts tool calls."""


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe. Matches the convention the other lab apps use."""
    return {"status": "ok"}


@router.get("/api/capabilities")
async def capabilities(svc: Services = Depends(services)) -> dict[str, Any]:
    """Describe what this Jarvis can do and how it is wired.

    The dashboard uses this to show which capabilities are live versus faked, and
    to render the tool list grouped by namespace. ``sources`` says where each
    capability's answers come from (``live``, ``fixtures``, or ``missing`` with the
    settings it needs); ``usage`` counts the calls in the audit log over the last
    ``usage_days``, keyed by tool name, and leaves out tools never called.
    """
    return {
        "model": svc.settings.model,
        "gateway": bool(svc.settings.llm_gateway_url),
        "llm_ready": svc.llm_ready,
        "fake_tools": svc.settings.fake_tools,
        "durable": bool(svc.settings.database_url),
        "notify": svc.notifier.available,
        "policy": {
            "read": "auto",
            "write": "confirm" if svc.policy.confirm_writes else "auto (pull request)",
            "destructive": "blocked" if svc.policy.block_destructive else "confirm",
        },
        "capabilities": {
            namespace: [
                {
                    "name": spec.name,
                    "risk": spec.risk.value,
                    "description": spec.description,
                    "input_schema": spec.input_schema,
                }
                for spec in specs
            ]
            for namespace, specs in svc.registry.by_namespace().items()
        },
        "sources": {module.provider.name: _source(svc, module) for module in CAPABILITIES},
        "usage": svc.audit.tool_usage(since=datetime.now(timezone.utc) - timedelta(days=USAGE_DAYS)),
        "usage_days": USAGE_DAYS,
    }


def _source(svc: Services, module: ModuleType) -> dict[str, Any]:
    """Where one capability's answers come from, and what it is for (its module docstring, after the dash)."""
    about = (module.__doc__ or "").strip().splitlines()[0].split(" — ", 1)[-1].rstrip(".")
    missing = [] if svc.settings.fake_tools else module.provider.missing()
    mode = "fixtures" if svc.settings.fake_tools else "missing" if missing else "live"
    return {"mode": mode, "missing": missing, "about": about}


@router.get("/api/models")
async def models(svc: Services = Depends(services)) -> dict[str, Any]:
    """The models the chat can pick from, whether the local ones are up, and the budget.

    Picking a local model shown as unavailable needs the user's consent: the
    chat answers ``model_unavailable`` until it is resent with ``allow_fallback``,
    and only then does ``fallback`` answer. ``budget`` is Jarvis's own gateway
    key, null without a gateway. ``gpu`` is the last probe of Ollama, null when
    there is no ``JARVIS_OLLAMA_URL`` to probe.
    """
    budget = await svc.models.budget()
    gpu = await svc.models.gpu()
    return {
        "default": svc.models.default,
        "fallback": svc.settings.local_fallback_model,
        "gateway": bool(svc.settings.llm_gateway_url),
        "models": [asdict(m) for m in await svc.models.entries()],
        "budget": asdict(budget) if budget else None,
        "gpu": asdict(gpu) if gpu else None,
    }
