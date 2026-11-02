import { useState } from "react";
import { consoleApi } from "../../lib/console/api";
import { ownerChain, podStatus, podTone } from "../../lib/console/derive";
import type { WorkloadSummary } from "../../lib/console/types";
import { age } from "../../lib/format";
import { usePolling } from "../../lib/hooks/usePolling";
import { Drawer } from "../ui/Drawer";
import { Badge, ErrorNote, Facts, Labels, Learn, LearnCommand, Loading, CardPanel, StateBadge, Tabs } from "../ui/primitives";
import { kubectl } from "../../lib/console/kubectl";
import { ConditionList } from "./ConditionList";
import { ContainerCard } from "./ContainerCard";
import { EventFeed } from "./EventFeed";
import { AppLink } from "./AppLink";
import { LogViewer } from "./LogViewer";
import { ManifestViewer } from "./ManifestViewer";
import { OwnerChain } from "./OwnerChain";
import type { Select } from "./selection";

type PodTab = "overview" | "containers" | "logs" | "manifest";

const POLL_MS = 5_000;

/** Everything `kubectl describe pod` prints, split into tabs that read top-down. */
export function PodDrawer({
  namespace,
  name,
  workloads,
  onSelect,
}: {
  namespace: string;
  name: string;
  workloads: WorkloadSummary[];
  onSelect: Select;
}) {
  const [tab, setTab] = useState<PodTab>("overview");
  const key = `${namespace}/${name}`;
  const pod = usePolling(() => consoleApi.pod(namespace, name), POLL_MS, key);
  const events = usePolling(() => consoleApi.events(namespace, 200), POLL_MS * 2, key);

  const data = pod.data;
  const mine = (events.data ?? []).filter((e) => e.object === `Pod/${name}`);
  const containers = data ? [...data.init_containers, ...data.containers] : [];

  return (
    <Drawer
      open
      onClose={() => onSelect(null)}
      eyebrow={data ? <OwnerChain chain={ownerChain(data, workloads)} onSelect={(link) => onSelect({ kind: "workload", namespace, name: link.name })} /> : namespace}
      title={name}
      aside={
        <span className="flex items-center gap-2">
          <AppLink namespace={namespace} />
          {data && <Badge tone={podTone(data)}>{podStatus(data)}</Badge>}
        </span>
      }
    >
      <div className="sticky top-0 z-10 border-b border-ink-850 bg-ink-950 px-4 sm:px-5 py-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "overview", label: "overview" },
            { id: "containers", label: "containers", count: containers.length },
            { id: "logs", label: "logs" },
            { id: "manifest", label: "yaml" },
          ]}
        />
      </div>

      {pod.loading && <div className="px-4 sm:px-5 py-4"><Loading /></div>}
      {pod.error && !data && <div className="px-4 sm:px-5 py-4"><ErrorNote errors={pod.error} /></div>}

      {data && tab === "overview" && (
        <div className="space-y-4 px-4 sm:px-5 py-4">
          <Learn topic="pod" />
          <LearnCommand command={kubectl.pod(namespace, name)} />
          <StateBadge tone={podTone(data)} state={podStatus(data)} explain />
          {data.message && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 font-mono text-[11px] break-words text-amber-300">
              {data.message}
            </p>
          )}

          <CardPanel title="Placement">
            <Facts
              items={[
                ["phase", data.phase],
                ["ready", data.ready],
                ["node", data.node],
                ["pod ip", data.pod_ip || "not assigned — the sandbox has not started"],
                ["host ip", data.host_ip],
                ["qos", data.qos],
                ["account", data.service_account],
                ["restart", data.restart_policy],
                ["age", age(data.age)],
              ]}
            />
          </CardPanel>

          <CardPanel title="Conditions" topic="conditions">
            <ConditionList conditions={data.conditions} />
          </CardPanel>

          <CardPanel title="Labels" note="what selectors match on">
            <Labels labels={data.labels} />
          </CardPanel>

          {data.volumes.length > 0 && (
            <CardPanel title="Volumes">
              <Facts items={data.volumes.map((v) => [v.name, `${v.kind}${v.source ? ` → ${v.source}` : ""}`])} />
            </CardPanel>
          )}

          <CardPanel title="Events" note={mine.length ? `${mine.length}` : undefined} topic="events">
            <EventFeed events={mine} showNamespace={false} />
          </CardPanel>
        </div>
      )}

      {data && tab === "containers" && (
        <div className="space-y-3 px-4 sm:px-5 py-4">
          <Learn topic="requests" />
          <Learn topic="probes" />
          {data.containers.some((c) => c.restarts > 0) && <Learn topic="restarts" />}
          {containers.map((container) => (
            <ContainerCard key={container.name} container={container} />
          ))}
        </div>
      )}

      {data && tab === "logs" && (
        <div className="flex h-full flex-col">
          <Learn topic="logs" className="mx-5 my-3" />
          <div className="mx-5 -mt-2 mb-2">
            <LearnCommand command={kubectl.podLogs(namespace, name, data.containers[0]?.name)} />
          </div>
          <div className="min-h-0 flex-1">
            <LogViewer source={{ kind: "pod", namespace, pod: name, containers: data.containers.map((c) => c.name) }} />
          </div>
        </div>
      )}

      {tab === "manifest" && <ManifestViewer kind="pod" namespace={namespace} name={name} />}
    </Drawer>
  );
}
