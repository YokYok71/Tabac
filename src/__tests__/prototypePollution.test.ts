/**
 * prototype-pollution defense regression tests.
 *
 * The fixes switched ~17 dict sites from `{}` to
 * `Object.create(null)` to defeat the bug where a key like "toString"
 * or "constructor" resolves to Object.prototype.* and corrupts the
 * aggregator. This file feeds every covered aggregator a row whose
 * brand/category/shape/type/id IS one of the reserved names and asserts
 * the output stays sane.
 *
 * A future regression that re-introduces `{}` somewhere would surface
 * here: the aggregator either crashes (TypeError from `+` on a function)
 * or returns non-finite / wrong-shape data.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeStats,
  refreshSnapshotsForRemoval,
  migrateData,
} from "../utils";
import {
  computeChartStats,
  computeTopTobaccos,
  computeTopPipes,
} from "../utils/stats";

const RESERVED = [
  "toString",
  "constructor",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
  "toLocaleString",
  "propertyIsEnumerable",
  "isPrototypeOf",
] as const;

// ── computeStats (utils.ts, home counters) ─────────────────────────────────

describe("computeStats — prototype-pollution defense", () => {
  it.each(RESERVED)("brand='%s' produces a clean per-brand count", (name) => {
    const data = {
      tobaccos: [{
        id: 1, brand: name, name: "T", category: "Anglais",
        lots: [{ id: 1, status: "jar", weightG: "30", price: "10" }],
      }],
      pipes: [{ id: 1, brand: name, shape: "Billiard", status: "active", price: "100" }],
      wishlist: [],
    };
    const s = computeStats(data) as any;
    // brand count is a clean [name, 1] pair, not a stringified function.
    const brand = s.brands.find((e: [string, number]) => e[0] === name);
    expect(brand).toBeTruthy();
    expect(brand![1]).toBe(1);
    expect(Number.isFinite(brand![1])).toBe(true);
    // pipeBrands same.
    const pipeBrand = s.pipeBrands.find((e: [string, number]) => e[0] === name);
    expect(pipeBrand).toBeTruthy();
    expect(pipeBrand![1]).toBe(1);
  });

  it.each(RESERVED)("category='%s' produces a clean per-category count", (name) => {
    const data = {
      tobaccos: [{
        id: 1, brand: "X", name: "T", category: name,
        lots: [{ id: 1, status: "jar", weightG: "30" }],
      }],
      pipes: [],
      wishlist: [],
    };
    const s = computeStats(data) as any;
    const cat = s.cats.find((e: [string, number]) => e[0] === name);
    expect(cat).toBeTruthy();
    expect(cat![1]).toBe(1);
  });

  it.each(RESERVED)("pipe shape='%s' produces a clean per-shape count", (name) => {
    const data = {
      tobaccos: [],
      pipes: [{ id: 1, brand: "X", shape: name, status: "active" }],
      wishlist: [],
    };
    const s = computeStats(data) as any;
    const sh = s.pipeShapes.find((e: [string, number]) => e[0] === name);
    expect(sh).toBeTruthy();
    expect(sh![1]).toBe(1);
  });

  it.each(RESERVED)("pipe filterType='%s' produces a clean per-filter count", (name) => {
    const data = {
      tobaccos: [],
      pipes: [{ id: 1, brand: "X", shape: "Billiard", filterType: name, status: "active" }],
      wishlist: [],
    };
    const s = computeStats(data) as any;
    const flt = s.pipeFilters.find((e: [string, number]) => e[0] === name);
    expect(flt).toBeTruthy();
    expect(flt![1]).toBe(1);
  });
});

// ── computeChartStats / Top helpers (utils/stats.ts) ───────────────────────

describe("computeChartStats — prototype-pollution defense", () => {
  it.each(RESERVED)("brand='%s' produces a clean brandW entry", (name) => {
    const tobs = [{
      id: 1, brand: name, name: "T", category: "Anglais",
      lots: [{ status: "jar", weightG: "30" }],
    }];
    const out = computeChartStats(tobs, [], [], [], []);
    const brand = out.brandW.find((e) => e[0] === name);
    expect(brand).toBeTruthy();
    expect(brand![1]).toBe(30);
    expect(Number.isFinite(brand![1])).toBe(true);
  });

  it.each(RESERVED)("category='%s' produces a clean catW entry", (name) => {
    const tobs = [{
      id: 1, brand: "X", name: "T", category: name,
      lots: [{ status: "jar", weightG: "30" }],
    }];
    const out = computeChartStats(tobs, [], [], [], []);
    const cat = out.catW.find((e) => e[0] === name);
    expect(cat).toBeTruthy();
    expect(cat![1]).toBe(30);
  });
});

describe("computeTopTobaccos / computeTopPipes — prototype-pollution defense", () => {
  it.each(RESERVED)("tobacco id='%s' aggregates cleanly", (rawId) => {
    const tobs = [{ id: rawId, brand: "X", name: "T" }];
    const sessions = [
      { tobaccoId: rawId, duration: "10", weightG: "1" },
      { tobaccoId: rawId, duration: "5", weightG: "2" },
    ];
    const out = computeTopTobaccos(tobs, sessions);
    expect(out.length).toBe(1);
    expect(out[0]!.sessions).toBe(2);
    expect(Number.isFinite(out[0]!.weight)).toBe(true);
    expect(Number.isFinite(out[0]!.duration)).toBe(true);
  });

  it.each(RESERVED)("pipe id='%s' aggregates cleanly", (rawId) => {
    const pipes = [{ id: rawId, brand: "X", name: "P" }];
    const sessions = [
      { pipeId: rawId, duration: "10" },
      { pipeId: rawId, duration: "5" },
    ];
    const out = computeTopPipes(pipes, sessions);
    expect(out.length).toBe(1);
    expect(out[0]!.sessions).toBe(2);
    expect(Number.isFinite(out[0]!.duration)).toBe(true);
  });
});

// ── refreshSnapshotsForRemoval (utils.ts) ─────────────────────────────────

describe("refreshSnapshotsForRemoval — prototype-pollution defense", () => {
  it.each(RESERVED)("tobacco id='%s' is found and snapshot refreshed", (rawId) => {
    const sessions = [
      { id: 1, tobaccoId: rawId, pipeId: "P1",
        tobaccoSnapshot: { brand: "OLD", name: "OLD", imageUrl: "" },
        pipeSnapshot: { brand: "p", name: "q", imageUrl: "" } },
    ];
    const deletedTobs = [{ id: rawId, brand: "NEW", name: "NAME", imageUrl: "img" }];
    const out = refreshSnapshotsForRemoval(sessions, deletedTobs, []);
    expect(out[0]!.tobaccoSnapshot.brand).toBe("NEW");
    expect(out[0]!.tobaccoSnapshot.name).toBe("NAME");
  });
});

// ── migrateData (utils.ts) ─────────────────────────────────────────────────

describe("migrateData — prototype-pollution defense", () => {
  it.each(RESERVED)("forged tobacco id='%s' doesn't poison the migration", (rawId) => {
    const d: any = {
      tobaccos: [{
        id: rawId, brand: "X", name: "Y", lots: [{ id: "L1", status: "jar", weightG: "30" }],
      }],
      pipes: [],
      accessories: [],
      sessions: [{ id: 1, tobaccoId: rawId, lotId: "L1", weightG: "5" }],
      wishlist: [],
    };
    expect(() => migrateData(d)).not.toThrow();
    // The tobacco is preserved, the session still references it, and
    // neither the tobIndex lookup nor smokedByLot accumulator was
    // poisoned by Object.prototype.* alias.
    expect(d.tobaccos.length).toBe(1);
    expect(d.tobaccos[0].id).toBe(rawId);
  });

  // A forged legacy maintenance `type` matching an
  // Object.prototype member used to resolve THROUGH the prototype chain in the
  // plain-{} _MAINT_LEGACY_MAP → a truthy function → `_mapped.tasks.slice()`
  // threw → migrateData threw → the whole cellar loaded EMPTY. Must not throw;
  // the entry normalises to a valid COUNTING kind with an empty tasks list.
  it.each(RESERVED)("forged legacy maintenance type='%s' doesn't crash the migration", (rawType) => {
    const d: any = {
      tobaccos: [], accessories: [], sessions: [], wishlist: [],
      pipes: [{ id: 1, brand: "P", name: "Q", maintenance: [{ type: rawType }] }],
    };
    expect(() => migrateData(d)).not.toThrow();
    const m = d.pipes[0].maintenance[0];
    expect(["light", "full", "none"]).toContain(m.kind);
    expect(Array.isArray(m.tasks)).toBe(true);
    expect(m.type).toBeUndefined();
  });
});

// ── dupKey: resilience to oversized strings ─────────────────────

import { dupKey } from "../hooks/useImportConfirm";

describe("dupKey — DoS resistance", () => {
  it("handles a 1MB brand without OOM and produces a string output", () => {
    const huge = "x".repeat(1_000_000);
    const k = dupKey({ brand: huge, name: "n" });
    expect(typeof k).toBe("string");
    // Output length is bounded by 2 × input + 1 separator; we don't
    // demand a hard cap here (the existing Map of merge wouldn't
    // explode either) but lock the no-throw contract.
    expect(k.length).toBeGreaterThan(0);
  });

  it("property: 10KB random brand+name pairs always return a string in finite time", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10_000 }),
        fc.string({ minLength: 0, maxLength: 10_000 }),
        (brand, name) => {
          const k = dupKey({ brand, name });
          expect(typeof k).toBe("string");
        },
      ),
      { numRuns: 30 },
    );
  });
});
