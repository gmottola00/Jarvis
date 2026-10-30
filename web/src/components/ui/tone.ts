import type { Tone } from "../../lib/console/derive";

/**
 * One table from tone to classes, so "amber means look at this" is decided in
 * exactly one place. Tailwind needs the full class names written out to find
 * them, which is why these are literals and not templates.
 */
export const TONE = {
  ok: { dot: "bg-emerald-400", glow: "shadow-emerald-400", text: "text-emerald-300", soft: "bg-emerald-500/10 ring-emerald-500/25", bar: "bg-emerald-400/80" },
  warn: { dot: "bg-amber-400", glow: "shadow-amber-400", text: "text-amber-300", soft: "bg-amber-500/10 ring-amber-500/25", bar: "bg-amber-400/80" },
  bad: { dot: "bg-rose-400", glow: "shadow-rose-400", text: "text-rose-300", soft: "bg-rose-500/10 ring-rose-500/25", bar: "bg-rose-400/80" },
  idle: { dot: "bg-ink-600", glow: "shadow-ink-600", text: "text-ink-400", soft: "bg-ink-800/40 ring-ink-800", bar: "bg-ink-600" },
  info: { dot: "bg-cyan-400", glow: "shadow-cyan-400", text: "text-cyan-300", soft: "bg-cyan-500/10 ring-cyan-500/25", bar: "bg-cyan-400/80" },
} satisfies Record<Tone, { dot: string; glow: string; text: string; soft: string; bar: string }>;

/** Tone → CSS colour, for the places a class cannot reach (gradients, gauge arcs). */
export const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-emerald-400)",
  warn: "var(--color-amber-400)",
  bad: "var(--color-rose-400)",
  idle: "var(--color-ink-600)",
  info: "var(--color-ultron-500)",
};
