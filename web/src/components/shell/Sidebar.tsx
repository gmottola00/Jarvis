import {
  Bell,
  GraduationCap,
  HeartPulse,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings,
  SquarePen,
  Server,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useLearnMode } from "../../lib/hooks/useLearnMode";
import { PushSheet } from "../push/PushSheet";
import { UltronCore } from "./UltronCore";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export const ICONS = {
  status: HeartPulse,
  cluster: Server,
  delivery: Rocket,
  jarvis: MessageSquare,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

const COLLAPSED_KEY = "jarvis.sidebar";

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/**
 * The left rail: four questions — is everything fine, what runs, what ships,
 * ask Ultron — and settings in the footer. Collapsed it is icons only. A
 * phone gets a slim top bar here and the sections in the bottom `TabBar`.
 */
export function Sidebar<T extends string>({
  items,
  active,
  onSelect,
  badges = {},
  settings,
  onNewChat,
}: {
  items: readonly NavItem<T>[];
  /** null when the page is not one of `items` (settings). */
  active: T | null;
  onSelect: (id: T) => void;
  /** A count on an item that needs you: problems on status, waiting approvals on jarvis. */
  badges?: Partial<Record<T, { count: number; tone: "bad" | "warn" }>>;
  /** The footer entry for models, the GPU host and the budget. */
  settings: { active: boolean; onSelect: () => void };
  /** Start a conversation from scratch. */
  onNewChat: () => void;
}) {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [pushOpen, setPushOpen] = useState(false);
  const learn = useLearnMode();

  function toggleCollapsed() {
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, current ? "open" : "collapsed");
      } catch {
        /* the rail still toggles, it just forgets */
      }
      return !current;
    });
  }

  const rail = (narrow: boolean) => (
    <nav className="flex h-full flex-col gap-1 px-2 py-3">
      <div className={`mb-4 flex items-center gap-2.5 px-1.5 ${narrow ? "justify-center" : ""}`}>
        <UltronCore size={narrow ? 26 : 30} />
        {!narrow && (
          <div className="leading-none">
            <p className="glow-red font-display text-lg font-bold tracking-[0.3em] text-ultron-400">ULTRON</p>
            <p className="mt-1 font-mono text-[9px] tracking-widest text-ink-600 uppercase">homelab operator</p>
          </div>
        )}
      </div>

      <button
        type="button"
        title={narrow ? "New chat" : undefined}
        onClick={() => onNewChat()}
        className={`mb-3 flex w-full items-center gap-3 border border-ultron-800 bg-ultron-500/5 py-2 text-ultron-300 transition hover:border-ultron-500 hover:bg-ultron-500/15 hover:shadow-[0_0_14px_-4px_var(--color-ultron-500)] ${
          narrow ? "justify-center px-0" : "px-2.5"
        }`}
      >
        <SquarePen className="size-4 shrink-0" />
        {!narrow && <span className="font-display text-sm font-semibold tracking-[0.15em] uppercase">new chat</span>}
      </button>

      {items.map((item) => {
        const Icon = item.icon;
        const current = item.id === active;
        const badge = badges[item.id];
        return (
          <div key={item.id}>
            <button
              type="button"
              title={narrow ? item.label : undefined}
              aria-current={current ? "page" : undefined}
              onClick={() => onSelect(item.id)}
              className={`group relative flex w-full items-center gap-3 rounded-md py-2 text-left transition-colors ${
                narrow ? "justify-center px-0" : "px-2.5"
              } ${
                current
                  ? "bg-ultron-500/10 text-ultron-300"
                  : "text-ink-500 hover:bg-ink-900 hover:text-ink-200"
              }`}
            >
              {current && (
                <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-ultron-500 shadow-[0_0_8px] shadow-ultron-500" />
              )}
              <Icon className={`size-4 shrink-0 ${current ? "drop-shadow-[0_0_6px_var(--color-ultron-500)]" : ""}`} />
              {!narrow && <span className="font-display text-sm font-semibold tracking-[0.15em] uppercase">{item.label}</span>}
              {badge && badge.count > 0 && (
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    narrow ? "absolute top-0.5 right-1" : "ml-auto"
                  } rounded px-1.5 py-px ${badge.tone === "bad" ? "bg-rose-500/20 text-rose-300" : "bg-amber-400/15 text-amber-300"}`}
                >
                  {badge.count}
                </span>
              )}
            </button>
          </div>
        );
      })}

      <div className="mt-auto space-y-1 border-t border-ink-850 pt-2">
        <button
          type="button"
          onClick={() => settings.onSelect()}
          aria-current={settings.active ? "page" : undefined}
          title="Models, GPU host and budget"
          className={`flex w-full items-center gap-3 rounded-md py-2 ${narrow ? "justify-center" : "px-2.5"} ${
            settings.active ? "text-ultron-300" : "text-ink-600 hover:text-ink-300"
          }`}
        >
          <Settings className="size-4 shrink-0" />
          {!narrow && <span className="font-mono text-[11px]">settings</span>}
        </button>
        <button
          type="button"
          onClick={() => setPushOpen(true)}
          title="Notifications on this device"
          className={`flex w-full items-center gap-3 rounded-md py-2 text-ink-600 hover:text-ink-300 ${
            narrow ? "justify-center" : "px-2.5"
          }`}
        >
          <Bell className="size-4 shrink-0" />
          {!narrow && <span className="font-mono text-[11px]">notifications</span>}
        </button>
        <button
          type="button"
          onClick={learn.toggle}
          aria-pressed={learn.on}
          title="Show the explanation next to each panel"
          className={`flex w-full items-center gap-3 rounded-md py-2 ${narrow ? "justify-center" : "px-2.5"} ${
            learn.on ? "text-cyan-300" : "text-ink-600 hover:text-ink-300"
          }`}
        >
          <GraduationCap className="size-4 shrink-0" />
          {!narrow && <span className="font-mono text-[11px]">learn {learn.on ? "on" : "off"}</span>}
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          title={narrow ? "Expand" : "Collapse"}
          className={`hidden w-full items-center gap-3 rounded-md py-2 text-ink-600 hover:text-ink-300 md:flex ${
            narrow ? "justify-center" : "px-2.5"
          }`}
        >
          {narrow ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!narrow && <span className="font-mono text-[11px]">collapse</span>}
        </button>
      </div>
    </nav>
  );

  return (
    <>
      {/* Phone: a top bar with the brand and the quick actions; the sections are in the bottom tab bar. */}
      {/* Installed on an iPhone the page runs under the status bar: pad past it. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-ink-850 bg-ink-950 pt-[max(env(safe-area-inset-top),0.75rem)] pr-[max(env(safe-area-inset-right),0.5rem)] pb-2 pl-[max(env(safe-area-inset-left),1rem)] md:hidden">
        <UltronCore size={22} />
        <span className="glow-red font-display text-lg font-bold tracking-[0.3em] text-ultron-400">ULTRON</span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            aria-label="New chat"
            onClick={onNewChat}
            className="grid size-10 place-items-center rounded-full text-ultron-300 transition active:scale-90 active:bg-ultron-500/15"
          >
            <SquarePen className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Learn mode"
            aria-pressed={learn.on}
            onClick={learn.toggle}
            className={`grid size-10 place-items-center rounded-full transition active:scale-90 active:bg-ink-850 ${
              learn.on ? "text-cyan-300" : "text-ink-400"
            }`}
          >
            <GraduationCap className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setPushOpen(true)}
            className="grid size-10 place-items-center rounded-full text-ink-400 transition active:scale-90 active:bg-ink-850"
          >
            <Bell className="size-5" />
          </button>
        </div>
      </div>

      {/* Desktop: a rail that collapses to icons. */}
      <aside
        className={`hidden shrink-0 border-r border-ink-850 bg-ink-950 transition-[width] duration-200 md:block ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        {rail(collapsed)}
      </aside>

      <PushSheet open={pushOpen} onClose={() => setPushOpen(false)} />
    </>
  );
}
