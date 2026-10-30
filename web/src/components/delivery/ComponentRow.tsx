import type { ComponentDelivery } from "../../lib/console/types";
import { shortSha, since } from "../../lib/format";
import { GlowDot, ToneCard } from "../hud";
import { TONE } from "../ui/tone";
import { STATUS_TONE } from "./status";

/** Lit stop on the track: rose when the image drifted, Ultron red on the pin, emerald otherwise. */
const ACCENT = { drifted: "var(--color-rose-400)", pin: "var(--color-ultron-500)", lit: "var(--color-emerald-400)" };

/**
 * One image across the pipeline, as a four-stop track: a stop is lit when its
 * system reports a tag. The Git pin is the reference: every other stage is
 * shown relative to it, so the value that disagrees is the one in amber.
 */
export function ComponentRow({ component, path }: { component: ComponentDelivery; path: string }) {
  const pin = component.git_tag;
  const tone = STATUS_TONE[component.status];
  const alarm = tone === "bad";
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
    <ToneCard
      // Only a drift sounds the alarm: "behind" is the normal state between a build and its PR.
      tone={alarm ? "bad" : "idle"}
      header={
        <>
          <GlowDot tone={tone} />
          <span className="font-mono text-[13px] text-ink-200">{component.component}</span>
          <span className={`font-display text-xs font-bold tracking-[0.22em] uppercase ${TONE[tone].text}`}>{component.status}</span>
          {component.behind_by > 0 && <span className="font-mono text-[10px] text-amber-300">{component.behind_by} tag(s) behind</span>}
          <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-ink-600">{component.image}</span>
        </>
      }
    >

      <div className="grid grid-cols-2 gap-y-3 px-4 pt-3.5 pb-3 sm:grid-cols-4">
        {stages.map((stage, index) => {
          const differs = !stage.reference && Boolean(stage.tag) && Boolean(pin) && stage.tag !== pin;
          const accent = alarm ? ACCENT.drifted : stage.reference ? ACCENT.pin : ACCENT.lit;
          const next = stages[index + 1];
          return (
            <div key={stage.label} title={stage.hint} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center">
                <span
                  aria-hidden
                  className="size-[9px] shrink-0 rotate-45 border"
                  style={
                    stage.tag
                      ? { borderColor: accent, background: accent, boxShadow: `0 0 8px ${accent}` }
                      : { borderColor: "var(--color-ink-800)" }
                  }
                />
                {next && (
                  <span
                    aria-hidden
                    className={`mx-1.5 hidden h-px flex-1 sm:block ${
                      stage.tag && next.tag
                        ? "bg-emerald-400/50"
                        : "bg-[repeating-linear-gradient(90deg,var(--color-ink-800)_0_3px,transparent_3px_6px)]"
                    }`}
                  />
                )}
              </div>
              <span className={`font-mono text-[10px] font-medium tracking-[0.15em] uppercase ${stage.reference ? "text-ultron-300" : "text-ink-500"}`}>
                {stage.label}
              </span>
              <span
                title={stage.tag || undefined}
                className={`truncate font-mono text-sm ${stage.reference ? "text-ultron-300" : differs ? "text-amber-300" : "text-ink-200"}`}
              >
                {stage.tag ? shortSha(stage.tag) : <span className="text-ink-700">—</span>}
                {!stage.reference && stage.tag && stage.tag === pin && <span className="ml-1.5 text-[11px] text-ink-600">= pin</span>}
              </span>
            </div>
          );
        })}
      </div>

      {component.note && (
        <p className={`px-4 pb-3 font-mono text-[11.5px] ${alarm ? "text-rose-300" : "text-ink-500"}`}>› {component.note}</p>
      )}

      {candidate && (
        <div className="px-4 pb-3">
          <BumpPreview path={path} image={component.image} from={pin} to={candidate} />
        </div>
      )}
    </ToneCard>
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
