"""Jarvis's policy: the kernel's gate with Jarvis's meaning of each level."""

from __future__ import annotations

from quaerium.agents import Decision, RiskLevel

from jarvis.agent.policy import build_policy


class TestPolicy:
    def test_configured_policy(self, policy) -> None:
        assert policy.decide(RiskLevel.READ).decision is Decision.ALLOW
        assert policy.decide(RiskLevel.WRITE).decision is Decision.ALLOW
        assert policy.decide(RiskLevel.DESTRUCTIVE).decision is Decision.CONFIRM

    def test_write_is_allowed_because_it_only_reaches_git(self, policy) -> None:
        assert "Git" in policy.decide(RiskLevel.WRITE).why

    def test_confirm_writes_escalates(self) -> None:
        gate = build_policy(confirm_writes=True)
        assert gate.decide(RiskLevel.WRITE).needs_human
        assert gate.decide(RiskLevel.READ).allowed

    def test_block_destructive_refuses_instead_of_asking(self) -> None:
        gate = build_policy(block_destructive=True)
        assert gate.decide(RiskLevel.DESTRUCTIVE).decision is Decision.DENY
