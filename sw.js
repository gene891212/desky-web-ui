"use strict";

const CACHE_NAME = "smartdesk-shell-v2";

const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

// CDN hosts used for fonts/framework/icons — safe to cache-and-refresh so the
// app shell can still render offline after the first successful load.
const RUNTIME_CACHE_HOSTS = new Set([
  "cdn.tailwindcss.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "unpkg.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;

  const isSameOrigin = url.origin === self.location.origin;
  const isWhitelistedCdn = RUNTIME_CACHE_HOSTS.has(url.hostname);

  // Never intercept calls to the desk itself (SSE stream, button/switch/number
  // REST endpoints) — those must always go straight to the network.
  if (!isSameOrigin && !isWhitelistedCdn) return;

  if (isSameOrigin) {
    // Network-first for our own app shell: this app controls physical
    // hardware, so a shipped fix must show up on next load whenever the
    // device is online. Cache is only a fallback for offline use.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first (stale-while-revalidate) for the rarely-changing CDN assets
  // (fonts/Tailwind/Lucide) — fast load, refreshed in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
