import type { KeyUsage } from "../../lib/console/types";
import { HudPanel, Quiet } from "../hud";
import { TONE } from "../ui/tone";
import { resetDay, spendTone, usd } from "./format";

/**
 * One row per app key: how much of its budget the period has used, and what
 * it did in the window. Sorted closest-to-budget first by the API.
 */
export function KeysPanel({ keys, windowLabel }: { keys: KeyUsage[]; windowLabel: string }) {
  return (
    <HudPanel title="Keys" note="one per app · budget this period" topic="gateway" flush>
      {keys.length === 0 ? (
        <div className="px-5 py-3.5">
          <Quiet>No virtual keys.</Quiet>
        </div>
      ) : (
        <ul className="divide-y divide-ink-850">
          {keys.map((k) => {
            const tone = spendTone(k.spend, k.max_budget);
            const width = k.budget_used === null ? 0 : Math.min(100, k.budget_used * 100);
            return (
              <li key={k.alias} className="grid gap-1.5 px-5 py-3">
                <p className="flex items-baseline gap-3 font-mono text-xs">
                  <span className="font-medium text-ink-200">{k.alias}</span>
                  <span className={tone === "idle" ? "text-ink-300" : TONE[tone].text}>
                    {usd(k.spend)}
                    {k.max_budget !== null && <span className="text-ink-600"> / {usd(k.max_budget)}</span>}
                  </span>
                  {k.budget_used !== null && <span className="text-ink-500">{Math.round(k.budget_used * 100)}%</span>}
                  <span className="ml-auto text-[11px] text-ink-600">
                    {k.budget_reset_at ? `resets ${resetDay(k.budget_reset_at)}` : k.max_budget === null ? "no budget" : "no reset"}
                  </span>
                </p>
                {k.max_budget !== null && (
                  <div className="h-1 bg-ink-850" role="meter" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={`${k.alias} budget used`}>
                    <div className={`h-full ${tone === "idle" ? "bg-ultron-500" : TONE[tone].dot}`} style={{ width: `${width}%` }} />
                  </div>
                )}
                <p className="font-mono text-[11px] text-ink-500">
                  {windowLabel}: {k.requests} requests
                  {k.failures > 0 && <span className="text-amber-300"> · {k.failures} failed</span>}
                  {k.window_spend > 0 && <span> · {usd(k.window_spend)}</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </HudPanel>
  );
}
