/**
 * The gym notes.
 *
 * One entry per concept the console puts on screen, each with the `kubectl`
 * command that shows the same thing. The console is a window onto those
 * commands, not a replacement for them: when the UI teaches you where to look,
 * the terminal is where you should be able to look next.
 *
 * Panels render these through `<Learn topic="…" />`, which only shows when
 * learn mode is on — so the same page works as a dashboard and as a lesson.
 */

export interface Lesson {
  title: string;
  body: string;
  kubectl?: string;
}

export const LESSONS = {
  node: {
    title: "Node",
    body:
      "A machine running the kubelet. Allocatable is capacity minus what is reserved for the OS and Kubernetes itself. " +
      "The scheduler places a pod only if its *requests* fit in what is left — actual usage is irrelevant to that decision.",
    kubectl: "kubectl describe node um790",
  },
  requests: {
    title: "Requests vs limits",
    body:
      "Requests are a reservation: the scheduler subtracts them from the node, used or not. Limits are a ceiling enforced " +
      "by the kernel at runtime — going over a CPU limit throttles, going over a memory limit gets the container OOMKilled.",
    kubectl: "kubectl top pod -A   # needs metrics-server",
  },
  qos: {
    title: "QoS class",
    body:
      "Derived, never written. Guaranteed: requests = limits for every container. Burstable: some requests set. " +
      "BestEffort: nothing set. Under memory pressure the kubelet evicts BestEffort first and Guaranteed last.",
    kubectl: "kubectl get pod <name> -o jsonpath='{.status.qosClass}'",
  },
  namespace: {
    title: "Namespace",
    body:
      "A name scope, not a security boundary by itself. Each app in the lab lives in its own namespace, created from " +
      "`namespace.yaml` in the app's kustomization; RBAC, quotas and network policies are what turn it into isolation.",
    kubectl: "kubectl get ns",
  },
  deployment: {
    title: "Deployment → ReplicaSet → Pod",
    body:
      "A Deployment never touches pods. On every template change it creates a new ReplicaSet and scales it up while " +
      "scaling the old one down. Old ReplicaSets stay at 0 replicas as rollout history — that is what `rollout undo` uses.",
    kubectl: "kubectl rollout history deploy/<name> -n <ns>",
  },
  statefulset: {
    title: "StatefulSet",
    body:
      "Owns its pods directly, with stable names (`-0`, `-1`) and stable storage. Pods are created and replaced in order. " +
      "Use it when identity matters — databases, controllers with leader election.",
    kubectl: "kubectl get sts -A",
  },
  daemonset: {
    title: "DaemonSet",
    body:
      "One pod per (matching) node. Desired is the number of eligible nodes, not a number you set — `0/0` is normal " +
      "when no node matches its selector, as with k3s' svclb on a node without a LoadBalancer service.",
    kubectl: "kubectl get ds -A",
  },
  rollout: {
    title: "Reading a rollout",
    body:
      "desired: what the spec asks for. updated: replicas on the newest template. ready: passing readiness. " +
      "available: ready for at least minReadySeconds. A rollout is done only when all four agree and observedGeneration has caught up.",
    kubectl: "kubectl rollout status deploy/<name> -n <ns>",
  },
  pod: {
    title: "Pod",
    body:
      "The unit of scheduling: one or more containers sharing a network namespace (one IP) and volumes. The phase is " +
      "coarse — Pending covers both 'not scheduled yet' and 'image cannot be pulled'. The container state has the real reason.",
    kubectl: "kubectl get pods -A -o wide",
  },
  probes: {
    title: "Probes",
    body:
      "Liveness failing → the kubelet restarts the container. Readiness failing → the pod is removed from Service endpoints, " +
      "but keeps running. Startup → holds off the other two until the app has booted. Confusing liveness with readiness is " +
      "the classic way to turn a slow dependency into a restart loop.",
    kubectl: "kubectl describe pod <name> -n <ns>",
  },
  conditions: {
    title: "Pod conditions",
    body:
      "The lifecycle as checkpoints: PodScheduled → Initialized (init containers done) → ContainersReady → Ready. " +
      "The first one that is False tells you which stage it is stuck in.",
    kubectl: "kubectl get pod <name> -n <ns> -o jsonpath='{.status.conditions}'",
  },
  restarts: {
    title: "Restarts and last state",
    body:
      "A container that restarts keeps the same pod; its previous run is in `lastState`. That is where an OOMKill shows up — " +
      "the current state already says Running again. Logs of the dead run need `--previous`.",
    kubectl: "kubectl logs <pod> -n <ns> --previous",
  },
  service: {
    title: "Service and endpoints",
    body:
      "A stable virtual IP in front of a set of pods chosen by label selector. Only *ready* pods become endpoints. " +
      "A Service with zero endpoints still resolves in DNS — requests to it just fail, which is why the endpoint count matters.",
    kubectl: "kubectl get endpoints -n <ns>",
  },
  ingress: {
    title: "Ingress",
    body:
      "HTTP routing rules (host + path → service:port) implemented by an ingress controller. In the lab the class is " +
      "`tailscale`: the operator gives each ingress a node on the tailnet, so `tickup` is reachable only from your devices.",
    kubectl: "kubectl get ingress -A",
  },
  events: {
    title: "Events",
    body:
      "Short-lived records (about an hour) written by controllers and the kubelet. They are the fastest explanation of " +
      "anything that just broke — and they are gone by tomorrow, so they are not a log.",
    kubectl: "kubectl get events -A --sort-by=.lastTimestamp",
  },
  manifest: {
    title: "Live manifest",
    body:
      "What the API server holds, not what you committed. Every field you did not write — defaults, status, " +
      "ownerReferences — was filled in by Kubernetes. Comparing the two is the quickest way to learn the defaults.",
    kubectl: "kubectl get <kind> <name> -n <ns> -o yaml",
  },
  logs: {
    title: "Logs",
    body:
      "The container's stdout and stderr, kept by the kubelet on the node — rotated, and lost with the pod. " +
      "Following them is a long-lived HTTP stream from the API server, which this page relays to you as SSE.",
    kubectl: "kubectl logs -f <pod> -n <ns> -c <container>",
  },
  metrics: {
    title: "metrics-server",
    body:
      "Live CPU and memory come from the metrics.k8s.io API, which only exists once metrics-server is installed. " +
      "Without it you can still see requests — what is reserved — but not usage.",
    kubectl: "kubectl top nodes",
  },
  gitops: {
    title: "GitOps delivery",
    body:
      "CI builds an image and pushes it to GHCR tagged with the commit SHA. Nothing deploys until the tag is pinned in " +
      "`apps/<app>/kustomization.yaml` in Home-Lab-Infra. ArgoCD sees the commit, renders the kustomization and applies it; " +
      "the Deployment then rolls out a new ReplicaSet. Git is the only control knob.",
    kubectl: "kubectl -n argocd get applications",
  },
  alerts: {
    title: "Alerts",
    body:
      "Prometheus evaluates alert rules every few seconds; a rule whose expression stays true for its `for:` window fires " +
      "and is sent to Alertmanager, which deduplicates, groups and applies silences. Here Alertmanager has no receivers, " +
      "so nothing pages anyone — this page is where alerts are seen. Watchdog always fires on purpose: it proves the " +
      "pipeline works, so it is hidden.",
    kubectl: "kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093",
  },
} satisfies Record<string, Lesson>;

export type Topic = keyof typeof LESSONS;
