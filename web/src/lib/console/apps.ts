/**
 * What an "app" is to the console: a namespace, joined with its ArgoCD app and
 * the images Delivery says it runs. Namespaces with a Tailscale ingress get its
 * address; the rest (a database, a backend only other apps call) are
 * cluster-only. Shared by the apps grid and the per-app page.
 */

import type { Tone } from "./derive";
import type { AppDelivery, IngressView, NetworkView, ServiceView } from "./types";
import { shortSha, splitImage } from "../format";
import type { GpuState } from "../types";

/** Namespaces that run the lab rather than live in it, and what each one is. Anything else is an app. */
export const PLATFORM: Record<string, string> = {
  argocd: "gitops",
  litellm: "gateway",
  monitoring: "metrics",
  observability: "metrics",
  grafana: "metrics",
  jarvis: "agent",
  databases: "database",
  "cnpg-system": "operator",
};

export interface Fact {
  k: string;
  v: string;
  tone?: Tone;
  dim?: boolean;
}

export interface Entry {
  name: string;
  kind: string;
  host: string;
  /** Empty while the operator has not handed out a tailnet address yet. */
  url: string;
  tone: Tone;
  status: string;
  facts: Fact[];
}

/** `trip-ai.tail9c2f1.ts.net/api → trip-ai-backend:8000` → `["/api", "trip-ai-backend"]`. */
export function parseRule(rule: string): [string, string] {
  const [from, to = ""] = rule.split(" → ");
  const slash = from.indexOf("/");
  return [slash < 0 ? "/" : from.slice(slash), to.split(":")[0]];
}

