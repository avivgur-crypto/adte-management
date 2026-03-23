/// <reference lib="webworker" />
// @ts-nocheck

const CACHE_NAME = "adte-v1";

// ---------------------------------------------------------------------------
// Lifecycle — install + activate with immediate takeover
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        "/",
        "/manifest.json",
        "/favicon.png",
        "/icon-192.png",
        "/icon-512.png",
        "/apple-touch-icon.png",
      ])
    )
  );
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
});

// ---------------------------------------------------------------------------
// Fetch strategies
// ---------------------------------------------------------------------------

/** Network-first with timeout: try network, fall back to cache if slow/offline. */
async function networkFirst(request, timeoutMs = 3000) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok || response.type === "opaqueredirect") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

/** Cache-first: serve from cache, fetch in background to refresh. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Stale-while-revalidate: serve cached immediately, refresh in background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || networkPromise;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // API routes: always network, never cache
  if (url.pathname.startsWith("/api/")) return;

  // _next/static — immutable, content-hashed → cache-first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // _next/data (ISR JSON payloads) — stale-while-revalidate
  if (url.pathname.startsWith("/_next/data/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Navigation requests (HTML pages) — network-first with 3s timeout
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, 3000));
    return;
  }

  // Everything else (fonts, images, CSS, JS chunks) — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});
