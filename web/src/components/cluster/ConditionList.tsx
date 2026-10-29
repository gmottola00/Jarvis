import type { PodCondition } from "../../lib/console/types";
import { since } from "../../lib/format";
import { Dot } from "../ui/primitives";

/**
 * Conditions as a checklist. For pods the API order is arbitrary, so they are
 * sorted into lifecycle order — the first red one is where the pod is stuck.
 */
const LIFECYCLE = ["PodScheduled", "Initialized", "ContainersReady", "Ready", "Available", "Progressing"];

export function ConditionList({ conditions }: { conditions: PodCondition[] }) {
  const ordered = [...conditions].sort((a, b) => rank(a.type) - rank(b.type));
  return (
    <ol className="space-y-1.5">
      {ordered.map((condition) => {
        const ok = condition.status === "True";
        return (
          <li key={condition.type} className="grid grid-cols-[auto_9rem_1fr] items-baseline gap-2 font-mono text-[11px]">
            <Dot tone={ok ? "ok" : "bad"} />
            <span className={ok ? "text-ink-400" : "text-rose-300"}>{condition.type}</span>
            <span className="min-w-0 text-[10px] break-words text-ink-600">
              {condition.reason}
              {condition.message && ` — ${condition.message}`}
              {condition.at && <span className="text-ink-800"> · {since(condition.at)} ago</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function rank(type: string): number {
  const index = LIFECYCLE.indexOf(type);
  return index < 0 ? LIFECYCLE.length : index;
}
