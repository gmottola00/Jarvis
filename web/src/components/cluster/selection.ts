/** What the drawer is showing. Lifted to the page so any table can open any object. */
export type Selection = { kind: "pod" | "workload"; namespace: string; name: string } | null;

export type Select = (selection: Selection) => void;
