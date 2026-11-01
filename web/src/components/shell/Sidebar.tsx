import {
  Activity,
  Bell,
  Cpu,
  GraduationCap,
  LayoutGrid,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  SquarePen,
  Server,
  ShieldAlert,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useLearnMode } from "../../lib/hooks/useLearnMode";
import { UltronCore } from "./UltronCore";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export const ICONS = {
  dashboard: MessageSquare,
  runs: Activity,
  approvals: ShieldAlert,
  models: Cpu,
  capabilities: Wrench,
  cluster: Server,
  delivery: Rocket,
  apps: LayoutGrid,
  alerts: Bell,
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
 * The left rail. Two groups - the agent (decides and changes) and the console
 * (only looks) - split by a divider. Collapsed it is icons only; on a phone it
 * is an overlay drawer opened from the top bar.
 */
export function Sidebar<T extends string>({
  items,
  splitAt,
  active,
  onSelect,
  onNewChat,
}: {
  items: readonly NavItem<T>[];
  /** Index of the first console item; a divider goes before it. */
  splitAt: number;
  active: T;
  onSelect: (id: T) => void;
  /** Start a conversation from scratch. */
  onNewChat: () => void;
}) {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
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
        onClick={() => {
          onNewChat();
          setMobileOpen(false);
        }}
        className={`mb-3 flex w-full items-center gap-3 border border-ultron-800 bg-ultron-500/5 py-2 text-ultron-300 transition hover:border-ultron-500 hover:bg-ultron-500/15 hover:shadow-[0_0_14px_-4px_var(--color-ultron-500)] ${
          narrow ? "justify-center px-0" : "px-2.5"
        }`}
      >
        <SquarePen className="size-4 shrink-0" />
        {!narrow && <span className="font-display text-sm font-semibold tracking-[0.15em] uppercase">new chat</span>}
      </button>

      {items.map((item, index) => {
        const Icon = item.icon;
        const current = item.id === active;
        return (
          <div key={item.id}>
            {index === splitAt && (
              <div className={`my-2 flex items-center gap-2 ${narrow ? "px-2" : "px-2.5"}`}>
                {!narrow && <span className="font-mono text-[9px] tracking-widest text-ink-700 uppercase">console</span>}
                <span className="h-px flex-1 bg-ink-850" />
              </div>
            )}
            <button
              type="button"
              title={narrow ? item.label : undefined}
              aria-current={current ? "page" : undefined}
              onClick={() => {
                onSelect(item.id);
                setMobileOpen(false);
              }}
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
            </button>
          </div>
        );
      })}

      <div className="mt-auto space-y-1 border-t border-ink-850 pt-2">
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
      {/* Phone: a top bar with the menu button; the rail slides over the page. */}
      <div className="flex items-center gap-3 border-b border-ink-850 bg-ink-950 px-4 py-2 md:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setMobileOpen(true)} className="text-ink-400">
          <Menu className="size-5" />
        </button>
        <UltronCore size={20} />
        <span className="glow-red font-display text-base font-bold tracking-[0.3em] text-ultron-400">ULTRON</span>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-64 border-r border-ultron-900 bg-ink-950">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 text-ink-600"
            >
              <X className="size-4" />
            </button>
            {rail(false)}
          </aside>
        </div>
      )}

      {/* Desktop: a rail that collapses to icons. */}
      <aside
        className={`hidden shrink-0 border-r border-ink-850 bg-ink-950 transition-[width] duration-200 md:block ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        {rail(collapsed)}
      </aside>
    </>
  );
}
