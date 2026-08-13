/**
 * Property-based fuzz for the remaining utility functions in
 * src/utils.ts:
 *
 *   parseAgingMax(v)
 *   lotAgingStatus(lot, agingMax)
 *   stripMarkupFromString(s)
 *   restoreScrollY(targetY, maxAttempts)
 *
 * Same shape as the sibling lot-utils fuzzes — generate garbage inputs,
 * assert no-throw + every documented post-condition.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import {
  parseAgingMax,
  lotAgingStatus,
  stripMarkupFromString,
  restoreScrollY,
  computeStats,
} from "../utils";

// ── arbitraries ──────────────────────────────────────────────────────────────

const arbGarbage = (): fc.Arbitrary<unknown> => fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
  fc.string({ maxLength: 12 }),
  fc.integer({ min: -100, max: 1000 }),
  fc.float({ noNaN: false, min: Math.fround(-50), max: Math.fround(500) }),
  fc.boolean(),
);

// ── parseAgingMax ────────────────────────────────────────────────────────────

describe("parseAgingMax — fuzz", () => {
  it("never throws on any input", () => {
    fc.assert(
      fc.property(arbGarbage(), (v) => {
        expect(() => parseAgingMax(v)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("always returns { min: number, max: number } with min <= max", () => {
    fc.assert(
      fc.property(arbGarbage(), (v) => {
        const out = parseAgingMax(v);
        expect(typeof out).toBe("object");
        expect(typeof out.min).toBe("number");
        expect(typeof out.max).toBe("number");
        expect(Number.isFinite(out.min)).toBe(true);
        expect(Number.isFinite(out.max)).toBe(true);
        expect(out.min).toBeLessThanOrEqual(out.max);
      }),
      { numRuns: 200 },
    );
  });

  it("falsy inputs (undefined / null / empty string / 0) return { 0, 0 }", () => {
    for (const v of [undefined, null, "", 0, false]) {
      expect(parseAgingMax(v)).toEqual({ min: 0, max: 0 });
    }
  });

  it("range strings 'a-b' / 'a–b' / 'a—b' return {min, max} with min<=max regardless of order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 }),
        // em-dash (—, U+2014) is now an accepted range separator.
        fc.constantFrom("-", "–", "—"),
        (a, b, sep) => {
          const out = parseAgingMax(`${a}${sep}${b}`);
          expect(out.min).toBe(Math.min(a, b));
          expect(out.max).toBe(Math.max(a, b));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("single positive integer string returns {n, n}", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (n) => {
        const out = parseAgingMax(String(n));
        expect(out).toEqual({ min: n, max: n });
      }),
      { numRuns: 100 },
    );
  });
});

// ── lotAgingStatus ───────────────────────────────────────────────────────────

const arbLot = () => fc.record({
  id: fc.string({ minLength: 1, maxLength: 4 }),
  status: fc.oneof(
    fc.constantFrom("cellar" as const, "jar" as const, "finished" as const),
    arbGarbage(),
  ),
  weightG: arbGarbage(),
  weightInitial: arbGarbage(),
  dateOpened: arbGarbage(),
  dateFinished: arbGarbage(),
  datePurchased: arbGarbage(),
  dateProduction: arbGarbage(),
  originalStatus: arbGarbage(),
  disposed: fc.boolean(),
});

describe("lotAgingStatus — fuzz", () => {
  it("never throws on any combination of garbage lot / agingMax", () => {
    fc.assert(
      fc.property(arbLot(), arbGarbage(), (lot, agingMax) => {
        expect(() => lotAgingStatus(lot as any, agingMax)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("returns only 'overaged', 'approaching', or null", () => {
    fc.assert(
      fc.property(arbLot(), arbGarbage(), (lot, agingMax) => {
        const out = lotAgingStatus(lot as any, agingMax);
        expect([null, "overaged", "approaching"]).toContain(out);
      }),
      { numRuns: 200 },
    );
  });

  it("returns null when lot is finished, regardless of agingMax", () => {
    fc.assert(
      fc.property(arbLot(), arbGarbage(), (lot, agingMax) => {
        const finishedLot = Object.assign({}, lot, { status: "finished" as const });
        expect(lotAgingStatus(finishedLot as any, agingMax)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("returns null when agingMax parses to 0", () => {
    fc.assert(
      fc.property(arbLot(), fc.oneof(fc.constant(undefined), fc.constant(null), fc.constant(""), fc.constant(0)),
        (lot, agingMax) => {
          expect(lotAgingStatus(lot as any, agingMax)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null when the lot has no parseable date", () => {
    fc.assert(
      fc.property(arbLot(), fc.integer({ min: 1, max: 30 }), (lot, max) => {
        // Force-clear date fields so lotAge returns null.
        const noDateLot = Object.assign({}, lot, {
          datePurchased: "",
          dateProduction: "",
          // Status must not be finished (that's the other null branch).
          status: "cellar" as const,
        });
        expect(lotAgingStatus(noDateLot as any, max)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ── stripMarkupFromString ────────────────────────────────────────────────────

describe("stripMarkupFromString — fuzz", () => {
  it("never throws on any input", () => {
    fc.assert(
      fc.property(arbGarbage(), (v) => {
        expect(() => stripMarkupFromString(v)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("returns the input unchanged if it's not a string", () => {
    fc.assert(
      fc.property(fc.oneof(
        fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined),
      ), (v) => {
        expect(stripMarkupFromString(v)).toBe(v);
      }),
      { numRuns: 100 },
    );
  });

  it("returns a string when the input is a string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        expect(typeof stripMarkupFromString(s)).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("idempotent: scrubbing twice equals scrubbing once", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = stripMarkupFromString(s);
        const twice = stripMarkupFromString(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it("output contains no HTML-like tags `<tag...>` or `</tag>`", () => {
    // Synthesise dirty input that's likely to contain tags.
    const arbDirty = fc.oneof(
      fc.string({ maxLength: 50 }),
      fc.tuple(
        fc.string({ maxLength: 30 }),
        fc.constantFrom("<b>", "<cite>", "<span>", "</b>", "</cite>"),
        fc.string({ maxLength: 30 }),
      ).map(([a, t, b]) => a + t + b),
    );
    fc.assert(
      fc.property(arbDirty, (s) => {
        const out = stripMarkupFromString(s);
        // The function strips `</?[a-z][^>]*>` style tags. Verify the
        // pattern doesn't survive in the output.
        expect(out).not.toMatch(/<\/?[a-z][^>]*>/i);
      }),
      { numRuns: 200 },
    );
  });

  it("preserves text like '2 < 3' (the `<` is followed by a non-letter so it's not a tag)", () => {
    expect(stripMarkupFromString("2 < 3 and 5 > 4")).toBe("2 < 3 and 5 > 4");
  });

  it("decodes the common HTML entities", () => {
    expect(stripMarkupFromString("a &amp; b")).toContain("a & b");
    expect(stripMarkupFromString("&lt;tag&gt;")).toBe("<tag>");
    expect(stripMarkupFromString("It&#39;s &quot;ok&quot;")).toBe("It's \"ok\"");
  });

  // ── CodeQL hardening regressions ──────────────────────────────────────
  // Lock the two specific behaviours flagged by code-scanning so the
  // next refactor can't silently re-introduce them.

  it("strips nested-tag injection (incomplete-multi-character-sanitization)", () => {
    // A single pass would leave the inner "<script>" intact. The
    // fixed-point loop keeps stripping until stable.
    expect(stripMarkupFromString("<<script>script>alert(1)<</script>/script>"))
      .not.toMatch(/<\/?[a-z]/i);
  });

  it("does NOT double-decode &amp;lt; (double-escaping alert)", () => {
    // The old code decoded &amp; first, so `&amp;lt;` became `&lt;`
    // then `<`. The single-pass callback decoder keeps it at `&lt;`.
    expect(stripMarkupFromString("&amp;lt;")).toBe("&lt;");
    expect(stripMarkupFromString("&amp;amp;")).toBe("&amp;");
  });

  it("decodes numeric entities (decimal + hex)", () => {
    expect(stripMarkupFromString("&#60;a&#62;")).toBe("<a>");
    expect(stripMarkupFromString("&#x3C;a&#x3E;")).toBe("<a>");
    // Out-of-range entity: leave alone.
    expect(stripMarkupFromString("&#99999999;")).toBe("&#99999999;");
  });
});

// ── restoreScrollY ───────────────────────────────────────────────────────────
//
// Effectful — uses requestAnimationFrame and window.scrollTo. We mock
// both so the test stays deterministic. The mock rAF queue is flushed
// by hand, giving us full control over the retry loop count.

describe("restoreScrollY — fuzz", () => {
  let scrollToCalls: Array<{ x: number; y: number }>;
  let rafCallbacks: FrameRequestCallback[];
  let originalRAF: typeof requestAnimationFrame;
  let originalScrollTo: typeof window.scrollTo;
  let originalInnerHeight: PropertyDescriptor | undefined;
  let docScrollHeight: number;

  beforeEach(() => {
    scrollToCalls = [];
    rafCallbacks = [];
    originalRAF = window.requestAnimationFrame;
    originalScrollTo = window.scrollTo;
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

    // Mock rAF — enqueue callbacks instead of running them.
    (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    // Mock scrollTo — record the call (also accept (x, y) signature).
    (window as any).scrollTo = (x: any, y?: any) => {
      if (typeof x === "object" && x !== null) {
        scrollToCalls.push({ x: x.left || 0, y: x.top || 0 });
      } else {
        scrollToCalls.push({ x: Number(x) || 0, y: Number(y) || 0 });
      }
    };
    // Mock innerHeight + a settable scrollHeight via spies on documentElement.
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    docScrollHeight = 5000; // plenty of room
    Object.defineProperty(document.documentElement, "scrollHeight", {
      get: () => docScrollHeight,
      configurable: true,
    });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRAF;
    window.scrollTo = originalScrollTo;
    if (originalInnerHeight) {
      Object.defineProperty(window, "innerHeight", originalInnerHeight);
    }
    vi.restoreAllMocks();
  });

  function flushRaf(maxFrames: number = 50) {
    let frames = 0;
    while (rafCallbacks.length > 0 && frames < maxFrames) {
      const cbs = rafCallbacks;
      rafCallbacks = [];
      cbs.forEach((cb) => cb(performance.now()));
      frames++;
    }
  }

  it("never throws on any targetY / maxAttempts combination", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100, max: 10000 }),
          fc.float({ noNaN: false, min: Math.fround(-50), max: Math.fround(10000) }),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
        ),
        fc.oneof(fc.integer({ min: -5, max: 50 }), fc.constant(NaN), fc.constant(undefined)),
        (targetY, maxAttempts) => {
          scrollToCalls = [];
          rafCallbacks = [];
          expect(() => {
            restoreScrollY(targetY as any, maxAttempts as any);
            flushRaf();
          }).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("targetY <= 0 is a no-op (no scrollTo, no rAF)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -100, max: 0 }), fc.constant(NaN), fc.constant(-Infinity)),
        (targetY) => {
          scrollToCalls = [];
          rafCallbacks = [];
          restoreScrollY(targetY as any);
          expect(scrollToCalls.length).toBe(0);
          expect(rafCallbacks.length).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("targetY > 0 eventually calls scrollTo at most once (when document is tall enough)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), (targetY) => {
        scrollToCalls = [];
        rafCallbacks = [];
        restoreScrollY(targetY);
        flushRaf();
        // doc is 5000px tall, viewport 800 → maxY = 4200, ≥ any
        // targetY ≤ 2000 → scrollTo fires on first attempt.
        expect(scrollToCalls.length).toBe(1);
        expect(scrollToCalls[0]!.y).toBe(Math.min(targetY, 5000 - 800));
      }),
      { numRuns: 50 },
    );
  });

  it("gives up after maxAttempts frames if the document never grows tall enough", () => {
    // Force the doc to be shorter than the requested target.
    docScrollHeight = 100;
    scrollToCalls = [];
    rafCallbacks = [];
    restoreScrollY(5000, 4); // target 5000, max 4 attempts
    flushRaf();
    // After 4 frames, the loop bails. scrollTo is called with the
    // clamped position (maxY = max(0, 100 - 800) = 0).
    expect(scrollToCalls.length).toBe(1);
    expect(scrollToCalls[0]!.y).toBe(0);
  });
});

// ── computeStats ────────────────────────────────────────────────────────────
//
// Property fuzz for the home counters helper (written after the
// `brand: "toString"` prototype-pollution bug). Same coverage as the
// parallel `computeChartStats` fuzz in stats.test.ts: invariants on
// every numeric output (finite, non-negative) under arbitrary garbage
// input, plus an explicit regression test for the reserved-names class.

// A "reserved" string that, before the fix, would resolve to
// Object.prototype.* and poison the aggregate when used as a key.
const arbReservedKey = () => fc.constantFrom(
  "toString",
  "constructor",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
  "toLocaleString",
  "propertyIsEnumerable",
  "isPrototypeOf",
);

const arbStatsLot = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  status: fc.constantFrom("cellar", "jar", "finished"),
  weightG: arbGarbage(),
  price: arbGarbage(),
  disposed: fc.boolean(),
  dateProduction: arbGarbage(),
  datePurchased: arbGarbage(),
  dateOpened: arbGarbage(),
  dateFinished: arbGarbage(),
});

const arbTobaccoForStats = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  brand: fc.oneof(fc.string({ maxLength: 12 }), fc.constant(""), arbReservedKey()),
  name: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("")),
  category: fc.oneof(fc.constantFrom("Anglais", "Virginia"), fc.constant(""), arbReservedKey()),
  rating: fc.oneof(fc.integer({ min: 0, max: 5 }), arbGarbage()),
  agingMax: arbGarbage(),
  lots: fc.array(arbStatsLot(), { minLength: 0, maxLength: 4 }),
});

const arbPipeForStats = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  brand: fc.oneof(fc.string({ maxLength: 12 }), fc.constant(""), arbReservedKey()),
  shape: fc.oneof(fc.constantFrom("Billiard", "Apple"), fc.constant(""), arbReservedKey()),
  filterType: fc.oneof(fc.constantFrom("9mm", "Balsa"), fc.constant(""), arbReservedKey()),
  status: fc.constantFrom("active", "finished"),
  rating: fc.oneof(fc.integer({ min: 0, max: 5 }), arbGarbage()),
  price: arbGarbage(),
  dateProduction: arbGarbage(),
  datePurchased: arbGarbage(),
});

const arbDataForStats = () => fc.record({
  tobaccos: fc.array(arbTobaccoForStats(), { minLength: 0, maxLength: 5 }),
  pipes: fc.array(arbPipeForStats(), { minLength: 0, maxLength: 5 }),
  wishlist: fc.array(fc.anything(), { minLength: 0, maxLength: 3 }),
});

function checkPair([_k, v]: [string, unknown]): void {
  expect(typeof v).toBe("number");
  expect(Number.isFinite(v as number)).toBe(true);
  expect(v as number).toBeGreaterThanOrEqual(0);
}

describe("computeStats — fuzz", () => {
  it("never throws on arbitrary garbage data", () => {
    fc.assert(
      fc.property(fc.anything(), (anything) => {
        expect(() => computeStats(anything)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("every numeric output is finite and non-negative", () => {
    fc.assert(
      fc.property(arbDataForStats(), (data) => {
        const s = computeStats(data) as Record<string, unknown>;
        // Plain-number aggregates.
        for (const k of [
          "total", "activeRefs",
          "cellar", "jars", "lotsFinished", "lotsOveraged", "lotsApproaching",
          "wt", "pipesActive", "pipesFinished",
          "pipeVal", "pipeNoFilter", "tobVal", "wish",
        ]) {
          const v = s[k];
          expect(typeof v).toBe("number");
          expect(Number.isFinite(v as number)).toBe(true);
          expect(v as number).toBeGreaterThanOrEqual(0);
        }
        // pipeOldest is `number | null`.
        const oldest = s.pipeOldest;
        if (oldest !== null) {
          expect(typeof oldest).toBe("number");
          expect(Number.isFinite(oldest as number)).toBe(true);
          expect(oldest as number).toBeGreaterThanOrEqual(0);
        }
        // [string, number][] aggregates — sorted descending. Each
        // entry must be a [string, finite ≥ 0 number] pair.
        for (const k of ["cats", "brands", "pipeBrands", "pipeShapes", "pipeFilters"]) {
          const arr = s[k] as Array<[string, unknown]>;
          expect(Array.isArray(arr)).toBe(true);
          arr.forEach(checkPair);
        }
        // avg / pipeAvg are strings (either "—" or a 1-decimal rating).
        expect(typeof s.avg).toBe("string");
        expect(typeof s.pipeAvg).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("regression: a tobacco/pipe whose key field is 'toString' (or similar reserved name) does not poison the aggregate", () => {
    // This is the exact bug the CI fuzz caught (seed
    // -185239030). Before the fix, `Object.prototype.toString`
    // was returned by `cats["toString"]`, producing a function /
    // string-concat sequence that broke every Number.isFinite check.
    fc.assert(
      fc.property(
        arbReservedKey(),
        arbReservedKey(),
        arbReservedKey(),
        (tBrand, tCategory, pShape) => {
          const data = {
            tobaccos: [{
              id: 1, brand: tBrand, name: "X", category: tCategory,
              rating: 4,
              lots: [{ id: 1, status: "jar", weightG: "50", price: "10" }],
            }],
            pipes: [{
              id: 1, brand: tBrand, shape: pShape, filterType: "toString",
              status: "active", rating: 3, price: "100",
            }],
            wishlist: [],
          };
          const s = computeStats(data) as Record<string, unknown>;
          // Sanity: aggregates must still be plain finite numbers.
          for (const k of ["wt", "pipeVal", "total", "activeRefs"]) {
            expect(Number.isFinite(s[k] as number)).toBe(true);
          }
          for (const k of ["cats", "brands", "pipeBrands", "pipeShapes", "pipeFilters"]) {
            const arr = s[k] as Array<[string, unknown]>;
            arr.forEach(checkPair);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("explicit reserved-name regression — brand 'toString' produces a clean count of 1", () => {
    const data = {
      tobaccos: [{
        id: 1, brand: "toString", name: "T", category: "Anglais",
        lots: [{ id: 1, status: "jar", weightG: "30" }],
      }],
      pipes: [],
      wishlist: [],
    };
    const s = computeStats(data) as Record<string, unknown>;
    const brands = s.brands as Array<[string, number]>;
    // The "toString" tobacco contributes exactly 1 to the brand count,
    // not `function toString() { ... }1` (string concat).
    expect(brands).toContainEqual(["toString", 1]);
  });
});
