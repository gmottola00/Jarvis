/** REST calls for the console. No model involved: every one of these is a plain read. */

import type {
  AlertBrief,
  AlertsOverview,
  ClusterSnapshot,
  DeliveryOverview,
  EventRecord,
  ManifestKind,
  NetworkView,
  PodDetail,
  WorkloadDetail,
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

  workload: (namespace: string, name: string) =>
    get<WorkloadDetail>(`/api/k8s/workloads/${seg(namespace)}/${seg(name)}`),
  pod: (namespace: string, name: string) => get<PodDetail>(`/api/k8s/pods/${seg(namespace)}/${seg(name)}`),

  manifest: (kind: ManifestKind, namespace: string, name: string) =>
    get<Record<string, unknown>>(`/api/k8s/manifest/${kind}/${seg(namespace)}/${seg(name)}`),

  delivery: () => get<DeliveryOverview>("/api/delivery/overview"),

  alerts: (includeSilenced = false) => get<AlertsOverview>(`/api/alerts?include_silenced=${includeSilenced}`),
  /** The investigation prompt for one alert — what the "Investigate" button sends to the agent. */
  alertBrief: (fingerprint: string) => get<AlertBrief>(`/api/alerts/${seg(fingerprint)}/brief`),
};

/** URL of the SSE log stream. A GET, so the browser's own `EventSource` can read it. */
export function logStreamUrl(namespace: string, pod: string, opts: { container?: string; tail?: number } = {}): string {
  const query = new URLSearchParams({ tail: String(opts.tail ?? 200) });
  if (opts.container) query.set("container", opts.container);
  return `/api/k8s/pods/${seg(namespace)}/${seg(pod)}/logs/stream?${query}`;
}
