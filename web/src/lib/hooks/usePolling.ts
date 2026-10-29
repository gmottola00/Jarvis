import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  /** True only before the first response; later refreshes keep the old data on screen. */
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

/**
 * Fetch now, then every `intervalMs`, while the tab is visible.
 *
 * A failed refresh keeps the last good data and sets `error` — a flaky upstream
 * should not blank the page. Pass `intervalMs = 0` to fetch once. Changing
 * `key` (e.g. the selected pod) refetches immediately and discards stale
 * responses from the previous key.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, key: unknown = null): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = generation.current;
    setRefreshing(true);
    fetcherRef
      .current()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (mine !== generation.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => mine === generation.current && setRefreshing(false));
  }, []);

  useEffect(() => {
    generation.current += 1;
    setData(null);
    setError(null);
    load();
    if (!intervalMs) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [load, intervalMs, key]);

  return { data, error, loading: data === null && error === null, refreshing, refresh: load };
}
