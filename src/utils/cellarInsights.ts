// Cellar dashboard insights — pure aggregators for the
// alternative "reorganised" Home layout (HomeViewV2). Nothing here changes
// stored data; every value is derived from the live tobaccos/sessions the
// app already holds. Kept pure + testable, like computeWatchlist.

import { lotAgingStatus, daysSince, parseAgingMax, effectiveAgingMax, lotAge, isUntrackedWeight } from "../utils.ts";
// Route weights through safeNonNeg (Infinity/NaN/negative →
// 0) like every sibling engine (stats/watchlist/shopping/cost-per-session). The
// raw `parseFloat(String(x)) || 0` used here let a forged "Infinity" weightG
// through (Infinity is truthy, so `|| 0` never fired), poisoning the Home
// "Autonomie estimée" + year-consumption stats.
import { safeNonNeg } from "./stats.ts";
import { heldWeight } from "./lotUtils.ts";

// ── Cave à maturité — distribution of active lots by aging window ────────────
export interface CellarMaturity {
  young: number;    // aged < OPTIMAL_MIN_YEARS, not near/over peak
  optimal: number;  // aged into the sweet spot, not yet near peak
  peak: number;     // lotAgingStatus === "approaching"
  tooOld: number;   // lotAgingStatus === "overaged"
  total: number;
  optimalPct: number; // optimal / total, 0..100
}
// Fallback "optimal window start" (years) for a lot whose tobacco has NO
// aging target set — cellaring has no hard line, so we assume ~2y.
var OPTIMAL_MIN_YEARS = 2;
// When the tobacco DOES carry an aging target (agingMax), the optimal window
// starts at this fraction of it — so a short-keeping Aromatic reaches
// "optimale" much sooner than a long-keeping Virginia. Single, global rule:
// families differ only through their own agingMax (family-influenced when the
// AI auto-fills it), never through a per-type hardcoded table.
var OPTIMAL_START_FRACTION = 0.4;

// Classifies a single ACTIVE lot into a maturity band, or null for lots that
// don't count (finished, empty, trashed). Shared by computeCellarMaturity AND
// the inventory young/optimal filters so the bar and the filtered list agree.
// ── The weight a FILTERED inventory card should show ──────────────────────
//
// The card's big weight was always the full active stock, so a blend with one
// jar lot and eighteen cellar lots displayed 945 g while the list was filtered
// to "En pot" — a number about lots the user had just filtered OUT. The list
// card is a summary OF THE FILTER; the fiche is where the whole picture
// belongs (and it still shows everything — deliberately unchanged).
//
// The mapping lives here, in ONE place, because it has to agree exactly with
// App.tsx's `filtered` predicates: `overaged`/`approaching` are filtered via
// lotAgingStatus, whose verdicts lotMaturityBucket re-uses verbatim for its
// tooOld/peak bands — so one classifier covers all four bands without a second
// age formula. Any scope not listed here (Actifs, Tous, Épuisé, Stock bas…)
// isn't a lot-level slice, so its card keeps the full active total.
export type WeightScope = "jar" | "cellar" | "young" | "optimal" | "peak" | "tooOld" | "recent" | "smokeSoon";

// "Achats récents". A purchase-date slice of the lots, so it is
// a lot-level scope like the others — the card and the fiche narrow to the
// recent lots rather than merely listing the tobacco.
export var RECENT_PURCHASE_DAYS = 90;

/** Bought within the last RECENT_PURCHASE_DAYS. `datePurchased` only — a
 *  production date is when the tin was MADE, not when you acquired it. A lot
 *  with no purchase date is never "recent" (unknown ≠ new). A date in the
 *  FUTURE counts as recent: daysSince clamps it to 0, and a future purchase
 *  date is in practice a same-day typo, which is as recent as it gets. */
export function isRecentPurchase(lot: any, days?: number): boolean {
  if (!lot || !lot.datePurchased) return false;
  var d = daysSince(String(lot.datePurchased));
  if (d === null) return false;
  return d <= (days || RECENT_PURCHASE_DAYS);
}

