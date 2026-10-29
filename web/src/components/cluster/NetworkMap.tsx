import { endpointDiagnosis, podHealthy, podsFor } from "../../lib/console/derive";
import type { IngressView, NetworkView, PodDetail, ServiceView } from "../../lib/console/types";
import { Badge, Empty, Labels, Learn, Panel } from "../ui/primitives";
import type { Select } from "./selection";

/** `tickup/api → tickup-backend:8000` → its three parts. */
function parseRule(rule: string): { route: string; service: string; port: string } {
  const [route, target = ""] = rule.split("→").map((part) => part.trim());
  const [service, port = ""] = target.split(":");
  return { route, service, port };
}

/**
 * The path a request takes, drawn left to right:
 *
 *   tailnet host  →  Ingress rule  →  Service (virtual IP)  →  Endpoints (pod IPs)  →  Pod
 *
 * Every arrow is a lookup Kubernetes does at request time, and every one can be
 * the broken link. The map makes the empty one obvious: a Service with no
 * endpoints is drawn red, with the reason underneath.
 */
export function NetworkMap({ network, pods, onSelect }: { network: NetworkView; pods: PodDetail[]; onSelect: Select }) {
  const routed = new Set<string>();
  for (const ingress of network.ingresses)
    for (const rule of ingress.rules) routed.add(`${ingress.namespace}/${parseRule(rule).service}`);

  const internal = network.services.filter((s) => !routed.has(`${s.namespace}/${s.name}`));

  return (
    <div className="space-y-4">
      <Learn topic="ingress" />
      <Learn topic="service" />

      {network.ingresses.length === 0 && <Empty>No ingresses: nothing is reachable from outside the cluster.</Empty>}
      {network.ingresses.map((ingress) => (
        <IngressRoute key={`${ingress.namespace}/${ingress.name}`} ingress={ingress} network={network} pods={pods} onSelect={onSelect} />
      ))}

      <Panel title="Cluster-internal services" note={`${internal.length} · reachable only via cluster DNS`} flush>
        <ul className="divide-y divide-ink-850/60">
          {internal.map((service) => (
            <li key={`${service.namespace}/${service.name}`} className="px-4 py-2.5">
              <ServiceBox service={service} pods={pods} onSelect={onSelect} inline />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function IngressRoute({
  ingress,
  network,
  pods,
  onSelect,
}: {
  ingress: IngressView;
  network: NetworkView;
  pods: PodDetail[];
  onSelect: Select;
}) {
  return (
    <Panel
      title={`${ingress.namespace} / ${ingress.name}`}
      note={`ingressClass ${ingress.class_name || "default"}`}
      actions={ingress.tls_hosts.length > 0 && <Badge tone="ok">tls</Badge>}
    >
      <p className="mb-3 font-mono text-[11px] text-sky-300">
        https://{ingress.address || ingress.hosts[0] || "?"}
        {!ingress.address && <span className="ml-2 text-amber-300">no address yet — the controller has not admitted it</span>}
      </p>

      <ol className="space-y-3">
        {ingress.rules.map((rule) => {
          const { route, service: serviceName, port } = parseRule(rule);
          const service = network.services.find((s) => s.namespace === ingress.namespace && s.name === serviceName);
          return (
            <li key={rule} className="grid items-start gap-2 md:grid-cols-[minmax(8rem,12rem)_auto_1fr]">
              <div className="rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[11px]">
                <p className="text-[10px] text-ink-600 uppercase">rule</p>
                <p className="text-ink-200">{route}</p>
                <p className="text-ink-600">→ port {port}</p>
              </div>
              <Arrow />
              {service ? (
                <ServiceBox service={service} pods={pods} onSelect={onSelect} />
              ) : (
                <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 font-mono text-[11px] text-rose-300">
                  Service {serviceName} does not exist — the ingress controller will return 503.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/** A Service and, to its right, the pods its endpoints resolve to. */
function ServiceBox({
  service,
  pods,
  onSelect,
  inline = false,
}: {
  service: ServiceView;
  pods: PodDetail[];
  onSelect: Select;
  inline?: boolean;
}) {
  const behind = service.endpoints.map((ip) => ({ ip, pod: pods.find((p) => p.pod_ip === ip) }));
  const left = podsFor(service.selector, service.namespace, pods).filter((p) => !service.endpoints.includes(p.pod_ip));
  const diagnosis = endpointDiagnosis(service, pods);
  const empty = service.endpoints.length === 0;

  return (
    <div className={`grid items-start gap-2 ${inline ? "md:grid-cols-[minmax(12rem,18rem)_auto_1fr]" : "lg:grid-cols-[minmax(12rem,16rem)_auto_1fr]"}`}>
      <div className={`rounded-lg px-3 py-2 font-mono text-[11px] ring-1 ${empty ? "bg-rose-500/5 ring-rose-500/25" : "bg-ink-950/60 ring-ink-850"}`}>
        <p className="flex items-center gap-2 text-[10px] text-ink-600 uppercase">
          service · {service.type}
          {inline && <span className="normal-case">{service.namespace}</span>}
        </p>
        <p className="text-ink-200">{service.name}</p>
        <p className="text-ink-600">
          {service.cluster_ip} · {service.ports.join(", ")}
        </p>
        <div className="mt-1.5">
          <Labels labels={service.selector} />
        </div>
      </div>

      <Arrow label={`${service.endpoints.length} ep`} broken={empty} />

      <div className="space-y-1.5">
        {behind.map(({ ip, pod }) => (
          <PodChip key={ip} ip={ip} pod={pod} onSelect={onSelect} />
        ))}
        {left.map((pod) => (
          <PodChip key={pod.name} ip={pod.pod_ip || "no ip"} pod={pod} onSelect={onSelect} excluded />
        ))}
        {diagnosis && <p className="text-[11px] text-rose-300/90">{diagnosis}</p>}
      </div>
    </div>
  );
}

function PodChip({ ip, pod, onSelect, excluded = false }: { ip: string; pod?: PodDetail; onSelect: Select; excluded?: boolean }) {
  const ok = pod ? podHealthy(pod) : true;
  return (
    <button
      type="button"
      disabled={!pod}
      onClick={() => pod && onSelect({ kind: "pod", namespace: pod.namespace, name: pod.name })}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] ring-1 ${
        excluded ? "border-dashed bg-transparent ring-rose-500/30" : "bg-ink-950/60 ring-ink-850"
      } enabled:hover:ring-ink-600`}
    >
      <span className={`size-1.5 rounded-full ${ok && !excluded ? "bg-emerald-400" : "bg-rose-400"}`} />
      <span className="text-ink-400">{ip}</span>
      <span className="truncate text-ink-200">{pod?.name ?? "external endpoint"}</span>
      {excluded && <span className="ml-auto shrink-0 text-[10px] text-rose-300">not ready → excluded</span>}
    </button>
  );
}

function Arrow({ label, broken = false }: { label?: string; broken?: boolean }) {
  return (
    <div className={`flex items-center gap-1 self-center font-mono text-[10px] ${broken ? "text-rose-400" : "text-ink-800"}`}>
      <span className="hidden md:inline">──</span>
      {label && <span>{label}</span>}
      <span className="hidden md:inline">→</span>
      <span className="md:hidden">↓</span>
    </div>
  );
}
