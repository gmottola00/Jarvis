import { SectionTabs } from "../components/shell/SectionTabs";
import { navigate } from "../lib/route";
import { Capabilities } from "./Capabilities";
import { Models } from "./Models";

const TABS = ["models", "capabilities"] as const;
type SettingsTab = (typeof TABS)[number];

/** How Jarvis is wired: which models answer and which tools it may call. */
export function Settings({ tab: rawTab }: { tab?: string }) {
  const tab: SettingsTab = TABS.includes(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "models";
  return (
    <SectionTabs
      value={tab}
      onChange={(next) => navigate("settings", next)}
      tabs={TABS.map((id) => ({ id, label: id }))}
    >
      {tab === "models" && <Models />}
      {tab === "capabilities" && <Capabilities />}
    </SectionTabs>
  );
}
