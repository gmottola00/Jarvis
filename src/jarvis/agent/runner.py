"""Run driver.

Turns a graph invocation into a flat stream of :class:`~jarvis.core.types.RunEvent`,
and owns the one thing the graph cannot express by itself: what it means when the
stream stops early.

A run ends in exactly one of three ways, and the runner is what tells them apart:

- the model answered — a ``done`` event closes the stream;
- the gate suspended — an ``approval_required`` event closes it, and the state is
  on disk waiting for :meth:`JarvisRunner.resume`;
- something broke — an ``error`` event closes it.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

from langgraph.types import Command

from jarvis.agent.graph import initial_state
from jarvis.core.types import (
    ApprovalRequiredEvent,
    DoneEvent,
    ErrorEvent,
    Turn,
    Usage,
    new_id,
)
from jarvis.logging import bind_run, clear_run, get_logger

logger = get_logger(__name__)


class JarvisRunner:
    """Drives the graph for one session at a time.

    Args:
        graph: The compiled graph.
        sessions: Session store, for the history the UI renders.
        audit: Optional audit log.
    """

    def __init__(self, *, graph: Any, sessions: Any = None, audit: Any = None) -> None:
        self._graph = graph
        self._sessions = sessions
        self._audit = audit

    @staticmethod
    def _config(session_id: str) -> dict[str, Any]:
        """The checkpointer thread is the session: history accumulates by itself."""
        return {"configurable": {"thread_id": session_id}}

    async def _usage(self, session_id: str) -> Usage:
        """Read the session's cumulative token usage from the checkpoint."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        return snapshot.values.get("usage") or Usage() if snapshot.values else Usage()

    @staticmethod
    def _delta(before: Usage, after: Usage) -> Usage:
        """Usage accumulates across a session; the UI wants this run's share."""
        return Usage(
            input_tokens=after.input_tokens - before.input_tokens,
            output_tokens=after.output_tokens - before.output_tokens,
            cache_read_tokens=after.cache_read_tokens - before.cache_read_tokens,
            cache_write_tokens=after.cache_write_tokens - before.cache_write_tokens,
        )

    async def _drain(self, payload: Any, session_id: str, run_id: str, before: Usage) -> AsyncIterator[Any]:
        """Stream one graph invocation, then decide how it ended."""
        config = self._config(session_id)
        try:
            async for chunk in self._graph.astream(payload, config=config, stream_mode="custom"):
                yield chunk
        except Exception as exc:  # noqa: BLE001 - surfaced to the user, not swallowed
            logger.error("run.failed", error=str(exc), exc_info=True)
            yield ErrorEvent(message=f"{type(exc).__name__}: {exc}").model_dump(mode="json")
            return

        snapshot = await self._graph.aget_state(config)

        if snapshot.interrupts:
            payload_value = snapshot.interrupts[0].value or {}
            logger.info("run.suspended", tool=payload_value.get("tool"))
            event = ApprovalRequiredEvent(
                run_id=run_id,
                tool=str(payload_value.get("tool", "")),
                args=dict(payload_value.get("args") or {}),
                why=str(payload_value.get("why", "")),
            )
            if self._audit is not None:
                self._audit.suspend_run(run_id, event.tool, event.args, event.why)
            yield event.model_dump(mode="json")
            return

        answer = (snapshot.values or {}).get("answer", "")
        served_by = (snapshot.values or {}).get("served_by", "")
        requested = (snapshot.values or {}).get("model", "")
        usage = self._delta(before, (snapshot.values or {}).get("usage") or Usage())

        if self._sessions is not None and answer:
            await self._sessions.append(session_id, Turn(role="assistant", content=answer))
        if self._audit is not None:
            await self._audit.finish_run(run_id, answer, usage, served_by=served_by)

        logger.info("run.done", output_tokens=usage.output_tokens)
        yield DoneEvent(run_id=run_id, usage=usage, model=served_by, requested_model=requested).model_dump(mode="json")

    async def start(
        self, session_id: str, message: str, *, run_id: str | None = None, model: str = "", picked: str = ""
    ) -> AsyncIterator[Any]:
        """Begin a run and stream its events.

        Args:
            session_id: Conversation id; also the checkpointer thread.
            message: The user's message.
            run_id: Override the generated run id.
            model: Model for this run, already resolved. Empty means the default.
            picked: The model the user chose, for the audit log. Differs from
                ``model`` when the user agreed to a fallback. Defaults to ``model``.
        """
        run_id = run_id or new_id("run")
        bind_run(run_id, session=session_id)
        try:
            if self._sessions is not None:
                await self._sessions.append(session_id, Turn(role="user", content=message))
            if self._audit is not None:
                await self._audit.start_run(run_id, session_id, message, model=picked or model)

            before = await self._usage(session_id)
            state = initial_state(session_id, message, run_id=run_id, model=model)
            async for event in self._drain(state, session_id, run_id, before):
                yield event
        finally:
            clear_run()

    async def resume(self, session_id: str, run_id: str, *, approved: bool) -> AsyncIterator[Any]:
        """Answer a pending approval and continue the run.

        Args:
            session_id: The suspended run's session.
            run_id: The run id the approval belongs to.
            approved: The user's decision.
        """
        bind_run(run_id, session=session_id)
        try:
            snapshot = await self._graph.aget_state(self._config(session_id))
            if not snapshot.interrupts:
                yield ErrorEvent(message="Nothing is waiting for approval in this session.").model_dump(mode="json")
                return

            before = self._delta(Usage(), (snapshot.values or {}).get("usage") or Usage())
            logger.info("run.resuming", approved=approved)
            async for event in self._drain(Command(resume={"approved": approved}), session_id, run_id, before):
                yield event
        finally:
            clear_run()

    async def pending_approval(self, session_id: str) -> dict[str, Any] | None:
        """Return the approval this session is waiting on, if any.

        This is what lets the dashboard restore a pending dialog after a reload.
        """
        snapshot = await self._graph.aget_state(self._config(session_id))
        if not snapshot.interrupts:
            return None
        return dict(snapshot.interrupts[0].value or {})

    async def history(self, session_id: str) -> list[dict[str, Any]]:
        """Return the raw message history the model sees for a session."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        return list((snapshot.values or {}).get("messages") or [])


__all__ = ["JarvisRunner"]
