import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A right-hand sheet for drilling into one object. Esc or the backdrop closes
 * it; the page underneath keeps polling, so closing lands you on fresh data.
 */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  aside,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portalled to <body>, so a drawer opened from deep inside a page's content
  // still covers the whole viewport whatever its ancestors do.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/70 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-ink-850 bg-ink-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
      >
        {/* On a phone the aside (status, links) drops under the title instead of squeezing it. */}
        <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-ink-850 px-4 py-3 sm:flex-nowrap sm:px-5">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="mb-1 font-mono text-[10px] text-ink-600">{eyebrow}</div>}
            <h2 className="truncate font-mono text-sm text-ink-200">{title}</h2>
          </div>
          {aside && <div className="order-last w-full sm:order-none sm:w-auto">{aside}</div>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1.5 font-mono text-[11px] text-ink-500 hover:bg-ink-850 hover:text-ink-200 sm:mr-0 sm:px-2 sm:py-1 sm:text-ink-600"
          >
            <X className="size-5 sm:hidden" />
            <span className="hidden sm:inline">esc</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
