import { useState } from "react";
import { BracketTabs, HudCard, HudPage, HudPanel, LiveStamp, Quiet, Readouts, RefreshButton, type Readout } from "../components/hud";
import { RISK_TONE } from "../components/runs/status";
import { ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { api } from "../lib/api";
import { elapsed, stamp } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";
import type { Capabilities as Caps, RiskLevel, SchemaProperty, ToolInfo, ToolUsage } from "../lib/types";

/** Usage only moves when a run calls something; once a minute is plenty. */
const POLL_MS = 60_000;

type Filter = "all" | RiskLevel;
const RISKS: RiskLevel[] = ["read", "write", "destructive"];

const NONE: ToolUsage = { calls: 0, errors: 0, p50_ms: 0, last_at: "" };

/** Columns shared by the header row and every tool row. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_3rem_3.5rem] items-center gap-3";

/**
 * Every tool the model is given, grouped by capability, with what the gate does
 * with each and how often it has been called. The schema shown is the one the
 * model reads: derived from the signature and the docstring's `Args:`.
 */
export function Capabilities() {
  const { data, error, loading, refresh, refreshing } = usePolling(api.capabilities, POLL_MS);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);

  const all = data ? namespaces(data).flatMap(([, tools]) => tools) : [];
  const usage = (tool: ToolInfo) => data?.usage[tool.name] ?? NONE;
  const most = Math.max(1, ...all.map((t) => usage(t).calls));
  const selected = all.find((t) => t.name === picked) ?? all[0];
  const count = (risk: RiskLevel) => all.filter((t) => t.risk === risk).length;

  return (
    <HudPage
      title="Capabilities"
      subtitle="Every tool the model is given, what the gate does with it, and how often it is called."
      live={refreshing}
      status={
        <>
          <LiveStamp error={Boolean(error)} every={POLL_MS} />
          {data && <span className="font-mono text-[11px] text-ink-500">/api/capabilities · usage from audit log, {data.usage_days}d</span>}
        </>
      }
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      {loading && <Loading label="reading the registry…" />}
      <ErrorNote errors={error} />

      {data && selected && (
        <>
          <Readouts readouts={readouts(data, all, count)} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600">RISK</span>
            <BracketTabs
              tabs={[
                { id: "all" as Filter, label: "all", count: all.length },
                ...RISKS.map((risk) => ({ id: risk as Filter, label: risk, count: count(risk) })),
              ]}
              value={filter}
              onChange={setFilter}
            />
            <span className="ml-auto font-mono text-[11px] text-ink-600">select a tool to see its parameters</span>
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-4">
              {namespaces(data).map(([ns, tools]) => {
                const shown = tools.filter((t) => filter === "all" || t.risk === filter);
                if (shown.length === 0) return null;
                const source = data.sources[ns];
                return (
                  <HudPanel
                    key={ns}
                    title={ns}
                    note={
                      <span className={`truncate ${source?.mode === "missing" ? "text-amber-300" : ""}`}>
                        {source?.mode === "missing" ? `needs ${source.missing.join(", ")}` : source?.mode}
                      </span>
                    }
                    flush
                  >
                    {source?.about && <p className="px-5 pt-2.5 text-xs text-ink-500">{source.about}.</p>}
                    <div className={`${COLUMNS} px-5 pt-2 pb-1.5 font-mono text-[9.5px] font-medium tracking-[0.18em] text-ink-600`}>
                      <span>TOOL</span>
                      <span>RISK</span>
                      <span>CALLS {data.usage_days}D</span>
                      <span className="text-right">ERR</span>
                      <span className="text-right">P50</span>
                    </div>
                    {shown.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        tool={tool}
                        usage={usage(tool)}
                        most={most}
                        selected={tool.name === selected.name}
                        onSelect={() => setPicked(tool.name)}
                      />
                    ))}
                  </HudPanel>
                );
              })}
            </div>

            <div className="min-w-0 xl:sticky xl:top-0">
              <ToolDetail tool={selected} usage={usage(selected)} policy={data.policy} days={data.usage_days} />
            </div>
          </div>
        </>
      )}
    </HudPage>
  );
}

