import type { Tone } from "../../lib/console/derive";

/**
 * One table from tone to classes, so "amber means look at this" is decided in
 * exactly one place. Tailwind needs the full class names written out to find
 * them, which is why these are literals and not templates.
 */
export const TONE = {
  ok: { dot: "bg-emerald-400", text: "text-emerald-300", soft: "bg-emerald-500/10 ring-emerald-500/25", bar: "bg-emerald-400/80" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", soft: "bg-amber-500/10 ring-amber-500/25", bar: "bg-amber-400/80" },
  bad: { dot: "bg-rose-400", text: "text-rose-300", soft: "bg-rose-500/10 ring-rose-500/25", bar: "bg-rose-400/80" },
  idle: { dot: "bg-ink-600", text: "text-ink-400", soft: "bg-ink-800/40 ring-ink-800", bar: "bg-ink-600" },
  info: { dot: "bg-sky-400", text: "text-sky-300", soft: "bg-sky-500/10 ring-sky-500/25", bar: "bg-sky-400/80" },
} satisfies Record<Tone, { dot: string; text: string; soft: string; bar: string }>;
