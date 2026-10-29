import type { NamespaceSummary } from "../../lib/console/types";

/**
 * Namespace chips that double as a filter — the `-n` flag, clickable. The
 * count shows ready/total so a namespace with a broken pod stands out before
 * you open it.
 */
export function NamespaceFilter({
  namespaces,
  value,
  onChange,
}: {
  namespaces: NamespaceSummary[];
  value: string;
  onChange: (namespace: string) => void;
}) {
  const chip = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 ${
      active ? "bg-ink-850 text-ink-200 ring-ink-800" : "text-ink-600 ring-ink-850 hover:text-ink-400"
    }`;

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      <button type="button" className={chip(value === "all")} onClick={() => onChange("all")}>
        all namespaces
      </button>
      {namespaces.map((ns) => {
        const degraded = ns.pods_ready < ns.pods_total;
        return (
          <button key={ns.name} type="button" className={chip(value === ns.name)} onClick={() => onChange(ns.name)}>
            {ns.name}
            {ns.pods_total > 0 && (
              <span className={degraded ? "text-amber-300" : "text-ink-800"}>
                {ns.pods_ready}/{ns.pods_total}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
