"""Read models for the console.

The console is the half of Jarvis that has no model in it. Where ``types.py``
describes what crosses the agent boundary — tool calls, approvals, run events —
this module describes what crosses the *observation* boundary: the shapes the
dashboard renders when a person, not a language model, is asking.

They are deliberately richer than the agent's view. A tool returns prose shaped
for a model to reason about; a table wants fields. ``k8s__list_pods`` answering
"tickup-web 0/1 ImagePullBackOff" is the right answer for the agent and a poor
one for a page that has to show you which container, which image, which probe,
and what the kubelet said when it last gave up.

Mirrored by hand in ``web/src/lib/console.ts``. Change one, change the other.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, computed_field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def age_seconds(created: datetime | None) -> float:
    """Seconds since ``created``, or 0 when it is unknown.

    Kubernetes reports creation timestamps, not ages; every table wants the age.
    Computing it server-side keeps the browser from having to agree about clocks.
    """
    if created is None:
        return 0.0
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0.0, (_now() - created).total_seconds())


# ============================================================================
# Containers and pods
# ============================================================================


class Probe(BaseModel):
    """One container probe, flattened into something a table can show.

    Kubernetes models liveness, readiness and startup probes identically and
    distinguishes them only by field name, which is exactly the kind of detail
    that is obvious once you have seen it and opaque until you have.
    """

    kind: Literal["liveness", "readiness", "startup"]
    action: str
    """``GET /health:8000``, ``tcp:5432``, or the exec command."""

    delay: int = 0
    """``initialDelaySeconds`` — how long the kubelet waits before the first check."""

    period: int = 10
    timeout: int = 1
    failures: int = 3
    """``failureThreshold`` — consecutive failures before the probe acts."""

    @property
    def summary(self) -> str:
        return f"{self.action} every {self.period}s, {self.failures} failures"


class ContainerView(BaseModel):
    """One container inside a pod, spec and status merged.

    They are two separate objects in the API — ``spec.containers[i]`` and
    ``status.containerStatuses[j]``, matched by name and not by index. Merging
    them here is the single most useful thing this module does.
    """

    name: str
    image: str
    image_id: str = ""
    """The digest actually pulled. Differs from ``image`` whenever a tag moved."""

    init: bool = False
    ready: bool = False
    started: bool = False
    restarts: int = 0

    state: Literal["running", "waiting", "terminated", "unknown"] = "unknown"
    reason: str = ""
    message: str = ""
    state_since: datetime | None = None

    last_exit_code: int | None = None
    last_reason: str = ""
    last_finished_at: datetime | None = None
    """Why the previous instance died. The whole story behind a CrashLoopBackOff."""

    ports: list[str] = Field(default_factory=list)
    """``8000/TCP``, named when the manifest names them."""

    requests: dict[str, str] = Field(default_factory=dict)
    limits: dict[str, str] = Field(default_factory=dict)
    probes: list[Probe] = Field(default_factory=list)
    env_names: list[str] = Field(default_factory=list)
    """Variable names only. Values are never read — half of them are secrets."""

    mounts: list[str] = Field(default_factory=list)


class PodCondition(BaseModel):
    type: str
    status: str
    reason: str = ""
    message: str = ""
    at: datetime | None = None


class VolumeView(BaseModel):
    name: str
    kind: str
    """``configMap``, ``secret``, ``emptyDir``, ``persistentVolumeClaim``…"""

    source: str = ""


class PodDetail(BaseModel):
    """Everything ``kubectl describe pod`` shows, as data instead of text."""

    namespace: str
    name: str
    phase: str
    ready: str = ""
    restarts: int = 0
    reason: str = ""
    message: str = ""

    node: str = ""
    pod_ip: str = ""
    host_ip: str = ""
    qos: str = ""
    """``Guaranteed`` | ``Burstable`` | ``BestEffort`` — derived from requests and limits."""

    service_account: str = ""
    owner: str = ""
    """``ReplicaSet/tickup-web-8c9d7f6b5``. What would recreate this pod if it died."""

    restart_policy: str = "Always"
    created_at: datetime | None = None
    age: float = 0.0

    labels: dict[str, str] = Field(default_factory=dict)
    annotations: dict[str, str] = Field(default_factory=dict)
    containers: list[ContainerView] = Field(default_factory=list)
    init_containers: list[ContainerView] = Field(default_factory=list)
    conditions: list[PodCondition] = Field(default_factory=list)
    volumes: list[VolumeView] = Field(default_factory=list)

    @property
    def healthy(self) -> bool:
        return self.phase == "Running" and all(c.ready for c in self.containers)


# ============================================================================
# Workloads
# ============================================================================


class WorkloadSummary(BaseModel):
    """A Deployment, StatefulSet or DaemonSet, reduced to what a row needs."""

    kind: Literal["Deployment", "StatefulSet", "DaemonSet"]
    namespace: str
    name: str

    desired: int = 0
    ready: int = 0
    updated: int = 0
    available: int = 0

    images: list[str] = Field(default_factory=list)
    strategy: str = ""
    """``RollingUpdate maxSurge=25% maxUnavailable=25%`` — why a rollout behaves as it does."""

    selector: dict[str, str] = Field(default_factory=dict)
    labels: dict[str, str] = Field(default_factory=dict)
    created_at: datetime | None = None
    age: float = 0.0

    conditions: list[PodCondition] = Field(default_factory=list)
    paused: bool = False
    generation: int = 0
    observed_generation: int = 0
    """Behind ``generation`` means the controller has not caught up with the spec yet."""

    @property
    def complete(self) -> bool:
        return self.desired == self.ready == self.available


class ReplicaSetView(BaseModel):
    """One ReplicaSet under a Deployment.

    Shown because the rollout mechanism is invisible until you see it: a
    Deployment does not scale pods, it creates a new ReplicaSet and scales the
    old one down. The leftover zero-replica rows are the rollout history.
    """

    name: str
    namespace: str
    revision: str = ""
    desired: int = 0
    ready: int = 0
    images: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    age: float = 0.0
    current: bool = False


class WorkloadDetail(BaseModel):
    """A workload with the pods and replica sets underneath it."""

    workload: WorkloadSummary
    replica_sets: list[ReplicaSetView] = Field(default_factory=list)
    pods: list[PodDetail] = Field(default_factory=list)
    events: list[EventRecord] = Field(default_factory=list)


# ============================================================================
# Nodes and namespaces
# ============================================================================


class NodeCondition(BaseModel):
    type: str
    status: str
    reason: str = ""
    message: str = ""


class NodeDetail(BaseModel):
    """A node with the capacity numbers that explain scheduling decisions."""

    name: str
    ready: bool = False
    version: str = ""
    roles: list[str] = Field(default_factory=list)

    os_image: str = ""
    kernel: str = ""
    runtime: str = ""
    architecture: str = ""
    internal_ip: str = ""

    capacity: dict[str, str] = Field(default_factory=dict)
    """What the machine has: ``cpu``, ``memory``, ``pods``, ``ephemeral-storage``."""

    allocatable: dict[str, str] = Field(default_factory=dict)
    """What the scheduler may hand out — capacity minus reserved. Always the smaller number."""

    requested_cpu_milli: int = 0
    requested_memory_bytes: int = 0
    """Summed pod requests. This, not actual usage, is what the scheduler packs against."""

    allocatable_cpu_milli: int = 0
    allocatable_memory_bytes: int = 0
    pods_running: int = 0
    pods_capacity: int = 0

    conditions: list[NodeCondition] = Field(default_factory=list)
    taints: list[str] = Field(default_factory=list)
    unschedulable: bool = False
    created_at: datetime | None = None
    age: float = 0.0

    @property
    def cpu_pressure(self) -> float:
        """Fraction of allocatable CPU already promised to pods."""
        return self.requested_cpu_milli / self.allocatable_cpu_milli if self.allocatable_cpu_milli else 0.0


class NamespaceSummary(BaseModel):
    name: str
    phase: str = "Active"
    pods_total: int = 0
    pods_ready: int = 0
    workloads: int = 0
    created_at: datetime | None = None
    age: float = 0.0
    labels: dict[str, str] = Field(default_factory=dict)


# ============================================================================
# Networking
# ============================================================================


class ServiceView(BaseModel):
    namespace: str
    name: str
    type: str = "ClusterIP"
    cluster_ip: str = ""
    ports: list[str] = Field(default_factory=list)
    """``80→8000/TCP``: the port the Service answers on, then the container's."""

    selector: dict[str, str] = Field(default_factory=dict)
    endpoints: list[str] = Field(default_factory=list)
    """Pod IPs currently behind it. Empty means the selector matches nothing ready."""

    age: float = 0.0


