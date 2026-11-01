/**
 * Registers the service worker (public/sw.js) once the page has loaded.
 *
 * Only in production builds: in `vite dev` a worker would serve stale bundles
 * and fight with hot reload.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.warn("Service worker not registered", err);
    });
  });
}
