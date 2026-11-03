import { ShieldAlert } from "lucide-react";
import type { PendingApproval } from "../../lib/types";

/**
 * The gate, as a dialog.
 *
 * It is modal on purpose. A destructive action is the one moment the agent
 * stops and the decision is a person's, and the run is suspended on disk until
 * this is answered - closing the tab does not decline it, it just leaves it
 * pending.
 */
export function ApprovalDialog({
  approval,
  busy,
  onDecide,
}: {
  approval: PendingApproval;
  busy: boolean;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/85 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur-sm sm:items-center sm:p-4">
      <div role="alertdialog" className="hud-frame flex max-h-full w-full max-w-lg flex-col shadow-2xl">
        <header className="flex shrink-0 items-center gap-2.5 border-b border-ultron-900 px-4 sm:px-5 py-3.5">
          <ShieldAlert className="size-4 text-ultron-400" />
          <h2 className="font-display text-sm font-bold tracking-[0.2em] uppercase">Approval required</h2>
          <span className="ml-auto bg-ultron-500/15 px-1.5 py-0.5 font-mono text-[10px] text-ultron-300 uppercase ring-1 ring-ultron-500/40">
            destructive
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="font-mono text-sm text-ink-200">{approval.tool}</p>

          {Object.keys(approval.args).length > 0 && (
            <pre className="overflow-x-auto bg-ink-950 p-3 font-mono text-xs text-ink-400">
              {JSON.stringify(approval.args, null, 2)}
            </pre>
          )}

          <p className="text-sm text-ink-600">{approval.why}</p>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-ultron-900 px-4 sm:px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide(false)}
            disabled={busy}
            className="flex-1 border border-ink-800 px-3.5 py-2.5 font-mono sm:flex-none sm:py-1.5 text-[11px] text-ink-400 uppercase hover:bg-ink-850 disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onDecide(true)}
            disabled={busy}
            className="flex-1 bg-ultron-600 px-3.5 py-2.5 font-display sm:flex-none sm:py-1.5 text-xs font-bold tracking-[0.2em] text-white uppercase hover:bg-ultron-500 disabled:opacity-40"
          >
            {busy ? "Running…" : "Approve"}
          </button>
        </footer>
      </div>
    </div>
  );
}
