import { Brain, ChevronRight } from "lucide-react";
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
        className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-ink-600 uppercase hover:text-ink-300"
      >
        <Brain className={`size-3.5 ${live ? "animate-dot text-ultron-400" : ""}`} />
        <span className={live ? "animate-dot" : ""}>{live ? "thinking…" : "reasoning"}</span>
        <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <p className="mt-1.5 border-l border-dashed border-ultron-800 py-0.5 pl-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-600">
          {text}
        </p>
      )}
    </div>
  );
}
