import { describe, it, expect } from "vitest";
import {
  computeCellarMaturity, computeYearConsumption, computeActivityHeatmap,
  lotMaturityBucket, activityHeatmapMonths, computeCellarDepletion,
  computeCellarPeaks, scopeFromStatusFilter, scopedHeldWeight, scopeLabelKey,
  isRecentPurchase, lotInScope, RECENT_PURCHASE_DAYS, scopedOldestAgeDays,
} from "../utils/cellarInsights";
import { heldWeight } from "../utils/lotUtils";

// A fixed "now" so age-based buckets are deterministic.
const NOW = Date.parse("2026-07-01T12:00:00Z");
// ms arithmetic so fractional years (4.5) are handled correctly.
const yearsAgo = (y: number) => new Date(NOW - Math.round(y * 365.25 * 86400000)).toISOString().slice(0, 10);

describe("computeCellarMaturity", () => {
  it("returns an empty distribution on invalid input", () => {
    expect(computeCellarMaturity(null)).toEqual({ young: 0, optimal: 0, peak: 0, tooOld: 0, total: 0, optimalPct: 0 });
  });

  it("buckets active lots by age; skips finished / empty / trashed", () => {
    const tobs = [
      { id: 1, agingMax: "", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(0) }, // young (<2y)
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4) }, // optimal (>=2y)
        { status: "finished", weightG: "0", dateProduction: yearsAgo(5) }, // finished → skip
        { status: "cellar", weightG: "0", dateProduction: yearsAgo(3) },   // empty → skip
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(3), deletedAt: "x" }, // trashed → skip
      ] },
    ];
    const r = computeCellarMaturity(tobs);
    expect(r.young).toBe(1);
    expect(r.optimal).toBe(1);
    expect(r.total).toBe(2);
    expect(r.optimalPct).toBe(50);
  });

  it("flags peak (approaching) and tooOld (overaged) via lotAgingStatus", () => {
    const tobs = [
      { id: 1, agingMax: "5", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4.5) }, // within last year before peak → approaching
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(8) },   // past max → overaged
      ] },
    ];
    const r = computeCellarMaturity(tobs);
    expect(r.peak).toBe(1);
    expect(r.tooOld).toBe(1);
  });
});

describe("activityHeatmapMonths", () => {
  it("returns one month index per column, aligned with the heatmap grid", () => {
    const months = activityHeatmapMonths(10, NOW);
    const grid = computeActivityHeatmap([], 10, NOW).grid;
    expect(months).toHaveLength(grid.length); // 10 columns
    months.forEach((m) => { expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(11); });
  });
  it("the last column is the current month (today lives in the last column)", () => {
    const months = activityHeatmapMonths(10, NOW);
    expect(months[months.length - 1]).toBe(new Date(NOW).getMonth());
  });
  it("clamps weeks to at least 1 column", () => {
    expect(activityHeatmapMonths(0, NOW)).toHaveLength(1);
  });
});

describe("computeYearConsumption", () => {
  it("sums grams for the year and the previous year, with a trend", () => {
    const sessions = [
      { date: "2026-02-01", weightG: "3" },
      { date: "2026-05-01", weightG: "3" },   // 2026 → 6g
      { date: "2025-06-01", weightG: "4" },   // 2025 → 4g
      { date: "2024-01-01", weightG: "9" },   // older → ignored
      { date: "2026-03-01", weightG: "0" },   // no weight → ignored
      { date: "2026-04-01", weightG: "2", deletedAt: "x" }, // trashed → ignored
    ];
    const r = computeYearConsumption(sessions, 2026);
    expect(r.thisYear).toBe(6);
    expect(r.lastYear).toBe(4);
    expect(r.trendPct).toBe(50); // (6-4)/4
  });

  it("trend is null when last year had no consumption", () => {
    const r = computeYearConsumption([{ date: "2026-01-01", weightG: "5" }], 2026);
    expect(r.thisYear).toBe(5);
    expect(r.lastYear).toBe(0);
    expect(r.trendPct).toBeNull();
  });

  it("returns zeros on invalid input", () => {
    expect(computeYearConsumption(null, 2026)).toEqual({ thisYear: 0, lastYear: 0, trendPct: null });
  });

  it("a forged Infinity/NaN weightG is coerced to 0, not propagated", () => {
    const r = computeYearConsumption([
      { date: "2026-02-01", weightG: "Infinity" },
      { date: "2026-03-01", weightG: "NaN" },
      { date: "2026-04-01", weightG: "-5" },
      { date: "2026-05-01", weightG: "3" },
    ], 2026);
    expect(Number.isFinite(r.thisYear)).toBe(true);
    expect(r.thisYear).toBe(3); // only the one valid session counts
  });
});

