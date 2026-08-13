/**
 * Pure statistics aggregators for the Stats view.
 *
 * Extracted from the inline `useMemo` blocks in App.tsx so the chart
 * pipeline can be unit/property-fuzzed independently. None of these
 * functions depend on React; they take the same arrays App.tsx
 * exposes via `liveData` and return plain data shapes.
 *
 * Defensive coercion: `safeNonNeg` widens `parseInt(x) || 0` /
 * `parseFloat(x) || 0` to catch the `Infinity` case — `parseFloat("Infinity")`
 * is truthy and slips past the falsy fallback, poisoning every
 * downstream accumulator. A forged import / tampered backup is the
 * realistic vector.
 */

import { countActive, pipeIsActive, safeWeight } from "../utils.ts";
import { countryNameToIso2 } from "./geo.ts";
import { sanitizeAromas } from "./aromas.ts";

/**
 * Coerce any value to a finite non-negative number; 0 for everything else.
 * Delegates to the single-sourced `safeWeight` (was a byte-
 * equivalent local copy). Kept as a named export — watchlist.ts, suggest.ts
 * and the stats test import it by this name.
 */
export function safeNonNeg(v: any): number {
  return safeWeight(v);
}

export interface TopTobacco {
  id: string;
  name: string;
  sessions: number;
  weight: number;
  duration: number;
}

export interface TopPipe {
  id: string;
  name: string;
  sessions: number;
  duration: number;
}

/**
 * Post-CI: use `Object.create(null)` for every dictionary
 * whose keys come from user-controlled data (tobacco id, brand, pipe
 * id, etc.). Without the prototype-free shape, a key like `"toString"`
 * resolves to `Object.prototype.toString` (a function) and the
 * `(map[k] || 0) + N` accumulator becomes `function + N` ⇒ string
 * concat. That string then poisons every downstream `Number.isFinite`
 * check. Caught by the stats property fuzz with the seed
 * `-185239030` (counterexample: brand "toString").
 */
function emptyNumMap(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}
function emptyStrMap(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/**
 * Generic "top pairings" rank-and-slice, extracted from
 * two byte-identical IIFEs (InventoryDetailView topPipes, PipesDetailView
 * topTobaccos). An earlier helper pair was removed and inlined;
 * this restores a single tested definition. Keeps the `Object.create(null)`
 * prototype-pollution guard. Counts sessions whose `filterKey` matches
 * `filterId`, grouped by `countKey`, resolves each id via `resolve`, drops
 * unresolved (trashed/deleted) rows, returns the top `limit`.
 */
export function topPairings<E>(
  sessions: any[] | null | undefined,
  filterKey: string,
  filterId: any,
  countKey: string,
  resolve: (id: string) => E | null | undefined,
  limit: number = 5,
): { entity: E; n: number }[] {
  var list = Array.isArray(sessions) ? sessions : [];
  var counts: Record<string, number> = Object.create(null);
  list.forEach(function (s: any) {
    if (s && String(s[filterKey]) === String(filterId) && s[countKey]) {
      var k = String(s[countKey]);
      counts[k] = (counts[k] || 0) + 1;
    }
  });
  return Object.entries(counts)
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, limit)
    .map(function (pair) {
      var e = resolve(pair[0]);
      return e ? { entity: e, n: pair[1] } : null;
    })
    .filter(Boolean) as { entity: E; n: number }[];
}

/**
 * Top-10 most-consumed tobaccos by total session weight, broken
 * by session count.
 */
export function computeTopTobaccos(tobs: any[] | null, sessions: any[] | null): TopTobacco[] {
  if (!tobs || !sessions) return [];
  var tobSess = emptyNumMap();
  var tobDurMap = emptyNumMap();
  var tobWeightMap = emptyNumMap();
  sessions.forEach(function (s: any) {
    if (s && s.tobaccoId) {
      var k = String(s.tobaccoId);
      tobSess[k] = (tobSess[k] || 0) + 1;
      tobDurMap[k] = (tobDurMap[k] || 0) + safeNonNeg(s.duration);
      tobWeightMap[k] = (tobWeightMap[k] || 0) + safeNonNeg(s.weightG);
    }
  });
  var tobNameMap = emptyStrMap();
  tobs.forEach(function (t: any) {
    if (t && t.id !== undefined && t.id !== null) {
      tobNameMap[String(t.id)] = [t.brand || "", t.name || ""].filter(Boolean).join(" — ");
    }
  });
  return Object.keys(tobSess)
    .filter(function (k) { return tobNameMap[k]; })
    .map(function (k) {
      return {
        id: k,
        name: tobNameMap[k] || "",
        sessions: tobSess[k] || 0,
        weight: Math.round((tobWeightMap[k] || 0) * 10) / 10,
        duration: tobDurMap[k] || 0,
      };
    })
    .sort(function (a, b) {
      return b.weight - a.weight || b.sessions - a.sessions;
    })
    .slice(0, 10);
}

