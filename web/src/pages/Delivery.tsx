import { ComponentRow } from "../components/delivery/ComponentRow";
import { PipelineDiagram } from "../components/delivery/PipelineDiagram";
import { argoTone } from "../components/delivery/status";
import { Badge, Empty, ErrorNote, IconButton, Loading, Panel, Stat } from "../components/ui/primitives";
import { consoleApi } from "../lib/console/api";
import type { AppDelivery, DeliveryStatus, PullRequestView } from "../lib/console/types";
import { clock, shortSha } from "../lib/format";
import { usePolling } from "../lib/hooks/usePolling";

/** GHCR and GitHub are rate-limited; the pipeline does not move every few seconds anyway. */
const POLL_MS = 30_000;

const ORDER: DeliveryStatus[] = ["drifted", "rolling-out", "behind", "unknown", "in-sync"];

/**
 * From commit to container, one row per image.
 *
 * Four systems each know one part of a deploy; this page lines them up so
 * "is tickup up to date?" is a glance instead of four browser tabs.
 */
export function Delivery() {
  const { data, error, loading, refresh, refreshing } = usePolling(consoleApi.delivery, POLL_MS);

  const tracked = data?.apps.filter((app) => app.tracking === "kustomize") ?? [];
  const untracked = data?.apps.filter((app) => app.tracking !== "kustomize") ?? [];
  const components = tracked.flatMap((app) => app.components);
  const count = (status: DeliveryStatus) => components.filter((c) => c.status === status).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-medium text-ink-200">Delivery</h2>
            <p className="text-xs text-ink-600">Built, green, pinned, running — per image, without asking the agent.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {data && <span className="font-mono text-[10px] text-ink-800">as of {clock(data.fetched_at)}</span>}
            <IconButton onClick={refresh} label="Refresh">
              {refreshing ? "…" : "refresh"}
            </IconButton>
          </div>
        </header>

        <PipelineDiagram />

        {loading && <Loading label="asking ArgoCD, GitHub and GHCR…" />}
        <ErrorNote errors={error} />
        {data && <ErrorNote errors={data.errors} />}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="images" value={components.length} sub={`${tracked.length} of ${data.apps.length} ArgoCD apps pin images`} />
              <Stat label="in sync" value={count("in-sync")} tone="ok" />
              <Stat label="behind" value={count("behind")} tone={count("behind") ? "warn" : "ok"} sub="newer builds not pinned" />
              <Stat
                label="drifted / rolling"
                value={`${count("drifted")} / ${count("rolling-out")}`}
                tone={count("drifted") ? "bad" : count("rolling-out") ? "info" : "ok"}
                sub="cluster ≠ Git"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
              <div className="space-y-4">
                {[...tracked].sort(byUrgency).map((app) => (
                  <AppCard key={app.name} app={app} />
                ))}
                {data.apps.length === 0 && <Empty>ArgoCD reports no applications.</Empty>}
              </div>
              <div className="space-y-4">
                <PullRequests prs={data.pull_requests} />
                {untracked.length > 0 && <OtherApps apps={untracked} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AppDelivery }) {
  return (
    <Panel
      title={app.name}
      note={`${app.path} @ ${shortSha(app.revision)}`}
      actions={
        <Badge tone={argoTone(app)} title="ArgoCD sync / health">
          {app.sync} · {app.health}
        </Badge>
      }
      flush
    >
      {app.components.length === 0 ? (
        <p className="px-4 py-3 text-xs text-ink-600">No image pins found in {app.path}/kustomization.yaml.</p>
      ) : (
        <div className="divide-y divide-ink-850/60">
          {app.components.map((component) => (
            <ComponentRow key={component.image} component={component} path={app.path || `apps/${app.name}`} />
          ))}
        </div>
      )}
    </Panel>
  );
}

const TRACKING_LABEL = { helm: "helm chart", manifests: "plain manifests", kustomize: "kustomize" } as const;

/**
 * Applications with no image pin to compare. Still worth a line each: ArgoCD's
 * sync and health apply to them exactly as to the others.
 */
function OtherApps({ apps }: { apps: AppDelivery[] }) {
  return (
    <Panel title="Other apps" note="no image pin to track">
      <ul className="space-y-3">
        {apps.map((app) => (
          <li key={app.name} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-ink-200">{app.name}</span>
              <span className="font-mono text-[10px] text-ink-600">{TRACKING_LABEL[app.tracking]}</span>
              <span className="ml-auto">
                <Badge tone={argoTone(app)}>
                  {app.sync} · {app.health}
                </Badge>
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-600">{app.note}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PullRequests({ prs }: { prs: PullRequestView[] }) {
  return (
    <Panel title="Open PRs" note="Home-Lab-Infra">
      {prs.length === 0 ? (
        <Empty>Nothing waiting to merge. A merge here is what starts a deploy.</Empty>
      ) : (
        <ul className="space-y-3">
          {prs.map((pr) => (
            <li key={pr.number} className="text-xs">
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-ink-600">#{pr.number}</span>
                <span className="text-ink-200">{pr.title}</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-ink-600">
                {pr.head} → {pr.base}
                {pr.draft && " · draft"}
                {pr.checks && ` · ${pr.checks}`}
              </p>
              {pr.url && <p className="mt-0.5 truncate font-mono text-[10px] text-sky-300/80">{pr.url}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Worst component first, so the app that needs you is at the top. */
function byUrgency(a: AppDelivery, b: AppDelivery): number {
  const worst = (app: AppDelivery) => Math.min(...app.components.map((c) => ORDER.indexOf(c.status)), ORDER.length);
  return worst(a) - worst(b) || a.name.localeCompare(b.name);
}
