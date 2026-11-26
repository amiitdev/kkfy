// sw.js — KKfy's offline app shell.
//
// The player UI, styles and library index are served from a cache so the app
// opens instantly (and still opens with no signal).  Songs are deliberately
// NOT cached — they stream with HTTP Range, and a 500-song library would blow
// past any reasonable storage quota.  Covers are cached as they are seen.
//
// Bump CACHE whenever a cached file changes (app.js, app.css, index.html...).

const CACHE = "kkfy-v1";
const SHELL = [
  "/", "/index.html", "/app.js", "/app.css", "/icons.js",
  "/manifest.webmanifest", "/icon-192.png", "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()), // offline install: retry on first load
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Put a successful response into the cache without delaying the request. */
function cacheCopy(cacheName, request, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches.open(cacheName).then((c) => c.put(request, copy)).catch(() => {});
}

/** Network first, cached copy as fallback — used for everything that changes. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    cacheCopy(CACHE, request, res);
    return res;
  } catch {
    return (await cache.match(request)) || (await cache.match("/index.html")) || Response.error();
  }
}

/** Cache first, refresh in the background — used for cover art. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    cacheCopy(CACHE, request, res);
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // A page navigation: network first, but fall back to the cached app shell
  // so the UI still opens when there is no connection at all.
  if (req.mode === "navigate") return void event.respondWith(networkFirst(req));

  // The library changes when songs are added, so prefer the network.
  if (path === "/library.json") return void event.respondWith(networkFirst(req));

  // Covers are small and immutable — keep them local once seen.
  if (path.startsWith("/covers/") || path.startsWith("/api/cover/")) {
    return void event.respondWith(cacheFirst(req));
  }

  // Audio must never be intercepted: the browser needs the raw HTTP 206
  // Range responses for seeking, and the files are far too big to cache here.
  if (path.startsWith("/KK/") || path.startsWith("/api/stream/")) return;

  // App shell assets: network first so deploys show up immediately.
  if (path.startsWith("/api/")) return; // live state/stats from the local server
  event.respondWith(networkFirst(req));
});
