"""Kubernetes read access.

Read-only by construction: this client exposes list and get calls and nothing
else. The design rule Jarvis is built around is that it never mutates the
cluster — changes go through Git and ArgoCD reconciles them — so there is
deliberately no ``apply``, ``patch``, ``delete`` or ``scale`` here to call.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.types import NodeStatus, PodStatus
from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

_UNHEALTHY_PHASES = {"Pending", "Failed", "Unknown"}


class K8sClient:
    """Thin async wrapper over the Kubernetes API.

    One ``ApiClient`` is created on first use and reused; call :meth:`aclose` on
    shutdown.
    """

    def __init__(self, settings: Settings) -> None:
        self._kubeconfig = settings.kubeconfig
        self._api: Any = None

    async def _core(self) -> Any:
        """Return a ``CoreV1Api``, loading configuration on first use."""
        if self._api is None:
            try:
                from kubernetes_asyncio import client as k8s_client
                from kubernetes_asyncio import config as k8s_config
            except ImportError as exc:  # pragma: no cover - optional dependency
                raise UpstreamError("k8s", "kubernetes-asyncio is not installed (pip install 'jarvis[k8s]')") from exc

            try:
                if self._kubeconfig:
                    await k8s_config.load_kube_config(config_file=self._kubeconfig)
                else:
                    try:
                        k8s_config.load_incluster_config()
                    except Exception:
                        await k8s_config.load_kube_config()
            except Exception as exc:
                raise UpstreamError("k8s", f"could not load kubeconfig: {exc}") from exc

            self._api = k8s_client.ApiClient()
        from kubernetes_asyncio import client as k8s_client

        return k8s_client.CoreV1Api(self._api)

    async def _apps(self) -> Any:
        await self._core()
        from kubernetes_asyncio import client as k8s_client

        return k8s_client.AppsV1Api(self._api)

    async def list_nodes(self) -> list[NodeStatus]:
        """Return every node and whether it is Ready."""
        core = await self._core()
        try:
            result = await core.list_node()
        except Exception as exc:
            raise UpstreamError("k8s", f"list_node failed: {exc}") from exc

        nodes: list[NodeStatus] = []
        for item in result.items:
            conditions = {c.type: c.status for c in (item.status.conditions or [])}
            roles = [
                key.split("/", 1)[1]
                for key in (item.metadata.labels or {})
                if key.startswith("node-role.kubernetes.io/")
            ]
            nodes.append(
                NodeStatus(
                    name=item.metadata.name,
                    ready=conditions.get("Ready") == "True",
                    version=item.status.node_info.kubelet_version if item.status.node_info else "",
                    roles=roles or ["worker"],
                )
            )
        return nodes

    async def list_pods(self, namespace: str = "all") -> list[PodStatus]:
        """Return pods, across all namespaces or one."""
        core = await self._core()
        try:
            result = (
                await core.list_pod_for_all_namespaces()
                if namespace == "all"
                else await core.list_namespaced_pod(namespace)
            )
        except Exception as exc:
            raise UpstreamError("k8s", f"list_pod failed: {exc}") from exc

        pods: list[PodStatus] = []
        for item in result.items:
            statuses = item.status.container_statuses or []
            ready = sum(1 for c in statuses if c.ready)
            restarts = sum(c.restart_count or 0 for c in statuses)
            reason = item.status.reason or ""
            for c in statuses:
                waiting = getattr(c.state, "waiting", None) if c.state else None
                if waiting and waiting.reason:
                    reason = waiting.reason
                    break
            pods.append(
                PodStatus(
                    namespace=item.metadata.namespace,
                    name=item.metadata.name,
                    phase=item.status.phase or "Unknown",
                    ready=f"{ready}/{len(statuses)}",
                    restarts=restarts,
                    reason=reason,
                )
            )
        return pods

    async def unhealthy_pods(self) -> list[PodStatus]:
        """Pods that are not Running-and-fully-ready, which is what the dashboard shows."""
        pods = await self.list_pods("all")
        return [p for p in pods if p.phase in _UNHEALTHY_PHASES or (p.ready and p.ready.split("/")[0] == "0")]

    async def pod_logs(self, namespace: str, pod: str, *, tail: int = 100, container: str | None = None) -> str:
        """Return the tail of a pod's log."""
        core = await self._core()
        try:
            text: str = await core.read_namespaced_pod_log(
                name=pod, namespace=namespace, tail_lines=tail, container=container
            )
            return text
        except Exception as exc:
            raise UpstreamError("k8s", f"read log for {namespace}/{pod} failed: {exc}") from exc

    async def list_events(self, namespace: str = "all", *, limit: int = 30) -> list[dict[str, Any]]:
        """Return recent cluster events, newest first."""
        core = await self._core()
        try:
            result = (
                await core.list_event_for_all_namespaces(limit=limit)
                if namespace == "all"
                else await core.list_namespaced_event(namespace, limit=limit)
            )
        except Exception as exc:
            raise UpstreamError("k8s", f"list_event failed: {exc}") from exc

        events = [
            {
                "namespace": e.metadata.namespace,
                "type": e.type or "",
                "reason": e.reason or "",
                "object": f"{e.involved_object.kind}/{e.involved_object.name}" if e.involved_object else "",
                "message": (e.message or "").strip(),
                "count": e.count or 1,
                "at": str(e.last_timestamp or e.event_time or ""),
            }
            for e in result.items
        ]
        return sorted(events, key=lambda e: e["at"], reverse=True)

    async def rollout_status(self, namespace: str, deployment: str) -> dict[str, Any]:
        """Return a deployment's replica counts and current image."""
        apps = await self._apps()
        try:
            dep = await apps.read_namespaced_deployment(name=deployment, namespace=namespace)
        except Exception as exc:
            raise UpstreamError("k8s", f"read deployment {namespace}/{deployment} failed: {exc}") from exc

        status = dep.status
        containers = dep.spec.template.spec.containers or []
        return {
            "name": deployment,
            "namespace": namespace,
            "desired": dep.spec.replicas or 0,
            "updated": status.updated_replicas or 0,
            "ready": status.ready_replicas or 0,
            "available": status.available_replicas or 0,
            "images": [c.image for c in containers],
            "complete": (status.ready_replicas or 0) == (dep.spec.replicas or 0),
        }

    async def aclose(self) -> None:
        """Close the underlying API client."""
        if self._api is not None:
            await self._api.close()
            self._api = None


__all__ = ["K8sClient"]
