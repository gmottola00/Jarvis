"""Kubernetes API objects to console read models.

Pure functions, no I/O, no client: everything here takes an object the way
``kubernetes-asyncio`` deserialises it and returns a model from
``jarvis.core.console``. Keeping the mapping out of the client is what makes it
testable without a cluster, and the mapping is where all the subtlety lives —
merging ``spec.containers`` with ``status.containerStatuses`` by name, deriving
QoS, reading the reason a container died out of its *previous* state.

Every accessor is defensive. A field that is optional in the API is optional
here, and a partially-populated object must degrade to a partially-populated
row rather than raise: the console's job is to show you a broken cluster, which
is precisely when objects are missing fields.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.console import (
    ContainerView,
    EventRecord,
    IngressView,
    NamespaceSummary,
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
from jarvis.tools.k8s.quantity import parse_cpu, parse_memory, qos_class

_PROBE_FIELDS = (("liveness", "liveness_probe"), ("readiness", "readiness_probe"), ("startup", "startup_probe"))

_VOLUME_KINDS = (
    "config_map",
    "secret",
    "empty_dir",
    "persistent_volume_claim",
    "host_path",
    "projected",
    "downward_api",
    "nfs",
    "csi",
)

_NOISY_ANNOTATIONS = (
    "kubectl.kubernetes.io/last-applied-configuration",
    "kubernetes.io/config.hash",
    "kubernetes.io/config.seen",
)


def _get(obj: Any, *path: str, default: Any = None) -> Any:
    """Walk a dotted path of attributes, returning ``default`` at the first None."""
    current = obj
    for name in path:
        if current is None:
            return default
        current = getattr(current, name, None)
    return default if current is None else current


def _name_of(obj: Any) -> str:
    return str(_get(obj, "metadata", "name", default=""))


def _created(obj: Any) -> Any:
    return _get(obj, "metadata", "creation_timestamp")


def _labels(obj: Any) -> dict[str, str]:
    return dict(_get(obj, "metadata", "labels", default={}) or {})


# ============================================================================
# Containers
# ============================================================================


def to_probe(kind: str, probe: Any) -> Probe | None:
    """Flatten a ``V1Probe`` into something renderable, or None when unset."""
    if probe is None:
        return None

    if (http := getattr(probe, "http_get", None)) is not None:
        action = f"GET {getattr(http, 'path', '/') or '/'}:{getattr(http, 'port', '')}"
    elif (tcp := getattr(probe, "tcp_socket", None)) is not None:
        action = f"tcp:{getattr(tcp, 'port', '')}"
    elif (command := getattr(probe, "_exec", None) or getattr(probe, "exec", None)) is not None:
        action = "exec " + " ".join(getattr(command, "command", None) or [])
    elif getattr(probe, "grpc", None) is not None:
        action = f"grpc:{_get(probe, 'grpc', 'port', default='')}"
    else:
        action = "?"

    return Probe(
        kind=kind,  # type: ignore[arg-type]
        action=action,
        delay=int(getattr(probe, "initial_delay_seconds", 0) or 0),
        period=int(getattr(probe, "period_seconds", 10) or 10),
        timeout=int(getattr(probe, "timeout_seconds", 1) or 1),
        failures=int(getattr(probe, "failure_threshold", 3) or 3),
    )


def _container_state(status: Any) -> tuple[str, str, str, Any]:
    """Return ``(state, reason, message, since)`` from a ``V1ContainerState``."""
    state = getattr(status, "state", None)
    if state is None:
        return "unknown", "", "", None

    if (running := getattr(state, "running", None)) is not None:
        return "running", "", "", getattr(running, "started_at", None)
    if (waiting := getattr(state, "waiting", None)) is not None:
        return "waiting", getattr(waiting, "reason", "") or "", getattr(waiting, "message", "") or "", None
    if (terminated := getattr(state, "terminated", None)) is not None:
        return (
            "terminated",
            getattr(terminated, "reason", "") or "",
            getattr(terminated, "message", "") or "",
            getattr(terminated, "finished_at", None),
        )
    return "unknown", "", "", None


def to_container(spec: Any, status: Any, *, init: bool = False) -> ContainerView:
    """Merge a container's spec and status into one view.

    Args:
        spec: The entry from ``pod.spec.containers``.
        status: The matching entry from ``pod.status.containerStatuses``, or None
            when the pod has not been scheduled yet.
        init: True for init containers, which run to completion before the rest.
    """
    state, reason, message, since = _container_state(status) if status is not None else ("unknown", "", "", None)

    resources = getattr(spec, "resources", None)
    probes = [p for kind, field in _PROBE_FIELDS if (p := to_probe(kind, getattr(spec, field, None))) is not None]

    last = getattr(status, "last_state", None) if status is not None else None
    last_terminated = getattr(last, "terminated", None) if last is not None else None

    return ContainerView(
        name=getattr(spec, "name", "") or getattr(status, "name", "") or "?",
        image=getattr(spec, "image", "") or "",
        image_id=(getattr(status, "image_id", "") or "") if status is not None else "",
        init=init,
        ready=bool(getattr(status, "ready", False)) if status is not None else False,
        started=bool(getattr(status, "started", False)) if status is not None else False,
        restarts=int(getattr(status, "restart_count", 0) or 0) if status is not None else 0,
        state=state,  # type: ignore[arg-type]
        reason=reason,
        message=message.strip()[:500],
        state_since=since,
        last_exit_code=getattr(last_terminated, "exit_code", None) if last_terminated is not None else None,
        last_reason=(getattr(last_terminated, "reason", "") or "") if last_terminated is not None else "",
        last_finished_at=getattr(last_terminated, "finished_at", None) if last_terminated is not None else None,
        ports=[
            f"{p.container_port}/{getattr(p, 'protocol', 'TCP') or 'TCP'}"
            + (f" {p.name}" if getattr(p, "name", None) else "")
            for p in (getattr(spec, "ports", None) or [])
        ],
        requests={k: str(v) for k, v in (_get(resources, "requests", default={}) or {}).items()},
        limits={k: str(v) for k, v in (_get(resources, "limits", default={}) or {}).items()},
        probes=probes,
        env_names=[e.name for e in (getattr(spec, "env", None) or []) if getattr(e, "name", None)],
        mounts=[
            f"{m.name} → {m.mount_path}" + (" (ro)" if getattr(m, "read_only", False) else "")
            for m in (getattr(spec, "volume_mounts", None) or [])
        ],
    )


def _volumes(spec: Any) -> list[VolumeView]:
    """Describe a pod's volumes by which of the many union fields is set."""
    views: list[VolumeView] = []
    for volume in getattr(spec, "volumes", None) or []:
        kind, source = "other", ""
        for field in _VOLUME_KINDS:
            value = getattr(volume, field, None)
            if value is not None:
                kind = field.replace("_", "")
                source = (
                    getattr(value, "name", None) or getattr(value, "claim_name", None) or getattr(value, "path", "")
                ) or ""
                break
        views.append(VolumeView(name=getattr(volume, "name", "?"), kind=kind, source=str(source)))
    return views


