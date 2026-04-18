// Service worker — network-first for the app shell, cache as offline fallback.
// Network-first means: every reload pulls fresh code from GitHub Pages, but if
// you're offline it serves the last cached version.

var CACHE = 'tide-shell-v3';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/styles.css',
  './js/cache.js',
  './js/spots.js',
  './js/tides.js',
  './js/wind-swell.js',
  './js/surfline.js',
  './js/buoy.js',
  './js/scoring.js',
  './js/wetsuit.js',
  './js/describe.js',
  './js/renderer.js',
  './js/app.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; })
        .map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // App shell: network-first, fall back to cache if offline.
  if (SHELL.some(function(p) { return url.indexOf(p.replace('./', '')) !== -1; })) {
    e.respondWith(
      fetch(e.request)
        .then(function(resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
          }
          return resp;
        })
        .catch(function() { return caches.match(e.request); })
    );
  }
});
