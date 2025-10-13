// Service Worker for Legacy Trails Tirol PWA - Performance Caching Only
const CACHE_NAME = 'legacy-trails-v2';
const urlsToCache = [
  './',
  './index.html',
  './css/leaflet_map.css',
  './css/leaflet.elevation-0.0.4.css',
  './css/L.Control.Locate.min.css',
  './javascript/trail_map.js',
  './javascript/leaflet.elevation-0.0.4.min.js',
  './javascript/leaflet.togpx.js',
  './javascript/leaflet.textpath.js',
  './javascript/L.Control.Locate.js',
  './javascript/kofi-overlay-widget.js',
  './my_trails_z.geojson',
  './manifest.json',
  './favicon/android-chrome-192x192.png',
  './favicon/android-chrome-512x512.png'
];

// Install event - cache static resources for faster loading
self.addEventListener('install', function(event) {
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

// Fetch event - serve cached resources when available, but always fetch map tiles fresh
self.addEventListener('fetch', function(event) {
  // Always fetch map tiles and external resources fresh
  if (event.request.url.includes('tile') || 
      event.request.url.includes('google.com') || 
      event.request.url.includes('opentopomap') ||
      event.request.url.includes('unpkg.com') ||
      event.request.url.includes('cdnjs.cloudflare.com') ||
      event.request.url.includes('ajax.googleapis.com') ||
      event.request.url.includes('maxcdn.bootstrapcdn.com') ||
      event.request.url.includes('kit.fontawesome.com')) {
    return fetch(event.request);
  }
  
  // For local resources, try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        return response || fetch(event.request);
      }
    )
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
