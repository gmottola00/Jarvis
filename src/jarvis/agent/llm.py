"""The model boundary.

Every call to Anthropic happens here and nowhere else. The rest of the agent
talks to the :class:`LLM` protocol, which is what lets the graph be tested with a
scripted model and no API key.

Deliberately the raw SDK rather than a framework wrapper: adaptive thinking,
``output_config.effort`` and server-side refusal fallbacks are all current API
surface, and going through the SDK directly means they are available today.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, runtime_checkable

from jarvis.core.types import ToolCall, Usage, new_id
from jarvis.exceptions import ConfigurationError
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

Emit = Callable[[str, str], None]
"""``emit(kind, text)`` where kind is ``"thinking"`` or ``"token"``."""


@dataclass
class ModelTurn:
    """One assistant turn, in a form the graph can put straight into state."""

    content: list[dict[str, Any]]
    """Raw content blocks, echoed back verbatim on the next request."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    stop_reason: str = "end_turn"
    refusal: str = ""

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


@runtime_checkable
class LLM(Protocol):
    """What the graph needs from a model."""

    async def complete(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        effort: str,
        emit: Emit,
    ) -> ModelTurn: ...


class AnthropicLLM:
    """Streaming Claude client.

    Args:
        settings: Supplies the API key, model id, token ceiling and effort.
        risk_of: Resolves a tool name to its risk level, so the tool calls this
            returns are already classified when the gate sees them.
    """

    def __init__(self, settings: Settings, *, risk_of: Callable[[str], Any]) -> None:
        if not settings.anthropic_api_key:
            raise ConfigurationError("ANTHROPIC_API_KEY is not set")
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key.get_secret_value())
        self._model = settings.model
        self._max_tokens = settings.max_tokens
        self._risk_of = risk_of

    async def complete(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        effort: str,
        emit: Emit,
    ) -> ModelTurn:
        """Stream one assistant turn, emitting thinking and text as it arrives."""
        request: dict[str, Any] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": messages,
            # Adaptive thinking with summaries: the default is omitted, which
            # would show the user a long silence before the first token.
            "thinking": {"type": "adaptive", "display": "summarized"},
            "output_config": {"effort": effort},
            # Safety classifiers can decline a turn; routing by refusal category
            # means a declined request still gets answered instead of dead-ending.
            "betas": ["server-side-fallback-2026-07-01"],
            "fallbacks": "default",
        }
        if tools:
            request["tools"] = tools

        async with self._client.beta.messages.stream(**request) as stream:
            async for event in stream:
                if event.type != "content_block_delta":
                    continue
                delta = event.delta
                if delta.type == "thinking_delta":
                    emit("thinking", delta.thinking)
                elif delta.type == "text_delta":
                    emit("token", delta.text)

            final = await stream.get_final_message()

        return self._to_turn(final)

    def _to_turn(self, message: Any) -> ModelTurn:
        """Convert an SDK message into a :class:`ModelTurn`."""
        content: list[dict[str, Any]] = []
        text_parts: list[str] = []
        calls: list[ToolCall] = []

        for block in message.content:
            content.append(block.model_dump())
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                calls.append(
                    ToolCall(id=block.id, name=block.name, args=dict(block.input), risk=self._risk_of(block.name))
                )

        usage = message.usage
        stop_reason = message.stop_reason or "end_turn"
        refusal = ""
        if stop_reason == "refusal":
            details = getattr(message, "stop_details", None)
            refusal = getattr(details, "explanation", "") or "The request was declined."
            logger.warning("model.refusal", category=getattr(details, "category", None))

        return ModelTurn(
            content=content,
            text="".join(text_parts),
            tool_calls=calls,
            usage=Usage(
                input_tokens=getattr(usage, "input_tokens", 0) or 0,
                output_tokens=getattr(usage, "output_tokens", 0) or 0,
                cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
                cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
            ),
            stop_reason=stop_reason,
            refusal=refusal,
        )


class ScriptedLLM:
    """A model that replays a fixed list of turns.

    The technique Quaerium uses in its agent tests: hand the loop a list of
    responses and assert on what the loop does with them. No API key, no network,
    fully deterministic.

    Example:
        >>> llm = ScriptedLLM([
        ...     ScriptedLLM.call("k8s__list_nodes", {}),
        ...     ScriptedLLM.say("One node, um790, Ready."),
        ... ])
    """

    def __init__(self, turns: list[ModelTurn]) -> None:
        self._turns = list(turns)
        self.requests: list[dict[str, Any]] = []

    @staticmethod
    def say(text: str) -> ModelTurn:
        """A turn that just answers."""
        return ModelTurn(content=[{"type": "text", "text": text}], text=text, stop_reason="end_turn")

    @staticmethod
    def call(name: str, args: dict[str, Any], *, risk: Any = None, text: str = "") -> ModelTurn:
        """A turn that calls one tool."""
        from jarvis.core.types import RiskLevel

        call_id = new_id("toolu")
        content: list[dict[str, Any]] = []
        if text:
            content.append({"type": "text", "text": text})
        content.append({"type": "tool_use", "id": call_id, "name": name, "input": args})
        return ModelTurn(
            content=content,
            text=text,
            tool_calls=[ToolCall(id=call_id, name=name, args=args, risk=risk or RiskLevel.READ)],
            stop_reason="tool_use",
        )

    @staticmethod
    def call_many(calls: list[tuple[str, dict[str, Any]]], *, risks: list[Any] | None = None) -> ModelTurn:
        """A turn that calls several tools at once."""
        from jarvis.core.types import RiskLevel

        content: list[dict[str, Any]] = []
        tool_calls: list[ToolCall] = []
        for index, (name, args) in enumerate(calls):
            call_id = new_id("toolu")
            content.append({"type": "tool_use", "id": call_id, "name": name, "input": args})
            risk = (risks[index] if risks else None) or RiskLevel.READ
            tool_calls.append(ToolCall(id=call_id, name=name, args=args, risk=risk))
        return ModelTurn(content=content, tool_calls=tool_calls, stop_reason="tool_use")

    async def complete(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        effort: str,
        emit: Emit,
    ) -> ModelTurn:
        self.requests.append({"system": system, "messages": list(messages), "tools": tools, "effort": effort})
        if not self._turns:
            return self.say("(scripted model exhausted)")
        turn = self._turns.pop(0)
        if turn.text:
            emit("token", turn.text)
        return turn


__all__ = ["LLM", "AnthropicLLM", "Emit", "ModelTurn", "ScriptedLLM"]
