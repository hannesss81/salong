// Service Worker placeholder for Studio Salon
// Basic cache strategy: cache-first for static assets, network-first for pricing.json

const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const DYNAMIC_CACHE = `dynamic-${VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/pricing.json', // optional offline pricing snapshot
  '/assets/logo-placeholder.svg',
  '/assets/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![STATIC_CACHE, DYNAMIC_CACHE].includes(k)).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if(url.pathname === '/pricing.json') {
    // Network-first for pricing (fresh data), fallback to cache
    event.respondWith(
      fetch(request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for static
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(resp => {
      // Optionally cache new static resources
      if(resp.status === 200 && resp.headers.get('content-type')?.includes('text') ) {
        const copy = resp.clone();
        caches.open(STATIC_CACHE).then(c => c.put(request, copy));
      }
      return resp;
    }))
  );
});
