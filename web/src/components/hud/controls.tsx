import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

/** At least 36px tall below md, so a thumb hits it. */
const BASE = "inline-flex min-h-9 items-center justify-center md:min-h-0 border font-display text-xs font-semibold tracking-[0.15em] uppercase disabled:opacity-50";

/**
 * - `primary`: the page's own action (refresh).
 * - `ghost`: a toggle or a secondary action; `pressed` lights it while on.
 * - `action`: the one that starts something (investigate). Glows, sits in a row.
 */
const VARIANT = {
  primary: "px-3.5 py-1.5 border-ultron-800 bg-ultron-500/5 text-ultron-300 hover:border-ultron-500 hover:bg-ultron-500/15",
  ghost: "px-3.5 py-1.5 border-ink-800 text-ink-400 hover:border-ultron-500 hover:text-ultron-300",
  action: "px-3 py-1 border-ultron-500 bg-ultron-500/12 text-ultron-300 shadow-[0_0_10px] shadow-ultron-500/30 hover:bg-ultron-500/25",
};
const PRESSED = "px-3.5 py-1.5 border-ultron-500 bg-ultron-500/10 text-ultron-300";

export function HudButton({
  variant = "primary",
  pressed,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; pressed?: boolean }) {
  const look = pressed ? PRESSED : VARIANT[variant];
  return <button type="button" aria-pressed={pressed} className={`${BASE} ${look} ${className}`} {...props} />;
}

export function RefreshButton({ onClick, refreshing }: { onClick: () => void; refreshing: boolean }) {
  return <HudButton onClick={onClick}>{refreshing ? "… refreshing" : "↻ refresh"}</HudButton>;
}

/** Tabs drawn as `[ LABEL 35 ]`; the brackets light up on the open one. */
export function BracketTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Which edges have tabs hidden past them: those fade out, a hint to swipe.
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const update = () =>
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [tabs.length]);
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent, black 1.5rem" : "black"}, ${edges.right ? "black calc(100% - 1.5rem), transparent" : "black"})`
      : undefined;

  // On a phone the strip scrolls sideways: keep the open tab in view, also when
  // a link or a reload lands on one past the edge. Only the strip moves, never the page.
  useEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const left = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    if (left < el.scrollLeft || left + tab.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: left - (el.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [value]);

  return (
    <div
      ref={strip}
      role="tablist"
      className="flex min-w-0 max-w-full gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1.5"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        const bracket = active ? "text-ultron-500" : "text-transparent";
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`flex shrink-0 items-baseline gap-1.5 px-2 py-2 font-display text-[13px] sm:py-1.5 font-semibold tracking-[0.12em] whitespace-nowrap uppercase sm:gap-2 sm:px-3 sm:tracking-[0.18em] ${
              active ? "bg-ultron-500/10 text-ultron-300" : "text-ink-500 hover:text-ink-300"
            }`}
          >
            <span aria-hidden className={bracket}>
              [
            </span>
            {tab.label}
            {tab.count !== undefined && <span className="font-mono text-[10px] tracking-normal text-ink-600">{tab.count}</span>}
            <span aria-hidden className={bracket}>
              ]
            </span>
          </button>
        );
      })}
    </div>
  );
}
