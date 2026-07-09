// Service Worker for Legacy Trails Tirol PWA - Performance Caching with Tile Cache Limit
const CACHE_NAME = 'legacy-trails-v4';
const TILE_CACHE_NAME = 'legacy-trails-tiles';
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB in bytes

const urlsToCache = [
  './',
  './index.html',
  './css/leaflet_map.css',
  './css/leaflet.elevation-0.0.4.css',
  './css/L.Control.Locate.min.css',
  './javascript/trail_map.js',
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

// Install event - cache static resources for faster loading
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Caching static resources for faster loading');
        return cache.addAll(urlsToCache).catch(function(error) {
          console.error('Failed to cache some resources:', error);
          // Cache resources individually to identify which ones fail
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

// Calculate cache size
async function getCacheSize(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  let totalSize = 0;
  
  for (const key of keys) {
    const response = await cache.match(key);
    if (response) {
      const blob = await response.blob();
      totalSize += blob.size;
    }
  }
  
  return totalSize;
}

// Evict oldest tiles when cache exceeds limit (LRU strategy)
async function evictOldTiles() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();
  
  if (keys.length === 0) return;
  
  // Get all requests with their timestamps (stored in response headers)
  const entries = await Promise.all(keys.map(async (request) => {
    const response = await cache.match(request);
    const blob = await response.blob();
    const timestamp = response.headers.get('sw-cache-time') || 0;
    return { request, size: blob.size, timestamp: parseInt(timestamp) };
  }));
  
  // Sort by timestamp (oldest first)
  entries.sort((a, b) => a.timestamp - b.timestamp);
  
  // Calculate current size
  let currentSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  
  // Remove oldest entries until under limit
  for (const entry of entries) {
    if (currentSize <= MAX_CACHE_SIZE * 0.9) break; // Keep 10% buffer
    
    await cache.delete(entry.request);
    currentSize -= entry.size;
    console.log('Evicted tile from cache:', entry.request.url);
  }
}

function isLocalAppUrl(url) {
  try {
    return new URL(url).origin === self.location.origin && !isMapTile(url);
  } catch (e) {
    return false;
  }
}

// Network-first: fresh after deploy when online; cache fallback for offline use.
function cacheFallback(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return cache.match(request, { ignoreSearch: true });
    }).then(function(cached) {
      if (cached) return cached;
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

// Check if URL is a map tile
function isMapTile(url) {
  return url.includes('tile') || 
         url.includes('google.com/vt') || 
         url.includes('opentopomap') ||
         url.includes('openmaps.fr') ||
         url.includes('maptiler.com/maps') ||
         url.includes('/{z}/') ||
         /\/(\d+)\/(\d+)\/(\d+)/.test(url); // Matches tile coordinate pattern
}

// Fetch event - cache tiles with size limit, serve static resources from cache
self.addEventListener('fetch', function(event) {
  const url = event.request.url;
  
  // Handle map tiles with caching and size limit
  if (isMapTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async function(cache) {
        // Try cache first
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Fetch from network
        try {
          const response = await fetch(event.request);
          
          if (response.ok) {
            const body = await response.clone().arrayBuffer();
            const responseSize = body.byteLength;

            const headers = new Headers(response.headers);
            headers.set('sw-cache-time', Date.now().toString());
            const modifiedResponse = new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });

            const currentSize = await getCacheSize(TILE_CACHE_NAME);

            if (currentSize + responseSize <= MAX_CACHE_SIZE) {
              await cache.put(event.request, modifiedResponse);
            } else {
              await evictOldTiles();
              const newSize = await getCacheSize(TILE_CACHE_NAME);
              if (newSize + responseSize <= MAX_CACHE_SIZE) {
                await cache.put(event.request, modifiedResponse);
              }
            }
          }

          return response;
        } catch (error) {
          console.error('Failed to fetch tile:', error);
          throw error;
        }
      })
    );
    return;
  }
  
  // For external CDN resources, always fetch fresh
  if (url.includes('unpkg.com') || 
      url.includes('cdnjs.cloudflare.com') || 
      url.includes('ajax.googleapis.com') || 
      url.includes('maxcdn.bootstrapcdn.com') || 
      url.includes('kit.fontawesome.com')) {
    return fetch(event.request);
  }
  
  // Local app files: network-first so repo updates reach all users when online
  if (isLocalAppUrl(url)) {
    event.respondWith(networkFirst(event.request, CACHE_NAME));
    return;
  }
});

// Activate event - clean up old caches and claim all clients immediately
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