# ============================================================================
# Pods
# ============================================================================


def to_pod_detail(pod: Any) -> PodDetail:
    """Build the full pod view: ``kubectl describe pod``, as fields."""
    spec, status, metadata = getattr(pod, "spec", None), getattr(pod, "status", None), getattr(pod, "metadata", None)

    statuses = {c.name: c for c in (getattr(status, "container_statuses", None) or [])}
    init_statuses = {c.name: c for c in (getattr(status, "init_container_statuses", None) or [])}

    containers = [to_container(c, statuses.get(c.name)) for c in (getattr(spec, "containers", None) or [])]
    init_containers = [
        to_container(c, init_statuses.get(c.name), init=True) for c in (getattr(spec, "init_containers", None) or [])
    ]

    ready = sum(1 for c in containers if c.ready)
    restarts = sum(c.restarts for c in containers) + sum(c.restarts for c in init_containers)

    # The phase alone says "Pending"; the reason the user needs is on whichever
    # container is stuck waiting.
    reason = getattr(status, "reason", "") or ""
    message = getattr(status, "message", "") or ""
    for container in init_containers + containers:
        if container.state == "waiting" and container.reason:
            reason, message = container.reason, container.message
            break

    owners = getattr(metadata, "owner_references", None) or []
    owner = f"{owners[0].kind}/{owners[0].name}" if owners else ""

    annotations = {
        k: v for k, v in (_get(pod, "metadata", "annotations", default={}) or {}).items() if k not in _NOISY_ANNOTATIONS
    }

    qos = getattr(status, "qos_class", None) or qos_class(
        [c.requests for c in containers], [c.limits for c in containers]
    )

    return PodDetail(
        namespace=_get(pod, "metadata", "namespace", default="") or "",
        name=_name_of(pod),
        phase=getattr(status, "phase", "") or "Unknown",
        ready=f"{ready}/{len(containers)}",
        restarts=restarts,
        reason=reason,
        message=message.strip()[:500],
        node=getattr(spec, "node_name", "") or "",
        pod_ip=getattr(status, "pod_ip", "") or "",
        host_ip=getattr(status, "host_ip", "") or "",
        qos=str(qos),
        service_account=getattr(spec, "service_account_name", "") or "",
        owner=owner,
        restart_policy=getattr(spec, "restart_policy", "Always") or "Always",
        created_at=_created(pod),
        age=age_seconds(_created(pod)),
        labels=_labels(pod),
        annotations=annotations,
        containers=containers,
        init_containers=init_containers,
        conditions=[
            PodCondition(
                type=c.type,
                status=c.status,
                reason=getattr(c, "reason", "") or "",
                message=(getattr(c, "message", "") or "").strip()[:300],
                at=getattr(c, "last_transition_time", None),
            )
            for c in (getattr(status, "conditions", None) or [])
        ],
        volumes=_volumes(spec),
    )


