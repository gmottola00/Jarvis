import { Learn } from "../ui/primitives";

const STAGES = [
  { system: "GitHub Actions", what: "builds & tests", artefact: "commit SHA", column: "ci green" },
  { system: "GHCR", what: "stores the image", artefact: "image:sha", column: "newest" },
  { system: "Home-Lab-Infra", what: "pins the tag", artefact: "kustomization.yaml", column: "git pin" },
  { system: "ArgoCD", what: "applies Git", artefact: "Application", column: "sync" },
  { system: "Kubelet", what: "pulls & runs", artefact: "ReplicaSet → Pod", column: "running" },
] as const;

/**
 * The delivery pipeline as five boxes. Each table column below maps to one
 * box, so a mismatch in the table points at the stage that has not caught up.
 */
export function PipelineDiagram() {
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {STAGES.map((stage, index) => (
          <li key={stage.system} className="relative rounded-lg border border-ink-850 bg-ink-900/40 px-3 py-2">
            <p className="font-mono text-[10px] text-ink-800">
              {index + 1} · <span className="text-ink-600">{stage.column}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-200">{stage.system}</p>
            <p className="text-[11px] text-ink-600">{stage.what}</p>
            <p className="mt-1 font-mono text-[10px] text-sky-300/80">{stage.artefact}</p>
            {index < STAGES.length - 1 && (
              <span className="absolute top-1/2 -right-2 hidden -translate-y-1/2 font-mono text-[11px] text-ink-800 sm:block">›</span>
            )}
          </li>
        ))}
      </ol>
      <Learn topic="gitops" />
    </div>
  );
}
