/** REST calls. Everything streaming lives in `sse.ts`. */

import type { Capabilities, LabOverview, PendingApproval, RunDetail, RunSummary } from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  capabilities: () => get<Capabilities>("/api/capabilities"),
  overview: () => get<LabOverview>("/api/lab/overview"),
  runs: (limit = 50) => get<RunSummary[]>(`/api/runs?limit=${limit}`),
  run: (runId: string) => get<RunDetail>(`/api/runs/${runId}`),

  session: (sessionId: string) =>
    get<{
      session_id: string;
      turns: { role: "user" | "assistant"; content: string; at: string }[];
      pending_approval: PendingApproval | null;
    }>(`/api/sessions/${sessionId}`),

  async newSession(): Promise<string> {
    const response = await fetch("/api/sessions", { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as { session_id: string }).session_id;
  },
};

/**
 * The session id lives in localStorage so a reload lands back in the same
 * conversation - which is what makes a suspended approval findable again.
 */
const SESSION_KEY = "jarvis.session";

export function storedSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function storeSession(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* private window, blocked storage - the app works, it just forgets */
  }
}
