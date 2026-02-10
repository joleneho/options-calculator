const CACHE_NAME = "options-calc-v5"; // <- bump this anytime you want to force refresh

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ Network-first for page navigations (index.html)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((fresh) => {
          const copy = fresh.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return fresh;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // ✅ Cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
