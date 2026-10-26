"""Act node.

Runs the cleared tool calls and hands every result back in a single user message.

That last part is not a detail: splitting tool results across several messages
teaches the model to stop asking for parallel calls, and the whole point of the
``TaskGroup`` below is to answer three independent questions in one round trip
instead of three.
"""

from __future__ import annotations

import asyncio
from typing import Any

from jarvis.agent.state import JarvisState, Node
from jarvis.core.types import ToolCall, ToolResult
from jarvis.logging import get_logger
from jarvis.observability.events import emit_tool_call, emit_tool_result
from jarvis.tools.registry import ToolRegistry

logger = get_logger(__name__)


def _to_block(result: ToolResult) -> dict[str, Any]:
    """Render a result as an Anthropic ``tool_result`` block."""
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": result.id, "content": result.content}
    if not result.ok:
        block["is_error"] = True
    return block


def make_act(*, registry: ToolRegistry, on_result: Any = None) -> Node:
    """Build the act node.

    Args:
        registry: Resolves names and executes calls.
        on_result: Optional async callback per ``(call, result)``, for the audit log.
    """

    async def act(state: JarvisState) -> dict[str, Any]:
        approved: list[ToolCall] = state.get("approved", [])
        denied: list[ToolResult] = state.get("denied", [])

        for call in approved:
            emit_tool_call(call)

        results: list[ToolResult] = []
        if approved:
            async with asyncio.TaskGroup() as group:
                tasks = [group.create_task(registry.invoke(call)) for call in approved]
            results = [task.result() for task in tasks]

        for result in results:
            emit_tool_result(result)
            logger.info("tool.done", tool=result.name, ok=result.ok, ms=round(result.duration_ms))

        if on_result is not None:
            by_id = {call.id: call for call in approved}
            for result in results:
                await on_result(by_id[result.id], result)

        # Denied calls still need a result block: every tool_use id in the
        # assistant turn must be answered, or the next request is malformed.
        blocks = [_to_block(r) for r in results] + [_to_block(r) for r in denied]

        return {
            "messages": [{"role": "user", "content": blocks}] if blocks else [],
            "approved": [],
            "denied": [],
        }

    return act


__all__ = ["make_act"]
