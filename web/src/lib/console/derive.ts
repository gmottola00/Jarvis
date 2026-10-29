/**
 * Kubernetes semantics the server does not serialize.
 *
 * Everything here is a pure function over the wire types, so each rule is
 * written down exactly once and can be read on its own. The comments are the
 * point: these are the rules `kubectl` applies silently when it prints READY,
 * STATUS or UP-TO-DATE.
 */

import type { ContainerView, PodDetail, ServiceView, WorkloadSummary } from "./types";

/** The traffic-light every badge, dot and row tint is drawn from. */
export type Tone = "ok" | "warn" | "bad" | "idle" | "info";

/* --- Pods ----------------------------------------------------------------- */

/**
 * A pod is healthy when it is `Running` *and* every container is ready.
 *
 * `Running` alone is not enough: it only means the containers were started.
 * Readiness is the readiness probe's verdict, and it is what decides whether the
 * pod's IP is published as a Service endpoint.
 */
export function podHealthy(pod: PodDetail): boolean {
  return pod.phase === "Running" && pod.containers.every((c) => c.ready);
}

/** `Succeeded` is a finished Job — done, not broken. */
export function podTone(pod: PodDetail): Tone {
  if (pod.phase === "Succeeded") return "idle";
  if (podHealthy(pod)) return pod.restarts > 0 ? "warn" : "ok";
  if (pod.phase === "Failed" || BAD_REASONS.has(pod.reason)) return "bad";
  return "warn";
}

/**
 * What `kubectl get pods` prints in STATUS: the waiting/terminated reason of the
 * first unhappy container if there is one, otherwise the phase.
 */
export function podStatus(pod: PodDetail): string {
  return pod.reason || pod.phase;
}

/** Waiting reasons that will not fix themselves without a change from you. */
const BAD_REASONS = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "InvalidImageName",
  "OOMKilled",
  "Error",
]);

export function containerTone(container: ContainerView): Tone {
  if (container.state === "running") return container.ready ? (container.restarts ? "warn" : "ok") : "warn";
  if (container.state === "terminated") return container.reason === "Completed" ? "idle" : "bad";
  return BAD_REASONS.has(container.reason) ? "bad" : "warn";
}

/* --- Ownership ------------------------------------------------------------ */

export interface OwnerLink {
  kind: string;
  name: string;
}

/**
 * Walk a pod's owners back up to the object you actually wrote.
 *
 * The API only gives the pod's *direct* owner (`ReplicaSet/tickup-web-8c9d7f6b5`).
 * For a Deployment the next hop is implied by naming: a ReplicaSet is called
 * `<deployment>-<pod-template-hash>`, so stripping the last segment and finding
 * a Deployment of that name recovers the chain without another API call.
 *
 * StatefulSets and DaemonSets own their pods directly — there is no ReplicaSet
 * in between, which is why their pods have stable or per-node names.
 */
export function ownerChain(pod: PodDetail, workloads: WorkloadSummary[]): OwnerLink[] {
  const chain: OwnerLink[] = [{ kind: "Pod", name: pod.name }];
  if (!pod.owner) return chain;

  const [kind, name] = splitRef(pod.owner);
  chain.unshift({ kind, name });

  if (kind === "ReplicaSet") {
    const deployment = name.replace(/-[a-z0-9]{5,10}$/, "");
    const found = workloads.find(
      (w) => w.kind === "Deployment" && w.namespace === pod.namespace && w.name === deployment,
    );
    if (found) chain.unshift({ kind: "Deployment", name: found.name });
  }
  return chain;
}

/** The workload a pod belongs to, if any — what the pod drawer links "up" to. */
export function workloadOf(pod: PodDetail, workloads: WorkloadSummary[]): WorkloadSummary | undefined {
  const top = ownerChain(pod, workloads)[0];
  return workloads.find((w) => w.namespace === pod.namespace && w.kind === top.kind && w.name === top.name);
}

