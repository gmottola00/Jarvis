import type { Tone } from "../../lib/console/derive";
import type { AppDelivery, DeliveryStatus } from "../../lib/console/types";

export const STATUS_TONE: Record<DeliveryStatus, Tone> = {
  "in-sync": "ok",
  behind: "warn",
  "rolling-out": "info",
  drifted: "bad",
  unknown: "idle",
};

/** ArgoCD's two axes: *sync* (does the cluster match Git?) and *health* (is what runs working?). */
export function argoTone(app: Pick<AppDelivery, "sync" | "health">): Tone {
  if (app.health === "Degraded" || app.health === "Missing") return "bad";
  if (app.sync !== "Synced" || app.health === "Progressing") return "warn";
  return app.health === "Healthy" ? "ok" : "idle";
}
