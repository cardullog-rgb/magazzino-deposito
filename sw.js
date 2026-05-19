// Strategia "network-first" — sempre tenta la rete, cache come fallback offline.
// Adatto durante lo sviluppo dell'app: ogni modifica arriva al prossimo reload.
const CACHE = 'magazzino-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/seed.js',
  './js/auth.js',
  './js/export.js',
  './js/reports.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Network-first: prova rete, cade su cache solo se la rete fallisce (offline).
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes('cdn.jsdelivr.net') || req.url.includes('fonts.googleapis.com') || req.url.includes('fonts.gstatic.com'))) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

// Permette al client di forzare lo skip waiting (utile in dev)
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
