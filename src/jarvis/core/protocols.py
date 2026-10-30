"""Structural interfaces.

PEP 544 protocols, following Quaerium's house style: nothing has to inherit from
anything, a class just has to have the right shape. This is what lets the session
store swap between Redis and a dict, and the tool layer swap between a live client
and a fake, without a base class in sight.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from jarvis.core.types import RiskLevel, Turn


@runtime_checkable
class Tool(Protocol):
    """Anything the registry can hold and the model can call.

    Example:
        >>> class Clock:
        ...     name = "time.now"
        ...     description = "Current UTC time, ISO 8601."
        ...     input_schema = {"type": "object", "properties": {}, "required": []}
        ...     risk = RiskLevel.READ
        ...     async def run(self, **kwargs: object) -> str:
        ...         from datetime import datetime, timezone
        ...         return datetime.now(timezone.utc).isoformat()
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    risk: RiskLevel

    async def run(self, **kwargs: Any) -> str:
        """Execute and return text for the model. Must not raise for expected failures."""
        ...


@runtime_checkable
class SessionStore(Protocol):
    """Recent conversation turns, keyed by session."""

    async def append(self, session_id: str, turn: Turn) -> None: ...

    async def history(self, session_id: str, *, limit: int = 20) -> list[Turn]: ...

    async def clear(self, session_id: str) -> None: ...


@runtime_checkable
class EventSink(Protocol):
    """Where a run's events go while it is in flight."""

    def emit(self, event: Any) -> None:
        """Publish one ``RunEvent``. Never raises — a broken sink must not break a run."""
        ...


@runtime_checkable
class AuditLog(Protocol):
    """Durable record of what Jarvis did and why."""

    async def start_run(self, run_id: str, session_id: str, prompt: str, model: str = "") -> None: ...

    async def record_tool_call(self, run_id: str, call: Any, result: Any) -> None: ...

    async def record_approval(self, run_id: str, approval: Any) -> None: ...

    def suspend_run(self, run_id: str, tool: str, args: dict[str, Any], why: str) -> None: ...

    async def finish_run(self, run_id: str, answer: str, usage: Any, served_by: str = "") -> None: ...


__all__ = ["AuditLog", "EventSink", "SessionStore", "Tool"]
