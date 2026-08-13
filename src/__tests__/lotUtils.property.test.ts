/**
 * Property-based fuzz test for the entire lot-utils pipeline.
 *
 * A sibling suite fuzzes `applyLotWeightDelta` end-to-end, which exposed an
 * `Infinity`-leak. This file extends the same approach to every pure
 * helper in src/utils/lotUtils.ts — testing each in isolation so a
 * future direct caller can't hit a regression that the composition
 * guard happens to mask.
 *
 * Functions covered:
 *   pickJarLot(tob, weightUnit)
 *   applyLifecycleDates(lot, nextStatus, mode)
 *   locateLotIdx(tob, lotId, delta, weightUnit)
 *   stepApplyDelta(lot, delta)
 *   stepAutoFinish(lot)
 *   stepAutoReactivate(lot, delta)
 *   reDeductRestoredSessions(data, ids, weightUnit)
 *
 * For every function the invariants are: (a) never throws on any
 * combination of garbage inputs, (b) returns a shape compatible with
 * the documented signature, (c) any numeric field it sets is finite,
 * non-negative, and parseable.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isUntrackedWeight } from "../utils.ts";
import {
  pickJarLot,
  applyLifecycleDates,
  locateLotIdx,
  stepApplyDelta,
  stepAutoFinish,
  stepAutoReactivate,
  reDeductRestoredSessions,
} from "../utils/lotUtils";

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
  arbGarbage(),
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

// Tobacco with possibly-garbage `lots` (sometimes null / undefined /
// a string instead of an array).
const arbTobacco = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  lots: fc.oneof(
    fc.array(arbLot(), { minLength: 0, maxLength: 4 }),
    fc.constant(undefined),
    fc.constant(null),
    arbGarbage(),
  ),
});

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

const arbWeightUnit = () => fc.oneof(
  fc.constantFrom("g", "oz"),
  arbGarbage(),
);

const arbStatusName = () => fc.oneof(
  fc.constantFrom("cellar" as const, "jar" as const, "finished" as const),
  // Garbage status names — applyLifecycleDates falls into the cellar
  // branch (else) when nextStatus isn't "jar" or "finished".
  fc.constant("unknown" as any),
  fc.constant("" as any),
);

const arbMode = () => fc.oneof(
  fc.constantFrom("manual" as const, "auto-recovery" as const),
  fc.constant(undefined as any),
  fc.constant("oops" as any),
);

// ── helpers ──────────────────────────────────────────────────────────────────

// An UNTRACKED weight is now a legal outcome, and the
// property is STRENGTHENED rather than relaxed: a lot the user never weighed
// must come out untracked (an absence of data is preserved, never turned into
// a zero), and every other lot must still yield a finite non-negative number.
// The `input` argument is what makes it an equivalence instead of a licence.
function asWeightOk(lot: any, label: string, input?: any) {
  // The untracked case is tested FIRST and against the INPUT, because an
  // absence is preserved verbatim — `undefined` stays `undefined`, it is not
  // normalised to "". Requiring a string before this check is what made the
  // first version of the carve-out fail.
  if (input !== undefined && isUntrackedWeight(input.weightG)) {
    expect(lot.weightG, `${label}: an unweighed lot must stay unweighed`).toBe(input.weightG);
    return;
  }
  if (!lot || typeof lot.weightG !== "string") {
    throw new Error(`${label}: expected lot.weightG to be a string, got ${typeof lot?.weightG}`);
  }
  const w = parseFloat(lot.weightG);
  expect(Number.isFinite(w), `${label}: weightG should parse to a finite number (got ${lot.weightG})`).toBe(true);
  expect(w, `${label}: weightG should be >= 0`).toBeGreaterThanOrEqual(0);
}

// ── pickJarLot ───────────────────────────────────────────────────────────────

describe("pickJarLot — fuzz", () => {
  it("never throws on garbage tobaccos / weightUnit", () => {
    fc.assert(
      fc.property(arbTobacco(), arbWeightUnit(), (tob, wu) => {
        expect(() => pickJarLot(tob, wu as any)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("returns null or a valid {lot, idx} pointing inside tob.lots", () => {
    fc.assert(
      fc.property(arbTobacco(), arbWeightUnit(), (tob, wu) => {
        const out = pickJarLot(tob, wu as any);
        if (out === null) return;
        expect(out).toHaveProperty("lot");
        expect(out).toHaveProperty("idx");
        expect(Number.isInteger(out.idx)).toBe(true);
        expect(out.idx).toBeGreaterThanOrEqual(0);
        if (Array.isArray(tob.lots)) {
          expect(out.idx).toBeLessThan(tob.lots.length);
          expect(out.lot).toBe(tob.lots[out.idx]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ── applyLifecycleDates ─────────────────────────────────────────────────────

describe("applyLifecycleDates — fuzz", () => {
  it("never throws on any lot / status / mode combination", () => {
    fc.assert(
      fc.property(arbLot(), arbStatusName(), arbMode(), (lot, ns, mode) => {
        expect(() => applyLifecycleDates(lot, ns, mode)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("sets `status` to exactly the requested nextStatus", () => {
    fc.assert(
      fc.property(arbLot(), arbStatusName(), arbMode(), (lot, ns, mode) => {
        const out = applyLifecycleDates(lot, ns, mode);
        expect(out.status).toBe(ns);
      }),
      { numRuns: 100 },
    );
  });

  it("`jar` ⟹ dateOpened is non-empty (lifecycle invariant)", () => {
    fc.assert(
      fc.property(arbLot(), arbMode(), (lot, mode) => {
        const out = applyLifecycleDates(lot, "jar", mode);
        expect(out.status).toBe("jar");
        expect(typeof out.dateOpened).toBe("string");
        expect((out.dateOpened || "").length).toBeGreaterThan(0);
        expect(out.dateFinished).toBe("");
      }),
      { numRuns: 100 },
    );
  });

  it("`finished` ⟹ dateFinished is non-empty", () => {
    fc.assert(
      fc.property(arbLot(), arbMode(), (lot, mode) => {
        const out = applyLifecycleDates(lot, "finished", mode);
        expect(out.status).toBe("finished");
        expect(typeof out.dateFinished).toBe("string");
        expect((out.dateFinished || "").length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("`cellar` + `manual` mode clears dateOpened AND dateFinished AND resets disposed", () => {
    fc.assert(
      fc.property(arbLot(), (lot) => {
        const out = applyLifecycleDates(lot, "cellar", "manual");
        expect(out.status).toBe("cellar");
        expect(out.dateOpened).toBe("");
        expect(out.dateFinished).toBe("");
        expect(out.disposed).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("does not mutate the input lot reference", () => {
    fc.assert(
      fc.property(arbLot(), arbStatusName(), (lot, ns) => {
        const snapshot = JSON.stringify(lot);
        applyLifecycleDates(lot, ns, "manual");
        expect(JSON.stringify(lot)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});

// ── locateLotIdx ────────────────────────────────────────────────────────────

describe("locateLotIdx — fuzz", () => {
  it("never throws on any tob / lotId / delta / weightUnit combination", () => {
    fc.assert(
      fc.property(arbTobacco(), arbGarbage(), arbDelta(), arbWeightUnit(),
        (tob, lotId, delta, wu) => {
          expect(() => locateLotIdx(tob, lotId, delta as any, wu as any)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns -1 or an integer that's a valid index in tob.lots", () => {
    fc.assert(
      fc.property(arbTobacco(), arbGarbage(), arbDelta(), arbWeightUnit(),
        (tob, lotId, delta, wu) => {
          const idx = locateLotIdx(tob, lotId, delta as any, wu as any);
          expect(Number.isInteger(idx)).toBe(true);
          expect(idx).toBeGreaterThanOrEqual(-1);
          if (idx >= 0) {
            // The function only returns >=0 when tob.lots is an array.
            expect(Array.isArray(tob.lots)).toBe(true);
            if (Array.isArray(tob.lots)) {
              expect(idx).toBeLessThan(tob.lots.length);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── stepApplyDelta ──────────────────────────────────────────────────────────

describe("stepApplyDelta — fuzz", () => {
  it("never throws and yields a finite, non-negative weightG string", () => {
    fc.assert(
      fc.property(arbLot(), arbDelta(), (lot, delta) => {
        let out: any;
        expect(() => { out = stepApplyDelta(lot, delta as any); }).not.toThrow();
        asWeightOk(out, "stepApplyDelta", lot);
      }),
      { numRuns: 200 },
    );
  });

  it("does not mutate the input lot", () => {
    fc.assert(
      fc.property(arbLot(), arbDelta(), (lot, delta) => {
        const snap = JSON.stringify(lot);
        stepApplyDelta(lot, delta as any);
        expect(JSON.stringify(lot)).toBe(snap);
      }),
      { numRuns: 100 },
    );
  });

  it("applies any string- or number-parseable delta to weightG", () => {
    fc.assert(
      fc.property(arbLot(), arbDelta(), (lot, delta) => {
        const out = stepApplyDelta(lot, delta as any);
        // An unweighed lot has no balance to move, so the
        // delta is not applied at all — it comes back untouched.
        if (isUntrackedWeight(lot.weightG)) {
          expect(out.weightG).toBe(lot.weightG);
          return;
        }
        // The contract was widened — stepApplyDelta now reads
        // weight through `safeW` (rejects Infinity AND negative). Mirror
        // the same coercion in the expected value.
        const rawW = parseFloat(lot.weightG as any);
        const w = Number.isFinite(rawW) && rawW >= 0 ? rawW : 0;
        const dRaw = parseFloat(String(delta));
        const d = Number.isFinite(dRaw) ? dRaw : 0;
        const expected = Math.max(0, Math.round((w + d) * 10) / 10);
        expect(parseFloat(out.weightG)).toBeCloseTo(expected, 5);
      }),
      { numRuns: 200 },
    );
  });
});

// ── stepAutoFinish ──────────────────────────────────────────────────────────

describe("stepAutoFinish — fuzz", () => {
  it("never throws on garbage lots", () => {
    fc.assert(
      fc.property(arbLot(), (lot) => {
        expect(() => stepAutoFinish(lot)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("only changes status when weightG === 0 AND status === 'jar'", () => {
    fc.assert(
      fc.property(arbLot(), (lot) => {
        const out = stepAutoFinish(lot);
        // stepAutoFinish now reads weight through `safeW`
        // (mirror in the expected value). A denormal negative like
        // `-1.4e-45` previously stayed at jar; now safeW clamps it
        // to 0, which is the same as a sealed-empty state and the
        // jar auto-finishes — that's intentional defensive behaviour.
        // An unweighed lot has no zero to reach, so it never
        // auto-closes. Without this carve-out the first session logged against
        // a jar the user never weighed would finish it on the spot.
        if (isUntrackedWeight(lot.weightG)) {
          expect(out.status).toBe(lot.status);
          return;
        }
        const rawW = parseFloat(lot.weightG as any);
        const w = Number.isFinite(rawW) && rawW >= 0 ? rawW : 0;
        if (w === 0 && lot.status === "jar") {
          expect(out.status).toBe("finished");
          expect(out.disposed).toBe(false);
          expect(typeof out.dateFinished).toBe("string");
          expect((out.dateFinished || "").length).toBeGreaterThan(0);
        } else {
          // No-op: same status / same dateFinished / same disposed
          expect(out.status).toBe(lot.status);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── stepAutoReactivate ──────────────────────────────────────────────────────

describe("stepAutoReactivate — fuzz", () => {
  it("never throws on garbage lots / delta", () => {
    fc.assert(
      fc.property(arbLot(), arbDelta(), (lot, delta) => {
        expect(() => stepAutoReactivate(lot, delta as any)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  // The flip also requires !lot.disposed — a disposed lot never
  // auto-reactivates, so it keeps its finished
  // status even with a positive weight-restoring delta.
  it("only flips to 'jar' when delta > 0 AND weightG > 0 AND status === 'finished' AND not disposed", () => {
    fc.assert(
      fc.property(arbLot(), arbDelta(), (lot, delta) => {
        const out = stepAutoReactivate(lot, delta as any);
        const d = parseFloat(String(delta)) || 0;
        const w = parseFloat(lot.weightG as any) || 0;
        if (Number.isFinite(d) && d > 0 && w > 0 && lot.status === "finished" && !lot.disposed) {
          expect(out.status).toBe("jar");
        } else {
          expect(out.status).toBe(lot.status);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── reDeductRestoredSessions ────────────────────────────────────────────────

const arbSession = () => fc.record({
  id: fc.oneof(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  tobaccoId: fc.oneof(fc.string({ maxLength: 4 }), fc.integer({ min: 1, max: 999 })),
  lotId: fc.oneof(fc.constant(""), fc.string({ maxLength: 6 })),
  weightG: arbGarbage(),
  deletedAt: fc.oneof(fc.constant(undefined), fc.constant(""), fc.string({ maxLength: 30 })),
});

const arbData = () => fc.record({
  tobaccos: fc.array(arbTobacco(), { minLength: 0, maxLength: 4 }),
  sessions: fc.array(arbSession(), { minLength: 0, maxLength: 6 }),
});

describe("reDeductRestoredSessions — fuzz", () => {
  it("never throws on garbage data / ids / weightUnit", () => {
    fc.assert(
      fc.property(arbData(), fc.array(fc.string({ maxLength: 4 }), { maxLength: 5 }), arbWeightUnit(),
        (data, ids, wu) => {
          expect(() => reDeductRestoredSessions(data, ids, wu as any)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns data with the same number of top-level sessions", () => {
    fc.assert(
      fc.property(arbData(), fc.array(fc.string({ maxLength: 4 }), { maxLength: 5 }), arbWeightUnit(),
        (data, ids, wu) => {
          const out = reDeductRestoredSessions(data, ids, wu as any);
          expect(Array.isArray(out.sessions)).toBe(true);
          expect(out.sessions.length).toBe(data.sessions.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns identical reference when no ids match", () => {
    fc.assert(
      fc.property(arbData(), arbWeightUnit(), (data, wu) => {
        const out = reDeductRestoredSessions(data, [], wu as any);
        expect(out).toBe(data);
      }),
      { numRuns: 50 },
    );
  });
});
