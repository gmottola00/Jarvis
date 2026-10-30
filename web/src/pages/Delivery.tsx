import { ComponentRow } from "../components/delivery/ComponentRow";
import { PipelineDiagram } from "../components/delivery/PipelineDiagram";
import { argoTone } from "../components/delivery/status";
import { Aside, GlowDot, HudCard, HudPage, HudPanel, Leader, LiveStamp, Readouts, RefreshButton, type Readout } from "../components/hud";
import { Empty, ErrorNote, Loading } from "../components/ui/primitives";
import { TONE } from "../components/ui/tone";
import { consoleApi } from "../lib/console/api";
import type { AppDelivery, DeliveryStatus, PullRequestView } from "../lib/console/types";
import { shortSha } from "../lib/format";
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

  const drifted = count("drifted");
  const rolling = count("rolling-out");
  const readouts: Readout[] = [
    { label: "images", value: components.length, sub: `${tracked.length} of ${data?.apps.length ?? 0} ArgoCD apps pin images`, tone: "idle" },
    { label: "in sync", value: count("in-sync"), sub: "per image", tone: "ok" },
    { label: "behind", value: count("behind"), sub: "newer builds not pinned", tone: count("behind") ? "warn" : "ok" },
    {
      label: "drifted / rolling",
      value: `${drifted} / ${rolling}`,
      sub: "cluster ≠ Git",
      tone: drifted ? "bad" : rolling ? "info" : "ok",
    },
  ];

  return (
    <HudPage
      title="Delivery"
      subtitle="Built, green, pinned, running — per image, without asking the agent."
      live={refreshing}
      status={<LiveStamp error={Boolean(error)} every={POLL_MS} at={data?.fetched_at} />}
      actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}
    >
      <PipelineDiagram />

      {loading && <Loading label="asking ArgoCD, GitHub and GHCR…" />}
      <ErrorNote errors={error} />
      {data && <ErrorNote errors={data.errors} />}

      {data && (
        <>
          <Readouts readouts={readouts} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              {[...tracked].sort(byUrgency).map((app, index) => (
                <AppCard key={app.name} app={app} index={index} />
              ))}
              {data.apps.length === 0 && <Empty>ArgoCD reports no applications.</Empty>}
            </div>
            <div className="min-w-0 space-y-4">
              <PullRequests prs={data.pull_requests} />
              {untracked.length > 0 && <OtherApps apps={untracked} />}
            </div>
          </div>
        </>
      )}
    </HudPage>
  );
}

function AppCard({ app, index }: { app: AppDelivery; index: number }) {
  const tone = argoTone(app);
  return (
    <HudCard
      eyebrow={`app ${String(index + 1).padStart(2, "0")}`}
      title={app.name}
      note={`${app.path} @ ${shortSha(app.revision)}`}
      status={
        <span
          title="ArgoCD sync / health"
          className={`flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.15em] uppercase ${TONE[tone].text}`}
        >
          <GlowDot tone={tone} />
          {app.sync} · {app.health}
        </span>
      }
    >
      {app.components.length === 0 ? (
        <p className="px-6 pt-2 pb-5 text-xs text-ink-500">No image pins found in {app.path}/kustomization.yaml.</p>
      ) : (
        <div className="space-y-3 px-6 pt-3 pb-5">
          {app.components.map((component) => (
            <ComponentRow key={component.image} component={component} path={app.path || `apps/${app.name}`} />
          ))}
        </div>
      )}
    </HudCard>
  );
}

const TRACKING_LABEL = { helm: "helm chart", manifests: "plain manifests", kustomize: "kustomize" } as const;

/**
 * Applications with no image pin to compare. Still worth a line each: ArgoCD's
 * sync and health apply to them exactly as to the others.
 */
function OtherApps({ apps }: { apps: AppDelivery[] }) {
  return (
    <HudPanel title="other apps" note="no image pin">
      <ul className="space-y-3.5">
        {apps.map((app) => {
          const tone = argoTone(app);
          return (
            <li key={app.name} className="flex flex-col gap-1">
              <Leader label={<span className="text-ink-200">{app.name}</span>} value={<span className={TONE[tone].text}>{TRACKING_LABEL[app.tracking]}</span>} />
              <p className="text-xs leading-snug text-ink-500">{app.note}</p>
              {tone !== "ok" && (
                <p className={`font-mono text-[10px] ${TONE[tone].text}`}>
                  › {app.sync} · {app.health}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </HudPanel>
  );
}

function PullRequests({ prs }: { prs: PullRequestView[] }) {
  return (
    <HudPanel title="open prs" note={prs.length}>
      <div className="flex flex-col gap-1.5 font-mono text-xs leading-relaxed">
        <span className="text-ultron-300">› Home-Lab-Infra</span>
        {prs.length === 0 ? (
          <Aside>Nothing waiting to merge. A merge here is what starts a deploy.</Aside>
        ) : (
          <ul className="space-y-3 border-l border-ink-800 pl-3">
            {prs.map((pr) => (
              <li key={pr.number}>
                <p className="flex items-baseline gap-2">
                  <span className="text-ink-600">#{pr.number}</span>
                  <span className="font-sans text-ink-200">{pr.title}</span>
                </p>
                <p className="mt-0.5 text-[10px] text-ink-600">
                  {pr.head} → {pr.base}
                  {pr.draft && " · draft"}
                  {pr.checks && ` · ${pr.checks}`}
                </p>
                {pr.url && (
                  <a href={pr.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-ultron-300/80 hover:text-ultron-300">
                    {pr.url}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}

/** Worst component first, so the app that needs you is at the top. */
function byUrgency(a: AppDelivery, b: AppDelivery): number {
  const worst = (app: AppDelivery) => Math.min(...app.components.map((c) => ORDER.indexOf(c.status)), ORDER.length);
  return worst(a) - worst(b) || a.name.localeCompare(b.name);
}
