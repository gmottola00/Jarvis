"""Routing heuristics."""

from __future__ import annotations

import pytest

from jarvis.agent.nodes.router import classify


class TestClassify:
    @pytest.mark.parametrize("message", ["ciao", "grazie!", "hey", "chi sei", "ok"])
    def test_chitchat(self, message: str) -> None:
        assert classify(message) == "chitchat"

    @pytest.mark.parametrize(
        "message",
        ["deploya tickup", "bump tickup-web", "mergia la PR 12", "apri una PR", "revert the last commit"],
    )
    def test_action(self, message: str) -> None:
        assert classify(message) == "action"

    @pytest.mark.parametrize(
        "message", ["come sta il cluster?", "perché tickup è degraded", "mostrami i log", "which apps are healthy?"]
    )
    def test_question(self, message: str) -> None:
        assert classify(message) == "question"

    @pytest.mark.parametrize("message", ["tickup", "fai qualcosa", "hmm"])
    def test_ambiguous_returns_none(self, message: str) -> None:
        assert classify(message) is None
