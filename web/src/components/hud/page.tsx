import type { ReactNode } from "react";
import { clock } from "../../lib/format";
import { UltronCore } from "../shell/UltronCore";
import { GlowDot } from "./marks";

/** The grid and scanlines behind every HUD page. The parent must be `relative`. */
export function HudBackdrop() {
  return (
    <>
      <div className="hud-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="scanlines absolute inset-0 opacity-40" aria-hidden />
    </>
  );
}

/**
 * A console page: backdrop, the core, a glowing title, and on the right a
 * status line over a row of actions. The body scrolls; `overlay` (drawers,
 * dialogs) sits outside the scroll so it stays put.
 */
export function HudPage({
  title,
  subtitle,
  live = false,
  status,
  actions,
  overlay,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The core breathes while true: a refresh in flight. */
  live?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full">
      <HudBackdrop />
      <div className="relative h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-3 pt-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:space-y-6 sm:px-8 sm:pt-6">
          {/* On a phone the top bar already carries the core: the title starts
              the page, and the status line and actions share one row under it. */}
          <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="hidden sm:block">
              <UltronCore size={44} live={live} />
            </span>
            <div className="min-w-0 flex-1 sm:flex-none">
              <h2 className="glow-red font-display text-2xl leading-none font-bold tracking-[0.25em] [overflow-wrap:anywhere] text-ultron-400 uppercase sm:text-3xl sm:tracking-[0.35em]">
                {title}
              </h2>
              {subtitle && <p className="mt-1.5 text-xs text-pretty text-ink-500">{subtitle}</p>}
            </div>
            {(status || actions) && (
              <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto sm:w-auto sm:flex-col sm:items-end">
                {status}
                {actions && <div className="ml-auto flex flex-wrap justify-end gap-2 sm:ml-0">{actions}</div>}
              </div>
            )}
          </header>
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** `● LIVE · POLL 30S · 12:18:17`: the light goes rose when the last fetch failed. */
export function LiveStamp({ error = false, every, at }: { error?: boolean; every?: number; at?: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.15em] text-ink-600 uppercase">
      <GlowDot tone={error ? "bad" : "ok"} size="sm" pulse />
      live{every !== undefined && ` · poll ${every / 1000}s`}
      {at && ` · ${clock(at)}`}
    </span>
  );
}
