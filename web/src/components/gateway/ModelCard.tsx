import type { Tone } from "../../lib/console/derive";
import type { ModelUsage } from "../../lib/console/types";
import { tokens } from "../../lib/format";
import type { ModelCatalog, ModelOption, RunSummary } from "../../lib/types";
import { GlowDot, Leader, ToneCard } from "../hud";
import { TONE } from "../ui/tone";
import { latency } from "./format";

function role(model: ModelOption, catalog: ModelCatalog): string {
  if (model.id === catalog.default) return "default";
  if (model.id === catalog.fallback) return "fallback";
  return model.provider === "local" ? "local" : "claude";
}

const NOTE: Record<string, string> = {
  default: "Answers whenever the picker is left alone. Adaptive thinking and effort pass through the gateway untouched.",
  fallback: "Answers a local request while the desktop is off, once you agree.",
  local: "Thinking is streamed but not kept in history; a later Claude turn would reject it.",
  claude: "Pickable per message from the chat.",
};

export function ModelCard({
  model,
  catalog,
  runs,
  usage,
  windowLabel,
}: {
  model: ModelOption;
  catalog: ModelCatalog;
  runs: RunSummary[];
  /** What every app sent to this model in the window, when the gateway view is configured. */
  usage?: ModelUsage;
  windowLabel: string;
}) {
  const isLocal = model.provider === "local";
  const offline = isLocal && !model.available;
  const status = !isLocal ? "available" : offline ? "offline" : model.loaded ? "in VRAM" : "cold · loads on first call";
  const tone: Tone = offline ? "warn" : "ok";
  const answered = runs.filter((r) => (r.served_by || r.model) === model.id);
  const used = answered.reduce((sum, r) => sum + r.usage.input_tokens + r.usage.output_tokens, 0);
  const kind = role(model, catalog);

  return (
    <ToneCard
      tone={offline ? "warn" : "idle"}
      header={
        <>
          <GlowDot tone={tone} />
          <span className="min-w-0 truncate font-mono text-sm font-medium text-ink-200">{model.id}</span>
          <span className="ml-auto border border-ink-800 px-2 py-px font-display text-[11px] font-semibold tracking-[0.18em] text-ink-400 uppercase">
            {kind}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-1.5 px-4 pt-3 pb-3.5">
        <Leader label="backend" value={<span className="text-ink-400">{model.backend || "anthropic (direct)"}</span>} />
        <Leader label="status" value={<span className={TONE[tone].text}>{status}</span>} />
        <Leader label="ultron runs" value={<span className="text-ink-400">{answered.length} · {tokens(used)} tokens</span>} />
        {usage && (
          <>
            <Leader
              label={`all apps · ${windowLabel}`}
              value={
                <span className={usage.failures ? "text-amber-300" : "text-ink-400"}>
                  {usage.requests} req{usage.failures ? ` · ${usage.failures} failed` : ""}
                </span>
              }
            />
            <Leader label="p50 / p95" value={<span className="text-ink-400">{latency(usage.p50_ms)} / {latency(usage.p95_ms)}</span>} />
          </>
        )}
      </div>
      <p className="border-t border-ink-850 px-4 py-2.5 text-xs leading-snug text-ink-500">{NOTE[kind]}</p>
    </ToneCard>
  );
}
