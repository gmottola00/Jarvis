/**
 * Web Push on this device: whether it can work, and switching it on and off.
 *
 * iOS rules that shape this file:
 * - push exists only for a site added to the Home Screen and opened from there
 *   (`display-mode: standalone`), iOS 16.4 or later;
 * - the permission prompt must come straight from a tap: `enablePush` asks
 *   first, before any other await, or Safari refuses silently.
 */

import { api } from "./api";

export type PushState =
  /** No service worker / PushManager: an old browser, or `vite dev`. */
  | "unsupported"
  /** iOS Safari in a tab: works only once added to the Home Screen. */
  | "needs-home-screen"
  /** The user said no; only the system settings can undo it. */
  | "denied"
  | "off"
  | "on";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-home-screen";
  if (!supported() || !(await registration())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) ? "on" : "off";
}

/** A name for this device in the hub's list, e.g. "iPhone · app". */
function label(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : "Computer";
  return `${device} · ${isStandalone() ? "app" : "browser"}`;
}

/** VAPID keys travel as base64url; `subscribe` wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Must be called from a click handler. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  // First await of the tap: Safari only shows the prompt for a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await navigator.serviceWorker.ready;
  const key = await api.pushKey();
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with another key (the hub's was rotated) is useless.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.putSubscription({ ...subscription.toJSON(), label: label() });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    // Hub first: if it fails the device stays subscribed and the user can retry.
    await api.deleteSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return "off";
}

/**
 * On launch: re-send this device's subscription (the PUT is idempotent), so the
 * hub follows if the browser rotated it. Silent: a failure here is retried next launch.
 */
export async function syncPush(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const subscription = await currentSubscription();
    if (subscription) await api.putSubscription({ ...subscription.toJSON(), label: label() });
  } catch {
    /* notifications off on the server, or offline */
  }
}

function sameKey(subscription: PushSubscription, key: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
