import { podStatus, podTone } from "../../lib/console/derive";
import type { PodDetail } from "../../lib/console/types";
import { age } from "../../lib/format";
import { StateBadge } from "../ui/primitives";
import { Table, type Column } from "../ui/Table";
import type { Select } from "./selection";

/** `kubectl get pods -o wide`, with the broken rows tinted. */
export function PodTable({
  pods,
  onSelect,
  showNamespace = true,
  empty = "No pods match.",
}: {
  pods: PodDetail[];
  onSelect: Select;
  showNamespace?: boolean;
  empty?: string;
}) {
  const columns: Column<PodDetail>[] = [
    ...(showNamespace ? [{ key: "ns", header: "namespace", cell: (p: PodDetail) => <span className="text-ink-600">{p.namespace}</span> }] : []),
    { key: "name", header: "name", cell: (p) => <span className="text-ink-200">{p.name}</span> },
    { key: "ready", header: "ready", cell: (p) => p.ready },
    { key: "status", header: "status", cell: (p) => <StateBadge tone={podTone(p)} state={podStatus(p)} /> },
    {
      key: "restarts",
      header: "restarts",
      className: "text-right",
      cell: (p) => <span className={p.restarts ? "text-amber-300" : "text-ink-600"}>{p.restarts}</span>,
    },
    { key: "ip", header: "ip", cell: (p) => p.pod_ip || <span className="text-ink-800">none</span> },
    { key: "node", header: "node", cell: (p) => <span className="text-ink-600">{p.node || "unscheduled"}</span> },
    { key: "qos", header: "qos", cell: (p) => <span className="text-ink-600">{p.qos}</span> },
    { key: "age", header: "age", className: "text-right", cell: (p) => age(p.age) },
  ];

  return (
    <Table
      rows={pods}
      columns={columns}
      rowKey={(p) => `${p.namespace}/${p.name}`}
      rowTone={podTone}
      onRowClick={(p) => onSelect({ kind: "pod", namespace: p.namespace, name: p.name })}
      empty={empty}
    />
  );
}
