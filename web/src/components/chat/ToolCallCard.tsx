import { ChevronRight, Eye, GitCommitHorizontal, LoaderCircle, ShieldAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { RiskLevel, ToolCallView } from "../../lib/types";

const RISK: Record<RiskLevel, { icon: LucideIcon; style: string }> = {
  read: { icon: Eye, style: "text-cyan-300 bg-cyan-500/10 ring-cyan-500/25" },
  write: { icon: GitCommitHorizontal, style: "text-amber-300 bg-amber-500/10 ring-amber-500/25" },
  destructive: { icon: ShieldAlert, style: "text-ultron-300 bg-ultron-500/15 ring-ultron-500/40" },
};

/** One tool invocation: what was called, with what, and how it went. */
export function ToolCallCard({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const pending = call.ok === undefined;
  const { icon: Icon, style } = RISK[call.risk];
  const [namespace, name] = call.name.includes("__") ? call.name.split("__", 2) : ["", call.name];

  return (
    <div className="overflow-hidden rounded-md border border-ink-850 bg-ink-950/60 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-ink-900"
      >
        <span title={call.risk} className={`inline-flex size-5 items-center justify-center rounded ring-1 ${style}`}>
          <Icon className="size-3" />
        </span>
        <span className="truncate font-mono text-xs">
          {namespace && <span className="text-ink-600">{namespace}.</span>}
          <span className="text-ink-200">{name}</span>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-ink-600">
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin text-ultron-400" />
          ) : (
            <>
              <span className={`size-1.5 rounded-full ${call.ok ? "bg-emerald-400" : "bg-ultron-500"}`} />
              <span className={call.ok ? "text-ink-500" : "text-ultron-300"}>{call.ok ? "ok" : "failed"}</span>
              {call.durationMs !== undefined && <span>{Math.round(call.durationMs)}ms</span>}
            </>
          )}
          <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-ink-850 px-3 py-2">
          {Object.keys(call.args).length > 0 && (
            <pre className="overflow-x-auto rounded bg-ink-900 p-2 font-mono text-[11px] text-ink-400">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          )}
          {call.summary && <p className="font-mono text-[11px] break-words text-ink-400">{call.summary}</p>}
        </div>
      )}
    </div>
  );
}
