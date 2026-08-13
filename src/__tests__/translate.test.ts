import { describe, it, expect } from "vitest";
import { translate, LANG } from "../i18n";

describe("translate() — key lookup", () => {
  it("returns the translated string for a known key", () => {
    expect(translate("fr", "aroma_vanilla")).toBe("Vanille");
    expect(translate("en", "aroma_vanilla")).toBe("Vanilla");
  });

  it("returns the raw key when the key is truly absent", () => {
    expect(translate("fr", "no_such_key_xyz")).toBe("no_such_key_xyz");
  });

  // The fallback changed from French to ENGLISH. Only English is
  // compiled in — the other dictionaries load on demand — so English is the one
  // language guaranteed to be in memory, and it is the app's stated rule: if a
  // language does not exist, or does not load, the user gets English.
  it("falls back to ENGLISH for an unknown language", () => {
    expect(translate("zz", "aroma_vanilla")).toBe(LANG.en!.aroma_vanilla);
    // Specifically NOT French any more — the old behaviour, pinned so a revert
    // to `|| LANG.fr` fails here rather than at runtime on a device that never
    // loaded French.
    expect(translate("zz", "aroma_vanilla")).not.toBe(LANG.fr!.aroma_vanilla);
  });

  it("falls back to English for a language that exists but is not loaded", () => {
    // The real runtime case: offline, switching to a never-downloaded language.
    // The setup file loads all five, so simulate by asking for one that is not
    // in the registry at all — the code path is identical (`LANG[lang]` misses).
    expect(translate("xx", "aroma_vanilla")).toBe(LANG.en!.aroma_vanilla);
  });

  // Regression: the tasting setup title rendered the raw key
  // "tasting_upcoming_pre" because `dict[k] || k` treats an intentional
  // empty-string value as "missing". An empty value MUST stay empty.
  it("returns an empty string for a key whose value is intentionally empty", () => {
    // fr: tasting_upcoming_pre === "", others: tasting_upcoming_post === ""
    expect(LANG.fr!.tasting_upcoming_pre).toBe(""); // guards the fixture
    expect(translate("fr", "tasting_upcoming_pre")).toBe("");
    expect(translate("en", "tasting_upcoming_post")).toBe("");
    expect(translate("de", "tasting_upcoming_post")).toBe("");
  });

  it("never returns the raw key for any empty-valued key in any language", () => {
    (Object.keys(LANG) as (keyof typeof LANG)[]).forEach((lng) => {
      const dict = LANG[lng] as Record<string, string>;
      Object.keys(dict).forEach((k) => {
        if (dict[k] === "") {
          expect(translate(lng, k)).toBe("");
        }
      });
    });
  });
});
