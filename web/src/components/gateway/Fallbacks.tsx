import { stamp } from "../../lib/format";
import type { RunSummary } from "../../lib/types";
import { HudPanel } from "../hud";

/** Runs a fallback answered instead of the model that was picked, from the audit log. */
export function Fallbacks({ runs }: { runs: RunSummary[] }) {
  const fallbacks = runs.filter((r) => r.served_by && r.model && r.served_by !== r.model);
  return (
    <HudPanel title="fallbacks" note="always asked first" flush>
      {fallbacks.length === 0 ? (
        <p className="px-5 pt-3.5 text-xs text-ink-500">No run has been answered by a fallback.</p>
      ) : (
        <ul>
          {fallbacks.map((r) => (
            <li key={r.run_id} className="flex flex-col gap-1 border-b border-ink-850 px-5 py-2.5">
              <p className="flex gap-2 font-mono text-xs text-ink-200">
                {r.model} <span className="text-amber-300">→</span> {r.served_by}
                <span className="ml-auto text-[11px] text-ink-600">{stamp(r.started_at)}</span>
              </p>
              <p className="truncate text-xs text-ink-500" title={r.prompt}>
                {r.prompt}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pt-2.5 pb-3.5 text-xs leading-normal text-ink-500">
        The gateway has num_retries 0 and no silent fallback. A dead Ollama is refused at once, not after retries.
      </p>
    </HudPanel>
  );
}
