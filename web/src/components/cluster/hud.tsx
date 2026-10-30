/**
 * The instrument-panel pieces of the cluster page: bracket corners, ring
 * gauges, bracketed tabs and the section heading. Presentational only, like
 * `ui/primitives`, but in the HUD language the chat uses.
 */

import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";

/** Tone → CSS colour, for the places a class cannot reach (gradients). */
export const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-emerald-400)",
  warn: "var(--color-amber-400)",
  bad: "var(--color-rose-400)",
  idle: "var(--color-ink-600)",
  info: "var(--color-ultron-500)",
};

/** Bracket marks on all four corners. The parent must be `relative`. */
export function Corners() {
  const corner = "pointer-events-none absolute size-3.5 border-ultron-500";
  return (
    <>
      <span aria-hidden className={`${corner} -top-px -left-px border-t-2 border-l-2`} />
      <span aria-hidden className={`${corner} -top-px -right-px border-t-2 border-r-2`} />
      <span aria-hidden className={`${corner} -bottom-px -left-px border-b-2 border-l-2`} />
      <span aria-hidden className={`${corner} -right-px -bottom-px border-r-2 border-b-2`} />
    </>
  );
}

/** A panel heading: the red tick, a Rajdhani title, a mono note on the right. */
export function HudHeading({ title, note, className = "" }: { title: string; note?: ReactNode; className?: string }) {
  return (
    <header className={`flex items-center gap-2.5 border-b border-ultron-500/15 px-5 py-3 ${className}`}>
      <span aria-hidden className="h-3.5 w-[3px] bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" />
      <h3 className="font-display text-sm font-bold tracking-[0.25em] whitespace-nowrap text-ink-300 uppercase">{title}</h3>
      {note !== undefined && <span className="ml-auto font-mono text-[11px] text-ink-500">{note}</span>}
    </header>
  );
}

/** A ring gauge: the arc is the value, the centre repeats it in numbers. */
export function Gauge({
  value,
  color,
  kind,
  label,
  detail,
}: {
  value: number;
  color: string;
  /** What the number is: a reservation, a capacity, or live consumption. */
  kind: string;
  label: string;
  detail: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const ring = "radial-gradient(circle closest-side, transparent calc(100% - 8px), black calc(100% - 7px))";
  return (
    <div className="flex flex-col items-center gap-2.5" role="meter" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="relative size-22">
        <div
          className="absolute inset-0 rounded-full transition-[background] duration-500"
          style={{
            background: `conic-gradient(${color} 0 ${clamped}%, var(--color-ink-850) 0)`,
            mask: ring,
            WebkitMask: ring,
            filter: `drop-shadow(0 0 4px color-mix(in oklch, ${color} 50%, transparent))`,
          }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl leading-none font-bold text-ink-200">{clamped}%</span>
          <span className="font-mono text-[9px] text-ink-600">{kind}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 text-center">
        <span className="font-mono text-[10px] font-medium tracking-[0.1em] text-ink-400 uppercase">{label}</span>
        <span className="font-mono text-[10px] text-ink-600">{detail}</span>
      </div>
    </div>
  );
}

/** Tabs drawn as `[ LABEL 35 ]`; the brackets light up on the open one. */
export function BracketTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1.5 overflow-x-auto">
      {tabs.map((tab) => {
        const active = value === tab.id;
        const bracket = active ? "text-ultron-500" : "text-transparent";
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`flex shrink-0 items-baseline gap-2 px-3 py-1.5 font-display text-[13px] font-semibold tracking-[0.18em] whitespace-nowrap uppercase ${
              active ? "bg-ultron-500/10 text-ultron-300" : "text-ink-500 hover:text-ink-300"
            }`}
          >
            <span aria-hidden className={bracket}>
              [
            </span>
            {tab.label}
            {tab.count !== undefined && <span className="font-mono text-[10px] tracking-normal text-ink-600">{tab.count}</span>}
            <span aria-hidden className={bracket}>
              ]
            </span>
          </button>
        );
      })}
    </div>
  );
}
