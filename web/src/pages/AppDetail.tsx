import { useState } from "react";
import { EventFeed } from "../components/cluster/EventFeed";
import { LogViewer } from "../components/cluster/LogViewer";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import type { Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { ComponentRow } from "../components/delivery/ComponentRow";
import { argoTone } from "../components/delivery/status";
import { BracketTabs, GlowDot, HudPage, HudPanel, LiveStamp, RefreshButton } from "../components/hud";
import { Empty, ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import { consoleApi } from "../lib/console/api";
import { ingressEntries } from "../lib/console/apps";
import { podHealthy, splitRef, workloadTone } from "../lib/console/derive";
import type { PodDetail, WorkloadSummary } from "../lib/console/types";
import { shortSha, splitImage } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";
import { href, navigate } from "../lib/route";

const TABS = ["logs", "pods", "delivery", "events"] as const;
type AppTab = (typeof TABS)[number];

const PODS_MS = 10_000;
const HEADER_MS = 60_000;

/** `tickup-backend` in namespace `tickup` reads as `backend`. */
function short(workload: string, namespace: string): string {
  return workload.startsWith(`${namespace}-`) ? workload.slice(namespace.length + 1) : workload;
}

function ownedBy(pods: PodDetail[], w: WorkloadSummary): PodDetail[] {
  const bySelector = pods.filter((p) => Object.entries(w.selector).every(([k, v]) => p.labels[k] === v));
  return Object.keys(w.selector).length && bySelector.length ? bySelector : pods.filter((p) => p.name.startsWith(`${w.name}-`));
}

/** The backend first: that is the log you open an app for nine times out of ten. */
function defaultComponent(workloads: WorkloadSummary[]): string {
  return (workloads.find((w) => /backend|api|server/.test(w.name)) ?? workloads[0])?.name ?? "";
}

/**
 * One app — a namespace — with its logs one click from the apps grid.
 *
 * Logs are the default tab and follow a whole workload, every replica merged,
 * with kubelet probe noise dropped. Pods, delivery and events are the next
 * questions, each a tab that only fetches while it is open.
 */
export function AppDetail({ name, tab: rawTab }: { name: string; tab?: string }) {
  const tab: AppTab = TABS.includes(rawTab as AppTab) ? (rawTab as AppTab) : "logs";
  const [selection, setSelection] = useState<Selection>(null);

  const workloads = usePolling(() => consoleApi.workloads(name), PODS_MS, name);
  const pods = usePolling(() => consoleApi.pods(name), PODS_MS, name);
  const network = usePolling(() => consoleApi.network(name), HEADER_MS, name);
  const overview = usePolling(api.overview, HEADER_MS);

  const argo = overview.data?.apps.find((a) => a.name === name);
  const entry = network.data ? ingressEntries(network.data, argo ? [argo] : [], [])[0] : undefined;
  const allWorkloads = workloads.data ?? [];
  const allPods = pods.data ?? [];
  const unhealthy = allPods.filter((p) => !podHealthy(p)).length;
  const refreshing = workloads.refreshing || pods.refreshing;

  const openRef = (ns: string, ref: string) => {
    const [kind, obj] = splitRef(ref);
    if (kind === "Pod") setSelection({ kind: "pod", namespace: ns, name: obj });
    else if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) setSelection({ kind: "workload", namespace: ns, name: obj });
  };

  return (
    <HudPage
      title={name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={href("apps")} className="font-mono text-ink-500 hover:text-ink-200">
            ← apps
          </a>
          {entry?.host && <span className="font-mono text-ink-500">{entry.host}</span>}
          {argo && (
            <span className={`font-mono ${TONE[argoTone(argo)].text}`}>
              argo {argo.sync} · {argo.health}
            </span>
          )}
        </span>
      }
      live={refreshing}
      status={<LiveStamp error={Boolean(workloads.error || pods.error)} every={PODS_MS} />}
      actions={
        <>
          {entry?.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center border border-ultron-500/70 bg-ultron-500/10 px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.2em] text-ultron-300 uppercase hover:bg-ultron-500/22 hover:text-ink-200"
            >
              open ↗
            </a>
          )}
          <RefreshButton onClick={() => [workloads, pods, network].forEach((p) => p.refresh())} refreshing={refreshing} />
        </>
      }
      overlay={
        <>
          {selection?.kind === "pod" && (
            <PodDrawer namespace={selection.namespace} name={selection.name} workloads={allWorkloads} onSelect={setSelection} />
          )}
          {selection?.kind === "workload" && (
            <WorkloadDrawer namespace={selection.namespace} name={selection.name} onSelect={setSelection} />
          )}
        </>
      }
    >
      <ErrorNote errors={workloads.error} />

      <Components workloads={allWorkloads} pods={allPods} onSelect={setSelection} />

      <BracketTabs
        value={tab}
        onChange={(next) => navigate("apps", name, next)}
        tabs={[
          { id: "logs", label: "logs" },
          { id: "pods", label: unhealthy ? `pods ⚠` : "pods", count: allPods.length },
          { id: "delivery", label: "delivery" },
          { id: "events", label: "events" },
        ]}
      />

      {tab === "logs" &&
        (workloads.loading ? (
          <Loading label="finding the workloads…" />
        ) : allWorkloads.length === 0 ? (
          <Empty>No workloads in namespace {name}.</Empty>
        ) : (
          <Logs namespace={name} workloads={allWorkloads} pods={allPods} />
        ))}

      {tab === "pods" && (
        <HudPanel title="Pods" topic="pod" flush>
          {pods.loading && <Loading />}
          <ErrorNote errors={pods.error} />
          <PodTable pods={allPods} onSelect={setSelection} showNamespace={false} />
        </HudPanel>
      )}

      {tab === "delivery" && <Delivery name={name} />}
      {tab === "events" && <Events namespace={name} onObject={openRef} />}
    </HudPage>
  );
}

