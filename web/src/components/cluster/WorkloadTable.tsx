import { workloadTone } from "../../lib/console/derive";
import type { WorkloadSummary } from "../../lib/console/types";
import { age, shortSha, splitImage } from "../../lib/format";
import { Badge } from "../ui/primitives";
import { Table, type Column } from "../ui/Table";
import type { Select } from "./selection";

const KIND_SHORT = { Deployment: "deploy", StatefulSet: "sts", DaemonSet: "ds" } as const;

/** Deployments, StatefulSets and DaemonSets in one list — the things you actually write. */
export function WorkloadTable({ workloads, onSelect }: { workloads: WorkloadSummary[]; onSelect: Select }) {
  const columns: Column<WorkloadSummary>[] = [
    { key: "ns", header: "namespace", cell: (w) => <span className="text-ink-600">{w.namespace}</span> },
    { key: "kind", header: "kind", cell: (w) => <span className="text-ink-600">{KIND_SHORT[w.kind]}</span> },
    { key: "name", header: "name", cell: (w) => <span className="text-ink-200">{w.name}</span> },
    {
      key: "ready",
      header: "ready",
      cell: (w) => (
        <Badge tone={workloadTone(w)}>
          {w.ready}/{w.desired}
        </Badge>
      ),
    },
    {
      key: "updated",
      header: "up-to-date",
      className: "text-right",
      cell: (w) => <span className={w.updated < w.desired ? "text-amber-300" : ""}>{w.updated}</span>,
    },
    { key: "available", header: "available", className: "text-right", cell: (w) => w.available },
    {
      key: "images",
      header: "images",
      cell: (w) => (
        <span className="text-ink-600">
          {w.images.map((image) => {
            const { name, tag } = splitImage(image);
            return (
              <span key={image} className="block" title={image}>
                {name}:<span className="text-ink-400">{shortSha(tag)}</span>
              </span>
            );
          })}
        </span>
      ),
    },
    { key: "age", header: "age", className: "text-right", cell: (w) => age(w.age) },
  ];

  return (
    <Table
      rows={workloads}
      columns={columns}
      rowKey={(w) => `${w.kind}/${w.namespace}/${w.name}`}
      rowTone={workloadTone}
      onRowClick={(w) => onSelect({ kind: "workload", namespace: w.namespace, name: w.name })}
      empty="No workloads in this namespace."
    />
  );
}
