import { useEffect, useMemo, useRef, useState } from "react";
import { logStreamUrl, workloadLogStreamUrl } from "../../lib/console/api";
import { useLogStream, type LogLine, type StreamState } from "../../lib/hooks/useLogStream";
import type { Tone } from "../../lib/console/derive";
import { Badge, IconButton } from "../ui/primitives";

const STATE_TONE: Record<StreamState, Tone> = { connecting: "warn", live: "ok", closed: "idle", error: "bad" };

/** What to follow: one pod, or every pod of a workload merged. */
export type LogSource =
  | { kind: "pod"; namespace: string; pod: string; containers: string[] }
  | { kind: "workload"; namespace: string; workload: string; containers: string[] };

const SINCE = [
  { label: "last 300", seconds: 0 },
  { label: "5m", seconds: 300 },
  { label: "1h", seconds: 3600 },
  { label: "24h", seconds: 86_400 },
] as const;

/** Lines that read as problems get a colour, the way a terminal with a log highlighter would. */
function lineTone(text: string): string {
  if (/\b(ERROR|CRITICAL|FATAL|Traceback|panic)\b/i.test(text)) return "text-rose-300";
  if (/\bWARN(ING)?\b/i.test(text)) return "text-amber-300";
  return "text-ink-400";
}

/** `tickup-backend-5f7c8d9b6-qw3rt` → `qw3rt`: enough to tell replicas apart. */
function podTag(pod: string): string {
  return pod.split("-").pop() ?? pod;
}

function download(lines: LogLine[], name: string) {
  const text = lines.map((l) => (l.pod ? `[${l.pod}] ${l.text}` : l.text)).join("\n");
  const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.log` });
  a.click();
  URL.revokeObjectURL(url);
}

const SELECT =
  "rounded-md border border-ink-850 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-200 focus:border-ink-600 focus:outline-none";

function Toggle({ on, onChange, label, title }: { on: boolean; onChange: (on: boolean) => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={title}
      className={`rounded-md px-2 py-1 font-mono text-[10px] ring-1 ${
        on ? "text-sky-300 ring-sky-400/50" : "text-ink-600 ring-ink-850 hover:text-ink-200 hover:ring-ink-800"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * `kubectl logs -f`, in the browser — for a pod, or for a whole workload.
 *
 * Kubelet probe lines (`GET /health` every few seconds) are dropped by the
 * server unless "probes" is switched on. Auto-scroll follows the tail until you
 * scroll up, then stops so you can read; scrolling back to the bottom resumes it.
 */
export function LogViewer({ source }: { source: LogSource }) {
  const [container, setContainer] = useState(source.containers[0] ?? "");
  const [sinceSeconds, setSinceSeconds] = useState(0);
  const [probes, setProbes] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const target = source.kind === "pod" ? source.pod : source.workload;
  // A plain string: the stream hook reconnects only when it actually changes.
  const opts = { container, tail: sinceSeconds ? 5000 : 300, sinceSeconds: sinceSeconds || undefined, probes };
  const url =
    source.kind === "pod"
      ? logStreamUrl(source.namespace, source.pod, { ...opts, previous })
      : workloadLogStreamUrl(source.namespace, source.workload, opts);
  const { lines, state, error, pods, clear } = useLogStream(url, { paused, attempt });
  const multi = pods.length > 1;

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
        {source.kind === "workload" && pods.length > 0 && (
          <span className="font-mono text-[10px] text-ink-600" title={pods.join("\n")}>
            {pods.length} pod{pods.length > 1 ? "s" : ""}
          </span>
        )}
        {source.containers.length > 1 && (
          <select value={container} onChange={(event) => setContainer(event.target.value)} className={SELECT} aria-label="Container">
            {source.containers.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <select
          value={sinceSeconds}
          onChange={(event) => setSinceSeconds(Number(event.target.value))}
          className={SELECT}
          aria-label="Time range"
        >
          {SINCE.map((s) => (
            <option key={s.seconds} value={s.seconds}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter…"
          className="min-w-0 flex-1 rounded-md border border-ink-850 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-200 placeholder:text-ink-800 focus:border-ink-600 focus:outline-none"
        />
        <Toggle on={probes} onChange={setProbes} label="probes" title="Show kubelet health-probe lines (GET /health, kube-probe)" />
        {source.kind === "pod" && (
          <Toggle on={previous} onChange={setPrevious} label="previous" title="The container before its last restart" />
        )}
        <IconButton onClick={() => setPaused((p) => !p)} label={paused ? "Resume" : "Pause"}>
          {paused ? "resume" : "pause"}
        </IconButton>
        <IconButton onClick={clear} label="Clear">
          clear
        </IconButton>
        <IconButton onClick={() => download(lines, target)} label="Download">
          save
        </IconButton>
        {(state === "closed" || state === "error") && !previous && (
          <IconButton onClick={() => setAttempt((n) => n + 1)} label="Reconnect">
            reconnect
          </IconButton>
        )}
      </div>

      {error && <p className="border-b border-rose-500/20 bg-rose-500/5 px-5 py-1.5 font-mono text-[10px] text-rose-300">{error}</p>}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto bg-ink-950 px-5 py-3">
        {shown.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-800">{state === "connecting" ? "connecting to the kubelet…" : "no lines"}</p>
        ) : (
          <pre className="font-mono text-[11px] leading-5">
            {shown.map((line) => (
              <div key={line.id} className={`whitespace-pre-wrap break-all ${lineTone(line.text)}`}>
                {multi && line.pod && (
                  <span className="mr-2 text-ink-700" title={line.pod}>
                    {podTag(line.pod)}
                  </span>
                )}
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
