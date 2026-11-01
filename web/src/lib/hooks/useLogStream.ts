import { useEffect, useRef, useState } from "react";

export type StreamState = "connecting" | "live" | "closed" | "error";

export interface LogLine {
  id: number;
  text: string;
  /** Set on workload streams, where lines from several pods interleave. */
  pod?: string;
}

/**
 * Follow a pod's (or a workload's) log over SSE.
 *
 * Unlike the chat stream, this endpoint is a GET, so the browser's built-in
 * `EventSource` handles framing and reconnects. The server names each event
 * after its `type` field (`line`, `pods`, `end` or `error`), which is what the
 * listeners below subscribe to. `end` means the server finished on purpose — a
 * previous container's log has no tail to follow — so the source is closed
 * rather than left to reconnect and replay it.
 *
 * Closing the `EventSource` drops the HTTP connection; the backend sees the
 * disconnect and releases the watch it holds on the API server. So unmounting
 * the viewer is all it takes to stop following.
 *
 * `paused` buffers nothing — lines that arrive while paused are dropped, the way
 * `kubectl logs -f` would if you hit Ctrl+S. Keeping only `max` lines bounds
 * memory on a chatty pod.
 */
export function useLogStream(url: string | null, { paused = false, max = 2000, attempt = 0 } = {}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [pods, setPods] = useState<string[]>([]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    setLines([]);
    setError(null);
    setPods([]);
    if (!url) {
      setState("closed");
      return;
    }

    setState("connecting");
    const source = new EventSource(url);
    let next = 0;

    source.onopen = () => setState("live");
    source.addEventListener("line", (event) => {
      if (pausedRef.current) return;
      const { text, pod } = JSON.parse((event as MessageEvent<string>).data) as { text: string; pod?: string };
      const line = { id: next++, text, pod };
      setLines((current) => (current.length >= max ? [...current.slice(-max + 1), line] : [...current, line]));
    });
    source.addEventListener("pods", (event) => {
      setPods((JSON.parse((event as MessageEvent<string>).data) as { pods: string[] }).pods);
    });
    source.addEventListener("end", () => {
      setState("closed");
      source.close();
    });
    source.addEventListener("error", (event) => {
      // Two different things share this name: our in-band `error` event (has
      // data) and the transport failing (no data). Only the first is final.
      const data = (event as MessageEvent<string>).data;
      if (data) {
        setError((JSON.parse(data) as { message: string }).message);
        setState("error");
        source.close();
      } else if (source.readyState === EventSource.CLOSED) {
        setState("closed");
      } else {
        setState("connecting");
      }
    });

    return () => source.close();
    // `attempt` is only a dependency: bumping it reopens the same URL.
  }, [url, max, attempt]);

  return { lines, state, error, pods, clear: () => setLines([]) };
}
