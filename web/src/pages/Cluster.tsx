import { useState } from "react";
import { AppGrid } from "../components/cluster/AppGrid";
import { NamespaceFilter } from "../components/cluster/NamespaceFilter";
import { NamespaceEvents, NamespaceNetwork } from "../components/cluster/NamespacePanels";
import { NodeCard } from "../components/cluster/NodeCard";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import { refOpener, type Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { WorkloadTable } from "../components/cluster/WorkloadTable";
import { BracketTabs, HudPage, HudPanel, LiveStamp, RefreshButton } from "../components/hud";
import { ErrorNote, Learn, LearnCommand, Loading } from "../components/ui/primitives";
import { consoleApi } from "../lib/console/api";
import { podHealthy } from "../lib/console/derive";
import { kubectl } from "../lib/console/kubectl";
import { usePolling } from "../lib/hooks/usePolling";
import { navigate } from "../lib/route";

const SECTIONS = ["apps", "workloads", "pods", "nodes", "network", "events"] as const;
type Section = (typeof SECTIONS)[number];
type Inventory = Exclude<Section, "apps">;

const SNAPSHOT_MS = 10_000;

/**
 * What runs in the lab, read directly — no model in the loop.
 *
 * Apps come first: that is what you open the cluster for, and every app card
 * is one click from its logs. The inventory (workloads, pods, nodes, network,
 * events) sits one tab away; the tab is part of the URL (`#cluster/pods`).
 * Whether anything is wrong is the status page's question, not this one's.
 */
export function Cluster({ tab }: { tab?: string }) {
  const section: Section = SECTIONS.includes(tab as Section) ? (tab as Section) : "apps";

  return (
    <HudPage title="Cluster" subtitle="Apps and the Kubernetes objects behind them. Every number here is one kubectl command away.">
      <BracketTabs
        value={section}
        onChange={(next) => navigate("cluster", next)}
        tabs={SECTIONS.map((id) => ({ id, label: id }))}
      />
      {section === "apps" ? (
        <>
          <Learn topic="ingress" />
          <LearnCommand command={kubectl.apps()} />
          <AppGrid />
        </>
      ) : (
        <InventoryView section={section} />
      )}
    </HudPage>
  );
}

/** The kubectl-get half: one `/snapshot` poll feeds every table, drawers open on top. */
function InventoryView({ section }: { section: Inventory }) {
  const [namespace, setNamespace] = useState("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const snapshot = usePolling(consoleApi.snapshot, SNAPSHOT_MS);
  const data = snapshot.data;
  const scoped = section !== "nodes";
  const inScope = <T extends { namespace: string }>(items: T[]) =>
    namespace === "all" ? items : items.filter((item) => item.namespace === namespace);

  const allPods = data ? inScope(data.pods) : [];
  const pods = problemsOnly ? allPods.filter((p) => !podHealthy(p) || p.restarts > 0) : allPods;
  const workloads = data ? inScope(data.workloads) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <LiveStamp error={Boolean(snapshot.error)} every={SNAPSHOT_MS} at={data?.fetched_at} />
        {data && scoped && <NamespaceFilter namespaces={data.namespaces} value={namespace} onChange={setNamespace} />}
        <span className="ml-auto">
          <RefreshButton onClick={snapshot.refresh} refreshing={snapshot.refreshing} />
        </span>
      </div>
      <LearnCommand command={kubectl.section(section, namespace)} />

      {snapshot.loading && <Loading label="asking the API server…" />}
      <ErrorNote errors={snapshot.error} />
      {data && <ErrorNote errors={data.errors} />}

      {data && section === "nodes" && (
        <div className="space-y-4">
          <Learn topic="node" />
          {data.nodes.map((node, index) => (
            <NodeCard key={node.name} node={node} usage={data.metrics.nodes.find((n) => n.name === node.name)} index={index} total={data.nodes.length} />
          ))}
          {!data.metrics.available && (
            <HudPanel title="live usage" note="metrics.k8s.io" topic="metrics">
              <p className="text-xs text-ink-400">
                Not available: <span className="font-mono text-amber-300">{data.metrics.reason}</span>. The gauges above are requests —
                reservations — not consumption.
              </p>
            </HudPanel>
          )}
        </div>
      )}

      {data && section === "workloads" && (
        <HudPanel title="Workloads" note="deploy · sts · ds" topic="deployment" flush>
          <WorkloadTable workloads={workloads} onSelect={setSelection} />
        </HudPanel>
      )}

      {data && section === "pods" && (
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

      {data && section === "network" && <NamespaceNetwork namespace={namespace} pods={data.pods} onSelect={setSelection} />}
      {section === "events" && <NamespaceEvents namespace={namespace} onObject={refOpener(setSelection)} />}

      {selection?.kind === "pod" && (
        <PodDrawer namespace={selection.namespace} name={selection.name} workloads={data?.workloads ?? []} onSelect={setSelection} />
      )}
      {selection?.kind === "workload" && <WorkloadDrawer namespace={selection.namespace} name={selection.name} onSelect={setSelection} />}
    </div>
  );
}
