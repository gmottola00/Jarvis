import { podsOf, shortName, workloadTone } from "../../lib/console/derive";
import type { PodDetail, WorkloadSummary } from "../../lib/console/types";
import { shortSha, splitImage } from "../../lib/format";
import type { Selection } from "../cluster/selection";
import { GlowDot } from "../hud";
import { TONE } from "../ui/tone";

/** One chip per workload: ready count and the image tag it runs. Click to open its drawer. */
export function AppComponents({
  workloads,
  pods,
  onSelect,
}: {
  workloads: WorkloadSummary[];
  pods: PodDetail[];
  onSelect: (s: Selection) => void;
}) {
  if (!workloads.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {workloads.map((w) => {
        const restarts = podsOf(pods, w).reduce((sum, p) => sum + p.restarts, 0);
        const tone = workloadTone(w);
        return (
          <button
            key={w.name}
            type="button"
            onClick={() => onSelect({ kind: "workload", namespace: w.namespace, name: w.name })}
            className="flex items-center gap-2.5 border border-ultron-500/22 bg-ink-900/85 px-3 py-2 text-left hover:border-ultron-500/50"
          >
            <GlowDot tone={tone} size="sm" />
            <span className="font-display text-sm font-semibold tracking-[0.12em] text-ink-200">{shortName(w.name, w.namespace)}</span>
            <span className={`font-mono text-[11px] ${TONE[tone].text}`}>
              {w.ready}/{w.desired}
            </span>
            {w.images.map((img) => (
              <span key={img} className="font-mono text-[11px] text-ink-500" title={img}>
                :{shortSha(splitImage(img).tag)}
              </span>
            ))}
            {restarts > 0 && <span className="font-mono text-[11px] text-amber-300">↻{restarts}</span>}
          </button>
        );
      })}
    </div>
  );
}
