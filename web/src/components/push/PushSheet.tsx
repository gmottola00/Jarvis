import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { disablePush, enablePush, pushState, type PushState } from "../../lib/push";
import { HudButton } from "../hud/controls";
import { Drawer } from "../ui/Drawer";

const TEXT: Record<PushState | "server-off", string> = {
  "server-off": "Notifications are not configured on this Jarvis (JARVIS_NOTIFY_URL and NOTIFY_TOKEN).",
  unsupported: "This browser cannot receive push notifications.",
  "needs-home-screen":
    "On iPhone, notifications only reach the app added to the Home Screen: tap Share, then “Add to Home Screen”, and open Ultron from there.",
  denied: "Notifications are blocked. Turn them back on in Settings › Notifications › Ultron.",
  off: "Jarvis tells you here when a run stops to wait for your approval, so a merge or a restart is never stuck waiting for you.",
  on: "Notifications are on for this device.",
};

/** Notifications for this device: explains what is possible, and switches them on and off. */
export function PushSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<PushState | "server-off" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    void (async () => {
      const caps = await api.capabilities().catch(() => null);
      setState(caps && !caps.notify ? "server-off" : await pushState());
    })();
  }, [open]);

  const run = async (action: () => Promise<PushState | void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      if (next) setState(next);
      if (done) setMessage(done);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    run(async () => {
      const { sent } = await api.testPush();
      setMessage(sent > 0 ? "Sent: it should arrive in a moment." : "No device reached.");
    });

  return (
    <Drawer open={open} onClose={onClose} eyebrow="notifications" title={state === "on" ? "On" : "Alerts on this device"}>
      <div className="space-y-4 px-4 sm:px-5 py-4 text-sm text-ink-300">
        <p>{state === null ? "One moment…" : TEXT[state]}</p>
        {message && <p className="font-mono text-xs text-ultron-300">{message}</p>}
        <div className="flex flex-wrap gap-2">
          {state === "off" && (
            // enablePush asks for permission first thing: it must run inside this tap.
            <HudButton disabled={busy} onClick={() => void run(enablePush, "Done.")}>
              turn on
            </HudButton>
          )}
          {state === "on" && (
            <>
              <HudButton disabled={busy} onClick={() => void test()}>
                send a test
              </HudButton>
              <HudButton variant="ghost" disabled={busy} onClick={() => void run(disablePush)}>
                turn off
              </HudButton>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
