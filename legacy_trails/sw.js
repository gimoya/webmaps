// Service Worker for Legacy Trails Tirol PWA - Performance Caching with Tile Cache Limit
const CACHE_NAME = 'legacy-trails-v30';
const TILE_CACHE_NAME = 'legacy-trails-tiles';
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
const TILE_EVICTION_DELAY_MS = 3000;

const urlsToCache = [
  './',
  './index.html',
  './css/leaflet_map.css',
  './css/leaflet.elevation-0.0.4.css',
  './css/L.Control.Locate.min.css',
  './javascript/trail_map.js',
  './javascript/legacy_trail_photos.js',
  './css/legacy_trail_photos.css',
  './data/trail_photos.geojson',
  './javascript/page_loader_lottie.js',
  './javascript/leaflet.elevation-0.0.4.min.js',
  './javascript/leaflet.togpx.js',
  './javascript/leaflet.textpath.js',
  './javascript/L.Control.Locate.js',
  './javascript/kofi-overlay-widget.js',
  './data/my_trails_z.geojson',
  './data/Loading Circle With Dots.json',
  './data/manifest.json',
  './favicon/android-chrome-192x192.png',
  './favicon/android-chrome-512x512.png'
];

let tileEvictionTimer = null;

// Install event - cache static resources for faster loading
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Caching static resources for faster loading');
        return cache.addAll(urlsToCache).catch(function(error) {
          console.error('Failed to cache some resources:', error);
          return Promise.all(urlsToCache.map(function(url) {
            return cache.add(url).catch(function(err) {
              console.error('Failed to cache:', url, err);
              return null;
            });
          }));
        });
      })
  );
});

function scheduleTileEviction() {
  if (tileEvictionTimer) {
    return;
  }
  tileEvictionTimer = setTimeout(function() {
    tileEvictionTimer = null;
    evictOldTiles().catch(function(err) {
      console.error('Tile cache eviction failed:', err);
    });
  }, TILE_EVICTION_DELAY_MS);
}

// Evict oldest tiles when cache exceeds limit (LRU strategy)
async function evictOldTiles() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();

  if (keys.length === 0) {
    return;
  }

  const entries = await Promise.all(keys.map(async function(request) {
    const response = await cache.match(request);
    const blob = await response.blob();
    const timestamp = response.headers.get('sw-cache-time') || 0;
    return { request: request, size: blob.size, timestamp: parseInt(timestamp, 10) };
  }));

  entries.sort(function(a, b) {
    return a.timestamp - b.timestamp;
  });

  let currentSize = entries.reduce(function(sum, entry) {
    return sum + entry.size;
  }, 0);

  for (var i = 0; i < entries.length; i++) {
    if (currentSize <= MAX_CACHE_SIZE * 0.9) {
      break;
    }
    await cache.delete(entries[i].request);
    currentSize -= entries[i].size;
  }
}

function cacheTileResponse(cache, request, response) {
  if (!response || !response.ok) {
    return;
  }
  var headers = new Headers(response.headers);
  headers.set('sw-cache-time', Date.now().toString());
  response.clone().arrayBuffer().then(function(body) {
    var stored = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });
    return cache.put(request, stored);
  }).then(function() {
    scheduleTileEviction();
  }).catch(function(err) {
    console.error('Failed to cache tile:', err);
  });
}

function handleTileRequest(request) {
  return caches.open(TILE_CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function(response) {
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
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) {
        return cached;
      }
      return cache.match(request, { ignoreSearch: true });
    }).then(function(cached) {
      if (cached) {
        return cached;
      }
      var path = new URL(request.url).pathname;
      if (request.mode === 'navigate' || /\/index\.html$/.test(path) || path.endsWith('/')) {
        return cache.match('./index.html').then(function(page) {
          return page || cache.match('./');
        });
      }
      return null;
    });
  });
}

function networkFirst(request, cacheName) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(cacheName).then(function(cache) {
        cache.put(request, copy);
      });
    }
    return response;
  }).catch(function() {
    return cacheFallback(request, cacheName);
  });
}

function isMapTile(url) {
  return url.includes('tile') ||
    url.includes('google.com/vt') ||
    url.includes('opentopomap') ||
    url.includes('openmaps.fr') ||
    url.includes('openstreetmap.org') ||
    url.includes('maptiler.com') ||
    /\/(\d+)\/(\d+)\/(\d+)/.test(url);
}

self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  if (isMapTile(url)) {
    event.respondWith(
      handleTileRequest(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  if (url.includes('unpkg.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('ajax.googleapis.com') ||
    url.includes('maxcdn.bootstrapcdn.com') ||
    url.includes('kit.fontawesome.com')) {
    return;
  }

  if (isLocalAppUrl(url)) {
    event.respondWith(networkFirst(event.request, CACHE_NAME));
  }
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});
