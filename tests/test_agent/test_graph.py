"""The graph: gating, parallelism, suspension and resumption.

Driven by a scripted model, so every assertion is about what the loop does, not
about what a language model happened to say.
"""

from __future__ import annotations

from typing import Any

from langgraph.types import Command

from jarvis.agent.graph import build_graph, initial_state
from jarvis.agent.llm import ScriptedLLM
from jarvis.core.policy import PolicyGate
from jarvis.core.types import RiskLevel


def config(thread: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread}}


async def drive(graph: Any, payload: Any, thread: str) -> list[dict[str, Any]]:
    """Run the graph to its next stopping point, collecting emitted events."""
    return [chunk async for chunk in graph.astream(payload, config=config(thread), stream_mode="custom")]


async def state_of(graph: Any, thread: str) -> dict[str, Any]:
    return (await graph.aget_state(config(thread))).values


def blocks_of(state: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [
        block
        for message in state["messages"]
        if isinstance(message.get("content"), list)
        for block in message["content"]
        if block.get("type") == kind
    ]


class TestReadPath:
    async def test_read_tool_runs_without_asking(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.call("toy__peek", {"what": "x"}), ScriptedLLM.say("saw it")])
        graph = build_graph(llm=llm, registry=toy_registry)

        events = await drive(graph, initial_state("t", "look"), "t")

        assert [e["type"] for e in events] == ["tool_call", "tool_result", "token"]
        assert (await state_of(graph, "t"))["answer"] == "saw it"

    async def test_write_tool_also_runs_without_asking(self, toy_registry) -> None:
        """Writes reach Git, not the cluster, so they are not gated."""
        llm = ScriptedLLM([ScriptedLLM.call("toy__draft", {"text": "x"}, risk=RiskLevel.WRITE), ScriptedLLM.say("done")])
        graph = build_graph(llm=llm, registry=toy_registry)

        events = await drive(graph, initial_state("t", "write"), "t")

        assert "approval_required" not in [e["type"] for e in events]
        assert (await graph.aget_state(config("t"))).interrupts == ()


class TestParallelism:
    async def test_results_come_back_in_one_user_message(self, toy_registry) -> None:
        """Splitting results across messages teaches the model to stop parallelising."""
        llm = ScriptedLLM(
            [
                ScriptedLLM.call_many(
                    [("toy__peek", {"what": "a"}), ("toy__peek", {"what": "b"}), ("toy__peek", {"what": "c"})]
                ),
                ScriptedLLM.say("all three"),
            ]
        )
        graph = build_graph(llm=llm, registry=toy_registry)

        await drive(graph, initial_state("t", "look x3"), "t")
        state = await state_of(graph, "t")

        result_messages = [m for m in state["messages"] if isinstance(m["content"], list) and m["role"] == "user"]
        assert len(result_messages) == 1
        assert len(result_messages[0]["content"]) == 3

    async def test_a_failing_tool_still_returns_a_result_block(self, toy_registry) -> None:
        """Every tool_use id must be answered or the next request is malformed."""
        llm = ScriptedLLM([ScriptedLLM.call_many([("toy__peek", {}), ("toy__explode", {})]), ScriptedLLM.say("ok")])
        graph = build_graph(llm=llm, registry=toy_registry)

        await drive(graph, initial_state("t", "go"), "t")
        state = await state_of(graph, "t")

        uses = blocks_of(state, "tool_use")
        results = blocks_of(state, "tool_result")
        assert {b["id"] for b in uses} == {b["tool_use_id"] for b in results}
        assert any(b.get("is_error") for b in results)


