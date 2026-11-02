import { useState } from "react";
import { kubectl } from "../../lib/console/kubectl";
import { podsOf, shortName } from "../../lib/console/derive";
import type { PodDetail, WorkloadSummary } from "../../lib/console/types";
import { href } from "../../lib/route";
import { LogViewer } from "../cluster/LogViewer";
import { LearnCommand } from "../ui/primitives";

/** The backend first: that is the log you open an app for nine times out of ten. */
function defaultComponent(workloads: WorkloadSummary[]): string {
  return (workloads.find((w) => /backend|api|server/.test(w.name)) ?? workloads[0])?.name ?? "";
}

/**
 * Logs of one component at a time, every replica merged, probe noise dropped.
 * The component is part of the URL, so a link can open a specific one.
 */
export function AppLogs({
  namespace,
  workloads,
  pods,
  initial,
}: {
  namespace: string;
  workloads: WorkloadSummary[];
  pods: PodDetail[];
  /** From the URL (`#cluster/apps/tickup/logs/tickup-web`), e.g. a status link to a failing pod's workload. */
  initial?: string;
}) {
  const [component, setComponent] = useState(() =>
    initial && workloads.some((w) => w.name === initial) ? initial : defaultComponent(workloads),
  );
  const workload = workloads.find((w) => w.name === component) ?? workloads[0];
  const sample = podsOf(pods, workload)[0];
  const containers = sample?.containers.map((c) => c.name) ?? [];

  return (
    <section className="flex h-[calc(100vh-15rem)] min-h-[28rem] flex-col border border-ultron-500/22 bg-ink-900/85">
      {workloads.length > 1 && (
        <div className="flex gap-1.5 border-b border-ink-850 px-4 sm:px-5 py-2">
          {workloads.map((w) => (
            <button
              key={w.name}
              type="button"
              onClick={() => {
                setComponent(w.name);
                window.history.replaceState(null, "", href("cluster", "apps", namespace, "logs", w.name));
              }}
              className={`px-2.5 py-1 font-mono text-[11px] ${
                w.name === workload.name ? "bg-ultron-500/10 text-ultron-300 ring-1 ring-ultron-500/40" : "text-ink-500 hover:text-ink-200"
              }`}
            >
              {shortName(w.name, namespace)}
            </button>
          ))}
        </div>
      )}
      <div className="px-4 sm:px-5">
        <LearnCommand command={kubectl.appLogs(namespace, workload.selector, containers.length > 1 ? containers[0] : undefined)} />
      </div>
      <div className="min-h-0 flex-1">
        <LogViewer
          // A new component, or containers appearing once pods load, starts a fresh viewer.
          key={`${workload.name}:${containers.join(",")}`}
          source={{ kind: "workload", namespace, workload: workload.name, containers }}
        />
      </div>
    </section>
  );
}
