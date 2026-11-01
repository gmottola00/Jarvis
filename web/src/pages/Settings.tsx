import { useState } from "react";
import { BudgetPanel } from "../components/gateway/BudgetPanel";
import { DailySpendChart } from "../components/gateway/DailySpendChart";
import { Fallbacks } from "../components/gateway/Fallbacks";
import { latency, usd } from "../components/gateway/format";
import { GpuCard } from "../components/gateway/GpuCard";
import { KeysPanel } from "../components/gateway/KeysPanel";
import { ModelCard } from "../components/gateway/ModelCard";
import { ModelUsageTable } from "../components/gateway/ModelUsageTable";
import { RecentErrors } from "../components/gateway/RecentErrors";
import { BracketTabs, HudPage, HudPanel, LiveStamp, Readouts, RefreshButton, type Readout } from "../components/hud";
import { ErrorNote, Learn, Loading } from "../components/ui/primitives";
import { api } from "../lib/api";
import { consoleApi } from "../lib/console/api";
import { ingressEntries } from "../lib/console/apps";
import type { GatewayView } from "../lib/console/types";
import { usePolling } from "../lib/hooks/usePolling";
import type { ModelCatalog } from "../lib/types";

/** The catalog caches its GPU probe for 30s; usage moves on the scale of minutes. */
const CATALOG_MS = 30_000;
const GATEWAY_MS = 60_000;
const LINK_MS = 300_000;

const WINDOWS = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];

/**
 * How Jarvis reaches its models, and what the LiteLLM gateway did for every
 * app: spend against each key's budget, failures, latency, daily cost. The
 * rest — single requests, key management — stays in LiteLLM's own UI.
 */
export function Settings() {
  const [windowId, setWindowId] = useState<WindowId>("24h");
  const range = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[0];

  const catalog = usePolling(api.models, CATALOG_MS);
  const runs = usePolling(() => api.runs(200), CATALOG_MS);
  const gateway = usePolling(() => consoleApi.gateway(range.hours), GATEWAY_MS, range.hours);
  const litellm = usePolling(() => consoleApi.network("litellm"), LINK_MS);

  const view = gateway.data;
  const unconfigured = view?.sources.litellm;
  const sourceErrors = view && !unconfigured && Object.keys(view.sources).length ? view.sources : null;
  const link = litellm.data ? ingressEntries(litellm.data, [])[0]?.url : undefined;
  const refreshing = catalog.refreshing || gateway.refreshing;
  const local = catalog.data?.models.filter((m) => m.provider === "local") ?? [];

  return (
    <HudPage
      title="Models & gateway"
      subtitle="What Jarvis may call, and what LiteLLM did for every app."
      live={refreshing}
      status={<LiveStamp error={Boolean(catalog.error || gateway.error)} every={GATEWAY_MS} at={view?.fetched_at} />}
      actions={
        <>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center border border-ink-700 px-3.5 py-1.5 font-display text-xs font-semibold tracking-[0.2em] text-ink-300 uppercase hover:border-ink-500 hover:text-ink-200"
            >
              open litellm ↗
            </a>
          )}
          <RefreshButton onClick={() => [catalog, runs, gateway].forEach((p) => p.refresh())} refreshing={refreshing} />
        </>
      }
    >
      {catalog.loading && <Loading label="asking the gateway…" />}
      <ErrorNote errors={catalog.error} />
      <ErrorNote errors={gateway.error} />
      <ErrorNote errors={sourceErrors} />

      {catalog.data && <Readouts readouts={readouts(catalog.data, view && !unconfigured ? view : null, range.label)} />}

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600">WINDOW</span>
        <BracketTabs value={windowId} onChange={setWindowId} tabs={WINDOWS.map(({ id, label }) => ({ id, label }))} />
      </div>
      <Learn topic="gateway" />

      {catalog.data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalog.data.models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              catalog={catalog.data!}
              runs={runs.data ?? []}
              usage={view?.models.find((m) => m.model === model.id)}
              windowLabel={range.label}
            />
          ))}
        </div>
      )}

      {unconfigured ? (
        <HudPanel title="Gateway usage" note="not configured">
          <p className="text-xs leading-relaxed text-ink-400">
            Set <span className="font-mono text-ink-200">JARVIS_LITELLM_DB_URL</span> to LiteLLM's Postgres as{" "}
            <span className="font-mono text-ink-200">jarvis_reader</span> to see spend, failures and latency for every app. That
            role can only call the <span className="font-mono">jarvis_ro.*</span> functions: aggregates, no prompts, no keys.
          </p>
        </HudPanel>
      ) : (
        view && (
          <>
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <KeysPanel keys={view.keys} windowLabel={range.label} />
              <DailySpendChart daily={view.daily} aliases={view.keys.map((k) => k.alias)} />
            </div>
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <ModelUsageTable models={view.models} windowLabel={range.label} />
              <RecentErrors errors={view.errors} windowLabel={range.label} />
            </div>
          </>
        )
      )}

      {catalog.data && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <GpuCard gpu={catalog.data.gpu} fallback={catalog.data.fallback} hasLocal={local.length > 0} />
          <div className="min-w-0 space-y-4">
            {unconfigured && <BudgetPanel budget={catalog.data.budget} gateway={catalog.data.gateway} />}
            <Fallbacks runs={runs.data ?? []} />
          </div>
        </div>
      )}
    </HudPage>
  );
}

function readouts(catalog: ModelCatalog, view: GatewayView | null, windowLabel: string): Readout[] {
  const gpu = catalog.gpu;
  const base: Readout[] = [
    catalog.gateway
      ? { label: "gateway", value: "UP", sub: "litellm · /model/info", tone: "ok" }
      : { label: "gateway", value: "OFF", sub: "JARVIS_LLM_GATEWAY_URL not set", tone: "idle" },
    gpu
      ? {
          label: "gpu desktop",
          value: gpu.up ? "ON" : "OFF",
          sub: gpu.up ? (gpu.resident.length ? `${gpu.resident.map((r) => r.name).join(", ")} loaded` : "nothing in VRAM") : "local models offline",
          tone: gpu.up ? "ok" : "warn",
        }
      : { label: "gpu desktop", value: "—", sub: "not probed", tone: "idle" },
  ];
  if (!view) return base;

  const requests = view.models.reduce((sum, m) => sum + m.requests, 0);
  const failures = view.models.reduce((sum, m) => sum + m.failures, 0);
  const spend = view.keys.reduce((sum, k) => sum + k.spend, 0);
  const budget = view.keys.reduce((sum, k) => sum + (k.max_budget ?? 0), 0);
  const nearest = view.keys.find((k) => k.budget_used !== null);
  const worstP95 = Math.max(0, ...view.models.filter((m) => m.requests >= 3).map((m) => m.p95_ms ?? 0));
  const failRate = requests ? failures / requests : 0;
  return [
    ...base,
    {
      label: "spend this period",
      value: usd(spend),
      sub: budget ? `of ${usd(budget)} across keys${nearest ? ` · ${nearest.alias} ${Math.round((nearest.budget_used ?? 0) * 100)}%` : ""}` : "no budgets",
      tone: nearest && (nearest.budget_used ?? 0) >= 0.8 ? "warn" : "idle",
    },
    {
      label: `requests · ${windowLabel}`,
      value: requests,
      sub: failures ? `${failures} failed (${Math.round(failRate * 100)}%)` : "none failed",
      tone: failRate > 0.2 ? "warn" : "ok",
    },
    { label: "slowest p95", value: latency(worstP95 || null), sub: "models with 3+ requests", tone: "idle" },
  ];
}
