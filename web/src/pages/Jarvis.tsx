import { SectionTabs } from "../components/shell/SectionTabs";
import { useStatus } from "../lib/hooks/useStatus";
import { navigate } from "../lib/route";
import { Approvals } from "./Approvals";
import { Capabilities } from "./Capabilities";
import { Dashboard } from "./Dashboard";
import { Runs } from "./Runs";

const TABS = ["chat", "runs", "approvals", "tools"] as const;
type JarvisTab = (typeof TABS)[number];

/** Talking to the agent: the conversation, its runs, what waits for you, and the tools it may call. */
export function Jarvis({ tab: rawTab, chatKey }: { tab?: string; chatKey: number }) {
  const tab: JarvisTab = TABS.includes(rawTab as JarvisTab) ? (rawTab as JarvisTab) : "chat";
  const waiting = useStatus().data?.counts.approvals;

  return (
    <SectionTabs
      value={tab}
      onChange={(next) => navigate("jarvis", next === "chat" ? undefined : next)}
      tabs={[
        { id: "chat", label: "chat" },
        { id: "runs", label: "runs" },
        { id: "approvals", label: "approvals", count: waiting || undefined },
        { id: "tools", label: "tools" },
      ]}
    >
      {tab === "chat" && <Dashboard key={chatKey} />}
      {tab === "runs" && <Runs />}
      {tab === "approvals" && <Approvals />}
      {tab === "tools" && <Capabilities />}
    </SectionTabs>
  );
}