class IngressView(BaseModel):
    namespace: str
    name: str
    class_name: str = ""
    hosts: list[str] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    """``jarvis.tailnet.ts.net/api → jarvis-backend:8000``."""

    tls_hosts: list[str] = Field(default_factory=list)
    address: str = ""
    age: float = 0.0


class NetworkView(BaseModel):
    """Services and ingresses together: the whole path from tailnet to container."""

    services: list[ServiceView] = Field(default_factory=list)
    ingresses: list[IngressView] = Field(default_factory=list)


# ============================================================================
# Events
# ============================================================================


class EventRecord(BaseModel):
    """One cluster event. The fastest explanation of anything that just broke."""

    namespace: str = ""
    type: str = "Normal"
    reason: str = ""
    object: str = ""
    message: str = ""
    count: int = 1
    at: str = ""
    first_at: str = ""
    source: str = ""

    @property
    def warning(self) -> bool:
        return self.type == "Warning"


# ============================================================================
# Metrics
# ============================================================================


class ResourceUsage(BaseModel):
    """A live sample from ``metrics.k8s.io``, when metrics-server is installed."""

    name: str
    namespace: str = ""
    cpu_milli: int = 0
    memory_bytes: int = 0


class MetricsView(BaseModel):
    available: bool = False
    reason: str = ""
    """Why not, when unavailable — usually "metrics-server is not installed"."""

    nodes: list[ResourceUsage] = Field(default_factory=list)
    pods: list[ResourceUsage] = Field(default_factory=list)


