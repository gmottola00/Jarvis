import type { Budget } from "../../lib/types";

const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * What Jarvis's gateway key has spent against its budget. Amber from 80%,
 * rose once spent: past the budget the gateway refuses every request until
 * it resets.
 */
export function BudgetMeter({ budget }: { budget: Budget }) {
  const { spend, max_budget: limit, reset_at: resetAt } = budget;
  const share = limit ? Math.min(spend / limit, 1) : 0;
  const tone = share >= 1 ? "bg-rose-400" : share >= 0.8 ? "bg-amber-300" : "bg-ink-600";
  const resets = resetAt ? ` · resets ${new Date(resetAt).toLocaleDateString()}` : "";

  return (
    <div
      className="flex w-[4.75rem] shrink-0 flex-col gap-1 self-center"
      title={`LLM spend this period${limit ? ` of ${usd(limit)}` : ""}${resets}`}
    >
      <span className={`font-mono text-[10px] leading-none ${share >= 1 ? "text-rose-300" : "text-ink-400"}`}>
        {usd(spend)}
        {limit !== null && <span className="text-ink-600"> / {usd(limit).replace(/\.00$/, "")}</span>}
      </span>
      {limit !== null && (
        <div className="h-[3px] overflow-hidden rounded-full bg-ink-800">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
        </div>
      )}
    </div>
  );
}
