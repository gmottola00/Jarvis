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
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <UltronCore size={44} live={live} />
            <div className="min-w-0">
              <h2 className="glow-red font-display text-3xl leading-none font-bold tracking-[0.35em] text-ultron-400 uppercase">{title}</h2>
              {subtitle && <p className="mt-1.5 text-xs text-ink-500">{subtitle}</p>}
            </div>
            {(status || actions) && (
              <div className="ml-auto flex flex-col items-end gap-2">
                {status}
                {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
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
