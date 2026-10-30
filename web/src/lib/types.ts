/**
 * The wire protocol.
 *
 * Mirrors `jarvis/core/types.py` by hand. There is no code generation here on
 * purpose - the surface is small enough that a hand-written mirror is clearer
 * than a build step, but it does mean the two files change together.
 */

export type RiskLevel = "read" | "write" | "destructive";

export type RunEvent =
  | { type: "thinking"; text: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; risk: RiskLevel }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; duration_ms: number }
  | { type: "approval_required"; run_id: string; tool: string; args: Record<string, unknown>; why: string }
  | { type: "done"; run_id: string; usage: Usage; model: string; requested_model: string }
  | { type: "error"; message: string }
  /** The picked local model is offline. Nothing ran; resend with `allow_fallback` once the user agrees. */
  | { type: "model_unavailable"; requested: string; fallback: string };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface NodeStatus {
  name: string;
  ready: boolean;
  version: string;
  roles: string[];
}

export interface PodStatus {
  namespace: string;
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  reason: string;
}

export interface ArgoAppStatus {
  name: string;
  sync: string;
  health: string;
  revision: string;
  repo: string;
  path: string;
}

export interface LabOverview {
  nodes: NodeStatus[];
  apps: ArgoAppStatus[];
  unhealthy_pods: PodStatus[];
  /** Active alerts, heartbeats and silenced ones excluded. */
  firing_alerts: number;
  degraded: boolean;
  errors: Record<string, string>;
  fetched_at: string;
}

export interface Capabilities {
  model: string;
  gateway: boolean;
  llm_ready: boolean;
  fake_tools: boolean;
  durable: boolean;
  policy: { read: string; write: string; destructive: string };
  capabilities: Record<string, { name: string; risk: RiskLevel; description: string }[]>;
}

export interface ModelOption {
  id: string;
  provider: "anthropic" | "local";
  /** False for a local model while the GPU machine is off: sending to it asks before `fallback` answers. */
  available: boolean;
}

export interface ModelCatalog {
  default: string;
  fallback: string;
  models: ModelOption[];
}

export interface PendingApproval {
  run_id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  why: string;
}

export interface RunSummary {
  run_id: string;
  session_id: string;
  prompt: string;
  answer: string;
  usage: Usage;
  approvals: { tool: string; approved: boolean }[];
  started_at: string;
  finished_at: string | null;
  tool_count: number;
}

export interface RunDetail extends Omit<RunSummary, "tool_count"> {
  tool_calls: {
    tool: string;
    risk: RiskLevel;
    args: Record<string, unknown>;
    ok: boolean;
    summary: string;
    duration_ms: number;
    at: string;
  }[];
  approvals: { tool: string; args: Record<string, unknown>; why: string; approved: boolean; decided_at: string }[];
}

/* --- What the chat pane renders ------------------------------------------ */

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  ok?: boolean;
  summary?: string;
  durationMs?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: ToolCallView[];
  usage?: Usage;
  /** The model that actually answered - after a fallback, not the one picked. */
  model?: string;
  /** The model the run asked for, when the gateway served a different one. */
  requestedModel?: string;
  error?: string;
  streaming?: boolean;
}
