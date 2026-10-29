"""The model boundary: what each kind of model is sent, and what is kept of its reply."""

from __future__ import annotations

from typing import Any

from anthropic.types.beta.parsed_beta_message import ParsedBetaMessage

from jarvis.agent.llm import LOCAL_MAX_TOKENS, AnthropicLLM, build_request, is_native
from jarvis.core.types import RiskLevel
from jarvis.settings import Settings

THINKING = {"type": "thinking", "thinking": "hmm", "signature": "sig"}
HISTORY: list[dict[str, Any]] = [
    {"role": "user", "content": "quanti nodi?"},
    {
        "role": "assistant",
        "content": [THINKING, {"type": "tool_use", "id": "toolu_1", "name": "k8s__list_nodes", "input": {}}],
    },
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "um790 Ready"}]},
]


def request_for(model: str) -> dict[str, Any]:
    return build_request(model=model, max_tokens=64000, system=[], messages=HISTORY, tools=None, effort="high")


def message(*blocks: dict[str, Any]) -> ParsedBetaMessage[None]:
    """What ``stream.get_final_message()`` returns: the parsed variant."""
    return ParsedBetaMessage[None].model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "x",
            "content": list(blocks),
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    )


class TestRequest:
    def test_claude_is_native_and_local_is_not(self) -> None:
        assert is_native("claude-haiku-4-5")
        assert not is_native("local/qwen3-30b")

    def test_claude_gets_the_full_request_and_its_history_untouched(self) -> None:
        request = request_for("claude-opus-5")

        assert request["thinking"] == {"type": "adaptive", "display": "summarized"}
        assert request["output_config"] == {"effort": "high"}
        assert request["betas"] == ["server-side-fallback-2026-07-01"]
        assert request["max_tokens"] == 64000
        assert request["messages"] is HISTORY

    def test_a_local_model_gets_the_portable_subset(self) -> None:
        request = request_for("local/qwen3-30b")

        assert not {"thinking", "output_config", "betas", "fallbacks"} & request.keys()
        assert request["max_tokens"] == LOCAL_MAX_TOKENS

    def test_a_local_model_never_sees_claude_thinking(self) -> None:
        request = request_for("local/qwen3-30b")

        assistant = request["messages"][1]["content"]
        assert [b["type"] for b in assistant] == ["tool_use"]
        assert HISTORY[1]["content"][0] is THINKING, "the stored history must not be mutated"


class TestReply:
    llm = AnthropicLLM(Settings(ANTHROPIC_API_KEY="sk-test"), risk_of=lambda _name: RiskLevel.READ)

    def test_claude_thinking_is_kept_for_the_next_request(self) -> None:
        turn = self.llm._to_turn(message(THINKING, {"type": "text", "text": "ok"}), served="claude-opus-5")
        assert [b["type"] for b in turn.content] == ["thinking", "text"]

    def test_local_thinking_is_dropped_so_claude_never_receives_it(self) -> None:
        turn = self.llm._to_turn(
            message(THINKING, {"type": "tool_use", "id": "call_1", "name": "k8s__list_nodes", "input": {}}),
            served="local/qwen3-30b",
            keep_thinking=False,
        )

        assert [b["type"] for b in turn.content] == ["tool_use"]
        assert turn.tool_calls[0].name == "k8s__list_nodes"
        assert turn.model == "local/qwen3-30b"

    def test_stored_blocks_are_valid_to_send_back(self) -> None:
        """A text block echoed with the SDK's ``parsed_output`` is a 400 on the next turn."""
        turn = self.llm._to_turn(message({"type": "text", "text": "ok"}), served="claude-opus-5")
        assert turn.content == [{"type": "text", "text": "ok"}]

    def test_a_reply_that_was_only_thinking_still_leaves_valid_content(self) -> None:
        turn = self.llm._to_turn(message(THINKING), served="local/qwen3-30b", keep_thinking=False)
        assert turn.content == [{"type": "text", "text": "(empty reply)"}]