# ============================================================================
# Cluster snapshot — what the console's landing page needs in one call
# ============================================================================


class ClusterSnapshot(BaseModel):
    nodes: list[NodeDetail] = Field(default_factory=list)
    namespaces: list[NamespaceSummary] = Field(default_factory=list)
    workloads: list[WorkloadSummary] = Field(default_factory=list)
    pods: list[PodDetail] = Field(default_factory=list)
    warnings: list[EventRecord] = Field(default_factory=list)
    metrics: MetricsView = Field(default_factory=MetricsView)
    errors: dict[str, str] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=_now)

    @property
    def unhealthy(self) -> list[PodDetail]:
        return [p for p in self.pods if not p.healthy]


# ============================================================================
# Delivery — the Git-to-cluster drift table
# ============================================================================


class ComponentDelivery(BaseModel):
    """One image's journey: pinned in Git, running in the cluster, built in GHCR.

    Three tags that should agree and often do not, which is the single most
    useful thing to put on a screen in a GitOps setup. ``git_tag`` is what
    ``kustomization.yaml`` pins, ``running_tag`` is what the kubelet actually
    pulled, ``newest_green_tag`` is the best thing available to deploy.
    """

    app: str
    component: str
    image: str

    git_tag: str = ""
    running_tag: str = ""
    newest_tag: str = ""
    newest_green_tag: str = ""
    newest_at: str = ""
    behind_by: int = 0
    """Published tags newer than the one pinned in Git."""

    status: Literal["in-sync", "behind", "rolling-out", "drifted", "unknown"] = "unknown"
    """``rolling-out``: Git and the cluster disagree, which is normal for a minute
    after a merge and a problem after ten. ``drifted``: the cluster is running
    something Git never pinned."""

    note: str = ""


class AppDelivery(BaseModel):
    name: str
    sync: str = "Unknown"
    health: str = "Unknown"
    revision: str = ""
    repo: str = ""
    path: str = ""
    tracking: Literal["kustomize", "helm", "manifests"] = "kustomize"
    """How the app pins what it runs. Only ``kustomize`` apps have image tags to compare."""

    note: str = ""
    """Why an app that is not ``kustomize`` has no rows."""

    components: list[ComponentDelivery] = Field(default_factory=list)

    @property
    def needs_attention(self) -> bool:
        return self.health != "Healthy" or self.sync != "Synced" or any(c.status != "in-sync" for c in self.components)


class PullRequestView(BaseModel):
    repo: str = ""
    number: int = 0
    title: str = ""
    state: str = "open"
    head: str = ""
    base: str = ""
    draft: bool = False
    url: str = ""
    checks: str = ""
    """``3/3 passed``, ``pending``, or empty when checks were not fetched."""


class DeliveryOverview(BaseModel):
    """The release pipeline on one page, with no model in the loop."""

    apps: list[AppDelivery] = Field(default_factory=list)
    pull_requests: list[PullRequestView] = Field(default_factory=list)
    errors: dict[str, str] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=_now)


# ============================================================================
# Alerts
# ============================================================================


