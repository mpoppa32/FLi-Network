// Corsair service worker — P13.123 (audit Finding 2.3).
//
// Problem: 3.4MB single-file HTML = 1.4-1.8s cold parse on every visit.
// Without a service worker, every page load re-downloads + re-parses the
// entire bundle. Reevo's lazy-loaded cloud chunks beat us on every load.
//
// Strategy:
//   - HTML: network-first, fall back to cache. So a new deploy propagates
//     the moment the new HTML is fetchable; an offline operator still
//     gets the last good cached version.
//   - Versioned JS modules (./js/corsair/main.js?v=P13.X): cache-first.
//     The ?v= query already invalidates per deploy — so once cached for
//     a given version, it's safe forever for that version.
//   - Third-party CDN resources (unpkg, cdnjs, jsdelivr, gstatic): NOT
//     cached by us. They have their own HTTP caching via Cache-Control;
//     the browser handles them. Avoiding adds complexity-without-payoff.
//
// Cache versioning: cache name embeds CACHE_VERSION. Each deploy bumps
// this constant alongside the HTML auth-build-tag + script ?v= + main.js
// buildTag, so the next visit gets a fresh cache and the old one is
// deleted on activate. Four-site bump per release.
//
// Scope: this file is at /FLi-Network/sw.js on GitHub Pages, so its
// scope is /FLi-Network/ — covering the deployed app.

'use strict';

var CACHE_VERSION = 'P13.290';
var CACHE_NAME    = 'corsair-' + CACHE_VERSION;
// Resources to pre-cache on install. Keep this small — just the
// load-bearing first-paint assets. Lazy-cache everything else as it's
// fetched.
var PRECACHE_URLS = [
  './FLiIntel.html',
  './js/corsair/main.js',
  './js/corsair/util.js',
  './js/corsair/state.js',
  './js/corsair/pipeline.js',
  './js/corsair/posture.js',
  './js/corsair/inspector.js',
  './js/corsair/cop.js',
  './js/corsair/rhythm.js',
  './js/corsair/brief.js',
  './js/corsair/theater.js',
  './js/corsair/table.js'
];

self.addEventListener('install', function(event) {
  // Take over from any previous SW immediately on activate.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // addAll is atomic — if any precache URL fails, the whole batch
      // rejects. Use individual put() so a single bad fetch doesn't
      // kill the install. Each module's failure is logged but not fatal.
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return fetch(url, { cache: 'no-cache' }).then(function(resp) {
          if (resp.ok) return cache.put(url, resp);
          console.warn('[SW ' + CACHE_VERSION + '] precache skip (non-ok):', url, resp.status);
        }).catch(function(err) {
          console.warn('[SW ' + CACHE_VERSION + '] precache skip (error):', url, err && err.message);
        });
      }));
    })
  );
});

self.addEventListener('activate', function(event) {
  // Claim open clients so this SW controls them immediately.
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Delete old cache versions. Keep only the current one.
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(name) {
          if (name.indexOf('corsair-') === 0 && name !== CACHE_NAME) {
            console.log('[SW ' + CACHE_VERSION + '] purging old cache:', name);
            return caches.delete(name);
          }
        }));
      })
    ])
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  // Only handle GET — every other method (POST writes to Firebase, etc.)
  // bypasses the SW.
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  // Bypass cross-origin requests — third-party CDNs handle their own
  // caching via HTTP Cache-Control. Trying to mediate them creates
  // versioning headaches.
  if (url.origin !== self.location.origin) return;

  // HTML documents: network-first so deploys propagate immediately,
  // fall back to cache on offline / failure.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req).then(function(resp) {
        // Update cache with the fresh HTML. Clone because the response
        // body is single-use.
        var copy = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        return resp;
      }).catch(function() {
        // Network failed — serve from cache.
        return caches.match(req).then(function(cached) {
          return cached || new Response('Offline — and no cached page available.', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
    return;
  }

  // Versioned JS modules (./js/corsair/*.js?v=P13.X): cache-first.
  // Once cached for a given ?v=, it's pinned to that content; the next
  // deploy bumps ?v= so the new content is fetched + cached separately.
  if (url.pathname.indexOf('/js/corsair/') === 0 ||
      url.pathname.indexOf('/FLi-Network/js/corsair/') === 0) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          // Only cache successful responses.
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // Everything else (CSS, images, fonts, etc.): stale-while-revalidate.
  // Return the cached copy immediately, fetch fresh in the background.
  event.respondWith(
    caches.match(req).then(function(cached) {
      var network = fetch(req).then(function(resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return resp;
      }).catch(function() { return cached; });
      return cached || network;
    })
  );
});
