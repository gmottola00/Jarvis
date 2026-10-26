import { useState } from "react";

/** Collapsed by default: the reasoning is available, not imposed. */
export function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-ink-600 hover:text-ink-400"
      >
        <span className={live ? "animate-dot" : ""}>{live ? "thinking…" : "thought"}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <p className="mt-1.5 border-l-2 border-ink-800 py-0.5 pl-3 text-xs whitespace-pre-wrap text-ink-600">{text}</p>
      )}
    </div>
  );
}
