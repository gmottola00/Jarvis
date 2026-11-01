"""Jarvis's confirmation policy.

    read = auto · write = PR · destructive = human confirm

``WRITE`` allows immediately *because* of what write means in this system: a write
tool produces a commit or a pull request, never a mutation of the running cluster.
The human gate on a write is the merge button, and merging is itself classified
``DESTRUCTIVE``.

The gate itself is the kernel's; what is Jarvis's is the meaning of each level,
written here because it is shown verbatim in the approval dialog.

Example:
    >>> "Git" in build_policy().decide(RiskLevel.WRITE).why
    True
"""

from __future__ import annotations

from quaerium.agents import PolicyGate, RiskLevel

WHY = {
    RiskLevel.READ: "Read-only: no side effects.",
    RiskLevel.WRITE: "Writes to Git only — the change lands as a commit or pull request, "
    "and ArgoCD is still the only thing that touches the cluster.",
    RiskLevel.DESTRUCTIVE: "Hard to reverse. This one is yours to approve.",
}


def build_policy(*, confirm_writes: bool = False, block_destructive: bool = False) -> PolicyGate:
    """The gate with Jarvis's texts."""
    return PolicyGate(confirm_writes=confirm_writes, block_destructive=block_destructive, why=WHY)


__all__ = ["WHY", "build_policy"]
