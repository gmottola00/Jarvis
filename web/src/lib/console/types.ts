/**
 * The console's wire protocol.
 *
 * Mirrors `jarvis/core/console.py` by hand, like `lib/types.ts` mirrors
 * `core/types.py`. Pydantic `@property` values (`PodDetail.healthy`,
 * `WorkloadSummary.complete`, …) are *not* serialized, so their logic lives in
 * `derive.ts` instead — next to the explanation of why it is computed that way.
 *
 * Timestamps arrive as ISO strings; `age` fields are seconds, computed by the
 * server at fetch time.
 */

/* --- Containers and pods -------------------------------------------------- */

export type ProbeKind = "liveness" | "readiness" | "startup";

export interface Probe {
  kind: ProbeKind;
  /** `GET /health:8000`, `tcp:5432`, or the exec command. */
  action: string;
  /** `initialDelaySeconds`. */
  delay: number;
  /** `periodSeconds`. */
  period: number;
  /** `timeoutSeconds`. */
  timeout: number;
  /** `failureThreshold`: consecutive failures before the probe acts. */
  failures: number;
}

export type ContainerState = "running" | "waiting" | "terminated" | "unknown";

export interface ContainerView {
  name: string;
  image: string;
  image_id: string;
  init: boolean;
  ready: boolean;
  started: boolean;
  restarts: number;

  state: ContainerState;
  reason: string;
  message: string;
  state_since: string | null;

  /** The previous run of this container — where `OOMKilled` and exit 137 show up. */
  last_exit_code: number | null;
  last_reason: string;
  last_finished_at: string | null;

  ports: string[];
  requests: Record<string, string>;
  limits: Record<string, string>;
  probes: Probe[];
  env_names: string[];
  mounts: string[];
}

export interface PodCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  at: string | null;
}

export interface VolumeView {
  name: string;
  kind: string;
  source: string;
}

export interface PodDetail {
  namespace: string;
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  reason: string;
  message: string;

  node: string;
  pod_ip: string;
  host_ip: string;
  qos: string;
  service_account: string;
  /** `ReplicaSet/tickup-web-8c9d7f6b5` — the first link of the ownership chain. */
  owner: string;
  restart_policy: string;
  created_at: string | null;
  age: number;

  labels: Record<string, string>;
  annotations: Record<string, string>;
  containers: ContainerView[];
  init_containers: ContainerView[];
  conditions: PodCondition[];
  volumes: VolumeView[];
}

/* --- Workloads ------------------------------------------------------------ */

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export interface WorkloadSummary {
  kind: WorkloadKind;
  namespace: string;
  name: string;

  desired: number;
  ready: number;
  updated: number;
  available: number;

  images: string[];
  strategy: string;
  selector: Record<string, string>;
  labels: Record<string, string>;
  created_at: string | null;
  age: number;

  conditions: PodCondition[];
  paused: boolean;
  generation: number;
  observed_generation: number;
}

export interface ReplicaSetView {
  name: string;
  namespace: string;
  revision: string;
  desired: number;
  ready: number;
  images: string[];
  created_at: string | null;
  age: number;
  current: boolean;
}

export interface WorkloadDetail {
  workload: WorkloadSummary;
  replica_sets: ReplicaSetView[];
  pods: PodDetail[];
  events: EventRecord[];
}

/* --- Nodes and namespaces ------------------------------------------------- */

export interface NodeCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
}

export interface NodeDetail {
  name: string;
  ready: boolean;
  version: string;
  roles: string[];

  os_image: string;
  kernel: string;
  runtime: string;
  architecture: string;
  internal_ip: string;

  capacity: Record<string, string>;
  allocatable: Record<string, string>;

  requested_cpu_milli: number;
  requested_memory_bytes: number;
  allocatable_cpu_milli: number;
  allocatable_memory_bytes: number;
  pods_running: number;
  pods_capacity: number;

