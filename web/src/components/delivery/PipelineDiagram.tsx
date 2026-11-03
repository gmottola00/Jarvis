import { Learn } from "../ui/primitives";

const STAGES = [
  { system: "GitHub Actions", what: "builds & tests", artefact: "commit SHA", column: "ci green" },
  { system: "GHCR", what: "stores the image", artefact: "image:sha", column: "newest" },
  { system: "Home-Lab-Infra", what: "pins the tag", artefact: "kustomization.yaml", column: "git pin" },
  { system: "ArgoCD", what: "applies Git", artefact: "Application", column: "sync" },
  { system: "Kubelet", what: "pulls & runs", artefact: "ReplicaSet → Pod", column: "running" },
] as const;

/**
 * The delivery pipeline as a numbered rail. Each stage track below maps to one
 * stop, so a dark stop on an image points at the stage that has not caught up.
 */
export function PipelineDiagram() {
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-5 lg:gap-0">
        {STAGES.map((stage, index) => (
          <li key={stage.system} className="flex min-w-0 flex-row gap-3 lg:flex-col lg:gap-2.5">
            <div className="flex items-center">
              <span className="grid size-6.5 shrink-0 place-items-center border border-ultron-500 bg-ultron-500/12 font-display text-[13px] font-bold text-ultron-300 shadow-[0_0_10px] shadow-ultron-500/40">
                {index + 1}
              </span>
              {index < STAGES.length - 1 && (
                <span aria-hidden className="mx-2 hidden h-px flex-1 bg-linear-to-r from-ultron-500/70 to-ultron-500/15 lg:block" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 lg:pr-3.5">
              <span className="font-mono text-[10px] font-medium tracking-[0.18em] text-ink-600 uppercase">{stage.column}</span>
              <span className="font-display text-base font-bold tracking-[0.08em] text-ink-200">
                {stage.system} <span className="font-sans text-xs font-normal tracking-normal text-ink-500">{stage.what}</span>
              </span>
              <span className="font-mono text-[11px] text-ultron-300">{stage.artefact}</span>
            </div>
          </li>
        ))}
      </ol>
      <Learn topic="gitops" />
    </div>
  );
}
