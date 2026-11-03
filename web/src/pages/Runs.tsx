import { useState } from "react";
import { GlowDot, HudButton, HudCard, HudPage, HudPanel, LiveStamp, Quiet, Readouts, RefreshButton, type Readout } from "../components/hud";
import { RISK_TONE, STATUS_TONE, runMillis, runStatus, type RunStatus } from "../components/runs/status";
import { Drawer } from "../components/ui/Drawer";
import { ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import type { Tone } from "../lib/console/derive";
import { elapsed, stamp, tokens } from "../lib/format";
import { useMediaQuery, WIDE } from "../lib/hooks/useMediaQuery";
import { usePolling } from "../lib/hooks/usePolling";
import type { RiskLevel, RunDetail, RunSummary } from "../lib/types";

/** A run in flight streams to the chat; this page only needs to catch up within a few seconds. */
const POLL_MS = 10_000;

const FILTERS = ["all", "read", "write", "destructive"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * The audit trail: why did it do that. Every prompt, tool call, approval and
 * answer, read from `/api/runs`. Nothing here acts; a waiting run is decided
 * on the Approvals page.
 */
export function Runs() {
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const { data: runs, error, loading, refresh, refreshing } = usePolling(() => api.runs(100), POLL_MS);

  const all = runs ?? [];
  const shown = all.filter((r) => filter === "all" || r.risk === filter);
  // Side by side the newest run is open by default; narrower, the run opens
  // in a sheet on a tap, instead of rendering under a hundred rows.
  const wide = useMediaQuery(WIDE);
  const selected = picked ?? (wide ? (all[0]?.run_id ?? null) : null);

  const calls = (risk: RiskLevel) => all.reduce((sum, r) => sum + r.calls_by_risk[risk], 0);
  const statuses = all.map(runStatus);
  const tally = (status: RunStatus) => statuses.filter((s) => s === status).length;
  const waiting = tally("waiting");
  const destructive = calls("destructive") + waiting;

  const readouts: Readout[] = [
    { label: "runs", value: all.length, sub: waiting ? `${waiting} suspended at the gate` : "none waiting", tone: waiting ? "warn" : "idle" },
    {
      label: "tool calls",
      value: all.reduce((sum, r) => sum + r.tool_count, 0),
      sub: `${calls("read")} read`,
      tone: "idle",
    },
    { label: "writes", value: calls("write"), sub: "branches, commits, PRs", tone: "info" },
    {
      label: "destructive",
      value: destructive,
      sub: `${tally("approved")} approved · ${tally("declined")} declined · ${waiting} waiting`,
      tone: destructive ? "bad" : "idle",
    },
  ];

  return (
    <HudPage
      title="Runs"
      subtitle="Why did it do that. Every prompt, tool call, approval and answer."
      live={refreshing}
      status={<LiveStamp error={Boolean(error)} every={POLL_MS} />}
      actions={
        <>
          {FILTERS.map((f) => (
            <HudButton key={f} variant="ghost" pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
            </HudButton>
          ))}
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </>
      }
    >
      {loading && <Loading label="reading the audit log…" />}
      <ErrorNote errors={error} />

      {runs && (
        <>
          <Readouts readouts={readouts} />

          <div className="grid items-start gap-4 xl:grid-cols-[30rem_minmax(0,1fr)]">
            <HudPanel title="recent" note="/api/runs · newest first" flush>
              {shown.length === 0 ? (
                <div className="px-4 sm:px-5 py-4">
                  <Quiet>{all.length ? `No ${filter} runs among the last ${all.length}.` : "No runs yet. Ask something in the chat."}</Quiet>
                </div>
              ) : (
                <ul>
                  {shown.map((run) => (
                    <RunRow key={run.run_id} run={run} on={run.run_id === selected} onPick={() => setPicked(run.run_id)} />
                  ))}
                </ul>
              )}
            </HudPanel>

            {wide && selected && <RunView runId={selected} summary={all.find((r) => r.run_id === selected)} />}
          </div>
          {!wide && (
            <Drawer open={selected !== null} onClose={() => setPicked(null)} eyebrow="run" title={all.find((r) => r.run_id === selected)?.prompt ?? selected}>
              {selected && (
                <div className="p-3 sm:p-5">
                  <RunView runId={selected} summary={all.find((r) => r.run_id === selected)} />
                </div>
              )}
            </Drawer>
          )}
        </>
      )}
    </HudPage>
  );
}

function RunRow({ run, on, onPick }: { run: RunSummary; on: boolean; onPick: () => void }) {
  const status = runStatus(run);
  const fellBack = run.served_by && run.model && run.served_by !== run.model;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={on}
        className={`grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-l-2 border-b-ink-850 px-4 sm:px-5 py-3 text-left ${
          on ? "border-l-ultron-500 bg-ultron-500/10" : "border-l-transparent hover:bg-ultron-500/6"
        }`}
      >
        <span className="font-mono text-[11px] text-ink-600" title={run.started_at}>
          {stamp(run.started_at)}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[13px] text-ink-200">{run.prompt}</span>
          <span className="truncate font-mono text-[11px] text-ink-600">
            {run.tool_count} calls · {fellBack ? `${run.model} → ${run.served_by}` : run.served_by || run.model || "—"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {run.risk ? (
            <span
              className={`border px-1.5 py-px font-mono text-[10px] font-medium tracking-[0.12em] uppercase ${TONE[RISK_TONE[run.risk]].text} ${
                run.risk === "destructive" ? "border-rose-400/50" : "border-ink-800"
              }`}
            >
              {run.risk}
            </span>
          ) : (
            <span className="font-mono text-[10px] tracking-[0.12em] text-ink-700 uppercase">no tools</span>
          )}
          <span className={`font-mono text-[11px] ${TONE[STATUS_TONE[status]].text}`}>{status}</span>
        </span>
      </button>
    </li>
  );
}

interface Step {
  tool: string;
  risk: RiskLevel;
  duration: string;
  summary: string;
  tone: Tone;
  /** Hollow dot: the call has not run. */
  hollow?: boolean;
}

/**
 * The run as a timeline: each tool call in order, then whatever stopped it.
 * A declined call never ran, so it is not in `tool_calls`; it is drawn from
 * the approval instead, as is the call still waiting at the gate.
 */
function steps(run: RunDetail): Step[] {
  const approvedAt = (tool: string) => run.approvals.find((a) => a.tool === tool && a.approved)?.decided_at;
  const ran: Step[] = run.tool_calls.map((call) => {
    const approved = call.risk === "destructive" ? approvedAt(call.tool) : undefined;
    return {
      tool: call.tool,
      risk: call.risk,
      duration: `${Math.round(call.duration_ms)}ms`,
      summary: (approved ? `Approved at ${stamp(approved)}. ` : "") + (call.ok ? call.summary : `Failed: ${call.summary}`),
      tone: call.ok ? (call.risk === "read" ? "ok" : RISK_TONE[call.risk]) : "bad",
    };
  });
  const declined: Step[] = run.approvals
    .filter((a) => !a.approved)
    .map((a) => ({ tool: a.tool, risk: "destructive", duration: "—", summary: `Declined at ${stamp(a.decided_at)}.`, tone: "bad" }));
  const waiting: Step[] = run.pending
    ? [
        {
          tool: run.pending.tool,
          risk: "destructive",
          duration: "—",
          summary: "Suspended at the gate. Waiting for your decision in Approvals.",
          tone: "warn",
          hollow: true,
        },
      ]
    : [];
  return [...ran, ...declined, ...waiting];
}

function RunView({ runId, summary }: { runId: string; summary?: RunSummary }) {
  // Refetch when the list's copy changes: a run that finishes or gets decided shows it here too.
  const version = summary ? `${summary.tool_count}:${summary.finished_at}:${summary.approvals.length}:${Boolean(summary.pending)}` : "";
  const { data: run, error } = usePolling(() => api.run(runId), 0, `${runId}|${version}`);

  if (error) return <ErrorNote errors={error} />;
  if (!run) return <Loading label="opening the run…" />;

  const status = runStatus(run);
  const ms = runMillis(run);
  const fellBack = run.served_by && run.served_by !== run.model;
  const timeline = steps(run);
  const facts: [string, string][] = [
    ["model", run.model || "—"],
    ...(fellBack ? ([["answered by", `${run.served_by} (fallback)`]] as [string, string][]) : []),
    ["session", run.session_id],
    ["started", stamp(run.started_at)],
    ["duration", ms === null ? "—" : elapsed(ms)],
    ["tokens", `${tokens(run.usage.input_tokens)} in · ${tokens(run.usage.output_tokens)} out`],
  ];

  return (
    <HudCard
      eyebrow="run"
      title={run.run_id}
      status={<span className={`font-mono text-[11px] ${TONE[STATUS_TONE[status]].text}`}>{status}</span>}
    >
      <div className="flex flex-col gap-2.5 border-b border-ultron-500/15 px-4 sm:px-6 pt-2 pb-3.5">
        <p className="text-[17px] leading-snug text-ink-200 [overflow-wrap:anywhere]">› {run.prompt}</p>
        <p className="flex flex-wrap gap-x-4.5 gap-y-1.5 font-mono text-[11px] text-ink-500">
          {facts.map(([k, v]) => (
            <span key={k}>
              <span className="text-ink-700">{k}</span> {v}
            </span>
          ))}
        </p>
      </div>

      <div className="px-4 sm:px-6 pt-4 pb-2">
        <p className="mb-2.5 font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600 uppercase">tool calls · {run.tool_calls.length}</p>
        {timeline.length === 0 && <p className="pb-2.5 text-[12.5px] text-ink-500">No tools were called: the router read this as small talk, or the model answered from what it knew.</p>}
        <ol>
          {timeline.map((step, index) => (
            <li key={index} className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-3">
              <span className="flex flex-col items-center">
                {step.hollow ? (
                  <span aria-hidden className="mt-[5px] size-[9px] rounded-full border border-amber-400 shadow-[0_0_6px] shadow-amber-400" />
                ) : (
                  <span className="mt-[3px]">
                    <GlowDot tone={step.tone} />
                  </span>
                )}
                <span aria-hidden className="w-px flex-1 bg-ink-850" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pb-3">
                <p className="flex items-center gap-2.5">
                  <span className="font-mono text-[12.5px] font-medium text-ink-200">{step.tool}</span>
                  <span className={`font-mono text-[10px] font-medium tracking-[0.1em] uppercase ${TONE[RISK_TONE[step.risk]].text}`}>{step.risk}</span>
                  <span className="ml-auto font-mono text-[11px] text-ink-600">{step.duration}</span>
                </p>
                <p className={`text-[12.5px] leading-snug [overflow-wrap:anywhere] ${step.hollow ? "text-amber-300" : "text-ink-400"}`}>{step.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mx-3 mb-5.5 flex flex-col sm:mx-6 gap-1.5 border border-ink-850 bg-ink-950 px-4 py-3.5">
        <p className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600 uppercase">{run.pending ? "suspended" : "answer"}</p>
        {run.pending ? (
          <p className="text-[13px] leading-normal text-ink-300">
            No answer yet. The run resumes from its checkpoint once <span className="font-mono">{run.pending.tool}</span> is{" "}
            <a href="#jarvis/approvals" className="text-ultron-300 hover:text-ink-200">
              approved or declined ↗
            </a>
          </p>
        ) : run.answer ? (
          <p className="text-[13px] leading-normal whitespace-pre-wrap text-ink-300 [overflow-wrap:anywhere]">{run.answer}</p>
        ) : (
          <p className="text-[13px] text-ink-500">{status === "unfinished" ? "No answer: the run is still streaming, or it ended in an error." : "The run ended without an answer."}</p>
        )}
      </div>
    </HudCard>
  );
}
