import type { EventRecord } from "../../lib/console/types";
import { since } from "../../lib/format";
import { Badge, Empty } from "../ui/primitives";

/**
 * Events, newest first. `count` matters: "BackOff ×9 over 18 minutes" is a
 * loop, a single BackOff is a hiccup — so first and last seen are both shown.
 */
export function EventFeed({
  events,
  onObject,
  showNamespace = true,
}: {
  events: EventRecord[];
  /** Called with `Pod/name`-style refs when an event's object is clicked. */
  onObject?: (namespace: string, ref: string) => void;
  showNamespace?: boolean;
}) {
  if (events.length === 0) return <Empty>No events in the retention window (about an hour).</Empty>;

  return (
    <ul className="divide-y divide-ink-850/60">
      {events.map((event, index) => {
        const warning = event.type === "Warning";
        return (
          <li key={`${event.object}-${event.reason}-${event.at}-${index}`} className="py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={warning ? "warn" : "idle"}>{event.reason}</Badge>
              {showNamespace && <span className="font-mono text-[10px] text-ink-600">{event.namespace}</span>}
              {onObject ? (
                <button
                  type="button"
                  onClick={() => onObject(event.namespace, event.object)}
                  className="truncate font-mono text-[11px] text-ink-200 hover:text-sky-300"
                >
                  {event.object}
                </button>
              ) : (
                <span className="truncate font-mono text-[11px] text-ink-200">{event.object}</span>
              )}
              <span className="ml-auto font-mono text-[10px] whitespace-nowrap text-ink-600">
                {event.count > 1 && <span className={warning ? "text-amber-300" : ""}>×{event.count} · </span>}
                {since(event.at)} ago
                {event.count > 1 && event.first_at && <span className="text-ink-800"> · first {since(event.first_at)} ago</span>}
              </span>
            </div>
            <p className={`mt-1 text-[11px] break-words ${warning ? "text-ink-400" : "text-ink-600"}`}>
              {event.message}
              {event.source && <span className="ml-1.5 font-mono text-[10px] text-ink-800">— {event.source}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
