import type { Tone } from "../../lib/console/derive";
import type { NodeDetail, ResourceUsage } from "../../lib/console/types";
import { age, bytes, cpu, percent } from "../../lib/format";
import { Gauge, GlowDot, HudCard, Leader } from "../hud";
import { Badge, Learn } from "../ui/primitives";
import { TONE_COLOR } from "../ui/tone";

/** Requests above 85% of allocatable mean the next pod may not schedule. */
function pressure(value: number): Tone {
  return value >= 85 ? "bad" : value >= 65 ? "warn" : "info";
}

/**
 * One node, read the way the scheduler reads it: how much is *reserved*
 * against what is allocatable. Live usage, when metrics-server provides it,
 * gets its own green gauges so the two numbers are never confused.
 */
export function NodeCard({
  node,
  usage,
  index,
  total,
}: {
  node: NodeDetail;
  usage?: ResourceUsage;
  index: number;
  total: number;
}) {
  const cpuReq = percent(node.requested_cpu_milli, node.allocatable_cpu_milli);
  const memReq = percent(node.requested_memory_bytes, node.allocatable_memory_bytes);
  const podsUsed = percent(node.pods_running, node.pods_capacity);
  const facts: [string, string][] = [
    ["version", node.version],
    ["ip", node.internal_ip],
    ["os", node.os_image],
    ["kernel", node.kernel],
    ["runtime", node.runtime],
    ["arch", node.architecture],
    ["taints", node.taints.join(", ") || "none — any pod can land here"],
    ["age", age(node.age)],
  ];
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <HudCard
      eyebrow={`node ${pad(index + 1)}/${pad(total)}`}
      title={node.name}
      note={node.roles.join(", ")}
      status={
        <>
          {node.unschedulable && <Badge tone="warn">cordoned</Badge>}
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.15em] ${node.ready ? "text-emerald-300" : "text-rose-300"}`}
          >
            <GlowDot tone={node.ready ? "ok" : "bad"} />
            {node.ready ? "READY" : "NOT READY"}
          </span>
        </>
      }
    >
      <Learn topic="node" className="mx-3 mt-3 sm:mx-6" />

      <div className="grid gap-8 px-4 sm:px-6 pt-5 pb-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-3 content-start gap-x-2 gap-y-5 sm:grid-cols-5">
          <Gauge
            label="cpu req"
            kind="request"
            value={cpuReq}
            color={TONE_COLOR[pressure(cpuReq)]}
            detail={`${cpu(node.requested_cpu_milli)} / ${cpu(node.allocatable_cpu_milli)} cores`}
          />
          <Gauge
            label="mem req"
            kind="request"
            value={memReq}
            color={TONE_COLOR[pressure(memReq)]}
            detail={`${bytes(node.requested_memory_bytes)} / ${bytes(node.allocatable_memory_bytes)}`}
          />
          <Gauge
            label="pods"
            kind="capacity"
            value={podsUsed}
            color={TONE_COLOR[pressure(podsUsed)]}
            detail={`${node.pods_running} / ${node.pods_capacity}`}
          />
          {usage && (
            <>
              <Gauge
                label="cpu live"
                kind="live"
                value={percent(usage.cpu_milli, node.allocatable_cpu_milli)}
                color={TONE_COLOR.ok}
                detail={`${cpu(usage.cpu_milli)} cores`}
              />
              <Gauge
                label="mem live"
                kind="live"
                value={percent(usage.memory_bytes, node.allocatable_memory_bytes)}
                color={TONE_COLOR.ok}
                detail={bytes(usage.memory_bytes)}
              />
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 border-ultron-500/15 lg:border-l lg:pl-7">
          <div className="flex flex-col gap-1.5">
            {facts.map(([key, value]) => (
              <Leader
                key={key}
                label={<span className="tracking-[0.08em] text-ink-600 uppercase">{key}</span>}
                value={value ? <span className="text-ink-200">{value}</span> : <span className="text-ink-800">—</span>}
              />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-px border border-ink-850 bg-ink-850">
            {node.conditions.map((c) => {
              // Ready is the one condition that should be True; the pressures should be False.
              const bad = c.type === "Ready" ? c.status !== "True" : c.status === "True";
              return (
                <div
                  key={c.type}
                  title={`${c.type}=${c.status}${c.reason ? ` · ${c.reason}` : ""}`}
                  className="flex flex-col items-center gap-1.5 bg-ink-900 px-1.5 py-2"
                >
                  <GlowDot tone={bad ? "bad" : "ok"} />
                  <span className={`font-mono text-[10px] ${bad ? "text-rose-300" : "text-ink-500"}`}>{c.type.replace(/Pressure$/, "")}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </HudCard>
  );
}