export function scopeFromStatusFilter(statusFilter: any): WeightScope | null {
  switch (String(statusFilter || "")) {
    case "jar": return "jar";
    case "cellar": return "cellar";
    case "young": return "young";
    case "optimal": return "optimal";
    case "approaching": return "peak";   // the filter's name for the peak band
    case "overaged": return "tooOld";    // …and for the too-old band
    case "recent": return "recent";
    // The Home "À fumer rapidement" tile sums the peak and too-old bands, and
    // used to drill to `overaged` alone — so a tile reading 7 opened a list
    // holding 1. The count was right for the label ("smoke these soon" covers
    // both the window and past it); the destination was the half that lied.
    case "smokesoon": return "smokeSoon";
    default: return null;
  }
}

/**
 * The i18n key naming a scope, for whatever surface displays a scoped weight
 * ONE map, because the fiche's hero label was hardcoded to
 * `f_cellar` and so announced "EN CAVE" over a total that included jars — the
 * exact drift a shared resolver prevents. `null` → "En stock", since the
 * unscoped number is the whole held stock, jars included.
 */
export function scopeLabelKey(scope: WeightScope | null): string {
  switch (scope) {
    case "jar": return "f_jars";
    case "cellar": return "f_cellar";
    case "young": return "mat_young";
    case "optimal": return "mat_optimal";
    case "peak": return "mat_peak";
    case "tooOld": return "mat_old";
    case "recent": return "f_recent";
    // The SAME key the Home tile uses, deliberately: the control and the slice
    // it opens must say the same words, or the user cannot tell they arrived
    // where they tapped. That is the maturity-chip lesson, one surface over.
    case "smokeSoon": return "stat_smoke_soon";
    default: return "lbl_in_stock";
  }
}

/**
 * Is this lot part of `scope`? THE predicate behind every scoped figure — the
 * weight, the counts, the maturity chips, the oldest-lot age, on both the list
 * card and the fiche. One rule, because fixing them one surface at
 * a time is precisely how "filtered to En pot" kept leaking cellar facts.
 * A finished or soft-deleted lot is never in scope: it holds no stock.
 */
export function lotInScope(lot: any, scope: WeightScope | null, agingMax?: any): boolean {
  if (!lot || lot.deletedAt || lot.status === "finished") return false;
  if (!scope) return true;
  if (scope === "jar" || scope === "cellar") return lot.status === scope;
  if (scope === "recent") return isRecentPurchase(lot);
  // The four maturity bands are cellar-only by construction (lotMaturityBucket
  // returns null for a jar lot), so a band scope can never admit a jar.
  if (scope === "smokeSoon") {
    var b = lotMaturityBucket(lot, agingMax);
    return b === "peak" || b === "tooOld";
  }
  return lotMaturityBucket(lot, agingMax) === scope;
}

/**
 * Age (days) of the OLDEST lot in `scope`, 0 when there is none.
 * The fiche, the card, the list sort and the group sort had each grown their
 * own copy of this reduce — and `oldestAge(tob)` (utils.ts), which two of them
 * still used, spans every non-finished lot AND counts soft-deleted ones. One
 * helper, so "le plus ancien" means the same thing everywhere.
 */
export function scopedOldestAgeDays(tob: any, scope: WeightScope | null, agingMax?: any): number {
  var lots = (tob && Array.isArray(tob.lots)) ? tob.lots : [];
  var eam = agingMax !== undefined ? agingMax : effectiveAgingMax(tob);
  return lots.reduce(function (mx: number, l: any) {
    if (!lotInScope(l, scope, eam)) return mx;
    var a = lotAge(l);
    return (a != null && a > mx) ? a : mx;
  }, 0);
}

/** Active weight of the lots in `scope`. `null` scope → the full active total
 *  (identical to heldWeight, so an unfiltered card is untouched). */
