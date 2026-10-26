import { useState } from "react";
import { RunTimeline } from "./components/runs/RunTimeline";
import { Dashboard } from "./pages/Dashboard";

type Tab = "dashboard" | "runs";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-5 border-b border-ink-850 px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-mono text-sm font-medium tracking-wide">JARVIS</h1>
          <span className="font-mono text-[10px] text-ink-800">operates the homelab</span>
        </div>

        <nav className="ml-auto flex gap-1">
          {(["dashboard", "runs"] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] uppercase ${
                tab === name ? "bg-ink-850 text-ink-200" : "text-ink-600 hover:text-ink-400"
              }`}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1">{tab === "dashboard" ? <Dashboard /> : <RunTimeline />}</main>
    </div>
  );
}
