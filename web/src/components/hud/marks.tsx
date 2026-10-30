import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";
import { TONE } from "../ui/tone";

const DOT_SIZE = { sm: "size-1.5 shadow-[0_0_6px]", md: "size-[7px] shadow-[0_0_8px]" };

/** A status light: the tone's colour with its own glow. `pulse` while something is live. */
export function GlowDot({ tone, size = "md", pulse = false }: { tone: Tone; size?: keyof typeof DOT_SIZE; pulse?: boolean }) {
  return (
    <span aria-hidden className={`inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${TONE[tone].dot} ${TONE[tone].glow} ${pulse ? "animate-dot" : ""}`} />
  );
}

/** `● SYNCED · HEALTHY`: a light and an uppercase Rajdhani label in the same tone. */
export function StatusMark({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`flex items-center gap-2 font-display text-xs font-bold tracking-[0.18em] whitespace-nowrap uppercase ${TONE[tone].text}`}
    >
      <GlowDot tone={tone} />
      {children}
    </span>
  );
}

/** `label ········ value`, the dotted leader of a printed spec sheet. The value keeps its own colour. */
export function Leader({ label, value, className = "" }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 font-mono text-xs ${className}`}>
      <span className="shrink-0 text-ink-500">{label}</span>
      <span aria-hidden className="min-w-4 flex-1 -translate-y-[3px] border-b border-dotted border-ink-800" />
      <span className="min-w-0 text-right [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

/** A note under a line: indented behind a thin rule, in prose. */
export function Aside({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`border-l border-ink-800 pl-3 font-sans text-[12.5px] leading-normal text-ink-400 ${className}`}>{children}</p>;
}