# ============================================================================
# Workloads
# ============================================================================


def _strategy(spec: Any, kind: str) -> str:
    """Render the update strategy, which is what governs how a rollout behaves."""
    field = "strategy" if kind == "Deployment" else "update_strategy"
    strategy = getattr(spec, field, None)
    if strategy is None:
        return ""
    name = getattr(strategy, "type", "") or ""
    rolling = getattr(strategy, "rolling_update", None)
    if rolling is None:
        return str(name)
    parts = [
        f"{label}={value}"
        for label, value in (
            ("maxSurge", getattr(rolling, "max_surge", None)),
            ("maxUnavailable", getattr(rolling, "max_unavailable", None)),
            ("partition", getattr(rolling, "partition", None)),
        )
        if value is not None
    ]
    return f"{name} {' '.join(parts)}".strip()


def to_workload(item: Any, kind: str) -> WorkloadSummary:
    """Map a Deployment, StatefulSet or DaemonSet onto one summary shape.

    The three controllers count replicas under different field names — a
    DaemonSet has ``desired_number_scheduled`` where a Deployment has
    ``spec.replicas`` — and the console does not want to care which.
    """
    spec, status = getattr(item, "spec", None), getattr(item, "status", None)

    if kind == "DaemonSet":
        desired = int(getattr(status, "desired_number_scheduled", 0) or 0)
        ready = int(getattr(status, "number_ready", 0) or 0)
        updated = int(getattr(status, "updated_number_scheduled", 0) or 0)
        available = int(getattr(status, "number_available", 0) or 0)
    else:
        desired = int(getattr(spec, "replicas", 0) or 0)
        ready = int(getattr(status, "ready_replicas", 0) or 0)
        updated = int(getattr(status, "updated_replicas", 0) or 0)
        available = int(getattr(status, "available_replicas", 0) or 0)

    containers = _get(spec, "template", "spec", "containers", default=[]) or []

    return WorkloadSummary(
        kind=kind,  # type: ignore[arg-type]
        namespace=_get(item, "metadata", "namespace", default="") or "",
        name=_name_of(item),
        desired=desired,
        ready=ready,
        updated=updated,
        available=available,
        images=[c.image for c in containers if getattr(c, "image", None)],
        strategy=_strategy(spec, kind),
        selector=dict(_get(spec, "selector", "match_labels", default={}) or {}),
        labels=_labels(item),
        created_at=_created(item),
        age=age_seconds(_created(item)),
        conditions=[
            PodCondition(
                type=c.type,
                status=c.status,
                reason=getattr(c, "reason", "") or "",
                message=(getattr(c, "message", "") or "").strip()[:300],
                at=getattr(c, "last_transition_time", None),
            )
            for c in (getattr(status, "conditions", None) or [])
        ],
        paused=bool(getattr(spec, "paused", False)),
        generation=int(_get(item, "metadata", "generation", default=0) or 0),
        observed_generation=int(getattr(status, "observed_generation", 0) or 0),
    )


