import type { ReactNode } from "react";
import { BracketTabs } from "../hud";

/**
 * A thin tab strip above a page that has its own layout (the chat is full
 * height, the settings pages are HUD pages): the section picks the view, the
 * view keeps everything else.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-ink-850 bg-ink-950 px-3 py-1 sm:px-8 sm:py-1.5">
        <BracketTabs tabs={tabs} value={value} onChange={onChange} />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