/**
 * Top-10 most-used pipes by session count.
 */
export function computeTopPipes(pipes: any[] | null, sessions: any[] | null): TopPipe[] {
  if (!pipes || !sessions) return [];
  var pipeSess = emptyNumMap();
  var pipeDurMap = emptyNumMap();
  sessions.forEach(function (s: any) {
    if (s && s.pipeId) {
      var k = String(s.pipeId);
      pipeSess[k] = (pipeSess[k] || 0) + 1;
      pipeDurMap[k] = (pipeDurMap[k] || 0) + safeNonNeg(s.duration);
    }
  });
  var pipeNameMap = emptyStrMap();
  pipes.forEach(function (p: any) {
    if (p && p.id !== undefined && p.id !== null) {
      pipeNameMap[String(p.id)] = [p.brand || "", p.name || ""].filter(Boolean).join(" — ");
    }
  });
  return Object.keys(pipeSess)
    .filter(function (k) { return pipeNameMap[k]; })
    .map(function (k) {
      return {
        id: k,
        name: pipeNameMap[k] || "",
        sessions: pipeSess[k] || 0,
        duration: pipeDurMap[k] || 0,
      };
    })
    .sort(function (a, b) { return b.sessions - a.sessions; })
    .slice(0, 10);
}

export interface TasteProfile {
  count: number;
  force: number;
  roomNote: number;
  taste: number;
}

export interface ChartStats {
  catW: [string, number][];
  brandW: [string, number][];
  ratings: number[];
  pShapes: [string, number][];
  pBowl: [string, number][];
  pStem: [string, number][];
  topTobaccos: TopTobacco[];
  topPipes: TopPipe[];
  monthlyDur: [string, number][];
  monthlyWeight: [string, number][];
  yearlyDur: [string, number][];
  yearlyWeight: [string, number][];
  avgSessionDuration: number;
  totalSessions: number;
  calByDay: Record<string, number>;
  tasteProfile: TasteProfile | null;
}

/** Generate the rolling 12-month window keys ending at `now`. */
export function monthKeysLast12(now: Date): string[] {
  var keys: string[] = [];
  for (var i = 11; i >= 0; i--) {
    var md = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(
      md.getFullYear() + "-" + (md.getMonth() + 1 < 10 ? "0" : "") + (md.getMonth() + 1),
    );
  }
  return keys;
}

// ── Spending aggregators ─────────────────────────────────────────────
// "How much did this hobby cost me?" — purchase dates + prices are
// already stored on every lot / pipe / accessory; these helpers fold
// them into chartable shapes.
//
// Date precision caveat: tobacco lots carry a full ISO purchase date,
// but pipes and accessories store the YEAR only. The
// monthly chart therefore covers tobacco lots ONLY; the yearly chart
// combines all three kinds.
export interface SpendingStats {
  /** Rolling last-12-months [["YYYY-MM", amount]…] — tobacco lots only. */
  monthly: [string, number][];
  /** All years, ascending [["YYYY", amount]…] — per kind (the combined
   *  series was split so the chart separates the three). */
  yearlyTobacco: [string, number][];
  yearlyPipes: [string, number][];
  yearlyAccessories: [string, number][];
  totalTobacco: number;
  totalPipes: number;
  totalAccessories: number;
  totalAllTime: number;
  totalThisYear: number;
}

