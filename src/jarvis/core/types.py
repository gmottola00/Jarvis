"""Jarvis's own value types: the dashboard widgets.

Pure data, no I/O. The agent's types (risk levels, tool calls, the ``RunEvent``
SSE protocol) are the kernel's and live in :mod:`quaerium.agents.types`; what is
here is the lab as the console shows it. Both are mirrored by hand in
``web/src/lib/types.ts``. Change one, change the other.

Checkpoints written before the kernel moved to Quaerium name this module for the
agent types (``jarvis.core.types.ToolCall``); the API lifespan passes it as a
legacy module to the checkpointer, which attaches the kernel types here so those
runs still resume.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


class NodeStatus(BaseModel):
    name: str
    ready: bool
    version: str = ""
    roles: list[str] = Field(default_factory=list)


class PodStatus(BaseModel):
    namespace: str
    name: str
    phase: str
    ready: str = ""
    restarts: int = 0
    reason: str = ""


class ArgoAppStatus(BaseModel):
    name: str
    sync: str
    """``Synced`` | ``OutOfSync`` | ``Unknown``."""

    health: str
    """``Healthy`` | ``Progressing`` | ``Degraded`` | ``Missing`` | ``Unknown``."""

    revision: str = ""
    repo: str = ""
    path: str = ""
    namespace: str = ""
    """Where the app's workloads live: the destination namespace, else the one most of its resources are in."""


ProblemKind = Literal["node", "pod", "argo", "alert", "event", "gateway", "approval"]


class Problem(BaseModel):
    """One thing on the status page that wants a look, whatever system it came from."""

    id: str
    kind: ProblemKind
    severity: Literal["bad", "warn"]
    title: str
    namespace: str = ""
    name: str = ""
    """The subject: a pod, an ArgoCD app, an alert fingerprint, a run id."""

    detail: str = ""
    since: datetime | None = None
    link: str = ""
    """The console view that shows it, as a URL hash (``#cluster/apps/tickup/logs``)."""

    investigable: bool = True
    """Whether ``/api/status/brief`` can turn it into a chat prompt."""


class StatusCounts(BaseModel):
    nodes: int = 0
    nodes_ready: int = 0
    unhealthy_pods: int = 0
    argo_apps: int = 0
    argo_unhealthy: int = 0
    alerts: int = 0
    approvals: int = 0
    gpu_up: bool | None = None
    """None when there is no GPU host to probe."""


class StatusView(BaseModel):
    """The answer to "is everything fine?": every problem, worst first."""

    problems: list[Problem] = Field(default_factory=list)
    counts: StatusCounts = Field(default_factory=StatusCounts)
    errors: dict[str, str] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=_now)


__all__ = [
    "ArgoAppStatus",
    "NodeStatus",
    "PodStatus",
    "Problem",
    "ProblemKind",
    "StatusCounts",
    "StatusView",
]
