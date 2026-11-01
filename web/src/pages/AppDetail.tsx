import { useState } from "react";
import { AppComponents } from "../components/app/AppComponents";
import { AppLogs } from "../components/app/AppLogs";
import { ResourceMap } from "../components/app/ResourceMap";
import { NamespaceEvents } from "../components/cluster/NamespacePanels";
import { PodDrawer } from "../components/cluster/PodDrawer";
import { PodTable } from "../components/cluster/PodTable";
import { refOpener, type Selection } from "../components/cluster/selection";
import { WorkloadDrawer } from "../components/cluster/WorkloadDrawer";
import { ComponentRow } from "../components/delivery/ComponentRow";
import { argoTone } from "../components/delivery/status";
import { BracketTabs, HudPage, HudPanel, LiveStamp, RefreshButton } from "../components/hud";
import { Empty, ErrorNote, LearnCommand, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { consoleApi } from "../lib/console/api";
import { appNamespace, namespaceEntry } from "../lib/console/apps";
import { podHealthy } from "../lib/console/derive";
import { kubectl } from "../lib/console/kubectl";
import type { AppDelivery } from "../lib/console/types";
import { usePolling } from "../lib/hooks/usePolling";
import { href, navigate } from "../lib/route";

const TABS = ["logs", "pods", "map", "delivery", "events"] as const;
type AppTab = (typeof TABS)[number];

const PODS_MS = 10_000;
/** Delivery asks GHCR and GitHub on every call; it feeds the header and the delivery tab. */
const DELIVERY_MS = 60_000;

/**
 * One app — a namespace — with its logs one click from the apps grid.
 *
 * Logs are the default tab and follow a whole workload, every replica merged,
 * with kubelet probe noise dropped. Pods, map, delivery and events are the
 * next questions; the tab and the log component are part of the URL.
 */
export function AppDetail({ name, tab: rawTab, component }: { name: string; tab?: string; component?: string }) {
  const tab: AppTab = TABS.includes(rawTab as AppTab) ? (rawTab as AppTab) : "logs";
  const [selection, setSelection] = useState<Selection>(null);

  const workloads = usePolling(() => consoleApi.workloads(name), PODS_MS, name);
  const pods = usePolling(() => consoleApi.pods(name), PODS_MS, name);
  const network = usePolling(() => consoleApi.network(name), DELIVERY_MS, name);
  const delivery = usePolling(consoleApi.delivery, DELIVERY_MS);

  const apps = delivery.data?.apps ?? [];
  const app = apps.find((a) => a.name === name) ?? apps.find((a) => appNamespace(a) === name);
  const entry = network.data ? namespaceEntry(name, network.data, apps) : undefined;
  const allWorkloads = workloads.data ?? [];
  const allPods = pods.data ?? [];
  const unhealthy = allPods.filter((p) => !podHealthy(p)).length;
  const refreshing = workloads.refreshing || pods.refreshing;

  return (
    <HudPage
      title={name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={href("cluster", "apps")} className="font-mono text-ink-500 hover:text-ink-200">
            ← apps
          </a>
          {entry?.host && <span className="font-mono text-ink-500">{entry.host}</span>}
          {app && (
            <span className={`font-mono ${TONE[argoTone(app)].text}`}>
              argo {app.sync} · {app.health}
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
          <RefreshButton onClick={() => [workloads, pods, network, delivery].forEach((p) => p.refresh())} refreshing={refreshing} />
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

      <AppComponents workloads={allWorkloads} pods={allPods} onSelect={setSelection} />

      <BracketTabs
        value={tab}
        onChange={(next) => navigate("cluster", "apps", name, next)}
        tabs={[
          { id: "logs", label: "logs" },
          { id: "pods", label: unhealthy ? `pods ⚠` : "pods", count: allPods.length },
          { id: "map", label: "map" },
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
          <AppLogs namespace={name} workloads={allWorkloads} pods={allPods} initial={component} />
        ))}

      {tab === "pods" && (
        <HudPanel title="Pods" topic="pod" flush>
          <div className="px-5">
            <LearnCommand command={kubectl.appPods(name)} />
          </div>
          {pods.loading && <Loading />}
          <ErrorNote errors={pods.error} />
          <PodTable pods={allPods} onSelect={setSelection} showNamespace={false} />
        </HudPanel>
      )}

      {tab === "map" && <ResourceMap namespace={name} workloads={allWorkloads} pods={allPods} onSelect={setSelection} />}

      {tab === "delivery" && (
        <DeliveryPanel name={name} app={app} loading={delivery.loading} error={delivery.error} />
      )}

      {tab === "events" && (
        <NamespaceEvents namespace={name} onObject={refOpener(setSelection)} command={kubectl.appEvents(name)} />
      )}
    </HudPage>
  );
}

function DeliveryPanel({ name, app, loading, error }: { name: string; app?: AppDelivery; loading: boolean; error: string | null }) {
  return (
    <HudPanel title="Delivery" note="built · green · pinned · running" topic="gitops">
      <LearnCommand command={kubectl.appDelivery(name)} />
      {loading && <Loading label="asking ArgoCD, GitHub and GHCR…" />}
      <ErrorNote errors={error} />
      {!loading && !app && <Empty>{name} is not an ArgoCD app.</Empty>}
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
