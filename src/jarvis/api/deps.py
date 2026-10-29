"""Wiring.

Everything long-lived is built once in the app lifespan and hung off
``app.state.services``. Routers reach it through :func:`services`, so no module
holds a global and tests can build a ``Services`` by hand.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request

from jarvis.agent.models import ModelCatalog
from jarvis.core.policy import PolicyGate
from jarvis.observability.audit import AuditLog
from jarvis.settings import Settings
from jarvis.tools.registry import ToolRegistry


@dataclass
class Services:
    """Everything the routers need."""

    settings: Settings
    registry: ToolRegistry
    policy: PolicyGate
    runner: Any
    sessions: Any
    audit: AuditLog
    llm_ready: bool
    """False when no API key is configured: the dashboard works, chat explains why."""

    models: ModelCatalog


def services(request: Request) -> Services:
    """FastAPI dependency returning the wired services."""
    return request.app.state.services  # type: ignore[no-any-return]


__all__ = ["Services", "services"]
