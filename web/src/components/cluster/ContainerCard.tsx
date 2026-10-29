import { containerTone, exitMeaning } from "../../lib/console/derive";
import type { ContainerView, Probe } from "../../lib/console/types";
import { since, splitImage } from "../../lib/format";
import { Badge, Facts } from "../ui/primitives";

const PROBE_EFFECT: Record<Probe["kind"], string> = {
  liveness: "fails → restart",
  readiness: "fails → out of endpoints",
  startup: "gates the other two",
};

/**
 * One container: what it runs, what state it is in, what it last died of, and
 * the contract it has with the kubelet (resources, probes).
 */
export function ContainerCard({ container }: { container: ContainerView }) {
  const tone = containerTone(container);
  const image = splitImage(container.image);
  const crashed = container.last_exit_code !== null || container.last_reason;

  return (
    <article className="rounded-lg border border-ink-850 bg-ink-950/40">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-850 px-3 py-2">
        <span className="font-mono text-xs text-ink-200">{container.name}</span>
        {container.init && <Badge tone="idle">init</Badge>}
        <Badge tone={tone}>{container.reason || container.state}</Badge>
        <span className="ml-auto font-mono text-[10px] text-ink-600">
          {container.ready ? "ready" : "not ready"} · {container.restarts} restarts
          {container.state_since && ` · ${container.state} for ${since(container.state_since)}`}
        </span>
      </header>

      <div className="space-y-3 px-3 py-3">
        {container.message && <p className="font-mono text-[11px] break-words text-amber-300/90">{container.message}</p>}

        {crashed && (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-2">
            <p className="font-mono text-[10px] text-rose-300 uppercase">
              last run · {container.last_reason || "terminated"} · exit {container.last_exit_code ?? "?"}
              {container.last_finished_at && ` · ${since(container.last_finished_at)} ago`}
            </p>
            <p className="mt-1 text-[11px] text-ink-400">{exitMeaning(container.last_exit_code, container.last_reason)}</p>
          </div>
        )}

        <Facts
          items={[
            ["image", <span title={container.image}>{image.repo}:<span className="text-ink-200">{image.tag.slice(0, 12)}</span></span>],
            ["digest", container.image_id.split("@")[1]],
            ["ports", container.ports.join(", ")],
            ["env", container.env_names.join(", ")],
            ["mounts", container.mounts.length ? <ul>{container.mounts.map((m) => <li key={m}>{m}</li>)}</ul> : ""],
          ]}
        />

        <Resources requests={container.requests} limits={container.limits} />

        {container.probes.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[10px] text-ink-600 uppercase">probes</p>
            <ul className="space-y-1">
              {container.probes.map((probe) => (
                <li key={probe.kind} className="grid grid-cols-[5.5rem_1fr] gap-2 font-mono text-[11px]">
                  <span className="text-ink-400">{probe.kind}</span>
                  <span className="text-ink-600">
                    <span className="text-ink-200">{probe.action}</span> · after {probe.delay}s, every {probe.period}s, timeout{" "}
                    {probe.timeout}s, {probe.failures}× {PROBE_EFFECT[probe.kind]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

/** Requests next to limits, with the missing ones called out — a missing limit is a choice too. */
function Resources({ requests, limits }: { requests: Record<string, string>; limits: Record<string, string> }) {
  const keys = ["cpu", "memory"];
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] text-ink-600 uppercase">resources</p>
      <table className="font-mono text-[11px]">
        <thead>
          <tr className="text-[10px] text-ink-600">
            <th className="pr-6 text-left font-normal" />
            <th className="pr-6 text-left font-normal">request (reserved)</th>
            <th className="text-left font-normal">limit (enforced)</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td className="pr-6 text-ink-600">{key}</td>
              <td className="pr-6 text-ink-200">{requests[key] ?? <span className="text-amber-300/80">none</span>}</td>
              <td className="text-ink-200">
                {limits[key] ?? (
                  <span className="text-ink-600">{key === "cpu" ? "none · can burst, never killed for CPU" : "none · can use the whole node"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