function yearOf(dateStr: any): string {
  if (typeof dateStr !== "string") return "";
  var m = String(dateStr).match(/^(\d{4})/);
  return m && m[1] ? m[1] : "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeSpendingStats(
  tobs: any[] | null | undefined,
  pipes: any[] | null | undefined,
  accessories: any[] | null | undefined,
  now?: Date,
): SpendingStats {
  var nowD = now || new Date();
  var monthKeys = monthKeysLast12(nowD);
  var monthly = emptyNumMap();
  monthKeys.forEach(function (k) { monthly[k] = 0; });
  var yearlyTob = emptyNumMap();
  var yearlyPipe = emptyNumMap();
  var yearlyAcc = emptyNumMap();
  var totals = { tobacco: 0, pipes: 0, accessories: 0 };
  var thisYear = String(nowD.getFullYear());
  var totalThisYear = 0;

  function add(bucket: Record<string, number>, kind: keyof typeof totals, year: string, amount: number) {
    if (!year || amount <= 0) return;
    bucket[year] = (bucket[year] || 0) + amount;
    totals[kind] += amount;
    if (year === thisYear) totalThisYear += amount;
  }

  (tobs || []).forEach(function (t: any) {
    ((t && t.lots) || []).forEach(function (l: any) {
      if (!l) return;
      var price = safeNonNeg(l.price);
      if (price <= 0) return;
      add(yearlyTob, "tobacco", yearOf(l.datePurchased), price);
      // Monthly bucket — full ISO date required.
      if (typeof l.datePurchased === "string" && /^\d{4}-\d{2}/.test(l.datePurchased)) {
        var mk = String(l.datePurchased).substring(0, 7);
        if (monthly[mk] !== undefined) monthly[mk] = (monthly[mk] || 0) + price;
      }
    });
  });
  (pipes || []).forEach(function (p: any) {
    if (!p) return;
    add(yearlyPipe, "pipes", yearOf(p.datePurchased), safeNonNeg(p.price));
  });
  (accessories || []).forEach(function (a: any) {
    if (!a) return;
    add(yearlyAcc, "accessories", yearOf(a.datePurchased), safeNonNeg(a.price));
  });

  function toSeries(o: Record<string, number>): [string, number][] {
    return Object.entries(o)
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); })
      .map(function (e): [string, number] { return [e[0], round2(e[1])]; });
  }

  return {
    monthly: monthKeys.map(function (k): [string, number] {
      return [k, round2(monthly[k] || 0)];
    }),
    yearlyTobacco: toSeries(yearlyTob),
    yearlyPipes: toSeries(yearlyPipe),
    yearlyAccessories: toSeries(yearlyAcc),
    totalTobacco: round2(totals.tobacco),
    totalPipes: round2(totals.pipes),
    totalAccessories: round2(totals.accessories),
    totalAllTime: round2(totals.tobacco + totals.pipes + totals.accessories),
    totalThisYear: round2(totalThisYear),
  };
}

const EMPTY_STATS: ChartStats = {
  catW: [], brandW: [], ratings: [0, 0, 0, 0, 0],
  pShapes: [], pBowl: [], pStem: [],
  topTobaccos: [], topPipes: [],
  monthlyDur: [], monthlyWeight: [],
  yearlyDur: [], yearlyWeight: [],
  avgSessionDuration: 0, totalSessions: 0,
  calByDay: {}, tasteProfile: null,
};

/**
 * Main statistics aggregator. Composes every chart input the Stats
 * view needs from the three live arrays + the two top-X memos.
 *
 * `topTobaccos` and `topPipes` are passed in (not recomputed) so
 * App.tsx can keep them in their own `useMemo` with their own deps
 * — they're consumed by other views too (home featured pipe etc.).
 *
 * Returns `EMPTY_STATS` if any of the three live arrays is null
 * (data not loaded yet).
 */
