import type { ModelUsage } from "../../lib/console/types";
import { tokens } from "../../lib/format";
import { HudPanel, Quiet } from "../hud";
import { Table, type Column } from "../ui/Table";
import { latency, usd } from "./format";

/** Every model any app called in the window: volume, failures, latency and cost. */
export function ModelUsageTable({ models, windowLabel }: { models: ModelUsage[]; windowLabel: string }) {
  const columns: Column<ModelUsage>[] = [
    { key: "model", header: "model", cell: (m) => <span className="text-ink-200">{m.model}</span> },
    { key: "req", header: "requests", className: "text-right", cell: (m) => m.requests },
    {
      key: "fail",
      header: "failed",
      className: "text-right",
      cell: (m) => <span className={m.failures ? "text-amber-300" : "text-ink-600"}>{m.failures}</span>,
    },
    { key: "p50", header: "p50", className: "text-right", cell: (m) => latency(m.p50_ms) },
    { key: "p95", header: "p95", className: "text-right", cell: (m) => latency(m.p95_ms) },
    { key: "ttft", header: "1st token", className: "text-right", cell: (m) => latency(m.ttft_p50_ms) },
    {
      key: "tok",
      header: "tokens in / out",
      className: "text-right",
      cell: (m) => (
        <span className="text-ink-400">
          {tokens(m.prompt_tokens)} / {tokens(m.completion_tokens)}
        </span>
      ),
    },
    { key: "spend", header: "spend", className: "text-right", cell: (m) => usd(m.spend) },
  ];
  return (
    <HudPanel title="Models" note={`all apps · ${windowLabel}`} flush>
      {models.length === 0 ? (
        <div className="px-4 sm:px-5 py-3.5">
          <Quiet>No requests in this window.</Quiet>
        </div>
      ) : (
        <Table rows={models} columns={columns} rowKey={(m) => m.model} rowTone={(m) => (m.requests && m.failures / m.requests > 0.2 ? "warn" : "ok")} />
      )}
    </HudPanel>
  );
}
