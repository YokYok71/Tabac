import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { softBreakSlashes } from "../utils";
import { CATS, CATS_EN, ENUM_TRANSLATIONS } from "../constants";

const ZWSP = "​";

// Where a compound category label breaks.
//
// Reported from the app with a screenshot: the Home "Familles" list rendered
// "Virginia/Burle" on one line and "y" on the next. An earlier release had stopped that
// label being CLIPPED by letting it wrap, using `overflow-wrap: anywhere` —
// which guarantees it never overflows and, being "anywhere", broke it mid-word.
//
// MEASURED in a browser: the label column is 81 px, and "Virginia/Burley" needs
// 88 px at the default text size and 98 px at "L". It cannot fit on one line, so
// the only question is WHERE it breaks. After the fix, at both sizes:
// "Virginia/" then "Burley".
//
// `break-word` is not the alternative: "/" is UAX #14 class SY and is not a
// break opportunity of its own, so the label would overflow instead of wrapping.

describe("softBreakSlashes", () => {
  it("inserts a zero-width space after each slash", () => {
    expect(softBreakSlashes("Virginia/Burley")).toBe("Virginia/" + ZWSP + "Burley");
  });

  it("leaves a label with no slash untouched", () => {
    CATS.filter((c) => !c.includes("/")).forEach((c) => {
      expect(softBreakSlashes(c)).toBe(c);
    });
  });

  it("adds nothing a reader or a comparison would see", () => {
    // U+200B is ignored by screen readers, by copy/paste and by search — that
    // is the whole reason it is usable here. Stripping it must give the input
    // back exactly, or the transform is not display-only.
    CATS.forEach((c) => {
      expect(softBreakSlashes(c).replace(new RegExp(ZWSP, "g"), "")).toBe(c);
    });
  });

  it("handles null / undefined / empty without throwing", () => {
    expect(softBreakSlashes("")).toBe("");
    expect(softBreakSlashes(null as never)).toBe("");
    expect(softBreakSlashes(undefined as never)).toBe("");
  });

  it("covers the translated labels too, not just the canonical ones", () => {
    // The rendered value comes from xl(), so a language whose translation of a
    // compound family also carries a slash must break at it as well.
    // ENUM_TRANSLATIONS is a Map keyed by the _EN map; the categories row is
    // the one keyed by CATS_EN.
    const perLang = ENUM_TRANSLATIONS.get(CATS_EN) || {};
    const maps = [CATS_EN, ...Object.values(perLang)] as Record<string, string>[];
    const withSlash = maps.flatMap((m) => Object.values(m || {})).filter((v) => typeof v === "string" && v.includes("/"));
    expect(withSlash.length).toBeGreaterThan(0);   // non-vacuous
    withSlash.forEach((v) => expect(softBreakSlashes(v)).toContain("/" + ZWSP));
  });
});

describe("the Home families list uses it", () => {
  const src = readFileSync(resolve(__dirname, "../views/curator/HomeViewV2.tsx"), "utf8")
    // Comments blanked — the fix's own note quotes the helper name, and a check
    // satisfied by prose is one that stays green under probe (the
    // lesson, third time around).
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

  it("wraps the rendered category label", () => {
    expect(src).toContain("softBreakSlashes(xl ? xl(c[0], CATS_EN) : c[0])");
  });

  it("keeps `anywhere` as the last-resort fallback", () => {
    // A future category with neither a space nor a slash must still not
    // overflow. The ZWSP chooses a BETTER break point; it does not guarantee
    // one exists.
    expect(src).toContain('overflowWrap: "anywhere"');
  });
});
