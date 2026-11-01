import type { Budget } from "../../lib/types";
import { HudPanel, Quiet } from "../hud";
import { TONE } from "../ui/tone";
import { resetDay, spendTone, usd } from "./format";

/** Jarvis's own key from `/key/info`: the fallback when the gateway view is not configured. */
export function BudgetPanel({ budget, gateway }: { budget: Budget | null; gateway: boolean }) {
  return (
    <HudPanel title="budget" note="/key/info">
      {!budget ? (
        <Quiet>{gateway ? "The gateway has not answered /key/info yet." : "Without a gateway there is no key budget to read."}</Quiet>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-baseline gap-2">
            <span className={`font-display text-3xl leading-none font-bold ${spendTone(budget.spend, budget.max_budget) === "idle" ? "text-ink-200" : TONE[spendTone(budget.spend, budget.max_budget)].text}`}>{usd(budget.spend)}</span>
            <span className="font-mono text-xs text-ink-500">{budget.max_budget !== null ? `of ${usd(budget.max_budget)} this period` : "no budget set"}</span>
          </p>
          {budget.max_budget !== null && (
            <div className="h-1.5 bg-ink-850">
              <div
                className={`h-full shadow-[0_0_8px] ${spendTone(budget.spend, budget.max_budget) === "idle" ? "bg-ultron-500 shadow-ultron-500" : `${TONE[spendTone(budget.spend, budget.max_budget)].dot} ${TONE[spendTone(budget.spend, budget.max_budget)].glow}`}`}
                style={{ width: `${Math.min(100, (budget.spend / (budget.max_budget || 1)) * 100)}%` }}
              />
            </div>
          )}
          <span className="font-mono text-[11px] text-ink-600">
            {budget.reset_at ? `resets ${resetDay(budget.reset_at)} · ` : ""}local models cost nothing
          </span>
        </div>
      )}
    </HudPanel>
  );
}
