import { isAppNamespace } from "../../lib/console/apps";
import type { Tone } from "../../lib/console/derive";
import type { AppDelivery } from "../../lib/console/types";
import { shortSha } from "../../lib/format";
import { href } from "../../lib/route";
import { HudCard, Quiet, StatusMark } from "../hud";
import { Learn, LearnCommand } from "../ui/primitives";
import { argoTone } from "./status";

const ROW_MARK: Partial<Record<Tone, string>> = {
  warn: "hud-hazard hazard-warn border-l-amber-400",
  bad: "hud-hazard border-l-rose-400",
};

/** Every ArgoCD application on one card: what Git says each one should be, and whether it is. */
export function ArgoApps({ apps }: { apps: AppDelivery[] }) {
  return (
    <HudCard eyebrow="gitops" title="ArgoCD" note={`${apps.length} apps`}>
      <div className="px-4 sm:px-6 pt-2">
        <Learn topic="gitops" />
        <LearnCommand command="kubectl get applications -n argocd -o wide" />
      </div>
      <ul className="grid gap-x-6 px-4 sm:px-6 pt-1.5 pb-5 md:grid-cols-2">
        {apps.map((app) => {
          const tone = argoTone(app);
          return (
            <li
              key={app.name}
              className={`grid grid-cols-1 items-center gap-x-3 gap-y-1 border-t sm:grid-cols-[minmax(0,1fr)_auto] border-l-2 border-t-ultron-500/12 border-l-transparent px-3 py-2.5 ${ROW_MARK[tone] ?? ""}`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                {isAppNamespace(app.name) ? (
                  <a href={href("cluster", "apps", app.name)} className="font-mono text-[13px] font-medium [overflow-wrap:anywhere] text-ink-200 hover:text-ultron-300">
                    {app.name}
                  </a>
                ) : (
                  <span className="font-mono text-[13px] font-medium text-ink-200">{app.name}</span>
                )}
                <span className="truncate font-mono text-[11px] text-ink-700">
                  {app.path} <span className="text-ink-500">@ {shortSha(app.revision) || "?"}</span>
                </span>
              </span>
              <StatusMark tone={tone}>
                {app.sync} · {app.health}
              </StatusMark>
            </li>
          );
        })}
        {apps.length === 0 && (
          <li className="py-2">
            <Quiet>No applications.</Quiet>
          </li>
        )}
      </ul>
    </HudCard>
  );
}
