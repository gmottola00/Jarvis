"""The policy gate.

The single place where Jarvis decides whether an action may proceed. Its whole
job is a mapping from ``RiskLevel`` to ``Decision``, and the value of keeping it
here — rather than scattered across tool implementations — is that the answer to
"what is Jarvis allowed to do" is one readable file.

The configured policy, from the design doc:

    read = auto · write = PR · destructive = human confirm

``WRITE`` allows immediately *because* of what write means in this system: a write
tool produces a commit or a pull request, never a mutation of the running cluster.
The human gate on a write is the merge button, and merging is itself classified
``DESTRUCTIVE``.

Example:
    >>> gate = PolicyGate()
    >>> gate.decide(RiskLevel.READ).decision
    <Decision.ALLOW: 'allow'>
    >>> gate.decide(RiskLevel.DESTRUCTIVE).decision
    <Decision.CONFIRM: 'confirm'>
"""

from __future__ import annotations

from dataclasses import dataclass

from jarvis.core.types import Decision, RiskLevel

_WHY = {
    RiskLevel.READ: "Read-only: no side effects.",
    RiskLevel.WRITE: "Writes to Git only — the change lands as a commit or pull request, "
    "and ArgoCD is still the only thing that touches the cluster.",
    RiskLevel.DESTRUCTIVE: "Hard to reverse. This one is yours to approve.",
}


@dataclass(frozen=True)
class Ruling:
    """The gate's answer about one pending call."""

    decision: Decision
    why: str

    @property
    def needs_human(self) -> bool:
        return self.decision is Decision.CONFIRM

    @property
    def allowed(self) -> bool:
        return self.decision is Decision.ALLOW


@dataclass(frozen=True)
class PolicyGate:
    """Maps risk to a decision.

    Args:
        confirm_writes: Escalate ``WRITE`` to a human confirmation too. Off by
            default; turn it on while you are still learning to trust the agent.
        block_destructive: Refuse destructive calls outright instead of asking.
            Useful for an unattended run.
    """

    confirm_writes: bool = False
    block_destructive: bool = False

    def decide(self, risk: RiskLevel) -> Ruling:
        """Rule on a single risk level."""
        if risk is RiskLevel.READ:
            return Ruling(Decision.ALLOW, _WHY[RiskLevel.READ])

        if risk is RiskLevel.WRITE:
            if self.confirm_writes:
                return Ruling(Decision.CONFIRM, "Every write requires confirmation in this configuration.")
            return Ruling(Decision.ALLOW, _WHY[RiskLevel.WRITE])

        if self.block_destructive:
            return Ruling(Decision.DENY, "Destructive actions are disabled in this configuration.")
        return Ruling(Decision.CONFIRM, _WHY[RiskLevel.DESTRUCTIVE])


__all__ = ["PolicyGate", "Ruling"]
