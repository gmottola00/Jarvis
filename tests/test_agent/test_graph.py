"""The kernel's graph with Jarvis's tools, vocabulary and efforts in it.

Gating, parallelism, suspension, resumption, limits and history are tested in
Quaerium. What is left here is Jarvis's: the route each kind of lab message takes,
the effort it gets, and that an investigation is all reads.
"""

from __future__ import annotations

from typing import Any

from quaerium.agents import RiskLevel, build_graph, initial_state
from quaerium.agents.testing import ScriptedLLM

from jarvis.agent.nodes.router import classify
from jarvis.agent.policy import WHY, build_policy
from jarvis.agent.prompts import build_system
from jarvis.api.app import EFFORT_FOR_ROUTE


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


def jarvis_graph(llm: Any, registry: Any) -> Any:
    """The graph as the lifespan builds it, minus the stores."""
    return build_graph(
        llm=llm,
        registry=registry,
        system=build_system(),
        classify=classify,
        effort="high",
        effort_for_route=EFFORT_FOR_ROUTE,
        policy=build_policy(),
    )


class TestRouting:
    async def test_chitchat_is_offered_no_tools(self, registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.say("ciao")])

        await drive(jarvis_graph(llm, registry), initial_state("t", "ciao"), "t")

        assert llm.requests[0]["tools"] is None
        assert llm.requests[0]["effort"] == "low"

    async def test_a_question_reads_at_medium_effort(self, registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.say("all green")])

        await drive(jarvis_graph(llm, registry), initial_state("t", "come sta il cluster?"), "t")

        assert len(llm.requests[0]["tools"]) == len(registry)
        assert llm.requests[0]["effort"] == "medium"

    async def test_an_action_gets_the_full_effort(self, registry) -> None:
        llm = ScriptedLLM([ScriptedLLM.say("ok")])

        await drive(jarvis_graph(llm, registry), initial_state("t", "deploya tickup"), "t")

        assert len(llm.requests[0]["tools"]) == len(registry)
        assert llm.requests[0]["effort"] == "high"


class TestGate:
    async def test_merging_waits_with_jarvis_words(self, registry) -> None:
        llm = ScriptedLLM(
            [ScriptedLLM.call("github__merge_pr", {"number": 12}, risk=registry.risk_of("github__merge_pr"))]
        )

        graph = jarvis_graph(llm, registry)

        await drive(graph, initial_state("t", "mergia la PR 12"), "t")

        (interrupt,) = (await graph.aget_state(config("t"))).interrupts
        assert interrupt.value["tool"] == "github__merge_pr"
        assert interrupt.value["why"] == WHY[RiskLevel.DESTRUCTIVE]

    async def test_opening_a_pr_does_not_wait(self, registry) -> None:
        llm = ScriptedLLM(
            [
                ScriptedLLM.call(
                    "github__set_replicas",
                    {"app": "tickup", "component": "web", "replicas": 0, "reason": "pause"},
                    risk=registry.risk_of("github__set_replicas"),
                ),
                ScriptedLLM.say("PR opened."),
            ]
        )
        graph = jarvis_graph(llm, registry)

        await drive(graph, initial_state("t", "stop tickup"), "t")

        assert (await graph.aget_state(config("t"))).interrupts == ()


class TestObservability:
    async def test_an_investigation_reads_metrics_and_logs_without_asking(self, registry) -> None:
        """Metrics and stored logs are reads: an investigation never stops at the gate."""
        llm = ScriptedLLM(
            [
                ScriptedLLM.call_many(
                    [
                        ("prometheus__pod_resources", {"namespace": "tickup", "pod": "tickup-backend"}),
                        ("loki__search", {"namespace": "tickup", "contains": "memory high", "minutes": 120}),
                    ]
                ),
                ScriptedLLM.say("tickup-backend is OOMKilled: its leaderboard cache never evicts."),
            ]
        )
        graph = jarvis_graph(llm, registry)

        events = await drive(graph, initial_state("t", "why does tickup restart?"), "t")

        assert "approval_required" not in [e["type"] for e in events]
        results = blocks_of(await state_of(graph, "t"), "tool_result")
        text = " ".join(str(r["content"]) for r in results)
        assert "97%" in text and "rss=498Mi" in text
        assert not any(r.get("is_error") for r in results)
