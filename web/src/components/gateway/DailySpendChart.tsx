import { useState } from "react";
import type { DailySpend } from "../../lib/console/types";
import { HudPanel, Quiet } from "../hud";
import { useMediaQuery } from "../../lib/hooks/useMediaQuery";
import { usd } from "./format";

/**
 * Categorical slots, dark steps, in the validated order (dataviz reference
 * palette; checked against the ink-900 surface: CVD ΔE ≥ 8.4, contrast ≥ 3:1).
 * A ninth app folds into "other" rather than getting a generated hue.
 */
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER = "#6b6461";

const HEIGHT = 168;
const PAD = { top: 10, right: 8, bottom: 22, left: 44 };
const BAR_GAP = 0.36;
/** Surface gap between stacked segments, so adjacent colours never touch. */
const SEGMENT_GAP = 2;

interface Day {
  day: string;
  total: number;
  parts: { alias: string; spend: number }[];
}

/** Colour follows the app, never its rank: slots go to aliases in a fixed (alphabetical) order. */
function colourOf(aliases: string[]): (alias: string) => string {
  const ordered = [...aliases].sort();
  return (alias) => {
    const index = ordered.indexOf(alias);
    return index >= 0 && index < SLOTS.length ? SLOTS[index] : OTHER;
  };
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((v) => v >= value) ?? value;
}

function shortDay(iso: string): string {
  const at = new Date(`${iso}T00:00:00`);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString([], { weekday: "short", day: "numeric" });
}

/** Spend per day, stacked by app, over the last week. */
/** The tooltip sits right of a bar on the left half and left of it on the right half, never past the panel. */
function tooltipAt(percent: number) {
  return percent > 50 ? { right: `${100 - percent}%` } : { left: `${percent}%` };
}

export function DailySpendChart({ daily, aliases }: { daily: DailySpend[]; aliases: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const narrow = useMediaQuery("(max-width: 767px)");
  const colour = colourOf(aliases);

  const byDay = new Map<string, Day>();
  for (const row of daily) {
    const day = byDay.get(row.day) ?? { day: row.day, total: 0, parts: [] };
    day.total += row.spend;
    if (row.spend > 0) day.parts.push({ alias: row.alias, spend: row.spend });
    byDay.set(row.day, day);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const present = [...new Set(daily.filter((d) => d.spend > 0).map((d) => d.alias))].sort();

  if (!days.length || days.every((d) => d.total === 0)) {
    return (
      <HudPanel title="Daily spend" note="last 7 days">
        <Quiet>Nothing spent in the last week. Local models cost nothing.</Quiet>
      </HudPanel>
    );
  }

  // On a phone the chart is drawn narrower, so the axis text keeps its size
  // instead of shrinking with the viewBox.
  const width = narrow ? 320 : 480;
  const max = niceMax(Math.max(...days.map((d) => d.total)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = slot * (1 - BAR_GAP);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = hover === null ? null : days[hover];

  return (
    <HudPanel title="Daily spend" note="last 7 days · stacked by app">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="w-full" role="img" aria-label="Spend per day, stacked by app">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-ink-850" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-ink-600 font-mono text-[9px]">
                {usd(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            let top = y(0);
            const segments = d.parts
              .sort((a, b) => a.alias.localeCompare(b.alias))
              .map((p, index, all) => {
                const h = (p.spend / max) * plotH;
                const gap = index < all.length - 1 ? SEGMENT_GAP : 0;
                top -= h;
                const isTop = index === all.length - 1;
                return (
                  <rect
                    key={p.alias}
                    x={x}
                    y={top + gap / 2}
                    width={barW}
                    height={Math.max(0, h - gap)}
                    rx={isTop ? Math.min(4, barW / 2) : 0}
                    fill={colour(p.alias)}
                  />
                );
              });
            return (
              <g
                key={d.day}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover((current) => (current === i ? null : i))}
              >
                {/* Hit target: the whole column, taller and wider than the bar. */}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {segments}
                <text x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-ink-600 font-mono text-[9px]">
                  {shortDay(d.day)}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-36 border border-ink-800 bg-ink-950/95 px-3 py-2 font-mono text-[11px] shadow-lg"
            style={tooltipAt(((PAD.left + (hover + 0.5) * slot) / width) * 100)}
          >
            <p className="mb-1 text-ink-300">
              {shortDay(hovered.day)} · {usd(hovered.total)}
            </p>
            {hovered.parts.map((p) => (
              <p key={p.alias} className="flex items-center gap-2 text-ink-400">
                <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: colour(p.alias) }} />
                {p.alias}
                <span className="ml-auto text-ink-300">{usd(p.spend)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {present.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-400" aria-label="Legend">
          {present.map((alias) => (
            <li key={alias} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: colour(alias) }} />
              {alias}
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <caption>Spend per day and app</caption>
        <thead>
          <tr>
            <th>day</th>
            <th>app</th>
            <th>spend</th>
          </tr>
        </thead>
        <tbody>
          {days.flatMap((d) =>
            d.parts.map((p) => (
              <tr key={`${d.day}-${p.alias}`}>
                <td>{d.day}</td>
                <td>{p.alias}</td>
                <td>{usd(p.spend)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </HudPanel>
  );
}
