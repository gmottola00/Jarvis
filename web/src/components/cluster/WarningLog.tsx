import type { EventRecord } from "../../lib/console/types";
import { since } from "../../lib/format";
import { Learn } from "../ui/primitives";
import { HudHeading } from "./hud";

/**
 * Warning events as a terminal log: age, reason and repeat count, then the
 * object (click to open it) and the message. The full, filterable list is the
 * events tab; this is the short version for the overview.
 */
export function WarningLog({
  events,
  onObject,
}: {
  events: EventRecord[];
  /** Called with `Pod/name`-style refs when an event's object is clicked. */
  onObject: (namespace: string, ref: string) => void;
}) {
  return (
    <section className="min-w-0 border border-ultron-500/22 bg-ink-900/85">
      <HudHeading title="recent warnings" note={events.length} />
      <Learn topic="events" className="mx-5 mt-3" />
      {events.length === 0 ? (
        <p className="px-5 py-4 text-xs text-ink-500">Quiet — no warnings in the retention window (about an hour).</p>
      ) : (
        <ul className="max-h-[28rem] space-y-4 overflow-y-auto px-5 py-3.5 font-mono text-xs leading-relaxed">
          {events.map((event, index) => (
            <li key={`${event.object}-${event.reason}-${event.at}-${index}`} className="space-y-1.5">
              <div className="flex flex-wrap gap-x-2.5">
                <span className="text-ink-600">{since(event.at)}</span>
                <span className="text-amber-300">WARN</span>
                <span className="text-amber-300">{event.reason}</span>
                {event.count > 1 && <span className="text-ink-500">×{event.count}</span>}
                <span className="ml-auto text-ink-600">{event.namespace}</span>
              </div>
              <button
                type="button"
                onClick={() => onObject(event.namespace, event.object)}
                className="block max-w-full truncate text-left text-ultron-300 hover:text-ink-200"
              >
                › {event.object}
              </button>
              <p className="border-l border-ink-800 pl-3 font-sans text-[12.5px] break-all text-ink-400">{event.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
