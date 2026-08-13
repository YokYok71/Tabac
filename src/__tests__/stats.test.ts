/**
 * Property + unit tests for the extracted stats module.
 *
 * computeChartStats, computeTopTobaccos, computeTopPipes used to live
 * inline in App.tsx (~120 lines of `useMemo`). Extracting them lets us
 * fuzz the chart pipeline directly — the realistic threat is a forged
 * import / tampered backup that smuggles Infinity / NaN / non-strings
 * into session fields, which would otherwise propagate silently into
 * every chart.
 *
 * Invariants enforced:
 *   - every numeric output is a finite non-negative number (no NaN, no Infinity)
 *   - lengths and shapes match the documented signature
 *   - never throws on any combination of garbage inputs
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  safeNonNeg,
  computeTopTobaccos,
  computeTopPipes,
  computeChartStats,
  monthKeysLast12,
} from "../utils/stats";

// ── arbitraries ─────────────────────────────────────────────────────────────

const arbGarbage = (): fc.Arbitrary<unknown> => fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
  fc.constant("Infinity"),
  fc.constant("NaN"),
  fc.string({ maxLength: 6 }),
  fc.integer({ min: -100, max: 1000 }),
  fc.float({ noNaN: false, min: Math.fround(-50), max: Math.fround(500) }),
  fc.boolean(),
);

const arbLot = () => fc.record({
  status: fc.constantFrom("cellar", "jar", "finished"),
  weightG: arbGarbage(),
});

const arbTobacco = () => fc.record({
  id: fc.oneof(fc.integer({ min: 1, max: 999 }), fc.string({ minLength: 1, maxLength: 4 })),
  brand: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("")),
  name: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("")),
  category: fc.oneof(fc.constantFrom("Anglais", "Virginia", "Burley"), fc.constant("")),
  rating: fc.oneof(fc.integer({ min: 0, max: 5 }), arbGarbage()),
  force: arbGarbage(),
  roomNote: arbGarbage(),
  taste: arbGarbage(),
  lots: fc.array(arbLot(), { minLength: 0, maxLength: 4 }),
});

const arbPipe = () => fc.record({
  id: fc.oneof(fc.integer({ min: 1, max: 999 }), fc.string({ minLength: 1, maxLength: 4 })),
  brand: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("")),
  name: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("")),
  shape: fc.oneof(fc.constantFrom("Billiard", "Apple", "Bulldog"), fc.constant("")),
  bowlMaterial: fc.oneof(fc.constantFrom("Bruyère", "Écume"), fc.constant("")),
  stemMaterial: fc.oneof(fc.constantFrom("Acrylique", "Ébonite"), fc.constant("")),
  status: fc.constantFrom("active", "finished"),
});

const arbSession = () => fc.record({
  tobaccoId: fc.oneof(fc.integer({ min: 1, max: 999 }), fc.constant("")),
  pipeId: fc.oneof(fc.integer({ min: 1, max: 999 }), fc.constant("")),
  date: fc.oneof(
    fc.constant("2026-01-15"),
    fc.constant("2026-02-20"),
    fc.constant("2025-12-31"),
    fc.constant(""),
    fc.constant(undefined),
  ),
  duration: arbGarbage(),
  weightG: arbGarbage(),
});

// ── safeNonNeg ──────────────────────────────────────────────────────────────

describe("safeNonNeg", () => {
  it("returns the number for finite non-negative inputs", () => {
    expect(safeNonNeg(0)).toBe(0);
    expect(safeNonNeg(42)).toBe(42);
    expect(safeNonNeg(2.5)).toBe(2.5);
    expect(safeNonNeg("10")).toBe(10);
    expect(safeNonNeg("3.14")).toBe(3.14);
  });

  it("returns 0 for negative numbers", () => {
    expect(safeNonNeg(-1)).toBe(0);
    expect(safeNonNeg("-5")).toBe(0);
  });

  it("returns 0 for NaN, Infinity, null, undefined, non-numeric strings", () => {
    expect(safeNonNeg(NaN)).toBe(0);
    expect(safeNonNeg(Infinity)).toBe(0);
    expect(safeNonNeg(-Infinity)).toBe(0);
    expect(safeNonNeg("Infinity")).toBe(0);
    expect(safeNonNeg("NaN")).toBe(0);
    expect(safeNonNeg(null)).toBe(0);
    expect(safeNonNeg(undefined)).toBe(0);
    expect(safeNonNeg("abc")).toBe(0);
    expect(safeNonNeg({})).toBe(0);
  });

  it("property: result is ALWAYS a finite non-negative number", () => {
    fc.assert(
      fc.property(arbGarbage(), function (v) {
        var n = safeNonNeg(v);
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});

// ── monthKeysLast12 ─────────────────────────────────────────────────────────

describe("monthKeysLast12", () => {
  it("returns 12 keys in YYYY-MM format ending at `now`", () => {
    var keys = monthKeysLast12(new Date(2026, 5, 15)); // June 2026 (month index 5)
    expect(keys.length).toBe(12);
    expect(keys[11]).toBe("2026-06");
    expect(keys[0]).toBe("2025-07");
    keys.forEach(k => expect(k).toMatch(/^\d{4}-\d{2}$/));
  });

  it("handles year boundary correctly", () => {
    var keys = monthKeysLast12(new Date(2026, 0, 15)); // January 2026
    expect(keys[11]).toBe("2026-01");
    expect(keys[0]).toBe("2025-02");
  });
});

// ── computeTopTobaccos ──────────────────────────────────────────────────────

describe("computeTopTobaccos", () => {
  it("returns [] when either input is null", () => {
    expect(computeTopTobaccos(null, [])).toEqual([]);
    expect(computeTopTobaccos([], null)).toEqual([]);
  });

  it("filters out sessions referring to unknown tobacco ids", () => {
    var tobs = [{ id: 1, brand: "P", name: "X" }];
    var sessions = [
      { tobaccoId: 1, duration: "30", weightG: "2.5" },
      { tobaccoId: 999, duration: "10", weightG: "1" }, // unknown
    ];
    var out = computeTopTobaccos(tobs, sessions);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe("1");
    expect(out[0]!.sessions).toBe(1);
  });

  it("sorts by weight then session count", () => {
    var tobs = [
      { id: 1, brand: "A", name: "1" },
      { id: 2, brand: "B", name: "2" },
    ];
    var sessions = [
      { tobaccoId: 1, duration: "30", weightG: "1" },
      { tobaccoId: 2, duration: "30", weightG: "5" },
    ];
    var out = computeTopTobaccos(tobs, sessions);
    expect(out[0]!.id).toBe("2"); // heavier wins
  });

  it("property: every output has finite non-negative numeric fields", () => {
    fc.assert(
      fc.property(
        fc.array(arbTobacco(), { minLength: 0, maxLength: 5 }),
        fc.array(arbSession(), { minLength: 0, maxLength: 10 }),
        function (tobs, sessions) {
          var out = computeTopTobaccos(tobs, sessions);
          expect(out.length).toBeLessThanOrEqual(10);
          out.forEach(function (e) {
            expect(Number.isFinite(e.sessions)).toBe(true);
            expect(Number.isFinite(e.weight)).toBe(true);
            expect(Number.isFinite(e.duration)).toBe(true);
            expect(e.sessions).toBeGreaterThanOrEqual(0);
            expect(e.weight).toBeGreaterThanOrEqual(0);
            expect(e.duration).toBeGreaterThanOrEqual(0);
            expect(typeof e.id).toBe("string");
            expect(typeof e.name).toBe("string");
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── computeTopPipes ─────────────────────────────────────────────────────────

describe("computeTopPipes", () => {
  it("returns [] when either input is null", () => {
    expect(computeTopPipes(null, [])).toEqual([]);
    expect(computeTopPipes([], null)).toEqual([]);
  });

  it("counts sessions per pipe id and sorts descending", () => {
    var pipes = [
      { id: 1, brand: "X", name: "1" },
      { id: 2, brand: "Y", name: "2" },
    ];
    var sessions = [
      { pipeId: 1, duration: "30" },
      { pipeId: 1, duration: "20" },
      { pipeId: 2, duration: "15" },
    ];
    var out = computeTopPipes(pipes, sessions);
    expect(out[0]!.id).toBe("1");
    expect(out[0]!.sessions).toBe(2);
    expect(out[1]!.sessions).toBe(1);
  });

  it("property: every output has finite non-negative numeric fields", () => {
    fc.assert(
      fc.property(
        fc.array(arbPipe(), { minLength: 0, maxLength: 5 }),
        fc.array(arbSession(), { minLength: 0, maxLength: 10 }),
        function (pipes, sessions) {
          var out = computeTopPipes(pipes, sessions);
          expect(out.length).toBeLessThanOrEqual(10);
          out.forEach(function (e) {
            expect(Number.isFinite(e.sessions)).toBe(true);
            expect(Number.isFinite(e.duration)).toBe(true);
            expect(e.sessions).toBeGreaterThanOrEqual(0);
            expect(e.duration).toBeGreaterThanOrEqual(0);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── computeChartStats ───────────────────────────────────────────────────────

describe("computeChartStats", () => {
  it("returns the empty-stats shape when any source array is null", () => {
    var out = computeChartStats(null, [], [], [], []);
    expect(out.catW).toEqual([]);
    expect(out.ratings).toEqual([0, 0, 0, 0, 0]);
    expect(out.avgSessionDuration).toBe(0);
    expect(out.tasteProfile).toBe(null);
  });

  it("aggregates active lot weight by category, sorted descending", () => {
    var tobs = [
      { id: 1, category: "Anglais", lots: [{ status: "jar", weightG: "30" }] },
      { id: 2, category: "Virginia", lots: [{ status: "jar", weightG: "10" }] },
      { id: 3, category: "Anglais", lots: [{ status: "finished", weightG: "20" }] }, // skipped
      { id: 4, category: "Anglais", lots: [{ status: "cellar", weightG: "50" }] },
    ];
    var out = computeChartStats(tobs, [], [], [], []);
    expect(out.catW[0]).toEqual(["Anglais", 80]); // 30+50
    expect(out.catW[1]).toEqual(["Virginia", 10]);
  });

  it("histogram counts only ratings 1-5 from ACTIVE tobaccos (lot-less excluded)", () => {
    var tobs = [
      { id: 1, rating: 5, lots: [{ status: "jar", weightG: "10" }] },     // counts
      { id: 2, rating: 3, lots: [] },                                     // skipped (no lots = inactive)
      { id: 3, rating: 4, lots: [{ status: "finished", weightG: "0" }] }, // skipped (no active)
      { id: 4, rating: 6, lots: [{ status: "jar", weightG: "5" }] },      // out of range
      { id: 5, rating: 0, lots: [{ status: "jar", weightG: "5" }] },      // out of range
    ];
    var out = computeChartStats(tobs, [], [], [], []);
    expect(out.ratings).toEqual([0, 0, 0, 0, 1]); // only index 4 (rating 5, active)
  });

  it("does not poison accumulators with Infinity / NaN / non-string sessions", () => {
    var tobs = [{ id: 1, category: "Anglais", lots: [] }];
    var pipes = [{ id: 10, shape: "Billiard", status: "active" }];
    var sessions = [
      { tobaccoId: 1, pipeId: 10, date: "2026-01-15", duration: "Infinity", weightG: "Infinity" },
      { tobaccoId: 1, pipeId: 10, date: "2026-01-15", duration: NaN, weightG: NaN },
      { tobaccoId: 1, pipeId: 10, date: "2026-01-15", duration: null, weightG: null },
      { tobaccoId: 1, pipeId: 10, date: "2026-01-15", duration: { evil: 1 }, weightG: [1, 2] },
    ];
    var out = computeChartStats(tobs, pipes, sessions, [], []);
    out.monthlyDur.forEach(([_k, v]) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    });
    out.monthlyWeight.forEach(([_k, v]) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    });
    expect(Number.isFinite(out.avgSessionDuration)).toBe(true);
    expect(out.avgSessionDuration).toBeGreaterThanOrEqual(0);
    // totalSessions counts every valid-date session — an untimed
    // (0-duration) session is still a real session. All four here have a valid
    // date (only their durations are garbage). Only the AVERAGE excludes them
    // (durCount denominator), so it stays 0.
    expect(out.totalSessions).toBe(4);
    expect(out.avgSessionDuration).toBe(0); // no timed session ⇒ average 0
  });

  it("totalSessions counts untimed sessions, average excludes them", () => {
    var sessions = [
      { tobaccoId: 1, pipeId: 10, date: "2026-01-10", duration: "20" }, // timed
      { tobaccoId: 1, pipeId: 10, date: "2026-01-11", duration: "" },   // untimed
      { tobaccoId: 1, pipeId: 10, date: "2026-01-12" },                  // no duration key
    ];
    var out = computeChartStats([], [], sessions, [], []);
    expect(out.totalSessions).toBe(3);      // all three are real sessions
    expect(out.avgSessionDuration).toBe(20); // only the one timed session averages
  });

  it("monthly window has exactly 12 keys", () => {
    var out = computeChartStats([], [], [], [], [], new Date(2026, 5, 15));
    expect(out.monthlyDur.length).toBe(12);
    expect(out.monthlyWeight.length).toBe(12);
  });

  it("calByDay counts sessions per ISO date", () => {
    var sessions = [
      { date: "2026-01-15" }, { date: "2026-01-15" }, { date: "2026-01-16" },
    ];
    var out = computeChartStats([], [], sessions, [], []);
    expect(out.calByDay["2026-01-15"]).toBe(2);
    expect(out.calByDay["2026-01-16"]).toBe(1);
  });

  it("tasteProfile averages over tobaccos rated >= 4 only", () => {
    var tobs = [
      { id: 1, rating: 5, force: 3, roomNote: 2, taste: 4 },
      { id: 2, rating: 4, force: 5, roomNote: 4, taste: 2 },
      { id: 3, rating: 3, force: 1, roomNote: 1, taste: 1 }, // ignored
    ];
    var out = computeChartStats(tobs, [], [], [], []);
    expect(out.tasteProfile).not.toBe(null);
    expect(out.tasteProfile!.count).toBe(2);
    expect(out.tasteProfile!.force).toBe(4); // (3+5)/2
    expect(out.tasteProfile!.roomNote).toBe(3); // (2+4)/2
    expect(out.tasteProfile!.taste).toBe(3); // (4+2)/2
  });

  it("property: every numeric output is finite and non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(arbTobacco(), { minLength: 0, maxLength: 5 }),
        fc.array(arbPipe(), { minLength: 0, maxLength: 5 }),
        fc.array(arbSession(), { minLength: 0, maxLength: 10 }),
        function (tobs, pipes, sessions) {
          var out = computeChartStats(tobs, pipes, sessions, [], []);
          var checkPair = ([_k, v]: [string, number]) => {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          };
          out.catW.forEach(checkPair);
          out.brandW.forEach(checkPair);
          out.monthlyDur.forEach(checkPair);
          out.monthlyWeight.forEach(checkPair);
          out.yearlyDur.forEach(checkPair);
          out.yearlyWeight.forEach(checkPair);
          out.pShapes.forEach(checkPair);
          out.pBowl.forEach(checkPair);
          out.pStem.forEach(checkPair);
          out.ratings.forEach(r => {
            expect(Number.isFinite(r)).toBe(true);
            expect(r).toBeGreaterThanOrEqual(0);
          });
          expect(Number.isFinite(out.avgSessionDuration)).toBe(true);
          expect(out.avgSessionDuration).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(out.totalSessions)).toBe(true);
          expect(out.totalSessions).toBeGreaterThanOrEqual(0);
          if (out.tasteProfile) {
            expect(Number.isFinite(out.tasteProfile.force)).toBe(true);
            expect(Number.isFinite(out.tasteProfile.roomNote)).toBe(true);
            expect(Number.isFinite(out.tasteProfile.taste)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: never throws on arbitrary garbage", () => {
    fc.assert(
      fc.property(
        fc.array(fc.anything(), { maxLength: 5 }),
        fc.array(fc.anything(), { maxLength: 5 }),
        fc.array(fc.anything(), { maxLength: 5 }),
        function (tobs, pipes, sessions) {
          expect(() => computeChartStats(tobs as any, pipes as any, sessions as any, [], []))
            .not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── computeSpendingStats ──────────────────────────────────────

import { computeSpendingStats } from "../utils/stats";

describe("computeSpendingStats", () => {
  const NOW = new Date("2026-06-12T12:00:00Z");

  it("returns zeroed shapes for empty inputs", () => {
    const s = computeSpendingStats([], [], [], NOW);
    expect(s.totalAllTime).toBe(0);
    expect(s.totalThisYear).toBe(0);
    expect(s.yearlyTobacco).toEqual([]);
    expect(s.yearlyPipes).toEqual([]);
    expect(s.yearlyAccessories).toEqual([]);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly.every(m => m[1] === 0)).toBe(true);
  });

  it("buckets tobacco lot purchases monthly AND yearly", () => {
    const tobs = [{
      id: 1,
      lots: [
        { datePurchased: "2026-05-10", price: "25" },
        { datePurchased: "2026-05-20", price: "30.5" },
        { datePurchased: "2024-01-01", price: "100" },
      ],
    }];
    const s = computeSpendingStats(tobs, [], [], NOW);
    const may = s.monthly.find(m => m[0] === "2026-05");
    expect(may![1]).toBe(55.5);
    expect(s.yearlyTobacco).toEqual([["2024", 100], ["2026", 55.5]]);
    expect(s.totalTobacco).toBe(155.5);
    expect(s.totalAllTime).toBe(155.5);
    expect(s.totalThisYear).toBe(55.5);
  });

  it("pipes and accessories count yearly only (year-precision dates)", () => {
    const pipes = [{ id: 1, datePurchased: "2025", price: "150" }];
    const accs = [{ id: 1, datePurchased: "2026", price: "40" }];
    const s = computeSpendingStats([], pipes, accs, NOW);
    expect(s.yearlyPipes).toEqual([["2025", 150]]);
    expect(s.yearlyAccessories).toEqual([["2026", 40]]);
    expect(s.totalPipes).toBe(150);
    expect(s.totalAccessories).toBe(40);
    expect(s.totalAllTime).toBe(190);
    expect(s.monthly.every(m => m[1] === 0)).toBe(true);
    expect(s.totalThisYear).toBe(40);
  });

  it("legacy full-ISO pipe dates still bucket by year", () => {
    const pipes = [{ id: 1, datePurchased: "2024-03-15", price: "200" }];
    const s = computeSpendingStats([], pipes, [], NOW);
    expect(s.yearlyPipes).toEqual([["2024", 200]]);
  });

  it("skips zero / missing / hostile prices and missing dates", () => {
    const tobs = [{
      id: 1,
      lots: [
        { datePurchased: "2026-05-10", price: "" },
        { datePurchased: "2026-05-10", price: "0" },
        { datePurchased: "", price: "50" },
        { datePurchased: "2026-05-10", price: "Infinity" },
        { datePurchased: "garbage", price: "50" },
      ],
    }];
    const s = computeSpendingStats(tobs, [{ id: 1, datePurchased: "2026", price: "-5" }], [], NOW);
    expect(s.totalAllTime).toBe(0);
  });

  it("a purchase outside the rolling 12-month window counts yearly but not monthly", () => {
    const tobs = [{ id: 1, lots: [{ datePurchased: "2024-06-01", price: "80" }] }];
    const s = computeSpendingStats(tobs, [], [], NOW);
    expect(s.monthly.every(m => m[1] === 0)).toBe(true);
    expect(s.yearlyTobacco).toEqual([["2024", 80]]);
  });

  it("is immune to prototype-key years", () => {
    const tobs = [{ id: 1, lots: [{ datePurchased: "2026-05-10", price: "10" }] }];
    expect(() => computeSpendingStats(tobs, [], [], NOW)).not.toThrow();
  });
});

// ── computeLocationStats ──────────────────────────────────────────
import { computeLocationStats } from "../utils/stats";

describe("computeLocationStats", () => {
  it("counts sessions by commune and by country, ignoring the spot", () => {
    const sessions = [
      { locationName: "Café de Flore", locationCity: "Paris", locationCountry: "France" },
      { locationName: "Home", locationCity: "Paris", locationCountry: "France" },
      { locationName: "Pub", locationCity: "London", locationCountry: "UK" },
    ];
    const r = computeLocationStats(sessions);
    expect(r.byCommune).toEqual([
      { label: "Paris", count: 2 },
      { label: "London", count: 1 },
    ]);
    expect(r.byCountry).toEqual([
      { label: "France", count: 2 },
      { label: "UK", count: 1 },
    ]);
  });

  it("skips sessions with no commune/country and trims blanks", () => {
    const r = computeLocationStats([
      { locationCity: "  ", locationCountry: "" },
      { locationCity: "Lyon" },
      {},
      null,
      { locationCountry: "France" },
    ]);
    expect(r.byCommune).toEqual([{ label: "Lyon", count: 1 }]);
    expect(r.byCountry).toEqual([{ label: "France", count: 1 }]);
  });

  it("sorts by count desc then label, and caps at topN", () => {
    const sessions = [
      ...Array(3).fill({ locationCountry: "France" }),
      ...Array(3).fill({ locationCountry: "Italy" }),
      { locationCountry: "Spain" },
    ];
    const r = computeLocationStats(sessions, 2);
    // France & Italy tie at 3 → alphabetical; Spain (1) dropped by cap.
    expect(r.byCountry).toEqual([
      { label: "France", count: 3 },
      { label: "Italy", count: 3 },
    ]);
  });

  it("returns empty arrays for null / empty input", () => {
    expect(computeLocationStats(null)).toEqual({ byCommune: [], byCountry: [] });
    expect(computeLocationStats([])).toEqual({ byCommune: [], byCountry: [] });
  });

  it("sums the same country logged under different UI languages", () => {
    // 3× France (fr), 2× Frankreich (de), 1× Francia (es/it) → one FR row of 6.
    const sessions = [
      ...Array(3).fill({ locationCountry: "France" }),
      ...Array(2).fill({ locationCountry: "Frankreich" }),
      { locationCountry: "Francia" },
    ];
    const r = computeLocationStats(sessions);
    expect(r.byCountry).toEqual([{ label: "France", count: 6 }]);
  });

  it("label is the most frequently captured variant", () => {
    // Germany: 1× Allemagne, 3× Deutschland → merged as DE, labelled by the
    // dominant "Deutschland".
    const sessions = [
      { locationCountry: "Allemagne" },
      ...Array(3).fill({ locationCountry: "Deutschland" }),
    ];
    const r = computeLocationStats(sessions);
    expect(r.byCountry).toEqual([{ label: "Deutschland", count: 4 }]);
  });

  it("unknown/exotic countries still group per-string", () => {
    const r = computeLocationStats([
      { locationCountry: "Atlantis" },
      { locationCountry: "Atlantis" },
      { locationCountry: "Wakanda" },
    ]);
    expect(r.byCountry).toEqual([
      { label: "Atlantis", count: 2 },
      { label: "Wakanda", count: 1 },
    ]);
  });

  it("prototype-key commune/country names don't poison the counts", () => {
    // Free-text location names that collide with Object.prototype members must
    // count as normal rows (Object.create(null) maps), not `function + 1`.
    const r = computeLocationStats([
      { locationCity: "toString" }, { locationCity: "toString" },
      { locationCity: "constructor" },
      { locationCountry: "valueOf" }, { locationCountry: "valueOf" },
    ]);
    expect(r.byCommune).toEqual([
      { label: "toString", count: 2 },
      { label: "constructor", count: 1 },
    ]);
    expect(r.byCountry).toEqual([{ label: "valueOf", count: 2 }]);
  });
});

// ── computeAgingSweetSpot ─────────────────────────────────────────
import { computeAgingSweetSpot } from "../utils/stats";

describe("computeAgingSweetSpot", () => {
  // One tobacco, one lot produced 2020-01-01. Sessions land in known buckets.
  const tobs = [
    { id: "1", lots: [{ id: "L1", dateProduction: "2020-01-01" }] },
  ];

  it("returns empty on non-array input (never throws)", () => {
    const e = { buckets: [], total: 0, peakKey: null };
    expect(computeAgingSweetSpot(null, null)).toEqual(e);
    expect(computeAgingSweetSpot(undefined, [])).toEqual(e);
    expect(computeAgingSweetSpot([], undefined)).toEqual(e);
    // @ts-expect-error garbage
    expect(computeAgingSweetSpot("x", "y")).toEqual(e);
  });

  it("buckets sessions by tobacco age and averages the ratings", () => {
    const sessions = [
      // ~0.4y → lt1
      { rating: 2, date: "2020-06-01", tobaccoId: "1", lotId: "L1" },
      { rating: 4, date: "2020-07-01", tobaccoId: "1", lotId: "L1" },
      // ~3y → 2_4
      { rating: 5, date: "2023-01-01", tobaccoId: "1", lotId: "L1" },
      { rating: 5, date: "2023-02-01", tobaccoId: "1", lotId: "L1" },
    ];
    const r = computeAgingSweetSpot(tobs, sessions);
    expect(r.total).toBe(4);
    const byKey: Record<string, { avg: number; count: number }> = {};
    r.buckets.forEach((b) => (byKey[b.key] = { avg: b.avg, count: b.count }));
    expect(byKey["lt1"]).toEqual({ avg: 3, count: 2 });
    expect(byKey["2_4"]).toEqual({ avg: 5, count: 2 });
    // buckets stay age-ordered
    expect(r.buckets.map((b) => b.key)).toEqual(["lt1", "2_4"]);
    // sweet spot = highest avg among buckets with >= 2 samples
    expect(r.peakKey).toBe("2_4");
  });

  it("a single lucky high-rated session can't crown a bucket (PEAK_MIN)", () => {
    const sessions = [
      { rating: 3, date: "2020-06-01", tobaccoId: "1", lotId: "L1" }, // lt1
      { rating: 3, date: "2020-07-01", tobaccoId: "1", lotId: "L1" }, // lt1
      { rating: 5, date: "2030-06-01", tobaccoId: "1", lotId: "L1" }, // ~10.4y, count 1
    ];
    const r = computeAgingSweetSpot(tobs, sessions);
    // 10plus has the higher avg but only 1 sample → peak stays on lt1
    expect(r.peakKey).toBe("lt1");
  });

  it("skips unrated, orphaned, dateless and future sessions", () => {
    const sessions = [
      { rating: 0, date: "2023-01-01", tobaccoId: "1", lotId: "L1" }, // unrated
      { rating: 4, date: "2023-01-01", tobaccoId: "1", lotId: "" },   // orphaned
      { rating: 4, date: "2023-01-01", tobaccoId: "1", lotId: "L9" }, // no such lot
      { rating: 4, date: "2019-01-01", tobaccoId: "1", lotId: "L1" }, // before production → negative age
      { rating: 4, date: "2023-01-01", tobaccoId: "1", lotId: "L1" }, // valid → 2_4
    ];
    const r = computeAgingSweetSpot(tobs, sessions);
    expect(r.total).toBe(1);
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0]!.key).toBe("2_4");
  });

  it("falls back to datePurchased when the lot has no dateProduction", () => {
    const tobs2 = [{ id: "1", lots: [{ id: "L1", datePurchased: "2020-01-01" }] }];
    const r = computeAgingSweetSpot(tobs2, [
      { rating: 5, date: "2023-01-01", tobaccoId: "1", lotId: "L1" },
    ]);
    expect(r.total).toBe(1);
    expect(r.buckets[0]!.key).toBe("2_4");
  });

  it("returns no peak when no bucket reaches PEAK_MIN", () => {
    const r = computeAgingSweetSpot(tobs, [
      { rating: 5, date: "2023-01-01", tobaccoId: "1", lotId: "L1" },
    ]);
    expect(r.total).toBe(1);
    expect(r.peakKey).toBeNull();
  });

  // users who rate tobaccos but not individual sessions.
  it("falls back to the tobacco rating when the session is unrated", () => {
    const tobsRated = [
      { id: "1", rating: 4, lots: [{ id: "L1", dateProduction: "2020-01-01" }] },
    ];
    const sessions = [
      { date: "2020-06-01", tobaccoId: "1", lotId: "L1" }, // no rating → lt1
      { rating: 0, date: "2023-01-01", tobaccoId: "1", lotId: "L1" }, // 0 → fallback → 2_4
    ];
    const r = computeAgingSweetSpot(tobsRated, sessions);
    expect(r.total).toBe(2);
    const byKey: Record<string, number> = {};
    r.buckets.forEach((b) => (byKey[b.key] = b.avg));
    // both inherit the tobacco's rating of 4
    expect(byKey["lt1"]).toBe(4);
    expect(byKey["2_4"]).toBe(4);
  });

  it("prefers the session rating over the tobacco rating when present", () => {
    const tobsRated = [
      { id: "1", rating: 2, lots: [{ id: "L1", dateProduction: "2020-01-01" }] },
    ];
    // session says 5 → wins over tobacco's 2
    const r = computeAgingSweetSpot(tobsRated, [
      { rating: 5, date: "2020-06-01", tobaccoId: "1", lotId: "L1" },
    ]);
    expect(r.buckets[0]!.avg).toBe(5);
  });

  it("still skips a session when neither the session nor the tobacco is rated", () => {
    // tobacco has no rating, session has no rating → nothing usable
    const r = computeAgingSweetSpot(tobs, [
      { date: "2023-01-01", tobaccoId: "1", lotId: "L1" },
    ]);
    expect(r.total).toBe(0);
  });

  // per-family filter — families age very differently.
  it("filters the curve to a single tobacco family when a category is passed", () => {
    const tobsMixed = [
      { id: "1", category: "Virginia", lots: [{ id: "L1", dateProduction: "2020-01-01" }] },
      { id: "2", category: "Aromatique", lots: [{ id: "L2", dateProduction: "2020-01-01" }] },
    ];
    const sessions = [
      { rating: 5, date: "2023-01-01", tobaccoId: "1", lotId: "L1" }, // Virginia
      { rating: 5, date: "2023-02-01", tobaccoId: "1", lotId: "L1" }, // Virginia
      { rating: 2, date: "2023-01-01", tobaccoId: "2", lotId: "L2" }, // Aromatic
    ];
    // No filter → all 3
    expect(computeAgingSweetSpot(tobsMixed, sessions).total).toBe(3);
    // Virginia only → 2
    const v = computeAgingSweetSpot(tobsMixed, sessions, "Virginia");
    expect(v.total).toBe(2);
    expect(v.buckets[0]!.avg).toBe(5);
    // Aromatic only → 1
    const a = computeAgingSweetSpot(tobsMixed, sessions, "Aromatique");
    expect(a.total).toBe(1);
    expect(a.buckets[0]!.avg).toBe(2);
  });

  it("an empty-string category means all families (no filter)", () => {
    const tobsMixed = [
      { id: "1", category: "Virginia", lots: [{ id: "L1", dateProduction: "2020-01-01" }] },
    ];
    const r = computeAgingSweetSpot(tobsMixed, [
      { rating: 4, date: "2023-01-01", tobaccoId: "1", lotId: "L1" },
    ], "");
    expect(r.total).toBe(1);
  });

  // The per-tobacco/per-lot maps are Object.create(null),
  // so a forged session whose tobaccoId/lotId equal a prototype member can't
  // resolve through the prototype chain and crash or mis-bucket.
  it("does not crash on a forged prototype-key tobaccoId / lotId", () => {
    const tobs = [{ id: "1", category: "Virginia", rating: 5, lots: [{ id: "L1", dateProduction: "2020-01-01" }] }];
    const sessions = [
      { rating: 4, date: "2023-01-01", tobaccoId: "valueOf", lotId: "toString" },
      { rating: 4, date: "2023-01-01", tobaccoId: "1", lotId: "L1" }, // legitimate → 1 bucketed
    ];
    let r: any;
    expect(() => { r = computeAgingSweetSpot(tobs, sessions); }).not.toThrow();
    expect(r.total).toBe(1); // only the real session bucketed; the forged one skipped
  });
});

// ── computeAromaProfile ───────────────────────────────────────────
import { computeAromaProfile } from "../utils/stats";

describe("computeAromaProfile", () => {
  it("returns empty on non-array input (never throws)", () => {
    expect(computeAromaProfile(null)).toEqual({ items: [], total: 0, taggedSessions: 0 });
    expect(computeAromaProfile(undefined)).toEqual({ items: [], total: 0, taggedSessions: 0 });
  });

  it("counts aroma taps and ranks them by frequency", () => {
    const sessions = [
      { aromas: ["vanilla", "leather"] },
      { aromas: ["vanilla", "honey"] },
      { aromas: ["vanilla"] },
      { aromas: [] },        // no aromas → ignored
      { notes: "x" },        // no aromas field → ignored
    ];
    const p = computeAromaProfile(sessions);
    expect(p.total).toBe(5);          // 3 vanilla + 1 leather + 1 honey
    expect(p.taggedSessions).toBe(3); // 3 sessions carry aromas
    expect(p.items[0]).toEqual({ key: "vanilla", count: 3 });
    // leather and honey both count 1 — tie broken alphabetically (honey < leather)
    expect(p.items[1]).toEqual({ key: "honey", count: 1 });
    expect(p.items[2]).toEqual({ key: "leather", count: 1 });
  });

  it("tallies the total across all taps", () => {
    // Only VALID wheel aromas are counted now, so these
    // use real keys (were placeholders "a".."d" before the sanitize change).
    const p = computeAromaProfile([
      { aromas: ["caramel", "honey", "vanilla"] },
      { aromas: ["leather"] },
    ]);
    expect(p.total).toBe(4);
    expect(p.taggedSessions).toBe(2);
  });

  it("respects the topN cap", () => {
    const sessions = [{ aromas: ["caramel", "honey", "vanilla", "chocolate", "molasses"] }];
    const p = computeAromaProfile(sessions, 3);
    expect(p.items).toHaveLength(3);
  });

  it("ignores non-string entries inside the aromas array", () => {
    const p = computeAromaProfile([{ aromas: ["vanilla", 7, null, ""] as any }]);
    expect(p.total).toBe(1);
    expect(p.items).toEqual([{ key: "vanilla", count: 1 }]);
  });

  // A forged/unknown aroma key (not in the wheel) is
  // dropped — it can never reach the "Profil gustatif" chart. Parity with
  // tasteProfile, and a prototype-key can't pollute the null-proto counts map.
  it("drops unknown / prototype-key aromas (validated against the wheel)", () => {
    const p = computeAromaProfile([{ aromas: ["vanilla", "not_a_real_aroma", "__proto__", "constructor"] as any }]);
    expect(p.total).toBe(1);
    expect(p.items).toEqual([{ key: "vanilla", count: 1 }]);
  });
});

// ── computeCostPerSession (grammage-based) ───────────────────
import { computeCostPerSession } from "../utils/stats";

describe("computeCostPerSession", () => {
  it("returns empty stats on null / undefined", () => {
    expect(computeCostPerSession(null, null)).toEqual({
      items: [], globalValueSmoked: 0, globalGrams: 0, globalSessions: 0, globalCostPerSession: 0,
    });
    expect(computeCostPerSession(undefined, undefined).items).toEqual([]);
  });

  it("costs each session as grams × (lot price ÷ lot weight)", () => {
    // Lot: 50 g bought for 25 € → 0.5 €/g. Two sessions: 2 g and 3 g.
    const tobs = [
      { id: 1, brand: "A", name: "Alpha", lots: [{ id: 10, price: "25", weightInitial: "50", weightG: "45" }] },
    ];
    const sessions = [
      { tobaccoId: 1, lotId: "10", weightG: "2" },   // 1.00 €
      { tobaccoId: 1, lotId: "10", weightG: "3" },   // 1.50 €
    ];
    const s = computeCostPerSession(tobs, sessions);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.valueSmoked).toBe(2.5);
    expect(s.items[0]!.grams).toBe(5);
    expect(s.items[0]!.sessions).toBe(2);
    expect(s.items[0]!.costPerSession).toBe(1.25);
    expect(s.globalValueSmoked).toBe(2.5);
    expect(s.globalGrams).toBe(5);
    expect(s.globalSessions).toBe(2);
    expect(s.globalCostPerSession).toBe(1.25);
  });

  it("uses each lot's own price per gram (bigger bowl of a dearer lot costs more)", () => {
    const tobs = [
      { id: 1, brand: "A", name: "Two", lots: [
        { id: 10, price: "10", weightInitial: "100" },   // 0.10 €/g
        { id: 20, price: "60", weightInitial: "100" },   // 0.60 €/g
      ] },
    ];
    const sessions = [
      { tobaccoId: 1, lotId: "10", weightG: "2" },   // 0.20 €
      { tobaccoId: 1, lotId: "20", weightG: "2" },   // 1.20 €
    ];
    const s = computeCostPerSession(tobs, sessions);
    expect(s.items[0]!.valueSmoked).toBe(1.4);
    expect(s.items[0]!.costPerSession).toBe(0.7);
  });

  it("excludes sessions missing grams, lotId, price or lot weight", () => {
    const tobs = [
      { id: 1, brand: "A", name: "T", lots: [
        { id: 10, price: "20", weightInitial: "40" },   // 0.5 €/g
        { id: 11, price: "0", weightInitial: "40" },    // no price
        { id: 12, price: "20", weightInitial: "0" },    // no weight
      ] },
    ];
    const sessions = [
      { tobaccoId: 1, lotId: "10", weightG: "4" },   // ✓ 2.00 €
      { tobaccoId: 1, lotId: "10", weightG: "0" },   // ✗ no grams (accounting off)
      { tobaccoId: 1, lotId: "", weightG: "4" },     // ✗ no lot
      { tobaccoId: 1, lotId: "11", weightG: "4" },   // ✗ lot has no price
      { tobaccoId: 1, lotId: "12", weightG: "4" },   // ✗ lot has no weight
    ];
    const s = computeCostPerSession(tobs, sessions);
    expect(s.items[0]!.sessions).toBe(1);
    expect(s.items[0]!.valueSmoked).toBe(2);
    expect(s.globalSessions).toBe(1);
  });

  it("falls back to weightG when weightInitial is absent (legacy lots)", () => {
    const tobs = [
      { id: 1, brand: "A", name: "Legacy", lots: [{ id: 10, price: "30", weightG: "60" }] },
    ];
    const s = computeCostPerSession(tobs, [{ tobaccoId: 1, lotId: "10", weightG: "2" }]);
    expect(s.items[0]!.costPerSession).toBe(1);   // 2 × (30/60)
  });

  it("sorts descending by cost per session and honours max", () => {
    const tobs = [
      { id: 1, brand: "A", name: "Cheap", lots: [{ id: 1, price: "10", weightInitial: "100" }] }, // 0.1/g × 2g = 0.2
      { id: 2, brand: "B", name: "Dear", lots: [{ id: 2, price: "80", weightInitial: "100" }] },  // 0.8/g × 2g = 1.6
      { id: 3, brand: "C", name: "Mid", lots: [{ id: 3, price: "40", weightInitial: "100" }] },   // 0.4/g × 2g = 0.8
    ];
    const sessions = [
      { tobaccoId: 1, lotId: "1", weightG: "2" },
      { tobaccoId: 2, lotId: "2", weightG: "2" },
      { tobaccoId: 3, lotId: "3", weightG: "2" },
    ];
    const s = computeCostPerSession(tobs, sessions, { max: 2 });
    expect(s.items.map((x) => x.name)).toEqual(["Dear", "Mid"]);
  });

  it("skips soft-deleted tobaccos, lots and sessions", () => {
    const tobs = [
      { id: 1, brand: "A", name: "Gone", deletedAt: "x", lots: [{ id: 1, price: "50", weightInitial: "50" }] },
      { id: 2, brand: "B", name: "Live", lots: [
        { id: 2, price: "10", weightInitial: "100" },
        { id: 3, price: "10", weightInitial: "100", deletedAt: "y" },
      ] },
    ];
    const sessions = [
      { tobaccoId: 2, lotId: "2", weightG: "5" },              // ✓ 0.50 €
      { tobaccoId: 2, lotId: "3", weightG: "5", deletedAt: "z" }, // ✗ deleted session
      { tobaccoId: 2, lotId: "3", weightG: "5" },              // ✗ deleted lot
      { tobaccoId: 1, lotId: "1", weightG: "5" },              // ✗ deleted tobacco
    ];
    const s = computeCostPerSession(tobs, sessions);
    expect(s.items.map((x) => x.name)).toEqual(["Live"]);
    expect(s.items[0]!.sessions).toBe(1);
    expect(s.items[0]!.valueSmoked).toBe(0.5);
    expect(s.globalSessions).toBe(1);
  });

  it("ignores garbage prices/weights without throwing", () => {
    const tobs = [
      { id: 1, brand: "A", name: "X", lots: [{ id: 1, price: "Infinity", weightInitial: "abc" }, { id: 2, price: "20", weightInitial: "40" }] },
    ];
    const s = computeCostPerSession(tobs, [
      { tobaccoId: 1, lotId: "1", weightG: "2" },   // garbage lot → skipped
      { tobaccoId: 1, lotId: "2", weightG: "2" },   // 2 × 0.5 = 1.00
    ]);
    expect(s.items[0]!.sessions).toBe(1);
    expect(s.items[0]!.costPerSession).toBe(1);
    expect(Number.isFinite(s.globalCostPerSession)).toBe(true);
  });
});