/** One chip per workload: ready count and the image tag it runs. Click to open its drawer. */
function Components({
  workloads,
  pods,
  onSelect,
}: {
  workloads: WorkloadSummary[];
  pods: PodDetail[];
  onSelect: (s: Selection) => void;
}) {
  if (!workloads.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {workloads.map((w) => {
        const restarts = ownedBy(pods, w).reduce((sum, p) => sum + p.restarts, 0);
        const tone = workloadTone(w);
        return (
          <button
            key={w.name}
            type="button"
            onClick={() => onSelect({ kind: "workload", namespace: w.namespace, name: w.name })}
            className="flex items-center gap-2.5 border border-ultron-500/22 bg-ink-900/85 px-3 py-2 text-left hover:border-ultron-500/50"
          >
            <GlowDot tone={tone} size="sm" />
            <span className="font-display text-sm font-semibold tracking-[0.12em] text-ink-200">{short(w.name, w.namespace)}</span>
            <span className={`font-mono text-[11px] ${TONE[tone].text}`}>
              {w.ready}/{w.desired}
            </span>
            {w.images.map((img) => (
              <span key={img} className="font-mono text-[11px] text-ink-500" title={img}>
                :{shortSha(splitImage(img).tag)}
              </span>
            ))}
            {restarts > 0 && <span className="font-mono text-[11px] text-amber-300">↻{restarts}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Logs({ namespace, workloads, pods }: { namespace: string; workloads: WorkloadSummary[]; pods: PodDetail[] }) {
  const [component, setComponent] = useState(() => defaultComponent(workloads));
  const workload = workloads.find((w) => w.name === component) ?? workloads[0];
  const sample = ownedBy(pods, workload)[0];
  const containers = sample?.containers.map((c) => c.name) ?? [];

  return (
    <section className="flex h-[calc(100vh-15rem)] min-h-[28rem] flex-col border border-ultron-500/22 bg-ink-900/85">
      {workloads.length > 1 && (
        <div className="flex gap-1.5 border-b border-ink-850 px-5 py-2">
          {workloads.map((w) => (
            <button
              key={w.name}
              type="button"
              onClick={() => setComponent(w.name)}
              className={`px-2.5 py-1 font-mono text-[11px] ${
                w.name === workload.name ? "bg-ultron-500/10 text-ultron-300 ring-1 ring-ultron-500/40" : "text-ink-500 hover:text-ink-200"
              }`}
            >
              {short(w.name, namespace)}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <LogViewer
          // A new component, or containers appearing once pods load, starts a fresh viewer.
          key={`${workload.name}:${containers.join(",")}`}
          source={{ kind: "workload", namespace, workload: workload.name, containers }}
        />
      </div>
    </section>
  );
}

const DELIVERY_MS = 30_000;

function Delivery({ name }: { name: string }) {
  const { data, error, loading } = usePolling(consoleApi.delivery, DELIVERY_MS);
  const app = data?.apps.find((a) => a.name === name);
  return (
    <HudPanel title="Delivery" note="built · green · pinned · running">
      {loading && <Loading label="asking ArgoCD, GitHub and GHCR…" />}
      <ErrorNote errors={error} />
      {data && !app && <Empty>{name} is not an ArgoCD app.</Empty>}
      {app && app.components.length === 0 && <Empty>{app.note || "No pinned images."}</Empty>}
      {app && (
        <div className="space-y-3">
          {app.components.map((component) => (
            <ComponentRow key={component.image} component={component} path={app.path || `apps/${app.name}`} />
          ))}
        </div>
      )}
    </HudPanel>
  );
}

const EVENTS_MS = 15_000;

function Events({ namespace, onObject }: { namespace: string; onObject: (ns: string, ref: string) => void }) {
  const { data, error, loading } = usePolling(() => consoleApi.events(namespace, 200), EVENTS_MS, namespace);
  return (
    <HudPanel title="Events" note={data ? `${data.length}` : undefined} topic="events">
      {loading && <Loading />}
      <ErrorNote errors={error} />
      {data && <EventFeed events={data} onObject={onObject} showNamespace={false} />}
    </HudPanel>
  );
}