def to_replica_set(item: Any, *, current_revision: str = "") -> ReplicaSetView:
    """Map a ReplicaSet, carrying the revision annotation the Deployment stamps on it."""
    revision = str(_get(item, "metadata", "annotations", default={}).get("deployment.kubernetes.io/revision", "") or "")
    containers = _get(item, "spec", "template", "spec", "containers", default=[]) or []
    return ReplicaSetView(
        name=_name_of(item),
        namespace=_get(item, "metadata", "namespace", default="") or "",
        revision=revision,
        desired=int(_get(item, "spec", "replicas", default=0) or 0),
        ready=int(_get(item, "status", "ready_replicas", default=0) or 0),
        images=[c.image for c in containers if getattr(c, "image", None)],
        created_at=_created(item),
        age=age_seconds(_created(item)),
        current=bool(current_revision) and revision == current_revision,
    )


# ============================================================================
# Nodes and namespaces
# ============================================================================


def to_node_detail(item: Any, *, pods: list[PodDetail] | None = None) -> NodeDetail:
    """Map a node, summing the requests of the pods scheduled onto it.

    Args:
        item: The ``V1Node``.
        pods: Pods already fetched, so the request totals cost no extra call.
    """
    status, metadata, spec = getattr(item, "status", None), getattr(item, "metadata", None), getattr(item, "spec", None)
    name = _name_of(item)

    conditions = getattr(status, "conditions", None) or []
    ready = any(c.type == "Ready" and c.status == "True" for c in conditions)

    capacity = {k: str(v) for k, v in (getattr(status, "capacity", None) or {}).items()}
    allocatable = {k: str(v) for k, v in (getattr(status, "allocatable", None) or {}).items()}
    info = getattr(status, "node_info", None)

    mine = [p for p in (pods or []) if p.node == name]
    requested_cpu = sum(parse_cpu(c.requests.get("cpu")) for p in mine for c in p.containers)
    requested_memory = sum(parse_memory(c.requests.get("memory")) for p in mine for c in p.containers)

    addresses = {a.type: a.address for a in (getattr(status, "addresses", None) or [])}
    roles = [
        key.split("/", 1)[1] for key in (getattr(metadata, "labels", None) or {}) if key.startswith("node-role.")
    ] or ["worker"]

    return NodeDetail(
        name=name,
        ready=ready,
        version=getattr(info, "kubelet_version", "") or "",
        roles=roles,
        os_image=getattr(info, "os_image", "") or "",
        kernel=getattr(info, "kernel_version", "") or "",
        runtime=getattr(info, "container_runtime_version", "") or "",
        architecture=getattr(info, "architecture", "") or "",
        internal_ip=addresses.get("InternalIP", ""),
        capacity=capacity,
        allocatable=allocatable,
        requested_cpu_milli=requested_cpu,
        requested_memory_bytes=requested_memory,
        allocatable_cpu_milli=parse_cpu(allocatable.get("cpu")),
        allocatable_memory_bytes=parse_memory(allocatable.get("memory")),
        pods_running=len(mine),
        pods_capacity=int(allocatable.get("pods", capacity.get("pods", 0)) or 0),
        conditions=[
            NodeCondition(
                type=c.type,
                status=c.status,
                reason=getattr(c, "reason", "") or "",
                message=(getattr(c, "message", "") or "").strip()[:200],
            )
            for c in conditions
        ],
        taints=[
            f"{t.key}={getattr(t, 'value', '') or ''}:{t.effect}" for t in (getattr(spec, "taints", None) or [])
        ],
        unschedulable=bool(getattr(spec, "unschedulable", False)),
        created_at=_created(item),
        age=age_seconds(_created(item)),
    )


def to_namespace(item: Any, *, pods: list[PodDetail] | None = None, workloads: int = 0) -> NamespaceSummary:
    """Map a namespace, counting the pods and workloads inside it."""
    name = _name_of(item)
    mine = [p for p in (pods or []) if p.namespace == name]
    return NamespaceSummary(
        name=name,
        phase=_get(item, "status", "phase", default="Active") or "Active",
        pods_total=len(mine),
        pods_ready=sum(1 for p in mine if p.healthy),
        workloads=workloads,
        created_at=_created(item),
        age=age_seconds(_created(item)),
        labels=_labels(item),
    )


# ============================================================================
# Networking
# ============================================================================


