import { splitRef } from "../../lib/console/derive";

/** What the drawer is showing. Lifted to the page so any table can open any object. */
export type Selection = { kind: "pod" | "workload"; namespace: string; name: string } | null;

export type Select = (selection: Selection) => void;

const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

/** Open the drawer for an event's `Kind/name` ref, when it is a pod or a workload. */
export function refOpener(select: Select): (namespace: string, ref: string) => void {
  return (namespace, ref) => {
    const [kind, name] = splitRef(ref);
    if (kind === "Pod") select({ kind: "pod", namespace, name });
    else if (WORKLOAD_KINDS.has(kind)) select({ kind: "workload", namespace, name });
  };
}
