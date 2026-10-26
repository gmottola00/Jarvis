"""Graph state.

Everything a run needs to survive a checkpoint. Messages are kept in raw
Anthropic content-block form rather than a framework's message classes, because
they have to go back over the wire byte-identical — thinking blocks in particular
must be echoed unchanged.
"""

from __future__ import annotations

from typing import Annotated, Any, Awaitable, Callable, TypedDict

from jarvis.core.types import ToolCall, ToolResult, Usage


def _extend(left: list[Any], right: list[Any]) -> list[Any]:
    """Reducer that appends rather than replaces."""
    return [*left, *right]


def _add_usage(left: Usage, right: Usage) -> Usage:
    """Reducer that accumulates token counts across model turns."""
    return Usage(
        input_tokens=left.input_tokens + right.input_tokens,
        output_tokens=left.output_tokens + right.output_tokens,
        cache_read_tokens=left.cache_read_tokens + right.cache_read_tokens,
        cache_write_tokens=left.cache_write_tokens + right.cache_write_tokens,
    )


class JarvisState(TypedDict, total=False):
    """The state one run carries through the graph."""

    session_id: str
    run_id: str

    messages: Annotated[list[dict[str, Any]], _extend]
    """Conversation in Anthropic wire format. Append-only within a run."""

    route: str
    """``chitchat`` | ``question`` | ``action`` — set by the router, read by the model node."""

    pending: list[ToolCall]
    """Tool calls the model asked for and the gate has not yet cleared."""

    approved: list[ToolCall]
    """Calls cleared to run."""

    denied: list[ToolResult]
    """Synthetic results for calls the gate refused."""

    steps: int
    """Model turns so far. Bounded by ``Settings.max_graph_steps``."""

    usage: Annotated[Usage, _add_usage]
    answer: str
    error: str


Node = Callable[["JarvisState"], Awaitable[dict[str, Any]]]
"""What every graph node is: state in, partial state out."""


__all__ = ["JarvisState", "Node"]