describe("computeActivityHeatmap", () => {
  it("builds a weeks×7 grid ending today, with levels 0-3", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    const sessions = [
      { date: today }, { date: today }, { date: today }, // 3 today → level 3
    ];
    const hm = computeActivityHeatmap(sessions, 4, NOW);
    expect(hm.grid).toHaveLength(4);
    hm.grid.forEach((col) => expect(col).toHaveLength(7));
    expect(hm.total).toBe(3);
    // the very last cell (bottom-right) is "today"
    expect(hm.grid[3]![6]).toBe(3);
  });

  it("counts total across all sessions and never throws on garbage", () => {
    expect(computeActivityHeatmap(null, 4, NOW)).toEqual({ grid: expect.any(Array), total: 0 });
    const hm = computeActivityHeatmap([{ date: "2020-01-01" }, { foo: 1 }], 2, NOW);
    expect(hm.total).toBe(1);
  });
});

describe("lotMaturityBucket", () => {
  it("returns null for finished / empty / trashed lots", () => {
    expect(lotMaturityBucket({ status: "finished", weightG: "0" }, "")).toBeNull();
    expect(lotMaturityBucket({ status: "cellar", weightG: "0" }, "")).toBeNull();
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", deletedAt: "x" }, "")).toBeNull();
    expect(lotMaturityBucket(null, "")).toBeNull();
  });

  it("returns null for a JAR lot — maturity is cellar-only", () => {
    // An opened jar isn't cellaring, so it gets no maturity band (it carries
    // the separate "ouvert depuis N" signal instead). A cellar lot of the same
    // age still buckets normally.
    expect(lotMaturityBucket({ status: "jar", weightG: "50", dateProduction: yearsAgo(4) }, "")).toBeNull();
    expect(lotMaturityBucket({ status: "jar", weightG: "50", dateProduction: yearsAgo(8) }, "5")).toBeNull();
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", dateProduction: yearsAgo(4) }, "")).toBe("optimal");
  });

  it("classifies young (<2y) vs optimal (>=2y) with no aging target", () => {
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", dateProduction: yearsAgo(0.5) }, "")).toBe("young");
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", dateProduction: yearsAgo(4) }, "")).toBe("optimal");
  });

  it("classifies peak (approaching) and tooOld (overaged) via agingMax", () => {
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", dateProduction: yearsAgo(4.5) }, "5")).toBe("peak");
    expect(lotMaturityBucket({ status: "cellar", weightG: "50", dateProduction: yearsAgo(8) }, "5")).toBe("tooOld");
  });

  it("agrees with computeCellarMaturity's totals", () => {
    const tobs = [
      { id: 1, agingMax: "5", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(0.5) }, // young
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(3) },   // optimal
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4.5) }, // peak
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(8) },   // tooOld
      ] },
    ];
    const m = computeCellarMaturity(tobs);
    expect([m.young, m.optimal, m.peak, m.tooOld]).toEqual([1, 1, 1, 1]);
  });
});

describe("computeCellarMaturity — family default when agingMax is empty", () => {
  it("uses the family aging target so the type drives the bands without any agingMax", () => {
    const tobs = [
      // Aromatique, no agingMax → family default 3 → a 4y lot is overaged.
      { id: 1, category: "Aromatique", agingMax: "", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4) },
      ] },
      // Virginia, no agingMax → family default 15-25 → 4y lot young.
      { id: 2, category: "Virginia", agingMax: "", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4) },
      ] },
      // Virginia, no agingMax, 12y lot → optimal (>= 40% of 25 = 10, < 15).
      { id: 3, category: "Virginia", agingMax: "", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(12) },
      ] },
    ];
    const r = computeCellarMaturity(tobs);
    expect(r.tooOld).toBe(1);  // the aromatic
    expect(r.young).toBe(1);   // young Virginia
    expect(r.optimal).toBe(1); // mature Virginia
    expect(r.total).toBe(3);
  });

  it("an explicit agingMax overrides the family default", () => {
    const tobs = [
      // Virginia BUT the user pinned agingMax=3 → a 4y lot is overaged.
      { id: 1, category: "Virginia", agingMax: "3", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4) },
      ] },
    ];
    expect(computeCellarMaturity(tobs).tooOld).toBe(1);
  });

  it("an unknown family with no agingMax has no aging target (young/optimal only by 2y default)", () => {
    const tobs = [
      { id: 1, category: "Autre", agingMax: "", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(4) }, // optimal (>=2y), never overaged
      ] },
    ];
    const r = computeCellarMaturity(tobs);
    expect(r.optimal).toBe(1);
    expect(r.tooOld).toBe(0);
    expect(r.peak).toBe(0);
  });
});

