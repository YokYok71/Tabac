/**
 * Property-based fuzz test for `applyLotWeightDelta`.
 *
 * The crash showed that a single numeric value slipping into
 * a string-typed field can break a sort. This test asks the broader
 * question: can the lot-weight pipeline survive ANY garbage on its
 * inputs?
 *
 * The existing `lotLifecycle.property.test.ts` already fuzzes
 * SEQUENCES of clean operations and locks the comptable invariant.
 * This file complements it by fuzzing the SCALAR INPUTS — random
 * combinations of null / undefined / string / number / boolean / float
 * / NaN in `lot.weightG`, `lot.weightInitial`, `lot.status`,
 * `lot.originalStatus`, `lot.disposed`, plus delta variations
 * (negative, positive, zero, NaN, Infinity, string).
 *
 * Post-conditions:
 *   1. The call must NEVER throw.
 *   2. The return value is always a fresh object whose `.tobaccos` is
 *      an array of the same length as the input.
 *   3. The targeted lot's `weightG` is a parseable numeric string
 *      (parseFloat returns a finite number).
 *   4. Idempotence-of-no-op: applying a zero (or non-numeric) delta
 *      leaves the lot's weightG numerically equal to the original
 *      (within rounding). Catches future refactors that accidentally
 *      mutate weight on a no-op delta.
 *   5. Negative-delta cap: the resulting weight is never negative.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isUntrackedWeight } from "../utils.ts";
import { applyLotWeightDelta } from "../utils/lotUtils";

// ── arbitraries ──────────────────────────────────────────────────────────────

const arbGarbage = (): fc.Arbitrary<unknown> => fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(""),
  fc.string({ maxLength: 8 }),
  fc.integer({ min: -100, max: 1000 }),
  fc.float({ noNaN: false, min: Math.fround(-50), max: Math.fround(500) }),
  fc.boolean(),
);

const arbStatus = () => fc.oneof(
  fc.constantFrom("cellar", "jar", "finished"),
  arbGarbage(), // including garbage values
);

const arbLot = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 9999 })),
  status: arbStatus(),
  weightG: arbGarbage(),
  weightInitial: arbGarbage(),
  dateOpened: arbGarbage(),
  dateFinished: arbGarbage(),
  originalStatus: arbStatus(),
  disposed: arbGarbage(),
});

const arbTobacco = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  lots: fc.array(arbLot(), { minLength: 0, maxLength: 4 }),
});

const arbData = () => fc.record({
  tobaccos: fc.array(arbTobacco(), { minLength: 1, maxLength: 4 }),
});

// Delta: every shape applyLotWeightDelta might see.
const arbDelta = () => fc.oneof(
  fc.integer({ min: -200, max: 200 }),
  fc.float({ noNaN: false, min: Math.fround(-100), max: Math.fround(100) }),
  fc.constant(0),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.string({ maxLength: 6 }),
  fc.constant(null),
  fc.constant(undefined),
);

// ── helpers ──────────────────────────────────────────────────────────────────

// Pick a random (tobacco, lot) pair from `d` — using a numeric "seed"
// drawn from fast-check, so the same seed always picks the same target.
function pickTarget(d: any, seed: number): { tobId: any; lotId: any } | null {
  const tobs = (d.tobaccos || []).filter((t: any) => Array.isArray(t.lots) && t.lots.length > 0);
  if (tobs.length === 0) return null;
  const tob = tobs[seed % tobs.length];
  const lot = tob.lots[seed % tob.lots.length];
  return { tobId: tob.id, lotId: lot.id };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("applyLotWeightDelta — property: garbage input never crashes", () => {
  it("never throws on any combination of garbage data + delta", () => {
    fc.assert(
      fc.property(arbData(), arbDelta(), fc.integer({ min: 0, max: 100 }), fc.constantFrom("g", "oz"),
        (d, delta, seed, weightUnit) => {
          const target = pickTarget(d, seed);
          // No usable target → still try applying with a synthetic id;
          // the function must handle "lot not found" gracefully.
          const tobId = target ? target.tobId : "MISSING_TOB";
          const lotId = target ? target.lotId : "MISSING_LOT";
          expect(() => applyLotWeightDelta(d, tobId, lotId, delta, weightUnit)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("preserves the data shape: result is a fresh object with same-length tobaccos array", () => {
    fc.assert(
      fc.property(arbData(), arbDelta(), fc.integer({ min: 0, max: 100 }),
        (d, delta, seed) => {
          const target = pickTarget(d, seed);
          const tobId = target ? target.tobId : "MISSING";
          const lotId = target ? target.lotId : "MISSING";
          const out = applyLotWeightDelta(d, tobId, lotId, delta, "g");
          expect(typeof out).toBe("object");
          expect(Array.isArray(out.tobaccos)).toBe(true);
          expect(out.tobaccos.length).toBe(d.tobaccos.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("targeted lot weightG ends up as a parseable numeric string (never NaN, never negative)", () => {
    fc.assert(
      fc.property(arbData(), arbDelta(), fc.integer({ min: 0, max: 100 }), fc.constantFrom("g", "oz"),
        (d, delta, seed, weightUnit) => {
          const target = pickTarget(d, seed);
          if (!target) return; // skip if no usable lot
          const out = applyLotWeightDelta(d, target.tobId, target.lotId, delta, weightUnit);
          const tob = (out.tobaccos || []).find((t: any) => String(t.id) === String(target.tobId));
          if (!tob) return;
          const lot = (tob.lots || []).find((l: any) => String(l.id) === String(target.lotId));
          if (!lot) return;
          // An UNWEIGHED lot has no balance to move, so it
          // comes back verbatim rather than being coerced to "0". The
          // post-condition is now a disjunction, and the untracked branch is
          // the STRONGER of the two: an absence of data must be preserved
          // exactly, never normalised.
          const before = (d.tobaccos || [])
            .find((t: any) => String(t.id) === String(target.tobId))?.lots
            ?.find((l: any) => String(l.id) === String(target.lotId));
          if (before && isUntrackedWeight(before.weightG)) {
            expect(lot.weightG).toBe(before.weightG);
            return;
          }
          // Post-condition: weightG is a string parseable to a finite, non-negative number.
          expect(typeof lot.weightG).toBe("string");
          const w = parseFloat(lot.weightG);
          expect(Number.isFinite(w)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("non-numeric / zero delta leaves the lot's weight numerically unchanged", () => {
    // applyLotWeightDelta normalises the delta via parseFloat(String(delta)) || 0.
    // A garbage delta (null, undefined, "abc", NaN, etc.) folds to 0,
    // so applying it must NOT alter the lot's weight numerically.
    const noopDeltaArb = fc.oneof(
      fc.constant(0),
      fc.constant(NaN),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(""),
      fc.constantFrom("abc", "not-a-number", "NaN"),
    );
    fc.assert(
      fc.property(arbData(), noopDeltaArb, fc.integer({ min: 0, max: 100 }), fc.constantFrom("g", "oz"),
        (d, noopDelta, seed, weightUnit) => {
          const target = pickTarget(d, seed);
          if (!target) return;
          // Capture the original weightG (as a number) before mutation.
          const beforeTob = d.tobaccos.find((t: any) => String(t.id) === String(target.tobId));
          const beforeLot = beforeTob && beforeTob.lots.find((l: any) => String(l.id) === String(target.lotId));
          if (!beforeLot) return;
          const beforeW = parseFloat(String(beforeLot.weightG)) || 0;

          const out = applyLotWeightDelta(d, target.tobId, target.lotId, noopDelta, weightUnit);
          const afterTob = out.tobaccos.find((t: any) => String(t.id) === String(target.tobId));
          const afterLot = afterTob && afterTob.lots.find((l: any) => String(l.id) === String(target.lotId));
          if (!afterLot) return;
          const afterW = parseFloat(afterLot.weightG) || 0;
          // Allow ±0.05g tolerance for Math.round((w+0)*10)/10 rounding.
          expect(Math.abs(afterW - Math.max(0, Math.round(beforeW * 10) / 10))).toBeLessThan(0.06);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("negative delta never drives the weight below zero", () => {
    fc.assert(
      fc.property(arbData(), fc.integer({ min: -500, max: -1 }), fc.integer({ min: 0, max: 100 }), fc.constantFrom("g", "oz"),
        (d, negDelta, seed, weightUnit) => {
          const target = pickTarget(d, seed);
          if (!target) return;
          const out = applyLotWeightDelta(d, target.tobId, target.lotId, negDelta, weightUnit);
          const tob = out.tobaccos.find((t: any) => String(t.id) === String(target.tobId));
          if (!tob) return;
          const lot = tob.lots.find((l: any) => String(l.id) === String(target.lotId));
          if (!lot) return;
          // An unweighed lot is left untouched, so there is
          // no clamp to check: the absence is preserved instead.
          if (isUntrackedWeight(lot.weightG)) return;
          const w = parseFloat(lot.weightG);
          // The min(0, …) clamp inside stepApplyDelta should hold here.
          expect(w).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
