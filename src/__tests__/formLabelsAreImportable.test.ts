// The value a file may carry is the value the form offers.
//
// WHY THIS EXISTS. The entry form imposes a closed list: the user picks a
// category or a cut from a dropdown rendered through `xl()`, so a Spanish user
// sees « Cigarro » and an Italian « Sigaro ». Canonicalisation, meanwhile,
// folded against `CATS` / `CUTS` — the FRENCH canonical values — plus a handful
// of English trade aliases. The two never agreed, and the gap was invisible in
// French, where the canonical value IS the label on screen.
//
// MEASURED when it was found: 26 of the values the guide listed across the five
// non-French languages came back `null` from `canonCategory` / `canonCut` — 8 in
// Spanish, 7 in Portuguese, 3 in Italian, 2 in English, 1 in German. A Spanish
// reader copying their own dropdown into a catalogue CSV had every category
// refused and the blend then half understood: no maturity band, no default
// cellaring age, no bowl-weight density, and the first save silently rewriting
// the value to something the fixed dropdown does hold.
//
// WHAT IS LOCKED, and why each half is here:
//   (a) every label the form can display resolves to its own canonical value —
//       the guarantee itself, asserted per language so a failure names the one
//       that broke;
//   (b) the canonical values still resolve to themselves — the fold must widen
//       what is accepted, never move an existing answer;
//   (c) an unknown label is still returned VERBATIM by `map*` and `null` by
//       `canon*` — the callers' contract is unchanged, since the catalogue
//       importer reports an unrecognised value rather than snapping it.
//
// The cases are DERIVED from the per-language maps, never listed: those maps are
// the dropdown, so a relabelled value or a seventh language is covered here with
// no edit — which is the point of folding them into the import maps rather than
// typing the pairs a second time.
import { describe, it, expect } from "vitest";
import {
  CATS, CUTS, CAT_MAP, CUT_MAP,
  CATS_EN, CATS_ES, CATS_DE, CATS_IT, CATS_PT,
  CUTS_EN, CUTS_ES, CUTS_DE, CUTS_IT, CUTS_PT,
  canonCategory, canonCut, mapCategory, mapCut,
} from "../constants.ts";

const CAT_BY_LANG: Record<string, Record<string, string>> = {
  en: CATS_EN, es: CATS_ES, de: CATS_DE, it: CATS_IT, pt: CATS_PT,
};
const CUT_BY_LANG: Record<string, Record<string, string>> = {
  en: CUTS_EN, es: CUTS_ES, de: CUTS_DE, it: CUTS_IT, pt: CUTS_PT,
};

describe("every label the entry form offers is a value a file may carry", () => {
  it("the maps are non-empty, so nothing below can pass vacuously", () => {
    expect(CATS.length).toBeGreaterThan(10);
    expect(CUTS.length).toBeGreaterThan(10);
    expect(Object.keys(CAT_BY_LANG).length).toBeGreaterThan(3);
    // The sparse maps legitimately omit a value identical to the canonical one,
    // but at least one language must actually translate something or the sweep
    // would be asserting nothing.
    const translated = Object.values(CAT_BY_LANG)
      .flatMap((m) => Object.entries(m).filter(([c, l]) => l && l !== c));
    expect(translated.length).toBeGreaterThan(10);
  });

  for (const [lang, map] of Object.entries(CAT_BY_LANG)) {
    it(`${lang}: every category the dropdown shows resolves to its canonical value`, () => {
      for (const [canonical, label] of Object.entries(map)) {
        expect(CATS, `${lang}: ${canonical} is not a CATS value`).toContain(canonical);
        expect(canonCategory(label), `${lang}: the form shows "${label}" and a file carrying it is refused`)
          .toBe(canonical);
      }
    });
  }

  for (const [lang, map] of Object.entries(CUT_BY_LANG)) {
    it(`${lang}: every cut the dropdown shows resolves to its canonical value`, () => {
      for (const [canonical, label] of Object.entries(map)) {
        expect(CUTS, `${lang}: ${canonical} is not a CUTS value`).toContain(canonical);
        expect(canonCut(label), `${lang}: the form shows "${label}" and a file carrying it is refused`)
          .toBe(canonical);
      }
    });
  }

  it("widening did not move an existing answer — a canonical value still resolves to itself", () => {
    for (const v of CATS) expect(canonCategory(v), v).toBe(v);
    for (const v of CUTS) expect(canonCut(v), v).toBe(v);
  });

  it("the hand-written trade aliases still resolve", () => {
    // A regression here would mean the fold overwrote an entry rather than
    // filling a hole — it is written to skip a key that already exists.
    expect(canonCategory("Cigar")).toBe("Cigare");
    expect(canonCategory("English Aromatic")).toBe("Anglais aromatique");
    expect(canonCut("Navy Cut")).toBe("Flake");
    expect(canonCut("Krumble Kake")).toBe("Crumble Cake");
  });

  it("an unrecognised label is still passed through, not snapped to a default", () => {
    expect(mapCategory("Zzz Unknown")).toBe("Zzz Unknown");
    expect(mapCut("Zzz Unknown")).toBe("Zzz Unknown");
    expect(canonCategory("Zzz Unknown")).toBeNull();
    expect(canonCut("Zzz Unknown")).toBeNull();
  });

  it("the maps stay null-prototype after the fold", () => {
    // The fold mutates them, and they are indexed by a string from a
    // user-supplied file — a prototype here would make "constructor" resolve.
    expect(Object.getPrototypeOf(CAT_MAP)).toBeNull();
    expect(Object.getPrototypeOf(CUT_MAP)).toBeNull();
    expect(mapCategory("constructor")).toBe("constructor");
    expect(mapCut("__proto__")).toBe("__proto__");
  });
});