export function computeChartStats(
  tobs: any[] | null,
  pipes: any[] | null,
  sessions: any[] | null,
  topTobaccos: TopTobacco[],
  topPipes: TopPipe[],
  now?: Date,
): ChartStats {
  if (!tobs || !pipes || !sessions) return EMPTY_STATS;

  // ── tobacco weight by category / brand (active lots only) ─────────
  var catW = emptyNumMap();
  var brandW = emptyNumMap();
  tobs.forEach(function (t: any) {
    (t && t.lots || []).forEach(function (l: any) {
      if (!l || l.status === "finished") return;
      var w = safeNonNeg(l.weightG);
      if (t.category) catW[t.category] = (catW[t.category] || 0) + w;
      if (t.brand)    brandW[t.brand]    = (brandW[t.brand]    || 0) + w;
    });
  });

  // ── ratings histogram (active tobaccos only) ─────────────────────
  // Kept in lockstep with the inventory "active" filter — a
  // lot-less tabac is inactive, so it no longer feeds the histogram (which
  // drills to the active list).
  var ratings = [0, 0, 0, 0, 0];
  tobs.forEach(function (t: any) {
    if (!t) return;
    if (t.rating >= 1 && t.rating <= 5 && countActive(t) > 0) {
      var idx = Math.round(t.rating) - 1;
      if (idx >= 0 && idx < 5) (ratings[idx] = (ratings[idx] || 0) + 1);
    }
  });

  // ── 12 rolling month buckets ──────────────────────────────────────
  var monthKeys = monthKeysLast12(now || new Date());

  // ── pipe shape / bowl / stem distribution (active pipes only) ─────
  var aP = pipes.filter(function (p: any) { return p && pipeIsActive(p); });
  var pShapes = emptyNumMap();
  var pBowl = emptyNumMap();
  var pStem = emptyNumMap();
  aP.forEach(function (p: any) {
    if (p.shape)         pShapes[p.shape] = (pShapes[p.shape] || 0) + 1;
    if (p.bowlMaterial)  pBowl[p.bowlMaterial] = (pBowl[p.bowlMaterial] || 0) + 1;
    if (p.stemMaterial)  pStem[p.stemMaterial] = (pStem[p.stemMaterial] || 0) + 1;
  });

  // ── monthly / yearly session totals ───────────────────────────────
  var monthlyDur = emptyNumMap();
  var monthlyWeight = emptyNumMap();
  monthKeys.forEach(function (k) { monthlyDur[k] = 0; monthlyWeight[k] = 0; });
  var yearlyDur = emptyNumMap();
  var yearlyWeight = emptyNumMap();
  var calByDay = emptyNumMap();
  var durTotal = 0;
  var durCount = 0;
  // `durCount` is the DENOMINATOR of the average (timed
  // sessions only); `sessCount` is the true total. `totalSessions` is rendered
  // as a plain "N séances" and the card drills to ALL sessions, so it must be
  // the total — not the timed-only count (which under-reported for users who
  // don't record a duration).
  var sessCount = 0;

  sessions.forEach(function (s: any) {
    if (!s || !s.date || typeof s.date !== "string") return;
    sessCount++;
    var d = safeNonNeg(s.duration);
    var w = safeNonNeg(s.weightG);
    // monthly
    var mk = String(s.date).substring(0, 7);
    if (monthlyDur[mk] !== undefined) {
      monthlyDur[mk] = (monthlyDur[mk] || 0) + d;
      monthlyWeight[mk] = (monthlyWeight[mk] || 0) + w;
    }
    // yearly
    var yk = String(s.date).substring(0, 4);
    if (d > 0) yearlyDur[yk] = (yearlyDur[yk] || 0) + d;
    yearlyWeight[yk] = (yearlyWeight[yk] || 0) + w;
    // average
    if (d > 0) { durTotal += d; durCount++; }
    // calendar heatmap
    calByDay[s.date] = (calByDay[s.date] || 0) + 1;
  });

  var avgSessionDuration = durCount > 0 ? Math.round(durTotal / durCount) : 0;

  // ── taste profile (averages over rated >= 4 tobaccos) ─────────────
  var tpRated = tobs.filter(function (t: any) { return t && (t.rating || 0) >= 4; });
  var tpForce = 0, tpRoom = 0, tpTaste = 0;
  tpRated.forEach(function (t: any) {
    tpForce += safeNonNeg(t.force);
    tpRoom  += safeNonNeg(t.roomNote);
    tpTaste += safeNonNeg(t.taste);
  });
  var tasteProfile: TasteProfile | null = tpRated.length > 0
    ? {
        count: tpRated.length,
        force: tpForce / tpRated.length,
        roomNote: tpRoom / tpRated.length,
        taste: tpTaste / tpRated.length,
      }
    : null;

  // ── compose return ────────────────────────────────────────────────
  function sortByVal(o: Record<string, number>): [string, number][] {
    return Object.entries(o).sort(function (a, b) { return b[1] - a[1]; });
  }

  return {
    catW: sortByVal(catW),
    brandW: sortByVal(brandW).slice(0, 10),
    ratings: ratings,
    pShapes: sortByVal(pShapes),
    pBowl: sortByVal(pBowl),
    pStem: sortByVal(pStem),
    topTobaccos: topTobaccos,
    topPipes: topPipes,
    monthlyDur: monthKeys.map(function (k): [string, number] {
      return [k, Math.round((monthlyDur[k] || 0) / 6) / 10];
    }),
    monthlyWeight: monthKeys.map(function (k): [string, number] {
      return [k, Math.round((monthlyWeight[k] || 0) * 10) / 10];
    }),
    yearlyDur: Object.entries(yearlyDur)
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); })
      .map(function (e): [string, number] { return [e[0], Math.round(e[1] / 6) / 10]; }),
    yearlyWeight: Object.entries(yearlyWeight)
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); })
      .map(function (e): [string, number] { return [e[0], Math.round(e[1] * 10) / 10]; }),
    avgSessionDuration: avgSessionDuration,
    totalSessions: sessCount,
    calByDay: calByDay,
    tasteProfile: tasteProfile,
  };
}

