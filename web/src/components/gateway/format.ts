import type { Tone } from "../../lib/console/derive";

export const usd = (value: number) => `$${value.toFixed(2)}`;
export const gb = (count: number) => `${(count / 1e9).toFixed(1)} GB`;

/** `2026-12-01T00:00:00Z` → `1 Dec`. */
export function resetDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Past the budget the gateway refuses every request until it resets; 80% is the warning line. */
export function spendTone(spend: number, limit: number | null | undefined): Tone {
  if (!limit) return "idle";
  return spend >= limit ? "bad" : spend / limit >= 0.8 ? "warn" : "idle";
}

/** Milliseconds as the latency columns show them: `850ms`, `4.2s`, `2m 0s`. */
export function latency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
