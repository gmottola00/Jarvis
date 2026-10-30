import { ChevronDown, Cpu, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCatalog, ModelOption } from "../../lib/types";

/**
 * Which model answers the next message. Claude and local models are grouped,
 * each with a status light. A local model whose GPU machine is off stays
 * pickable: sending to it asks before the fallback answers.
 *
 * Always shown, even with a single model or before the catalog arrives, so the
 * user always sees which model the next message goes to.
 */
export function ModelPicker({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: ModelCatalog | null;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!catalog) {
    return (
      <span className="flex items-center gap-1.5 border border-ink-850 px-2 py-1 font-mono text-[11px] text-ink-600">
        <Sparkles className="size-3 animate-dot" />
        loading models…
      </span>
    );
  }

  const claude = catalog.models.filter((m) => m.provider === "anthropic");
  const local = catalog.models.filter((m) => m.provider === "local");
  const picked = catalog.models.find((m) => m.id === value);
  const offline = picked?.provider === "local" && !picked.available;

  const option = (m: ModelOption) => (
    <button
      key={m.id}
      type="button"
      role="option"
      aria-selected={m.id === value}
      onClick={() => {
        onChange(m.id);
        setOpen(false);
      }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] ${
        m.id === value ? "bg-ultron-500/15 text-ultron-300" : "text-ink-400 hover:bg-ink-850 hover:text-ink-200"
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${m.available ? "bg-emerald-400" : "bg-ultron-500"}`} />
      <span className="truncate">{m.provider === "local" ? m.id.replace(/^local\//, "") : m.id}</span>
      {!m.available && <span className="ml-auto text-[9px] text-ultron-400 uppercase">offline</span>}
    </button>
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={offline ? `GPU offline: sending will ask before ${catalog.fallback} answers` : value}
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[14rem] items-center gap-1.5 border px-2 py-1 font-mono text-[11px] disabled:opacity-50 ${
          offline ? "border-ultron-700 text-ultron-300" : "border-ink-800 text-ink-400 hover:border-ink-700 hover:text-ink-200"
        }`}
      >
        {picked?.provider === "local" ? <Cpu className="size-3 shrink-0" /> : <Sparkles className="size-3 shrink-0" />}
        <span className="truncate">{picked?.provider === "local" ? value.replace(/^local\//, "") : value}</span>
        {offline && <span className="size-1.5 shrink-0 animate-dot rounded-full bg-ultron-500" />}
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 w-64 border border-ink-800 bg-ink-950 py-1 shadow-2xl shadow-black/60"
        >
          <p className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 font-mono text-[9px] tracking-widest text-ink-600 uppercase">
            <Sparkles className="size-3" /> Claude
          </p>
          {claude.map(option)}
          {local.length > 0 && (
            <>
              <p className="mt-1 flex items-center gap-1.5 border-t border-ink-850 px-3 pt-2 pb-1 font-mono text-[9px] tracking-widest text-ink-600 uppercase">
                <Cpu className="size-3" /> Local · GPU
              </p>
              {local.map(option)}
            </>
          )}
          {catalog.models.length < 2 && (
            <p className="mt-1 border-t border-ink-850 px-3 pt-2 pb-1.5 text-[10px] leading-snug text-ink-600">
              Only the default model is available. Set <span className="font-mono">JARVIS_LLM_GATEWAY_URL</span> to pick
              other Claude models or the local GPU ones.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
