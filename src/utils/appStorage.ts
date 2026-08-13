// Promise-based localStorage wrapper extracted verbatim from
// App.tsx (module-level, App-state-free). Used by App.tsx's save() path.
// Each op resolves rather than throwing on a storage failure (private mode,
// quota, disabled storage) except set(), which rejects so the caller's
// QuotaExceeded migration path can fire.
export var appStorage = {
  get: function (k: string) {
    return new Promise<{ key: string; value: string } | null>(function (r) {
      try {
        var v = localStorage.getItem(k);
        r(v ? { key: k, value: v } : null);
      } catch (_e) {
        r(null);
      }
    });
  },
  set: function (k: string, v: string) {
    return new Promise<{ key: string; value: string }>(function (r, fail) {
      try {
        localStorage.setItem(k, v);
        r({ key: k, value: v });
      } catch (e) {
        fail(e);
      }
    });
  },
  delete: function (k: string) {
    return new Promise<{ key: string; deleted: boolean } | null>(function (r) {
      try {
        localStorage.removeItem(k);
        r({ key: k, deleted: true });
      } catch (_e) {
        r(null);
      }
    });
  },
};

// Synchronous localStorage helpers for the many plain
// preference reads/writes that don't need the promise form. Each swallows
// storage failures (private mode, disabled storage) so callers can drop the
// repetitive try/catch boilerplate. `lsGet` returns `fallback` (default null)
// on a miss or error. **Scope: NON-sensitive preference keys only.** OAuth
// tokens, CSRF state and the read-before-clear flows keep their dedicated
// helpers (tkGet/tkSet, hint*, dbx*) and their ESLint-guarded invariants —
// do NOT route those through here.
export function lsGet(key: string, fallback: string | null = null): string | null {
  try {
    var v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (_e) {
    return fallback;
  }
}
export function lsSet(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch (_e) { return false; }
}
export function lsRemove(key: string): void {
  try { localStorage.removeItem(key); } catch (_e) { /* storage disabled — ignore */ }
}

// ── The factory reset, and why it SWEEPS where the export
// ── ALLOWLISTS ──────────────────────────────────────────────────────────────
// `resetAll` wiped the cellar and the photo store and left every credential
// behind: the long-lived `dropbox-rt` (a refresh token that renews for ever),
// `gdrive-tk`, the three AI API keys, and `gdrive-account-hint` — which is an
// e-mail address. That was tolerable while the app had one user; it is a
// mislabel for a public one, where "Effacer toutes les données" is what
// someone taps before handing the phone on or before a support screenshot.
//
// THE DIRECTION IS THE OPPOSITE OF `appSettings.SETTINGS_KEYS`, and the reason
// is worth stating because the two rules look contradictory. That list is an
// ALLOWLIST because it governs what LEAVES the device: a key missed there ends
// up in a file the user mails to themselves, so the safe failure is to omit.
// A reset governs what STAYS: a key missed HERE is a credential left on a
// phone that was meant to be wiped, so the safe failure is to over-delete —
// and over-deleting costs nothing, since everything in these namespaces is
// being reset anyway. An allowlist here would rot silently in the dangerous
// direction, which is precisely the bug it would be written to fix.
//
// Both storages: `gdrive-tk` lives in sessionStorage on every platform except
// iOS standalone, and `cave-drive-expired-dismissed` is sessionStorage-only.
const APP_KEY_PREFIXES = ["cave-", "gdrive-", "dropbox-", "pipe-cellar-", "ai-"];
const APP_KEY_SUFFIXES = ["-api-key"];

/** True when a storage key belongs to this app. Pure — the reset's decision. */
export function isAppOwnedKey(key: string): boolean {
  var k = String(key || "");
  if (!k) return false;
  for (var i = 0; i < APP_KEY_PREFIXES.length; i++) {
    if (k.indexOf(APP_KEY_PREFIXES[i]!) === 0) return true;
  }
  for (var j = 0; j < APP_KEY_SUFFIXES.length; j++) {
    var suf = APP_KEY_SUFFIXES[j]!;
    if (k.length > suf.length && k.slice(-suf.length) === suf) return true;
  }
  return false;
}

/**
 * Remove every app-owned key from local AND session storage.
 * Returns how many were removed (0 when storage is unavailable).
 *
 * Keys are COLLECTED before any removal: `Storage.key(i)` re-indexes as the
 * store shrinks, so removing inside the loop skips every other entry.
 */
export function wipeAppStorage(): number {
  var n = 0;
  var stores: Storage[] = [];
  try { if (typeof localStorage !== "undefined") stores.push(localStorage); } catch (_e) { /* blocked */ }
  try { if (typeof sessionStorage !== "undefined") stores.push(sessionStorage); } catch (_e) { /* blocked */ }
  for (var s = 0; s < stores.length; s++) {
    var store = stores[s]!;
    var doomed: string[] = [];
    try {
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k && isAppOwnedKey(k)) doomed.push(k);
      }
    } catch (_e) { continue; }
    for (var d = 0; d < doomed.length; d++) {
      try { store.removeItem(doomed[d]!); n++; } catch (_e) { /* keep going */ }
    }
  }
  return n;
}