// ── Location stats ───────────────────────────────────────────────────────────
// Sessions carry an optional structured location (locationCity / commune,
// locationCountry). This aggregates session COUNTS by commune and by country
// — the spot/POI (locationName) is intentionally ignored, per product spec
// (only commune + country matter for stats). Sessions without the field are
// skipped. Pure; tested in stats.test.ts.

export interface LocationStat { label: string; count: number; }

export function computeLocationStats(
  sessions: any[] | null | undefined,
  topN?: number,
): { byCommune: LocationStat[]; byCountry: LocationStat[] } {
  var n = (typeof topN === "number" && topN > 0) ? topN : 10;
  // Object.create(null) — commune/country are raw free-text user
  // strings (session capture), so a value like "toString"/"constructor" would
  // otherwise hit Object.prototype and poison the count. Matches the same
  // discipline the other stats aggregators use.
  var communes: Record<string, number> = Object.create(null);
  // Countries are grouped by a CANONICAL key so the same
  // country logged under different UI languages ("France" / "Frankreich" /
  // "Francia") sums into a single row instead of splitting. The key is the
  // ISO-3166 code when the name resolves (countryNameToIso2), else the
  // lower-cased raw name (unknown/exotic countries degrade to per-string
  // grouping, exactly as before). Each group tracks the raw variants it
  // absorbed so the displayed label can be the one the user captured most
  // often — no ISO→localised-name table needed, and the label stays a real
  // country name the journal click-thru filter can match.
  var countryGroups: Record<string, { total: number; variants: Record<string, number> }> = Object.create(null);
  (sessions || []).forEach(function (s: any) {
    if (!s) return;
    var city = typeof s.locationCity === "string" ? String(s.locationCity).trim() : "";
    var country = typeof s.locationCountry === "string" ? String(s.locationCountry).trim() : "";
    if (city) communes[city] = (communes[city] || 0) + 1;
    if (country) {
      var iso = countryNameToIso2(country);
      var key = iso ? "iso:" + iso : "raw:" + String(country).toLowerCase();
      var g = countryGroups[key] || (countryGroups[key] = { total: 0, variants: Object.create(null) });
      g.total += 1;
      g.variants[country] = (g.variants[country] || 0) + 1;
    }
  });
  function topCommunes(map: Record<string, number>): LocationStat[] {
    return Object.keys(map)
      .map(function (k): LocationStat { return { label: k, count: map[k] as number }; })
      .sort(function (a, b) { return b.count - a.count || String(a.label).localeCompare(String(b.label)); })
      .slice(0, n);
  }
  function topCountries(): LocationStat[] {
    return Object.keys(countryGroups)
      .map(function (key): LocationStat {
        var g = countryGroups[key] as { total: number; variants: Record<string, number> };
        // Display label = the raw variant captured most often (deterministic
        // tie-break by locale order).
        var label = Object.keys(g.variants).sort(function (a, b) {
          return (g.variants[b] as number) - (g.variants[a] as number) || String(a).localeCompare(String(b));
        })[0] as string;
        return { label: label, count: g.total };
      })
      .sort(function (a, b) { return b.count - a.count || String(a.label).localeCompare(String(b.label)); })
      .slice(0, n);
  }
  return { byCommune: topCommunes(communes), byCountry: topCountries() };
}

