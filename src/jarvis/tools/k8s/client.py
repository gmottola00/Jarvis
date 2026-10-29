"""Kubernetes read access.

Read-only by construction: this client exposes list and get calls and nothing
else. The design rule Jarvis is built around is that it never mutates the
cluster — changes go through Git and ArgoCD reconciles them — so there is
deliberately no ``apply``, ``patch``, ``delete`` or ``scale`` here to call.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from jarvis.core.console import (
    EventRecord,
    MetricsView,
    NamespaceSummary,
    NetworkView,
    NodeDetail,
    PodDetail,
    ReplicaSetView,
    ResourceUsage,
    WorkloadSummary,
)
from jarvis.core.types import NodeStatus, PodStatus
from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.settings import Settings
from jarvis.tools.k8s.convert import (
    sanitize_manifest,
    to_ingress,
    to_namespace,
    to_node_detail,
    to_pod_detail,
    to_replica_set,
    to_service,
    to_workload,
)
from jarvis.tools.k8s.quantity import parse_cpu, parse_memory

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

    # ========================================================================
    # Console reads
    #
    # Richer than the agent's view and used only by ``/api/k8s/*``. Still
    # read-only: list, get, watch logs, nothing else.
    # ========================================================================

    async def namespaces(self, *, pods: list[PodDetail] | None = None) -> list[NamespaceSummary]:
        """List namespaces with their pod counts."""
        core = await self._core()
        try:
            result = await core.list_namespace()
        except Exception as exc:
            raise UpstreamError("k8s", f"list_namespace failed: {exc}") from exc
        return sorted((to_namespace(item, pods=pods) for item in result.items), key=lambda n: n.name)

    async def pod_details(self, namespace: str = "all") -> list[PodDetail]:
        """Every pod, fully described. The console's workhorse call."""
        core = await self._core()
        try:
            result = (
                await core.list_pod_for_all_namespaces()
                if namespace == "all"
                else await core.list_namespaced_pod(namespace)
            )
        except Exception as exc:
            raise UpstreamError("k8s", f"list_pod failed: {exc}") from exc
        return [to_pod_detail(item) for item in result.items]

    async def pod_detail(self, namespace: str, name: str) -> PodDetail:
        """One pod, fully described."""
        core = await self._core()
        try:
            return to_pod_detail(await core.read_namespaced_pod(name=name, namespace=namespace))
        except Exception as exc:
            raise UpstreamError("k8s", f"read pod {namespace}/{name} failed: {exc}") from exc

    async def node_details(self, *, pods: list[PodDetail] | None = None) -> list[NodeDetail]:
        """Nodes with capacity, conditions, taints and the requests already on them.

        Args:
            pods: Pods already fetched. Passing them in is what makes the
                "how full is this node" number free.
        """
        core = await self._core()
        try:
            result = await core.list_node()
        except Exception as exc:
            raise UpstreamError("k8s", f"list_node failed: {exc}") from exc
        return [to_node_detail(item, pods=pods) for item in result.items]

    async def workloads(self, namespace: str = "all") -> list[WorkloadSummary]:
        """Deployments, StatefulSets and DaemonSets, fetched concurrently."""
        apps = await self._apps()
        everywhere = namespace == "all"

        async def fetch(kind: str, plural: str) -> list[WorkloadSummary]:
            call = getattr(apps, f"list_{plural}_for_all_namespaces" if everywhere else f"list_namespaced_{plural}")
            result = await (call() if everywhere else call(namespace))
            return [to_workload(item, kind) for item in result.items]

        try:
            async with asyncio.TaskGroup() as group:
                tasks = [
                    group.create_task(fetch(kind, plural))
                    for kind, plural in (
                        ("Deployment", "deployment"),
                        ("StatefulSet", "stateful_set"),
                        ("DaemonSet", "daemon_set"),
                    )
                ]
        except* Exception as group_error:
            raise UpstreamError("k8s", f"list workloads failed: {group_error.exceptions[0]}") from group_error

        return sorted((w for task in tasks for w in task.result()), key=lambda w: (w.namespace, w.kind, w.name))

    async def replica_sets(self, namespace: str, *, selector: dict[str, str]) -> list[ReplicaSetView]:
        """ReplicaSets matching a Deployment's selector — its rollout history."""
        apps = await self._apps()
        label_selector = ",".join(f"{k}={v}" for k, v in selector.items())
        try:
            result = await apps.list_namespaced_replica_set(namespace, label_selector=label_selector or None)
        except Exception as exc:
            raise UpstreamError("k8s", f"list replicasets in {namespace} failed: {exc}") from exc

        views = [to_replica_set(item) for item in result.items]
        newest = max((v.revision for v in views if v.revision.isdigit()), key=int, default="")
        for view in views:
            view.current = bool(newest) and view.revision == newest
        return sorted(views, key=lambda v: int(v.revision) if v.revision.isdigit() else 0, reverse=True)

    async def network(self, namespace: str = "all") -> NetworkView:
        """Services and ingresses, with the endpoints currently behind each service."""
        core = await self._core()
        from kubernetes_asyncio import client as k8s_client

        networking = k8s_client.NetworkingV1Api(self._api)
        everywhere = namespace == "all"

        async def services() -> Any:
            return await (
                core.list_service_for_all_namespaces() if everywhere else core.list_namespaced_service(namespace)
            )

        async def endpoints() -> Any:
            return await (
                core.list_endpoints_for_all_namespaces() if everywhere else core.list_namespaced_endpoints(namespace)
            )

        async def ingresses() -> Any:
            return await (
                networking.list_ingress_for_all_namespaces()
                if everywhere
                else networking.list_namespaced_ingress(namespace)
            )

        try:
            async with asyncio.TaskGroup() as group:
                service_task = group.create_task(services())
                endpoint_task = group.create_task(endpoints())
                ingress_task = group.create_task(ingresses())
        except* Exception as group_error:
            raise UpstreamError("k8s", f"list network objects failed: {group_error.exceptions[0]}") from group_error

        behind: dict[tuple[str, str], list[str]] = {}
        for endpoint in endpoint_task.result().items:
            key = (endpoint.metadata.namespace, endpoint.metadata.name)
            behind[key] = [
                address.ip
                for subset in (endpoint.subsets or [])
                for address in (subset.addresses or [])
                if getattr(address, "ip", None)
            ]

        return NetworkView(
            services=[
                to_service(item, endpoints=behind.get((item.metadata.namespace, item.metadata.name), []))
                for item in service_task.result().items
            ],
            ingresses=[to_ingress(item) for item in ingress_task.result().items],
        )

    async def events(self, namespace: str = "all", *, limit: int = 100) -> list[EventRecord]:
        """Recent events as records rather than dicts, newest first."""
        return [EventRecord(**event) for event in await self.list_events(namespace, limit=limit)]

    async def manifest(self, kind: str, namespace: str, name: str) -> dict[str, Any]:
        """Return one object's live manifest, sanitized.

        Reading the YAML the API server actually holds — defaults filled in,
        status attached, ``ownerReferences`` and all — next to the handful of
        lines that were committed to Git is the fastest way to learn what
        Kubernetes does with a manifest after you hand it over.
        """
        core = await self._core()
        from kubernetes_asyncio import client as k8s_client

        readers = {
            "pod": (core, "read_namespaced_pod"),
            "service": (core, "read_namespaced_service"),
            "configmap": (core, "read_namespaced_config_map"),
            "secret": (core, "read_namespaced_secret"),
            "node": (core, "read_node"),
            "namespace": (core, "read_namespace"),
            "deployment": (k8s_client.AppsV1Api(self._api), "read_namespaced_deployment"),
            "statefulset": (k8s_client.AppsV1Api(self._api), "read_namespaced_stateful_set"),
            "daemonset": (k8s_client.AppsV1Api(self._api), "read_namespaced_daemon_set"),
            "replicaset": (k8s_client.AppsV1Api(self._api), "read_namespaced_replica_set"),
            "ingress": (k8s_client.NetworkingV1Api(self._api), "read_namespaced_ingress"),
        }
        target = readers.get(kind.lower())
        if target is None:
            raise UpstreamError("k8s", f"no reader for kind {kind!r}")

        api, method = target
        try:
            obj = await (
                getattr(api, method)(name=name)
                if kind.lower() in ("node", "namespace")
                else getattr(api, method)(name=name, namespace=namespace)
            )
        except Exception as exc:
            raise UpstreamError("k8s", f"read {kind} {namespace}/{name} failed: {exc}") from exc

        raw: dict[str, Any] = self._api.sanitize_for_serialization(obj)
        return sanitize_manifest(raw)

    async def metrics(self) -> MetricsView:
        """Live CPU and memory from ``metrics.k8s.io``, if it is installed.

        The lab has no metrics-server today, so this is written to come back
        with a reason rather than an error — an absent API is a state to render,
        not a failure.
        """
        await self._core()
        from kubernetes_asyncio import client as k8s_client

        custom = k8s_client.CustomObjectsApi(self._api)

        async def sample(plural: str) -> list[dict[str, Any]]:
            payload = await custom.list_cluster_custom_object("metrics.k8s.io", "v1beta1", plural)
            items: list[dict[str, Any]] = payload.get("items") or []
            return items

        unavailable = ""
        try:
            async with asyncio.TaskGroup() as group:
                node_task = group.create_task(sample("nodes"))
                pod_task = group.create_task(sample("pods"))
        except* Exception as group_error:
            failure = str(group_error.exceptions[0])
            unavailable = (
                "metrics-server is not installed in this cluster"
                if "404" in failure or "NotFound" in failure
                else failure
            )

        if unavailable:
            logger.info("k8s.metrics_unavailable", reason=unavailable)
            return MetricsView(available=False, reason=unavailable[:200])

        nodes = [
            ResourceUsage(
                name=item["metadata"]["name"],
                cpu_milli=parse_cpu(item.get("usage", {}).get("cpu")),
                memory_bytes=parse_memory(item.get("usage", {}).get("memory")),
            )
            for item in node_task.result()
        ]
        pods = [
            ResourceUsage(
                name=item["metadata"]["name"],
                namespace=item["metadata"].get("namespace", ""),
                cpu_milli=sum(parse_cpu(c.get("usage", {}).get("cpu")) for c in item.get("containers") or []),
                memory_bytes=sum(parse_memory(c.get("usage", {}).get("memory")) for c in item.get("containers") or []),
            )
            for item in pod_task.result()
        ]
        return MetricsView(available=True, nodes=nodes, pods=pods)

    async def follow_logs(
        self, namespace: str, pod: str, *, container: str | None = None, tail: int = 200
    ) -> AsyncIterator[str]:
        """Yield log lines as the kubelet produces them, until the caller stops.

        ``_preload_content=False`` is the part that matters: without it the
        client buffers the whole response, which for ``follow=True`` means
        waiting for the container to exit.
        """
        core = await self._core()
        try:
            response = await core.read_namespaced_pod_log(
                name=pod,
                namespace=namespace,
                container=container,
                tail_lines=tail,
                follow=True,
                _preload_content=False,
            )
        except Exception as exc:
            raise UpstreamError("k8s", f"follow logs for {namespace}/{pod} failed: {exc}") from exc

        try:
            async for chunk in response.content:
                text = chunk.decode("utf-8", errors="replace").rstrip("\n")
                if text:
                    yield text
        finally:
            response.release()

    async def aclose(self) -> None:
        """Close the underlying API client."""
        if self._api is not None:
            await self._api.close()
            self._api = None


__all__ = ["K8sClient"]
