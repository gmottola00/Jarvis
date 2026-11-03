// Ultron's service worker: an app shell that opens without a blank screen,
// and the receiving end of Web Push.
//
// It never touches /api: answers, run streams (SSE) and approvals always come
// straight from the server.

const SHELL = "jarvis-shell-v1";
const ASSETS = "jarvis-assets-v1";
const MAX_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && (url.pathname.startsWith("/api/") || url.pathname === "/health")) return;

  // Pages: always try the network, so a deploy shows up on the next launch.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Hashed bundles never change under the same name.
  if (sameOrigin && url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Icons, splash screens, fonts: serve what we have, refresh in the background.
  if (sameOrigin || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") {
        cache.put(request, response.clone()).then(() => trim(cache));
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

// Every deploy adds new bundle names; drop the oldest ones.
async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
}

// Payload: {title, body?, url?, tag?}. iOS revokes the subscription of a page
// that receives a push without showing a notification, so one is always shown.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ultron", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

// Tapping a notification opens Ultron on the page it is about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // navigate() works only on a window this worker controls; any other one gets a new window.
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin && "navigate" in w);
      if (!open) return self.clients.openWindow(target);
      return open
        .focus()
        .then((w) => (w ?? open).navigate(target))
        .catch(() => self.clients.openWindow(target));
    }),
  );
});
