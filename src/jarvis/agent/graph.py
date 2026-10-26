"""The graph.

    router -> model -> gate -> act -> model -> ... -> END
                  \\-> END

The loop is deliberately small. What LangGraph is here for is the checkpointer
and ``interrupt``: a run that stops to ask a question is written to Postgres and
can be resumed by a different process, minutes later.

Example:
    >>> graph = build_graph(llm=llm, registry=registry)      # doctest: +SKIP
    >>> async for chunk in graph.astream(                    # doctest: +SKIP
    ...     initial_state("s1", "how is the cluster?"),
    ...     config={"configurable": {"thread_id": "s1"}},
    ...     stream_mode="custom",
    ... ):
    ...     print(chunk)
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from jarvis.agent.llm import LLM
from jarvis.agent.nodes.act import make_act
from jarvis.agent.nodes.gate import make_gate
from jarvis.agent.nodes.model import after_model, make_model_node
from jarvis.agent.nodes.router import make_router
from jarvis.agent.state import JarvisState
from jarvis.core.policy import PolicyGate
from jarvis.core.types import Usage, new_id
from jarvis.logging import get_logger
from jarvis.tools.registry import ToolRegistry

logger = get_logger(__name__)


def build_graph(
    *,
    llm: LLM,
    registry: ToolRegistry,
    policy: PolicyGate | None = None,
    checkpointer: Any = None,
    router_llm: LLM | None = None,
    effort: str = "high",
    max_steps: int = 12,
    on_result: Any = None,
    on_approval: Any = None,
) -> Any:
    """Compile the agent graph.

    Args:
        llm: The model boundary.
        registry: Tools available this run.
        policy: Risk policy. Defaults to read=auto, write=PR, destructive=confirm.
        checkpointer: LangGraph checkpointer. Required for ``interrupt`` to survive
            a restart; an in-memory saver is used when omitted.
        router_llm: Optional cheap model for ambiguous routing.
        effort: Effort for action turns.
        max_steps: Ceiling on model turns per run.
        on_result: Async callback per tool result, for the audit log.
        on_approval: Async callback per settled approval, for the audit log.
    """
    if checkpointer is None:
        from langgraph.checkpoint.memory import InMemorySaver

        checkpointer = InMemorySaver()

    builder = StateGraph(JarvisState)
    # The ignores are a limitation of LangGraph's stubs, not of these nodes:
    # `add_node` infers its state type from an inline callable and cannot do so
    # through the `Node` alias. The nodes themselves are fully typed.
    builder.add_node("router", make_router(router_llm=router_llm))  # type: ignore[call-overload]
    builder.add_node("model", make_model_node(llm=llm, registry=registry, effort=effort, max_steps=max_steps))  # type: ignore[call-overload]
    builder.add_node("gate", make_gate(policy=policy or PolicyGate(), on_approval=on_approval))  # type: ignore[call-overload]
    builder.add_node("act", make_act(registry=registry, on_result=on_result))  # type: ignore[call-overload]

    builder.add_edge(START, "router")
    builder.add_edge("router", "model")
    builder.add_conditional_edges("model", after_model, {"gate": "gate", "end": END})
    builder.add_edge("gate", "act")
    builder.add_edge("act", "model")

    return builder.compile(checkpointer=checkpointer)


def initial_state(
    session_id: str, message: str, *, run_id: str | None = None, history: list[dict[str, Any]] | None = None
) -> JarvisState:
    """Build the state a new run starts from.

    Args:
        session_id: Conversation this run belongs to. Also the checkpointer thread.
        message: What the user just said.
        run_id: Override the generated run id.
        history: Prior turns, already in Anthropic wire format.
    """
    return JarvisState(
        session_id=session_id,
        run_id=run_id or new_id("run"),
        messages=[*(history or []), {"role": "user", "content": message}],
        route="question",
        pending=[],
        approved=[],
        denied=[],
        steps=0,
        usage=Usage(),
        answer="",
        error="",
    )


__all__ = ["build_graph", "initial_state"]
