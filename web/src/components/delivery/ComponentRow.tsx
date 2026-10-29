import type { ComponentDelivery } from "../../lib/console/types";
import { shortSha, since } from "../../lib/format";
import { Badge } from "../ui/primitives";
import { STATUS_TONE } from "./status";

/**
 * One image across the pipeline. The Git pin is the reference: every other
 * stage is shown relative to it, so the cell that disagrees is the one lit up.
 */
export function ComponentRow({ component, path }: { component: ComponentDelivery; path: string }) {
  const pin = component.git_tag;
  const stages = [
    { label: "ci green", tag: component.newest_green_tag, hint: "newest commit with passing checks" },
    {
      label: "newest",
      tag: component.newest_tag,
      hint: component.newest_at ? `published ${since(component.newest_at)} ago` : "newest tag in GHCR",
    },
    { label: "git pin", tag: pin, hint: "what ArgoCD will apply", reference: true },
    { label: "running", tag: component.running_tag, hint: "what the kubelet pulled" },
  ];

  const candidate = component.newest_green_tag && component.newest_green_tag !== pin ? component.newest_green_tag : "";

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-ink-200">{component.component}</span>
        <Badge tone={STATUS_TONE[component.status]}>{component.status}</Badge>
        {component.behind_by > 0 && <span className="font-mono text-[10px] text-amber-300">{component.behind_by} tag(s) behind</span>}
        <span className="ml-auto font-mono text-[10px] text-ink-800">{component.image}</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {stages.map((stage) => {
          const differs = !stage.reference && Boolean(stage.tag) && Boolean(pin) && stage.tag !== pin;
          return (
            <div
              key={stage.label}
              title={stage.tag || undefined}
              className={`rounded-md px-2.5 py-1.5 ring-1 ${
                stage.reference
                  ? "bg-sky-500/[0.06] ring-sky-500/25"
                  : differs
                    ? "bg-amber-500/[0.06] ring-amber-500/25"
                    : "bg-ink-950/60 ring-ink-850"
              }`}
            >
              <p className="font-mono text-[10px] text-ink-600 uppercase">{stage.label}</p>
              <p className={`font-mono text-xs ${stage.reference ? "text-sky-300" : differs ? "text-amber-300" : "text-ink-200"}`}>
                {stage.tag ? shortSha(stage.tag) : <span className="text-ink-800">—</span>}
                {!stage.reference && stage.tag && stage.tag === pin && <span className="ml-1.5 text-[10px] text-ink-600">= pin</span>}
              </p>
              <p className="truncate text-[10px] text-ink-800">{stage.hint}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-600">{component.note}</p>

      {candidate && <BumpPreview path={path} image={component.image} from={pin} to={candidate} />}
    </div>
  );
}

/**
 * The entire deploy, as a diff. Promoting a build in GitOps is a one-line
 * change to a file — this is the line, and the PR Jarvis would open for it.
 */
function BumpPreview({ path, image, from, to }: { path: string; image: string; from: string; to: string }) {
  return (
    <details className="group rounded-md border border-ink-850 bg-ink-950/60">
      <summary className="cursor-pointer list-none px-2.5 py-1.5 font-mono text-[10px] text-ink-600 hover:text-ink-400">
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span>
        deploying {shortSha(to)} is this one-line change to {path}/kustomization.yaml
      </summary>
      <pre className="overflow-x-auto border-t border-ink-850 px-3 py-2 font-mono text-[11px] leading-5">
        <span className="text-ink-600">{`  - name: ${image}\n`}</span>
        <span className="text-rose-300">{`-   newTag: ${from || "(none)"}\n`}</span>
        <span className="text-emerald-300">{`+   newTag: ${to}`}</span>
      </pre>
    </details>
  );
}