// ── Aging sweet-spot: rating vs. tobacco age ──────────────────────────────────
// "At what age is each tobacco best?" — the question every cellarer asks, now
// answered from the user's OWN data. For every rated session (rating > 0) whose
// lot resolves and carries a production/purchase date, we compute the tobacco's
// AGE at the moment it was smoked (session.date − lot.dateProduction, falling
// back to datePurchased) and bucket it. Per bucket we average the ratings. The
// bar chart is a personal "aging curve"; the peak is the best-rated bucket with
// enough samples. Pure derivation — no new field to enter, no network.
export interface AgeRatingBucket {
  key: string;          // stable id (drives the localized label in the view)
  minYears: number;     // inclusive lower bound (years)
  maxYears: number | null; // exclusive upper bound, null = open-ended (10y+)
  avg: number;          // average rating in the bucket, rounded to 1 decimal
  count: number;        // qualifying sessions in the bucket
}
export interface AgingSweetSpot {
  buckets: AgeRatingBucket[]; // age-ordered, only buckets with count > 0
  total: number;              // total qualifying (rated + dated) sessions
  peakKey: string | null;     // best-avg bucket with count >= PEAK_MIN, else null
}

// Fixed cellaring buckets. Boundaries in years; last bucket is open-ended.
var AGE_BUCKETS: { key: string; min: number; max: number | null }[] = [
  { key: "lt1",   min: 0,  max: 1 },
  { key: "1_2",   min: 1,  max: 2 },
  { key: "2_4",   min: 2,  max: 4 },
  { key: "4_7",   min: 4,  max: 7 },
  { key: "7_10",  min: 7,  max: 10 },
  { key: "10plus", min: 10, max: null },
];
// A bucket must have at least this many sessions to be eligible as the "peak"
// — one lucky 5★ session shouldn't crown an age band.
var PEAK_MIN = 2;

// Optional `category` narrows the curve to one tobacco family (canonical
// French value, e.g. "Virginia"). Families age very differently — Virginias
// improve for years while aromatics fade — so a global curve averages
// contradictory behaviours; the view exposes a per-family filter. "" / omitted
// = all families.
export function computeAgingSweetSpot(
  tobs: any[] | null | undefined,
  sessions: any[] | null | undefined,
  category?: string,
): AgingSweetSpot {
  var empty: AgingSweetSpot = { buckets: [], total: 0, peakKey: null };
  if (!Array.isArray(tobs) || !Array.isArray(sessions)) return empty;
  // Index lots by tobaccoId → (lotId → production date string). Resolving
  // through the tobacco (not a flat lotId map) matches how the app resolves
  // lots everywhere and avoids cross-tobacco lotId collisions.
  // Also index each tobacco's own rating — used as a FALLBACK when the
  // session itself isn't rated. Many users rate their tobaccos (inventory)
  // but not every individual smoking session, so without this fallback the
  // curve would have nothing to plot for them.
  // Object.create(null) — these were the last plain-{}
  // maps in stats.ts keyed on a user id (tobaccoId / lotId). A forged id equal
  // to a prototype member ("valueOf"/"toString") would resolve through the
  // prototype chain (truthy) and slip past the `if (!byLot)` guard; downstream
  // rating/date guards mask it today, but keep the discipline uniform.
  var lotDateByTob: Record<string, Record<string, string>> = Object.create(null);
  var ratingByTob: Record<string, number> = Object.create(null);
  var catByTob: Record<string, string> = Object.create(null);
  tobs.forEach(function (t: any) {
    if (!t || t.id === undefined) return;
    var lots = Array.isArray(t.lots) ? t.lots : [];
    var m: Record<string, string> = Object.create(null);
    lots.forEach(function (l: any) {
      if (!l || l.id === undefined) return;
      var d = l.dateProduction || l.datePurchased || "";
      if (d) m[String(l.id)] = String(d);
    });
    lotDateByTob[String(t.id)] = m;
    var tr = Number(t.rating);
    ratingByTob[String(t.id)] = tr > 0 ? tr : 0;
    catByTob[String(t.id)] = String(t.category || "");
  });
  var wantCat = category ? String(category) : "";
  var sums: Record<string, number> = Object.create(null);
  var counts: Record<string, number> = Object.create(null);
  var total = 0;
  sessions.forEach(function (s: any) {
    if (!s) return;
    if (!s.tobaccoId || !s.lotId) return;            // orphaned ref → skip
    if (wantCat && catByTob[String(s.tobaccoId)] !== wantCat) return; // family filter
    // Session rating wins; fall back to the tobacco's overall rating.
    var rating = Number(s.rating);
    if (!(rating > 0)) rating = ratingByTob[String(s.tobaccoId)] || 0;
    if (!(rating > 0)) return;                       // no usable rating → skip
    var byLot = lotDateByTob[String(s.tobaccoId)];
    if (!byLot) return;
    var prod = byLot[String(s.lotId)];
    if (!prod) return;                               // lot has no date → skip
    var t0 = Date.parse(prod);
    var t1 = Date.parse(s.date || "");
    if (isNaN(t0) || isNaN(t1)) return;
    var ageY = (t1 - t0) / (365.25 * 86400000);
    if (!(ageY >= 0) || !isFinite(ageY)) return;     // future/garbage → skip
    var bkt = AGE_BUCKETS.find(function (b) {
      return ageY >= b.min && (b.max === null || ageY < b.max);
    });
    if (!bkt) return;
    sums[bkt.key] = (sums[bkt.key] || 0) + rating;
    counts[bkt.key] = (counts[bkt.key] || 0) + 1;
    total += 1;
  });
  var buckets: AgeRatingBucket[] = AGE_BUCKETS
    .filter(function (b) { return (counts[b.key] || 0) > 0; })
    .map(function (b) {
      var c = counts[b.key] as number;
      var sum = sums[b.key] || 0;
      return {
        key: b.key, minYears: b.min, maxYears: b.max,
        avg: Math.round((sum / c) * 10) / 10,
        count: c,
      };
    });
  var peakKey: string | null = null;
  var peakAvg = -1;
  buckets.forEach(function (b) {
    if (b.count >= PEAK_MIN && b.avg > peakAvg) { peakAvg = b.avg; peakKey = b.key; }
  });
  return { buckets: buckets, total: total, peakKey: peakKey };
}

