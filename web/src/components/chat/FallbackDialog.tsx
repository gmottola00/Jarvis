import { Cpu, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

/**
 * The picked local model cannot answer. Asking is the point: a user who chose
 * a model on their own GPU never gets Claude - and its bill - without saying so.
 */
export function FallbackDialog({
  requested,
  fallback,
  onDecide,
}: {
  requested: string;
  fallback: string;
  onDecide: (useFallback: boolean) => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onDecide(false);
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onDecide]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/85 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur-sm sm:items-center sm:p-4">
      <div role="alertdialog" aria-labelledby="fallback-title" className="hud-frame flex max-h-full w-full max-w-md flex-col shadow-2xl">
        <header className="flex shrink-0 items-center gap-2.5 border-b border-ultron-900 px-4 sm:px-5 py-3.5">
          <TriangleAlert className="size-4 text-amber-300" />
          <h2 id="fallback-title" className="font-display text-sm font-bold tracking-[0.2em] text-ink-200 uppercase">
            Local model offline
          </h2>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-ink-400 sm:px-5">
          <p className="flex items-center gap-2">
            <Cpu className="size-4 shrink-0 text-ultron-400" />
            <span>
              <span className="font-mono text-ultron-300">{requested}</span> is not reachable — the GPU machine does not answer.
            </span>
          </p>
          <p>
            Answer this message with <span className="font-mono text-ink-200">{fallback}</span> instead? Claude is billed per
            token; nothing is sent unless you agree.
          </p>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-ultron-900 px-4 sm:px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide(false)}
            className="flex-1 border border-ink-800 px-3.5 py-2.5 font-mono sm:flex-none sm:py-1.5 text-[11px] text-ink-400 uppercase hover:bg-ink-850"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onDecide(true)}
            className="flex-1 bg-ultron-600 px-3.5 py-2.5 font-display sm:flex-none sm:py-1.5 text-xs font-bold tracking-[0.2em] text-white uppercase hover:bg-ultron-500"
          >
            Use {fallback}
          </button>
        </footer>
      </div>
    </div>
  );
}
