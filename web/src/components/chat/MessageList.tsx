import { CircleAlert, Shuffle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Message } from "../../lib/types";
import { UltronCore } from "../shell/UltronCore";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

const SUGGESTIONS = [
  "Come sta il cluster?",
  "Quali pod sono in crash e perché?",
  "Cosa è stato deployato oggi?",
  "Ci sono alert attivi?",
];

function EmptyState({ onSuggest }: { onSuggest?: (prompt: string) => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="max-w-lg space-y-6 text-center">
        <div className="flex justify-center">
          <UltronCore size={84} live />
        </div>
        <div className="space-y-2">
          <p className="glow-red font-display text-3xl font-bold tracking-[0.4em] text-ultron-400">ULTRON</p>
          <p className="text-sm text-ink-500">
            Reads the cluster freely. Writes only to Git — ArgoCD is still the only thing that changes anything.
          </p>
        </div>
        {onSuggest && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSuggest(prompt)}
                className="rounded-md border border-ink-850 bg-ink-900/60 px-3 py-2 text-left text-xs text-ink-400 transition-colors hover:border-ultron-700 hover:bg-ultron-500/5 hover:text-ink-200"
              >
                <span className="mr-1.5 font-mono text-ultron-500">›</span>
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1">
        <p className="text-right font-mono text-[10px] tracking-widest text-ink-600 uppercase">you</p>
        <p className="border-r-2 border-ultron-500 bg-ink-850/70 px-3.5 py-2 text-sm whitespace-pre-wrap text-ink-200">
          {message.text}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const live = Boolean(message.streaming);
  const swapped = message.requestedModel && message.model && message.requestedModel !== message.model;
  const idle = live && !message.text && !message.tools?.length && !message.thinking;

  return (
    <div className="flex gap-3">
      <div className="pt-1">
        <UltronCore size={28} live={live} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-ink-600 uppercase">
          <span className="font-display text-xs font-bold tracking-[0.3em] text-ultron-400">ULTRON</span>
          {message.model && <span className="normal-case">· {message.model}</span>}
          {live && <span className="animate-dot text-ultron-400">· live</span>}
        </p>

        <div className="hud-frame space-y-3 px-4 py-3">
          {message.thinking && <ThinkingBlock text={message.thinking} live={live && !message.text} />}
          {message.tools && message.tools.length > 0 && (
            <div className="space-y-1">
              {message.tools.map((call) => (
                <ToolCallCard key={call.id} call={call} />
              ))}
            </div>
          )}
          {message.text && <Markdown text={message.text} />}
          {message.error && (
            <p className="flex items-start gap-2 rounded-md border border-ultron-700 bg-ultron-500/10 px-3 py-2 text-sm text-ultron-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {message.error}
            </p>
          )}
          {idle && (
            <p className="flex items-center gap-1 font-mono text-xs text-ultron-400">
              <span className="animate-dot">▮</span>
              <span className="text-ink-600">processing</span>
            </p>
          )}
        </div>

        {(message.usage || (!live && message.text)) && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5 font-mono text-[10px] text-ink-600">
            {swapped && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/25">
                <Shuffle className="size-3" />
                asked {message.requestedModel}, served by {message.model}
              </span>
            )}
            {message.usage && (
              <>
                <span>{message.usage.input_tokens} in</span>
                <span>{message.usage.output_tokens} out</span>
                {message.usage.cache_read_tokens > 0 && <span>{message.usage.cache_read_tokens} cached</span>}
              </>
            )}
            {!live && message.text && <CopyButton text={message.text} className="ml-auto" />}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages, onSuggest }: { messages: Message[]; onSuggest?: (prompt: string) => void }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) return <EmptyState onSuggest={onSuggest} />;

  return (
    <div className="mx-auto max-w-4xl space-y-7 px-4 py-6 sm:px-6">
      {messages.map((message) => (
        <article key={message.id}>
          {message.role === "user" ? <UserMessage message={message} /> : <AssistantMessage message={message} />}
        </article>
      ))}
      <div ref={bottom} />
    </div>
  );
}