// ── Aroma profile: the aroma wheel aggregated ─────────────────────────────────
// Counts how often each aroma key was tapped across the user's sessions and
// returns the most frequent ones — their personal "taste profile". Aroma keys
// are already sanitised to the known wheel on load (migrateData), so this just
// tallies. Pure derivation; rendered as a bar chart in StatsView.
export interface AromaProfileItem { key: string; count: number; }
export interface AromaProfile {
  items: AromaProfileItem[]; // most-frequent first, capped at topN
  total: number;             // total aroma taps across all sessions
  taggedSessions: number;    // sessions carrying at least one aroma
}
export function computeAromaProfile(
  sessions: any[] | null | undefined,
  topN: number = 12,
): AromaProfile {
  if (!Array.isArray(sessions)) return { items: [], total: 0, taggedSessions: 0 };
  var counts: Record<string, number> = Object.create(null);
  var total = 0;
  var tagged = 0;
  sessions.forEach(function (s: any) {
    if (!s) return;
    // Validate against the aroma wheel (parity with
    // tasteProfile) so a forged/legacy session can't inject a junk key into the
    // "Profil gustatif" chart. sanitizeAromas drops unknown/non-string + dedups.
    var arr = sanitizeAromas(s.aromas);
    if (arr.length === 0) return;
    arr.forEach(function (k: string) {
      counts[k] = (counts[k] || 0) + 1;
      total += 1;
    });
    tagged += 1;
  });
  var items = Object.keys(counts)
    .map(function (k) { return { key: k, count: counts[k] as number }; })
    .sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, topN);
  return { items: items, total: total, taggedSessions: tagged };
}

// ── Cost per session ────────────────────────────────────────────────────────
// "Combien me revient réellement chaque bol ?" — the naïve first version
// divided total lot spend by the session count, ignoring HOW MUCH was smoked
// each time and the lot's price PER GRAM. This does it properly: each
// session's cost = grams smoked × (lot price ÷ lot weight), i.e. the price per
// gram of the exact lot that was smoked, times the grams recorded on the
// session. A blend's "cost per session" is the mean of those over its sessions.
//
// A session only contributes when it's fully measurable: it has grams > 0
// (weightG), a resolvable lotId, and that lot has both a positive price and a
// positive weight (weightInitial, falling back to the current weightG at lot
// creation for legacy lots). Accounting-off sessions (grams 0) and price-less
// lots therefore don't distort the average.

