import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalDialog } from "../components/approval/ApprovalDialog";
import { Composer } from "../components/chat/Composer";
import { MessageList } from "../components/chat/MessageList";
import { LabPanel } from "../components/lab/LabPanel";
import { api, storeSession, storedSession } from "../lib/api";
import { streamEvents } from "../lib/sse";
import type { Capabilities, LabOverview, Message, PendingApproval, RunEvent } from "../lib/types";

const OVERVIEW_INTERVAL_MS = 15_000;

/**
 * Chat on the left, lab state on the right.
 *
 * All the run bookkeeping is here: one assistant message is built up from the
 * event stream, and a stream that ends in `approval_required` leaves the dialog
 * open rather than the message finished.
 */
export function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [overview, setOverview] = useState<LabOverview | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  const assistantId = useRef<string | null>(null);

  /* --- session bootstrap: reuse the stored one so a reload keeps context --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = storedSession();
      if (existing) {
        try {
          const session = await api.session(existing);
          if (cancelled) return;
          setSessionId(existing);
          setMessages(
            session.turns.map((turn, index) => ({
              id: `restored-${index}`,
              role: turn.role,
              text: turn.content,
            })),
          );
          // A suspended run is still waiting: put its dialog back.
          if (session.pending_approval) setApproval(session.pending_approval);
          return;
        } catch {
          /* stale id - fall through and mint a new one */
        }
      }
      const fresh = await api.newSession();
      if (cancelled) return;
      storeSession(fresh);
      setSessionId(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --- lab overview polling ------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .overview()
        .then((data) => alive && setOverview(data))
        .catch(() => undefined);
    };
    load();
    api
      .capabilities()
      .then((data) => alive && setCapabilities(data))
      .catch(() => undefined);
    const timer = setInterval(load, OVERVIEW_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const patchAssistant = useCallback((update: (message: Message) => Message) => {
    const id = assistantId.current;
    if (!id) return;
    setMessages((current) => current.map((message) => (message.id === id ? update(message) : message)));
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case "thinking":
          patchAssistant((m) => ({ ...m, thinking: (m.thinking ?? "") + event.text }));
          break;
        case "token":
          patchAssistant((m) => ({ ...m, text: m.text + event.text }));
          break;
        case "tool_call":
          patchAssistant((m) => ({
            ...m,
            tools: [...(m.tools ?? []), { id: event.id, name: event.name, args: event.args, risk: event.risk }],
          }));
          break;
        case "tool_result":
          patchAssistant((m) => ({
            ...m,
            tools: (m.tools ?? []).map((call) =>
              call.id === event.id ? { ...call, ok: event.ok, summary: event.summary, durationMs: event.duration_ms } : call,
            ),
          }));
          break;
        case "approval_required":
          setApproval({ run_id: event.run_id, tool: event.tool, args: event.args, risk: "destructive", why: event.why });
          break;
        case "done":
          patchAssistant((m) => ({ ...m, usage: event.usage, streaming: false }));
          // The overview may have moved: a merge starts a rollout.
          api.overview().then(setOverview).catch(() => undefined);
          break;
        case "error":
          patchAssistant((m) => ({ ...m, error: event.message, streaming: false }));
          break;
      }
    },
    [patchAssistant],
  );

  function beginAssistantMessage() {
    const id = `assistant-${Date.now()}`;
    assistantId.current = id;
    setMessages((current) => [...current, { id, role: "assistant", text: "", streaming: true }]);
  }

  async function send(text: string) {
    if (!sessionId) return;
    setBusy(true);
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }]);
    beginAssistantMessage();

    const stream = streamEvents("/api/chat", { session_id: sessionId, message: text }, handleEvent, (message) =>
      patchAssistant((m) => ({ ...m, error: message, streaming: false })),
    );
    await stream.done;
    patchAssistant((m) => ({ ...m, streaming: false }));
    setBusy(false);
  }

  async function decide(approved: boolean) {
    if (!sessionId || !approval) return;
    setBusy(true);
    const runId = approval.run_id;
    setApproval(null);

    // The continuation belongs to the same assistant message the user is
    // already looking at, unless it was restored from a reload.
    if (!assistantId.current) beginAssistantMessage();
    patchAssistant((m) => ({ ...m, streaming: true }));

    const stream = streamEvents("/api/approvals/" + runId, { session_id: sessionId, approved }, handleEvent, (message) =>
      patchAssistant((m) => ({ ...m, error: message, streaming: false })),
    );
    await stream.done;
    patchAssistant((m) => ({ ...m, streaming: false }));
    setBusy(false);
  }

  const llmDown = capabilities !== null && !capabilities.llm_ready;

  return (
    <>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_minmax(19rem,22rem)]">
        <div className="flex h-full min-h-0 flex-col border-r border-ink-850">
          {llmDown && (
            <p className="border-b border-amber-500/25 bg-amber-500/5 px-5 py-2 text-xs text-amber-300">
              ANTHROPIC_API_KEY is not set — chat is disabled. The lab panel still works.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MessageList messages={messages} />
          </div>
          <Composer
            onSend={send}
            busy={busy}
            disabled={!sessionId || llmDown}
            placeholder={llmDown ? "Set ANTHROPIC_API_KEY to enable chat" : undefined}
          />
        </div>

        <aside className="hidden min-h-0 lg:block">
          <LabPanel overview={overview} capabilities={capabilities} />
        </aside>
      </div>

      {approval && <ApprovalDialog approval={approval} busy={busy} onDecide={decide} />}
    </>
  );
}
