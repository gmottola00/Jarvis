import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalDialog } from "../components/approval/ApprovalDialog";
import { Composer } from "../components/chat/Composer";
import { MessageList } from "../components/chat/MessageList";
import { BudgetMeter } from "../components/chat/BudgetMeter";
import { FallbackDialog } from "../components/chat/FallbackDialog";
import { ModelPicker } from "../components/chat/ModelPicker";
import { HudBackdrop } from "../components/hud";
import { api, storeModel, storeSession, storedModel, storedSession } from "../lib/api";
import { clearHandoff, pendingHandoff } from "../lib/handoff";
import { streamEvents } from "../lib/sse";
import type { Capabilities, Message, ModelCatalog, PendingApproval, RunEvent } from "../lib/types";

/** How often the picker learns the GPU machine went up or down. */
const CATALOG_INTERVAL_MS = 15_000;

/** A message held back because its local model is offline, until the user decides. */
interface PendingFallback {
  text: string;
  requested: string;
  fallback: string;
}

/**
 * The chat, full width. The lab state has its own page now.
 *
 * All the run bookkeeping is here: one assistant message is built up from the
 * event stream, and a stream that ends in `approval_required` leaves the dialog
 * open rather than the message finished. A message for an offline local model
 * is never sent to Claude without the user's say-so: it waits behind
 * `FallbackDialog`.
 */
export function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [model, setModel] = useState<string>(() => storedModel() ?? "");
  const [fallback, setFallback] = useState<PendingFallback | null>(null);
  /** Text handed back to the composer after the user declined the fallback. */
  const [draft, setDraft] = useState<{ text: string } | undefined>(undefined);

  /** A prompt handed over by a console page, waiting for its fresh session. */
  const [handoff, setHandoff] = useState<string | null>(null);

  const assistantId = useRef<string | null>(null);
  /** The user message in flight, so a refused send can be taken back out. */
  const inFlight = useRef<{ userId: string; text: string } | null>(null);

  // A remembered model the gateway no longer offers falls back to the default.
  const activeModel = catalog?.models.some((m) => m.id === model) ? model : (catalog?.default ?? "");

  function pickModel(next: string) {
    setModel(next);
    storeModel(next);
  }

  /* --- session bootstrap: reuse the stored one so a reload keeps context --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A handoff ("Investigate" on the alerts page) gets its own conversation.
      const handed = pendingHandoff();
      if (handed) {
        const fresh = await api.newSession();
        if (cancelled) return;
        storeSession(fresh);
        setSessionId(fresh);
        setHandoff(handed);
        return;
      }

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

  /* --- model catalog polling ---------------------------------------------- */
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .models()
        .then((data) => alive && setCatalog(data))
        .catch(() => undefined);
    };
    load();
    api
      .capabilities()
      .then((data) => alive && setCapabilities(data))
      .catch(() => undefined);
    const timer = setInterval(load, CATALOG_INTERVAL_MS);
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
          patchAssistant((m) => ({
            ...m,
            usage: event.usage,
            model: event.model || undefined,
            requestedModel: event.requested_model || undefined,
            streaming: false,
          }));
          break;
        case "error":
          patchAssistant((m) => ({ ...m, error: event.message, streaming: false }));
          break;
        case "model_unavailable": {
          // Nothing ran: take the exchange back out and ask.
          const sent = inFlight.current;
          const dropped = new Set([assistantId.current, sent?.userId]);
          setMessages((current) => current.filter((m) => !dropped.has(m.id)));
          assistantId.current = null;
          setFallback({ text: sent?.text ?? "", requested: event.requested, fallback: event.fallback });
          break;
        }
      }
    },
    [patchAssistant],
  );

  function beginAssistantMessage() {
    const id = `assistant-${Date.now()}`;
    assistantId.current = id;
    setMessages((current) => [...current, { id, role: "assistant", text: "", streaming: true }]);
  }

  async function send(text: string, allowFallback = false) {
    if (!sessionId) return;

    // The catalog already knows the GPU is off: ask before even sending.
    const picked = catalog?.models.find((m) => m.id === activeModel);
    if (!allowFallback && catalog && picked?.provider === "local" && !picked.available) {
      setFallback({ text, requested: activeModel, fallback: catalog.fallback });
      return;
    }

    setBusy(true);
    const userId = `user-${Date.now()}`;
    inFlight.current = { userId, text };
    setMessages((current) => [...current, { id: userId, role: "user", text }]);
    beginAssistantMessage();

    const stream = streamEvents(
      "/api/chat",
      { session_id: sessionId, message: text, model: activeModel, allow_fallback: allowFallback },
      handleEvent,
      (message) => patchAssistant((m) => ({ ...m, error: message, streaming: false })),
    );
    await stream.done;
    patchAssistant((m) => ({ ...m, streaming: false }));
    inFlight.current = null;
    setBusy(false);
  }

  // `send` is a new function every render; callbacks and effects below read the
  // latest one through this ref instead of re-running whenever it changes.
  const sendRef = useRef(send);
  sendRef.current = send;

  const decideFallback = useCallback(
    (useFallback: boolean) => {
      const held = fallback;
      setFallback(null);
      if (!held) return;
      if (useFallback) void sendRef.current(held.text, true);
      else setDraft({ text: held.text });
    },
    [fallback],
  );

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

  /* --- send a handed-over prompt once its session exists ------------------ */
  useEffect(() => {
    if (!handoff || !sessionId) return;
    clearHandoff();
    setHandoff(null);
    // Once per handoff, through the ref: `send` itself changes every render.
    void sendRef.current(handoff);
  }, [handoff, sessionId]);

  const llmDown = capabilities !== null && !capabilities.llm_ready;

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col">
        <HudBackdrop />

        {llmDown && (
          <p className="relative border-b border-amber-500/25 bg-amber-500/5 px-5 py-2 text-xs text-amber-300">
            ANTHROPIC_API_KEY is not set — chat is disabled. The lab page still works.
          </p>
        )}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <MessageList messages={messages} onSuggest={sessionId && !llmDown && !busy ? (prompt) => void send(prompt) : undefined} />
        </div>
        <div className="relative">
          <Composer
            onSend={(text) => void send(text)}
            busy={busy}
            disabled={!sessionId || llmDown}
            draft={draft}
            placeholder={llmDown ? "Set ANTHROPIC_API_KEY to enable chat" : undefined}
            accessory={
              <>
                {catalog?.budget && <BudgetMeter budget={catalog.budget} />}
                <ModelPicker catalog={catalog} value={activeModel} onChange={pickModel} disabled={busy || llmDown} />
              </>
            }
          />
        </div>
      </div>

      {approval && <ApprovalDialog approval={approval} busy={busy} onDecide={decide} />}
      {fallback && (
        <FallbackDialog requested={fallback.requested} fallback={fallback.fallback} onDecide={decideFallback} />
      )}
    </>
  );
}
