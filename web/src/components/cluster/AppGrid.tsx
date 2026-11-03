import { GlowDot, LiveStamp, ToneCard } from "../hud";
import { ErrorNote, Loading } from "../ui/primitives";
import { TONE } from "../ui/tone";
import { api } from "../../lib/api";
import { consoleApi } from "../../lib/console/api";
import { clusterEntries, ollamaEntry, type Entry } from "../../lib/console/apps";
import { usePolling } from "../../lib/hooks/usePolling";
import { href } from "../../lib/route";

/** Delivery asks GHCR and GitHub on every call; a minute keeps it cheap. */
const POLL_MS = 60_000;

/**
 * Everything that runs in the lab, one click away: each Tailscale ingress,
 * joined with its ArgoCD app, what its routes land on and which image each
 * component is running, then every ArgoCD app with no tailnet address (a
 * database, an internal service) as a cluster-only card. The GPU desktop's
 * Ollama sits off the cluster and comes from the models probe.
 */
export function AppGrid() {
  const network = usePolling(() => consoleApi.network(), POLL_MS);
  const delivery = usePolling(consoleApi.delivery, POLL_MS);
  const models = usePolling(api.models, POLL_MS);

  const refreshing = network.refreshing || delivery.refreshing || models.refreshing;
  const refresh = () => [network, delivery, models].forEach((p) => p.refresh());
  const errors = Object.fromEntries(
    Object.entries({ network: network.error, delivery: delivery.error, models: models.error }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );

  const entries = network.data ? clusterEntries(network.data, delivery.data?.apps ?? []) : [];
  const tailnet = entries.filter((e) => e.url).map((e) => e.host.split(".").slice(1).join(".")).find(Boolean);
  const gpu = models.data?.gpu;
  const groups = [
    { title: "apps", note: "argocd · on the tailnet or cluster only", items: entries.filter((e) => e.kind === "app") },
    { title: "platform", note: "what runs the lab", items: entries.filter((e) => e.kind !== "app") },
    { title: "off cluster", note: "on the tailnet, not in k3s", items: gpu ? [ollamaEntry(gpu, models.data?.fallback ?? "")] : [] },
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <LiveStamp error={Object.keys(errors).length > 0} every={POLL_MS} at={delivery.data?.fetched_at} />
        <span className="font-mono text-[11px] text-ink-500">argocd apps × tailscale ingresses + cluster-only{tailnet ? ` · ${tailnet}` : ""}</span>
        <button
          type="button"
          onClick={refresh}
          className="ml-auto font-mono text-[11px] text-ink-500 hover:text-ink-200"
          disabled={refreshing}
        >
          {refreshing ? "… refreshing" : "↻ refresh"}
        </button>
      </div>
      {network.loading && <Loading label="listing ingresses…" />}
      <ErrorNote errors={Object.keys(errors).length ? errors : null} />
      {delivery.data && <ErrorNote errors={delivery.data.errors["argocd"] ? { argocd: delivery.data.errors["argocd"] } : null} />}

      {network.data && groups.length === 0 && <p className="text-xs text-ink-500">No tailscale ingress and no ArgoCD app.</p>}

      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span aria-hidden className="h-3.5 w-[3px] bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" />
            <h3 className="font-display text-[15px] font-bold tracking-[0.28em] text-ink-300 uppercase">{group.title}</h3>
            <span className="font-mono text-[11px] text-ink-600">{group.note}</span>
            <span aria-hidden className="hidden h-px flex-1 bg-ultron-500/15 sm:block" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((entry) => (
              <AppCard key={entry.name} entry={entry} inCluster={group.title !== "off cluster"} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AppCard({ entry, inCluster }: { entry: Entry; inCluster: boolean }) {
  const off = !entry.url || entry.tone === "idle";
  return (
    <ToneCard
      className="flex flex-col"
      tone={entry.tone === "ok" ? "idle" : entry.tone}
      header={
        <>
          <GlowDot tone={entry.tone} />
          {inCluster ? (
            <a
              href={href("cluster", "apps", entry.name)}
              className="font-display text-xl leading-none font-bold tracking-[0.12em] text-ink-200 hover:text-ultron-300"
              title={`Open ${entry.name}: logs, pods, delivery, events`}
            >
              {entry.name} <span className="font-mono text-sm text-ink-600">→</span>
            </a>
          ) : (
            <span className="font-display text-xl leading-none font-bold tracking-[0.12em] text-ink-200">{entry.name}</span>
          )}
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
            <span className={`min-w-0 [overflow-wrap:anywhere] md:truncate ${f.tone ? TONE[f.tone].text : f.dim ? "text-ink-400" : "text-ink-300"}`} title={f.v}>
              {f.v}
            </span>
          </p>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-3 border-t border-ink-850 px-4 py-3">
        <span className={`text-xs leading-snug ${entry.tone === "ok" ? "text-ink-500" : TONE[entry.tone].text}`}>{entry.status}</span>
        {inCluster && (
          <a
            href={href("cluster", "apps", entry.name, "logs")}
            className="ml-auto flex shrink-0 items-center border border-ink-700 px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.2em] text-ink-300 uppercase hover:border-ink-500 hover:text-ink-200"
          >
            logs
          </a>
        )}
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className={`${inCluster ? "" : "ml-auto "}flex shrink-0 items-center gap-2 border px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.2em] uppercase ${
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
