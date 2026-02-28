/* Play Nine PWA service worker – versioned cache, auto-update on deploy */

const VERSION_API = '/play9/api/version';
const CACHE_PREFIX = 'play9-static-';

let cacheVersion = null;

async function getVersion() {
  const res = await fetch(VERSION_API, { cache: 'no-store' });
  const data = await res.json();
  return data.version || '1';
}

async function openCache() {
  if (!cacheVersion) cacheVersion = await getVersion();
  return caches.open(CACHE_PREFIX + cacheVersion);
}

function isStaticAsset(url) {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/play9/static/') && u.pathname !== '/play9/static/sw.js';
  } catch {
    return false;
  }
}

function shouldNetworkOnly(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/play9/sw.js' || u.pathname === '/play9/api/version';
  } catch {
    return false;
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (shouldNetworkOnly(url)) {
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/play9/') || caches.match(request))
    );
    return;
  }

  if (!isStaticAsset(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await openCache();
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && res.type === 'basic') cache.put(request, res.clone());
        return res;
      } catch (err) {
        return cached || new Response('', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
