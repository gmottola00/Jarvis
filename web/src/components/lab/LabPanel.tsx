import type { Capabilities, LabOverview } from "../../lib/types";

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-xl border border-ink-850 bg-ink-900/40">
      <header className="flex items-baseline justify-between border-b border-ink-850 px-4 py-2.5">
        <h3 className="font-mono text-[11px] tracking-widest text-ink-600 uppercase">{title}</h3>
        {note && <span className="font-mono text-[10px] text-ink-800">{note}</span>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block size-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`} />;
}

/** Cluster nodes, ArgoCD applications, and anything unhealthy. */
export function LabPanel({ overview, capabilities }: { overview: LabOverview | null; capabilities: Capabilities | null }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <h2 className="font-mono text-[11px] tracking-widest text-ink-600 uppercase">Home lab</h2>
        {overview && (
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ${
              overview.degraded
                ? "bg-amber-500/10 text-amber-300 ring-amber-500/25"
                : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
            }`}
          >
            {overview.degraded ? "needs attention" : "all good"}
          </span>
        )}
      </header>

      {!overview && <p className="text-xs text-ink-800">Loading…</p>}

      {overview && (
        <>
          <Card title="Nodes" note={`${overview.nodes.length}`}>
            <ul className="space-y-1.5">
              {overview.nodes.map((node) => (
                <li key={node.name} className="flex items-center gap-2 text-xs">
                  <Dot ok={node.ready} />
                  <span className="font-mono text-ink-200">{node.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink-800">{node.version}</span>
                </li>
              ))}
              {overview.nodes.length === 0 && <li className="text-xs text-ink-800">No nodes reported.</li>}
            </ul>
          </Card>

          <Card title="ArgoCD" note={`${overview.apps.length} apps`}>
            <ul className="space-y-2">
              {overview.apps.map((app) => {
                const healthy = app.health === "Healthy" && app.sync === "Synced";
                return (
                  <li key={app.name} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Dot ok={healthy} />
                      <span className="font-mono text-ink-200">{app.name}</span>
                      <span className={`ml-auto font-mono text-[10px] ${healthy ? "text-ink-600" : "text-amber-300"}`}>
                        {app.sync} / {app.health}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 font-mono text-[10px] text-ink-800">
                      {app.path} @ {app.revision || "?"}
                    </p>
                  </li>
                );
              })}
              {overview.apps.length === 0 && <li className="text-xs text-ink-800">No applications.</li>}
            </ul>
          </Card>

          <Card title="Unhealthy pods" note={`${overview.unhealthy_pods.length}`}>
            {overview.unhealthy_pods.length === 0 ? (
              <p className="text-xs text-ink-600">Everything is Running and ready.</p>
            ) : (
              <ul className="space-y-2">
                {overview.unhealthy_pods.map((pod) => (
                  <li key={`${pod.namespace}/${pod.name}`} className="text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-ink-600">{pod.namespace}</span>
                      <span className="truncate font-mono text-ink-200">{pod.name}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-amber-300">
                      {pod.phase} · {pod.ready} · {pod.restarts} restarts{pod.reason && ` · ${pod.reason}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {Object.keys(overview.errors).length > 0 && (
            <Card title="Capability errors">
              <ul className="space-y-1">
                {Object.entries(overview.errors).map(([name, message]) => (
                  <li key={name} className="font-mono text-[10px] break-words text-rose-300">
                    {name}: {message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {capabilities && (
        <Card title="Policy" note={capabilities.fake_tools ? "fixtures" : "live"}>
          <dl className="space-y-1 font-mono text-[10px]">
            {Object.entries(capabilities.policy).map(([risk, rule]) => (
              <div key={risk} className="flex gap-2">
                <dt className="w-20 text-ink-600">{risk}</dt>
                <dd className="text-ink-400">{rule}</dd>
              </div>
            ))}
            <div className="flex gap-2 pt-1.5">
              <dt className="w-20 text-ink-600">model</dt>
              <dd className="text-ink-400">{capabilities.model}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 text-ink-600">durable</dt>
              <dd className={capabilities.durable ? "text-ink-400" : "text-amber-300"}>
                {capabilities.durable ? "postgres" : "in-memory"}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
