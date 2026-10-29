/**
 * MKJ Chess — Service Worker
 * -----------------------------------------------------------------------------
 * Caches the application shell so the game keeps working with no network at
 * all. The cache is versioned; activating a new version swaps the file list
 * and deletes stale caches.
 *
 * Strategy:
 *   - Navigation requests: network-first, falling back to the cache so an
 *     offline launch still opens the app shell.
 *   - Static assets: cache-first, falling back to the network and recording
 *     any newly fetched file in the cache.
 *
 * Note: a service worker only registers when the app is served over http(s).
 * Opening index.html directly with file:// does not get offline PWA support;
 * see README.md for the supported launch methods.
 */

const CACHE_VERSION = 'mkj-chess-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

/** Everything needed to run the game with no network. */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './script.js',
  './sw.js',
  './icon-192.svg',
  './icon-512.svg',
  './icon-maskable-512.svg',
  './src/app.js',
  './src/board.js',
  './src/clock.js',
  './src/chess-engine.js',
  './src/chess-rules.js',
  './src/game.js',
  './src/mate-search.js',
  './src/puzzles.js',
  './src/sound.js',
  './src/storage.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('MKJ Chess: service worker shell precache failed:', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const cache = isNavigation ? SHELL_CACHE : ASSET_CACHE;

  if (isNavigation) {
    // Network first, so an updated shell is picked up when online; the cache
    // is what makes the app open offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cache).then((c) => c.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: cache first, then network (recording what we fetch).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || !response.ok) return response;
          const copy = response.clone();
          caches.open(cache).then((c) => c.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
    }),
  );
});
