import { useState } from "react";
import { AttentionPanel } from "../components/cluster/AttentionPanel";
import { EventFeed } from "../components/cluster/EventFeed";
import { NamespaceFilter } from "../components/cluster/NamespaceFilter";
import { NetworkMap } from "../components/cluster/NetworkMap";
import { NodeCard } from "../components/cluster/NodeCard";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import type { Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { WarningLog } from "../components/cluster/WarningLog";
import { WorkloadTable } from "../components/cluster/WorkloadTable";
import { BracketTabs, HudPage, HudPanel, LiveStamp, Readouts, RefreshButton, type Readout } from "../components/hud";
import { ErrorNote, Learn, Loading } from "../components/ui/primitives";
import { consoleApi } from "../lib/console/api";
import { podHealthy, splitRef, workloadComplete } from "../lib/console/derive";
import type { ClusterSnapshot } from "../lib/console/types";
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
                <HudPanel title="live usage" note="metrics.k8s.io" topic="metrics">
                  <p className="text-xs text-ink-400">
                    Not available: <span className="font-mono text-amber-300">{data.metrics.reason}</span>. The gauges above are
                    requests — reservations — not consumption.
                  </p>
                </HudPanel>
              )}
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <AttentionPanel pods={unhealthy} onSelect={setSelection} />
                <WarningLog events={warnings} onObject={openRef} />
              </div>
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

          {section === "network" && (
            <>
              {network.loading && <Loading />}
              <ErrorNote errors={network.error} />
              {network.data && <NetworkMap network={network.data} pods={data.pods} onSelect={setSelection} />}
            </>
          )}

          {section === "events" && (
            <HudPanel title="Events" note={events.data ? `${events.data.length}` : undefined} topic="events">
              {events.loading && <Loading />}
              <ErrorNote errors={events.error} />
              {events.data && <EventFeed events={events.data} onObject={openRef} showNamespace={namespace === "all"} />}
            </HudPanel>
          )}
        </>
      )}
    </HudPage>
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
