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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 p-4 backdrop-blur-sm">
      <div role="alertdialog" className="hud-frame w-full max-w-lg shadow-2xl">
        <header className="flex items-center gap-2.5 border-b border-ultron-900 px-5 py-3.5">
          <ShieldAlert className="size-4 text-ultron-400" />
          <h2 className="font-display text-sm font-bold tracking-[0.2em] uppercase">Approval required</h2>
          <span className="ml-auto bg-ultron-500/15 px-1.5 py-0.5 font-mono text-[10px] text-ultron-300 uppercase ring-1 ring-ultron-500/40">
            destructive
          </span>
        </header>

        <div className="space-y-3.5 px-5 py-4">
          <p className="font-mono text-sm text-ink-200">{approval.tool}</p>

          {Object.keys(approval.args).length > 0 && (
            <pre className="overflow-x-auto bg-ink-950 p-3 font-mono text-xs text-ink-400">
              {JSON.stringify(approval.args, null, 2)}
            </pre>
          )}

          <p className="text-sm text-ink-600">{approval.why}</p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-ultron-900 px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide(false)}
            disabled={busy}
            className="border border-ink-800 px-3.5 py-1.5 font-mono text-[11px] text-ink-400 uppercase hover:bg-ink-850 disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onDecide(true)}
            disabled={busy}
            className="bg-ultron-600 px-3.5 py-1.5 font-display text-xs font-bold tracking-[0.2em] text-white uppercase hover:bg-ultron-500 disabled:opacity-40"
          >
            {busy ? "Running…" : "Approve"}
          </button>
        </footer>
      </div>
    </div>
  );
}
