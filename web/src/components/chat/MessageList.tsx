import { useEffect, useRef } from "react";
import type { Message } from "../../lib/types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

export function MessageList({ messages }: { messages: Message[] }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md space-y-3 text-center">
          <p className="font-mono text-xs tracking-widest text-ink-800 uppercase">Jarvis · P0</p>
          <p className="text-sm text-ink-600">
            Reads the cluster freely. Writes only to Git — ArgoCD is still the only thing that changes anything.
          </p>
          <p className="text-xs text-ink-800">
            Try: <span className="font-mono text-ink-600">come sta tickup?</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-5 py-6">
      {messages.map((message) => (
        <article key={message.id} className="space-y-2.5">
          {message.role === "user" ? (
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-ink-800 px-3.5 py-2 text-sm whitespace-pre-wrap">
                {message.text}
              </p>
            </div>
          ) : (
            <>
              {message.thinking && <ThinkingBlock text={message.thinking} live={message.streaming && !message.text} />}
              {message.tools && message.tools.length > 0 && (
                <div className="space-y-1.5">
                  {message.tools.map((call) => (
                    <ToolCallCard key={call.id} call={call} />
                  ))}
                </div>
              )}
              {message.text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>}
              {message.error && (
                <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">
                  {message.error}
                </p>
              )}
              {message.usage && (
                <p className="font-mono text-[10px] text-ink-800">
                  {message.model && `${message.model} · `}
                  {message.usage.input_tokens} in · {message.usage.output_tokens} out
                  {message.usage.cache_read_tokens > 0 && ` · ${message.usage.cache_read_tokens} cached`}
                </p>
              )}
              {message.streaming && !message.text && !message.tools?.length && !message.thinking && (
                <p className="animate-dot text-sm text-ink-600">…</p>
              )}
            </>
          )}
        </article>
      ))}
      <div ref={bottom} />
    </div>
  );
}
