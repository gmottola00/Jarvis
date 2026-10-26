"""Policy gate node.

The one place a human is asked. Every tool call the model made passes through
here and comes out in one of two buckets: cleared to run, or refused with a
result the model can read.

Suspension uses LangGraph's ``interrupt``, which checkpoints the whole run. The
process can be restarted, the browser can be closed, and the pending approval is
still there when you come back — that is the difference between a dialog and a
gate.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from jarvis.agent.state import JarvisState, Node
from jarvis.core.policy import PolicyGate
from jarvis.core.types import Approval, Decision, ToolCall, ToolResult
from jarvis.logging import get_logger

logger = get_logger(__name__)


def _refused(call: ToolCall, reason: str) -> ToolResult:
    """Build the result the model sees when a call does not run.

    Phrased as an outcome rather than an error: the model should accept it and
    move on, not retry or look for a way around it.
    """
    return ToolResult(
        id=call.id,
        name=call.name,
        ok=False,
        content=f"Not executed. {reason} Do not attempt this action another way; report it to the user.",
    )


def make_gate(*, policy: PolicyGate, on_approval: Any = None) -> Node:
    """Build the gate node.

    Args:
        policy: The risk-to-decision mapping.
        on_approval: Optional async callback receiving each settled
            :class:`~jarvis.core.types.Approval`, for the audit log.
    """

    async def gate(state: JarvisState) -> dict[str, Any]:
        run_id = state.get("run_id", "")
        approved: list[ToolCall] = []
        denied: list[ToolResult] = []

        for call in state.get("pending", []):
            ruling = policy.decide(call.risk)

            if ruling.decision is Decision.ALLOW:
                approved.append(call)
                continue

            if ruling.decision is Decision.DENY:
                logger.info("gate.denied", tool=call.name, reason=ruling.why)
                denied.append(_refused(call, ruling.why))
                continue

            # CONFIRM: suspend. On resume the node re-runs from the top and
            # interrupt() returns whatever the API passed in Command(resume=...).
            # The approval_required event is emitted by the runner, from the
            # checkpointed interrupt - emitting it here would fire again on resume.
            logger.info("gate.suspending", tool=call.name, run_id=run_id)

            from langgraph.types import interrupt

            answer = interrupt(
                {
                    "run_id": run_id,
                    "tool": call.name,
                    "args": call.args,
                    "risk": call.risk.value,
                    "why": ruling.why,
                }
            )

            granted = bool(answer.get("approved")) if isinstance(answer, dict) else bool(answer)
            approval = Approval(
                run_id=run_id,
                tool_call=call,
                why=ruling.why,
                approved=granted,
                decided_at=datetime.now(timezone.utc),
            )
            if on_approval is not None:
                await on_approval(approval)

            if granted:
                logger.info("gate.approved", tool=call.name)
                approved.append(call)
            else:
                logger.info("gate.declined", tool=call.name)
                denied.append(_refused(call, "The user declined this action."))

        return {"approved": approved, "denied": denied, "pending": []}

    return gate


__all__ = ["make_gate"]
