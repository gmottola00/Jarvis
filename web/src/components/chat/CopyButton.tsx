import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `text`, and says so for a moment. */
export function CopyButton({ text, label = "copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard permission: nothing to do */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase transition-colors ${
        copied ? "text-emerald-300" : "text-ink-600 hover:text-ultron-300"
      } ${className}`}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "copied" : label}
    </button>
  );
}
