/** Formatting for the numbers Kubernetes hands back. Pure functions, no React. */

/** `8294400` → `96d`. The same compact style `kubectl get` uses in its AGE column. */
export function age(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.floor(seconds / 86_400)}d`;
}

/** Age of an ISO timestamp, relative to now. */
export function since(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "—" : age((Date.now() - at) / 1000);
}

/** `710` → `710m`, `16000` → `16`. Millicores, the unit requests and limits use. */
export function cpu(milli: number): string {
  if (milli >= 1000 && milli % 1000 === 0) return String(milli / 1000);
  if (milli >= 1000) return (milli / 1000).toFixed(1);
  return `${milli}m`;
}

/** Binary units, like the `Mi`/`Gi` suffixes in a manifest. */
export function bytes(count: number): string {
  const units = ["B", "Ki", "Mi", "Gi", "Ti"];
  let value = count;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

/** Git SHAs and image tags are long; eight characters is what GitHub shows. */
export function shortSha(tag: string | null | undefined): string {
  if (!tag) return "—";
  return /^[0-9a-f]{12,}$/i.test(tag) ? tag.slice(0, 8) : tag;
}

/** `ghcr.io/gmottola00/tickup-web:4f5e…` → `{ repo: "ghcr.io/gmottola00/tickup-web", tag: "4f5e…" }`. */
export function splitImage(image: string): { repo: string; name: string; tag: string } {
  const at = image.lastIndexOf(":");
  const hasTag = at > image.lastIndexOf("/");
  const repo = hasTag ? image.slice(0, at) : image;
  return { repo, name: repo.split("/").pop() ?? repo, tag: hasTag ? image.slice(at + 1) : "latest" };
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

/** Clock time for a fetch stamp: `18:42:07`. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour12: false });
}