describe("lotMaturityBucket — type-aware optimal start (40% of agingMax)", () => {
  it("a long-keeping tobacco (agingMax 15) stays young longer", () => {
    // optimalStart = 15*0.4 = 6y
    const lot = (y: number) => ({ status: "cellar", weightG: "50", dateProduction: yearsAgo(y) });
    expect(lotMaturityBucket(lot(4), "15")).toBe("young");    // < 6
    expect(lotMaturityBucket(lot(8), "15")).toBe("optimal");  // >= 6, < approaching(14)
  });
  it("a short-keeping tobacco (agingMax 3) reaches optimal sooner", () => {
    // optimalStart = 3*0.4 = 1.2y; approaching at age > 2 (max-1)
    const lot = (y: number) => ({ status: "cellar", weightG: "50", dateProduction: yearsAgo(y) });
    expect(lotMaturityBucket(lot(0.8), "3")).toBe("young");   // < 1.2
    expect(lotMaturityBucket(lot(1.5), "3")).toBe("optimal"); // >= 1.2, < 2
  });
  it("falls back to 2y when no aging target is set", () => {
    const lot = (y: number) => ({ status: "cellar", weightG: "50", dateProduction: yearsAgo(y) });
    expect(lotMaturityBucket(lot(1), "")).toBe("young");
    expect(lotMaturityBucket(lot(3), "")).toBe("optimal");
  });
});

describe("computeCellarDepletion", () => {
  const dAgo = (n: number) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

  it("returns null when there is no active stock", () => {
    const tobs = [{ lots: [{ status: "finished", weightG: "0" }] }];
    expect(computeCellarDepletion(tobs, [{ date: dAgo(5), weightG: "3" }], NOW)).toBeNull();
    expect(computeCellarDepletion(null, [], NOW)).toBeNull();
  });

  it("returns null when there is no measurable consumption (accounting off)", () => {
    const tobs = [{ lots: [{ status: "cellar", weightG: "100" }] }];
    // every session weighs 0 → no rate → cannot estimate
    expect(computeCellarDepletion(tobs, [{ date: dAgo(5), weightG: "0" }], NOW)).toBeNull();
    expect(computeCellarDepletion(tobs, [], NOW)).toBeNull();
  });

  it("floors the span so recent-only history doesn't over-extrapolate", () => {
    // 100 g stock, one 30 g session 2 days ago → span floored to 30 days →
    // rate = 30/30 = 1 g/day → 100 days remaining.
    const tobs = [{ lots: [{ status: "cellar", weightG: "100" }] }];
    const r = computeCellarDepletion(tobs, [{ date: dAgo(2), weightG: "30" }], NOW)!;
    expect(r.totalGrams).toBe(100);
    expect(r.windowDays).toBe(30);
    expect(r.gramsPerDay).toBeCloseTo(1, 5);
    expect(r.daysRemaining).toBeCloseTo(100, 5);
  });

  it("sums stock across active lots (cellar + jar), ignores finished/trashed", () => {
    const tobs = [
      { lots: [{ status: "cellar", weightG: "60" }, { status: "jar", weightG: "40" }] },
      { lots: [{ status: "finished", weightG: "50" }, { status: "cellar", weightG: "10", deletedAt: "x" }] },
      { deletedAt: "x", lots: [{ status: "cellar", weightG: "999" }] },
    ];
    const r = computeCellarDepletion(tobs, [{ date: dAgo(1), weightG: "20" }], NOW)!;
    expect(r.totalGrams).toBe(100); // 60 + 40 only
  });

  it("uses the actual span for the rate over a longer window", () => {
    // ~90-day span, 45 g consumed → ~0.5 g/day; 200 g stock → ~400 days.
    const tobs = [{ lots: [{ status: "cellar", weightG: "200" }] }];
    const r = computeCellarDepletion(tobs, [{ date: dAgo(89), weightG: "45" }], NOW)!;
    expect(r.gramsPerDay).toBeCloseTo(0.5, 1);
    expect(r.daysRemaining).toBeGreaterThan(360);
    expect(r.daysRemaining).toBeLessThan(440);
  });
});

