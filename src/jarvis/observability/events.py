"""Run event emission.

The graph runs inside LangGraph's custom stream, so a node publishes to the UI by
calling the stream writer. This wraps that in the defensive-notify pattern from
Quaerium's executor: a sink that fails must never take a run down with it.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.types import (
    ApprovalRequiredEvent,
    DoneEvent,
    ErrorEvent,
    ThinkingEvent,
    TokenEvent,
    ToolCall,
    ToolCallEvent,
    ToolResult,
    ToolResultEvent,
    Usage,
)
from jarvis.logging import get_logger

logger = get_logger(__name__)


def _writer() -> Any:
    """Return LangGraph's stream writer, or a sink that drops everything.

    Outside a streaming run — in a unit test, say — there is nowhere to write, and
    that must not be an error.
    """
    try:
        from langgraph.config import get_stream_writer

        return get_stream_writer()
    except Exception:  # noqa: BLE001 - no stream context is a normal condition
        return lambda _event: None


def emit(event: Any) -> None:
    """Publish one ``RunEvent``. Never raises."""
    try:
        _writer()(event.model_dump(mode="json"))
    except Exception as exc:  # noqa: BLE001 - a broken sink must not break a run
        logger.warning("events.emit_failed", error=str(exc))


def emit_thinking(text: str) -> None:
    if text:
        emit(ThinkingEvent(text=text))


def emit_token(text: str) -> None:
    if text:
        emit(TokenEvent(text=text))


def emit_tool_call(call: ToolCall) -> None:
    emit(ToolCallEvent(id=call.id, name=call.name, args=call.args, risk=call.risk))


def emit_tool_result(result: ToolResult) -> None:
    emit(
        ToolResultEvent(
            id=result.id, name=result.name, ok=result.ok, summary=result.summary, duration_ms=result.duration_ms
        )
    )


def emit_approval_required(run_id: str, call: ToolCall, why: str) -> None:
    emit(ApprovalRequiredEvent(run_id=run_id, tool=call.name, args=call.args, why=why))


def emit_done(run_id: str, usage: Usage) -> None:
    emit(DoneEvent(run_id=run_id, usage=usage))


def emit_error(message: str) -> None:
    emit(ErrorEvent(message=message))


__all__ = [
    "emit",
    "emit_approval_required",
    "emit_done",
    "emit_error",
    "emit_thinking",
    "emit_token",
    "emit_tool_call",
    "emit_tool_result",
]
