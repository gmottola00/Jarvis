"""Kubernetes tools — all read-only.

Output is plain text shaped for a language model to read: fixed-width columns,
a leading count, and an explicit "nothing found" rather than an empty string.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.types import RiskLevel
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.k8s.client import K8sClient
from jarvis.tools.k8s.fake import FakeK8sClient
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[Any] = ClientProvider(
    name="k8s",
    real=lambda s: K8sClient(s),
    fake=FakeK8sClient,
    requires=lambda s: [],  # kubeconfig discovery handles its own fallbacks
)


def _table(rows: list[list[str]], headers: list[str]) -> str:
    """Render a fixed-width text table."""
    widths = [
        max(len(headers[i]), *(len(r[i]) for r in rows)) if rows else len(headers[i]) for i in range(len(headers))
    ]
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    out = [line, "  ".join("-" * w for w in widths)]
    out.extend("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in rows)
    return "\n".join(out)


@tool(namespace="k8s", risk=RiskLevel.READ)
async def list_nodes() -> str:
    """List cluster nodes with their Ready condition and kubelet version."""
    nodes = await provider.get().list_nodes()
    if not nodes:
        return "No nodes found."
    rows = [[n.name, "Ready" if n.ready else "NotReady", ",".join(n.roles), n.version] for n in nodes]
    return f"{len(nodes)} node(s):\n" + _table(rows, ["NAME", "STATUS", "ROLES", "VERSION"])


@tool(namespace="k8s", risk=RiskLevel.READ)
async def list_pods(namespace: str = "all", only_unhealthy: bool = False) -> str:
    """List pods with their phase, readiness and restart count.

    Args:
        namespace: Namespace to list, or "all" for every namespace.
        only_unhealthy: Return only pods that are not Running and fully ready.
    """
    client = provider.get()
    pods = await (client.unhealthy_pods() if only_unhealthy else client.list_pods(namespace))
    if only_unhealthy and namespace != "all":
        pods = [p for p in pods if p.namespace == namespace]
    if not pods:
        return "No pods matched." if not only_unhealthy else "All pods are Running and ready."
    rows = [[p.namespace, p.name, p.phase, p.ready, str(p.restarts), p.reason] for p in pods]
    return f"{len(pods)} pod(s):\n" + _table(rows, ["NAMESPACE", "NAME", "PHASE", "READY", "RESTARTS", "REASON"])


@tool(namespace="k8s", risk=RiskLevel.READ)
async def get_logs(namespace: str, pod: str, tail: int = 100, container: str | None = None) -> str:
    """Read the tail of a pod's log.

    Args:
        namespace: The pod's namespace.
        pod: Exact pod name, as shown by list_pods.
        tail: Number of trailing lines to return.
        container: Container name, when the pod has more than one.
    """
    text = await provider.get().pod_logs(namespace, pod, tail=tail, container=container)
    return text.strip() or "(log is empty)"


@tool(namespace="k8s", risk=RiskLevel.READ)
async def list_events(namespace: str = "all", limit: int = 30) -> str:
    """List recent cluster events, newest first. The fastest way to explain a failing pod.

    Args:
        namespace: Namespace to inspect, or "all".
        limit: Maximum number of events.
    """
    events = await provider.get().list_events(namespace, limit=limit)
    if not events:
        return "No recent events."
    rows = [[e["at"][:19], e["type"], e["reason"], e["object"], e["message"][:80]] for e in events]
    return f"{len(events)} event(s):\n" + _table(rows, ["AT", "TYPE", "REASON", "OBJECT", "MESSAGE"])


@tool(namespace="k8s", risk=RiskLevel.READ)
async def rollout_status(namespace: str, deployment: str) -> str:
    """Report a deployment's rollout: replica counts and the image actually running.

    Args:
        namespace: The deployment's namespace.
        deployment: Deployment name, e.g. "tickup-backend".
    """
    status = await provider.get().rollout_status(namespace, deployment)
    verdict = "complete" if status["complete"] else "IN PROGRESS or STALLED"
    return (
        f"{namespace}/{deployment}: rollout {verdict}\n"
        f"  desired={status['desired']} updated={status['updated']} "
        f"ready={status['ready']} available={status['available']}\n"
        f"  images: {', '.join(status['images'])}"
    )


TOOLS: list[ToolSpec] = [list_nodes, list_pods, get_logs, list_events, rollout_status]

__all__ = ["TOOLS", "provider"]
