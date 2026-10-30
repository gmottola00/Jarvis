import type { Tone } from "../../lib/console/derive";
import type { RiskLevel, RunSummary } from "../../lib/types";

/** Read is quiet, write is the cyan of a commit or PR, destructive is the one that waits for you. */
export const RISK_TONE: Record<RiskLevel, Tone> = { read: "idle", write: "info", destructive: "bad" };

export type RunStatus = "waiting" | "declined" | "approved" | "done" | "unfinished";

export const STATUS_TONE: Record<RunStatus, Tone> = {
  waiting: "warn",
  declined: "bad",
  approved: "ok",
  done: "ok",
  unfinished: "idle",
};

/**
 * Where a run ended up. A run with no `finished_at` and nothing waiting either
 * broke or is still streaming; the audit log cannot tell those apart.
 */
export function runStatus(run: Pick<RunSummary, "pending" | "approvals" | "finished_at">): RunStatus {
  if (run.pending) return "waiting";
  if (run.approvals.some((a) => !a.approved)) return "declined";
  if (!run.finished_at) return "unfinished";
  return run.approvals.length ? "approved" : "done";
}

/** The run's wall time in ms, or null while it is open. */
export function runMillis(run: Pick<RunSummary, "started_at" | "finished_at">): number | null {
  return run.finished_at ? Date.parse(run.finished_at) - Date.parse(run.started_at) : null;
}
