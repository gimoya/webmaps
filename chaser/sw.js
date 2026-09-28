const CACHE_NAME = "chaser-v7";
const TILE_CACHE_NAME = "chaser-tiles";
const MAX_CACHE_SIZE = 50 * 1024 * 1024;
const TILE_EVICTION_DELAY_MS = 3000;

const urlsToCache = [
  "./",
  "./index.html",
  "./styles.css",
  "./track-grade.js",
  "./gpx.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

let tileEvictionTimer = null;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

function scheduleTileEviction() {
  if (tileEvictionTimer) return;
  tileEvictionTimer = setTimeout(() => {
    tileEvictionTimer = null;
    evictOldTiles();
  }, TILE_EVICTION_DELAY_MS);
}

async function evictOldTiles() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();
  if (!keys.length) return;

  const entries = await Promise.all(keys.map(async (request) => {
    const response = await cache.match(request);
    const blob = await response.blob();
    const cachedAt = Number(response.headers.get("sw-cache-time")) || 0;
    return { request, size: blob.size, cachedAt };
  }));

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= MAX_CACHE_SIZE) return;

  entries.sort((a, b) => a.cachedAt - b.cachedAt);
  for (const entry of entries) {
    if (total <= MAX_CACHE_SIZE) break;
    await cache.delete(entry.request);
    total -= entry.size;
  }
}

function cacheTileResponse(cache, request, response) {
  if (!response || !response.ok) return;
  const headers = new Headers(response.headers);
  headers.set("sw-cache-time", Date.now().toString());
  response.clone().arrayBuffer().then((body) => {
    const stored = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    return cache.put(request, stored);
  }).then(() => {
    scheduleTileEviction();
  });
}

function handleTileRequest(request) {
  return caches.open(TILE_CACHE_NAME).then((cache) => {
    return cache.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        cacheTileResponse(cache, request, response);
        return response;
      });
    });
  });
}

function isLocalAppUrl(url) {
  try {
    return new URL(url).origin === self.location.origin && !isMapTile(url);
  } catch (e) {
    return false;
  }
}

function cacheFallback(request, cacheName) {
  return caches.open(cacheName).then((cache) => {
    return cache.match(request).then((cached) => {
      if (cached) return cached;
      return cache.match(request, { ignoreSearch: true });
    }).then((cached) => {
      if (cached) return cached;
      const path = new URL(request.url).pathname;
      if (request.mode === "navigate" || /\/index\.html$/.test(path) || path.endsWith("/")) {
        return cache.match("./index.html").then((page) => page || cache.match("./"));
      }
      return null;
    });
  });
}

function networkFirst(request, cacheName) {
  return fetch(request, { cache: "no-cache" }).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(cacheName).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => cacheFallback(request, cacheName));
}

function isMapTile(url) {
  return url.includes("tile") ||
    url.includes("tracestrack.com") ||
    url.includes("openstreetmap.org") ||
    /\/(\d+)\/(\d+)\/(\d+)/.test(url);
}

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (isMapTile(url)) {
    event.respondWith(handleTileRequest(event.request));
    return;
  }

  if (isLocalAppUrl(url)) {
    event.respondWith(networkFirst(event.request, CACHE_NAME));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(cacheNames.map((cacheName) => {
        if (cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME) {
          return caches.delete(cacheName);
        }
        return null;
      }));
    }).then(() => self.clients.claim())
  );
});
