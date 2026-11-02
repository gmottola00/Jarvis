import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";
import { TONE } from "../ui/tone";
import { GlowDot } from "./marks";
import { Corners } from "./panels";

/** Under a readout that needs a look: the tone's colour, as a 2px rule. */
const UNDERLINE: Partial<Record<Tone, string>> = { warn: "border-b-amber-400/60", bad: "border-b-rose-400/60" };

export interface Readout {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone: Tone;
}

/**
 * The numbers that answer "is anything wrong" before you scroll, in one framed strip.
 * An odd count would leave a hole in the two-column grid, so the last readout
 * takes the whole row (the four corner marks come first: positions stay even).
 */
export function Readouts({ readouts }: { readouts: Readout[] }) {
  return (
    <div className="relative grid grid-cols-2 gap-px border border-ultron-500/22 bg-ultron-500/15 lg:grid-cols-4 [&>:last-child:nth-child(odd)]:col-span-2 lg:[&>:last-child:nth-child(odd)]:col-span-1">
      <Corners />
      {readouts.map((r) => (
        <div
          key={r.label}
          className={`flex min-w-0 flex-col gap-1.5 border-b-2 border-b-transparent bg-ink-900 bg-linear-to-b from-ultron-500/6 to-transparent to-70% px-4 py-4 sm:px-6 sm:py-5 ${UNDERLINE[r.tone] ?? ""}`}
        >
          <p className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.15em] whitespace-nowrap text-ink-500 uppercase sm:tracking-[0.2em]">
            <GlowDot tone={r.tone} size="sm" />
            {r.label}
          </p>
          <p
            className={`font-display text-3xl leading-none font-bold sm:text-4xl lg:text-5xl ${TONE[r.tone].text}`}
            style={{ textShadow: "0 0 18px color-mix(in oklch, currentColor 35%, transparent)" }}
          >
            {r.value}
          </p>
          <p className="min-h-[1lh] truncate font-mono text-[11px] text-ink-600">{r.sub}</p>
        </div>
      ))}
    </div>
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