// "À point" — tobaccos matured into their optimal window, DISJOINT
// from the watchlist (excludes any tobacco with a peak/tooOld lot).
describe("computeCellarPeaks", () => {
  // agingMax "10" → optimal window starts at 40% = 4y; peak (approaching) is the
  // last year before 10 (9-10); tooOld > 10.
  it("returns invalid input as an empty list", () => {
    expect(computeCellarPeaks(null)).toEqual([]);
    expect(computeCellarPeaks(undefined)).toEqual([]);
  });

  it("includes a tobacco whose lot is in the optimal band", () => {
    const tobs = [{ id: 1, agingMax: "10", lots: [
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(5) }, // 5y → optimal
    ] }];
    expect(computeCellarPeaks(tobs)).toEqual([{ tobaccoId: "1", optimalLots: 1 }]);
  });

  it("excludes a tobacco that also has a peak or tooOld lot (watchlist territory)", () => {
    const withPeak = [{ id: 1, agingMax: "10", lots: [
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(5) },  // optimal
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(9.5) }, // peak
    ] }];
    expect(computeCellarPeaks(withPeak)).toEqual([]);
    const withOld = [{ id: 2, agingMax: "10", lots: [
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(5) },  // optimal
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(12) }, // tooOld
    ] }];
    expect(computeCellarPeaks(withOld)).toEqual([]);
  });

  it("excludes young-only and trashed tobaccos", () => {
    const young = [{ id: 1, agingMax: "10", lots: [
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(1) }, // young (<4y)
    ] }];
    expect(computeCellarPeaks(young)).toEqual([]);
    const trashed = [{ id: 2, deletedAt: "x", agingMax: "10", lots: [
      { status: "cellar", weightG: "50", dateProduction: yearsAgo(5) },
    ] }];
    expect(computeCellarPeaks(trashed)).toEqual([]);
  });

  it("counts multiple optimal lots and sorts by that count, then id; respects max", () => {
    const tobs = [
      { id: 1, agingMax: "10", lots: [{ status: "cellar", weightG: "50", dateProduction: yearsAgo(5) }] },
      { id: 2, agingMax: "10", lots: [
        { status: "cellar", weightG: "50", dateProduction: yearsAgo(5) },
        // maturity is cellar-only, so both optimal lots are "cellar"
        // (a jar no longer buckets into optimal).
        { status: "cellar", weightG: "20", dateProduction: yearsAgo(6) },
      ] },
    ];
    expect(computeCellarPeaks(tobs)).toEqual([
      { tobaccoId: "2", optimalLots: 2 },
      { tobaccoId: "1", optimalLots: 1 },
    ]);
    expect(computeCellarPeaks(tobs, { max: 1 })).toEqual([{ tobaccoId: "2", optimalLots: 2 }]);
  });
});


// ── the weight a FILTERED inventory card shows ─────────────
// Reported from the app: filtered to "En pot", a blend with 1 jar lot and 18
// cellar lots displayed 945 g — the whole active stock, i.e. a number about
// the lots the user had just filtered OUT.
describe("scopeFromStatusFilter", () => {
  it("maps the lot-level filters, including the two aging names", () => {
    expect(scopeFromStatusFilter("jar")).toBe("jar");
    expect(scopeFromStatusFilter("cellar")).toBe("cellar");
    expect(scopeFromStatusFilter("young")).toBe("young");
    expect(scopeFromStatusFilter("optimal")).toBe("optimal");
    // App.tsx filters these two through lotAgingStatus; lotMaturityBucket
    // names the same two bands "peak" / "tooOld".
    expect(scopeFromStatusFilter("approaching")).toBe("peak");
    expect(scopeFromStatusFilter("overaged")).toBe("tooOld");
  });

  it("returns null for every filter that is NOT a lot-level slice", () => {
    // These select TOBACCOS, not lots, so their card keeps the full total.
    for (const f of ["active", "all", "finished", "disposed", "norebuy",
                     "used_up", "nolot", "lowstock", "wish", "", null, undefined]) {
      expect(scopeFromStatusFilter(f as any), String(f)).toBeNull();
    }
  });
});

