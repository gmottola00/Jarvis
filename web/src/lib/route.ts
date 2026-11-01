import { useEffect, useState } from "react";

/**
 * The page lives in the URL hash as `#page/segment/segment`, so a reload — or
 * a bookmarked `#cluster/apps/tickup/logs` — lands on exactly the same view.
 */
export interface Route {
  page: string;
  segments: string[];
}

/**
 * Old addresses that still have to land somewhere sensible. The rest of the
 * path is kept, so `#apps/tickup/logs` becomes `#cluster/apps/tickup/logs`.
 */
const REDIRECTS: Record<string, string> = {
  dashboard: "jarvis",
  runs: "jarvis/runs",
  approvals: "jarvis/approvals",
  models: "settings",
  capabilities: "jarvis/tools",
  alerts: "status/alerts",
  lab: "status",
  apps: "cluster/apps",
};

function strip(hash: string): string {
  return hash.replace(/^#\/?/, "");
}

/** `#apps/tickup/logs` → `cluster/apps/tickup/logs`; null when the hash is already current. */
function redirected(hash: string): string | null {
  const [head, ...rest] = strip(hash).split("/");
  const target = head ? REDIRECTS[head] : undefined;
  return target ? [target, ...rest].filter(Boolean).join("/") : null;
}

export function parseHash(hash: string): Route {
  const raw = redirected(hash) ?? strip(hash);
  const [page = "", ...segments] = raw.split("/").filter(Boolean).map(decodeURIComponent);
  return { page, segments };
}

export function href(page: string, ...segments: (string | undefined)[]): string {
  return `#${[page, ...segments.filter((s): s is string => Boolean(s))].map(encodeURIComponent).join("/")}`;
}

export function navigate(page: string, ...segments: (string | undefined)[]): void {
  window.location.hash = href(page, ...segments);
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const sync = () => {
      // Rewrite a redirected address so the bar shows where we actually are.
      const target = redirected(window.location.hash);
      if (target) window.history.replaceState(null, "", `#${target}`);
      setRoute(parseHash(window.location.hash));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return route;
}
