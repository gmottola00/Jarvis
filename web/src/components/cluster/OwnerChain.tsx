import type { OwnerLink } from "../../lib/console/derive";

/**
 * `Deployment → ReplicaSet → Pod`, as a breadcrumb. Clicking a link that
 * `onSelect` accepts drills into it; the rest are plain text.
 */
export function OwnerChain({ chain, onSelect }: { chain: OwnerLink[]; onSelect?: (link: OwnerLink) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
      {chain.map((link, index) => {
        const clickable = onSelect && link.kind === "Deployment";
        return (
          <li key={`${link.kind}/${link.name}`} className="flex items-center gap-1">
            {index > 0 && <span className="text-ink-800">→</span>}
            <span className="text-ink-600">{link.kind}</span>
            {clickable ? (
              <button type="button" onClick={() => onSelect(link)} className="text-sky-300 hover:underline">
                {link.name}
              </button>
            ) : (
              <span className="text-ink-400">{link.name}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
