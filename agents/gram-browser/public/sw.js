const CACHE = 'gram-v6';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll([
        '/static/main.' + (self.__WB_MANIFEST ? '' : ''),
      ].filter(Boolean)).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        const cloned = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, cloned).catch(() => {})));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((response) => {
            if (response.ok) event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
            return response;
          }).catch(() => cached);
          return cached || networkFetch;
        });
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, cloned).catch(() => {})));
        }
        return response;
      });
    })
  );
});