/** `Pod/tickup-web-…` → `["Pod", "tickup-web-…"]`. */
export function splitRef(ref: string): [string, string] {
  const slash = ref.indexOf("/");
  return slash < 0 ? ["", ref] : [ref.slice(0, slash), ref.slice(slash + 1)];
}

/* --- Labels and selectors ------------------------------------------------- */

/**
 * Equality-based selector matching: every key in the selector must be present
 * with the same value. This single rule is what connects a Deployment to its
 * pods *and* a Service to its endpoints — nothing in Kubernetes links them by
 * name.
 */
export function matches(labels: Record<string, string>, selector: Record<string, string>): boolean {
  const keys = Object.keys(selector);
  return keys.length > 0 && keys.every((key) => labels[key] === selector[key]);
}

export function podsFor(selector: Record<string, string>, namespace: string, pods: PodDetail[]): PodDetail[] {
  return pods.filter((p) => p.namespace === namespace && matches(p.labels, selector));
}

/**
 * Why a Service has no endpoints. The two cases look identical from outside —
 * the request just fails — and mean entirely different fixes.
 */
export function endpointDiagnosis(service: ServiceView, pods: PodDetail[]): string {
  if (service.endpoints.length > 0) return "";
  if (Object.keys(service.selector).length === 0)
    return "No selector: endpoints must be managed by hand (or this is an ExternalName service).";
  const selected = podsFor(service.selector, service.namespace, pods);
  if (selected.length === 0) return "The selector matches no pod. Check the labels on the pod template.";
  return `The selector matches ${selected.length} pod(s), but none is ready — failing readiness probes keep them out.`;
}

/* --- Workloads ------------------------------------------------------------ */

/**
 * A rollout is complete when the controller has *seen* the latest spec and every
 * replica is updated, ready and available.
 *
 * `observed_generation < generation` means you changed the spec and the
 * controller has not even processed it yet — easy to miss, because the replica
 * counts still look fine from the previous version.
 */
export function workloadComplete(w: WorkloadSummary): boolean {
  return (
    w.observed_generation >= w.generation &&
    w.updated >= w.desired &&
    w.ready >= w.desired &&
    w.available >= w.desired
  );
}

export function workloadTone(w: WorkloadSummary): Tone {
  if (w.desired === 0) return "idle";
  if (workloadComplete(w)) return "ok";
  return w.ready === 0 ? "bad" : "warn";
}

/** A one-line reading of the four replica counters. */
export function rolloutStory(w: WorkloadSummary): string {
  if (w.paused) return "Rollout paused — the controller will not act on spec changes until resumed.";
  if (w.desired === 0) return "Scaled to zero.";
  if (w.observed_generation < w.generation) return "Spec changed; the controller has not processed it yet.";
  if (workloadComplete(w)) return `All ${w.desired} replica(s) are on the latest template and serving.`;
  if (w.updated < w.desired) return `${w.updated}/${w.desired} replicas are on the new template — rollout in progress.`;
  return `${w.ready}/${w.desired} replicas are ready — pods exist but are not passing readiness.`;
}

/* --- Exit codes ----------------------------------------------------------- */

/**
 * Exit codes above 128 are `128 + signal`. The kubelet does not tell you that;
 * it is a Unix convention, and it turns "exit 137" into "SIGKILL".
 */
export function exitMeaning(code: number | null, reason = ""): string {
  if (code === null) return "";
  if (reason === "OOMKilled" || code === 137)
    return "137 = 128 + 9 (SIGKILL). With OOMKilled: the container went over its memory limit and the kernel killed it.";
  if (code === 143) return "143 = 128 + 15 (SIGTERM): asked to stop — a normal shutdown during rollouts or evictions.";
  if (code === 0) return "Exited cleanly.";
  if (code === 1) return "Generic application error — the answer is in the previous run's logs.";
  if (code > 128) return `${code} = 128 + ${code - 128}: killed by signal ${code - 128}.`;
  return `The process exited with ${code}.`;
}