def to_service(item: Any, *, endpoints: list[str] | None = None) -> ServiceView:
    """Map a Service, with the pod IPs currently behind it when known."""
    spec = getattr(item, "spec", None)
    ports = []
    for port in getattr(spec, "ports", None) or []:
        target = getattr(port, "target_port", None)
        protocol = getattr(port, "protocol", "TCP") or "TCP"
        label = f"{port.port}→{target}/{protocol}" if target is not None else f"{port.port}/{protocol}"
        if getattr(port, "node_port", None):
            label += f" node:{port.node_port}"
        ports.append(label)

    return ServiceView(
        namespace=_get(item, "metadata", "namespace", default="") or "",
        name=_name_of(item),
        type=getattr(spec, "type", "ClusterIP") or "ClusterIP",
        cluster_ip=getattr(spec, "cluster_ip", "") or "",
        ports=ports,
        selector=dict(getattr(spec, "selector", None) or {}),
        endpoints=endpoints or [],
        age=age_seconds(_created(item)),
    )


def to_ingress(item: Any) -> IngressView:
    """Map an Ingress into the host→service routes it declares."""
    spec, status = getattr(item, "spec", None), getattr(item, "status", None)

    hosts: list[str] = []
    rules: list[str] = []
    for rule in getattr(spec, "rules", None) or []:
        host = getattr(rule, "host", "") or "*"
        hosts.append(host)
        for path in _get(rule, "http", "paths", default=[]) or []:
            service = _get(path, "backend", "service", default=None)
            port = _get(service, "port", "number", default="") or _get(service, "port", "name", default="")
            rules.append(f"{host}{getattr(path, 'path', '/') or '/'} → {getattr(service, 'name', '?')}:{port}")

    ingress_status = _get(status, "load_balancer", "ingress", default=[]) or []
    address = ""
    if ingress_status:
        address = getattr(ingress_status[0], "ip", "") or getattr(ingress_status[0], "hostname", "") or ""

    return IngressView(
        namespace=_get(item, "metadata", "namespace", default="") or "",
        name=_name_of(item),
        class_name=getattr(spec, "ingress_class_name", "") or "",
        hosts=hosts,
        rules=rules,
        tls_hosts=[h for tls in (getattr(spec, "tls", None) or []) for h in (getattr(tls, "hosts", None) or [])],
        address=address,
        age=age_seconds(_created(item)),
    )


# ============================================================================
# Events
# ============================================================================


def to_event(item: Any) -> EventRecord:
    """Map a core/v1 Event."""
    involved = getattr(item, "involved_object", None)
    source = getattr(item, "source", None)
    return EventRecord(
        namespace=_get(item, "metadata", "namespace", default="") or "",
        type=getattr(item, "type", "Normal") or "Normal",
        reason=getattr(item, "reason", "") or "",
        object=f"{involved.kind}/{involved.name}" if involved is not None else "",
        message=(getattr(item, "message", "") or "").strip(),
        count=int(getattr(item, "count", 1) or 1),
        at=str(getattr(item, "last_timestamp", None) or getattr(item, "event_time", None) or ""),
        first_at=str(getattr(item, "first_timestamp", None) or ""),
        source=(getattr(source, "component", "") or "") if source is not None else "",
    )


# ============================================================================
# Manifests
# ============================================================================


def sanitize_manifest(obj: dict[str, Any]) -> dict[str, Any]:
    """Strip noise and secrets from a raw manifest before it reaches the browser.

    ``managedFields`` is dozens of lines of server-side-apply bookkeeping that
    nobody reads. Secret and ConfigMap payloads are removed outright: the
    console shows the shape of a Secret, never its contents — base64 is not
    encryption, and this page is read by a browser.
    """
    manifest = dict(obj)
    metadata = dict(manifest.get("metadata") or {})
    metadata.pop("managedFields", None)
    annotations = {
        k: v for k, v in (metadata.get("annotations") or {}).items() if k not in _NOISY_ANNOTATIONS
    }
    if annotations:
        metadata["annotations"] = annotations
    else:
        metadata.pop("annotations", None)
    manifest["metadata"] = metadata

    if manifest.get("kind") in ("Secret", "ConfigMap"):
        for field in ("data", "stringData", "binaryData"):
            if isinstance(manifest.get(field), dict):
                manifest[field] = {key: "<redacted>" for key in manifest[field]}

    return manifest


__all__ = [
    "sanitize_manifest",
    "to_container",
    "to_event",
    "to_ingress",
    "to_namespace",
    "to_node_detail",
    "to_pod_detail",
    "to_probe",
    "to_replica_set",
    "to_service",
    "to_workload",
]
