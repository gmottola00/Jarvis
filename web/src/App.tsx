import { useState } from "react";
import { ICONS, Sidebar } from "./components/shell/Sidebar";
import { clearSession } from "./lib/api";
import { LearnModeProvider } from "./lib/hooks/useLearnMode";
import { navigate, useHashRoute } from "./lib/route";
import { Cluster } from "./pages/Cluster";
import { Dashboard } from "./pages/Dashboard";
import { Delivery } from "./pages/Delivery";
import { Alerts } from "./pages/Alerts";
import { Approvals } from "./pages/Approvals";
import { AppDetail } from "./pages/AppDetail";
import { Apps } from "./pages/Apps";
import { Capabilities } from "./pages/Capabilities";
import { Models } from "./pages/Models";
import { Runs } from "./pages/Runs";

/**
 * Two halves: the agent (chat, runs, approvals, models, capabilities) *decides and changes*;
 * the console (apps, cluster, delivery, alerts) *looks*, with no model involved — until a
 * console page hands something over, as "Investigate" on an alert does.
 */
const TABS = [
  { id: "dashboard", label: "chat", icon: ICONS.dashboard },
  { id: "runs", label: "runs", icon: ICONS.runs },
  { id: "approvals", label: "approvals", icon: ICONS.approvals },
  { id: "models", label: "models", icon: ICONS.models },
  { id: "capabilities", label: "capabilities", icon: ICONS.capabilities },
  { id: "apps", label: "apps", icon: ICONS.apps },
  { id: "cluster", label: "cluster", icon: ICONS.cluster },
  { id: "delivery", label: "delivery", icon: ICONS.delivery },
  { id: "alerts", label: "alerts", icon: ICONS.alerts },
] as const;

/** Where the console group starts in `TABS`. */
const CONSOLE_FROM = 5;

type Tab = (typeof TABS)[number]["id"];

function Shell() {
  const route = useHashRoute();
  const tab: Tab = TABS.some((t) => t.id === route.page) ? (route.page as Tab) : "dashboard";
  const setTab = (next: Tab) => navigate(next);
  const [section, sub] = route.segments;
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
        {tab === "capabilities" && <Capabilities />}
        {tab === "apps" && (section ? <AppDetail key={section} name={section} tab={sub} /> : <Apps />)}
        {tab === "cluster" && <Cluster tab={section} />}
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
