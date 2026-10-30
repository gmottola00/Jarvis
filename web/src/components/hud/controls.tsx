import type { ButtonHTMLAttributes } from "react";

const BASE = "border font-display text-xs font-semibold tracking-[0.15em] uppercase disabled:opacity-50";

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
  return (
    <div role="tablist" className="flex gap-1.5 overflow-x-auto">
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
            className={`flex shrink-0 items-baseline gap-2 px-3 py-1.5 font-display text-[13px] font-semibold tracking-[0.18em] whitespace-nowrap uppercase ${
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
