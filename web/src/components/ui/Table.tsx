import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Tailwind classes for both the header and the cells of this column. */
  className?: string;
}

/**
 * A `kubectl get`-shaped table: mono, dense, one object per row. Rows are
 * clickable when `onRowClick` is given, and tinted by `rowTone` so the broken
 * ones are visible before you read a word.
 */
export function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowTone,
  empty = "Nothing here.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowTone?: (row: T) => Tone;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <p className="px-4 py-3 text-xs text-ink-600">{empty}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink-850">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-2 font-mono text-[10px] font-normal tracking-wider whitespace-nowrap text-ink-600 uppercase ${column.className ?? ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rowTone?.(row);
            const tint = tone === "bad" ? "bg-rose-500/[0.04]" : tone === "warn" ? "bg-amber-500/[0.03]" : "";
            return (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-ink-850/60 last:border-0 ${tint} ${
                  onRowClick ? "cursor-pointer hover:bg-ink-850/40" : ""
                }`}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-2 align-top font-mono text-[11px] whitespace-nowrap text-ink-400 ${column.className ?? ""}`}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
