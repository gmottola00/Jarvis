import { useState } from "react";
import { AttentionPanel } from "../components/cluster/AttentionPanel";
import { EventFeed } from "../components/cluster/EventFeed";
import { BracketTabs, Corners, HudHeading, TONE_COLOR } from "../components/cluster/hud";
import { NamespaceFilter } from "../components/cluster/NamespaceFilter";
import { NetworkMap } from "../components/cluster/NetworkMap";
import { NodeCard } from "../components/cluster/NodeCard";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import type { Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { WarningLog } from "../components/cluster/WarningLog";
import { WorkloadTable } from "../components/cluster/WorkloadTable";
import { UltronCore } from "../components/shell/UltronCore";
import { TONE } from "../components/ui/tone";
import { Dot, ErrorNote, Learn, Loading, Panel } from "../components/ui/primitives";
import { consoleApi } from "../lib/console/api";
import { podHealthy, splitRef, workloadComplete, type Tone } from "../lib/console/derive";
import type { ClusterSnapshot } from "../lib/console/types";
import { clock } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";

type Section = "overview" | "workloads" | "pods" | "network" | "events";

const SNAPSHOT_MS = 10_000;
const DETAIL_MS = 15_000;

/**
 * The cluster, read directly — no model in the loop.
 *
 * One `/snapshot` call feeds the overview, the workload and pod tables and the
 * header stats; network and the full event list are fetched only while their
 * section is open. The namespace filter applies to every section, like `-n`.
 */
export function Cluster() {
  const [section, setSection] = useState<Section>("overview");
  const [namespace, setNamespace] = useState("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const snapshot = usePolling(consoleApi.snapshot, SNAPSHOT_MS);
  const network = usePolling(() => consoleApi.network(namespace), section === "network" ? DETAIL_MS : 0, `${section === "network"}-${namespace}`);
  const events = usePolling(() => consoleApi.events(namespace, 300), section === "events" ? DETAIL_MS : 0, `${section === "events"}-${namespace}`);

  const data = snapshot.data;
  const inScope = <T extends { namespace: string }>(items: T[]) =>
    namespace === "all" ? items : items.filter((item) => item.namespace === namespace);

  const allPods = data ? inScope(data.pods) : [];
  const unhealthy = allPods.filter((p) => !podHealthy(p));
  const pods = problemsOnly ? allPods.filter((p) => !podHealthy(p) || p.restarts > 0) : allPods;
  const workloads = data ? inScope(data.workloads) : [];
  const warnings = data ? inScope(data.warnings) : [];

  const openRef = (ns: string, ref: string) => {
    const [kind, name] = splitRef(ref);
    if (kind === "Pod") setSelection({ kind: "pod", namespace: ns, name });
    else if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) setSelection({ kind: "workload", namespace: ns, name });
  };

  return (
    <div className="relative h-full">
      <div className="hud-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="scanlines absolute inset-0 opacity-40" aria-hidden />
      <div className="relative h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <UltronCore size={44} live={snapshot.refreshing} />
            <div className="min-w-0">
              <h2 className="glow-red font-display text-3xl leading-none font-bold tracking-[0.35em] text-ultron-400">CLUSTER</h2>
              <p className="mt-1.5 text-xs text-ink-500">Read-only view of the API server. Every number here is one kubectl command away.</p>
            </div>
            <div className="ml-auto flex flex-col items-end gap-2">
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.15em] text-ink-600 uppercase">
                <Dot tone={snapshot.error ? "bad" : "ok"} pulse />
                live · poll {SNAPSHOT_MS / 1000}s{data && ` · ${clock(data.fetched_at)}`}
              </span>
              <button
                type="button"
                onClick={snapshot.refresh}
                className="border border-ultron-800 bg-ultron-500/5 px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.15em] text-ultron-300 uppercase hover:border-ultron-500 hover:bg-ultron-500/15"
              >
                {snapshot.refreshing ? "… refreshing" : "↻ refresh"}
              </button>
            </div>
          </header>

          {snapshot.loading && <Loading label="asking the API server…" />}
          <ErrorNote errors={snapshot.error} />
          {data && <ErrorNote errors={data.errors} />}

          {data && (
            <>
              <Summary snapshot={data} />
              <NamespaceFilter namespaces={data.namespaces} value={namespace} onChange={setNamespace} />

              <BracketTabs
                value={section}
                onChange={setSection}
                tabs={[
                  { id: "overview", label: "overview" },
                  { id: "workloads", label: "workloads", count: workloads.length },
                  { id: "pods", label: "pods", count: allPods.length },
                  { id: "network", label: "network" },
                  { id: "events", label: "events" },
                ]}
              />

              {section === "overview" && (
                <div className="space-y-4">
                  {data.nodes.map((node, index) => (
                    <NodeCard
                      key={node.name}
                      node={node}
                      usage={data.metrics.nodes.find((n) => n.name === node.name)}
                      index={index}
                      total={data.nodes.length}
                    />
                  ))}
                  {!data.metrics.available && (
                    <section className="border border-ultron-500/22 bg-ink-900/85">
                      <HudHeading title="live usage" note="metrics.k8s.io" />
                      <Learn topic="metrics" className="mx-5 mt-3" />
                      <p className="px-5 py-3.5 text-xs text-ink-400">
                        Not available: <span className="font-mono text-amber-300">{data.metrics.reason}</span>. The gauges above are
                        requests — reservations — not consumption.
                      </p>
                    </section>
                  )}
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    <AttentionPanel pods={unhealthy} onSelect={setSelection} />
                    <WarningLog events={warnings} onObject={openRef} />
                  </div>
                </div>
              )}

              {section === "workloads" && (
                <Panel title="Workloads" note="deploy · sts · ds" topic="deployment" flush>
                  <WorkloadTable workloads={workloads} onSelect={setSelection} />
                </Panel>
              )}

              {section === "pods" && (
                <Panel
                  title="Pods"
                  topic="pod"
                  actions={
                    <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-600">
                      <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                      problems only
                    </label>
                  }
                  flush
                >
                  <PodTable pods={pods} onSelect={setSelection} showNamespace={namespace === "all"} />
                </Panel>
              )}

              {section === "network" && (
                <>
                  {network.loading && <Loading />}
                  <ErrorNote errors={network.error} />
                  {network.data && <NetworkMap network={network.data} pods={data.pods} onSelect={setSelection} />}
                </>
              )}

              {section === "events" && (
                <Panel title="Events" note={events.data ? `${events.data.length}` : undefined} topic="events">
                  {events.loading && <Loading />}
                  <ErrorNote errors={events.error} />
                  {events.data && <EventFeed events={events.data} onObject={openRef} showNamespace={namespace === "all"} />}
                </Panel>
              )}
            </>
          )}
        </div>
      </div>

      {selection?.kind === "pod" && (
        <PodDrawer namespace={selection.namespace} name={selection.name} workloads={data?.workloads ?? []} onSelect={setSelection} />
      )}
      {selection?.kind === "workload" && (
        <WorkloadDrawer namespace={selection.namespace} name={selection.name} onSelect={setSelection} />
      )}
    </div>
  );
}

