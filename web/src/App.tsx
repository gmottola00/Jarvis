import { useEffect, useState } from "react";
import { RunTimeline } from "./components/runs/RunTimeline";
import { LearnModeProvider, useLearnMode } from "./lib/hooks/useLearnMode";
import { Cluster } from "./pages/Cluster";
import { Dashboard } from "./pages/Dashboard";
import { Delivery } from "./pages/Delivery";
import { Alerts } from "./pages/Alerts";

/**
 * Two halves: the agent (chat, runs) *decides and changes*; the console
 * (cluster, delivery, alerts) *looks*, with no model involved — until a
 * console page hands something over, as "Investigate" on an alert does.
 */
const TABS = [
  { id: "dashboard", label: "agent" },
  { id: "runs", label: "runs" },
  { id: "cluster", label: "cluster" },
  { id: "delivery", label: "delivery" },
  { id: "alerts", label: "alerts" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/** The tab lives in the URL hash, so a reload — or a shared link — lands on the same page. */
function useHashTab(): [Tab, (tab: Tab) => void] {
  const read = (): Tab => {
    const hash = window.location.hash.slice(1);
    return TABS.some((t) => t.id === hash) ? (hash as Tab) : "dashboard";
  };
  const [tab, setTab] = useState<Tab>(read);

  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return [tab, (next) => (window.location.hash = next)];
}

function Shell() {
  const [tab, setTab] = useHashTab();
  const learn = useLearnMode();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-5 border-b border-ink-850 px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-mono text-sm font-medium tracking-wide">JARVIS</h1>
          <span className="hidden font-mono text-[10px] text-ink-800 sm:inline">operates the homelab</span>
        </div>

        <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
          {TABS.map(({ id, label }, index) => (
            <span key={id} className="flex items-center gap-1">
              {index === 2 && <span className="mx-1 h-4 w-px bg-ink-850" aria-hidden />}
              <button
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] uppercase ${
                  tab === id ? "bg-ink-850 text-ink-200" : "text-ink-600 hover:text-ink-400"
                }`}
              >
                {label}
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={learn.toggle}
            aria-pressed={learn.on}
            title="Show the explanation next to each panel"
            className={`ml-2 rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 ${
              learn.on ? "bg-sky-500/10 text-sky-300 ring-sky-500/25" : "text-ink-600 ring-ink-850 hover:text-ink-400"
            }`}
          >
            learn {learn.on ? "on" : "off"}
          </button>
        </nav>
      </header>

      <main className="min-h-0 flex-1">
        {tab === "dashboard" && <Dashboard />}
        {tab === "runs" && <RunTimeline />}
        {tab === "cluster" && <Cluster />}
        {tab === "delivery" && <Delivery />}
        {tab === "alerts" && <Alerts />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <LearnModeProvider>
      <Shell />
    </LearnModeProvider>
  );
}
