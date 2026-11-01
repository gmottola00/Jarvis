import { useEffect, useState } from "react";

/**
 * The page lives in the URL hash as `#page/segment/segment`, so a reload — or
 * a bookmarked `#apps/tickup/logs` — lands on exactly the same view.
 */
export interface Route {
  page: string;
  segments: string[];
}

/** Old addresses that still have to land somewhere sensible. */
const REDIRECTS: Record<string, string> = { lab: "cluster/health" };

export function parseHash(hash: string): Route {
  let raw = hash.replace(/^#\/?/, "");
  const [head] = raw.split("/");
  if (head && REDIRECTS[head]) raw = REDIRECTS[head];
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
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    // Rewrite a redirected address so the bar shows where we actually are.
    const head = window.location.hash.replace(/^#\/?/, "").split("/")[0];
    if (REDIRECTS[head]) window.history.replaceState(null, "", `#${REDIRECTS[head]}`);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}
