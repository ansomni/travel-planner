const VERSION = 'trip-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/tabs.js', 'js/trip-session.js',
  'icons/user.svg', 'icons/out.svg', 'icons/settings.svg', 'icons/icon-192.png'
];
const RUNTIME_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net'];
const IMAGE_CACHE = 'trip-images';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key !== IMAGE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('index.html');
    throw error;
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone());
    const keys = await cache.keys();
    if (keys.length > maxEntries) await cache.delete(keys[0]);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'firebasestorage.googleapis.com' && request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 120));
  } else if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, VERSION, 60));
  }
});
