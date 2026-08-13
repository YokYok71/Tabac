/**
 * Shared IndexedDB image cache + URL-safety helpers (isSafeExternalUrl /
 * safeBgUrl). No React, no state — safe to import anywhere. (The network
 * `dlImg` fetcher was removed — the app is local-photos-only.)
 */

/**
 * THE `imgLocal` MAP, built without a prototype.
 *
 * `imgLocal` maps a photo KEY to its base64, and those keys are `imageUrl`
 * values — user data, which an imported backup controls. Held in a plain
 * object, `imgLocal["__proto__"]` resolves to `Object.prototype`: a truthy
 * non-string that defeats the ubiquitous `(imgLocal && imgLocal[k]) || k`
 * fallback at all 18 render sites. That is the exact class
 * `tabac-local/no-dynamic-index-plain-map` exists for; the rule could not see
 * this one because the map is React state, not a module-level `const`.
 *
 * Every rebuild must go through here — there are NINE sites (the initial
 * state, four updaters in App.tsx, one in useImportConfirm, and one in each of
 * the three form views) and `Object.assign({}, prev, …)` at any of them throws
 * the prototype straight back on. A comment asking nine call sites to stay in
 * step is not a mechanism, so `imgMapIsSafe.test.ts` asserts none of them
 * rebuilds it with a bare `{}`.
 *
 * Note this is DEFENCE IN DEPTH, not the crash fix: `safeBgUrl` being total is
 * what stops the brick, and it holds even if a caller hands it a plain map.
 * This stops a prototype member ever leaving the lookup in the first place.
 */
export function imgMap(...sources: any[]): Record<string, any> {
  return Object.assign(Object.create(null), ...sources);
}

