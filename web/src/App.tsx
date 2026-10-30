import { useEffect, useState } from "react";
import { ICONS, Sidebar } from "./components/shell/Sidebar";
import { clearSession } from "./lib/api";
import { LearnModeProvider } from "./lib/hooks/useLearnMode";
import { Cluster } from "./pages/Cluster";
import { Dashboard } from "./pages/Dashboard";
import { Delivery } from "./pages/Delivery";
import { Alerts } from "./pages/Alerts";
import { Approvals } from "./pages/Approvals";
import { Lab } from "./pages/Lab";
import { Models } from "./pages/Models";
import { Runs } from "./pages/Runs";

/**
 * Two halves: the agent (chat, runs, approvals, models, lab) *decides and changes*; the console
 * (cluster, delivery, alerts) *looks*, with no model involved — until a
 * console page hands something over, as "Investigate" on an alert does.
 */
const TABS = [
  { id: "dashboard", label: "chat", icon: ICONS.dashboard },
  { id: "runs", label: "runs", icon: ICONS.runs },
  { id: "approvals", label: "approvals", icon: ICONS.approvals },
  { id: "models", label: "models", icon: ICONS.models },
  { id: "lab", label: "lab", icon: ICONS.lab },
  { id: "cluster", label: "cluster", icon: ICONS.cluster },
  { id: "delivery", label: "delivery", icon: ICONS.delivery },
  { id: "alerts", label: "alerts", icon: ICONS.alerts },
] as const;

/** Where the console group starts in `TABS`. */
const CONSOLE_FROM = 5;

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
  // Bumping the key remounts the chat; with no stored session it mints a new one.
  const [chatKey, setChatKey] = useState(0);

  function newChat() {
    clearSession();
    setChatKey((k) => k + 1);
    setTab("dashboard");
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar items={TABS} splitAt={CONSOLE_FROM} active={tab} onSelect={setTab} onNewChat={newChat} />

      <main className="min-h-0 min-w-0 flex-1">
        {tab === "dashboard" && <Dashboard key={chatKey} />}
        {tab === "runs" && <Runs />}
        {tab === "approvals" && <Approvals />}
        {tab === "models" && <Models />}
        {tab === "lab" && <Lab />}
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