export function scopedHeldWeight(tob: any, scope: WeightScope | null, agingMax?: any): number {
  if (!scope) return heldWeight(tob);
  var lots = (tob && Array.isArray(tob.lots)) ? tob.lots : [];
  var eam = agingMax !== undefined ? agingMax : effectiveAgingMax(tob);
  return lots.reduce(function (sum: number, l: any) {
    return lotInScope(l, scope, eam) ? sum + safeNonNeg(l.weightG) : sum;
  }, 0);
}

export function lotMaturityBucket(
  lot: any,
  agingMax: any,
): "young" | "optimal" | "peak" | "tooOld" | null {
  if (!lot || lot.deletedAt) return null;
  // Maturity bands are CELLAR-only (see lotAgingStatus). An opened
  // jar isn't cellaring, so it gets no maturity band — it carries the separate
  // "ouvert depuis N" signal instead. (Was: any non-finished lot.)
  if (lot.status !== "cellar") return null;
  // An UNWEIGHED lot is an ABSENCE of data, not an empty tin — the
  // distinction `isUntrackedWeight` was created for, after `safeWeight("")
  // === 0` once made unweighed jars vanish from the session picker.
  //
  // This bail read `safeNonNeg(lot.weightG) <= 0`, which treats `""` as zero,
  // so a lot the user never weighed got NO maturity band while
  // `lotAgingStatus` — which has no weight test at all — went on calling it
  // overaged. The fiche then printed "1 lot trop vieux" over lot rows wearing
  // no badge, and the Home "À fumer rapidement" tile counted lots the list it
  // opens excluded. The state is ordinary: `addTobacco`'s starter lot is
  // created with `weightG: ""`, and `parseTobaccoCsv` blanks an unparsable
  // number.
  //
  // An EXPLICIT zero still bails, and must: an empty tin has nothing to
  // mature. That is the whole width of this exception.
  if (!isUntrackedWeight(lot.weightG) && safeNonNeg(lot.weightG) <= 0) return null;
  // Upper bands reuse the SAME rule as everywhere else: lotAgingStatus,
  // driven by the tobacco's agingMax + its lot age. No second age formula.
  var st = lotAgingStatus(lot, agingMax);
  if (st === "overaged") return "tooOld";
  if (st === "approaching") return "peak";
  // Lower split (young → optimal). The boundary is 40% of the tobacco's own
  // aging target (type-aware via agingMax), or 2y when no target is set.
  var d = lot.dateProduction || lot.datePurchased || "";
  var days = d ? daysSince(String(d)) : null;
  var years = (days != null && days >= 0) ? days / 365.25 : 0;
  var ag = parseAgingMax(agingMax);
  var optimalStart = ag.max > 0 ? Math.max(1, ag.max * OPTIMAL_START_FRACTION) : OPTIMAL_MIN_YEARS;
  return years >= optimalStart ? "optimal" : "young";
}

export function computeCellarMaturity(tobaccos: any[] | null | undefined): CellarMaturity {
  var empty: CellarMaturity = { young: 0, optimal: 0, peak: 0, tooOld: 0, total: 0, optimalPct: 0 };
  if (!Array.isArray(tobaccos)) return empty;
  var young = 0, optimal = 0, peak = 0, tooOld = 0;
  tobaccos.forEach(function (t: any) {
    if (!t || t.deletedAt) return;
    var lots = Array.isArray(t.lots) ? t.lots : [];
    lots.forEach(function (l: any) {
      var b = lotMaturityBucket(l, effectiveAgingMax(t));
      if (b === "young") young += 1;
      else if (b === "optimal") optimal += 1;
      else if (b === "peak") peak += 1;
      else if (b === "tooOld") tooOld += 1;
    });
  });
  var total = young + optimal + peak + tooOld;
  return {
    young: young, optimal: optimal, peak: peak, tooOld: tooOld, total: total,
    optimalPct: total ? Math.round((optimal / total) * 100) : 0,
  };
}