class AlertView(BaseModel):
    """One alert as Alertmanager holds it, with the thing it is about pulled out.

    Alert rules from kube-prometheus-stack do not agree on where the subject
    lives. ``KubePodCrashLooping`` puts it in ``pod``; ``KubeDeploymentReplicasMismatch``
    puts it in ``deployment`` and leaves ``pod`` pointing at the kube-state-metrics
    pod that exported the metric. ``target`` is the resolved answer, so the page
    and the agent both look at the right thing.
    """

    fingerprint: str
    name: str
    severity: str = ""
    """``critical`` | ``warning`` | ``info`` | ``none``, as the rule sets it."""

    state: Literal["active", "suppressed", "unprocessed"] = "active"
    """``suppressed`` means silenced or inhibited: firing, but someone decided not to hear it."""

    namespace: str = ""
    target: str = ""
    """``Pod/tickup-backend-…``, ``Deployment/tickup-backend``, or empty for a cluster-wide alert."""

    container: str = ""
    summary: str = ""
    description: str = ""
    runbook_url: str = ""
    starts_at: datetime | None = None
    age: float = 0.0
    labels: dict[str, str] = Field(default_factory=dict)


class TargetView(BaseModel):
    """A scrape target whose last scrape failed."""

    job: str = ""
    url: str = ""
    health: str = ""
    last_error: str = ""


class AlertsOverview(BaseModel):
    """What is firing, and whether the monitoring itself can see everything."""

    alerts: list[AlertView] = Field(default_factory=list)
    targets_down: list[TargetView] = Field(default_factory=list)
    errors: dict[str, str] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=_now)


WorkloadDetail.model_rebuild()


# ============================================================================
# Gateway (LiteLLM usage)
# ============================================================================


class KeyUsage(BaseModel):
    """One virtual key — one app — with its budget and what it used in the window."""

    alias: str
    spend: float = 0.0
    """Spend in the current budget period, as LiteLLM tracks it."""

    max_budget: float | None = None
    budget_duration: str | None = None
    budget_reset_at: datetime | None = None
    window_spend: float = 0.0
    requests: int = 0
    failures: int = 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def budget_used(self) -> float | None:
        """Fraction of the budget spent, None without a budget."""
        return self.spend / self.max_budget if self.max_budget else None


class ModelUsage(BaseModel):
    """One model across every key, in the window."""

    model: str
    requests: int = 0
    failures: int = 0
    spend: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    p50_ms: float | None = None
    p95_ms: float | None = None
    ttft_p50_ms: float | None = None
    """Median time to the first token, successful streamed calls only."""


class GatewayError(BaseModel):
    at: datetime
    alias: str = ""
    model: str = ""
    error_class: str = ""
    error_code: str = ""
    normalized_error: str = ""
    message: str = ""


class DailySpend(BaseModel):
    day: date
    alias: str
    spend: float = 0.0
    requests: int = 0
    failures: int = 0


class UsageRow(BaseModel):
    """One (key, model) row as ``jarvis_ro.usage`` returns it."""

    alias: str
    model: str
    requests: int = 0
    failures: int = 0
    spend: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    p50_ms: float | None = None
    p95_ms: float | None = None
    ttft_p50_ms: float | None = None


class GatewayView(BaseModel):
    """What the gateway did: per app, per model, per day, and what failed."""

    window_hours: int
    keys: list[KeyUsage] = Field(default_factory=list)
    models: list[ModelUsage] = Field(default_factory=list)
    daily: list[DailySpend] = Field(default_factory=list)
    errors: list[GatewayError] = Field(default_factory=list)
    sources: dict[str, str] = Field(default_factory=dict)
    """Per-source failures (``litellm.usage``…), so one broken function costs one panel."""

    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


__all__ = [
    "AlertView",
    "AlertsOverview",
    "AppDelivery",
    "ClusterSnapshot",
    "ComponentDelivery",
    "ContainerView",
    "DeliveryOverview",
    "EventRecord",
    "IngressView",
    "MetricsView",
    "NamespaceSummary",
    "NetworkView",
    "NodeCondition",
    "NodeDetail",
    "PodCondition",
    "PodDetail",
    "Probe",
    "PullRequestView",
    "ReplicaSetView",
    "ResourceUsage",
    "ServiceView",
    "TargetView",
    "VolumeView",
    "WorkloadDetail",
    "WorkloadSummary",
    "age_seconds",
    "DailySpend",
    "GatewayError",
    "GatewayView",
    "KeyUsage",
    "ModelUsage",
    "UsageRow",
]
