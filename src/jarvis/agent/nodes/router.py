"""Routing heuristic.

Decides how much machinery a turn deserves. Small talk gets no tools and low
effort; everything else gets the full tool surface. This is the cheap half of the
routing idea in the design doc — the other half, sending small talk to a local
model, arrives with the GPU node.

The router node is the kernel's (:func:`quaerium.agents.nodes.router.make_router`);
this is the part that is Jarvis's: the vocabulary of the lab. It answers the clear
cases for free, and returns None for the genuinely ambiguous ones.
"""

from __future__ import annotations

import re

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


__all__ = ["classify"]
