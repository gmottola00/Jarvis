/**
 * Runs the browser's SSE client against a live backend, in Node.
 *
 * Covers the one seam the Python tests cannot reach: the wire format as the
 * browser actually parses it. Start `scripts/scripted_backend.py` on :8101
 * first, or use `make smoke-web`.
 */

import { streamEvents } from "../web/src/lib/sse";
import type { RunEvent } from "../web/src/lib/types";

const BASE = process.env.JARVIS_URL ?? "http://localhost:8101";

async function collect(url: string, body: unknown): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const handle = streamEvents(BASE + url, body, (event) => events.push(event), (message) => {
    throw new Error(`stream error: ${message}`);
  });
  await handle.done;
  return events;
}

function expect(condition: boolean, what: string): void {
  if (!condition) throw new Error(`expected ${what}`);
  console.log(`  ok  ${what}`);
}

async function main(): Promise<void> {
  const created = await fetch(`${BASE}/api/sessions`, { method: "POST" });
  const session = ((await created.json()) as { session_id: string }).session_id;

  console.log("question turn");
  const first = await collect("/api/chat", { session_id: session, message: "how is tickup?" });
  const kinds = first.map((e) => e.type);
  expect(kinds.filter((k) => k === "tool_call").length === 2, "two tool calls arrive");
  expect(kinds.filter((k) => k === "tool_result").length === 2, "two tool results arrive");
  expect(kinds.includes("token"), "the answer streams as tokens");
  expect(kinds.at(-1) === "done", "the stream ends with done");

  console.log("destructive turn");
  const second = await collect("/api/chat", { session_id: session, message: "merge PR 12" });
  const approval = second.find((e) => e.type === "approval_required");
  expect(approval !== undefined, "the run suspends for approval");
  if (approval?.type !== "approval_required") return;
  expect(approval.tool === "github__merge_pr", "the pending tool is named");

  console.log("approval");
  const resumed = await collect(`/api/approvals/${approval.run_id}`, { session_id: session, approved: true });
  expect(resumed.some((e) => e.type === "tool_call"), "the tool runs after approval");
  expect(resumed.at(-1)?.type === "done", "the resumed stream ends with done");

  console.log("\nweb smoke test passed");
}

main().catch((error: unknown) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
