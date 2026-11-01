"""Wiring.

Everything long-lived is built once in the app lifespan and hung off
``app.state.services``. Routers reach it through :func:`services`, so no module
holds a global and tests can build a ``Services`` by hand.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from quaerium.agents import AuditLog, PolicyGate, ToolRegistry

from jarvis.agent.models import ModelCatalog
from jarvis.notify import Notifier
from jarvis.settings import Settings


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
    notifier: Notifier
    """notify-hub, or a no-op when notifications are not configured."""

    @property
    def durable(self) -> bool:
        """Whether suspended runs survive a restart: only with Postgres."""
        return bool(self.settings.database_url)


def services(request: Request) -> Services:
    """FastAPI dependency returning the wired services."""
    return request.app.state.services  # type: ignore[no-any-return]


__all__ = ["Services", "services"]
