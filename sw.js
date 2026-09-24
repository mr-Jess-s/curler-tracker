const CACHE = 'curler-tracker-v26-4';
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css?v=v26.4',
  './app.js?v=v26.4',
  './manifest.webmanifest?v=v26.4',
  './noble-beaver.svg',
  './noble-beaver-icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_ASSETS)).catch(() => Promise.resolve())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isLocalAsset = requestUrl.origin === self.location.origin;

  if (isLocalAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      return response;
    } catch {
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
