import { useState } from "react";
import { Badge, Empty, ErrorNote, IconButton, Loading, Panel, Stat } from "../components/ui/primitives";
import type { Tone } from "../lib/console/derive";
import { consoleApi } from "../lib/console/api";
import type { AlertView, TargetView } from "../lib/console/types";
import { age, clock } from "../lib/format";
import { askJarvis } from "../lib/handoff";
import { usePolling } from "../lib/hooks/usePolling";

/** Alertmanager re-evaluates every 30s at best; polling faster only shows the same list. */
const POLL_MS = 30_000;

const SEVERITY_TONE: Record<string, Tone> = { critical: "bad", error: "bad", warning: "warn", info: "info" };

/**
 * What is firing, and a button that hands one alert to the agent.
 *
 * Nothing on this page involves a model until you click "Investigate": the list
 * comes straight from Alertmanager, and the click is the decision to spend a run
 * on it. That keeps the proactive part manual — no webhook starts anything.
 */
export function Alerts() {
  const [showSilenced, setShowSilenced] = useState(false);
  const { data, error, loading, refresh, refreshing } = usePolling(
    () => consoleApi.alerts(showSilenced),
    POLL_MS,
    showSilenced,
  );

  const alerts = data?.alerts ?? [];
  const count = (severity: string) => alerts.filter((a) => a.severity === severity && a.state === "active").length;
  const active = alerts.filter((a) => a.state === "active").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-medium text-ink-200">Alerts</h2>
            <p className="text-xs text-ink-600">Straight from Alertmanager. Ultron looks only when you ask it to.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {data && <span className="font-mono text-[10px] text-ink-800">as of {clock(data.fetched_at)}</span>}
            <IconButton onClick={() => setShowSilenced((on) => !on)} label="Show silenced and inhibited alerts">
              {showSilenced ? "hide silenced" : "show silenced"}
            </IconButton>
            <IconButton onClick={refresh} label="Refresh">
              {refreshing ? "…" : "refresh"}
            </IconButton>
          </div>
        </header>

        {loading && <Loading label="asking Alertmanager and Prometheus…" />}
        <ErrorNote errors={error} />
        {data && <ErrorNote errors={data.errors} />}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="firing" value={active} tone={active ? "warn" : "ok"} sub="Watchdog excluded" />
              <Stat label="critical" value={count("critical")} tone={count("critical") ? "bad" : "ok"} />
              <Stat label="warning" value={count("warning")} tone={count("warning") ? "warn" : "ok"} />
              <Stat
                label="targets down"
                value={data.targets_down.length}
                tone={data.targets_down.length ? "bad" : "ok"}
                sub="scrapes Prometheus cannot make"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
              <Panel title="Firing" note={`${alerts.length}`} topic="alerts" flush>
                {alerts.length === 0 ? (
                  <div className="px-4 py-3">
                    <Empty>Nothing is firing. Quiet is the expected state.</Empty>
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-850/60">
                    {alerts.map((alert) => (
                      <AlertRow key={alert.fingerprint} alert={alert} />
                    ))}
                  </ul>
                )}
              </Panel>
              <TargetsDown targets={data.targets_down} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertView }) {
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function investigate() {
    setPreparing(true);
    setProblem(null);
    try {
      const brief = await consoleApi.alertBrief(alert.fingerprint);
      askJarvis(brief.prompt);
    } catch (reason: unknown) {
      setPreparing(false);
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const subject = [alert.namespace, alert.target].filter(Boolean).join(" / ") || "cluster-wide";
  const muted = alert.state !== "active";

  return (
    <li className={`px-4 py-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[alert.severity] ?? "idle"}>{alert.severity || "?"}</Badge>
        <span className="font-mono text-xs text-ink-200">{alert.name}</span>
        {muted && <Badge tone="idle">{alert.state}</Badge>}
        <span className="font-mono text-[10px] text-ink-600" title={alert.starts_at ?? undefined}>
          firing {age(alert.age)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {alert.runbook_url && (
            <a
              href={alert.runbook_url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-sky-300/80 hover:text-sky-300"
            >
              runbook
            </a>
          )}
          <button
            type="button"
            onClick={investigate}
            disabled={preparing}
            className="rounded-md bg-sky-500/10 px-2.5 py-1 font-mono text-[11px] text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/20 disabled:opacity-50"
          >
            {preparing ? "preparing…" : "investigate"}
          </button>
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ink-400">
        {subject}
        {alert.container && <span className="text-ink-600"> · container {alert.container}</span>}
      </p>
      {(alert.description || alert.summary) && (
        <p className="mt-1 text-xs text-ink-600">{alert.description || alert.summary}</p>
      )}
      {problem && <p className="mt-1 font-mono text-[10px] text-rose-300">{problem}</p>}
    </li>
  );
}

function TargetsDown({ targets }: { targets: TargetView[] }) {
  return (
    <Panel title="Targets down" note="Prometheus">
      {targets.length === 0 ? (
        <Empty>Every scrape target is up, so the alerts above see the whole lab.</Empty>
      ) : (
        <ul className="space-y-3">
          {targets.map((target) => (
            <li key={target.url} className="text-xs">
              <p className="flex items-center gap-2">
                <Badge tone="bad">{target.health}</Badge>
                <span className="font-mono text-ink-200">{target.job}</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-600">{target.url}</p>
              {target.last_error && <p className="mt-0.5 text-[11px] text-rose-300">{target.last_error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
