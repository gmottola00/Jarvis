/**
 * The terminal command behind each view, in one place.
 *
 * Learn mode prints these above the view they correspond to, so the console
 * stays a window onto kubectl rather than a replacement for it.
 */

const scope = (namespace: string) => (namespace === "all" ? "-A" : `-n ${namespace}`);

export const kubectl = {
  section(section: "workloads" | "pods" | "nodes" | "network" | "events", namespace = "all"): string {
    switch (section) {
      case "workloads":
        return `kubectl get deploy,sts,ds ${scope(namespace)}`;
      case "pods":
        return `kubectl get pods ${scope(namespace)} -o wide`;
      case "nodes":
        return "kubectl get nodes -o wide && kubectl describe node";
      case "network":
        return `kubectl get ingress,svc,endpoints ${scope(namespace)}`;
      case "events":
        return `kubectl get events ${scope(namespace)} --sort-by=.lastTimestamp`;
    }
  },

  apps: () => "kubectl get ingress -A -o wide | grep tailscale",

  /** Every replica merged, each line prefixed with its pod: what the app's logs tab shows. */
  appLogs: (namespace: string, selector: Record<string, string>, container?: string) => {
    const labels = Object.entries(selector)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `kubectl logs -f -n ${namespace} -l ${labels} --prefix --tail=300${container ? ` -c ${container}` : ""} | grep -v 'GET /health'`;
  },
  appPods: (namespace: string) => `kubectl get pods -n ${namespace} -o wide`,
  appEvents: (namespace: string) => `kubectl get events -n ${namespace} --sort-by=.lastTimestamp`,
  appDelivery: (name: string) => `kubectl get application ${name} -n argocd -o wide`,
  appMap: (namespace: string) => `kubectl get ingress,svc,endpoints,deploy,rs,pods -n ${namespace} -o wide`,

  pod: (namespace: string, name: string) => `kubectl describe pod ${name} -n ${namespace}`,
  podLogs: (namespace: string, name: string, container?: string, previous = false) =>
    `kubectl logs -f ${name} -n ${namespace}${container ? ` -c ${container}` : ""}${previous ? " --previous" : ""}`,
  workload: (kind: string, namespace: string, name: string) => `kubectl describe ${kind.toLowerCase()} ${name} -n ${namespace}`,
};
