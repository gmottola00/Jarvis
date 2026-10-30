import type { ReactNode } from "react";
import { podStatus, podTone } from "../../lib/console/derive";
import type { PodDetail } from "../../lib/console/types";
import { HudHeading } from "./hud";
import type { Select } from "./selection";

/**
 * The pods that are not Running-and-ready. With any in the list the panel
 * turns into the alarm frame; when it is empty it stays a quiet HUD panel, so
 * the red is only ever on screen when something is actually wrong.
 */
export function AttentionPanel({ pods, onSelect }: { pods: PodDetail[]; onSelect: Select }) {
  const note = `${pods.length} ${pods.length === 1 ? "pod" : "pods"}`;

  if (pods.length === 0) {
    return (
      <section className="min-w-0 border border-ultron-500/22 bg-ink-900/85">
        <HudHeading title="needs attention" note={note} />
        <p className="px-5 py-4 text-xs text-ink-500">Every pod is Running and ready.</p>
      </section>
    );
  }

  return (
    <section className="hud-alarm min-w-0">
      <header className="hud-hazard flex items-center gap-2.5 border-b border-rose-400/30 px-5 py-3">
        <span aria-hidden className="animate-dot size-[7px] rounded-full bg-rose-400 shadow-[0_0_8px] shadow-rose-400" />
        <h3 className="font-display text-sm font-bold tracking-[0.25em] whitespace-nowrap text-rose-300 uppercase">needs attention</h3>
        <span className="ml-auto font-mono text-[11px] text-ink-500">{note}</span>
      </header>
      <ul className="max-h-[28rem] divide-y divide-rose-400/15 overflow-y-auto">
        {pods.map((pod) => {
          const bad = podTone(pod) === "bad";
          return (
            <li key={`${pod.namespace}/${pod.name}`}>
              <button
                type="button"
                onClick={() => onSelect({ kind: "pod", namespace: pod.namespace, name: pod.name })}
                className="flex w-full flex-col gap-3 px-5 py-4 text-left hover:bg-rose-400/5"
              >
                <span className="flex w-full min-w-0 items-baseline gap-2.5 font-mono text-[13px]">
                  <span className="whitespace-nowrap text-ink-600">{pod.namespace} /</span>
                  <span className="min-w-0 truncate text-ink-200">{pod.name}</span>
                  <span className="ml-auto text-[11px] whitespace-nowrap text-ink-600">open →</span>
                </span>
                <span className="grid w-full grid-cols-3 gap-px bg-rose-400/20">
                  <Cell label="status">
                    <span className={`font-mono text-xs font-medium [overflow-wrap:anywhere] ${bad ? "text-rose-300" : "text-amber-300"}`}>
                      {podStatus(pod)}
                    </span>
                  </Cell>
                  <Cell label="ready">
                    <span className="font-display text-xl leading-none font-bold text-ink-200">{pod.ready}</span>
                  </Cell>
                  <Cell label="restarts">
                    <span className={`font-display text-xl leading-none font-bold ${pod.restarts ? "text-amber-300" : "text-ink-200"}`}>
                      {pod.restarts}
                    </span>
                  </Cell>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1 bg-ink-900 px-3 py-2.5">
      <span className="font-mono text-[9px] tracking-[0.15em] text-ink-600 uppercase">{label}</span>
      {children}
    </span>
  );
}
