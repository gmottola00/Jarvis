import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { RiskLevel, RunDetail, RunSummary } from "../../lib/types";

const RISK_COLOR: Record<RiskLevel, string> = {
  read: "text-sky-300",
  write: "text-amber-300",
  destructive: "text-rose-300",
};

/** The audit trail: what Jarvis did, in what order, and what you approved. */
export function RunTimeline() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .runs()
      .then(setRuns)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] tracking-widest text-ink-600 uppercase">Runs</h2>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        {runs.length === 0 && !error && <p className="text-xs text-ink-800">No runs yet.</p>}
        <ul className="space-y-1.5">
          {runs.map((run) => (
            <li key={run.run_id}>
              <button
                type="button"
                onClick={() => {
                  api.run(run.run_id).then(setSelected).catch(() => undefined);
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                  selected?.run_id === run.run_id
                    ? "border-ink-600 bg-ink-850"
                    : "border-ink-850 bg-ink-900/40 hover:bg-ink-900"
                }`}
              >
                <p className="truncate text-ink-200">{run.prompt}</p>
                <p className="mt-0.5 font-mono text-[10px] text-ink-800">
                  {run.started_at.slice(11, 19)} · {run.tool_count} tools
                  {run.approvals.length > 0 &&
                    ` · ${run.approvals.filter((a) => a.approved).length}/${run.approvals.length} approved`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        {!selected && <p className="text-xs text-ink-800">Pick a run.</p>}
        {selected && (
          <>
            <header className="space-y-1">
              <p className="font-mono text-[10px] text-ink-800">{selected.run_id}</p>
              <p className="text-sm text-ink-200">{selected.prompt}</p>
            </header>

            <ol className="space-y-1.5 border-l border-ink-850 pl-4">
              {selected.tool_calls.map((call, index) => (
                <li key={index} className="relative text-xs">
                  <span className="absolute top-1.5 -left-[1.28rem] size-1.5 rounded-full bg-ink-800" />
                  <div className="flex items-baseline gap-2">
                    <span className={`font-mono ${RISK_COLOR[call.risk]}`}>{call.tool}</span>
                    <span className={call.ok ? "text-emerald-400" : "text-rose-400"}>{call.ok ? "ok" : "failed"}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-800">{Math.round(call.duration_ms)}ms</span>
                  </div>
                  {Object.keys(call.args).length > 0 && (
                    <p className="font-mono text-[10px] text-ink-600">{JSON.stringify(call.args)}</p>
                  )}
                  <p className="mt-0.5 font-mono text-[10px] break-words text-ink-800">{call.summary}</p>
                </li>
              ))}
              {selected.tool_calls.length === 0 && <li className="text-xs text-ink-800">No tools were called.</li>}
            </ol>

            {selected.approvals.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="font-mono text-[11px] tracking-widest text-ink-600 uppercase">Approvals</h3>
                {selected.approvals.map((approval, index) => (
                  <p key={index} className="font-mono text-xs">
                    <span className={approval.approved ? "text-emerald-400" : "text-rose-400"}>
                      {approval.approved ? "approved" : "declined"}
                    </span>{" "}
                    <span className="text-ink-400">{approval.tool}</span>{" "}
                    <span className="text-ink-800">{JSON.stringify(approval.args)}</span>
                  </p>
                ))}
              </div>
            )}

            {selected.answer && (
              <div className="rounded-lg border border-ink-850 bg-ink-900/40 px-3.5 py-2.5">
                <p className="text-sm whitespace-pre-wrap text-ink-200">{selected.answer}</p>
                <p className="mt-2 font-mono text-[10px] text-ink-800">
                  {selected.usage.input_tokens} in · {selected.usage.output_tokens} out
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
