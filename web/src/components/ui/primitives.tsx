/**
 * The plain building blocks: status dots and badges, facts, labels, lessons,
 * and the loading / empty / error states. The HUD frames and page shell live
 * in `components/hud`; these are what goes inside them, and inside drawers.
 */

import { useState, type ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";
import { LESSONS, explainState, type Topic } from "../../lib/console/learn";
import { useLearnMode } from "../../lib/hooks/useLearnMode";
import { TONE } from "./tone";

/* --- Status --------------------------------------------------------------- */

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${TONE[tone].dot} ${pulse ? "animate-dot" : ""}`} />;
}

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap ring-1 ${TONE[tone].soft} ${TONE[tone].text}`}
    >
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/* --- Layout --------------------------------------------------------------- */

/**
 * The rounded card panel of the drawers and the network map: denser than
 * `HudPanel`, for detail views inside a page rather than the page itself.
 */
export function CardPanel({
  title,
  note,
  topic,
  actions,
  children,
  flush = false,
}: {
  title: string;
  note?: ReactNode;
  /** Shows the matching lesson under the header while learn mode is on. */
  topic?: Topic;
  actions?: ReactNode;
  children: ReactNode;
  /** No inner padding — for tables that run edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-ink-850 bg-ink-900/40">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-850 px-4 py-2.5">
        <h3 className="flex items-center gap-2 font-display text-xs font-semibold tracking-[0.2em] text-ink-400 uppercase">
          <span className="h-3 w-0.5 bg-ultron-500" aria-hidden />
          {title}
        </h3>
        {note && <span className="font-mono text-[10px] text-ink-800">{note}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      {topic && <Learn topic={topic} className="mx-4 mt-3" />}
      <div className={flush ? "" : "px-4 py-3"}>{children}</div>
    </section>
  );
}

/** Key/value pairs, two columns, mono values. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-[10px] text-ink-600 uppercase">{key}</dt>
          <dd className="min-w-0 font-mono text-[11px] [overflow-wrap:anywhere] text-ink-400">{value || <span className="text-ink-800">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `app=tickup-web` chips. Labels are the glue of Kubernetes; they deserve to be visible. */
export function Labels({ labels, highlight = {} }: { labels: Record<string, string>; highlight?: Record<string, string> }) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return <span className="font-mono text-[10px] text-ink-800">no labels</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => {
        const hit = highlight[key] === value;
        return (
          <span
            key={key}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ${
              hit ? "bg-sky-500/10 text-sky-300 ring-sky-500/25" : "bg-ink-850/60 text-ink-400 ring-ink-800"
            }`}
          >
            {key}={value}
          </span>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] ${
            value === tab.id ? "bg-ink-850 text-ink-200" : "text-ink-600 hover:text-ink-400"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 text-ink-800">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* --- Learning ------------------------------------------------------------- */

/** A lesson from `learn.ts`, shown only in learn mode. */
export function Learn({ topic, className = "" }: { topic: Topic; className?: string }) {
  const { on } = useLearnMode();
  if (!on) return null;
  const lesson = LESSONS[topic];
  return (
    <aside className={`rounded-lg border border-sky-500/15 bg-sky-500/[0.04] px-3 py-2 ${className}`}>
      <p className="text-[11px] leading-relaxed text-ink-400">
        <span className="mr-1.5 font-mono text-[10px] text-sky-300 uppercase">{lesson.title}</span>
        <Prose text={lesson.body} />
      </p>
      {lesson.kubectl && <Kubectl command={lesson.kubectl} />}
    </aside>
  );
}

/** Just enough markup for the lessons: `code` and *emphasis*. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*[^*]+\*)/).map((part, index) => {
        if (part.startsWith("`")) return <code key={index} className="font-mono text-[10px] text-ink-200">{part.slice(1, -1)}</code>;
        if (part.startsWith("*")) return <em key={index} className="text-ink-200 not-italic">{part.slice(1, -1)}</em>;
        return part;
      })}
    </>
  );
}

/** A `Kubectl` line that only shows in learn mode: the command behind the view below it. */
export function LearnCommand({ command }: { command: string }) {
  const { on } = useLearnMode();
  return on ? <Kubectl command={command} /> : null;
}

/** A status badge that says what its word means: as a tooltip always, spelled out in learn mode. */
export function StateBadge({ tone, state, explain = false }: { tone: Tone; state: string; explain?: boolean }) {
  const { on } = useLearnMode();
  const meaning = explainState(state);
  return (
    <span className="inline-flex flex-col gap-1">
      <Badge tone={tone} title={meaning}>
        {state}
      </Badge>
      {explain && on && meaning && <span className="max-w-md text-[11px] leading-snug text-ink-400">{meaning}</span>}
    </span>
  );
}

/** The terminal command that shows the same thing, click to copy. */
export function Kubectl({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(command.replace(/\s+#.*$/, ""))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => undefined);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="mt-1.5 flex w-full items-center gap-2 rounded bg-ink-950/60 px-2 py-1 text-left font-mono text-[10px] text-ink-400 hover:text-ink-200"
    >
      <span className="text-sky-400/70">$</span>
      <span className="min-w-0 flex-1 truncate">{command}</span>
      <span className="text-ink-800">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

/* --- States --------------------------------------------------------------- */

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-xs text-ink-600">{children}</p>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-2 font-mono text-[11px] text-ink-600">
      <Dot tone="info" pulse /> {label}
    </p>
  );
}

/**
 * Per-capability failures. One missing credential fails every call that needs
 * it, so identical messages are folded into one line listing where they hit.
 */
export function ErrorNote({ errors }: { errors: Record<string, string> | string | null }) {
  if (!errors) return null;
  const entries = typeof errors === "string" ? [["request", errors]] : Object.entries(errors);
  if (entries.length === 0) return null;

  const byMessage = new Map<string, string[]>();
  for (const [name, message] of entries) byMessage.set(message, [...(byMessage.get(message) ?? []), name]);

  return (
    <div className="space-y-1 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2">
      {[...byMessage].map(([message, names]) => (
        <p key={message} className="font-mono text-[10px] break-words text-rose-300">
          {message}
          <span className="block text-rose-400/60">
            {names.length > 1 ? `${names.length}× · ` : ""}
            {names.join(", ")}
          </span>
        </p>
      ))}
    </div>
  );
}

export function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md px-2 py-1 font-mono text-[10px] text-ink-600 ring-1 ring-ink-850 hover:text-ink-200 hover:ring-ink-800"
    >
      {children}
    </button>
  );
}
