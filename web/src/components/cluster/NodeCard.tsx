import type { Tone } from "../../lib/console/derive";
import type { NodeDetail, ResourceUsage } from "../../lib/console/types";
import { age, bytes, cpu, percent } from "../../lib/format";
import { Badge, Learn } from "../ui/primitives";
import { Gauge, TONE_COLOR } from "./hud";

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
    <section className="hud-frame min-w-0">
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-6 pt-4">
        <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600">
          NODE {pad(index + 1)}/{pad(total)}
        </span>
        <h3 className="font-display text-lg font-bold tracking-[0.25em] text-ink-200 uppercase">{node.name}</h3>
        <span className="font-mono text-[11px] text-ultron-300">{node.roles.join(", ")}</span>
        <span className="ml-auto flex items-center gap-2">
          {node.unschedulable && <Badge tone="warn">cordoned</Badge>}
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.15em] ${node.ready ? "text-emerald-300" : "text-rose-300"}`}
          >
            <span className={`size-[7px] rounded-full shadow-[0_0_8px] ${node.ready ? "bg-emerald-400 shadow-emerald-400" : "bg-rose-400 shadow-rose-400"}`} />
            {node.ready ? "READY" : "NOT READY"}
          </span>
        </span>
      </header>
      <Learn topic="node" className="mx-6 mt-3" />

      <div className="grid gap-8 px-6 pt-5 pb-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
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
          <dl className="flex flex-col gap-1.5 font-mono text-xs">
            {facts.map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-2">
                <dt className="shrink-0 tracking-[0.08em] text-ink-600 uppercase">{key}</dt>
                <span aria-hidden className="min-w-4 flex-1 -translate-y-[3px] border-b border-dotted border-ink-800" />
                <dd className="min-w-0 text-right [overflow-wrap:anywhere] text-ink-200">{value || <span className="text-ink-800">—</span>}</dd>
              </div>
            ))}
          </dl>
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
                  <span className={`size-2 rounded-full shadow-[0_0_8px] ${bad ? "bg-rose-400 shadow-rose-400" : "bg-emerald-400 shadow-emerald-400"}`} />
                  <span className={`font-mono text-[10px] ${bad ? "text-rose-300" : "text-ink-500"}`}>{c.type.replace(/Pressure$/, "")}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
