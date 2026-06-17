// Minimal pass-through service worker.
// Exists ONLY to satisfy Android Chrome's installability requirement
// (a fetch handler must be present). Does NOT cache anything — every
// request goes straight to the network so the POS never serves stale
// HTML, JS, or API responses.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through. No caching. The handler must exist for installability,
  // but we deliberately do nothing custom with the response.
  event.respondWith(fetch(event.request));
});
