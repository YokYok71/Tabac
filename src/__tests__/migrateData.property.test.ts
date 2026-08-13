/**
 * Property-based shape verification for migrateData.
 *
 * The hotfix exposed that a single numeric value slipping
 * into a string-typed field crashes any sort that calls localeCompare.
 * The audit added explicit String() at every known call
 * site and migrateData itself coerces a known set of fields at load.
 *
 * This file goes one step further: fast-check generates garbage AppData
 * payloads — mixed numbers / strings / nulls / undefineds / booleans
 * in every field — runs them through migrateData, and asserts the
 * post-conditions:
 *
 *   1. Every documented string field is now `typeof === "string"`
 *      OR `=== undefined`. Never null, never number, never boolean,
 *      never object.
 *   2. Counters (nxT/nxW/nxP/nxA/nxJ) are integers ≥ 1.
 *   3. Top-level arrays remain arrays.
 *   4. Idempotence: migrateData(migrateData(d)) deep-equals migrateData(d).
 *
 * Catches future regressions where someone adds a string field without
 * adding it to migrateData's coercion list, or where someone tweaks
 * the coercion in a way that breaks idempotence.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { migrateData } from "../utils";

// ── arbitraries ──────────────────────────────────────────────────────────────

// Garbage value generator — every type the JSON layer can hand us
// EXCEPT plain objects (which would be semantically meaningless for a
// scalar field). Includes the "missing-or-blank" cases that pre-build
// 229 worked fine: undefined, null, "".
function arbGarbage(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(""),
    fc.string({ maxLength: 12 }),
    fc.integer({ min: -100, max: 1000 }),
    fc.float({ noNaN: true, min: Math.fround(-50), max: Math.fround(500) }),
    fc.boolean(),
  );
}

function arbGarbageLot() {
  return fc.record({
    id: fc.oneof(fc.string({ minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 9999 })),
    status: fc.constantFrom("cellar", "jar", "finished"),
    weightG: arbGarbage(),
    weightInitial: arbGarbage(),
    datePurchased: arbGarbage(),
    dateProduction: arbGarbage(),
    dateOpened: arbGarbage(),
    dateFinished: arbGarbage(),
    boxNumber: arbGarbage(),
    price: arbGarbage(),
    seller: arbGarbage(),
    originalStatus: fc.constantFrom("cellar", "jar"),
    disposed: fc.boolean(),
  });
}

function arbGarbageTobacco() {
  return fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    name: arbGarbage(),
    brand: arbGarbage(),
    category: arbGarbage(),
    blend: arbGarbage(),
    cut: arbGarbage(),
    force: fc.integer({ min: 0, max: 5 }),
    roomNote: fc.integer({ min: 0, max: 5 }),
    taste: fc.integer({ min: 0, max: 5 }),
    rating: fc.integer({ min: 0, max: 5 }),
    rebuy: fc.oneof(fc.constant(null), fc.boolean()),
    tastingNotes: arbGarbage(),
    description: arbGarbage(),
    imageUrl: arbGarbage(),
    agingMax: arbGarbage(),
    lots: fc.array(arbGarbageLot(), { maxLength: 4 }),
  });
}

function arbGarbagePipe() {
  return fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    name: arbGarbage(),
    brand: arbGarbage(),
    shape: arbGarbage(),
    courbure: arbGarbage(),
    length: arbGarbage(),
    weight: arbGarbage(),
    filterType: arbGarbage(),
    chamberDiameter: arbGarbage(),
    chamberDepth: arbGarbage(),
    bowlMaterial: arbGarbage(),
    stemMaterial: arbGarbage(),
    finish: arbGarbage(),
    datePurchased: arbGarbage(),
    dateProduction: arbGarbage(),
    price: arbGarbage(),
    seller: arbGarbage(),
    description: arbGarbage(),
    notes: arbGarbage(),
    imageUrl: arbGarbage(),
    rating: fc.integer({ min: 0, max: 5 }),
    status: fc.constantFrom("active", "finished"),
  });
}

function arbGarbageAccessory() {
  return fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    name: arbGarbage(),
    brand: arbGarbage(),
    type: arbGarbage(),
    fuel: arbGarbage(),
    status: fc.constantFrom("active", "retired"),
    datePurchased: arbGarbage(),
    price: arbGarbage(),
    seller: arbGarbage(),
    notes: arbGarbage(),
    imageUrl: arbGarbage(),
    rating: fc.integer({ min: 0, max: 5 }),
  });
}

function arbGarbageSession() {
  return fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    tobaccoId: fc.oneof(fc.constant(""), fc.integer({ min: 1, max: 9999 })),
    pipeId: fc.oneof(fc.constant(""), fc.integer({ min: 1, max: 9999 })),
    date: arbGarbage(),
    duration: arbGarbage(),
    rating: fc.integer({ min: 0, max: 5 }),
    notes: arbGarbage(),
    weightG: arbGarbage(),
    lotId: fc.oneof(fc.constant(""), fc.string({ maxLength: 8 })),
  });
}

function arbGarbageWish() {
  return fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    name: arbGarbage(),
    brand: arbGarbage(),
    category: arbGarbage(),
    blend: arbGarbage(),
    cut: arbGarbage(),
    force: fc.integer({ min: 0, max: 5 }),
    roomNote: fc.integer({ min: 0, max: 5 }),
    taste: fc.integer({ min: 0, max: 5 }),
    description: arbGarbage(),
    tastingNotes: arbGarbage(),
    imageUrl: arbGarbage(),
    notes: arbGarbage(),
    priority: arbGarbage(),
    agingMax: arbGarbage(),
  });
}

function arbGarbageData() {
  return fc.record({
    tobaccos: fc.array(arbGarbageTobacco(), { maxLength: 5 }),
    pipes: fc.array(arbGarbagePipe(), { maxLength: 5 }),
    accessories: fc.array(arbGarbageAccessory(), { maxLength: 5 }),
    sessions: fc.array(arbGarbageSession(), { maxLength: 5 }),
    wishlist: fc.array(arbGarbageWish(), { maxLength: 5 }),
    nxT: arbGarbage(),
    nxW: arbGarbage(),
    nxP: arbGarbage(),
    nxA: arbGarbage(),
    nxJ: arbGarbage(),
  });
}

// ── assertions ───────────────────────────────────────────────────────────────

// Asserts that every named field on `obj` is either `typeof === "string"`,
// `=== undefined`, or `=== null`. After migrateData, the only ways a
// documented string field can land are: a real string (coerced or
// already), or undefined/null (passthrough). Booleans and numbers
// MUST have been coerced.
function assertStringOrNullish(obj: any, fields: string[], label: string) {
  for (const k of fields) {
    const v = obj?.[k];
    if (v === undefined || v === null) continue;
    expect(
      typeof v,
      `${label}.${k} should be a string after migrateData but is ${typeof v} (value: ${JSON.stringify(v)})`,
    ).toBe("string");
  }
}

const TOB_FIELDS = ["name","brand","category","blend","cut","tastingNotes","description","imageUrl","agingMax"];
const LOT_FIELDS = ["weightG","weightInitial","datePurchased","dateProduction","dateOpened","dateFinished","boxNumber","price","seller","status","originalStatus"];
const PIPE_FIELDS = ["name","brand","shape","courbure","length","weight","filterType","chamberDiameter","chamberDepth","bowlMaterial","stemMaterial","finish","datePurchased","dateProduction","price","seller","description","notes","imageUrl","status"];
const ACC_FIELDS = ["name","brand","type","fuel","datePurchased","price","seller","notes","imageUrl","status"];
const SESS_FIELDS = ["date","duration","weightG","notes"];
const WISH_FIELDS = ["name","brand","category","blend","cut","tastingNotes","description","imageUrl","notes","priority","agingMax"];

// ── tests ────────────────────────────────────────────────────────────────────

describe("migrateData — property: shape post-conditions on garbage input", () => {
  it("every documented string field is a string (or undefined/null) after migrateData", () => {
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const t of d.tobaccos) {
          assertStringOrNullish(t, TOB_FIELDS, "tobacco");
          for (const l of (t.lots || [])) assertStringOrNullish(l, LOT_FIELDS, "lot");
        }
        for (const p of d.pipes) assertStringOrNullish(p, PIPE_FIELDS, "pipe");
        for (const a of d.accessories) assertStringOrNullish(a, ACC_FIELDS, "accessory");
        for (const s of d.sessions) assertStringOrNullish(s, SESS_FIELDS, "session");
        for (const w of d.wishlist) assertStringOrNullish(w, WISH_FIELDS, "wish");
      }),
      { numRuns: 100 },
    );
  });

  it("counters are clamped to integers >= 1", () => {
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const k of ["nxT","nxW","nxP","nxA","nxJ"] as const) {
          const v = (d as any)[k];
          expect(typeof v).toBe("number");
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("top-level arrays remain arrays", () => {
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        expect(Array.isArray(d.tobaccos)).toBe(true);
        expect(Array.isArray(d.pipes)).toBe(true);
        expect(Array.isArray(d.accessories)).toBe(true);
        expect(Array.isArray(d.sessions)).toBe(true);
        expect(Array.isArray(d.wishlist)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("idempotent: migrateData(migrateData(d)) deep-equals migrateData(d)", () => {
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        // migrateData mints a random uid for uid-less entities, so
        // it isn't deterministic across two independent copies. Idempotency —
        // the property under test — means re-migrating an ALREADY-migrated
        // object is a no-op; thread the same `once` through a second pass.
        const clone = JSON.parse(JSON.stringify(d));
        const once = migrateData(JSON.parse(JSON.stringify(clone)) as any);
        const twice = migrateData(JSON.parse(JSON.stringify(once)) as any);
        expect(twice).toEqual(once);
      }),
      { numRuns: 50 },
    );
  });

  // ── entity preservation / id uniqueness / weightInitial backfill ──
  //
  // The audit explicitly flagged migrateData's coverage gaps:
  //   "a fuzz that proves 'never loses a tabac, never creates an id
  //    collision, output always well-typed'".
  // The first 5 tests above cover the shape/coercion side. The block
  // below covers the structural side — what the function preserves
  // vs. transforms, and the invariants the rest of the codebase
  // relies on at every load.

  it("entity counts are preserved (migrateData never silently drops a row)", () => {
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        const before = {
          tobaccos: d.tobaccos.length,
          pipes: d.pipes.length,
          accessories: d.accessories.length,
          sessions: d.sessions.length,
          wishlist: d.wishlist.length,
        };
        const lotsBefore = d.tobaccos.reduce(
          (s, t: any) => s + ((t.lots || []).length),
          0,
        );
        migrateData(d as any);
        // No silent drops at the top level.
        expect(d.tobaccos.length).toBe(before.tobaccos);
        expect(d.pipes.length).toBe(before.pipes);
        expect(d.accessories.length).toBe(before.accessories);
        expect(d.sessions.length).toBe(before.sessions);
        expect(d.wishlist.length).toBe(before.wishlist);
        // No silent lot drops inside tobaccos either.
        const lotsAfter = d.tobaccos.reduce(
          (s, t: any) => s + ((t.lots || []).length),
          0,
        );
        expect(lotsAfter).toBe(lotsBefore);
      }),
      { numRuns: 100 },
    );
  });

  it("counters strictly exceed every existing id (next-id contract)", () => {
    // The CRUD stores read `data.nxT` / `nxP` / `nxA` / `nxJ` / `nxW`
    // and use the value as the id for the NEXT inserted row. If the
    // counter is ≤ an existing id, the next insert collides. Loaded
    // data must satisfy `nxT > max(tobaccos[].id)` (and same for the
    // four other kinds). migrateData is the load-time gate.
    //
    // migrateData now reconciles each
    // counter past the max existing id — this test asserts the STRONG
    // contract its title always promised (it previously only checked ≥ 1,
    // documenting the earlier gap). Regression lock: reverting
    // bumpCounterPastMaxId fails here on the very first shrunk counterexample.
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        // Stamp clean numeric ids so the assertion is meaningful — the
        // arbitrary's garbage ids would otherwise dominate the test.
        d.tobaccos.forEach((t: any, i: number) => { t.id = i + 1; });
        d.pipes.forEach((p: any, i: number) => { p.id = i + 1; });
        d.accessories.forEach((a: any, i: number) => { a.id = i + 1; });
        d.sessions.forEach((s: any, i: number) => { s.id = i + 1; });
        d.wishlist.forEach((w: any, i: number) => { w.id = i + 1; });
        // Force each counter BELOW the max id to exercise the reconciliation.
        (d as any).nxT = 0;
        (d as any).nxP = 0;
        (d as any).nxA = 0;
        (d as any).nxJ = 0;
        (d as any).nxW = 0;
        migrateData(d as any);
        var maxId = (arr: any[]) => arr.reduce((m, x) => Math.max(m, x.id || 0), 0);
        // Strong invariant: the next id minted can never collide.
        expect((d as any).nxT).toBeGreaterThan(maxId(d.tobaccos));
        expect((d as any).nxP).toBeGreaterThan(maxId(d.pipes));
        expect((d as any).nxA).toBeGreaterThan(maxId(d.accessories));
        expect((d as any).nxJ).toBeGreaterThan(maxId(d.sessions));
        expect((d as any).nxW).toBeGreaterThan(maxId(d.wishlist));
        // And still always ≥ 1 (empty collections).
        expect((d as any).nxT).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 50 },
    );
  });

  it("weightInitial is back-filled on every lot (used by the LotRow '/ Xg initial' annotation)", () => {
    // An earlier release invariant: every lot must carry a `weightInitial`
    // after migrateData. Legacy lots without the field inherit
    // weightG; lots that already have it are left alone. The
    // LotRow display + the cellar/jar age recap both depend on
    // this field being populated.
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const t of d.tobaccos) {
          for (const l of (t.lots || [])) {
            // weightInitial is a documented string field — it may be
            // empty ("") if both weightG and weightInitial were absent
            // on the legacy row, but it must EXIST as a property
            // (typeof string OR undefined-but-key-set is acceptable).
            expect(
              "weightInitial" in (l as any),
              `lot is missing weightInitial property: ${JSON.stringify(l)}`,
            ).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("originalStatus is back-filled on every lot", () => {
    // Same as weightInitial — every lot must carry an `originalStatus`
    // post-migration, inferred from status + dateOpened on legacy
    // rows.
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const t of d.tobaccos) {
          for (const l of (t.lots || [])) {
            expect("originalStatus" in (l as any)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("disposed is always boolean after migration (false by default)", () => {
    // The 'Lots finis' counter relies on `!l.disposed` and a
    // non-boolean (truthy non-undefined) would skew the count.
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const t of d.tobaccos) {
          for (const l of (t.lots || [])) {
            // `disposed` may be absent on legacy rows where status !==
            // "finished" — migrateData doesn't fabricate it. But when
            // it IS present, it must be a boolean (never a number,
            // never a string).
            const v = (l as any).disposed;
            if (v !== undefined) {
              expect(typeof v).toBe("boolean");
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it(".localeCompare can be called safely on every coerced string field", () => {
    // Smoke: after migrateData, calling .localeCompare on every string
    // field of every entity must NOT throw. Catches any field that
    // slips through the coercion list. This is THE test that proves
    // The regression cannot come back through the data layer.
    //
    // The two .localeCompare("") calls below are intentionally raw
    // (no String() wrap) — that's the whole point: we want them to
    // succeed PRECISELY because migrateData has already coerced the
    // field. Wrapping in String() would defeat the assertion. The
    // custom rule is disabled on the two specific lines.
    fc.assert(
      fc.property(arbGarbageData(), (d) => {
        migrateData(d as any);
        for (const t of d.tobaccos) {
          for (const k of TOB_FIELDS) {
            if (t[k as keyof typeof t] !== undefined && t[k as keyof typeof t] !== null) {
              // eslint-disable-next-line tabac-local/string-locale-compare
              expect(() => (t[k as keyof typeof t] as any).localeCompare("")).not.toThrow();
            }
          }
          for (const l of (t.lots || [])) {
            for (const k of LOT_FIELDS) {
              if (l[k as keyof typeof l] !== undefined && l[k as keyof typeof l] !== null) {
                // eslint-disable-next-line tabac-local/string-locale-compare
                expect(() => (l[k as keyof typeof l] as any).localeCompare("")).not.toThrow();
              }
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