describe("scopedHeldWeight", () => {
  // 1 jar + 2 cellar lots of different ages, mirroring the reported card.
  const tob = {
    agingMax: "10",
    lots: [
      { id: 1, status: "jar", weightG: "45" },
      { id: 2, status: "cellar", weightG: "100", datePurchased: yearsAgo(0.5) },  // young
      { id: 3, status: "cellar", weightG: "200", datePurchased: yearsAgo(20) },   // tooOld
      { id: 4, status: "finished", weightG: "0" },
      { id: 5, status: "cellar", weightG: "500", deletedAt: "2026-01-01" },       // trashed
    ],
  };

  it("no scope → the full active total, identical to heldWeight", () => {
    expect(scopedHeldWeight(tob, null)).toBe(345);
    expect(scopedHeldWeight(tob, null)).toBe(heldWeight(tob));
  });

  it("jar / cellar scopes count only their own lots", () => {
    expect(scopedHeldWeight(tob, "jar")).toBe(45);
    expect(scopedHeldWeight(tob, "cellar")).toBe(300);
    // The two together are the whole active stock — nothing double-counted,
    // nothing dropped.
    expect(scopedHeldWeight(tob, "jar") + scopedHeldWeight(tob, "cellar"))
      .toBe(scopedHeldWeight(tob, null));
  });

  it("a maturity scope counts only the lots in that band", () => {
    expect(scopedHeldWeight(tob, "young")).toBe(100);
    expect(scopedHeldWeight(tob, "tooOld")).toBe(200);
    expect(scopedHeldWeight(tob, "optimal")).toBe(0);
    expect(scopedHeldWeight(tob, "peak")).toBe(0);
  });

  it("never counts a finished or trashed lot, in any scope", () => {
    const all = (["jar", "cellar", "young", "optimal", "peak", "tooOld"] as const)
      .reduce((s, sc) => s + scopedHeldWeight(tob, sc), 0);
    // 45 + 300 + (100 + 200 already inside the 300) → the bands are a
    // partition OF the cellar lots, so the finished (0 g) and the trashed
    // (500 g) lots are in neither total.
    expect(all).toBe(45 + 300 + 300);
    expect(scopedHeldWeight(tob, "cellar")).toBe(300); // the 500 g trashed lot is excluded
  });

  it("a jar lot has NO maturity band (cellar-only)", () => {
    const jarOnly = { agingMax: "10", lots: [{ id: 1, status: "jar", weightG: "80", datePurchased: yearsAgo(20) }] };
    expect(scopedHeldWeight(jarOnly, "jar")).toBe(80);
    expect(scopedHeldWeight(jarOnly, "tooOld")).toBe(0);
  });

  it("degrades safely on junk input", () => {
    expect(scopedHeldWeight(null, "jar")).toBe(0);
    expect(scopedHeldWeight({}, "cellar")).toBe(0);
    expect(scopedHeldWeight({ lots: "nope" }, "young")).toBe(0);
    expect(scopedHeldWeight({ lots: [{ status: "cellar", weightG: "abc" }] }, "cellar")).toBe(0);
  });
});

// ── ONE label map for every scoped weight ───────────────────────────────
// The fiche's hero label was hardcoded to `f_cellar`, so an unfiltered fiche
// announced "EN CAVE" over a total that includes the jars, and a fiche opened
// from the "En pot" filter said "EN CAVE" over a jar weight. Reported from the
// app. A shared resolver is what stops that from happening again.
describe("scopeLabelKey", () => {
  it("names each scope, and calls the unscoped total 'En stock'", () => {
    expect(scopeLabelKey(null)).toBe("lbl_in_stock");
    expect(scopeLabelKey("jar")).toBe("f_jars");
    expect(scopeLabelKey("cellar")).toBe("f_cellar");
    expect(scopeLabelKey("young")).toBe("mat_young");
    expect(scopeLabelKey("optimal")).toBe("mat_optimal");
    expect(scopeLabelKey("peak")).toBe("mat_peak");
    expect(scopeLabelKey("tooOld")).toBe("mat_old");
  });

  it("never labels an unscoped or jar weight 'En cave'", () => {
    // The exact two mislabels that were reported.
    expect(scopeLabelKey(null)).not.toBe("f_cellar");
    expect(scopeLabelKey("jar")).not.toBe("f_cellar");
  });

  it("every scope the filter can produce has a label", () => {
    for (const f of ["jar", "cellar", "young", "optimal", "approaching", "overaged"]) {
      const scope = scopeFromStatusFilter(f);
      expect(scope, f).not.toBeNull();
      expect(scopeLabelKey(scope), f).toBeTruthy();
    }
  });
});

