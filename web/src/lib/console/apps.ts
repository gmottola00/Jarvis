/**
 * What an "app" is to the console: a namespace with a Tailscale ingress, joined
 * with its ArgoCD app and the images Delivery says it runs. Shared by the apps
 * grid and the per-app page.
 */

import type { Tone } from "./derive";
import type { AppDelivery, IngressView, NetworkView } from "./types";
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