/** Capabilities in the order `CAPABILITIES` lists them (which `sources` keeps), not alphabetical. */
function namespaces(data: Caps): [string, ToolInfo[]][] {
  const order = Object.keys(data.sources);
  return Object.entries(data.capabilities).sort(([a], [b]) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity));
}

function readouts(data: Caps, all: ToolInfo[], count: (risk: RiskLevel) => number): Readout[] {
  const used = Object.values(data.usage);
  const calls = used.reduce((sum, u) => sum + u.calls, 0);
  const errors = used.reduce((sum, u) => sum + u.errors, 0);
  const missing = Object.values(data.sources).filter((s) => s.mode === "missing").length;
  return [
    {
      label: "tools",
      value: all.length,
      sub: `${Object.keys(data.capabilities).length} capabilities · ${count("read")} read${missing ? ` · ${missing} unconfigured` : ""}`,
      tone: missing ? "warn" : "idle",
    },
    { label: "write", value: count("write"), sub: data.policy.write === "confirm" ? "asks first · PR only" : "auto · PR only", tone: RISK_TONE.write },
    { label: "destructive", value: count("destructive"), sub: data.policy.destructive === "blocked" ? "blocked" : "always asks", tone: RISK_TONE.destructive },
    {
      label: `calls ${data.usage_days}d`,
      value: calls,
      sub: calls ? `${errors} errors · ${((errors / calls) * 100).toFixed(1)}%` : "nothing called yet",
      tone: errors ? "warn" : "idle",
    },
  ];
}

/** `read` quiet, `write` in the commit's cyan, `destructive` framed, as on the Runs page. */
function RiskChip({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className={`justify-self-start border px-1.5 py-px font-mono text-[10px] font-medium tracking-[0.12em] uppercase ${TONE[RISK_TONE[risk]].text} ${
        risk === "destructive" ? "border-rose-400/50" : "border-ink-800"
      }`}
    >
      {risk}
    </span>
  );
}

function verb(name: string): string {
  return name.split("__", 2)[1] ?? name;
}

function ToolRow({
  tool,
  usage,
  most,
  selected,
  onSelect,
}: {
  tool: ToolInfo;
  usage: ToolUsage;
  most: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const edge = selected ? "border-l-ultron-500 bg-ultron-500/10" : tool.risk === "destructive" ? "border-l-rose-400/60" : "border-l-transparent";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`${COLUMNS} w-full border-t border-l-2 border-t-ink-850 py-2.5 pr-5 pl-[18px] text-left hover:bg-ultron-500/7 ${edge}`}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[13px] font-medium text-ink-200">{verb(tool.name)}</span>
        <span className="truncate text-[11.5px] text-ink-600" title={tool.description}>
          {tool.description}
        </span>
      </span>
      <RiskChip risk={tool.risk} />
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 bg-ink-850">
          <span className="block h-full bg-ultron-500/75" style={{ width: `${Math.round((usage.calls / most) * 100)}%` }} />
        </span>
        <span className="w-7 text-right font-mono text-xs text-ink-300">{usage.calls}</span>
      </span>
      <span className={`text-right font-mono text-xs ${usage.errors ? "text-amber-300" : "text-ink-700"}`}>{usage.errors}</span>
      <span className="text-right font-mono text-xs text-ink-500">{usage.calls ? elapsed(usage.p50_ms) : "—"}</span>
    </button>
  );
}

