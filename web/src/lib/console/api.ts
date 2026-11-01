/** REST calls for the console. No model involved: every one of these is a plain read. */

import type {
  AlertBrief,
  AlertsOverview,
  ClusterSnapshot,
  DeliveryOverview,
  EventRecord,
  GatewayView,
  ManifestKind,
  NetworkView,
  PodDetail,
  Problem,
  StatusView,
  WorkloadDetail,
  WorkloadSummary,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    // FastAPI puts the reason in `detail`; surface it instead of a bare status.
    const detail = await response
      .json()
      .then((body: { detail?: unknown }) => (typeof body.detail === "string" ? body.detail : ""))
      .catch(() => "");
    throw new Error(detail || `${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const seg = encodeURIComponent;

export const consoleApi = {
  snapshot: () => get<ClusterSnapshot>("/api/k8s/snapshot"),
  network: (namespace = "all") => get<NetworkView>(`/api/k8s/network?namespace=${seg(namespace)}`),
  events: (namespace = "all", limit = 200) =>
    get<EventRecord[]>(`/api/k8s/events?namespace=${seg(namespace)}&limit=${limit}`),

  workloads: (namespace = "all") => get<WorkloadSummary[]>(`/api/k8s/workloads?namespace=${seg(namespace)}`),
  pods: (namespace = "all") => get<PodDetail[]>(`/api/k8s/pods?namespace=${seg(namespace)}`),
  workload: (namespace: string, name: string) =>
    get<WorkloadDetail>(`/api/k8s/workloads/${seg(namespace)}/${seg(name)}`),
  pod: (namespace: string, name: string) => get<PodDetail>(`/api/k8s/pods/${seg(namespace)}/${seg(name)}`),

  manifest: (kind: ManifestKind, namespace: string, name: string) =>
    get<Record<string, unknown>>(`/api/k8s/manifest/${kind}/${seg(namespace)}/${seg(name)}`),

  delivery: () => get<DeliveryOverview>("/api/delivery/overview"),

  status: () => get<StatusView>("/api/status"),
  gateway: (hours = 24) => get<GatewayView>(`/api/gateway?hours=${hours}`),
  /** The investigation prompt for one status problem — what its "Investigate" button sends. */
  statusBrief: (problem: Pick<Problem, "kind" | "namespace" | "name">) =>
    get<{ prompt: string }>(
      `/api/status/brief?${new URLSearchParams({ kind: problem.kind, namespace: problem.namespace, name: problem.name })}`,
    ),

  alerts: (includeSilenced = false) => get<AlertsOverview>(`/api/alerts?include_silenced=${includeSilenced}`),
  /** The investigation prompt for one alert — what the "Investigate" button sends to the agent. */
  alertBrief: (fingerprint: string) => get<AlertBrief>(`/api/alerts/${seg(fingerprint)}/brief`),
};

export interface LogStreamOptions {
  container?: string;
  tail?: number;
  sinceSeconds?: number;
  /** The container instance before the last restart: what it said before it crashed. */
  previous?: boolean;
  /** Kubelet probe access lines are dropped server-side unless this is true. */
  probes?: boolean;
}

function logQuery(opts: LogStreamOptions): URLSearchParams {
  const query = new URLSearchParams({ tail: String(opts.tail ?? 200) });
  if (opts.container) query.set("container", opts.container);
  if (opts.sinceSeconds) query.set("since_seconds", String(opts.sinceSeconds));
  if (opts.previous) query.set("previous", "true");
  if (opts.probes) query.set("exclude_probes", "false");
  return query;
}

/** URL of a pod's SSE log stream. A GET, so the browser's own `EventSource` can read it. */
export function logStreamUrl(namespace: string, pod: string, opts: LogStreamOptions = {}): string {
  return `/api/k8s/pods/${seg(namespace)}/${seg(pod)}/logs/stream?${logQuery(opts)}`;
}

/** Every pod of a workload, merged; each line carries the pod it came from. */
export function workloadLogStreamUrl(namespace: string, workload: string, opts: Omit<LogStreamOptions, "previous"> = {}): string {
  return `/api/k8s/workloads/${seg(namespace)}/${seg(workload)}/logs/stream?${logQuery(opts)}`;
}