// ── "Achats récents" (< 3 months) ─────────────────────────
describe("isRecentPurchase", () => {
  const daysAgo = (d: number) =>
    new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  it("is 90 days — three months", () => {
    expect(RECENT_PURCHASE_DAYS).toBe(90);
  });

  it("accepts a purchase inside the window, rejects one outside", () => {
    expect(isRecentPurchase({ datePurchased: daysAgo(1) })).toBe(true);
    expect(isRecentPurchase({ datePurchased: daysAgo(89) })).toBe(true);
    expect(isRecentPurchase({ datePurchased: daysAgo(200) })).toBe(false);
  });

  it("uses datePurchased ONLY — a production date is not an acquisition", () => {
    expect(isRecentPurchase({ dateProduction: daysAgo(2) })).toBe(false);
    expect(isRecentPurchase({ dateProduction: daysAgo(2), datePurchased: daysAgo(400) })).toBe(false);
  });

  it("unknown is not new, and junk never throws", () => {
    expect(isRecentPurchase({ datePurchased: "" })).toBe(false);
    expect(isRecentPurchase({})).toBe(false);
    expect(isRecentPurchase(null)).toBe(false);
    expect(isRecentPurchase({ datePurchased: "not-a-date" })).toBe(false);
    // A FUTURE date counts as recent: daysSince clamps it to 0, and in
    // practice a future purchase date is a same-day typo.
    expect(isRecentPurchase({ datePurchased: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) })).toBe(true);
  });

  it("is a lot-level SCOPE like the others", () => {
    expect(scopeFromStatusFilter("recent")).toBe("recent");
    expect(scopeLabelKey("recent")).toBe("f_recent");
    const recentLot = { status: "cellar", weightG: "50", datePurchased: daysAgo(10) };
    const oldLot = { status: "cellar", weightG: "70", datePurchased: daysAgo(400) };
    expect(lotInScope(recentLot, "recent")).toBe(true);
    expect(lotInScope(oldLot, "recent")).toBe(false);
    // …so the card/fiche weight narrows to the recent lots.
    expect(scopedHeldWeight({ lots: [recentLot, oldLot] }, "recent")).toBe(50);
  });

  it("a finished or trashed lot is never in the recent scope", () => {
    // It holds no stock, and the filter is about what you still have.
    expect(lotInScope({ status: "finished", datePurchased: daysAgo(3) }, "recent")).toBe(false);
    expect(lotInScope({ status: "cellar", deletedAt: "x", datePurchased: daysAgo(3) }, "recent")).toBe(false);
  });
});

// ── one oldest-age helper for four call sites ─────────────
// The fiche, the card, the list sort and the group sort had each grown their
// own copy of this reduce, and two of them still used oldestAge(tob) — which
// spans every non-finished lot AND counts soft-deleted ones.
describe("scopedOldestAgeDays", () => {
  const tob = {
    agingMax: "10",
    lots: [
      { status: "jar", weightG: "10", datePurchased: yearsAgo(1) },
      { status: "cellar", weightG: "10", datePurchased: yearsAgo(20) },
      { status: "cellar", weightG: "10", datePurchased: yearsAgo(200), deletedAt: "x" }, // trashed
      { status: "finished", weightG: "0", datePurchased: yearsAgo(300) },
    ],
  };

  it("returns the oldest lot of the scope, not of the tobacco", () => {
    const jar = scopedOldestAgeDays(tob, "jar");
    const cellar = scopedOldestAgeDays(tob, "cellar");
    expect(jar).toBeGreaterThan(300);      // ~1 year
    expect(jar).toBeLessThan(450);
    expect(cellar).toBeGreaterThan(7000);  // ~20 years
  });

  it("unscoped is the oldest ACTIVE lot", () => {
    expect(scopedOldestAgeDays(tob, null)).toBe(scopedOldestAgeDays(tob, "cellar"));
  });

  it("never counts a trashed or finished lot — the oldestAge(tob) gap", () => {
    // The 200y trashed and 300y finished lots must not win.
    expect(scopedOldestAgeDays(tob, null)).toBeLessThan(20000);
  });

  it("0 when the scope is empty or the dates are missing", () => {
    expect(scopedOldestAgeDays({ lots: [] }, "jar")).toBe(0);
    expect(scopedOldestAgeDays(null, "jar")).toBe(0);
    expect(scopedOldestAgeDays({ lots: [{ status: "jar", weightG: "5" }] }, "jar")).toBe(0);
  });
});
