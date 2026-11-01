import { useState } from "react";
import { ICONS, Sidebar } from "./components/shell/Sidebar";
import { clearSession } from "./lib/api";
import { LearnModeProvider } from "./lib/hooks/useLearnMode";
import { StatusProvider, useStatus } from "./lib/hooks/useStatus";
import { navigate, useHashRoute } from "./lib/route";
import { AppDetail } from "./pages/AppDetail";
import { Cluster } from "./pages/Cluster";
import { Delivery } from "./pages/Delivery";
import { Jarvis } from "./pages/Jarvis";
import { Settings } from "./pages/Settings";
import { Status } from "./pages/Status";

/**
 * Four questions, one section each: is everything fine (status), what runs
 * (cluster), what ships (delivery), and talking to the agent (jarvis). The
 * console sections only look; a console page hands something to the agent
 * only when a person clicks "Investigate".
 */
const TABS = [
  { id: "status", label: "status", icon: ICONS.status },
  { id: "cluster", label: "cluster", icon: ICONS.cluster },
  { id: "delivery", label: "delivery", icon: ICONS.delivery },
  { id: "jarvis", label: "jarvis", icon: ICONS.jarvis },
] as const;

type Tab = (typeof TABS)[number]["id"] | "settings";

function Shell() {
  const route = useHashRoute();
  const tab: Tab =
    route.page === "settings" || TABS.some((t) => t.id === route.page) ? (route.page as Tab) : "status";
  const [section, sub, extra] = route.segments;
  // Bumping the key remounts the chat; with no stored session it mints a new one.
  const [chatKey, setChatKey] = useState(0);
  const status = useStatus().data;

  function newChat() {
    clearSession();
    setChatKey((k) => k + 1);
    navigate("jarvis");
  }

  const problems = status?.problems ?? [];
  const badges = {
    status: problems.length
      ? { count: problems.length, tone: problems.some((p) => p.severity === "bad") ? ("bad" as const) : ("warn" as const) }
      : undefined,
    jarvis: status?.counts.approvals ? { count: status.counts.approvals, tone: "warn" as const } : undefined,
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar
        items={TABS}
        active={tab}
        onSelect={(id) => navigate(id)}
        badges={badges}
        settings={{ active: tab === "settings", onSelect: () => navigate("settings") }}
        onNewChat={newChat}
      />

      <main className="min-h-0 min-w-0 flex-1">
        {tab === "status" && <Status tab={section} />}
        {tab === "cluster" &&
          (section === "apps" && sub ? (
            <AppDetail key={sub} name={sub} tab={extra} component={route.segments[3]} />
          ) : (
            <Cluster tab={section} />
          ))}
        {tab === "delivery" && <Delivery />}
        {tab === "jarvis" && <Jarvis tab={section} chatKey={chatKey} />}
        {tab === "settings" && <Settings tab={section} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <LearnModeProvider>
      <StatusProvider>
        <Shell />
      </StatusProvider>
    </LearnModeProvider>
  );
}
