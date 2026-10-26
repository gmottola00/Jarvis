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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-rose-500/25 bg-ink-900 shadow-2xl">
        <header className="flex items-center gap-2.5 border-b border-ink-850 px-5 py-3.5">
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300 uppercase ring-1 ring-rose-500/25">
            destructive
          </span>
          <h2 className="text-sm font-medium">Approval required</h2>
        </header>

        <div className="space-y-3.5 px-5 py-4">
          <p className="font-mono text-sm text-ink-200">{approval.tool}</p>

          {Object.keys(approval.args).length > 0 && (
            <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs text-ink-400">
              {JSON.stringify(approval.args, null, 2)}
            </pre>
          )}

          <p className="text-sm text-ink-600">{approval.why}</p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-ink-850 bg-ink-900/60 px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide(false)}
            disabled={busy}
            className="rounded-lg border border-ink-800 px-3.5 py-1.5 text-xs text-ink-400 hover:bg-ink-850 disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onDecide(true)}
            disabled={busy}
            className="rounded-lg bg-rose-500/90 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
          >
            {busy ? "Running…" : "Approve"}
          </button>
        </footer>
      </div>
    </div>
  );
}
