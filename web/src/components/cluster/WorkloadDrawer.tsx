import { useState } from "react";
import { consoleApi } from "../../lib/console/api";
import { rolloutStory, workloadTone } from "../../lib/console/derive";
import type { ManifestKind, ReplicaSetView, WorkloadSummary } from "../../lib/console/types";
import { age, shortSha, splitImage } from "../../lib/format";
import { usePolling } from "../../lib/hooks/usePolling";
import { Drawer } from "../ui/Drawer";
import { Badge, Empty, ErrorNote, Facts, Labels, Learn, LearnCommand, Loading, CardPanel, Tabs } from "../ui/primitives";
import { kubectl } from "../../lib/console/kubectl";
import { AppLink } from "./AppLink";
import { ConditionList } from "./ConditionList";
import { EventFeed } from "./EventFeed";
import { ManifestViewer } from "./ManifestViewer";
import { PodTable } from "./PodTable";
import type { Select } from "./selection";

type WorkloadTab = "rollout" | "pods" | "events" | "manifest";

const POLL_MS = 5_000;

const KIND_TOPIC = { Deployment: "deployment", StatefulSet: "statefulset", DaemonSet: "daemonset" } as const;

/**
 * One workload, read as a controller reads it: the spec it was given, the
 * replica counters it is converging, and — for a Deployment — the ReplicaSets
 * it has created along the way.
 */
export function WorkloadDrawer({ namespace, name, onSelect }: { namespace: string; name: string; onSelect: Select }) {
  const [tab, setTab] = useState<WorkloadTab>("rollout");
  const { data, error, loading } = usePolling(() => consoleApi.workload(namespace, name), POLL_MS, `${namespace}/${name}`);
  const w = data?.workload;

  return (
    <Drawer
      open
      onClose={() => onSelect(null)}
      eyebrow={w ? `${w.kind} · ${namespace}` : namespace}
      title={name}
      aside={
        <span className="flex items-center gap-2">
          <AppLink namespace={namespace} />
          {w && <Badge tone={workloadTone(w)}>{w.ready}/{w.desired} ready</Badge>}
        </span>
      }
    >
      <div className="sticky top-0 z-10 border-b border-ink-850 bg-ink-950 px-4 sm:px-5 py-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "rollout", label: "rollout" },
            { id: "pods", label: "pods", count: data?.pods.length },
            { id: "events", label: "events", count: data?.events.length },
            { id: "manifest", label: "yaml" },
          ]}
        />
      </div>

      {loading && <div className="px-4 sm:px-5 py-4"><Loading /></div>}
      {error && !data && <div className="px-4 sm:px-5 py-4"><ErrorNote errors={error} /></div>}

      {data && w && tab === "rollout" && (
        <div className="space-y-4 px-4 sm:px-5 py-4">
          <Learn topic={KIND_TOPIC[w.kind]} />
          <LearnCommand command={kubectl.workload(w.kind, namespace, name)} />
          <Counters workload={w} />

          <CardPanel title="Spec">
            <Facts
              items={[
                ["strategy", w.strategy],
                ["generation", `${w.generation} (observed ${w.observed_generation})`],
                ["images", <ul>{w.images.map((i) => <li key={i}>{i}</li>)}</ul>],
                ["selector", <Labels labels={w.selector} />],
                ["age", age(w.age)],
              ]}
            />
          </CardPanel>

          {w.kind === "Deployment" && <ReplicaSetHistory sets={data.replica_sets} />}

          {w.conditions.length > 0 && (
            <CardPanel title="Conditions">
              <ConditionList conditions={w.conditions} />
            </CardPanel>
          )}
        </div>
      )}

      {data && tab === "pods" && (
        <div className="px-4 sm:px-5 py-4">
          <CardPanel title="Pods" note={w && `selector ${selectorText(w.selector)}`} flush>
            <PodTable pods={data.pods} onSelect={onSelect} showNamespace={false} />
          </CardPanel>
        </div>
      )}

      {data && tab === "events" && (
        <div className="px-4 sm:px-5 py-4">
          <CardPanel title="Events" topic="events">
            <EventFeed events={data.events} showNamespace={false} />
          </CardPanel>
        </div>
      )}

      {w && tab === "manifest" && <ManifestViewer kind={w.kind.toLowerCase() as ManifestKind} namespace={namespace} name={name} />}
    </Drawer>
  );
}

const selectorText = (selector: Record<string, string>) =>
  Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

/** The four counters, side by side, with the sentence they add up to. */
function Counters({ workload }: { workload: WorkloadSummary }) {
  const cells = [
    ["desired", workload.desired, "spec.replicas"],
    ["updated", workload.updated, "on the newest template"],
    ["ready", workload.ready, "passing readiness"],
    ["available", workload.available, "ready ≥ minReadySeconds"],
  ] as const;

  return (
    <CardPanel title="Replicas" topic="rollout">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map(([label, value, hint]) => {
          const short = label !== "desired" && value < workload.desired;
          return (
            <div key={label} className="rounded-lg bg-ink-950/60 px-3 py-2">
              <p className="font-mono text-[10px] text-ink-600 uppercase">{label}</p>
              <p className={`font-mono text-lg ${short ? "text-amber-300" : "text-ink-200"}`}>{value}</p>
              <p className="text-[10px] text-ink-800">{hint}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-400">{rolloutStory(workload)}</p>
    </CardPanel>
  );
}

/**
 * Revision history. The current ReplicaSet holds the replicas; older ones sit
 * at zero with their pod template intact, which is exactly what makes
 * `kubectl rollout undo` instant — it just scales an old one back up.
 */
function ReplicaSetHistory({ sets }: { sets: ReplicaSetView[] }) {
  return (
    <CardPanel title="ReplicaSets" note="rollout history, newest first">
      {sets.length === 0 ? (
        <Empty>No ReplicaSets found for this selector.</Empty>
      ) : (
        <ol className="relative space-y-3 border-l border-ink-850 pl-4">
          {sets.map((rs) => (
            <li key={rs.name} className="relative">
              <span
                className={`absolute top-1.5 -left-[1.3rem] size-2 rounded-full ring-2 ring-ink-950 ${rs.current ? "bg-sky-400" : "bg-ink-800"}`}
              />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px]">
                <span className={rs.current ? "text-sky-300" : "text-ink-600"}>rev {rs.revision || "?"}</span>
                <span className="text-ink-200">{rs.name}</span>
                <span className="text-ink-600">
                  {rs.ready}/{rs.desired} · {age(rs.age)} ago
                </span>
                {rs.current && <Badge tone="info">current</Badge>}
              </div>
              {rs.images.map((image) => {
                const { name, tag } = splitImage(image);
                return (
                  <p key={image} className="mt-0.5 font-mono text-[10px] text-ink-600" title={image}>
                    {name}:{shortSha(tag)}
                  </p>
                );
              })}
            </li>
          ))}
        </ol>
      )}
    </CardPanel>
  );
}