/** What the gate does with each risk, as configured right now. */
function policyNote(risk: RiskLevel, policy: Caps["policy"]): string {
  if (risk === "read") return "Runs immediately. No side effects.";
  if (risk === "write") {
    return policy.write === "confirm"
      ? "Suspends the run and asks you first. Writes only ever produce a commit or a pull request."
      : "Runs immediately. Produces a commit or a pull request, never touches the cluster.";
  }
  return policy.destructive === "blocked"
    ? "Blocked. The gate refuses the call and the model is told why."
    : "Suspends the run and asks you. Checkpointed, so the approval survives a restart.";
}

function typeOf(prop: SchemaProperty): string {
  if (prop.enum) return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  return prop.type ?? "any";
}

function ToolDetail({ tool, usage, policy, days }: { tool: ToolInfo; usage: ToolUsage; policy: Caps["policy"]; days: number }) {
  const required = new Set(tool.input_schema.required);
  const params = Object.entries(tool.input_schema.properties);
  const [ns] = tool.name.split("__", 1);

  return (
    <HudCard eyebrow={`tool · ${ns}`} title={verb(tool.name)}>
      <div className="flex flex-col gap-2.5 border-b border-ultron-500/15 px-6 pt-1 pb-4">
        <span className="font-mono text-xs [overflow-wrap:anywhere] text-ink-500">{tool.name}</span>
        <p className="text-[13px] leading-normal text-pretty text-ink-400">{tool.description}</p>
      </div>

      <div
        className={`flex items-start gap-3 border-b border-ultron-500/15 px-6 py-3.5 ${
          tool.risk === "read" ? "" : TONE[RISK_TONE[tool.risk]].soft.split(" ")[0]
        }`}
      >
        <span className="shrink-0">
          <RiskChip risk={tool.risk} />
        </span>
        <span className="text-[12.5px] leading-normal text-ink-300">{policyNote(tool.risk, policy)}</span>
      </div>

      <div className="flex items-center gap-2.5 px-6 pt-3.5 pb-1.5">
        <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600">PARAMETERS</span>
        {params.length > 0 && <span className="ml-auto font-mono text-[11px] text-ink-700">{params.length} · schema from docstring</span>}
      </div>
      {params.length === 0 ? (
        <div className="px-6 pt-1 pb-3.5">
          <Quiet>Takes no arguments.</Quiet>
        </div>
      ) : (
        params.map(([name, prop]) => {
          const req = required.has(name) ? "required" : prop.default !== undefined ? `default: ${String(prop.default)}` : "optional";
          return (
            <div key={name} className="flex flex-col gap-1 border-t border-ink-850 px-6 py-2.5">
              <p className="flex items-baseline gap-2 font-mono text-xs">
                <span className="text-ink-200">{name}</span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-ink-500">{typeOf(prop)}</span>
                <span className={`ml-auto shrink-0 text-[11px] ${required.has(name) ? "text-ultron-300" : "text-ink-600"}`}>{req}</span>
              </p>
              {prop.description && <span className="text-xs leading-snug text-pretty text-ink-500">{prop.description}</span>}
            </div>
          );
        })
      )}

      <div className="border-t border-ultron-500/15 px-6 pt-3.5 pb-1.5 font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600">
        USAGE · {days} DAYS
      </div>
      <div className="grid grid-cols-3 gap-2 px-6 pt-1 pb-5">
        <Figure value={usage.calls} label="calls" />
        <Figure value={usage.errors} label="errors" className={usage.errors ? "text-amber-300" : "text-ink-200"} />
        <Figure value={usage.calls ? elapsed(usage.p50_ms) : "—"} label="p50" />
        <span className="col-span-full mt-1.5 font-mono text-[11px] text-ink-600">
          last call · {usage.last_at ? stamp(usage.last_at) : "never"}
        </span>
      </div>
    </HudCard>
  );
}

function Figure({ value, label, className = "text-ink-200" }: { value: number | string; label: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`font-display text-[26px] leading-none font-bold ${className}`}>{value}</span>
      <span className="font-mono text-[10.5px] text-ink-600">{label}</span>
    </div>
  );
}