// ── À point — tobaccos that have matured into their optimal window ───────────
// The POSITIVE counterpart to computeWatchlist. The watchlist warns
// about problems (a lot past its peak → "trop âgé", or in its peak window →
// "pic proche", or running low). This surfaces the good news: tobaccos that
// have reached their `optimal` maturity band and are ready to be enjoyed at
// their best, with no urgency. Kept DISJOINT from the watchlist by
// construction — a tobacco qualifies only when it has ≥1 `optimal` lot AND no
// `peak`/`tooOld` lot (those are the watchlist's territory), so a blend never
// appears in both the "À point" and "À surveiller" aging lists. Pure; tested
// in cellarInsights.test.ts.
export interface PeakItem {
  tobaccoId: string;
  optimalLots: number; // how many lots of this tobacco are in the optimal band
}
export function computeCellarPeaks(
  tobaccos: any[] | null | undefined,
  opts?: { max?: number },
): PeakItem[] {
  var max = (opts && opts.max) || 5;
  var out: PeakItem[] = [];
  (tobaccos || []).forEach(function (t: any) {
    if (!t || t.deletedAt || t.id === undefined || t.id === null) return;
    var lots = Array.isArray(t.lots) ? t.lots : [];
    var optimal = 0, higher = false;
    lots.forEach(function (l: any) {
      var b = lotMaturityBucket(l, effectiveAgingMax(t));
      if (b === "optimal") optimal += 1;
      else if (b === "peak" || b === "tooOld") higher = true;
    });
    // Only when it's cleanly in the optimal window (no lot already at/over peak,
    // which the watchlist owns).
    if (optimal > 0 && !higher) {
      out.push({ tobaccoId: String(t.id), optimalLots: optimal });
    }
  });
  out.sort(function (a, b) {
    return b.optimalLots - a.optimalLots
      || String(a.tobaccoId).localeCompare(String(b.tobaccoId));
  });
  return out.slice(0, Math.max(0, max));
}

// ── Consommation de l'année + tendance vs. l'année précédente ────────────────
export interface YearConsumption {
  thisYear: number;         // grams consumed in `year`
  lastYear: number;         // grams consumed in `year - 1`
  trendPct: number | null;  // % change vs last year, null when last year = 0
}
export function computeYearConsumption(
  sessions: any[] | null | undefined,
  year: number,
): YearConsumption {
  if (!Array.isArray(sessions)) return { thisYear: 0, lastYear: 0, trendPct: null };
  var ty = 0, ly = 0;
  sessions.forEach(function (s: any) {
    if (!s || !s.date || s.deletedAt) return;
    var yr = Number(String(s.date).slice(0, 4));
    var w = safeNonNeg(s.weightG);
    if (w <= 0) return;
    if (yr === year) ty += w;
    else if (yr === year - 1) ly += w;
  });
  return {
    thisYear: Math.round(ty), lastYear: Math.round(ly),
    trendPct: ly > 0 ? Math.round(((ty - ly) / ly) * 100) : null,
  };
}

