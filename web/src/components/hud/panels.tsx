import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";
import type { Topic } from "../../lib/console/learn";
import { Learn } from "../ui/primitives";
import { GlowDot } from "./marks";

/**
 * The frames, from loudest to quietest:
 *
 * - `HudCard`: cut corners and brackets. The page's main subjects (a node, an app, the alert list).
 * - `AlertPanel`: hazard-striped, rose for broken and amber for "look at this". Only when something is.
 * - `HudPanel`: a plain bordered panel with a heading. Side columns and everything else.
 * - `ToneCard`: a small card inside a list, framed by its own tone.
 */

/** Frame classes per tone. Anything not bad or warn gets the quiet frame. */
const ALARM = {
  bad: { card: "hud-alarm", header: "hud-hazard border-rose-400/30", title: "text-rose-300", tick: "bg-rose-400 shadow-rose-400" },
  warn: { card: "hud-caution", header: "hud-hazard border-amber-400/30", title: "text-amber-300", tick: "bg-amber-400 shadow-amber-400" },
};
const QUIET = { card: "border border-ink-850 bg-ink-900/60", header: "border-ink-850" };

export type AlarmTone = keyof typeof ALARM;

/** Bracket marks on all four corners. The parent must be `relative`. */
export function Corners() {
  const corner = "pointer-events-none absolute size-3.5 border-ultron-500";
  return (
    <>
      <span aria-hidden className={`${corner} -top-px -left-px border-t-2 border-l-2`} />
      <span aria-hidden className={`${corner} -top-px -right-px border-t-2 border-r-2`} />
      <span aria-hidden className={`${corner} -bottom-px -left-px border-b-2 border-l-2`} />
      <span aria-hidden className={`${corner} -right-px -bottom-px border-r-2 border-b-2`} />
    </>
  );
}

/** A panel heading: the red tick, a Rajdhani title, a mono note and any controls on the right. */
export function HudHeading({ title, note, actions }: { title: string; note?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-2.5 border-b border-ultron-500/15 px-5 py-3">
      <span aria-hidden className="h-3.5 w-[3px] bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" />
      <h3 className="font-display text-sm font-bold tracking-[0.25em] whitespace-nowrap text-ink-300 uppercase">{title}</h3>
      {(note !== undefined || actions) && (
        <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-ink-500">
          {note}
          {actions}
        </span>
      )}
    </header>
  );
}

interface PanelProps {
  title: string;
  note?: ReactNode;
  actions?: ReactNode;
  /** Shows the matching lesson under the heading while learn mode is on. */
  topic?: Topic;
  /** No inner padding: for tables and lists that bring their own. */
  flush?: boolean;
  children: ReactNode;
}

/** The everyday panel. */
export function HudPanel({ title, note, actions, topic, flush = false, children }: PanelProps) {
  return (
    <section className="min-w-0 border border-ultron-500/22 bg-ink-900/85">
      <HudHeading title={title} note={note} actions={actions} />
      {topic && <Learn topic={topic} className="mx-5 mt-3" />}
      <div className={flush ? "" : "px-5 py-3.5"}>{children}</div>
    </section>
  );
}

/**
 * A panel that is sounding an alarm. Use it only while there is something in
 * it: when the list empties, render a `HudPanel` instead, so colour on screen
 * always means something is wrong.
 */
export function AlertPanel({
  tone,
  title,
  note,
  topic,
  pulse = false,
  flush = false,
  children,
}: PanelProps & { tone: AlarmTone; pulse?: boolean }) {
  const frame = ALARM[tone];
  return (
    <section className={`${frame.card} min-w-0`}>
      <header className={`flex items-center gap-2.5 border-b px-5 py-3 ${frame.header}`}>
        {pulse ? <GlowDot tone={tone} pulse /> : <span aria-hidden className={`h-3.5 w-[3px] shadow-[0_0_8px] ${frame.tick}`} />}
        <h3 className={`font-display text-sm font-bold tracking-[0.25em] whitespace-nowrap uppercase ${frame.title}`}>{title}</h3>
        {note !== undefined && <span className={`ml-auto font-mono text-[11px] ${frame.title}`}>{note}</span>}
      </header>
      {topic && <Learn topic={topic} className="mx-5 mt-3" />}
      <div className={flush ? "" : "px-5 py-3.5"}>{children}</div>
    </section>
  );
}

/**
 * The page's main subject: cut corners, bracket marks, and a header that reads
 * `EYEBROW  TITLE  note ……… status`. The body brings its own padding.
 */
export function HudCard({
  eyebrow,
  title,
  note,
  status,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hud-frame min-w-0">
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-6 pt-4 pb-1">
        <span className="font-mono text-[10px] font-medium tracking-[0.2em] whitespace-nowrap text-ink-600 uppercase">{eyebrow}</span>
        <h3 className="font-display text-lg font-bold tracking-[0.25em] whitespace-nowrap text-ink-200 uppercase">{title}</h3>
        {note !== undefined && <span className="min-w-0 font-mono text-[11px] text-ultron-300">{note}</span>}
        {status && <span className="ml-auto flex items-center gap-2">{status}</span>}
      </header>
      {children}
    </section>
  );
}

/** A card inside a list, framed by its tone: alarm when bad, caution when warn, quiet otherwise. */
export function ToneCard({
  tone,
  header,
  children,
  as: Tag = "div",
  className = "",
}: {
  tone: Tone;
  header: ReactNode;
  children: ReactNode;
  as?: "div" | "li";
  className?: string;
}) {
  const frame = tone === "bad" || tone === "warn" ? ALARM[tone] : QUIET;
  return (
    <Tag className={`${frame.card} ${className}`}>
      <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-4 py-2.5 ${frame.header}`}>{header}</div>
      {children}
    </Tag>
  );
}

/** The quiet stand-in text inside an empty panel. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-500">{children}</p>;
}
