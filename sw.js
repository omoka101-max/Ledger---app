const CACHE_NAME = 'ledger-v2'; // bump this string any time you want to force-clear old installed caches
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always try to fetch the latest version when online (so edits you push
// to GitHub show up the next time you open the app), falling back to the cached copy only
// when there's no connection. Cache-first would silently freeze the app on whatever version
// was installed first — wrong behavior for an app you're actively updating.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((res) => {
      const resClone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
