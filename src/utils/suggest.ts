// suggest.ts — "Que fumer ce soir ?" pure suggestion engine.
//
// Picks up to 3 candidate tobaccos from the live inventory, scored by
// signals the app already tracks — no new data entry:
//   - aging urgency  (lotAgingStatus: overaged > approaching)
//   - nearly-empty jars (finish the open pot before it goes stale)
//   - recency        (not smoked for a while > smoked yesterday)
//   - personal rating (favourites float up)
// Also suggests the most-rested active pipe (rotation.ts synergy) to
// pair with tonight's bowl.
//
// Everything is pure: `now` is an explicit argument, inputs are the
// plain arrays from liveData, outputs are id + reason codes that the
// HomeView maps to i18n strings. Reason codes are ordered by
// importance — the UI renders the first 1-2.

import { lotAgingStatus, effectiveAgingMax, parseLocalDate } from "../utils.ts";
import { computePipeRest } from "./rotation.ts";
import { safeNonNeg } from "./stats.ts";

export type SuggestionReason =
  | "aging_overaged"
  | "aging_approaching"
  | "lot_low"
  | "never_smoked"
  | "not_recent"
  | "favorite";

export interface SmokeSuggestion {
  tobaccoId: string;
  score: number;
  reasons: SuggestionReason[];
  /** Days since the tobacco was last smoked; null = never. */
  daysSinceSmoked: number | null;
}

export interface SuggestOptions {
  now?: number;
  max?: number;
  /** "Nearly empty" jar threshold in the user's display unit
   *  (10 for grams, ~0.35 for oz). */
  lowLotThreshold?: number;
  /**
   * Restrict eligibility to tobaccos with an OPEN jar lot
   * (status "jar", weight > 0). Cellar-only (sealed) tobaccos are excluded.
   * Powers the Home "Ce soir ?" random draw over "tout ce qui est ouvert".
   */
  openOnly?: boolean;
  /**
   * Skip the personal-rating contribution entirely — no rating
   * score, no "favorite" reason. Per user request the Home picks must not be
   * biased by rating.
   */
  ignoreRating?: boolean;
}

const DAY_MS = 86400000;
// The "Tabac du moment" / "Pipe du moment" tie-rotation bucket.
// The user asked the featured tobacco + pipe to alternate every 12 h instead
// of once a calendar day, so a tie-group cycles twice as often.
export var FEATURE_ROTATE_MS = 12 * 3600 * 1000;
// Recency saturates at 6 months — beyond that, "longer ago" doesn't
// make a tobacco more urgent.
const RECENCY_CAP_DAYS = 180;
// A tobacco only counts as "not smoked recently" past this gap.
const NOT_RECENT_DAYS = 30;

function lastSessionDateByTobacco(
  sessions: any[] | null | undefined,
): Record<string, string> {
  var map: Record<string, string> = Object.create(null);
  (sessions || []).forEach(function (s: any) {
    if (!s || !s.tobaccoId || typeof s.date !== "string" || !s.date) return;
    if (isNaN(new Date(s.date).getTime())) return;
    var k = String(s.tobaccoId);
    var prev = map[k];
    if (!prev || s.date > prev) map[k] = s.date;
  });
  return map;
}

// Exclude soft-deleted lots for parity with the other lot
// engines (callers pass liveData today, but the contract should be uniform).
function usableLots(t: any): any[] {
  return ((t && t.lots) || []).filter(function (l: any) {
    return l && !l.deletedAt && l.status !== "finished" && safeNonNeg(l.weightG) > 0;
  });
}

// OPEN lots only — an opened pot (status "jar") with weight left.
// A sealed cellar tin isn't "ready to smoke tonight" without opening it.
function openJarLots(t: any): any[] {
  return ((t && t.lots) || []).filter(function (l: any) {
    return l && !l.deletedAt && l.status === "jar" && safeNonNeg(l.weightG) > 0;
  });
}

/**
 * Score the live inventory and return the top `max` (default 3)
 * candidates for tonight's smoke. Only tobaccos with at least one
 * usable lot (jar OR cellar, weight > 0) are eligible — a suggestion
 * the user can't act on is noise.
 */