/**
 * Returns true only for safe external HTTP(S) URLs.
 * Rejects: non-http(s) protocols, localhost, ::1, RFC-1918 ranges,
 * link-local (169.254.x.x), and hostnames with no dot (internal names).
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    var u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    var h = String(u.hostname).toLowerCase();
    if (h === "localhost" || h === "::1") return false;
    if (!h.includes(".")) return false;
    // Reject hex- / octal-encoded IP-literal obfuscations that the
    // browser normalises back to loopback/private (e.g. 0x7f.0.0.1,
    // 0177.0.0.1 → 127.0.0.1). Any label that is a 0x-hex or a leading-zero
    // octal number is an IP-literal attempt, never a real public DNS label.
    var labels = h.split(".");
    for (var li = 0; li < labels.length; li++) {
      var lab = labels[li] as string;
      if (/^0x[0-9a-f]+$/.test(lab)) return false;   // hex label
      if (/^0[0-9]+$/.test(lab)) return false;       // leading-zero octal label
    }
    // Match IPv4 directly or embedded in IPv6 (e.g. ::ffff:192.168.1.1)
    var oct = h.match(/(?:^|:)(\d+)\.(\d+)\.(\d+)\.\d+$/);
    if (oct) {
      var a = Number(oct[1]), b = Number(oct[2]);
      if (a === 0) return false;                     // 0.0.0.0 → routes to loopback
      if (a === 10) return false;
      if (a === 127) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false;
    }
    return true;
  } catch { return false; }
}

// Build a `url(...)` CSS value safe for inline `background: ...` interpolation.
// Returns an empty string for any URL that fails validation (the caller can
// then fall back to a gradient/icon). Prevents CSS injection through paths
// that contain unescaped quotes, parens or whitespace.
//
// THE ARGUMENT IS COERCED, and this is a security fix, not
// defensive noise. The 18 render sites all resolve their photo as
// `(imgLocal && imgLocal[x.imageUrl]) || x.imageUrl`, so the argument's type is
// decided by DATA that can come from an imported backup. A forged
// `imageUrl: "__proto__"` made that lookup return `Object.prototype` — a
// truthy NON-STRING — and the `url.indexOf("blob:")` below threw
// `TypeError: url.indexOf is not a function`. Because `save()` runs BEFORE the
// render, the poisoned row was already on disk, and neither recovery path
// clears localStorage (`EB.purgeCachesAndReload` and `public/reset.html` both
// stop at service workers and Cache Storage) — so one imported file bricked
// the app on every launch, for ever, with the user's own cellar stranded.
// `String()` here turns that into a missing photo. This function must stay
// TOTAL: it is the single choke point all 18 sites funnel through, which is
// what makes the guarantee hold even for a caller that hands it a plain map.
export function safeBgUrl(raw: unknown): string {
  if (!raw) return "";
  const url = String(raw);
  // Allow IndexedDB data-URLs and blob URLs as-is (no remote fetch, no risk).
  if (/^data:image\/(jpeg|jpg|png|webp|gif);/.test(url)) {
    return `url("${String(url).replace(/"/g, "")}")`;
  }
  if (url.indexOf("blob:") === 0) {
    return `url("${String(url).replace(/"/g, "")}")`;
  }
  // Remote URLs must be plain http(s) without CSS metacharacters.
  if (!isSafeExternalUrl(url)) return "";
  if (/["'()\\;\n\r\t]/.test(url)) return "";
  return `url("${encodeURI(url)}")`;
}

// An `imageUrl` has exactly TWO legitimate shapes now that the app is
// local-photos-only, so this is an ALLOWLIST and MUST STAY ONE:
//
//   • a `local-photo-*` IndexedDB key (the normal case)
//   • a `data:image/<allowed>;` URI (the quota fallback, where the
//     blob could not be written and is carried inline)
//
// Anything else is a legacy row or a forged file. `migrateData` has blanked
// `^https?://` for a long time — but that anchor let a PROTOCOL-RELATIVE
// `//evil.com/x.png` and a `data:image/svg+xml` straight through, and while
// all 38 background sites route through `safeBgUrl` (which correctly returns
// "" for both), the form's photo PREVIEW is a bare `<img src>`. Opening the
// edit form of an imported item therefore fired a request to the attacker's
// host — IP, User-Agent, and confirmation that the file was imported — which
// is a tracking beacon inside a shared backup and contradicts
// `public/privacy.html` verbatim (« Photos (locales uniquement) … ne
// transitent par aucun service tiers »). Not code execution: an `<img>`
// cannot run SVG script.
//
// The narrow fix is the allowlist rather than blanking one more scheme,
// because enumerating what is BAD is the losing side of this: `data:` and the
// protocol-relative form were already two misses from one anchor.
//
// It is applied at BOTH ends on purpose — `migrateData` so nothing poisoned
// is ever stored, and `safeImgSrc` at the one sink `safeBgUrl` does not cover
// — sharing this predicate so the two cannot drift.
export function isLocalPhotoRef(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  if (raw.indexOf("local-photo-") === 0) return true;
  return /^data:image\/(jpeg|jpg|png|webp|gif);/.test(raw);
}

// The `<img src>` counterpart of `safeBgUrl`. A `local-photo-*` key that did
// not resolve is passed through deliberately: as a src it is a RELATIVE URL to
// our own origin, so the worst case is a 404 on this server — no external
// request — and that is the pre-existing behaviour for an evicted photo.
export function safeImgSrc(raw: unknown): string {
  return isLocalPhotoRef(raw) ? String(raw) : "";
}

export var imgCache = {
  db: null as IDBDatabase | null,
  open: function () {
    return new Promise(function (ok, no) {
      if (imgCache.db) {
        ok(imgCache.db);
        return;
      }
      // Environment guard (jsdom in tests has no indexedDB).
      if (typeof indexedDB === "undefined") {
        no(new Error("indexedDB not available"));
        return;
      }
      var r = indexedDB.open("cave-imgs", 1);
      r.onupgradeneeded = function (e) {
        (e.target as IDBOpenDBRequest).result.createObjectStore("i");
      };
      r.onsuccess = function (e) {
        imgCache.db = (e.target as IDBOpenDBRequest).result;
        ok(imgCache.db);
      };
      r.onerror = function () {
        no();
      };
    });
  },
  put: function (k: string, v: any) {
    return imgCache.open().then(function (db: any) {
      return new Promise(function (ok) {
        var t = db.transaction("i", "readwrite");
        t.objectStore("i").put(v, k);
        t.oncomplete = function () {
          ok(true);
        };
        t.onerror = function () {
          ok(false);
        };
        // A QuotaExceededError aborts the transaction; depending on
        // the engine that surfaces as `abort` rather than (or as well as)
        // `error`. Resolve false on abort too so the promise can't hang and the
        // caller's write-failure fallback fires. Promise resolve is idempotent,
        // so a double onerror+onabort is harmless.
        t.onabort = function () {
          ok(false);
        };
      });
    });
  },
  get: function (k: string) {
    return imgCache.open().then(function (db: any) {
      return new Promise(function (ok) {
        var t = db.transaction("i", "readonly");
        var r = t.objectStore("i").get(k);
        r.onsuccess = function () {
          ok(r.result || null);
        };
        r.onerror = function () {
          ok(null);
        };
      });
    });
  },
  // Wipe the IndexedDB store. Called by resetAll so a full
  // factory reset doesn't leak orphan photos in the cache.
  clear: function () {
    return imgCache.open().then(function (db: any) {
      return new Promise(function (ok) {
        var t = db.transaction("i", "readwrite");
        var r = t.objectStore("i").clear();
        r.onsuccess = function () { ok(true); };
        r.onerror = function () { ok(false); };
      });
    });
  },
  // List all keys in the store. Used by the orphan
  // garbage-collector to compare with the set of imageUrls actually
  // referenced by entities. Resolves with [] on any failure / no DB.
  keys: function (): Promise<string[]> {
    return imgCache.open().then(function (db: any) {
      return new Promise<string[]>(function (ok) {
        var t = db.transaction("i", "readonly");
        var r = t.objectStore("i").getAllKeys();
        r.onsuccess = function () { ok((r.result || []) as string[]); };
        r.onerror = function () { ok([]); };
      });
    }).catch(function () { return [] as string[]; });
  },
  // Delete a single key. Used by gcOrphans below; resolves
  // with `true` on success, `false` otherwise (best-effort, never throws).
  del: function (k: string) {
    return imgCache.open().then(function (db: any) {
      return new Promise(function (ok) {
        var t = db.transaction("i", "readwrite");
        var r = t.objectStore("i").delete(k);
        r.onsuccess = function () { ok(true); };
        r.onerror = function () { ok(false); };
      });
    }).catch(function () { return false; });
  },
};

// Orphan-photo garbage collector.
//
// Walks every key in `imgCache` and deletes any `local-photo-*` whose
// id isn't present in `referenced`. Two safety guards prevent killing
// photos that are mid-flight:
//   1. Only `local-photo-*` keys are inspected — URL cache entries
//      (keyed by full http(s) URL) are NEVER touched.
//   2. The key format is `local-photo-{Date.now()-at-creation}`. We
//      skip keys whose timestamp is less than 5 minutes old, so a
//      photo that the user just attached in a form but hasn't saved
//      yet survives a reload that happens during that window.
//
// Returns the number of deleted keys (resolves to 0 when IndexedDB is
// unavailable or no orphans were found).
export function gcOrphans(referenced: Set<string>): Promise<number> {
  return imgCache.keys().then(function (keys) {
    var fiveMinutesMs = 5 * 60 * 1000;
    var now = Date.now();
    var deletions: Promise<unknown>[] = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (typeof k !== "string") continue;
      if (k.indexOf("local-photo-") !== 0) continue;
      if (referenced.has(k)) continue;
      var m = String(k).match(/^local-photo-(\d+)/);
      if (m && m[1]) {
        var ts = parseInt(m[1]);
        if (isFinite(ts) && now - ts < fiveMinutesMs) continue;
      }
      deletions.push(imgCache.del(k));
    }
    return Promise.all(deletions).then(function () { return deletions.length; });
  });
}
