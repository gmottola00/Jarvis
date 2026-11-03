import type { ReactNode } from "react";
import type { Tone } from "../../lib/console/derive";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Tailwind classes for both the header and the cells of this column (table only). */
  className?: string;
  /**
   * Where the column goes on a phone, where each row is a card: `title` heads
   * the card, `status` sits on its right, `meta` is a labelled fact under it
   * (the default), `hide` is left out.
   */
  card?: "title" | "status" | "meta" | "hide";
}

/**
 * A `kubectl get`-shaped table: mono, dense, one object per row. Rows are
 * clickable when `onRowClick` is given, and tinted by `rowTone` so the broken
 * ones are visible before you read a word. Below md a nine-column table only
 * scrolls sideways, so each row becomes a card instead (see `Column.card`).
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

  const title = columns.filter((c) => c.card === "title");
  const status = columns.filter((c) => c.card === "status");
  const meta = columns.filter((c) => (c.card ?? "meta") === "meta");

  return (
    <>
      <ul className="divide-y divide-ink-850/60 md:hidden">
        {rows.map((row) => {
          const tone = rowTone?.(row);
          const tint = tone === "bad" ? "bg-rose-500/[0.05]" : tone === "warn" ? "bg-amber-500/[0.04]" : "";
          const body = (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere] text-ink-200">
                  {title.map((column) => (
                    <div key={column.key}>{column.cell(row)}</div>
                  ))}
                </div>
                {status.map((column) => (
                  <div key={column.key} className="shrink-0">
                    {column.cell(row)}
                  </div>
                ))}
              </div>
              {meta.length > 0 && (
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-400">
                  {meta.map((column) => (
                    <div key={column.key} className="flex min-w-0 items-baseline gap-1.5">
                      <dt className="text-[10px] tracking-wider text-ink-600 uppercase">{column.header}</dt>
                      <dd className="min-w-0 [overflow-wrap:anywhere]">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          return (
            <li key={rowKey(row)} className={tint}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="block w-full px-4 py-3 text-left transition-colors active:bg-ink-850/60"
                >
                  {body}
                </button>
              ) : (
                <div className="px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
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
                  className={`border-b border-ink-850/60 last:border-0 ${tint} ${onRowClick ? "cursor-pointer hover:bg-ink-850/40" : ""}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-2 align-top font-mono text-[11px] whitespace-nowrap text-ink-400 ${column.className ?? ""}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
