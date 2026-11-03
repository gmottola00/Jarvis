import { useState } from "react";
import { AlertList } from "../components/status/AlertList";
import { BracketTabs, GlowDot, HudButton, HudPage, HudPanel, LiveStamp, Quiet, Readouts, RefreshButton, type Readout } from "../components/hud";
import { ErrorNote, Learn, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { consoleApi } from "../lib/console/api";
import type { Problem, ProblemKind, StatusCounts } from "../lib/console/types";
import { age } from "../lib/format";
import { askJarvis } from "../lib/handoff";
import { STATUS_MS, useStatus } from "../lib/hooks/useStatus";
import { navigate } from "../lib/route";

const TABS = ["problems", "alerts"] as const;
type StatusTab = (typeof TABS)[number];

const KIND_LABEL: Record<ProblemKind, string> = {
  node: "node",
  pod: "pod",
  argo: "argocd",
  alert: "alert",
  event: "event",
  gateway: "models",
  approval: "approval",
};

/**
 * "Is everything fine?" — every source that can say no, in one list, worst first.
 *
 * Each row opens the console view that shows the problem, and the ones the
 * agent can look into carry "Investigate": it renders the playbook for that
 * problem and opens it as a new chat. Nothing here runs a model by itself.
 */
export function Status({ tab: rawTab }: { tab?: string }) {
  const tab: StatusTab = TABS.includes(rawTab as StatusTab) ? (rawTab as StatusTab) : "problems";
  const { data, error, loading, refresh, refreshing } = useStatus();

  return (
    <HudPage
      title="Status"
      subtitle="Everything that wants a look, from every system. Investigate hands one to Ultron."
      live={refreshing}
      status={<LiveStamp error={Boolean(error)} every={STATUS_MS} at={data?.fetched_at} />}
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      <BracketTabs
        value={tab}
        onChange={(next) => navigate("status", next === "problems" ? undefined : next)}
        tabs={[
          { id: "problems", label: "problems", count: data?.problems.length },
          { id: "alerts", label: "alerts", count: data?.counts.alerts },
        ]}
      />

      {tab === "problems" && (
        <>
          {loading && <Loading label="asking the cluster, ArgoCD and Alertmanager…" />}
          <ErrorNote errors={error} />
          {data && <ErrorNote errors={Object.keys(data.errors).length ? data.errors : null} />}
          {data && (
            <>
              <Readouts readouts={readouts(data.counts, data.problems.length)} />
              <Problems problems={data.problems} />
            </>
          )}
        </>
      )}

      {tab === "alerts" && <AlertList />}
    </HudPage>
  );
}

function readouts(c: StatusCounts, problems: number): Readout[] {
  return [
    { label: "problems", value: problems, sub: problems ? "worst first, below" : "all good", tone: problems ? "warn" : "ok" },
    {
      label: "nodes ready",
      value: `${c.nodes_ready}/${c.nodes}`,
      sub: c.gpu_up === null ? "" : c.gpu_up ? "gpu host on" : "gpu host off",
      tone: c.nodes_ready === c.nodes ? "ok" : "bad",
    },
    { label: "pods not ready", value: c.unhealthy_pods, sub: "", tone: c.unhealthy_pods ? "warn" : "ok" },
    {
      label: "argocd",
      value: `${c.argo_apps - c.argo_unhealthy}/${c.argo_apps}`,
      sub: "synced · healthy",
      tone: c.argo_unhealthy ? "warn" : "ok",
    },
    { label: "alerts", value: c.alerts, sub: c.approvals ? `${c.approvals} approvals waiting` : "", tone: c.alerts ? "warn" : "ok" },
  ];
}

function Problems({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) {
    return (
      <HudPanel title="All good">
        <Quiet>
          Every node and pod is ready, every ArgoCD app is Synced and Healthy, nothing is firing, no recent warnings and no run is
          waiting for you.
        </Quiet>
      </HudPanel>
    );
  }
  return (
    <HudPanel title="Problems" note={problems.length} flush>
      <Learn topic="events" className="mx-3 mt-3 sm:mx-5" />
      <ul className="divide-y divide-ink-850">
        {problems.map((p) => (
          <ProblemRow key={p.id} problem={p} />
        ))}
      </ul>
    </HudPanel>
  );
}

function ProblemRow({ problem: p }: { problem: Problem }) {
  const [preparing, setPreparing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const tone = p.severity;

  async function investigate() {
    setPreparing(true);
    setFailure(null);
    try {
      askJarvis((await consoleApi.statusBrief(p)).prompt);
    } catch (reason: unknown) {
      setPreparing(false);
      setFailure(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 px-4 sm:px-5 py-3 ${tone === "bad" ? "border-l-rose-400" : "border-l-amber-400"}`}>
      <GlowDot tone={tone} pulse={tone === "bad"} />
      <span className="w-16 shrink-0 font-mono text-[10px] tracking-[0.15em] text-ink-600 uppercase">{KIND_LABEL[p.kind]}</span>
      <div className="min-w-0 flex-1 basis-52">
        <p className={`text-sm [overflow-wrap:anywhere] ${TONE[tone].text}`}>{p.title}</p>
        <p className="mt-0.5 font-mono text-[11px] [overflow-wrap:anywhere] text-ink-500">
          {p.namespace && <span className="text-ink-600">{p.namespace} · </span>}
          {p.detail}
          {p.since && <span className="text-ink-600"> · {age((Date.now() - Date.parse(p.since)) / 1000)}</span>}
        </p>
        {failure && <p className="mt-1 font-mono text-[10px] text-rose-300">{failure}</p>}
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {p.link && (
          <a href={p.link} className="font-mono text-[11px] text-sky-300 hover:text-sky-200">
            open →
          </a>
        )}
        {p.investigable && (
          <HudButton variant="action" onClick={investigate} disabled={preparing}>
            {preparing ? "preparing…" : "› investigate"}
          </HudButton>
        )}
      </span>
    </li>
  );
}
