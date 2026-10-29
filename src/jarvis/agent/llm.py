"""The model boundary.

Every model call happens here and nowhere else. The rest of the agent talks to
the :class:`LLM` protocol, which is what lets the graph be tested with a
scripted model and no API key.

Deliberately the raw SDK rather than a framework wrapper: adaptive thinking,
``output_config.effort`` and server-side refusal fallbacks are all current API
surface, and going through the SDK directly means they are available today.

With a LiteLLM gateway configured, the same SDK reaches every model. Claude goes
through the gateway's Anthropic pass-through, so the request arrives untouched;
anything else (``local/*`` on Ollama) goes to the gateway's ``/v1/messages``,
which speaks the Anthropic format and translates. Only the second kind needs
the request trimmed down to what a non-Claude model understands.
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

LOCAL_MAX_TOKENS = 8192
"""Output ceiling for non-Claude models: local context windows are far smaller."""

_THINKING_BLOCKS = ("thinking", "redacted_thinking")


def is_native(model: str) -> bool:
    """Whether a model id is Claude, and so gets the full native request.

    The gateway config names its models by this convention: ``claude-*`` for
    Anthropic, ``local/*`` for Ollama.

    Example:
        >>> is_native("claude-opus-5"), is_native("local/qwen3-30b")
        (True, False)
    """
    return model.startswith("claude-")


def build_request(
    *,
    model: str,
    max_tokens: int,
    system: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    effort: str,
) -> dict[str, Any]:
    """Assemble the streaming request for one turn.

    Claude gets adaptive thinking, effort and the refusal fallback. Any other
    model gets the portable subset, and the history loses Claude's thinking
    blocks: they are signed for Anthropic and mean nothing to anyone else.
    """
    request: dict[str, Any] = {"model": model, "system": system}
    if is_native(model):
        request.update(
            max_tokens=max_tokens,
            messages=messages,
            # Adaptive thinking with summaries: the default is omitted, which
            # would show the user a long silence before the first token.
            thinking={"type": "adaptive", "display": "summarized"},
            output_config={"effort": effort},
            # Safety classifiers can decline a turn; routing by refusal category
            # means a declined request still gets answered instead of dead-ending.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    else:
        request.update(max_tokens=min(max_tokens, LOCAL_MAX_TOKENS), messages=_without_thinking(messages))
    if tools:
        request["tools"] = tools
    return request


def _without_thinking(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop thinking blocks from assistant turns, leaving everything else as is."""
    stripped: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if message.get("role") == "assistant" and isinstance(content, list):
            message = {**message, "content": [b for b in content if b.get("type") not in _THINKING_BLOCKS]}
        stripped.append(message)
    return stripped


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
    model: str = ""
    """The model that actually answered: differs from the one asked for after a gateway fallback."""

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
        model: str | None = None,
    ) -> ModelTurn: ...


class AnthropicLLM:
    """Streaming client for Claude, and for any model behind the gateway.

    Args:
        settings: Supplies the API key, default model, token ceiling and the
            gateway URL. With a gateway the key is the gateway's virtual key.
        risk_of: Resolves a tool name to its risk level, so the tool calls this
            returns are already classified when the gate sees them.
    """

    def __init__(self, settings: Settings, *, risk_of: Callable[[str], Any]) -> None:
        if not settings.anthropic_api_key:
            raise ConfigurationError("ANTHROPIC_API_KEY is not set")
        from anthropic import AsyncAnthropic

        key = settings.anthropic_api_key.get_secret_value()
        gateway = settings.llm_gateway_url.rstrip("/") if settings.llm_gateway_url else None
        self._native = AsyncAnthropic(api_key=key, base_url=f"{gateway}/anthropic" if gateway else None)
        self._gateway = AsyncAnthropic(api_key=key, base_url=gateway) if gateway else None
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
        model: str | None = None,
    ) -> ModelTurn:
        """Stream one assistant turn, emitting thinking and text as it arrives."""
        model = model or self._model
        native = is_native(model)
        client = self._native if native else self._gateway
        if client is None:
            raise ConfigurationError(f"{model} is not a Claude model and JARVIS_LLM_GATEWAY_URL is not set")

        request = build_request(
            model=model,
            max_tokens=self._max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            effort=effort,
        )

        async with client.beta.messages.stream(**request) as stream:
            async for event in stream:
                if event.type != "content_block_delta":
                    continue
                delta = event.delta
                if delta.type == "thinking_delta":
                    emit("thinking", delta.thinking)
                elif delta.type == "text_delta":
                    emit("token", delta.text)

            final = await stream.get_final_message()
            # LiteLLM names the model group that answered; after a fallback it
            # is not the one requested. Direct to Anthropic there is no header.
            served = stream.response.headers.get("x-litellm-model-group") or model

        return self._to_turn(final, served=served, keep_thinking=native)

    def _to_turn(self, message: Any, *, served: str, keep_thinking: bool = True) -> ModelTurn:
        """Convert an SDK message into a :class:`ModelTurn`.

        A non-Claude model's thinking has already been streamed to the user; it
        stays out of the stored content, because a later Claude turn would
        receive it as history and reject a thinking block it did not sign.
        """
        content: list[dict[str, Any]] = []
        text_parts: list[str] = []
        calls: list[ToolCall] = []

        for block in message.content:
            if block.type in _THINKING_BLOCKS and not keep_thinking:
                continue
            # The stream returns parsed blocks whose dump carries SDK-side fields
            # (``parsed_output``) and nulls; the API rejects both when the block
            # is echoed back on the next request.
            content.append(block.model_dump(exclude_none=True, exclude={"parsed_output"}))
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                calls.append(
                    ToolCall(id=block.id, name=block.name, args=dict(block.input), risk=self._risk_of(block.name))
                )

        if not content:
            # Possible once thinking is dropped; an empty assistant turn would
            # make the next request invalid.
            content.append({"type": "text", "text": "(empty reply)"})

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
            model=served,
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
        model: str | None = None,
    ) -> ModelTurn:
        self.requests.append(
            {"system": system, "messages": list(messages), "tools": tools, "effort": effort, "model": model}
        )
        if not self._turns:
            return self.say("(scripted model exhausted)")
        turn = self._turns.pop(0)
        if turn.text:
            emit("token", turn.text)
        return turn


__all__ = ["LLM", "AnthropicLLM", "Emit", "ModelTurn", "ScriptedLLM", "build_request", "is_native"]
