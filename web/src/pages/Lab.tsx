import { argoTone } from "../components/delivery/status";
import { AlertPanel, Aside, HudCard, HudPage, HudPanel, Leader, LiveStamp, Quiet, RefreshButton, StatusMark, GlowDot } from "../components/hud";
import { ErrorNote, Loading } from "../components/ui/primitives";
import type { Tone } from "../lib/console/derive";
import { api } from "../lib/api";
import { usePolling } from "../lib/hooks/usePolling";
import type { ArgoAppStatus, Capabilities, LabOverview, PodStatus } from "../lib/types";

const OVERVIEW_MS = 15_000;

/** Cluster nodes, ArgoCD applications, and anything unhealthy: the lab on one instrument panel. */
export function Lab() {
  const { data, error, loading, refresh, refreshing } = usePolling(api.overview, OVERVIEW_MS);
  const capabilities = usePolling(api.capabilities, 0).data;

  return (
    <HudPage
      title="Home lab"
      live={refreshing}
      status={<LiveStamp error={Boolean(error)} every={OVERVIEW_MS} at={data?.fetched_at} />}
      actions={
        <>
          {data && <StatePill degraded={data.degraded} />}
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </>
      }
    >
      {loading && <Loading label="asking the cluster and ArgoCD…" />}
      <ErrorNote errors={error} />
      {data && <ErrorNote errors={data.errors} />}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        {data && <ArgoApps apps={data.apps} />}
        <div className="min-w-0 space-y-4">
          {data && (
            <>
              <UnhealthyPods pods={data.unhealthy_pods} />
              <Alerts firing={data.firing_alerts} />
              <Nodes nodes={data.nodes} />
            </>
          )}
          {capabilities && <Policy capabilities={capabilities} />}
        </div>
      </div>
    </HudPage>
  );
}

function StatePill({ degraded }: { degraded: boolean }) {
  return degraded ? (
    <span className="hud-hazard hazard-warn flex items-center gap-2 border border-amber-400/50 px-3.5 py-1.5 font-display text-xs font-bold tracking-[0.22em] text-amber-300 uppercase shadow-[0_0_18px_-6px] shadow-amber-400/60">
      <GlowDot tone="warn" pulse />
      needs attention
    </span>
  ) : (
    <span className="flex items-center gap-2 border border-emerald-400/40 px-3.5 py-1.5 font-display text-xs font-bold tracking-[0.22em] text-emerald-300 uppercase">
      <GlowDot tone="ok" />
      all good
    </span>
  );
}

/** Edge and hazard stripes for a row that wants a look; the healthy rows stay quiet. */
const ROW_MARK: Partial<Record<Tone, string>> = {
  warn: "hud-hazard hazard-warn border-l-amber-400",
  bad: "hud-hazard border-l-rose-400",
};

function ArgoApps({ apps }: { apps: ArgoAppStatus[] }) {
  return (
    <HudCard eyebrow="gitops" title="ArgoCD" note={`${apps.length} apps`}>
      <ul className="px-6 pt-1.5 pb-5">
        {apps.map((app, index) => {
          const tone = argoTone(app);
          return (
            <li
              key={app.name}
              className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-l-2 border-t-ultron-500/12 border-l-transparent px-3 py-2.5 ${ROW_MARK[tone] ?? ""}`}
            >
              <span className="font-mono text-[10px] font-medium tracking-[0.1em] text-ink-700">{String(index + 1).padStart(2, "0")}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-[13px] font-medium text-ink-200">{app.name}</span>
                <span className="truncate font-mono text-[11px] text-ink-700">
                  {app.path} <span className="text-ink-500">@ {app.revision || "?"}</span>
                </span>
              </span>
              <StatusMark tone={tone}>
                {app.sync} · {app.health}
              </StatusMark>
            </li>
          );
        })}
        {apps.length === 0 && (
          <li className="py-2">
            <Quiet>No applications.</Quiet>
          </li>
        )}
      </ul>
    </HudCard>
  );
}

function UnhealthyPods({ pods }: { pods: PodStatus[] }) {
  if (pods.length === 0) {
    return (
      <HudPanel title="Unhealthy pods" note={0}>
        <Quiet>Everything is Running and ready.</Quiet>
      </HudPanel>
    );
  }
  return (
    <AlertPanel tone="warn" title="Unhealthy pods" note={pods.length} flush>
      <ul className="divide-y divide-amber-400/15">
        {pods.map((pod) => (
          <li key={`${pod.namespace}/${pod.name}`} className="flex flex-col gap-2 px-5 py-3.5 font-mono text-xs leading-normal">
            <span className="break-all text-ink-200">
              <span className="text-ink-600">{pod.namespace} /</span> {pod.name}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {[pod.phase, pod.ready, `${pod.restarts} restarts`, pod.reason].filter(Boolean).map((tag) => (
                <span key={tag} className="border border-amber-400/35 bg-amber-400/8 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                  {tag}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </AlertPanel>
  );
}

function Alerts({ firing }: { firing: number }) {
  return (
    <HudPanel title="Alerts" note={<span className={firing ? "text-amber-300" : undefined}>{firing} firing</span>}>
      <div className="flex flex-col gap-1.5 font-mono text-xs leading-relaxed">
        {firing === 0 ? (
          <span className="text-emerald-300">› nothing is firing</span>
        ) : (
          <>
            <a href="#alerts" className="text-amber-300 hover:text-ink-200">
              › {firing} alert{firing === 1 ? "" : "s"} firing
            </a>
            <Aside>Open the list to investigate.</Aside>
          </>
        )}
      </div>
    </HudPanel>
  );
}

function Nodes({ nodes }: { nodes: LabOverview["nodes"] }) {
  return (
    <HudPanel title="Nodes" note={nodes.length}>
      <div className="space-y-2.5">
        {nodes.map((node) => (
          <Leader
            key={node.name}
            label={
              <span className="flex items-center gap-2 text-ink-200">
                <GlowDot tone={node.ready ? "ok" : "bad"} size="sm" />
                {node.name}
              </span>
            }
            value={<span className="text-ink-600">{node.version}</span>}
          />
        ))}
        {nodes.length === 0 && <Quiet>No nodes reported.</Quiet>}
      </div>
    </HudPanel>
  );
}

function Policy({ capabilities }: { capabilities: Capabilities }) {
  const live = !capabilities.fake_tools;
  return (
    <HudPanel
      title="Policy"
      note={
        <span className={`flex items-center gap-1.5 ${live ? "text-emerald-300" : "text-amber-300"}`}>
          <GlowDot tone={live ? "ok" : "warn"} size="sm" pulse />
          {live ? "live" : "fixtures"}
        </span>
      }
    >
      <div className="space-y-2.5">
        {Object.entries(capabilities.policy).map(([risk, rule]) => (
          <Leader key={risk} label={risk} value={<span className={risk === "destructive" ? "text-ultron-300" : "text-ink-200"}>{rule}</span>} />
        ))}
        <Leader className="pt-2" label="model" value={<span className="text-ink-200">{capabilities.model}</span>} />
        <Leader
          label="durable"
          value={<span className={capabilities.durable ? "text-ink-200" : "text-amber-300"}>{capabilities.durable ? "postgres" : "in-memory"}</span>}
        />
      </div>
    </HudPanel>
  );
}
