import type { NavItem } from "./Sidebar";

/**
 * The phone's navigation: one tab per section, settings included, at the
 * bottom where a thumb reaches. It sits in the layout flow (not fixed), so
 * the page above it — the chat composer included — is never covered.
 */
export function TabBar<T extends string>({
  items,
  active,
  onSelect,
  badges = {},
}: {
  items: readonly NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  badges?: Partial<Record<T, { count: number; tone: "bad" | "warn" }>>;
}) {
  const index = items.findIndex((item) => item.id === active);

  return (
    <nav
      aria-label="Sections"
      className="vt-tabbar pb-safe relative z-30 shrink-0 border-t border-ultron-900 bg-ink-950/95 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden"
    >
      {/* A hairline of red glow along the top edge, the HUD's signature. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ultron-500/60 to-transparent"
      />
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        <span
          aria-hidden
          className="tab-pill pointer-events-none absolute top-1.5 left-0 flex justify-center"
          style={{
            width: `${100 / items.length}%`,
            transform: `translateX(${Math.max(index, 0) * 100}%)`,
            opacity: index < 0 ? 0 : 1,
          }}
        >
          <span className="h-8 w-12 rounded-full border border-ultron-700/70 bg-ultron-500/15 shadow-[0_0_14px_-3px_var(--color-ultron-500)]" />
        </span>
        {items.map(({ id, label, icon: Icon }) => {
          const current = id === active;
          const badge = badges[id];
          return (
            <button
              key={id}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={`relative flex min-h-14 flex-col items-center justify-start gap-0.5 pt-1.5 pb-1.5 transition-colors ${
                current ? "text-ultron-300" : "text-ink-500 active:text-ink-300"
              }`}
            >
              <span className="relative grid h-8 w-12 place-items-center transition-transform active:scale-90">
                <Icon
                  key={current ? "on" : "off"}
                  className={`size-5 ${current ? "tab-bump drop-shadow-[0_0_6px_var(--color-ultron-500)]" : ""}`}
                  strokeWidth={current ? 2.1 : 1.6}
                />
                {badge && badge.count > 0 && (
                  <span
                    aria-label={`${badge.count} need attention`}
                    className={`absolute -top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] leading-none font-semibold ${
                      badge.tone === "bad" ? "bg-rose-500 text-white" : "bg-amber-400 text-ink-950"
                    }`}
                  >
                    {badge.count > 9 ? "9+" : badge.count}
                  </span>
                )}
              </span>
              <span className="font-display text-[11px] leading-none font-semibold tracking-[0.12em] uppercase">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
