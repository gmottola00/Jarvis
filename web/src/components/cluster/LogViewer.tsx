import { useEffect, useMemo, useRef, useState } from "react";
import { logStreamUrl } from "../../lib/console/api";
import { useLogStream, type StreamState } from "../../lib/hooks/useLogStream";
import type { Tone } from "../../lib/console/derive";
import { Badge, IconButton } from "../ui/primitives";

const STATE_TONE: Record<StreamState, Tone> = { connecting: "warn", live: "ok", closed: "idle", error: "bad" };

/** Lines that read as problems get a colour, the way a terminal with a log highlighter would. */
function lineTone(text: string): string {
  if (/\b(ERROR|CRITICAL|FATAL|Traceback|panic)\b/i.test(text)) return "text-rose-300";
  if (/\bWARN(ING)?\b/i.test(text)) return "text-amber-300";
  return "text-ink-400";
}

/**
 * `kubectl logs -f`, in the browser.
 *
 * Auto-scroll follows the tail until you scroll up, then stops so you can read;
 * scrolling back to the bottom resumes it. That is the one behaviour a log
 * viewer has to get right.
 */
export function LogViewer({ namespace, pod, containers }: { namespace: string; pod: string; containers: string[] }) {
  const [container, setContainer] = useState(containers[0] ?? "");
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);

  const url = useMemo(() => logStreamUrl(namespace, pod, { container, tail: 300 }), [namespace, pod, container]);
  const { lines, state, error, clear } = useLogStream(url, { paused });

  const shown = useMemo(() => {
    if (!filter) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => line.text.toLowerCase().includes(needle));
  }, [lines, filter]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-850 px-5 py-2">
        <Badge tone={STATE_TONE[state]}>{paused && state === "live" ? "paused" : state}</Badge>
        {containers.length > 1 && (
          <select
            value={container}
            onChange={(event) => setContainer(event.target.value)}
            className="rounded-md border border-ink-850 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-200"
          >
            {containers.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter…"
          className="min-w-0 flex-1 rounded-md border border-ink-850 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-200 placeholder:text-ink-800 focus:border-ink-600 focus:outline-none"
        />
        <IconButton onClick={() => setPaused((p) => !p)} label={paused ? "Resume" : "Pause"}>
          {paused ? "resume" : "pause"}
        </IconButton>
        <IconButton onClick={clear} label="Clear">
          clear
        </IconButton>
      </div>

      {error && <p className="border-b border-rose-500/20 bg-rose-500/5 px-5 py-1.5 font-mono text-[10px] text-rose-300">{error}</p>}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto bg-ink-950 px-5 py-3">
        {shown.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-800">{state === "connecting" ? "connecting to the kubelet…" : "no lines"}</p>
        ) : (
          <pre className="font-mono text-[11px] leading-5">
            {shown.map((line) => (
              <div key={line.id} className={`whitespace-pre-wrap break-all ${lineTone(line.text)}`}>
                {line.text}
              </div>
            ))}
          </pre>
        )}
      </div>

      {!follow && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="border-t border-ink-850 py-1.5 font-mono text-[10px] text-sky-300 hover:bg-ink-900"
        >
          ↓ jump to tail
        </button>
      )}
    </div>
  );
}
