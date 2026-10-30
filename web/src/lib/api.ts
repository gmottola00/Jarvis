/** REST calls. Everything streaming lives in `sse.ts`. */

import type {
  ApprovalsOverview,
  Capabilities,
  LabOverview,
  ModelCatalog,
  PendingApproval,
  RunDetail,
  RunSummary,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  capabilities: () => get<Capabilities>("/api/capabilities"),
  models: () => get<ModelCatalog>("/api/models"),
  overview: () => get<LabOverview>("/api/lab/overview"),
  runs: (limit = 50) => get<RunSummary[]>(`/api/runs?limit=${limit}`),
  run: (runId: string) => get<RunDetail>(`/api/runs/${runId}`),
  approvals: () => get<ApprovalsOverview>("/api/approvals"),

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

/** Forget the conversation: the chat mints a fresh session on its next mount. */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing stored, nothing to forget */
  }
}

export function storeSession(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* private window, blocked storage - the app works, it just forgets */
  }
}

/** The picked model survives reloads too; a stale id falls back to the default. */
const MODEL_KEY = "jarvis.model";

export function storedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function storeModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* as above */
  }
}
