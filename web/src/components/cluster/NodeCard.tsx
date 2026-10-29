import type { Tone } from "../../lib/console/derive";
import type { NodeDetail, ResourceUsage } from "../../lib/console/types";
import { age, bytes, cpu, percent } from "../../lib/format";
import { Badge, Facts, Meter, Panel } from "../ui/primitives";

/** Requests above 85% of allocatable mean the next pod may not schedule. */
function pressure(value: number): Tone {
  return value >= 85 ? "bad" : value >= 65 ? "warn" : "info";
}

/**
 * One node, read the way the scheduler reads it: how much is *reserved*
 * against what is allocatable. Live usage, when metrics-server provides it,
 * is drawn separately so the two numbers are never confused.
 */
export function NodeCard({ node, usage }: { node: NodeDetail; usage?: ResourceUsage }) {
  const cpuReq = percent(node.requested_cpu_milli, node.allocatable_cpu_milli);
  const memReq = percent(node.requested_memory_bytes, node.allocatable_memory_bytes);
  const podsUsed = percent(node.pods_running, node.pods_capacity);
  const problems = node.conditions.filter((c) => (c.type === "Ready" ? c.status !== "True" : c.status === "True"));

  return (
    <Panel
      title={node.name}
      note={node.roles.join(", ")}
      topic="node"
      actions={
        <>
          {node.unschedulable && <Badge tone="warn">cordoned</Badge>}
          <Badge tone={node.ready ? "ok" : "bad"}>{node.ready ? "Ready" : "NotReady"}</Badge>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <Meter
            label="cpu requested"
            value={cpuReq}
            tone={pressure(cpuReq)}
            detail={`${cpu(node.requested_cpu_milli)} / ${cpu(node.allocatable_cpu_milli)} cores`}
          />
          <Meter
            label="memory requested"
            value={memReq}
            tone={pressure(memReq)}
            detail={`${bytes(node.requested_memory_bytes)} / ${bytes(node.allocatable_memory_bytes)}`}
          />
          <Meter label="pods" value={podsUsed} tone={pressure(podsUsed)} detail={`${node.pods_running} / ${node.pods_capacity}`} />

          {usage && (
            <div className="space-y-3 border-t border-ink-850 pt-3">
              <Meter
                label="cpu used (live)"
                value={percent(usage.cpu_milli, node.allocatable_cpu_milli)}
                tone="ok"
                detail={cpu(usage.cpu_milli)}
              />
              <Meter
                label="memory used (live)"
                value={percent(usage.memory_bytes, node.allocatable_memory_bytes)}
                tone="ok"
                detail={bytes(usage.memory_bytes)}
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Facts
            items={[
              ["version", node.version],
              ["ip", node.internal_ip],
              ["os", node.os_image],
              ["kernel", node.kernel],
              ["runtime", node.runtime],
              ["arch", node.architecture],
              ["taints", node.taints.join(", ") || "none — any pod can land here"],
              ["age", age(node.age)],
            ]}
          />
          <div className="flex flex-wrap gap-1.5">
            {node.conditions.map((c) => {
              const bad = problems.includes(c);
              return (
                <Badge key={c.type} tone={bad ? "bad" : "idle"} title={c.reason}>
                  {c.type}={c.status}
                </Badge>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
