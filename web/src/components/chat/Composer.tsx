import { CornerDownLeft, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Composer({
  onSend,
  busy,
  disabled,
  placeholder,
  accessory,
  draft,
}: {
  onSend: (message: string) => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Rendered next to Send - the model picker. */
  accessory?: ReactNode;
  /** Text to put back in the box, e.g. a message the user declined to send. */
  draft?: { text: string };
}) {
  const [value, setValue] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    requestAnimationFrame(() => {
      if (!area.current) return;
      grow(area.current);
      area.current.focus();
    });
  }, [draft]);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
    if (area.current) area.current.style.height = "auto";
  }

  return (
    <div className="px-3 pt-2 pb-2 sm:px-6 sm:pb-3 md:pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="mx-auto max-w-4xl">
        <div className="relative border border-ink-800 bg-ink-900/90 backdrop-blur transition-shadow focus-within:border-ultron-600 focus-within:shadow-[0_0_24px_-6px_var(--color-ultron-500)]">
          <span className="absolute -top-px -left-px size-2.5 border-t-2 border-l-2 border-ultron-500" aria-hidden />
          <span className="absolute -right-px -bottom-px size-2.5 border-r-2 border-b-2 border-ultron-500" aria-hidden />
          <textarea
            ref={area}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder ?? "Ask about the lab, or tell me to deploy something…"}
            onChange={(event) => {
              setValue(event.target.value);
              grow(event.target);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-ink-700 disabled:opacity-50"
          />
          <div className="flex min-w-0 items-center gap-2 px-2.5 pb-2.5">
            {accessory}
            <span className="hidden font-mono text-[10px] text-ink-700 sm:ml-auto sm:inline">⏎ send · ⇧⏎ newline</span>
            <button
              type="button"
              onClick={submit}
              aria-label="Send"
              disabled={busy || disabled || !value.trim()}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 bg-ultron-600 px-3 py-1.5 font-display text-xs font-bold tracking-[0.2em] text-white uppercase transition hover:bg-ultron-500 hover:shadow-[0_0_14px_var(--color-ultron-500)] disabled:bg-ink-850 disabled:text-ink-600 disabled:shadow-none"
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CornerDownLeft className="size-3.5" />}
              send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
