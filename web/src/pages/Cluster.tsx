import { useState } from "react";
import { AttentionPanel } from "../components/cluster/AttentionPanel";
import { EventFeed } from "../components/cluster/EventFeed";
import { NamespaceFilter } from "../components/cluster/NamespaceFilter";
import { NetworkMap } from "../components/cluster/NetworkMap";
import { NodeCard } from "../components/cluster/NodeCard";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import type { Select, Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { WarningLog } from "../components/cluster/WarningLog";
import { WorkloadTable } from "../components/cluster/WorkloadTable";
import { argoTone } from "../components/delivery/status";
import { AlertPanel, BracketTabs, GlowDot, HudPage, HudPanel, LiveStamp, Quiet, Readouts, RefreshButton, type Readout } from "../components/hud";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import { ErrorNote, Learn, Loading } from "../components/ui/primitives";
import { consoleApi } from "../lib/console/api";
import { podHealthy, splitRef, workloadComplete } from "../lib/console/derive";
import { isAppNamespace } from "../lib/console/apps";
import type { ClusterSnapshot, EventRecord, PodDetail } from "../lib/console/types";
import type { ArgoAppStatus } from "../lib/types";
import { href, navigate } from "../lib/route";
import { usePolling } from "../lib/hooks/usePolling";

const SECTIONS = ["health", "nodes", "workloads", "pods", "network", "events"] as const;
type Section = (typeof SECTIONS)[number];

const SNAPSHOT_MS = 10_000;
const DETAIL_MS = 15_000;
const GITOPS_MS = 30_000;
/** Health shows the latest warnings only; the events tab has the rest. */
const HEALTH_WARNINGS = 10;

/**
 * The cluster, read directly — no model in the loop.
 *
 * Health is the landing tab and shows only what needs a look; the inventory
 * (nodes, workloads, pods, network, events) sits one tab away, and the tab is
 * part of the URL (`#cluster/pods`). One `/snapshot` call feeds everything but
 * network, events and GitOps, which are fetched only while their tab is open.
 */
export function Cluster({ tab }: { tab?: string }) {
  const section: Section = SECTIONS.includes(tab as Section) ? (tab as Section) : "health";
  const setSection = (next: Section) => navigate("cluster", next);
  const [namespace, setNamespace] = useState("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const snapshot = usePolling(consoleApi.snapshot, SNAPSHOT_MS);

  const data = snapshot.data;
  // The namespace filter is for the inventory; health always looks at everything.
  const scoped = section !== "health" && section !== "nodes";
  const inScope = <T extends { namespace: string }>(items: T[]) =>
    namespace === "all" || !scoped ? items : items.filter((item) => item.namespace === namespace);

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
    <HudPage
      title="Cluster"
      subtitle="Read-only view of the API server. Every number here is one kubectl command away."
      live={snapshot.refreshing}
      status={<LiveStamp error={Boolean(snapshot.error)} every={SNAPSHOT_MS} at={data?.fetched_at} />}
      actions={<RefreshButton onClick={snapshot.refresh} refreshing={snapshot.refreshing} />}
      overlay={
        <>
          {selection?.kind === "pod" && (
            <PodDrawer namespace={selection.namespace} name={selection.name} workloads={data?.workloads ?? []} onSelect={setSelection} />
          )}
          {selection?.kind === "workload" && (
            <WorkloadDrawer namespace={selection.namespace} name={selection.name} onSelect={setSelection} />
          )}
        </>
      }
    >
      {snapshot.loading && <Loading label="asking the API server…" />}
      <ErrorNote errors={snapshot.error} />
      {data && <ErrorNote errors={data.errors} />}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <BracketTabs
              value={section}
              onChange={setSection}
              tabs={[
                { id: "health", label: unhealthy.length ? "health ⚠" : "health" },
                { id: "nodes", label: "nodes", count: data.nodes.length },
                { id: "workloads", label: "workloads", count: workloads.length },
                { id: "pods", label: "pods", count: allPods.length },
                { id: "network", label: "network" },
                { id: "events", label: "events" },
              ]}
            />
            {scoped && (
              <div className="ml-auto">
                <NamespaceFilter namespaces={data.namespaces} value={namespace} onChange={setNamespace} />
              </div>
            )}
          </div>

          {section === "health" && (
            <Health
              snapshot={data}
              unhealthy={unhealthy}
              warnings={warnings}
              onSelect={setSelection}
              onObject={openRef}
              onAllEvents={() => setSection("events")}
            />
          )}

          {section === "nodes" && (
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
                <HudPanel title="live usage" note="metrics.k8s.io" topic="metrics">
                  <p className="text-xs text-ink-400">
                    Not available: <span className="font-mono text-amber-300">{data.metrics.reason}</span>. The gauges above are
                    requests — reservations — not consumption.
                  </p>
                </HudPanel>
              )}
            </div>
          )}

          {section === "workloads" && (
            <HudPanel title="Workloads" note="deploy · sts · ds" topic="deployment" flush>
              <WorkloadTable workloads={workloads} onSelect={setSelection} />
            </HudPanel>
          )}

          {section === "pods" && (
            <HudPanel
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
            </HudPanel>
          )}

          {section === "network" && <Network namespace={namespace} pods={data.pods} onSelect={setSelection} />}
          {section === "events" && <Events namespace={namespace} onObject={openRef} />}
        </>
      )}
    </HudPage>
  );
}