class TestGate:
    async def test_destructive_suspends_the_run(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.call("toy__demolish", {"target": "x"}, risk=RiskLevel.DESTRUCTIVE)])
        graph = build_graph(llm=llm, registry=toy_registry)

        await drive(graph, initial_state("t", "demolish"), "t")
        snapshot = await graph.aget_state(config("t"))

        assert snapshot.next == ("gate",)
        assert snapshot.interrupts[0].value["tool"] == "toy__demolish"
        assert snapshot.interrupts[0].value["risk"] == "destructive"

    async def test_approval_resumes_and_executes(self, toy_registry) -> None:
        llm = ScriptedLLM(
            [ScriptedLLM.call("toy__demolish", {"target": "x"}, risk=RiskLevel.DESTRUCTIVE), ScriptedLLM.say("gone")]
        )
        graph = build_graph(llm=llm, registry=toy_registry)
        await drive(graph, initial_state("t", "demolish"), "t")

        events = await drive(graph, Command(resume={"approved": True}), "t")

        assert [e["type"] for e in events] == ["tool_call", "tool_result", "token"]
        assert blocks_of(await state_of(graph, "t"), "tool_result")[0]["content"] == "demolished x"

    async def test_decline_produces_a_result_the_model_can_read(self, toy_registry) -> None:
        llm = ScriptedLLM(
            [ScriptedLLM.call("toy__demolish", {"target": "x"}, risk=RiskLevel.DESTRUCTIVE), ScriptedLLM.say("fine")]
        )
        graph = build_graph(llm=llm, registry=toy_registry)
        await drive(graph, initial_state("t", "demolish"), "t")

        await drive(graph, Command(resume={"approved": False}), "t")
        result = blocks_of(await state_of(graph, "t"), "tool_result")[0]

        assert result["is_error"] is True
        assert "declined" in result["content"]
        assert "Do not attempt this action another way" in result["content"]

    async def test_decline_does_not_run_the_tool(self, toy_registry) -> None:
        llm = ScriptedLLM(
            [ScriptedLLM.call("toy__demolish", {"target": "x"}, risk=RiskLevel.DESTRUCTIVE), ScriptedLLM.say("fine")]
        )
        graph = build_graph(llm=llm, registry=toy_registry)
        await drive(graph, initial_state("t", "demolish"), "t")

        events = await drive(graph, Command(resume={"approved": False}), "t")

        assert "tool_call" not in [e["type"] for e in events]

    async def test_blocking_policy_never_suspends(self, toy_registry) -> None:
        llm = ScriptedLLM(
            [ScriptedLLM.call("toy__demolish", {"target": "x"}, risk=RiskLevel.DESTRUCTIVE), ScriptedLLM.say("refused")]
        )
        graph = build_graph(llm=llm, registry=toy_registry, policy=PolicyGate(block_destructive=True))

        await drive(graph, initial_state("t", "demolish"), "t")

        assert (await graph.aget_state(config("t"))).interrupts == ()
        assert "disabled" in blocks_of(await state_of(graph, "t"), "tool_result")[0]["content"]

    async def test_confirm_writes_gates_a_write(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.call("toy__draft", {"text": "x"}, risk=RiskLevel.WRITE)])
        graph = build_graph(llm=llm, registry=toy_registry, policy=PolicyGate(confirm_writes=True))

        await drive(graph, initial_state("t", "write"), "t")

        assert (await graph.aget_state(config("t"))).interrupts != ()


class TestRouting:
    async def test_chitchat_is_offered_no_tools(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.say("ciao")])
        graph = build_graph(llm=llm, registry=toy_registry)

        await drive(graph, initial_state("t", "ciao"), "t")

        assert llm.requests[0]["tools"] is None
        assert llm.requests[0]["effort"] == "low"

    async def test_action_gets_the_full_tool_surface(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.say("ok")])
        graph = build_graph(llm=llm, registry=toy_registry, effort="high")

        await drive(graph, initial_state("t", "deploya tickup"), "t")

        assert len(llm.requests[0]["tools"]) == len(toy_registry)
        assert llm.requests[0]["effort"] == "high"


class TestLimits:
    async def test_step_ceiling_stops_the_loop(self, toy_registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.call("toy__peek", {}) for _ in range(20)])
        graph = build_graph(llm=llm, registry=toy_registry, max_steps=3)

        await drive(graph, initial_state("t", "loop"), "t")
        state = await state_of(graph, "t")

        assert state["steps"] == 3
        assert state["error"] == "max_steps"


class TestHistory:
    async def test_a_second_turn_sees_the_first(self, toy_registry) -> None:
        """The checkpointer thread is the session, so history accumulates by itself."""
        llm = ScriptedLLM([ScriptedLLM.say("one"), ScriptedLLM.say("two")])
        graph = build_graph(llm=llm, registry=toy_registry)

        await drive(graph, initial_state("t", "first"), "t")
        await drive(graph, initial_state("t", "second"), "t")

        second_request = llm.requests[1]["messages"]
        assert [m["role"] for m in second_request] == ["user", "assistant", "user"]
        assert second_request[0]["content"] == "first"
