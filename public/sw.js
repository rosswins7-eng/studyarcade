// StudyArcade service worker — app shell cached for offline/installable PWA.
// v2: network-first for HTML/JS/CSS (users were stuck on stale JS after
// deploys), and /api/ requests are NEVER intercepted — returning cached HTML
// for a failed API call broke auth/me parsing and made users look signed out.
const CACHE = 'studyarcade-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg',
               '/games/quiz.html', '/games/asteroid.html', '/games/match.html'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API requests at all: no caching, no HTML fallback.
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  const isShell = e.request.mode === 'navigate' || url.pathname === '/' ||
    /\.(?:html|js|css)$/.test(url.pathname);
  if (isShell) {
    // Network-first: fresh code wins; cache is only an offline fallback.
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html'))));
    return;
  }
  // Other static assets: cache-first.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match('/index.html'))));
});
