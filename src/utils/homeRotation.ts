// homeRotation.ts — per-launch rotation seed for the Home suggestions.
//
// The Home "Ce soir ?" hero + secondary list and the "du moment" featured
// picks rotate on a 12 h time bucket (FEATURE_ROTATE_MS). That is deterministic
// WITHIN a bucket by design (stable across re-renders / navigation), but it
// means reopening or reloading the app inside the same 12 h window shows the
// identical picks — so the rotation looks frozen to anyone checking on demand.
//
// This adds a second, on-demand axis: a counter bumped ONCE per app launch
// (page load). Added to the rotation `now` as a whole number of buckets, it
// steps every rotation forward by one each time the app is opened/reloaded,
// while the time bucket keeps them moving on their own over the day. It stays
// constant across in-session navigation because the value is memoised for the
// lifetime of the JS context (a fresh page load re-evaluates the module → new
// value; navigating Home→elsewhere→Home does NOT, since the view module is
// already loaded and HomeViewV2 never unmounts).
//
// Persisted in localStorage["cave-sugg-rot"] so the advance carries across
// launches (otherwise every cold start would reset to the same offset).

import { lsSet } from "./appStorage.ts";

var _seed: number | null = null;

/** localStorage key holding the persisted per-launch rotation counter. */
export var HOME_ROT_KEY = "cave-sugg-rot";

/**
 * The rotation offset for THIS app launch — a non-negative integer, bumped by
 * one (and persisted) the first time it's read per JS context, then memoised.
 * Pure after the first call within a load. Never throws (storage failures
 * degrade to a 0-based, non-persisted advance).
 */
export function homeRotationSeed(): number {
  if (_seed !== null) return _seed;
  var n = 0;
  try {
    var raw = localStorage.getItem(HOME_ROT_KEY);
    n = raw === null ? 0 : parseInt(raw, 10);
  } catch (_e) { /* storage unavailable */ }
  if (!Number.isFinite(n) || n < 0) n = 0;
  // Wrap well below Number.MAX_SAFE_INTEGER so `seed * bucketMs` can never lose
  // precision; a million launches is plenty of spread for the modulo pick.
  n = (n + 1) % 1000000;
  lsSet(HOME_ROT_KEY, String(n));
  _seed = n;
  return n;
}

/** Test-only: forget the memoised seed so the next call re-reads storage. */
export function _resetHomeRotationForTests(): void {
  _seed = null;
}