export interface CostPerSessionItem {
  id: string;
  brand: string;
  name: string;
  valueSmoked: number;   // € value actually smoked = Σ(grams × price/g)
  grams: number;         // total grams smoked across the counted sessions
  sessions: number;      // sessions with a fully-computable cost
  costPerSession: number; // valueSmoked ÷ sessions
}

export interface CostPerSessionStats {
  items: CostPerSessionItem[];    // sorted desc by costPerSession, capped at `max`
  globalValueSmoked: number;      // € smoked across every computable session
  globalGrams: number;            // grams smoked across every computable session
  globalSessions: number;         // count of computable sessions
  globalCostPerSession: number;   // globalValueSmoked ÷ globalSessions (0 when none)
}

export function computeCostPerSession(
  tobs: any[] | null | undefined,
  sessions: any[] | null | undefined,
  opts?: { max?: number },
): CostPerSessionStats {
  var max = (opts && opts.max) || 8;
  var tobList = Array.isArray(tobs) ? tobs : [];
  var sessList = Array.isArray(sessions) ? sessions : [];

  // Per live tobacco: a price-per-gram lookup for each of its lots + the
  // running accumulators. Scoped to live tobaccos + live lots so a session
  // pointing at a trashed entity/lot isn't counted (matches liveData).
  interface Acc {
    brand: string; name: string;
    ppg: Record<string, number>;   // lotId → price per gram
    value: number; grams: number; sessions: number;
  }
  var byTob = Object.create(null) as Record<string, Acc>;
  tobList.forEach(function (tob: any) {
    if (!tob || tob.deletedAt) return;
    var ppg = Object.create(null) as Record<string, number>;
    ((tob.lots) || []).forEach(function (l: any) {
      if (!l || l.deletedAt || l.id === undefined || l.id === null) return;
      var price = safeNonNeg(l.price);
      // weightInitial is the recorded original weight (back-filled from weightG
      // at creation for legacy lots); fall back to the current weightG only
      // when it's missing, so the price-per-gram denominator is the lot's full
      // size, not a partially-smoked balance.
      var wInit = safeNonNeg(l.weightInitial) || safeNonNeg(l.weightG);
      if (price > 0 && wInit > 0) ppg[String(l.id)] = price / wInit;
    });
    byTob[String(tob.id)] = {
      brand: String(tob.brand || ""), name: String(tob.name || ""),
      ppg: ppg, value: 0, grams: 0, sessions: 0,
    };
  });

  var globalValue = 0, globalGrams = 0, globalSessions = 0;
  sessList.forEach(function (s: any) {
    if (!s || s.deletedAt) return;
    var tid = s.tobaccoId;
    if (tid === undefined || tid === null || tid === "") return;
    var rec = byTob[String(tid)];
    if (!rec) return;
    var grams = safeNonNeg(s.weightG);
    if (grams <= 0) return;
    var lid = s.lotId;
    if (lid === undefined || lid === null || lid === "") return;
    var pg = rec.ppg[String(lid)];
    if (pg === undefined || !(pg > 0)) return;
    var cost = grams * pg;
    rec.value += cost; rec.grams += grams; rec.sessions += 1;
    globalValue += cost; globalGrams += grams; globalSessions += 1;
  });

  var items: CostPerSessionItem[] = [];
  Object.keys(byTob).forEach(function (id) {
    var rec = byTob[id]!;
    if (rec.sessions <= 0) return;
    items.push({
      id: id, brand: rec.brand, name: rec.name,
      valueSmoked: round2(rec.value),
      grams: round2(rec.grams),
      sessions: rec.sessions,
      costPerSession: round2(rec.value / rec.sessions),
    });
  });

  items.sort(function (a, b) {
    if (b.costPerSession !== a.costPerSession) return b.costPerSession - a.costPerSession;
    if (b.sessions !== a.sessions) return b.sessions - a.sessions;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return {
    items: items.slice(0, max),
    globalValueSmoked: round2(globalValue),
    globalGrams: round2(globalGrams),
    globalSessions: globalSessions,
    globalCostPerSession: globalSessions > 0 ? round2(globalValue / globalSessions) : 0,
  };
}
