"""Offline stand-in for the Kubernetes API.

The fixtures mirror the real lab as described in ``Home-Lab-Infra``: a single k3s
node on the UM790, two app namespaces each running a FastAPI backend and an nginx
SPA, ArgoCD and the Tailscale operator alongside. One pod is deliberately broken
so the unhealthy path, the degraded badge and the console's diagnostics have
something to show.

They are detailed on purpose. The console renders containers, probes, resource
requests, QoS classes and replica set history, and a fixture that stopped at
"Running 1/1" would leave most of the dashboard untestable and undemoable. Ages
are expressed as offsets from now so the tables look alive rather than frozen.

What is *not* faked is metrics: the lab has no metrics-server, so
:meth:`FakeK8sClient.metrics` reports it as missing, exactly as the real cluster
does. The console has a card for that state, and pretending otherwise would hide
it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from jarvis.core.console import (
    ContainerView,
    EventRecord,
    IngressView,
    MetricsView,
    NamespaceSummary,
    NetworkView,
    NodeCondition,
    NodeDetail,
    PodCondition,
    PodDetail,
    Probe,
    ReplicaSetView,
    ServiceView,
    VolumeView,
    WorkloadSummary,
    age_seconds,
)
from jarvis.core.types import NodeStatus, PodStatus

_NOW = datetime.now(timezone.utc)


def _ago(**delta: float) -> datetime:
    return _NOW - timedelta(**delta)


def _probes(port: int, path: str = "/health") -> list[Probe]:
    """The probe pair every app in the lab declares."""
    return [
        Probe(kind="liveness", action=f"GET {path}:{port}", delay=10, period=20, timeout=2, failures=3),
        Probe(kind="readiness", action=f"GET {path}:{port}", delay=3, period=10, timeout=2, failures=3),
    ]


# ============================================================================
# Node
# ============================================================================

_UM790 = NodeDetail(
    name="um790",
    ready=True,
    version="v1.31.4+k3s1",
    roles=["control-plane", "master"],
    os_image="Ubuntu 24.04.1 LTS",
    kernel="6.8.0-45-generic",
    runtime="containerd://1.7.22-k3s1",
    architecture="amd64",
    internal_ip="192.168.1.40",
    capacity={"cpu": "16", "memory": "32518124Ki", "pods": "110", "ephemeral-storage": "1921724416Ki"},
    allocatable={"cpu": "16", "memory": "32518124Ki", "pods": "110", "ephemeral-storage": "1869713181"},
    allocatable_cpu_milli=16_000,
    allocatable_memory_bytes=32518124 * 1024,
    pods_capacity=110,
    conditions=[
        NodeCondition(type="MemoryPressure", status="False", reason="KubeletHasSufficientMemory"),
        NodeCondition(type="DiskPressure", status="False", reason="KubeletHasNoDiskPressure"),
        NodeCondition(type="PIDPressure", status="False", reason="KubeletHasSufficientPID"),
        NodeCondition(type="Ready", status="True", reason="KubeletReady"),
    ],
    taints=[],
    created_at=_ago(days=96),
)


# ============================================================================
# Pods
# ============================================================================


def _pod(
    namespace: str,
    name: str,
    *,
    containers: list[ContainerView],
    phase: str = "Running",
    reason: str = "",
    message: str = "",
    owner: str = "",
    age_hours: float = 72.0,
    ip: str = "10.42.0.20",
    qos: str = "Burstable",
    volumes: list[VolumeView] | None = None,
) -> PodDetail:
    created = _ago(hours=age_hours)
    ready = sum(1 for c in containers if c.ready)
    conditions = [
        PodCondition(type="Initialized", status="True", at=created),
        PodCondition(
            type="Ready",
            status="True" if ready == len(containers) else "False",
            reason="" if ready == len(containers) else "ContainersNotReady",
            message="" if ready == len(containers) else f"containers with unready status: [{containers[0].name}]",
            at=created,
        ),
        PodCondition(type="ContainersReady", status="True" if ready == len(containers) else "False", at=created),
        PodCondition(type="PodScheduled", status="True", at=created),
    ]
    return PodDetail(
        namespace=namespace,
        name=name,
        phase=phase,
        ready=f"{ready}/{len(containers)}",
        restarts=sum(c.restarts for c in containers),
        reason=reason,
        message=message,
        node="um790",
        pod_ip=ip,
        host_ip="192.168.1.40",
        qos=qos,
        service_account="default",
        owner=owner,
        created_at=created,
        age=age_seconds(created),
        labels={"app": name.rsplit("-", 2)[0]},
        containers=containers,
        conditions=conditions,
        volumes=volumes or [],
    )


def _app_container(
    name: str,
    image: str,
    port: int,
    *,
    ready: bool = True,
    restarts: int = 0,
    cpu_request: str = "50m",
    memory_request: str = "128Mi",
    memory_limit: str = "512Mi",
    state: str = "running",
    reason: str = "",
    message: str = "",
    last_exit_code: int | None = None,
    last_reason: str = "",
    env: list[str] | None = None,
) -> ContainerView:
    return ContainerView(
        name=name,
        image=image,
        image_id=f"ghcr.io/{image.split('/', 1)[-1].split(':')[0]}@sha256:9c1f{abs(hash(image)) % 10**8:08d}",
        ready=ready,
        started=state == "running",
        restarts=restarts,
        state=state,  # type: ignore[arg-type]
        reason=reason,
        message=message,
        state_since=_ago(hours=72) if state == "running" else None,
        last_exit_code=last_exit_code,
        last_reason=last_reason,
        last_finished_at=_ago(minutes=12) if last_reason else None,
        ports=[f"{port}/TCP http"],
        requests={"cpu": cpu_request, "memory": memory_request},
        limits={"memory": memory_limit},
        probes=_probes(port),
        env_names=env or [],
        mounts=["kube-api-access → /var/run/secrets/kubernetes.io/serviceaccount (ro)"],
    )


_PODS: list[PodDetail] = [
    _pod(
        "argocd",
        "argocd-server-6d4f9c7b8-mn2xq",
        owner="ReplicaSet/argocd-server-6d4f9c7b8",
        age_hours=2160,
        ip="10.42.0.11",
        containers=[
            _app_container("argocd-server", "quay.io/argoproj/argocd:v2.13.2", 8080, cpu_request="100m")
        ],
    ),
    _pod(
        "argocd",
        "argocd-repo-server-7c8b5d94-vk9rt",
        owner="ReplicaSet/argocd-repo-server-7c8b5d94",
        age_hours=2160,
        ip="10.42.0.12",
        containers=[
            _app_container("argocd-repo-server", "quay.io/argoproj/argocd:v2.13.2", 8081, cpu_request="100m")
        ],
    ),
    _pod(
        "argocd",
        "argocd-application-controller-0",
        owner="StatefulSet/argocd-application-controller",
        age_hours=2160,
        ip="10.42.0.13",
        containers=[
            _app_container(
                "argocd-application-controller",
                "quay.io/argoproj/argocd:v2.13.2",
                8082,
                cpu_request="250m",
                memory_request="512Mi",
                memory_limit="2Gi",
            )
        ],
    ),
    _pod(
        "tailscale",
        "operator-59d8f4c66-hq4wl",
        owner="ReplicaSet/operator-59d8f4c66",
        age_hours=1900,
        ip="10.42.0.8",
        containers=[_app_container("operator", "tailscale/k8s-operator:v1.76.1", 9100, cpu_request="20m")],
    ),
    _pod(
        "kube-system",
        "coredns-7b98449c4-4xqjz",
        owner="ReplicaSet/coredns-7b98449c4",
        age_hours=2300,
        ip="10.42.0.3",
        qos="Burstable",
        containers=[_app_container("coredns", "rancher/mirrored-coredns-coredns:1.12.0", 9153, cpu_request="100m")],
    ),
    _pod(
        "sealed-secrets",
        "sealed-secrets-controller-6f7bd4c89-p2lmn",
        owner="ReplicaSet/sealed-secrets-controller-6f7bd4c89",
        age_hours=2200,
        ip="10.42.0.6",
        containers=[
            _app_container("sealed-secrets", "bitnami/sealed-secrets-controller:0.27.1", 8080, cpu_request="20m")
        ],
    ),
    _pod(
        "trip-ai",
        "trip-ai-backend-7d9c8f5b4-2xk9p",
        owner="ReplicaSet/trip-ai-backend-7d9c8f5b4",
        age_hours=620,
        ip="10.42.0.21",
        containers=[
            _app_container(
                "backend",
                "ghcr.io/gmottola00/trip-ai-backend:ada2faf9b9ed076927b2c26c0a6d54a6826f3ecd",
                8000,
                env=["SUPABASE_URL", "SUPABASE_KEY", "ANTHROPIC_API_KEY", "LOG_LEVEL"],
            )
        ],
        volumes=[VolumeView(name="trip-ai-secrets", kind="secret", source="trip-ai-secrets")],
    ),
    _pod(
        "trip-ai",
        "trip-ai-web-6b8d7c9f5-lm4rt",
        owner="ReplicaSet/trip-ai-web-6b8d7c9f5",
        age_hours=620,
        ip="10.42.0.22",
        containers=[
            _app_container(
                "web",
                "ghcr.io/gmottola00/trip-ai-web:438f84423e503baa36539934518e08d270dfb7cc",
                80,
                cpu_request="10m",
                memory_request="32Mi",
                memory_limit="128Mi",
            )
        ],
    ),
    _pod(
        "tickup",
        "tickup-backend-5f7c8d9b6-qw3rt",
        owner="ReplicaSet/tickup-backend-5f7c8d9b6",
        age_hours=48,
        ip="10.42.0.31",
        containers=[
            _app_container(
                "backend",
                "ghcr.io/gmottola00/tickup-backend:c64b4218a7e91f3d5b8c02a4e6f7d9130ab5c2e8",
                8000,
                restarts=2,
                last_exit_code=137,
                last_reason="OOMKilled",
                env=["SUPABASE_URL", "SUPABASE_KEY", "LOG_LEVEL"],
            )
        ],
        volumes=[VolumeView(name="tickup-secrets", kind="secret", source="tickup-secrets")],
    ),
    _pod(
        "tickup",
        "tickup-web-8c9d7f6b5-zx8vn",
        owner="ReplicaSet/tickup-web-8c9d7f6b5",
        phase="Pending",
        reason="ImagePullBackOff",
        message='Back-off pulling image "ghcr.io/gmottola00/tickup-web:4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27"',
        age_hours=1.4,
        ip="",
        containers=[
            _app_container(
                "web",
                "ghcr.io/gmottola00/tickup-web:4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27",
                80,
                ready=False,
                restarts=4,
                state="waiting",
                reason="ImagePullBackOff",
                message='Back-off pulling image "ghcr.io/gmottola00/tickup-web:4f5e7497"',
                cpu_request="10m",
                memory_request="32Mi",
                memory_limit="128Mi",
            )
        ],
    ),
]


# ============================================================================
# Workloads
# ============================================================================


def _deployment(
    namespace: str, name: str, images: list[str], *, ready: int = 1, desired: int = 1, age_hours: float = 620
) -> WorkloadSummary:
    created = _ago(hours=age_hours)
    return WorkloadSummary(
        kind="Deployment",
        namespace=namespace,
        name=name,
        desired=desired,
        ready=ready,
        updated=desired,
        available=ready,
        images=images,
        strategy="RollingUpdate maxSurge=25% maxUnavailable=25%",
        selector={"app": name},
        labels={"app": name},
        created_at=created,
        age=age_seconds(created),
        conditions=[
            PodCondition(
                type="Available",
                status="True" if ready >= desired else "False",
                reason="MinimumReplicasAvailable" if ready >= desired else "MinimumReplicasUnavailable",
                at=created,
            ),
            PodCondition(
                type="Progressing",
                status="True" if ready >= desired else "False",
                reason="NewReplicaSetAvailable" if ready >= desired else "ProgressDeadlineExceeded",
                message="" if ready >= desired else f'ReplicaSet "{name}-8c9d7f6b5" has timed out progressing.',
                at=created,
            ),
        ],
        generation=4,
        observed_generation=4,
    )


_WORKLOADS: list[WorkloadSummary] = [
    _deployment("argocd", "argocd-server", ["quay.io/argoproj/argocd:v2.13.2"], age_hours=2160),
    _deployment("argocd", "argocd-repo-server", ["quay.io/argoproj/argocd:v2.13.2"], age_hours=2160),
    WorkloadSummary(
        kind="StatefulSet",
        namespace="argocd",
        name="argocd-application-controller",
        desired=1,
        ready=1,
        updated=1,
        available=1,
        images=["quay.io/argoproj/argocd:v2.13.2"],
        strategy="RollingUpdate partition=0",
        selector={"app.kubernetes.io/name": "argocd-application-controller"},
        created_at=_ago(hours=2160),
        age=age_seconds(_ago(hours=2160)),
        generation=1,
        observed_generation=1,
    ),
    _deployment("tailscale", "operator", ["tailscale/k8s-operator:v1.76.1"], age_hours=1900),
    _deployment("kube-system", "coredns", ["rancher/mirrored-coredns-coredns:1.12.0"], age_hours=2300),
    WorkloadSummary(
        kind="DaemonSet",
        namespace="kube-system",
        name="svclb-traefik",
        desired=0,
        ready=0,
        updated=0,
        available=0,
        images=["rancher/klipper-lb:v0.4.9"],
        strategy="RollingUpdate maxUnavailable=1",
        selector={"app": "svclb-traefik"},
        created_at=_ago(hours=2300),
        age=age_seconds(_ago(hours=2300)),
        generation=1,
        observed_generation=1,
    ),
    _deployment(
        "sealed-secrets",
        "sealed-secrets-controller",
        ["bitnami/sealed-secrets-controller:0.27.1"],
        age_hours=2200,
    ),
    _deployment(
        "trip-ai",
        "trip-ai-backend",
        ["ghcr.io/gmottola00/trip-ai-backend:ada2faf9b9ed076927b2c26c0a6d54a6826f3ecd"],
    ),
    _deployment(
        "trip-ai", "trip-ai-web", ["ghcr.io/gmottola00/trip-ai-web:438f84423e503baa36539934518e08d270dfb7cc"]
    ),
    _deployment(
        "tickup",
        "tickup-backend",
        ["ghcr.io/gmottola00/tickup-backend:c64b4218a7e91f3d5b8c02a4e6f7d9130ab5c2e8"],
        age_hours=48,
    ),
    _deployment(
        "tickup",
        "tickup-web",
        ["ghcr.io/gmottola00/tickup-web:4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27"],
        ready=0,
        age_hours=48,
    ),
]

_REPLICA_SETS: dict[str, list[ReplicaSetView]] = {
    "tickup-web": [
        ReplicaSetView(
            name="tickup-web-8c9d7f6b5",
            namespace="tickup",
            revision="4",
            desired=1,
            ready=0,
            images=["ghcr.io/gmottola00/tickup-web:4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27"],
            created_at=_ago(hours=1.4),
            age=age_seconds(_ago(hours=1.4)),
            current=True,
        ),
        ReplicaSetView(
            name="tickup-web-5d7b9c8f4",
            namespace="tickup",
            revision="3",
            desired=0,
            ready=0,
            images=["ghcr.io/gmottola00/tickup-web:c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a"],
            created_at=_ago(hours=48),
            age=age_seconds(_ago(hours=48)),
        ),
    ],
    "tickup-backend": [
        ReplicaSetView(
            name="tickup-backend-5f7c8d9b6",
            namespace="tickup",
            revision="2",
            desired=1,
            ready=1,
            images=["ghcr.io/gmottola00/tickup-backend:c64b4218a7e91f3d5b8c02a4e6f7d9130ab5c2e8"],
            created_at=_ago(hours=48),
            age=age_seconds(_ago(hours=48)),
            current=True,
        )
    ],
}


# ============================================================================
# Namespaces and networking
# ============================================================================

_NAMESPACE_AGES = {
    "argocd": 2160,
    "default": 2300,
    "kube-system": 2300,
    "sealed-secrets": 2200,
    "tailscale": 1900,
    "tickup": 700,
    "trip-ai": 900,
}


def _service(namespace: str, name: str, port: int, target: int, *, endpoints: list[str]) -> ServiceView:
    return ServiceView(
        namespace=namespace,
        name=name,
        type="ClusterIP",
        cluster_ip=f"10.43.{abs(hash(name)) % 250}.{abs(hash(name + name)) % 250}",
        ports=[f"{port}→{target}/TCP"],
        selector={"app": name},
        endpoints=endpoints,
        age=age_seconds(_ago(hours=620)),
    )


_SERVICES = [
    _service("trip-ai", "trip-ai-backend", 8000, 8000, endpoints=["10.42.0.21"]),
    _service("trip-ai", "trip-ai-web", 80, 80, endpoints=["10.42.0.22"]),
    _service("tickup", "tickup-backend", 8000, 8000, endpoints=["10.42.0.31"]),
    _service("tickup", "tickup-web", 80, 80, endpoints=[]),
    _service("argocd", "argocd-server", 80, 8080, endpoints=["10.42.0.11"]),
    _service("kube-system", "kube-dns", 53, 53, endpoints=["10.42.0.3"]),
]

_INGRESSES = [
    IngressView(
        namespace="trip-ai",
        name="trip-ai",
        class_name="tailscale",
        hosts=["trip-ai"],
        rules=["trip-ai/api → trip-ai-backend:8000", "trip-ai/ → trip-ai-web:80"],
        tls_hosts=["trip-ai"],
        address="trip-ai.tail9c2f1.ts.net",
        age=age_seconds(_ago(hours=620)),
    ),
    IngressView(
        namespace="tickup",
        name="tickup",
        class_name="tailscale",
        hosts=["tickup"],
        rules=["tickup/api → tickup-backend:8000", "tickup/ → tickup-web:80"],
        tls_hosts=["tickup"],
        address="tickup.tail9c2f1.ts.net",
        age=age_seconds(_ago(hours=700)),
    ),
    IngressView(
        namespace="argocd",
        name="argocd-server",
        class_name="tailscale",
        hosts=["argocd"],
        rules=["argocd/ → argocd-server:80"],
        tls_hosts=["argocd"],
        address="argocd.tail9c2f1.ts.net",
        age=age_seconds(_ago(hours=2160)),
    ),
]


# ============================================================================
# Events and logs
# ============================================================================


def _event(namespace: str, type_: str, reason: str, obj: str, message: str, *, minutes: float, count: int = 1) -> EventRecord:
    at = _ago(minutes=minutes)
    return EventRecord(
        namespace=namespace,
        type=type_,
        reason=reason,
        object=obj,
        message=message,
        count=count,
        at=at.isoformat(),
        first_at=_ago(minutes=minutes + count * 2).isoformat(),
        source="kubelet" if type_ == "Warning" else "deployment-controller",
    )


_EVENTS = [
    _event(
        "tickup",
        "Warning",
        "Failed",
        "Pod/tickup-web-8c9d7f6b5-zx8vn",
        'Failed to pull image "ghcr.io/gmottola00/tickup-web:4f5e7497": unauthorized',
        minutes=3,
        count=9,
    ),
    _event(
        "tickup",
        "Normal",
        "Pulling",
        "Pod/tickup-web-8c9d7f6b5-zx8vn",
        'Pulling image "ghcr.io/gmottola00/tickup-web:4f5e7497"',
        minutes=4,
        count=9,
    ),
    _event(
        "tickup",
        "Warning",
        "BackOff",
        "Pod/tickup-web-8c9d7f6b5-zx8vn",
        "Back-off pulling image",
        minutes=5,
        count=9,
    ),
    _event(
        "tickup",
        "Warning",
        "OOMKilled",
        "Pod/tickup-backend-5f7c8d9b6-qw3rt",
        "Container backend exceeded its memory limit of 512Mi and was killed",
        minutes=12,
        count=2,
    ),
    _event(
        "tickup",
        "Normal",
        "ScalingReplicaSet",
        "Deployment/tickup-web",
        "Scaled up replica set tickup-web-8c9d7f6b5 to 1",
        minutes=84,
    ),
    _event(
        "trip-ai",
        "Normal",
        "ScalingReplicaSet",
        "Deployment/trip-ai-web",
        "Scaled up replica set trip-ai-web-6b8d7c9f5 to 1",
        minutes=37_200,
    ),
]

_LOG = """INFO:     Started server process [1]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     10.42.0.31:54122 - "GET /health HTTP/1.1" 200 OK
INFO:     10.42.0.31:54130 - "GET /api/leagues HTTP/1.1" 200 OK
"""

_FOLLOW = [
    'INFO:     10.42.0.1:51844 - "GET /health HTTP/1.1" 200 OK',
    'INFO:     10.42.0.1:51850 - "GET /api/leagues HTTP/1.1" 200 OK',
    "INFO:     cache hit ratio 0.82 over last 1000 requests",
    'WARNING:  slow query: SELECT * FROM matches took 1.9s',
    'INFO:     10.42.0.1:51862 - "POST /api/predictions HTTP/1.1" 201 Created',
]


class FakeK8sClient:
    """Serves the fixtures above. Same surface as :class:`K8sClient`."""

    # --- the agent's view ----------------------------------------------------

    async def list_nodes(self) -> list[NodeStatus]:
        return [NodeStatus(name=_UM790.name, ready=_UM790.ready, version=_UM790.version, roles=_UM790.roles)]

    async def list_pods(self, namespace: str = "all") -> list[PodStatus]:
        return [
            PodStatus(
                namespace=p.namespace,
                name=p.name,
                phase=p.phase,
                ready=p.ready,
                restarts=p.restarts,
                reason=p.reason,
            )
            for p in _PODS
            if namespace == "all" or p.namespace == namespace
        ]

    async def unhealthy_pods(self) -> list[PodStatus]:
        broken = {p.name for p in _PODS if not p.healthy}
        return [p for p in await self.list_pods("all") if p.name in broken]

    async def pod_logs(self, namespace: str, pod: str, *, tail: int = 100, container: str | None = None) -> str:
        return "\n".join(_LOG.splitlines()[-tail:])

    async def list_events(self, namespace: str = "all", *, limit: int = 30) -> list[dict[str, Any]]:
        return [
            e.model_dump(mode="json", include={"namespace", "type", "reason", "object", "message", "count", "at"})
            for e in _EVENTS
            if namespace == "all" or e.namespace == namespace
        ][:limit]

    async def rollout_status(self, namespace: str, deployment: str) -> dict[str, Any]:
        match = next((w for w in _WORKLOADS if w.namespace == namespace and w.name == deployment), None)
        if match is None:
            return {
                "name": deployment,
                "namespace": namespace,
                "desired": 0,
                "updated": 0,
                "ready": 0,
                "available": 0,
                "images": [],
                "complete": False,
            }
        return {
            "name": match.name,
            "namespace": match.namespace,
            "desired": match.desired,
            "updated": match.updated,
            "ready": match.ready,
            "available": match.available,
            "images": match.images,
            "complete": match.complete,
        }

    # --- the console's view --------------------------------------------------

    async def namespaces(self, *, pods: list[PodDetail] | None = None) -> list[NamespaceSummary]:
        known = pods if pods is not None else _PODS
        summaries = []
        for name, hours in _NAMESPACE_AGES.items():
            mine = [p for p in known if p.namespace == name]
            created = _ago(hours=hours)
            summaries.append(
                NamespaceSummary(
                    name=name,
                    phase="Active",
                    pods_total=len(mine),
                    pods_ready=sum(1 for p in mine if p.healthy),
                    workloads=sum(1 for w in _WORKLOADS if w.namespace == name),
                    created_at=created,
                    age=age_seconds(created),
                    labels={"kubernetes.io/metadata.name": name},
                )
            )
        return summaries

    async def pod_details(self, namespace: str = "all") -> list[PodDetail]:
        return [p for p in _PODS if namespace == "all" or p.namespace == namespace]

    async def pod_detail(self, namespace: str, name: str) -> PodDetail:
        match = next((p for p in _PODS if p.namespace == namespace and p.name == name), None)
        if match is None:
            from jarvis.exceptions import UpstreamError

            raise UpstreamError("k8s", f"pod {namespace}/{name} not found", status=404)
        return match

    async def node_details(self, *, pods: list[PodDetail] | None = None) -> list[NodeDetail]:
        known = pods if pods is not None else _PODS
        node = _UM790.model_copy(deep=True)
        node.pods_running = len(known)
        node.requested_cpu_milli = sum(
            int(c.requests.get("cpu", "0m").rstrip("m") or 0) for p in known for c in p.containers
        )
        node.requested_memory_bytes = sum(
            int(c.requests.get("memory", "0Mi").rstrip("Mi") or 0) * 1024**2 for p in known for c in p.containers
        )
        node.age = age_seconds(node.created_at)
        return [node]

    async def workloads(self, namespace: str = "all") -> list[WorkloadSummary]:
        return [w for w in _WORKLOADS if namespace == "all" or w.namespace == namespace]

    async def replica_sets(self, namespace: str, *, selector: dict[str, str]) -> list[ReplicaSetView]:
        return _REPLICA_SETS.get(selector.get("app", ""), [])

    async def network(self, namespace: str = "all") -> NetworkView:
        return NetworkView(
            services=[s for s in _SERVICES if namespace == "all" or s.namespace == namespace],
            ingresses=[i for i in _INGRESSES if namespace == "all" or i.namespace == namespace],
        )

    async def events(self, namespace: str = "all", *, limit: int = 100) -> list[EventRecord]:
        return [e for e in _EVENTS if namespace == "all" or e.namespace == namespace][:limit]

    async def manifest(self, kind: str, namespace: str, name: str) -> dict[str, Any]:
        """Return a plausible manifest for the fixture object.

        Built from the fixture rather than stored as a blob, so it stays
        consistent with whatever the tables are showing.
        """
        if kind.lower() == "pod":
            pod = await self.pod_detail(namespace, name)
            return {
                "apiVersion": "v1",
                "kind": "Pod",
                "metadata": {
                    "name": pod.name,
                    "namespace": pod.namespace,
                    "labels": pod.labels,
                    "creationTimestamp": pod.created_at.isoformat() if pod.created_at else None,
                    "ownerReferences": [{"kind": pod.owner.split("/")[0], "name": pod.owner.split("/")[-1]}]
                    if pod.owner
                    else [],
                },
                "spec": {
                    "nodeName": pod.node,
                    "serviceAccountName": pod.service_account,
                    "restartPolicy": pod.restart_policy,
                    "containers": [
                        {
                            "name": c.name,
                            "image": c.image,
                            "ports": [{"containerPort": int(p.split("/")[0])} for p in c.ports],
                            "resources": {"requests": c.requests, "limits": c.limits},
                        }
                        for c in pod.containers
                    ],
                },
                "status": {"phase": pod.phase, "podIP": pod.pod_ip, "qosClass": pod.qos},
            }

        match = next((w for w in _WORKLOADS if w.namespace == namespace and w.name == name), None)
        if match is None:
            from jarvis.exceptions import UpstreamError

            raise UpstreamError("k8s", f"{kind} {namespace}/{name} not found", status=404)
        return {
            "apiVersion": "apps/v1",
            "kind": match.kind,
            "metadata": {"name": match.name, "namespace": match.namespace, "generation": match.generation},
            "spec": {
                "replicas": match.desired,
                "selector": {"matchLabels": match.selector},
                "template": {"spec": {"containers": [{"name": match.name, "image": i} for i in match.images]}},
            },
            "status": {"readyReplicas": match.ready, "availableReplicas": match.available},
        }

    async def metrics(self) -> MetricsView:
        """Report metrics as missing, which is the truth about this lab."""
        return MetricsView(available=False, reason="metrics-server is not installed in this cluster")

    async def follow_logs(
        self, namespace: str, pod: str, *, container: str | None = None, tail: int = 200
    ) -> AsyncIterator[str]:
        """Replay the fixture log, then dribble out new lines on a timer."""
        import asyncio
        import itertools

        for line in _LOG.splitlines()[-tail:]:
            yield line
        for index in itertools.count():
            await asyncio.sleep(2.0)
            yield _FOLLOW[index % len(_FOLLOW)]

    async def aclose(self) -> None:
        return None


__all__ = ["FakeK8sClient"]
