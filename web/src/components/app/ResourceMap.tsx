import { kubectl } from "../../lib/console/kubectl";
import { podStatus, podTone, podsOf, workloadTone } from "../../lib/console/derive";
import type { PodDetail, WorkloadSummary } from "../../lib/console/types";
import { NamespaceNetwork } from "../cluster/NamespacePanels";
import type { Selection } from "../cluster/selection";
import { HudPanel } from "../hud";
import { Learn, LearnCommand, StateBadge } from "../ui/primitives";
import { TONE } from "../ui/tone";

/**
 * The chain of objects behind the app, both ways: how a request gets in
 * (Ingress → Service → Endpoints → Pod) and who keeps the pods alive
 * (Deployment → ReplicaSet → Pod). Every box opens its drawer.
 */
export function ResourceMap({
  namespace,
  workloads,
  pods,
  onSelect,
}: {
  namespace: string;
  workloads: WorkloadSummary[];
  pods: PodDetail[];
  onSelect: (s: Selection) => void;
}) {
  return (
    <div className="space-y-4">
      <LearnCommand command={kubectl.appMap(namespace)} />
      <HudPanel title="Traffic" note="ingress → service → endpoints → pod">
        <NamespaceNetwork namespace={namespace} pods={pods} onSelect={onSelect} />
      </HudPanel>
      <HudPanel title="Ownership" note="workload → replicaset → pod" topic="rollout">
        <Learn topic="deployment" />
        <ul className="space-y-4">
          {workloads.map((w) => {
            const mine = podsOf(pods, w);
            const sets = [...new Set(mine.map((p) => p.owner).filter(Boolean))];
            return (
              <li key={w.name} className="font-mono text-xs">
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "workload", namespace, name: w.name })}
                  className="text-ink-200 hover:text-ultron-300"
                >
                  {w.kind}/{w.name}
                </button>
                <span className={`ml-2 ${TONE[workloadTone(w)].text}`}>
                  {w.ready}/{w.desired}
                </span>
                {(sets.length ? sets : [""]).map((rs) => (
                  <div key={rs || "direct"} className="mt-1.5 ml-2 border-l border-ink-800 pl-2 sm:ml-4 sm:pl-3">
                    {rs && <p className="[overflow-wrap:anywhere] text-ink-500">└ {rs}</p>}
                    <ul className="mt-1 ml-2 space-y-1 sm:ml-4">
                      {mine
                        .filter((p) => !rs || p.owner === rs)
                        .map((p) => (
                          <li key={p.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-ink-700">└</span>
                            <button
                              type="button"
                              onClick={() => onSelect({ kind: "pod", namespace, name: p.name })}
                              className="min-w-0 text-left [overflow-wrap:anywhere] text-ink-300 hover:text-ultron-300"
                            >
                              Pod/{p.name}
                            </button>
                            <StateBadge tone={podTone(p)} state={podStatus(p)} />
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </HudPanel>
    </div>
  );
}
