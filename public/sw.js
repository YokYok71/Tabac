var CACHE_NAME = 'cave-tabac-v1-0-1';
var CORE_URLS = [
  './',
  './index.html',
  './reset.html',
  './help.html',
  './changelog.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './privacy.html'
];
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_URLS.map(function(u){return new Request(u,{cache:'reload'});}));
    })
  );
});

self.addEventListener('message', function(event) {
  // Verify the message origin before honouring it.
  // SW message events from a client of this scope normally arrive with
  // event.source set to the Client and event.origin set to the page's
  // origin. Without this gate, a cross-origin script that somehow
  // obtained the SW registration handle could force a SKIP_WAITING
  // (premature update mid-session). CSP already blocks third-party
  // scripts, but defense in depth keeps the SW honest if the CSP is
  // ever relaxed. Locked by CodeQL js/missing-origin-check.
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
          .map(function(n) { return caches.delete(n); })
      );
    })
  );
});

// Domains we never want to cache (AI providers, OAuth, Google APIs,
// CORS proxies). CodeQL flagged the previous indexOf-on-URL check
// (js/incomplete-url-substring-sanitization) because a URL like
// https://evil.com/?x=api.anthropic.com would match. Switch to a
// proper URL parse + hostname equality / suffix test. The risk was
// theoretical here (a match only skips the cache layer — no privilege
// granted) but the proper form is also clearer.
var BYPASS_HOSTS = [
  'api.anthropic.com',
  'api.github.com',
  'api.openai.com',
  'corsproxy.io',
  'allorigins.win',
  'accounts.google.com',
  'googleapis.com',
  'gstatic.com',
  'dropboxapi.com',
  'dropbox.com',
  // Session-location reverse geocoding. Each request carries
  // unique coords, so caching only bloats the store with never-reused
  // entries — and location queries shouldn't sit in the cache anyway.
  'nominatim.openstreetmap.org',
];
function shouldBypass(rawUrl) {
  var u;
  try { u = new URL(rawUrl); } catch (_e) { return false; }
  var host = u.hostname;
  for (var i = 0; i < BYPASS_HOSTS.length; i++) {
    var h = BYPASS_HOSTS[i];
    if (host === h || host.endsWith('.' + h)) return true;
  }
  return false;
}

// Is this URL one of the app's HTML documents? Used to give
// them network-first treatment whether they are reached by a browser
// navigation or by the in-app views' plain fetch() — see the fetch handler.
function isHtmlDoc(rawUrl) {
  var u;
  try { u = new URL(rawUrl); } catch (_e) { return false; }
  if (u.origin !== self.location.origin) return false;
  var path = u.pathname;
  return path === '/' || path.charAt(path.length - 1) === '/' ||
         path.slice(-5).toLowerCase() === '.html';
}

self.addEventListener('fetch', function(event) {
  if (event.request.url.indexOf('?_v=') >= 0) return;
  if (shouldBypass(event.request.url)) return;
  if (event.request.cache === 'no-store') return;

  // HTML pages: network-first so the user always gets the latest version.
  // Falls back to the cached copy of the same page, then to index.html, then
  // to a 503.
  //
  // TWO defects here, and the second contradicted a rule
  // this repo states and follows.
  //
  // (a) A fetch that receives a 500 RESOLVES; it does not reject. So the
  //     .catch below never ran on a server error, and the raw 5xx was handed
  //     to the user — the browser's error page — while a perfectly good
  //     cached copy of the very same document sat one line away, unused. A
  //     GitHub Pages hiccup or a half-finished deploy therefore broke an app
  //     that is otherwise fully offline-capable. 4xx deliberately still
  //     passes through: a genuine 404 means the page is gone, and masking it
  //     with a stale copy would hide a deploy that dropped a file.
  //
  // (b) The branch keyed on `mode === 'navigate'`, which is true only for a
  //     browser NAVIGATION. The in-app doc views (DocPageView, HelpView) read
  //     these same files with a plain `fetch("./help.html")`, which is not a
  //     navigation — so they fell through to the cache-first branch below and
  //     were served the copy captured at SW install, indefinitely. CLAUDE.md
  //     states the opposite ("help.html, changelog.html, privacy.html are all
  //     served network-first ... there is NO need to change sw.js when these
  //     files change") and draws a WORKFLOW rule from it ("documentation-only
  //     changes do NOT require bumping APP_BUILD"). That rule was false for
  //     the surface where users actually read the docs. Keying on the URL
  //     being an HTML document instead of on the request mode makes the
  //     documented behaviour the real one.
  if (event.request.mode === 'navigate' || isHtmlDoc(event.request.url)) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          return response;
        }
        if (response.status >= 500) {
          return caches.match(event.request).then(function(cached) {
            return cached || response;
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(r) {
          if (r) return r;
          return caches.match('./index.html').then(function(r2) {
            return r2 || new Response('Offline', {status: 503, headers: {'Content-Type': 'text/plain'}});
          });
        });
      })
    );
    return;
  }

  // All other requests: cache-first
  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) return response;
      return fetch(event.request).then(function(fetchResponse) {
        if (fetchResponse && fetchResponse.status === 200 && event.request.method === 'GET') {
          var responseClone = fetchResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return fetchResponse;
      }).catch(function() {
        if (event.request.destination === 'document') {
          return caches.match('./index.html').then(function(r) {
            return r || new Response('Offline', {status: 503, headers: {'Content-Type': 'text/plain'}});
          });
        }
        return new Response('', {status: 503, statusText: 'Offline'});
      });
    })
  );
});
