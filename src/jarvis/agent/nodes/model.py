"""Model node.

Builds the request, streams the turn out to the UI, and puts the assistant's
content back into state. It appends `response.content` verbatim — thinking blocks
included — because those blocks have to go back over the wire unchanged on the
next request.
"""

from __future__ import annotations

from typing import Any

from jarvis.agent.llm import LLM
from jarvis.agent.prompts import build_system
from jarvis.agent.state import JarvisState, Node
from jarvis.logging import get_logger
from jarvis.observability.events import emit_thinking, emit_token
from jarvis.tools.registry import ToolRegistry

logger = get_logger(__name__)

_EFFORT_FOR_ROUTE = {"chitchat": "low", "question": "medium"}


def make_model_node(*, llm: LLM, registry: ToolRegistry, effort: str = "high", max_steps: int = 12) -> Node:
    """Build the model node.

    Args:
        llm: The model boundary.
        registry: Supplies the tool definitions offered to the model.
        effort: Effort for action-shaped turns. Cheaper routes step down from here.
        max_steps: Ceiling on model turns in one run.
    """
    system = build_system()

    async def model(state: JarvisState) -> dict[str, Any]:
        steps = state.get("steps", 0)
        if steps >= max_steps:
            note = f"Stopped after {steps} steps without finishing. Ask me to continue if that was too soon."
            logger.warning("model.max_steps", steps=steps)
            return {"answer": note, "pending": [], "error": "max_steps"}

        route = state.get("route", "question")
        tools = None if route == "chitchat" else registry.to_anthropic()

        def emit(kind: str, text: str) -> None:
            emit_thinking(text) if kind == "thinking" else emit_token(text)

        turn = await llm.complete(
            system=system,
            messages=state["messages"],
            tools=tools,
            effort=_EFFORT_FOR_ROUTE.get(route, effort),
            emit=emit,
            model=state.get("model") or None,
        )

        logger.info(
            "model.turn",
            model=turn.model,
            stop_reason=turn.stop_reason,
            tool_calls=[c.name for c in turn.tool_calls],
            output_tokens=turn.usage.output_tokens,
            cache_read=turn.usage.cache_read_tokens,
        )

        update: dict[str, Any] = {
            "messages": [{"role": "assistant", "content": turn.content}],
            "pending": turn.tool_calls,
            "steps": steps + 1,
            "usage": turn.usage,
            "served_by": turn.model,
        }

        if turn.stop_reason == "refusal":
            update["answer"] = turn.refusal
            update["error"] = "refusal"
            update["pending"] = []
        elif not turn.tool_calls:
            update["answer"] = turn.text

        return update

    return model


def after_model(state: JarvisState) -> str:
    """Route out of the model node: to the gate when tools were requested, else stop."""
    return "gate" if state.get("pending") else "end"


__all__ = ["after_model", "make_model_node"]
