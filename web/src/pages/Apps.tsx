import { GlowDot, HudPage, LiveStamp, RefreshButton, ToneCard } from "../components/hud";
import { ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import { consoleApi } from "../lib/console/api";
import type { Tone } from "../lib/console/derive";
import type { AppDelivery, IngressView, NetworkView } from "../lib/console/types";
import { shortSha, splitImage } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";
import type { ArgoAppStatus, GpuState } from "../lib/types";

/** Delivery asks GHCR and GitHub on every call; a minute keeps it cheap. */
const POLL_MS = 60_000;

/** Namespaces that run the lab rather than live in it, and what each one is. Anything else is an app. */
const PLATFORM: Record<string, string> = {
  argocd: "gitops",
  litellm: "gateway",
  monitoring: "metrics",
  observability: "metrics",
  grafana: "metrics",
  jarvis: "agent",
};

interface Fact {
  k: string;
  v: string;
  tone?: Tone;
  dim?: boolean;
}

interface Entry {
  name: string;
  kind: string;
  host: string;
  /** Empty while the operator has not handed out a tailnet address yet. */
  url: string;
  tone: Tone;
  status: string;
  facts: Fact[];
}

/**
 * Everything with an address on the tailnet, one click away: each Tailscale
 * ingress, joined with its ArgoCD app, what its routes land on and which image
 * each component is running. The GPU desktop's Ollama sits off the cluster and
 * comes from the models probe.
 */
export function Apps() {
  const network = usePolling(() => consoleApi.network(), POLL_MS);
  const lab = usePolling(api.overview, POLL_MS);
  const delivery = usePolling(consoleApi.delivery, POLL_MS);
  const models = usePolling(api.models, POLL_MS);

  const refreshing = network.refreshing || lab.refreshing || delivery.refreshing || models.refreshing;
  const refresh = () => [network, lab, delivery, models].forEach((p) => p.refresh());
  const errors = Object.fromEntries(
    Object.entries({ network: network.error, argocd: lab.error, delivery: delivery.error, models: models.error }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );

  const entries = network.data ? ingressEntries(network.data, lab.data?.apps ?? [], delivery.data?.apps ?? []) : [];
  const tailnet = entries.map((e) => e.host.split(".").slice(1).join(".")).find(Boolean);
  const gpu = models.data?.gpu;
  const groups = [
    { title: "apps", note: "argocd · ingressClassName tailscale", items: entries.filter((e) => e.kind === "app") },
    { title: "platform", note: "what runs the lab", items: entries.filter((e) => e.kind !== "app") },
    { title: "off cluster", note: "on the tailnet, not in k3s", items: gpu ? [ollamaEntry(gpu, models.data?.fallback ?? "")] : [] },
  ].filter((g) => g.items.length);

  return (
    <HudPage
      title="Apps"
      subtitle="Everything with an address on the tailnet, one click away."
      live={refreshing}
      status={
        <>
          <LiveStamp error={Object.keys(errors).length > 0} every={POLL_MS} at={lab.data?.fetched_at} />
          <span className="font-mono text-[11px] text-ink-500">argocd apps × tailscale ingresses{tailnet ? ` · ${tailnet}` : ""}</span>
        </>
      }
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      {network.loading && <Loading label="listing ingresses…" />}
      <ErrorNote errors={Object.keys(errors).length ? errors : null} />
      {/* The overview also asks nodes, pods and Alertmanager; only its ArgoCD answer is used here. */}
      <ErrorNote errors={lab.data?.errors["argocd.apps"] ? { "argocd.apps": lab.data.errors["argocd.apps"] } : null} />

      {network.data && groups.length === 0 && <p className="text-xs text-ink-500">No ingress has ingressClassName tailscale.</p>}

      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="h-3.5 w-[3px] bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" />
            <h3 className="font-display text-[15px] font-bold tracking-[0.28em] text-ink-300 uppercase">{group.title}</h3>
            <span className="font-mono text-[11px] text-ink-600">{group.note}</span>
            <span aria-hidden className="h-px flex-1 bg-ultron-500/15" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((entry) => (
              <AppCard key={entry.name} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </HudPage>
  );
}

/** `trip-ai.tail9c2f1.ts.net/api → trip-ai-backend:8000` → `["/api", "trip-ai-backend"]`. */
function parseRule(rule: string): [string, string] {
  const [from, to = ""] = rule.split(" → ");
  const slash = from.indexOf("/");
  return [slash < 0 ? "/" : from.slice(slash), to.split(":")[0]];
}

function repoName(url: string): string {
  return url.replace(/^(https?:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, "");
}

function ingressEntries(network: NetworkView, argo: ArgoAppStatus[], delivery: AppDelivery[]): Entry[] {
  return network.ingresses
    .filter((ing) => ing.class_name === "tailscale")
    .map((ing) => ingressEntry(ing, network, argo.find((a) => a.name === ing.namespace), delivery.find((d) => d.name === ing.namespace)));
}

function ingressEntry(ing: IngressView, network: NetworkView, app: ArgoAppStatus | undefined, delivery: AppDelivery | undefined): Entry {
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
  for (const c of delivery?.components ?? []) {
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

function ollamaEntry(gpu: GpuState, fallback: string): Entry {
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

function AppCard({ entry }: { entry: Entry }) {
  const off = !entry.url || entry.tone === "idle";
  return (
    <ToneCard
      className="flex flex-col"
      tone={entry.tone === "ok" ? "idle" : entry.tone}
      header={
        <>
          <GlowDot tone={entry.tone} />
          <span className="font-display text-xl leading-none font-bold tracking-[0.12em] text-ink-200">{entry.name}</span>
          <span className="ml-auto border border-ink-800 px-2 py-px font-display text-[11px] font-semibold tracking-[0.18em] text-ink-400 uppercase">
            {entry.kind}
          </span>
        </>
      }
    >
      <p className="px-4 pt-2.5 font-mono text-xs [overflow-wrap:anywhere] text-ink-500">{entry.host}</p>
      <div className="flex flex-col gap-1.5 px-4 pt-2.5 pb-3.5 font-mono text-[11.5px]">
        {entry.facts.map((f) => (
          <p key={f.k} className="flex gap-2">
            <span className="w-16 shrink-0 text-ink-600">{f.k}</span>
            <span className={`min-w-0 truncate ${f.tone ? TONE[f.tone].text : f.dim ? "text-ink-400" : "text-ink-300"}`} title={f.v}>
              {f.v}
            </span>
          </p>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-3 border-t border-ink-850 px-4 py-3">
        <span className={`text-xs leading-snug ${entry.tone === "ok" ? "text-ink-500" : TONE[entry.tone].text}`}>{entry.status}</span>
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className={`ml-auto flex shrink-0 items-center gap-2 border px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.2em] uppercase ${
              off
                ? "border-ink-800 text-ink-600 hover:text-ink-300"
                : "border-ultron-500/70 bg-ultron-500/10 text-ultron-300 hover:bg-ultron-500/22 hover:text-ink-200"
            }`}
          >
            open<span className="font-mono text-[13px] tracking-normal">↗</span>
          </a>
        )}
      </div>
    </ToneCard>
  );
}