/**
 * Only what needs a look: the summary strip, then pods that are not ready,
 * GitOps apps that are not Synced/Healthy, firing alerts and the latest
 * warnings. When all of that is empty it says so, once.
 */
function Health({
  snapshot,
  unhealthy,
  warnings,
  onSelect,
  onObject,
  onAllEvents,
}: {
  snapshot: ClusterSnapshot;
  unhealthy: PodDetail[];
  warnings: EventRecord[];
  onSelect: Select;
  onObject: (ns: string, ref: string) => void;
  onAllEvents: () => void;
}) {
  const gitops = usePolling(api.overview, GITOPS_MS);
  const drifting = (gitops.data?.apps ?? []).filter((app) => argoTone(app) !== "ok");
  const firing = gitops.data?.firing_alerts ?? 0;
  const calm = unhealthy.length === 0 && drifting.length === 0 && firing === 0 && warnings.length === 0;

  return (
    <div className="space-y-4">
      <Summary snapshot={snapshot} />
      <ErrorNote errors={gitops.error} />

      {calm && gitops.data ? (
        <HudPanel title="All good">
          <Quiet>Every pod is ready, every ArgoCD app is Synced and Healthy, nothing is firing and there are no warnings.</Quiet>
        </HudPanel>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {unhealthy.length > 0 && <AttentionPanel pods={unhealthy} onSelect={onSelect} />}
          {(drifting.length > 0 || firing > 0) && <GitOps apps={drifting} firing={firing} />}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              <WarningLog events={warnings.slice(0, HEALTH_WARNINGS)} onObject={onObject} />
              {warnings.length > HEALTH_WARNINGS && (
                <button type="button" onClick={onAllEvents} className="font-mono text-[10px] text-sky-300 hover:text-sky-200">
                  all {warnings.length} warnings →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GitOps({ apps, firing }: { apps: ArgoAppStatus[]; firing: number }) {
  return (
    <AlertPanel tone="warn" title="GitOps & alerts" note={`${apps.length} apps · ${firing} firing`} flush>
      <ul className="divide-y divide-amber-400/15 font-mono text-xs">
        {firing > 0 && (
          <li className="px-5 py-3">
            <a href={href("alerts")} className="text-amber-300 hover:text-ink-200">
              › {firing} alert{firing === 1 ? "" : "s"} firing — open alerts
            </a>
          </li>
        )}
        {apps.map((app) => (
          <li key={app.name} className="flex items-center gap-3 px-5 py-3">
            <GlowDot tone={argoTone(app)} size="sm" />
            {isAppNamespace(app.name) ? (
              <a href={href("apps", app.name)} className="text-ink-200 hover:text-ultron-300">
                {app.name}
              </a>
            ) : (
              <span className="text-ink-200">{app.name}</span>
            )}
            <span className={`ml-auto ${TONE[argoTone(app)].text}`}>
              {app.sync} · {app.health}
            </span>
          </li>
        ))}
      </ul>
    </AlertPanel>
  );
}

function Network({ namespace, pods, onSelect }: { namespace: string; pods: PodDetail[]; onSelect: Select }) {
  const network = usePolling(() => consoleApi.network(namespace), DETAIL_MS, namespace);
  return (
    <>
      {network.loading && <Loading />}
      <ErrorNote errors={network.error} />
      {network.data && <NetworkMap network={network.data} pods={pods} onSelect={onSelect} />}
    </>
  );
}

function Events({ namespace, onObject }: { namespace: string; onObject: (ns: string, ref: string) => void }) {
  const events = usePolling(() => consoleApi.events(namespace, 300), DETAIL_MS, namespace);
  return (
    <HudPanel title="Events" note={events.data ? `${events.data.length}` : undefined} topic="events">
      {events.loading && <Loading />}
      <ErrorNote errors={events.error} />
      {events.data && <EventFeed events={events.data} onObject={onObject} showNamespace={namespace === "all"} />}
    </HudPanel>
  );
}

/** The four numbers that answer "is anything wrong" before you scroll, in one framed strip. */
function Summary({ snapshot }: { snapshot: ClusterSnapshot }) {
  const readyNodes = snapshot.nodes.filter((n) => n.ready).length;
  const healthyPods = snapshot.pods.filter(podHealthy).length;
  const complete = snapshot.workloads.filter(workloadComplete).length;
  const restarts = snapshot.pods.reduce((sum, p) => sum + p.restarts, 0);

  const readouts: Readout[] = [
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
      <Readouts readouts={readouts} />
      <Learn topic="namespace" />
    </div>
  );
}
