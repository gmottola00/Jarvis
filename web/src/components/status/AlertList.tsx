import { useState } from "react";
import {
  Aside,
  GlowDot,
  HudButton,
  HudCard,
  HudPanel,
  Readouts,
  ToneCard,
  type Readout,
} from "../hud";
import { ErrorNote, Loading } from "../ui/primitives";
import { TONE } from "../ui/tone";
import type { Tone } from "../../lib/console/derive";
import { consoleApi } from "../../lib/console/api";
import type { AlertView, TargetView } from "../../lib/console/types";
import { age } from "../../lib/format";
import { askJarvis } from "../../lib/handoff";
import { usePolling } from "../../lib/hooks/usePolling";

/** Alertmanager re-evaluates every 30s at best; polling faster only shows the same list. */
const POLL_MS = 30_000;

const SEVERITY_TONE: Record<string, Tone> = { critical: "bad", error: "bad", warning: "warn", info: "info" };

/**
 * What is firing, and a button that hands one alert to the agent: the alerts
 * tab of the status page.
 *
 * Nothing here involves a model until you click "Investigate": the list comes
 * straight from Alertmanager, and the click is the decision to spend a run on
 * it. That keeps the proactive part manual — no webhook starts anything.
 */
export function AlertList() {
  const [showSilenced, setShowSilenced] = useState(false);
  const { data, error, loading } = usePolling(() => consoleApi.alerts(showSilenced), POLL_MS, showSilenced);

  const alerts = data?.alerts ?? [];
  const count = (severity: string) => alerts.filter((a) => a.severity === severity && a.state === "active").length;
  const active = alerts.filter((a) => a.state === "active").length;
  const down = data?.targets_down.length ?? 0;

  const readouts: Readout[] = [
    { label: "firing", value: active, sub: "Watchdog excluded", tone: active ? "warn" : "ok" },
    { label: "critical", value: count("critical"), sub: "", tone: count("critical") ? "bad" : "ok" },
    { label: "warning", value: count("warning"), sub: "", tone: count("warning") ? "warn" : "ok" },
    { label: "targets down", value: down, sub: "scrapes Prometheus cannot make", tone: down ? "bad" : "ok" },
  ];

  return (
    <div className="space-y-4">
      {loading && <Loading label="asking Alertmanager and Prometheus…" />}
      <ErrorNote errors={error} />
      {data && <ErrorNote errors={data.errors} />}

      {data && (
        <>
          <Readouts readouts={readouts} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <HudCard
              eyebrow="alertmanager"
              title="Firing"
              note={
                <span className="flex items-center gap-3">
                  {active} active
                  <HudButton
                    variant="ghost"
                    pressed={showSilenced}
                    onClick={() => setShowSilenced((on) => !on)}
                    title="Show silenced and inhibited alerts"
                  >
                    {showSilenced ? "hide silenced" : "show silenced"}
                  </HudButton>
                </span>
              }
            >
              {alerts.length === 0 ? (
                <p className="px-4 sm:px-6 pt-2 pb-5 text-xs text-ink-500">Nothing is firing. Quiet is the expected state.</p>
              ) : (
                <ul className="space-y-3 px-4 sm:px-6 pt-3 pb-5">
                  {alerts.map((alert) => (
                    <AlertCard key={alert.fingerprint} alert={alert} />
                  ))}
                </ul>
              )}
            </HudCard>
            <TargetsDown targets={data.targets_down} />
          </div>
        </>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: AlertView }) {
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

  const muted = alert.state !== "active";
  const tone = SEVERITY_TONE[alert.severity] ?? "idle";

  return (
    <ToneCard
      as="li"
      // A silenced alert keeps its severity colour on the label, but not the alarm frame.
      tone={muted ? "idle" : tone}
      header={
        <>
          <GlowDot tone={tone} />
          <span className={`font-display text-xs font-bold tracking-[0.22em] uppercase ${TONE[tone].text}`}>{alert.severity || "?"}</span>
          <span className="font-mono text-[13px] font-medium text-ink-200">{alert.name}</span>
          {muted && <span className="font-mono text-[10px] tracking-[0.1em] text-ink-500 uppercase">{alert.state}</span>}
          <span className="font-mono text-[11px] text-ink-600" title={alert.starts_at ?? undefined}>
            firing {age(alert.age)}
          </span>
          <span className="ml-auto flex items-center gap-3.5">
            {alert.runbook_url && (
              <a
                href={alert.runbook_url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] font-medium tracking-[0.1em] text-ink-500 hover:text-ink-200"
              >
                runbook ↗
              </a>
            )}
            <HudButton variant="action" onClick={investigate} disabled={preparing}>
              {preparing ? "preparing…" : "› investigate"}
            </HudButton>
          </span>
        </>
      }
    >
      <div className={`flex flex-col gap-1.5 px-4 pt-3 pb-3.5 ${muted ? "opacity-60" : ""}`}>
        <p className="font-mono text-xs [overflow-wrap:anywhere]">
          {alert.namespace || alert.target ? (
            <>
              {alert.namespace && <span className="text-ultron-300">{alert.namespace}</span>}
              {alert.namespace && alert.target && <span className="text-ink-700"> / </span>}
              <span className="text-ink-200">{alert.target}</span>
            </>
          ) : (
            <span className="text-ink-500">cluster-wide</span>
          )}
          {alert.container && <span className="text-ink-600"> · container {alert.container}</span>}
        </p>
        {(alert.description || alert.summary) && <Aside>{alert.description || alert.summary}</Aside>}
        {problem && <p className="font-mono text-[10px] text-rose-300">{problem}</p>}
      </div>
    </ToneCard>
  );
}

function TargetsDown({ targets }: { targets: TargetView[] }) {
  return (
    <HudPanel title="targets down" note="prometheus">
      <div className="flex flex-col gap-1.5 font-mono text-xs leading-relaxed">
        {targets.length === 0 ? (
          <>
            <span className="flex items-center gap-2 text-emerald-300">
              <GlowDot tone="ok" size="sm" />
              all targets up
            </span>
            <Aside>Every scrape target is up, so the alerts above see the whole lab.</Aside>
          </>
        ) : (
          <ul className="space-y-3">
            {targets.map((target) => (
              <li key={target.url}>
                <p className="flex items-center gap-2">
                  <GlowDot tone="bad" size="sm" />
                  <span className="text-ink-200">{target.job}</span>
                  <span className="ml-auto text-[10px] tracking-[0.1em] text-rose-300 uppercase">{target.health}</span>
                </p>
                <p className="mt-0.5 truncate text-[10px] text-ink-600">{target.url}</p>
                {target.last_error && <p className="mt-0.5 border-l border-rose-400/30 pl-3 font-sans text-[11px] text-rose-300">{target.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}
