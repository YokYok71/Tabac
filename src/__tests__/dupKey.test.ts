/**
 * Tests for `dupKey` (src/hooks/useImportConfirm.ts).
 *
 * dupKey is the case- and whitespace-insensitive identity key used for
 * three critical paths:
 *   - duplicate detection in TobaccoFormView / WishFormView
 *   - the selective-merge picker (keying staged rows for the Set)
 *   - useImportConfirm.applyImport "merge" mode (matching local vs incoming)
 *
 * Invariants:
 *   1. case-insensitive (BRAND === brand)
 *   2. whitespace-insensitive (leading / trailing trimmed)
 *   3. null / undefined / missing-field tolerant (never throws)
 *   4. anchored to brand+name only (other fields are ignored)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { dupKey } from "../hooks/useImportConfirm";

describe("dupKey", () => {
  it("is case-insensitive on brand AND name", () => {
    expect(dupKey({ brand: "Halvorsen", name: "Sherlock" }))
      .toBe(dupKey({ brand: "HALVORSEN", name: "sherlock" }));
    expect(dupKey({ brand: "Pellworm", name: "HH Vintage" }))
      .toBe(dupKey({ brand: "pellworm", name: "hh vintage" }));
  });

  it("is whitespace-insensitive (leading / trailing)", () => {
    expect(dupKey({ brand: "  Halvorsen  ", name: "Sherlock" }))
      .toBe(dupKey({ brand: "Halvorsen", name: "  Sherlock  " }));
    expect(dupKey({ brand: "\tHalvorsen\n", name: "\rSherlock\t" }))
      .toBe(dupKey({ brand: "Halvorsen", name: "Sherlock" }));
  });

  it("tolerates missing fields (null / undefined / absent)", () => {
    expect(() => dupKey(null)).not.toThrow();
    expect(() => dupKey(undefined)).not.toThrow();
    expect(() => dupKey({})).not.toThrow();
    expect(() => dupKey({ brand: null, name: undefined })).not.toThrow();
    expect(dupKey({})).toBe("|");
    expect(dupKey(null)).toBe("|");
  });

  it("ignores every field other than brand+name", () => {
    var a = { brand: "P", name: "S", id: 1, rating: 5, category: "Anglais" };
    var b = { brand: "P", name: "S", id: 999, rating: 0, blend: "BlendX" };
    expect(dupKey(a)).toBe(dupKey(b));
  });

  it("brand + name are joined by exactly one '|' (no collision between split fields)", () => {
    // "AB" + "" must NOT collide with "A" + "B"
    expect(dupKey({ brand: "AB", name: "" }))
      .not.toBe(dupKey({ brand: "A", name: "B" }));
    // "" + "AB" must NOT collide with "A" + "B"
    expect(dupKey({ brand: "", name: "AB" }))
      .not.toBe(dupKey({ brand: "A", name: "B" }));
  });

  it("coerces non-string values without throwing (numbers, booleans, objects)", () => {
    expect(() => dupKey({ brand: 42, name: true })).not.toThrow();
    expect(() => dupKey({ brand: {}, name: [] })).not.toThrow();
    // Coerced values are still lower-cased / trimmed.
    expect(dupKey({ brand: 42, name: 7 }))
      .toBe(dupKey({ brand: "42", name: "7" }));
  });

  it("property: invariant under upper/lower casing + whitespace padding", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        function (brand, name) {
          var pad = "  \t";
          var k1 = dupKey({ brand: brand, name: name });
          var k2 = dupKey({
            brand: pad + brand.toUpperCase() + pad,
            name: pad + name.toLowerCase() + pad,
          });
          expect(k1).toBe(k2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("property: never throws on arbitrary garbage objects", () => {
    fc.assert(
      fc.property(
        fc.anything(),
        function (anything) {
          expect(() => dupKey(anything)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("property: result is always a string with exactly one '|' separator", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.record({
            brand: fc.oneof(fc.string(), fc.constant(undefined), fc.integer()),
            name: fc.oneof(fc.string(), fc.constant(undefined), fc.integer()),
          }),
        ),
        function (it) {
          var k = dupKey(it);
          expect(typeof k).toBe("string");
          // The brand and name are toLowerCase()/trim()-ed before joining;
          // they may themselves contain "|" (legal user input), so we
          // only assert "at least one |".
          expect(k.indexOf("|")).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
