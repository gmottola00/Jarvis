"""Offline stand-in for the Kubernetes API.

The fixtures mirror the real lab as described in ``Home-Lab-Infra``: a single k3s
node on the UM790, two app namespaces each running a FastAPI backend and an nginx
SPA. One pod is deliberately broken so the unhealthy path and the dashboard's
degraded badge have something to show.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.types import NodeStatus, PodStatus

_NODES = [NodeStatus(name="um790", ready=True, version="v1.31.4+k3s1", roles=["control-plane", "master"])]

_PODS = [
    PodStatus(namespace="argocd", name="argocd-server-6d4f9c7b8-mn2xq", phase="Running", ready="1/1"),
    PodStatus(namespace="argocd", name="argocd-repo-server-7c8b5d94-vk9rt", phase="Running", ready="1/1"),
    PodStatus(namespace="tailscale", name="operator-59d8f4c66-hq4wl", phase="Running", ready="1/1"),
    PodStatus(namespace="trip-ai", name="trip-ai-backend-7d9c8f5b4-2xk9p", phase="Running", ready="1/1"),
    PodStatus(namespace="trip-ai", name="trip-ai-web-6b8d7c9f5-lm4rt", phase="Running", ready="1/1"),
    PodStatus(namespace="tickup", name="tickup-backend-5f7c8d9b6-qw3rt", phase="Running", ready="1/1", restarts=2),
    PodStatus(
        namespace="tickup",
        name="tickup-web-8c9d7f6b5-zx8vn",
        phase="Pending",
        ready="0/1",
        restarts=4,
        reason="ImagePullBackOff",
    ),
]

_EVENTS = [
    {
        "namespace": "tickup",
        "type": "Warning",
        "reason": "Failed",
        "object": "Pod/tickup-web-8c9d7f6b5-zx8vn",
        "message": 'Failed to pull image "ghcr.io/gmottola00/tickup-web:4f5e7497": unauthorized',
        "count": 4,
        "at": "2026-08-25T18:41:02Z",
    },
    {
        "namespace": "tickup",
        "type": "Normal",
        "reason": "Pulling",
        "object": "Pod/tickup-web-8c9d7f6b5-zx8vn",
        "message": 'Pulling image "ghcr.io/gmottola00/tickup-web:4f5e7497"',
        "count": 4,
        "at": "2026-08-25T18:40:55Z",
    },
    {
        "namespace": "trip-ai",
        "type": "Normal",
        "reason": "ScalingReplicaSet",
        "object": "Deployment/trip-ai-web",
        "message": "Scaled up replica set trip-ai-web-6b8d7c9f5 to 1",
        "count": 1,
        "at": "2026-08-25T09:12:30Z",
    },
]

_LOG = """INFO:     Started server process [1]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     10.42.0.31:54122 - "GET /health HTTP/1.1" 200 OK
INFO:     10.42.0.31:54130 - "GET /api/leagues HTTP/1.1" 200 OK
"""


class FakeK8sClient:
    """Serves the fixtures above. Same surface as :class:`K8sClient`."""

    async def list_nodes(self) -> list[NodeStatus]:
        return list(_NODES)

    async def list_pods(self, namespace: str = "all") -> list[PodStatus]:
        return [p for p in _PODS if namespace == "all" or p.namespace == namespace]

    async def unhealthy_pods(self) -> list[PodStatus]:
        return [p for p in _PODS if p.phase != "Running" or p.ready.split("/")[0] == "0"]

    async def pod_logs(self, namespace: str, pod: str, *, tail: int = 100, container: str | None = None) -> str:
        return "\n".join(_LOG.splitlines()[-tail:])

    async def list_events(self, namespace: str = "all", *, limit: int = 30) -> list[dict[str, Any]]:
        return [e for e in _EVENTS if namespace == "all" or e["namespace"] == namespace][:limit]

    async def rollout_status(self, namespace: str, deployment: str) -> dict[str, Any]:
        broken = deployment == "tickup-web"
        return {
            "name": deployment,
            "namespace": namespace,
            "desired": 1,
            "updated": 1,
            "ready": 0 if broken else 1,
            "available": 0 if broken else 1,
            "images": [f"ghcr.io/gmottola00/{deployment}:latest"],
            "complete": not broken,
        }

    async def aclose(self) -> None:
        return None


__all__ = ["FakeK8sClient"]
