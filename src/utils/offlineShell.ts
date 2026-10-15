// KEEP WHAT THIS PAGE LOADED, SO THE NEXT LAUNCH WORKS OFFLINE.
//
// The service worker caches the app's code on demand — but only the requests
// that pass THROUGH it, and a page is not controlled by the worker that was
// installed during its own load (the worker deliberately never claims open
// pages, see public/sw.js). That page is the one that follows EVERY update: doUpdate()
// purges every cache and reloads. So after an update the cache held index.html
// and the icons but none of the hashed scripts index.html needs, and an offline
// launch stopped on « Chargement… » until a launch WITH network had refetched
// them under control. Reproduced in Chromium against a no-store server.
//
// Once a worker is active, this hands it the same-origin files this page has
// loaded; the worker's CACHE_URLS handler stores the ones it does not hold.
// Harmless on every other launch: what is already cached is skipped there.

/** The same-origin, query-free, non-HTML resources among `names`. Pure. */
export function shellUrls(names: readonly string[], origin: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (u.origin !== origin || u.search || u.hash) continue;
    const p = String(u.pathname).toLowerCase();
    if (p.endsWith("/") || p.endsWith(".html")) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
  }
  return out;
}

/** Ask the active worker to keep what this page loaded. Never throws. */
export function primeOfflineShell(win: Window & typeof globalThis = window): void {
  try {
    const sw = win.navigator && win.navigator.serviceWorker;
    if (!sw || !win.performance || typeof win.performance.getEntriesByType !== "function") return;
    sw.ready.then((reg) => {
      const names = win.performance.getEntriesByType("resource").map((e) => e.name);
      const urls = shellUrls(names, win.location.origin);
      if (urls.length && reg.active) reg.active.postMessage({ type: "CACHE_URLS", urls });
    }).catch(() => { /* no worker, nothing to keep */ });
  } catch { /* never let this break a launch */ }
}