/** Under a readout that needs a look: the tone's colour, as a 2px rule. */
const UNDERLINE: Partial<Record<Tone, string>> = { warn: "border-b-amber-400/60", bad: "border-b-rose-400/60" };

/** The four numbers that answer "is anything wrong" before you scroll, in one framed strip. */
function Summary({ snapshot }: { snapshot: ClusterSnapshot }) {
  const readyNodes = snapshot.nodes.filter((n) => n.ready).length;
  const healthyPods = snapshot.pods.filter(podHealthy).length;
  const complete = snapshot.workloads.filter(workloadComplete).length;
  const restarts = snapshot.pods.reduce((sum, p) => sum + p.restarts, 0);

  const readouts: { label: string; value: string; sub: string; tone: Tone }[] = [
    {
      label: "nodes",
      value: `${readyNodes}/${snapshot.nodes.length}`,
      tone: readyNodes === snapshot.nodes.length ? "ok" : "bad",
      sub: snapshot.nodes.map((n) => n.version).filter((v, i, all) => all.indexOf(v) === i).join(", "),
    },
    {
      label: "pods healthy",
      value: `${healthyPods}/${snapshot.pods.length}`,
      tone: healthyPods === snapshot.pods.length ? "ok" : "warn",
      sub: `${restarts} restarts in total`,
    },
    {
      label: "rollouts complete",
      value: `${complete}/${snapshot.workloads.length}`,
      tone: complete === snapshot.workloads.length ? "ok" : "warn",
      sub: `${snapshot.namespaces.length} namespaces`,
    },
    {
      label: "warnings",
      value: String(snapshot.warnings.length),
      tone: snapshot.warnings.length ? "warn" : "ok",
      sub: snapshot.warnings[0] ? `latest: ${snapshot.warnings[0].reason}` : "quiet",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="relative grid grid-cols-2 gap-px border border-ultron-500/22 bg-ultron-500/15 lg:grid-cols-4">
        <Corners />
        {readouts.map((r) => (
          <div
            key={r.label}
            className={`flex min-w-0 flex-col gap-1.5 border-b-2 border-b-transparent bg-ink-900 bg-linear-to-b from-ultron-500/6 to-transparent to-70% px-6 py-5 ${UNDERLINE[r.tone] ?? ""}`}
          >
            <p className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.2em] whitespace-nowrap text-ink-500 uppercase">
              <span className={`size-1.5 ${TONE[r.tone].dot}`} style={{ boxShadow: `0 0 6px ${TONE_COLOR[r.tone]}` }} />
              {r.label}
            </p>
            <p
              className={`font-display text-4xl leading-none font-bold lg:text-5xl ${TONE[r.tone].text}`}
              style={{ textShadow: "0 0 18px color-mix(in oklch, currentColor 35%, transparent)" }}
            >
              {r.value}
            </p>
            <p className="truncate font-mono text-[11px] text-ink-600">{r.sub}</p>
          </div>
        ))}
      </div>
      <Learn topic="namespace" />
    </div>
  );
}
