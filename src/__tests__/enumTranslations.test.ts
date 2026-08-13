// Locks the xl() enum-translation registry contract: every translated
// enum must be registered (keyed by its English map), so adding a
// language is a constants.ts-only edit and a forgotten registration can't
// silently ship (xl would fall back to the canonical French value).
import { describe, it, expect } from "vitest";
import {
  ENUM_TRANSLATIONS,
  CATS_EN, CUTS_EN, SHAPES_EN, BENDS_EN, FILTERS_EN,
  BOWL_MATS_EN, STEM_MATS_EN, FINISHES_EN, ACC_TYPES_EN, LIGHTER_FUELS_EN,
} from "../constants.ts";

const EN_MAPS = [
  CATS_EN, CUTS_EN, SHAPES_EN, BENDS_EN, FILTERS_EN,
  BOWL_MATS_EN, STEM_MATS_EN, FINISHES_EN, ACC_TYPES_EN, LIGHTER_FUELS_EN,
];

describe("ENUM_TRANSLATIONS registry", () => {
  it("registers every translated enum, keyed by its English map", () => {
    for (const m of EN_MAPS) {
      const byLang = ENUM_TRANSLATIONS.get(m);
      expect(byLang).toBeTruthy();
      expect(byLang!.en).toBe(m);
    }
  });

  it("resolves the canonical label into each wired language", () => {
    const cats = ENUM_TRANSLATIONS.get(CATS_EN)!;
    expect(cats.en!["Anglais"]).toBe("English");
    expect(cats.es!["Anglais"]).toBe("Inglés");
    expect(cats.de!["Anglais"]).toBe("Englisch");
    expect(cats.it!["Anglais"]).toBe("Inglese");
    // International jargon stays unmapped → xl() falls back to canonical.
    expect(cats.es!["Latakia"]).toBeUndefined();
  });
});
