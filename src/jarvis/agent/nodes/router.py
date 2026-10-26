"""Router node.

Decides how much machinery a turn deserves. Small talk gets no tools and low
effort; everything else gets the full tool surface. This is the cheap half of the
routing idea in the design doc — the other half, sending small talk to a local
model, arrives with the GPU node.

The heuristic answers the clear cases for free. Only genuinely ambiguous messages
cost a model call, and that call goes to Haiku.
"""

from __future__ import annotations

import re
from typing import Any

from jarvis.agent.llm import LLM
from jarvis.agent.prompts import ROUTER_SYSTEM
from jarvis.agent.state import JarvisState, Node
from jarvis.logging import get_logger

logger = get_logger(__name__)

CHITCHAT = re.compile(
    r"^\s*(ciao|hey|hi|hello|buon(giorno|asera)|grazie|thanks|thank you|ok|okay|"
    r"chi sei|come stai|who are you|how are you|test)\b[\s!?.]*$",
    re.IGNORECASE,
)

ACTION = re.compile(
    r"\b(deploy|deploya|rilascia|bump|aggiorna|update|merge|mergia|refresh|"
    r"apri una pr|open a pr|crea un branch|create a branch|commit(a|ta)?|rollback|revert|ship)\b",
    re.IGNORECASE,
)

QUESTION = re.compile(
    r"\b(stato|status|come sta|come stanno|health|healthy|degraded|log|logs|"
    r"perch[eé]|why|quale|which|what|quanti|how many|mostra|show|elenca|list|"
    r"controlla|check|c'[eè]|is there)\b",
    re.IGNORECASE,
)


def classify(message: str) -> str | None:
    """Classify a message, or return None when it is genuinely ambiguous.

    Example:
        >>> classify("ciao")
        'chitchat'
        >>> classify("deploya tickup")
        'action'
        >>> classify("come sta il cluster?")
        'question'
        >>> classify("tickup") is None
        True
    """
    if CHITCHAT.match(message):
        return "chitchat"
    if ACTION.search(message):
        return "action"
    if QUESTION.search(message):
        return "question"
    return None


def make_router(*, router_llm: LLM | None = None) -> Node:
    """Build the router node.

    Args:
        router_llm: Optional cheap model for the ambiguous cases. When omitted,
            ambiguity resolves to ``question``, which is the safe default: it
            offers read tools and no more.
    """

    async def router(state: JarvisState) -> dict[str, Any]:
        last = ""
        for message in reversed(state.get("messages", [])):
            if message.get("role") == "user" and isinstance(message.get("content"), str):
                last = message["content"]
                break

        route = classify(last)
        if route is None and router_llm is not None:
            turn = await router_llm.complete(
                system=[{"type": "text", "text": ROUTER_SYSTEM}],
                messages=[{"role": "user", "content": last}],
                tools=None,
                effort="low",
                emit=lambda _kind, _text: None,
            )
            candidate = turn.text.strip().lower().strip(".`")
            route = candidate if candidate in ("chitchat", "question", "action") else None

        route = route or "question"
        logger.info("router.decided", route=route)
        return {"route": route}

    return router


__all__ = ["classify", "make_router"]
