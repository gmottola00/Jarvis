import { useState } from "react";
import type { RiskLevel, ToolCallView } from "../../lib/types";

const RISK_STYLE: Record<RiskLevel, string> = {
  read: "bg-sky-500/10 text-sky-300 ring-sky-500/25",
  write: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  destructive: "bg-rose-500/10 text-rose-300 ring-rose-500/25",
};

/** One tool invocation: what was called, with what, and how it went. */
export function ToolCallCard({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const pending = call.ok === undefined;

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/60 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-850/50"
      >
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ring-1 ${RISK_STYLE[call.risk]}`}>
          {call.risk}
        </span>
        <span className="font-mono text-ink-200">{call.name}</span>

        <span className="ml-auto flex items-center gap-2 text-xs text-ink-600">
          {pending ? (
            <span className="animate-dot">running…</span>
          ) : (
            <>
              <span className={call.ok ? "text-emerald-400" : "text-rose-400"}>{call.ok ? "ok" : "failed"}</span>
              {call.durationMs !== undefined && <span>{Math.round(call.durationMs)}ms</span>}
            </>
          )}
          <span className="text-ink-800">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-ink-800 px-3 py-2">
          {Object.keys(call.args).length > 0 && (
            <pre className="overflow-x-auto rounded bg-ink-950 p-2 font-mono text-xs text-ink-400">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          )}
          {call.summary && <p className="font-mono text-xs break-words text-ink-400">{call.summary}</p>}
        </div>
      )}
    </div>
  );
}