  conditions: NodeCondition[];
  taints: string[];
  unschedulable: boolean;
  created_at: string | null;
  age: number;
}

export interface NamespaceSummary {
  name: string;
  phase: string;
  pods_total: number;
  pods_ready: number;
  workloads: number;
  created_at: string | null;
  age: number;
  labels: Record<string, string>;
}

/* --- Networking ----------------------------------------------------------- */

export interface ServiceView {
  namespace: string;
  name: string;
  type: string;
  cluster_ip: string;
  /** `8000→8000/TCP` — service port → container (target) port. */
  ports: string[];
  selector: Record<string, string>;
  /** Pod IPs currently behind the service. Empty means no *ready* pod matches. */
  endpoints: string[];
  age: number;
}

export interface IngressView {
  namespace: string;
  name: string;
  class_name: string;
  hosts: string[];
  /** `tickup/api → tickup-backend:8000`. */
  rules: string[];
  tls_hosts: string[];
  address: string;
  age: number;
}

export interface NetworkView {
  services: ServiceView[];
  ingresses: IngressView[];
}

/* --- Events and metrics --------------------------------------------------- */

export interface EventRecord {
  namespace: string;
  type: "Normal" | "Warning" | string;
  reason: string;
  /** `Pod/tickup-web-8c9d7f6b5-zx8vn`. */
  object: string;
  message: string;
  count: number;
  at: string;
  first_at: string;
  source: string;
}

export interface ResourceUsage {
  name: string;
  namespace: string;
  cpu_milli: number;
  memory_bytes: number;
}

export interface MetricsView {
  available: boolean;
  reason: string;
  nodes: ResourceUsage[];
  pods: ResourceUsage[];
}

export interface ClusterSnapshot {
  nodes: NodeDetail[];
  namespaces: NamespaceSummary[];
  workloads: WorkloadSummary[];
  pods: PodDetail[];
  warnings: EventRecord[];
  metrics: MetricsView;
  /** Per-capability failures: one dead upstream degrades one card. */
  errors: Record<string, string>;
  fetched_at: string;
}

/* --- Delivery ------------------------------------------------------------- */

export type DeliveryStatus = "in-sync" | "behind" | "rolling-out" | "drifted" | "unknown";

export interface ComponentDelivery {
  app: string;
  component: string;
  image: string;

  /** What `apps/<app>/kustomization.yaml` pins. */
  git_tag: string;
  /** What the kubelet actually pulled. */
  running_tag: string;
  /** Newest tag published to GHCR. */
  newest_tag: string;
  /** Newest tag whose commit has green checks. */
  newest_green_tag: string;
  newest_at: string;
  behind_by: number;

  status: DeliveryStatus;
  note: string;
}

/**
 * How an ArgoCD Application pins what it runs. Only `kustomize` apps carry an
 * image tag to compare: `helm` apps version a chart, `manifests` apps (like
 * the app-of-apps `root`) apply a directory of plain YAML.
 */
export type Tracking = "kustomize" | "helm" | "manifests";

export interface AppDelivery {
  name: string;
  sync: string;
  health: string;
  revision: string;
  path: string;
  tracking: Tracking;
  /** Why a non-`kustomize` app has no rows. */
  note: string;
  components: ComponentDelivery[];
}

export interface PullRequestView {
  repo: string;
  number: number;
  title: string;
  state: string;
  head: string;
  base: string;
  draft: boolean;
  url: string;
  checks: string;
}

export interface DeliveryOverview {
  apps: AppDelivery[];
  pull_requests: PullRequestView[];
  errors: Record<string, string>;
  fetched_at: string;
}

/** Kinds `/api/k8s/manifest/{kind}/…` knows how to read. */
export type ManifestKind =
  | "pod"
  | "service"
  | "configmap"
  | "secret"
  | "node"
  | "namespace"
  | "deployment"
  | "statefulset"
  | "daemonset"
  | "replicaset"
  | "ingress";