export function computeSmokeSuggestions(
  tobaccos: any[] | null | undefined,
  sessions: any[] | null | undefined,
  opts?: SuggestOptions,
): SmokeSuggestion[] {
  var now = (opts && opts.now) || Date.now();
  var max = (opts && opts.max) || 3;
  var lowThreshold = (opts && opts.lowLotThreshold) || 10;
  var openOnly = !!(opts && opts.openOnly);
  var ignoreRating = !!(opts && opts.ignoreRating);
  var lastMap = lastSessionDateByTobacco(sessions);

  var out: SmokeSuggestion[] = [];
  (tobaccos || []).forEach(function (t: any) {
    if (!t || t.id === undefined || t.id === null) return;
    // Never SUGGEST a tobacco the user flagged "don't rebuy"
    // (rebuy === false). It's a suggestion/discovery list, so proposing one
    // the user has decided against is noise. (Strict === false: null/true
    // stay eligible — the tri-state field.)
    if (t.rebuy === false) return;
    var lots = openOnly ? openJarLots(t) : usableLots(t);
    if (lots.length === 0) return;

    var score = 0;
    var reasons: SuggestionReason[] = [];

    // ── aging urgency (strongest signal — drink your cellar in time) ─
    var hasOveraged = false, hasApproaching = false;
    lots.forEach(function (l: any) {
      var st = lotAgingStatus(l, effectiveAgingMax(t));
      if (st === "overaged") hasOveraged = true;
      else if (st === "approaching") hasApproaching = true;
    });
    if (hasOveraged) { score += 35; reasons.push("aging_overaged"); }
    else if (hasApproaching) { score += 28; reasons.push("aging_approaching"); }

    // ── nearly-empty open jar — finish it before it dries out ────────
    var hasLowJar = lots.some(function (l: any) {
      if (l.status !== "jar") return false;
      var w = safeNonNeg(l.weightG);
      return w > 0 && w <= lowThreshold;
    });
    if (hasLowJar) { score += 20; reasons.push("lot_low"); }

    // ── recency ──────────────────────────────────────────────────────
    var last = lastMap[String(t.id)];
    var days: number | null = null;
    if (last) {
      var ts = parseLocalDate(last); // LOCAL-anchored parse (TZ off-by-one)
      if (!isNaN(ts)) days = Math.max(0, Math.floor((now - ts) / DAY_MS));
    }
    if (days === null) {
      // Never-smoked is a discovery signal — bumped 25 → 32 so an
      // untried blend surfaces for suggestion even when it's unrated (you
      // can't rate what you haven't smoked), not gated behind rated favourites.
      score += 32;
      reasons.push("never_smoked");
    } else {
      score += (Math.min(days, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS) * 25;
      if (days >= NOT_RECENT_DAYS) reasons.push("not_recent");
    }

    // ── personal rating ──────────────────────────────────────────────
    // Skippable — the Home picks must not be biased by rating.
    if (!ignoreRating) {
      var rating = typeof t.rating === "number" && isFinite(t.rating)
        ? Math.max(0, Math.min(5, t.rating)) : 0;
      score += rating * 8;
      if (rating >= 4) reasons.push("favorite");
    }

    out.push({
      tobaccoId: String(t.id),
      score: score,
      reasons: reasons,
      daysSinceSmoked: days,
    });
  });

  out.sort(function (a, b) {
    return b.score - a.score
      || String(a.tobaccoId).localeCompare(String(b.tobaccoId));
  });
  return out.slice(0, Math.max(0, max));
}

/**
 * Daily-rotating hero pick. The scoring above is deterministic,
 * so the single top suggestion never changes until the data does — the user
 * saw the SAME tobacco featured in "Ce soir ?" every day. This rotates the
 * FEATURED item among the top `pool` candidates by calendar day (the rest of
 * the order is preserved), so the highlight alternates day-to-day while
 * staying relevant. Stable within a day (keyed on floor(now/DAY)); pure (now
 * is explicit). A list of ≤ 1 is returned as-is.
 */
export function rotateDailyHero<T>(list: T[], now: number, pool = 4, bucketMs: number = DAY_MS): T[] {
  if (!list || list.length <= 1) return list ? list.slice() : [];
  var p = Math.min(Math.max(1, pool), list.length);
  // Optional bucketMs cadence (mirrors dailyWindow / pickDailyTie).
  // The Home "Ce soir ?" hero passes FEATURE_ROTATE_MS (12 h) so the big visual
  // refreshes on the same rhythm as the secondary list and the "du moment"
  // picks — the whole home block breathes together instead of the hero lagging
  // a full day behind.
  var bucket = Math.floor(now / (bucketMs > 0 ? bucketMs : DAY_MS));
  var pick = ((bucket % p) + p) % p;
  var copy = list.slice();
  if (pick > 0) copy.unshift(copy.splice(pick, 1)[0] as T);
  return copy;
}

/**
 * Daily-rotating pick among the TOP TIE GROUP. `list` must
 * already be sorted best-first; `tieKey` maps an item to the ranking signals
 * that define "same standing" (EXCLUDING the id/date tiebreak). Items that
 * share the first item's `tieKey` are equally deserving of the spotlight, so
 * the feature rotates among them by calendar day — a clear single leader
 * (unique top key) is returned unchanged, no artificial rotation. Fixes the
 * "tabac/pipe du moment" always showing the same entry when several tie on
 * the same session-count + rating. Pure (now explicit); undefined on empty.
 */
export function pickDailyTie<T>(
  list: T[] | null | undefined,
  now: number,
  tieKey: (t: T) => string,
  // The rotation bucket. Defaults to a calendar day; the Home
  // "du moment" picks pass FEATURE_ROTATE_MS (12 h) so the featured tobacco
  // and pipe alternate twice as often.
  bucketMs: number = DAY_MS,
): T | undefined {
  if (!list || list.length === 0) return undefined;
  var k0 = tieKey(list[0] as T);
  var n = 1;
  while (n < list.length && tieKey(list[n] as T) === k0) n++;
  var bucket = Math.floor(now / (bucketMs > 0 ? bucketMs : DAY_MS));
  return list[((bucket % n) + n) % n];
}

/**
 * Rotating window of `size` items. Returns `size` consecutive
 * items starting at `bucket % length`, wrapping around — so the visible slice
 * cycles through the whole list bucket-to-bucket (unlike rotateDailyHero which
 * only moves ONE item to the front). Used for the "Ce soir ?" secondary list
 * so it alternates instead of always showing the same runners-up. Pure (now
 * explicit); returns [] on empty, at most `min(size, length)` items.
 *
 * Gained the optional `bucketMs` cadence (mirrors pickDailyTie).
 * The Home "Ce soir ?" list passes FEATURE_ROTATE_MS (12 h) so it rotates on
 * the SAME cadence as the featured "du moment" picks — the previous day-only
 * cadence combined with a window that covered the whole (post-hero) pool made
 * the runners-up look frozen while only the featured tobacco changed.
 */
export function dailyWindow<T>(
  list: T[] | null | undefined,
  now: number,
  size: number,
  bucketMs: number = DAY_MS,
): T[] {
  if (!list || list.length === 0 || size <= 0) return [];
  var n = list.length;
  var bucket = Math.floor(now / (bucketMs > 0 ? bucketMs : DAY_MS));
  var start = ((bucket % n) + n) % n;
  var out: T[] = [];
  var count = Math.min(size, n);
  for (var i = 0; i < count; i++) out.push(list[(start + i) % n] as T);
  return out;
}

/**
 * Deterministic PRNG (mulberry32). Same seed → same stream, no
 * global Math.random — so a seeded shuffle is stable within a render/session
 * yet varies when the seed (per-launch counter + time bucket) moves. Returns a
 * function yielding floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded Fisher-Yates shuffle. Pure: same (list, seed) → same
 * permutation; never mutates the input. Powers the Home "Ce soir ?" random
 * draw over every open tobacco — deterministic so it doesn't reshuffle on every
 * re-render, seeded so each app launch / 12 h bucket reorders the pool.
 */
export function seededShuffle<T>(list: T[] | null | undefined, seed: number): T[] {
  var arr = (list || []).slice();
  var rnd = mulberry32(Math.floor(seed) >>> 0);
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

export interface RestedPipeSuggestion {
  pipeId: string;
  /** null = never smoked (the most rested a pipe can be). */
  restDays: number | null;
}

/**
 * The best pipe to pair with tonight's bowl: the most-rested ACTIVE
 * pipe, never-smoked counting as infinitely rested. Ties break on
 * rating (desc), then id (stable). Returns null when the collection
 * has no active pipe.
 */
export function suggestRestedPipe(
  pipes: any[] | null | undefined,
  sessions: any[] | null | undefined,
  now: number = Date.now(),
  /**
   * Pipe ids to avoid pairing tonight (ghosting risk vs the
   * featured tobacco — see computePipeGhostingRisk). Filtered out first;
   * if EVERY candidate is excluded, the filter is ignored (a suggestion
   * beats none — the app still shows the ghosting warning at session time).
   */
  excludeIds?: Set<string> | string[] | null,
  /**
   * Rotation cadence. Defaults to a calendar day; HomeViewV2 passes
   * FEATURE_ROTATE_MS (12 h) so the pipe alternates on the SAME rhythm as the
   * "Ce soir ?" tobacco. Combined with the per-launch-shifted `now` the caller
   * passes (Date.now() + homeRotationSeed()×FEATURE_ROTATE_MS), the suggested
   * pipe now changes every app launch + every 12 h.
   */
  bucketMs: number = DAY_MS,
  /**
   * The clock used ONLY for the rotation bucket. Defaults to
   * `now`. HomeViewV2 passes the real `Date.now()` as `now` (so `restDays` is
   * measured correctly) and the per-launch-shifted `featNow` here (so the pick
   * still rotates). Before this split, the shifted `now` flowed into the
   * DISPLAYED rest count, which drifted upward ~½ day per app launch.
   */
  rotateNow: number = now,
): RestedPipeSuggestion | null {
  var excl: Set<string> | null = excludeIds
    ? (excludeIds instanceof Set ? excludeIds : new Set(excludeIds))
    : null;
  var actives = (pipes || []).filter(function (p: any) {
    return p && p.id !== undefined && p.id !== null
      && (p.status || "active") !== "finished";
  });
  if (actives.length === 0) return null;
  if (excl && excl.size) {
    var kept = actives.filter(function (p: any) { return !excl!.has(String(p.id)); });
    if (kept.length > 0) actives = kept; // else keep all — better a ghosted pick than none
  }
  var restMap = computePipeRest(actives, sessions, now);
  var eff = function (p: any): number {
    var r = restMap[String(p.id)];
    return r === null || r === undefined ? Infinity : r;
  };

  // Sort most-rested first, then rating, then id (stable). Uses a NaN-safe
  // comparator because Infinity - Infinity is NaN (two never-smoked pipes).
  var sorted = actives.slice().sort(function (a: any, b: any) {
    var ea = eff(a), eb = eff(b);
    if (ea !== eb) return eb > ea ? 1 : -1;
    if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  // Rotate among the TOP-N most-rested pipes (not only the exact
  // top-rest tie group). The old pickDailyTie approach rotated ONLY among
  // pipes sharing the identical top rest value — so whenever one pipe was
  // uniquely the most-rested (the common case once last-session dates differ
  // by even a day), the tie group was size 1 and the suggestion was PINNED:
  // the user saw the same pipe on every relaunch while the "Ce soir ?" tobacco
  // (a seeded shuffle) kept changing. rotateDailyHero over a small pool of the
  // best-rested pipes — combined with the per-launch-shifted `now` + 12 h
  // `bucketMs` the caller passes — makes the pipe cycle on the same rhythm as
  // the tobacco. `sorted` is rest-desc then rating, so the pool is the genuinely
  // most-rested pipes and rotation starts from the best-rated one.
  var pool = Math.min(5, sorted.length);
  var best = rotateDailyHero(sorted, rotateNow, pool, bucketMs)[0];
  if (!best) return null;
  var rd = restMap[String(best.id)];
  return { pipeId: String(best.id), restDays: rd === undefined ? null : rd };
}