// ── Autonomie de la cave — how long the stock lasts at the recent pace ───────
// Shown as a footer line in the "Cave à maturité" tile. Estimates
// the time before the cellar is emptied, from the remaining active stock and
// the recent smoking rate. Returns null when it can't estimate (no stock, or
// no measurable consumption in the window — e.g. accounting off → every
// session weighs 0). Pure; `nowMs` is always explicit for testability.
export interface CellarDepletion {
  totalGrams: number;     // remaining active stock (cellar + jar)
  gramsPerDay: number;    // recent consumption rate
  daysRemaining: number;  // totalGrams / gramsPerDay
  windowDays: number;     // effective sampling span used for the rate
}
export function computeCellarDepletion(
  tobaccos: any[] | null | undefined,
  sessions: any[] | null | undefined,
  nowMs: number = Date.now(),
  windowDays: number = 180,
  floorDays: number = 30,
): CellarDepletion | null {
  if (!Array.isArray(tobaccos)) return null;
  // Remaining stock across active, non-trashed lots (cellar + jar).
  var totalGrams = 0;
  tobaccos.forEach(function (t: any) {
    if (!t || t.deletedAt) return;
    (Array.isArray(t.lots) ? t.lots : []).forEach(function (l: any) {
      if (!l || l.deletedAt || l.status === "finished") return;
      var w = safeNonNeg(l.weightG);
      if (w > 0) totalGrams += w;
    });
  });
  if (totalGrams <= 0) return null;
  // Consumption over the trailing window.
  var cutoff = nowMs - windowDays * 86400000;
  var sampleGrams = 0;
  var oldestMs = NaN;
  (sessions || []).forEach(function (s: any) {
    if (!s || s.deletedAt || !s.date) return;
    var w = safeNonNeg(s.weightG);
    if (w <= 0) return;
    var ms = new Date(String(s.date) + "T12:00:00").getTime();
    if (isNaN(ms) || ms < cutoff || ms > nowMs) return;
    sampleGrams += w;
    if (isNaN(oldestMs) || ms < oldestMs) oldestMs = ms;
  });
  if (sampleGrams <= 0 || isNaN(oldestMs)) return null;
  // Effective span: oldest in-window session → now, floored so a couple of
  // very recent sessions don't extrapolate to a wild rate, capped at window.
  var spanDays = Math.floor((nowMs - oldestMs) / 86400000) + 1;
  var effDays = Math.min(windowDays, Math.max(floorDays, spanDays));
  var gramsPerDay = sampleGrams / effDays;
  if (gramsPerDay <= 0) return null;
  return {
    totalGrams: Math.round(totalGrams),
    gramsPerDay: gramsPerDay,
    daysRemaining: totalGrams / gramsPerDay,
    windowDays: effDays,
  };
}

// ── Activité — heatmap grid (weeks columns × 7 rows), levels 0-3 ─────────────
export interface ActivityHeatmap { grid: number[][]; total: number; }
function localDayKey(ms: number): string {
  var d = new Date(ms);
  var m = String(d.getMonth() + 1);
  var dd = String(d.getDate());
  return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (dd.length < 2 ? "0" + dd : dd);
}
export function computeActivityHeatmap(
  sessions: any[] | null | undefined,
  weeks: number,
  nowMs: number,
): ActivityHeatmap {
  var cols = Math.max(1, Math.floor(weeks) || 1);
  var byDay: Record<string, number> = {};
  var total = 0;
  if (Array.isArray(sessions)) sessions.forEach(function (s: any) {
    if (!s || !s.date || s.deletedAt) return;
    var k = String(s.date).slice(0, 10);
    byDay[k] = (byDay[k] || 0) + 1;
    total += 1;
  });
  var DAY = 86400000;
  var grid: number[][] = [];
  for (var c = 0; c < cols; c++) grid.push([0, 0, 0, 0, 0, 0, 0]);
  var span = cols * 7;
  for (var i = 0; i < span; i++) {
    var key = localDayKey(nowMs - (span - 1 - i) * DAY);
    var n = byDay[key] || 0;
    var lvl = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
    var col = grid[Math.floor(i / 7)] as number[];
    col[i % 7] = lvl;
  }
  return { grid: grid, total: total };
}

// The month index (0-11, local time) of each heatmap COLUMN, aligned
// 1:1 with computeActivityHeatmap(...).grid. Lets the Home "Activité" strip
// print month ticks (like the Stats calendar) without the pure heatmap builder
// having to know about locale month names — the view maps these indices through
// monthsShort(lang). Uses the SAME left→right / today-is-last-column geometry as
// computeActivityHeatmap so the labels line up with the cells.
export function activityHeatmapMonths(weeks: number, nowMs: number): number[] {
  var cols = Math.max(1, Math.floor(weeks) || 1);
  var DAY = 86400000;
  var span = cols * 7;
  var out: number[] = [];
  for (var c = 0; c < cols; c++) {
    // Month of this column's most recent day (day-row index 6).
    var i = c * 7 + 6;
    out.push(new Date(nowMs - (span - 1 - i) * DAY).getMonth());
  }
  return out;
}