function repoName(url: string): string {
  return url.replace(/^(https?:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, "");
}

/** The namespace an ArgoCD app deploys into, falling back to its name. */
export function appNamespace(app: AppDelivery): string {
  return app.namespace || app.name;
}

/** ArgoCD apps whose namespace is `argocd` are app-of-apps, not something that runs. */
const GITOPS_NAMESPACE = "argocd";

/**
 * Every app worth a card: one per Tailscale ingress, then one per namespace that
 * ArgoCD deploys into but no Tailscale ingress exposes.
 */
export function clusterEntries(network: NetworkView, delivery: AppDelivery[]): Entry[] {
  const exposed = ingressEntries(network, delivery);
  const covered = new Set(exposed.map((e) => e.name));
  const internal = new Map<string, AppDelivery[]>();
  for (const app of delivery) {
    const ns = appNamespace(app);
    if (ns === GITOPS_NAMESPACE || covered.has(ns)) continue;
    internal.set(ns, [...(internal.get(ns) ?? []), app]);
  }
  return [...exposed, ...[...internal].map(([ns, apps]) => internalEntry(ns, network, apps))];
}

/** The card for one namespace, exposed or not; undefined when neither an ingress nor an app knows it. */
export function namespaceEntry(namespace: string, network: NetworkView, delivery: AppDelivery[]): Entry | undefined {
  const mine = delivery.filter((a) => appNamespace(a) === namespace || a.name === namespace);
  const exposed = ingressEntries(network, mine).find((e) => e.name === namespace);
  return exposed ?? (mine.length ? internalEntry(namespace, network, mine) : undefined);
}

/** `notify-backend.notify.svc:8000`, the address other pods use. */
function serviceAddress(svc: ServiceView): string {
  const port = svc.ports[0]?.split("→")[0];
  return `${svc.name}.${svc.namespace}.svc${port ? `:${port}` : ""}`;
}

function internalEntry(namespace: string, network: NetworkView, apps: AppDelivery[]): Entry {
  const services = network.services.filter((s) => s.namespace === namespace && s.cluster_ip && s.cluster_ip !== "None");
  // With no routes to go by, one empty service is not news: a single-instance
  // CNPG cluster always has an empty `-ro`. Only all of them empty is.
  const live = services.filter((s) => s.endpoints.length > 0);
  const healthy = apps.every((a) => a.sync === "Synced" && a.health === "Healthy");
  const tone: Tone = services.length && !live.length ? "bad" : !healthy ? "warn" : "ok";

  const argo = apps.map((a) => `${apps.length > 1 ? `${a.name} ` : ""}${a.sync} · ${a.health}`);
  const status = [...argo, "cluster only"];
  if (services.length && !live.length) status.push("no service has endpoints");
  // The address to show: the read-write one when CNPG offers it, else anything that answers.
  const primary = services.find((s) => s.name.endsWith("-rw") && s.endpoints.length) ?? live[0] ?? services[0];

  const facts: Fact[] = [];
  if (apps.length > 1 || apps[0].name !== namespace) facts.push({ k: "argocd", v: apps.map((a) => a.name).join(" · ") });
  const repos = [...new Set(apps.map((a) => a.repo).filter(Boolean))];
  if (repos.length) facts.push({ k: "repo", v: repos.map(repoName).join(" · ") });
  const paths = apps.map((a) => a.path).filter(Boolean);
  if (paths.length) facts.push({ k: "path", v: paths.join(" · ") });
  for (const c of apps.flatMap((a) => a.components)) {
    const { name } = splitImage(c.image);
    const tag = shortSha(c.running_tag || c.git_tag);
    facts.push({ k: c.component.replace(`${namespace}-`, ""), v: `ghcr · ${name}:${tag}`, tone: c.status === "in-sync" ? undefined : c.status === "unknown" ? "idle" : "warn" });
  }
  if (services.length)
    facts.push({ k: "services", v: services.map((s) => `${s.name}${s.endpoints.length ? "" : " (no endpoints)"}`).join(" · "), dim: true });

  return {
    name: namespace,
    kind: PLATFORM[namespace] ?? "app",
    host: primary ? serviceAddress(primary) : `namespace ${namespace}`,
    url: "",
    tone,
    status: status.join(" · "),
    facts,
  };
}

/** One entry per Tailscale ingress; ArgoCD state and image pins come from the delivery overview. */
export function ingressEntries(network: NetworkView, delivery: AppDelivery[]): Entry[] {
  return network.ingresses
    .filter((ing) => ing.class_name === "tailscale")
    .map((ing) => ingressEntry(ing, network, delivery.find((d) => d.name === ing.namespace)));
}

function ingressEntry(ing: IngressView, network: NetworkView, app: AppDelivery | undefined): Entry {
  const routes = ing.rules.map(parseRule);
  const empty = routes
    .map(([, service]) => network.services.find((s) => s.namespace === ing.namespace && s.name === service))
    .filter((s) => s && s.endpoints.length === 0)
    .map((s) => s!.name.replace(`${ing.namespace}-`, ""));
  const healthy = app ? app.sync === "Synced" && app.health === "Healthy" : true;
  const tone: Tone = !ing.address ? "idle" : routes.length && empty.length === routes.length ? "bad" : empty.length || !healthy ? "warn" : "ok";

  const status = [app ? `${app.sync} · ${app.health}` : "not tracked by argocd", ...empty.map((name) => `${name} has no endpoints`)];
  if (!ing.address) status.push("no tailnet address yet");

  const facts: Fact[] = [];
  if (app?.repo) facts.push({ k: "repo", v: repoName(app.repo) });
  if (app?.path) facts.push({ k: "path", v: app.path });
  for (const c of app?.components ?? []) {
    const { name } = splitImage(c.image);
    const tag = shortSha(c.running_tag || c.git_tag);
    facts.push({ k: c.component.replace(`${ing.namespace}-`, ""), v: `ghcr · ${name}:${tag}`, tone: c.status === "in-sync" ? undefined : c.status === "unknown" ? "idle" : "warn" });
  }
  if (routes.length) facts.push({ k: "routes", v: routes.map(([path, svc]) => `${path} → ${svc}`).join(" · "), dim: true });

  return {
    name: ing.namespace,
    kind: PLATFORM[ing.namespace] ?? "app",
    host: ing.address || ing.hosts[0] || ing.name,
    url: ing.address ? `https://${ing.address}` : "",
    tone,
    status: status.join(" · "),
    facts,
  };
}

export function ollamaEntry(gpu: GpuState, fallback: string): Entry {
  const loaded = gpu.resident.map((r) => r.name);
  return {
    name: "ollama",
    kind: "local llm",
    host: gpu.url.replace(/^https?:\/\//, ""),
    url: gpu.url,
    tone: gpu.up ? "ok" : "idle",
    status: gpu.up ? (loaded.length ? `${loaded.join(", ")} in VRAM` : "answering · nothing loaded") : "not answering · local/* offline",
    facts: [
      { k: "api", v: "/api/ps · /api/tags" },
      { k: "via", v: "litellm · local/*" },
      ...(fallback ? [{ k: "fallback", v: fallback, dim: true }] : []),
    ],
  };
}

/** Namespaces that are plumbing, not something you would open as an app. */
const SYSTEM = new Set(["default", "tailscale", "sealed-secrets", "cert-manager", "metallb-system"]);

/** True when `#apps/<namespace>` is a page worth linking to from a pod or workload. */
export function isAppNamespace(namespace: string): boolean {
  return Boolean(namespace) && !namespace.startsWith("kube-") && !SYSTEM.has(namespace);
}
