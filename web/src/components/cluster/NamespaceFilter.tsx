import type { NamespaceSummary } from "../../lib/console/types";
import { percent } from "../../lib/format";

/**
 * Namespace chips that double as a filter — the `-n` flag, clickable. The
 * count and the tick under each name show ready/total, so a namespace with a
 * broken pod stands out before you open it.
 */
export function NamespaceFilter({
  namespaces,
  value,
  onChange,
}: {
  namespaces: NamespaceSummary[];
  value: string;
  onChange: (namespace: string) => void;
}) {
  const ready = namespaces.reduce((sum, ns) => sum + ns.pods_ready, 0);
  const total = namespaces.reduce((sum, ns) => sum + ns.pods_total, 0);

  const chip = (name: string, label: string, podsReady: number, podsTotal: number, showCount: boolean) => {
    const active = value === name;
    const degraded = podsReady < podsTotal;
    const tick = degraded ? "bg-amber-400" : active ? "bg-ultron-500" : "bg-emerald-400/70";
    return (
      <button
        key={name}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(name)}
        className={`flex shrink-0 flex-col gap-1 border px-2.5 pt-1.5 pb-1 font-mono text-xs whitespace-nowrap ${
          active
            ? "border-ultron-500/70 bg-ultron-500/12 text-ultron-300"
            : "border-ink-850 bg-ink-900/70 text-ink-400 hover:border-ink-800 hover:text-ink-200"
        }`}
      >
        <span className="flex items-baseline gap-1.5">
          {label}
          {showCount && podsTotal > 0 && (
            <span className={`text-[10px] ${degraded ? "text-amber-300" : "text-ink-600"}`}>
              {podsReady}/{podsTotal}
            </span>
          )}
        </span>
        <span aria-hidden className="h-0.5 bg-ink-850">
          <span className={`block h-full ${tick}`} style={{ width: `${percent(podsReady, podsTotal)}%` }} />
        </span>
      </button>
    );
  };

  return (
    <div className="flex items-start gap-2.5 sm:gap-3.5">
      <span className="shrink-0 pt-1.5 font-display text-xs font-semibold tracking-[0.2em] text-ink-600">
        SCOPE <span className="font-mono tracking-normal text-ultron-300">-n</span>
      </span>
      <div className="-mr-3 flex min-w-0 gap-1 overflow-x-auto pr-3 [scrollbar-width:none] sm:mr-0 sm:flex-wrap sm:overflow-visible sm:pr-0">
        {chip("all", "all namespaces", ready, total, false)}
        {namespaces.map((ns) => chip(ns.name, ns.name, ns.pods_ready, ns.pods_total, true))}
      </div>
    </div>
  );
}
