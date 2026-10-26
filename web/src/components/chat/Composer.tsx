import { useRef, useState } from "react";

export function Composer({
  onSend,
  busy,
  disabled,
  placeholder,
}: {
  onSend: (message: string) => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
    if (area.current) area.current.style.height = "auto";
  }

  return (
    <div className="border-t border-ink-850 bg-ink-950 px-5 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-ink-800 bg-ink-900 px-3 py-2 focus-within:border-ink-600">
        <textarea
          ref={area}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Ask about the lab, or tell me to deploy something…"}
          onChange={(event) => {
            setValue(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-44 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-ink-800 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || disabled || !value.trim()}
          className="rounded-lg bg-ink-200 px-3 py-1.5 text-xs font-medium text-ink-950 disabled:bg-ink-800 disabled:text-ink-600"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
