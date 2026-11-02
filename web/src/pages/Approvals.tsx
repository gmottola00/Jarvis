import { useState } from "react";
import {
  AlertPanel,
  Aside,
  GlowDot,
  HudButton,
  HudCard,
  HudPage,
  HudPanel,
  LiveStamp,
  Readouts,
  RefreshButton,
  ToneCard,
  type Readout,
} from "../components/hud";
import { RISK_TONE } from "../components/runs/status";
import { ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import { since, stamp } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";
import { streamEvents } from "../lib/sse";
import type { ApprovalsOverview, RiskLevel } from "../lib/types";

/** A run reaches the gate from the chat; a few seconds late here is fine. */
const POLL_MS = 10_000;

const POLICY: { risk: RiskLevel; what: string }[] = [
  { risk: "read", what: "No side effects." },
  { risk: "write", what: "A commit or a pull request, never the cluster." },
  { risk: "destructive", what: "Hard to reverse. Suspends the run and asks here." },
];

type Waiting = ApprovalsOverview["pending"][number];

/**
 * The gate, for every session at once. The chat shows a dialog for its own
 * session; this page lists every run suspended on a destructive call, so one
 * started in another tab, or before a reload, is still findable.
 *
 * Deciding here resumes the run exactly as the chat dialog does. The
 * continuation is consumed, not shown: its answer lands in the run's session
 * and on the Runs page.
 */
export function Approvals() {
  const { data, error, loading, refresh, refreshing } = usePolling(api.approvals, POLL_MS);
  const { data: caps } = usePolling(api.capabilities, 0);

  const pending = data?.pending ?? [];
  const decided = data?.decided ?? [];
  const declined = decided.filter((d) => !d.approved).length;
  const oldest = pending[0];

  const readouts: Readout[] = [
    { label: "pending", value: pending.length, sub: pending.length ? "runs suspended at the gate" : "nothing to decide", tone: pending.length ? "bad" : "ok" },
    { label: "oldest", value: oldest ? since(oldest.since) : "—", sub: oldest?.tool ?? "", tone: oldest ? "warn" : "idle" },
    { label: "approved", value: decided.length - declined, sub: `of the last ${decided.length} decisions`, tone: "ok" },
    { label: "declined", value: declined, sub: "", tone: "idle" },
  ];

  return (
    <HudPage
      title="Approvals"
      subtitle="The gate. Destructive calls wait here, suspended on disk, until you decide."
      live={refreshing}
      status={
        <>
          <LiveStamp error={Boolean(error)} every={POLL_MS} />
          {data && <span className="font-mono text-[11px] text-ink-500">checkpointer · {data.durable ? "postgres" : "in-memory"}</span>}
        </>
      }
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      {loading && <Loading label="reading the gate…" />}
      <ErrorNote errors={error} />

      {data && (
        <>
          {!data.durable && (
            <AlertPanel tone="warn" title="in-memory">
              <p className="text-[12.5px] text-ink-400">
                <span className="font-mono">JARVIS_DATABASE_URL</span> is not set. A backend restart forgets every approval below.
              </p>
            </AlertPanel>
          )}

          <Readouts readouts={readouts} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <HudCard eyebrow="gate" title="Pending" note={`${pending.length} waiting`}>
              <div className="flex flex-col gap-3.5 px-4 sm:px-6 pt-3 pb-5.5">
                {pending.length === 0 ? (
                  <p className="flex items-center gap-2.5 border border-dashed border-ink-800 px-4 py-7 font-mono text-xs text-emerald-300">
                    <GlowDot tone="ok" size="sm" />
                    nothing waiting at the gate
                  </p>
                ) : (
                  pending.map((wait) => <GateCard key={wait.run_id} wait={wait} onDecided={refresh} />)
                )}
              </div>
            </HudCard>

            <div className="min-w-0 space-y-4">
              <HudPanel title="decided" note="audit log" flush>
                {decided.length === 0 ? (
                  <p className="px-4 sm:px-5 py-3.5 text-xs text-ink-500">No decisions yet.</p>
                ) : (
                  <ul>
                    {decided.map((d) => {
                      const tone = d.approved ? "ok" : "bad";
                      return (
                        <li key={`${d.run_id}:${d.decided_at}`} className="flex flex-col gap-1 border-b border-ink-850 px-4 sm:px-5 py-2.5">
                          <p className="flex items-center gap-2 font-mono text-[11px]">
                            <GlowDot tone={tone} size="sm" />
                            <span className={`tracking-[0.1em] uppercase ${TONE[tone].text}`}>{d.approved ? "approved" : "declined"}</span>
                            <span className="ml-auto text-ink-600">{stamp(d.decided_at)}</span>
                          </p>
                          <p className="font-mono text-xs text-ink-200">{d.tool}</p>
                          <p className="truncate text-xs text-ink-500" title={d.prompt}>
                            {d.prompt}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </HudPanel>

              <HudPanel title="policy" note="core/policy.py">
                <div className="flex flex-col gap-2.5">
                  {POLICY.map((p) => (
                    <div key={p.risk} className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2.5">
                      <span className={`font-mono text-[11px] font-medium ${TONE[RISK_TONE[p.risk]].text}`}>{p.risk}</span>
                      <span className="text-xs leading-snug text-ink-400">
                        {p.what}
                        {caps && <span className="font-mono text-ink-600"> · {caps.policy[p.risk]}</span>}
                      </span>
                    </div>
                  ))}
                  <Aside className="mt-1">Merging is what ships. This gate never gets automated.</Aside>
                </div>
              </HudPanel>
            </div>
          </div>
        </>
      )}
    </HudPage>
  );
}

function GateCard({ wait, onDecided }: { wait: Waiting; onDecided: () => void }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function decide(approved: boolean) {
    setBusy(approved ? "approve" : "decline");
    setProblem(null);
    let failed: string | null = null;
    const stream = streamEvents(
      `/api/approvals/${wait.run_id}`,
      { session_id: wait.session_id, approved },
      (event) => {
        if (event.type === "error") failed = event.message;
      },
      (message) => (failed = message),
    );
    void stream.done.then(() => {
      setBusy(null);
      setProblem(failed);
      onDecided();
    });
  }

  const args = Object.keys(wait.args).length ? JSON.stringify(wait.args, null, 2) : null;

  return (
    <ToneCard
      tone="bad"
      header={
        <>
          <GlowDot tone="bad" pulse />
          <span className="font-display text-xs font-bold tracking-[0.22em] text-rose-300 uppercase">destructive</span>
          <span className="font-mono text-[13px] font-medium text-ink-200">{wait.tool}</span>
          <span className="font-mono text-[11px] text-ink-600" title={wait.since}>
            waiting {since(wait.since)}
          </span>
          <a href="#jarvis/runs" className="ml-auto font-mono text-[11px] font-medium tracking-[0.1em] text-ink-500 hover:text-ink-200">
            {wait.run_id} ↗
          </a>
        </>
      }
    >
      <div className={`grid gap-4.5 px-4 pt-3.5 pb-4 ${args ? "lg:grid-cols-[minmax(0,1fr)_15rem]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="font-mono text-xs text-ink-500 [overflow-wrap:anywhere]">
            you asked <span className="text-ink-200">› {wait.prompt}</span>
          </p>
          {wait.why && <p className="border-l border-ultron-500/50 pl-3 text-[13px] leading-normal text-ink-300">{wait.why}</p>}
        </div>
        {args && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600 uppercase">args</span>
            <pre className="overflow-x-auto border border-ink-850 bg-ink-950 px-3 py-2.5 font-mono text-[11.5px] leading-normal text-ink-400">{args}</pre>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rose-400/20 px-4 py-2.5">
        <span className="font-mono text-[11px] text-ink-600">{problem ? <span className="text-rose-300">{problem}</span> : "closing the tab does not decline it"}</span>
        <HudButton variant="ghost" className="ml-auto" disabled={busy !== null} onClick={() => decide(false)}>
          {busy === "decline" ? "declining…" : "decline"}
        </HudButton>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide(true)}
          className="border border-ultron-500 bg-ultron-600 px-4 py-1.5 font-display text-xs font-bold tracking-[0.2em] text-white uppercase shadow-[0_0_12px] shadow-ultron-500/40 hover:bg-ultron-500 disabled:opacity-50"
        >
          {busy === "approve" ? "running…" : "approve"}
        </button>
      </div>
    </ToneCard>
  );
}
