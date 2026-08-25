const CACHE = 'sublimilou-v50';
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .catch(() => {}),
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const PASS_THROUGH = (e) => {
  /* laisser le navigateur gérer normalement */
};

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return PASS_THROUGH(e);

  let url;
  try {
    url = new URL(e.request.url);
  } catch {
    return PASS_THROUGH(e);
  }

  if (url.pathname.startsWith('/api') || url.pathname.includes('netlify/functions')) {
    return PASS_THROUGH(e);
  }
  if (e.request.mode === 'navigate') return PASS_THROUGH(e);
  if (url.origin !== self.location.origin) return PASS_THROUGH(e);

  e.respondWith(
    (async () => {
      try {
        const cached = await caches.match(e.request);
        if (cached) {
          fetch(e.request)
            .then((res) => {
              if (res?.ok) {
                caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
              }
            })
            .catch(() => {});
          return cached;
        }

        const res = await fetch(e.request);
        if (res?.ok) {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
        }
        return res;
      } catch (err) {
        const fallback = await caches.match(e.request);
        if (fallback) return fallback;
        return new Response('Hors-ligne', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
