// CAT_MAP / CUT_MAP — the catalogue IMPORT CONTRACT.
//
// These maps carry the trade / retailer labels a source may write ("Cigar",
// "Navy Cut", "Krumble Kake"), mapped onto the app's canonical CATS / CUTS
// values. They are what lets a catalogue CSV say `Navy Cut` and have the app
// understand `Flake`.
//
// ── WHAT THIS FILE USED TO BE, AND WHY IT CHANGED ──────────
//
// Until this build the maps had TWO readers — the TypeScript bundle and
// `scripts/catalogueChecks.cjs`, which PARSED them back out of `constants.ts`
// so the Node catalogue gate could not drift from the app. Three cases here
// locked that arrangement: the two sides had to be observably equal, the
// checker had to carry no literal copy, and its parse had to fail FATALLY
// rather than degrade to `{}`.
//
// The catalogue became the user's own file, and the Node tooling that
// judged a delivered one was deleted. **There is no second reader left**, so
// those three cases were verifying that a parser nobody runs correctly parses
// a map — and keeping them would have kept ~1300 lines alive to be tested.
// They are REMOVED, and the removal is recorded here rather than left to be
// rediscovered: if a Node consumer of these maps ever returns, restore the
// parse AND those three cases together, because the whole reason they existed
// is that a hand-mirrored copy drifts (`FAMILY_AGING_MAX`,
// `CATS` in the deleted validator until 154, the tag predicate in four copies
// until 190 — each under a comment asking a human to keep two lists in step).
//
// WHAT SURVIVES IS THE PART THAT WAS NEVER ABOUT NODE: the maps are read at
// runtime with a key that comes from a CSV the USER wrote, and everything
// below is about that.

import { describe, it, expect } from "vitest";
import { CAT_MAP, CUT_MAP, mapCategory, mapCut, CATS, CUTS } from "../constants.ts";

describe("the maps are populated, so nothing below passes vacuously", () => {
  it("both carry a real number of entries", () => {
    expect(Object.keys(CAT_MAP).length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(CUT_MAP).length).toBeGreaterThanOrEqual(10);
  });
});

describe("the maps are safe against a user-supplied label", () => {
  it("are null-prototype", () => {
    // The key can come from a CSV the USER wrote, so on a plain object a row
    // carrying `category: "constructor"` would resolve to a member of
    // Object.prototype — truthy, not a category, defeating the `MAP[c] || c`
    // fallback both helpers are built on.
    expect(Object.getPrototypeOf(CAT_MAP)).toBeNull();
    expect(Object.getPrototypeOf(CUT_MAP)).toBeNull();
  });

  it("a forged key passes through verbatim instead of resolving", () => {
    for (const forged of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(mapCategory(forged), forged).toBe(forged);
      expect(mapCut(forged), forged).toBe(forged);
    }
  });

  it("an unknown label passes through — the caller judges, not the map", () => {
    // The contract the browser importer relies on: an unrecognised label is
    // returned as-is so the caller can REPORT it. A map that silently invented
    // a fallback would launder a bad value past the check that feeds on it
    // (the lesson, other axis).
    expect(mapCategory("Zzz Unknown")).toBe("Zzz Unknown");
    expect(mapCut("Zzz Unknown")).toBe("Zzz Unknown");
  });
});

describe("every map TARGET is itself canonical", () => {
  // An earlier release wrote this for CUT_MAP: an entry pointing at a non-canonical
  // value would launder a bad cut straight into the cellar. It applies to
  // CAT_MAP identically.
  it("CAT_MAP targets are all in CATS", () => {
    const bad = Object.entries(CAT_MAP).filter(([, v]) => !(CATS as readonly string[]).includes(v));
    expect(bad).toEqual([]);
  });
  it("CUT_MAP targets are all in CUTS", () => {
    const bad = Object.entries(CUT_MAP).filter(([, v]) => !(CUTS as readonly string[]).includes(v));
    expect(bad).toEqual([]);
  });
  it("no map entry shadows a value that is ALREADY canonical", () => {
    // Mapping a canonical value onto something else would silently rewrite a
    // correct label. (A case-only slip like "Loose cut" is not canonical, so
    // it is legitimately mapped.)
    const catBad = Object.keys(CAT_MAP).filter((k) => (CATS as readonly string[]).includes(k));
    const cutBad = Object.keys(CUT_MAP).filter((k) => (CUTS as readonly string[]).includes(k));
    expect(catBad).toEqual([]);
    expect(cutBad).toEqual([]);
  });
});
