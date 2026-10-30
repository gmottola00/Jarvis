import {
  Aside,
  GlowDot,
  HudButton,
  HudCard,
  HudPage,
  HudPanel,
  Leader,
  LiveStamp,
  Quiet,
  Readouts,
  RefreshButton,
  ToneCard,
  type Readout,
} from "../components/hud";
import { ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import type { Tone } from "../lib/console/derive";
import { since, stamp, tokens } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";
import type { Budget, GpuState, ModelCatalog, ModelOption, RunSummary } from "../lib/types";

/** The catalog caches its GPU probe for 30s; polling faster shows the same answer. */
const POLL_MS = 30_000;

const usd = (value: number) => `$${value.toFixed(2)}`;
const gb = (count: number) => `${(count / 1e9).toFixed(1)} GB`;

/**
 * What Jarvis may call through the LiteLLM gateway, whether the GPU machine
 * answers, and what the key has spent. Run counts and fallbacks come from the
 * audit log, so they cover the runs this backend remembers, not a fixed window.
 */
export function Models() {
  const { data: catalog, error, loading, refresh, refreshing } = usePolling(api.models, POLL_MS);
  const { data: runs } = usePolling(() => api.runs(200), POLL_MS);

  const recent = runs ?? [];
  const local = catalog?.models.filter((m) => m.provider === "local") ?? [];
  const gpu = catalog?.gpu ?? null;
  const fallbacks = recent.filter((r) => r.served_by && r.model && r.served_by !== r.model);

  return (
    <HudPage
      title="Models"
      subtitle="What Jarvis may call through the LiteLLM gateway, and what it has spent."
      live={refreshing}
      status={
        <>
          <LiveStamp error={Boolean(error)} every={POLL_MS} />
          {catalog && (
            <span className="font-mono text-[11px] text-ink-500">
              {catalog.gateway ? "gateway · apps/litellm · key jarvis" : "no gateway · straight to Anthropic"}
            </span>
          )}
        </>
      }
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      {loading && <Loading label="asking the gateway…" />}
      <ErrorNote errors={error} />

      {catalog && (
        <>
          <Readouts readouts={readouts(catalog, local.length)} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {catalog.models.map((model) => (
              <ModelCard key={model.id} model={model} catalog={catalog} runs={recent} />
            ))}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <GpuCard gpu={gpu} fallback={catalog.fallback} hasLocal={local.length > 0} />

            <div className="min-w-0 space-y-4">
              <BudgetPanel budget={catalog.budget} gateway={catalog.gateway} />

              <HudPanel title="fallbacks" note="always asked first" flush>
                {fallbacks.length === 0 ? (
                  <p className="px-5 pt-3.5 text-xs text-ink-500">No run has been answered by a fallback.</p>
                ) : (
                  <ul>
                    {fallbacks.map((r) => (
                      <li key={r.run_id} className="flex flex-col gap-1 border-b border-ink-850 px-5 py-2.5">
                        <p className="flex gap-2 font-mono text-xs text-ink-200">
                          {r.model} <span className="text-amber-300">→</span> {r.served_by}
                          <span className="ml-auto text-[11px] text-ink-600">{stamp(r.started_at)}</span>
                        </p>
                        <p className="truncate text-xs text-ink-500" title={r.prompt}>
                          {r.prompt}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="px-5 pt-2.5 pb-3.5 text-xs leading-normal text-ink-500">
                  The gateway has num_retries 0 and no silent fallback. A dead Ollama is refused at once, not after retries.
                </p>
              </HudPanel>
            </div>
          </div>
        </>
      )}
    </HudPage>
  );
}

function readouts(catalog: ModelCatalog, localCount: number): Readout[] {
  const { gpu, budget } = catalog;
  const claudeCount = catalog.models.length - localCount;
  return [
    catalog.gateway
      ? { label: "gateway", value: "UP", sub: "litellm · /model/info", tone: "ok" }
      : { label: "gateway", value: "OFF", sub: "JARVIS_LLM_GATEWAY_URL not set", tone: "idle" },
    { label: "models", value: catalog.models.length, sub: `${claudeCount} claude · ${localCount} local`, tone: "idle" },
    gpu
      ? {
          label: "gpu desktop",
          value: gpu.up ? "ON" : "OFF",
          sub: gpu.up ? (gpu.resident.length ? `${gpu.resident.map((r) => r.name).join(", ")} loaded` : "nothing in VRAM") : "local models offline",
          tone: gpu.up ? "ok" : "warn",
        }
      : { label: "gpu desktop", value: "—", sub: "not probed", tone: "idle" },
    budget
      ? {
          label: "spend",
          value: usd(budget.spend),
          sub: budget.max_budget !== null ? `of ${usd(budget.max_budget)}${budget.reset_at ? ` · resets ${resetDay(budget.reset_at)}` : ""}` : "no budget set",
          tone: spendTone(budget),
        }
      : { label: "spend", value: "—", sub: "no gateway key to read", tone: "idle" },
  ];
}

function resetDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Past the budget the gateway refuses every request until it resets. */
function spendTone({ spend, max_budget: limit }: Budget): Tone {
  if (!limit) return "idle";
  return spend >= limit ? "bad" : spend / limit >= 0.8 ? "warn" : "idle";
}

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

function ModelCard({ model, catalog, runs }: { model: ModelOption; catalog: ModelCatalog; runs: RunSummary[] }) {
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
        <Leader label="runs" value={<span className="text-ink-400">{answered.length}</span>} />
        <Leader label="tokens" value={<span className="text-ink-400">{tokens(used)}</span>} />
      </div>
      <p className="border-t border-ink-850 px-4 py-2.5 text-xs leading-snug text-ink-500">{NOTE[kind]}</p>
    </ToneCard>
  );
}

function GpuCard({ gpu, fallback, hasLocal }: { gpu: GpuState | null; fallback: string; hasLocal: boolean }) {
  if (!gpu) {
    return (
      <HudCard eyebrow="gpu node" title="not probed">
        <div className="px-6 pt-2 pb-5">
          <Aside>
            <span className="font-mono">JARVIS_OLLAMA_URL</span> is not set, so Jarvis cannot tell whether the GPU machine is on.
            {hasLocal && " Local models are listed as available, and a run to one fails with a gateway error if the machine is off."}
          </Aside>
        </div>
      </HudCard>
    );
  }

  const host = hostOf(gpu.url);
  const tone: Tone = gpu.up ? "ok" : "warn";
  const facts: [string, string, string][] = [
    ["ollama", gpu.url.replace(/^https?:\/\//, ""), "text-ink-300"],
    ["probe", "GET /api/ps · 1.5s timeout · cached 30s", "text-ink-500"],
    ["last probe", `${gpu.checked_at ? `${since(gpu.checked_at)} ago` : "—"} · ${gpu.up ? "200" : "no answer"}`, TONE[tone].text],
  ];

  return (
    <HudCard eyebrow="gpu node" title={host} note={<span className={TONE[tone].text}>{gpu.up ? "ollama answering" : "not answering"}</span>}>
      <div className="grid gap-5 px-6 pt-3.5 pb-5.5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {facts.map(([k, v, color]) => (
            <Leader key={k} label={k} value={<span className={color}>{v}</span>} />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600 uppercase">in vram · /api/ps</span>
          {gpu.up ? (
            gpu.resident.length ? (
              <>
                {gpu.resident.map((r) => (
                  <Leader key={r.name} label={<span className="text-ink-200">{r.name}</span>} value={<span className="text-emerald-300">{gb(r.vram_bytes)}</span>} />
                ))}
                <Quiet>Loaded models answer at once. The others spend seconds loading first.</Quiet>
              </>
            ) : (
              <Quiet>Nothing loaded. The first call to a local model waits for it to load.</Quiet>
            )
          ) : (
            <p className="border border-dashed border-ink-800 px-3.5 py-3 text-[12.5px] leading-normal text-ink-500">
              Ollama does not answer. local/* show as offline, and a message sent to one asks before {fallback} answers it.
            </p>
          )}
          <div className="mt-1 flex items-center gap-2.5">
            <HudButton variant="ghost" disabled title="Not built yet">
              wake on lan
            </HudButton>
            <span className="font-mono text-[11px] text-ink-600">arrives with P2 · home__wake</span>
          </div>
        </div>
      </div>
    </HudCard>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function BudgetPanel({ budget, gateway }: { budget: Budget | null; gateway: boolean }) {
  return (
    <HudPanel title="budget" note="/key/info">
      {!budget ? (
        <Quiet>{gateway ? "The gateway has not answered /key/info yet." : "Without a gateway there is no key budget to read."}</Quiet>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-baseline gap-2">
            <span className={`font-display text-3xl leading-none font-bold ${spendTone(budget) === "idle" ? "text-ink-200" : TONE[spendTone(budget)].text}`}>{usd(budget.spend)}</span>
            <span className="font-mono text-xs text-ink-500">{budget.max_budget !== null ? `of ${usd(budget.max_budget)} this period` : "no budget set"}</span>
          </p>
          {budget.max_budget !== null && (
            <div className="h-1.5 bg-ink-850">
              <div
                className={`h-full shadow-[0_0_8px] ${spendTone(budget) === "idle" ? "bg-ultron-500 shadow-ultron-500" : `${TONE[spendTone(budget)].dot} ${TONE[spendTone(budget)].glow}`}`}
                style={{ width: `${Math.min(100, (budget.spend / (budget.max_budget || 1)) * 100)}%` }}
              />
            </div>
          )}
          <span className="font-mono text-[11px] text-ink-600">
            {budget.reset_at ? `resets ${resetDay(budget.reset_at)} · ` : ""}local models cost nothing
          </span>
        </div>
      )}
    </HudPanel>
  );
}
