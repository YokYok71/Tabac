import { describe, it, expect } from "vitest";
import { convertWeightUnit } from "../utils";

// The Settings unit toggle corrupted small
// display-unit weights. A 1 g default became 85 g, a 1 g low-stock threshold
// became 1418 g on a g→oz→g round-trip (|| N fallback + 1-dp oz collapse to
// "0"). These lock the fix.

describe("convertWeightUnit", () => {
  it("returns null (leave untouched) when from === to", () => {
    expect(convertWeightUnit("3", "g", "g")).toBeNull();
    expect(convertWeightUnit("0.1", "oz", "oz")).toBeNull();
  });

  it("returns null for empty / garbage (never substitutes a fallback)", () => {
    expect(convertWeightUnit("", "g", "oz")).toBeNull();
    expect(convertWeightUnit("   ", "g", "oz")).toBeNull();
    expect(convertWeightUnit("abc", "g", "oz")).toBeNull();
    expect(convertWeightUnit(null, "g", "oz")).toBeNull();
    expect(convertWeightUnit(undefined, "oz", "g")).toBeNull();
  });

  it("converts a legit 0 to 0 (not replaced by a fallback)", () => {
    expect(convertWeightUnit("0", "g", "oz")).toBe("0");
    expect(convertWeightUnit("0", "oz", "g")).toBe("0");
  });

  it("does NOT collapse a small value to 0 on g→oz (3-dp oz)", () => {
    // Earlier this rounded to "0" (1 dp) then became 85 g back. Now it survives.
    // REVERSED: these pinned the 2-dp grid ("0.04" / "0.09"), which survived
    // without collapsing but was still coarser than the 1-dp gram side, so
    // 1295 of the 2000 gram values in 0.1..200.0 did not round-trip and 0.1 g
    // was destroyed outright. The oz side is 3 dp now — see the round-trip
    // block below, which is what these two literals were standing in for.
    expect(convertWeightUnit("1", "g", "oz")).toBe("0.035");
    expect(convertWeightUnit("2.5", "g", "oz")).toBe("0.088");
  });

  it("REGRESSION: a 1 g default no longer explodes on a g→oz→g round-trip", () => {
    const oz = convertWeightUnit("1", "g", "oz");     // "0.04"
    const back = convertWeightUnit(oz!, "oz", "g");   // ~1.1 g, NOT 85 g
    expect(Number(back)).toBeLessThan(2);
    expect(Number(back)).toBeGreaterThan(0);
  });

  it("REGRESSION: a 25 g low-stock threshold round-trips near itself, never ~1418", () => {
    const oz = convertWeightUnit("25", "g", "oz");    // "0.88"
    const back = convertWeightUnit(oz!, "oz", "g");   // ~24.9 g
    expect(Number(back)).toBeGreaterThan(24);
    expect(Number(back)).toBeLessThan(26);
  });

  it("converts a typical default weight both directions", () => {
    // REVERSED: pinned "0.11" (2 dp). At that precision the app's own default
    // did not survive its own unit toggle — 3 g came back as 3.1 g. The GRAM
    // direction is unchanged, and deliberately so: 1 dp is the grid the whole
    // app deducts on.
    expect(convertWeightUnit("3", "g", "oz")).toBe("0.106");
    expect(convertWeightUnit("0.1", "oz", "g")).toBe("2.8"); // 0.1 oz ≈ 2.835 g → 2.8
  });

  it("accepts a comma decimal", () => {
    // REVERSED: pinned "0.09" (2 dp). The comma handling is what this case is
    // about and it is untouched; only the precision of the result moved.
    expect(convertWeightUnit("2,5", "g", "oz")).toBe("0.088");
  });
});

// The two settings this converts (`cave-session-default-weight`,
// `cave-watch-low-weight`) are PREFERENCES: the user toggles the display unit
// and toggles back, and what they typed must still be there. The 2-dp oz grid
// could not deliver that — MEASURED over the 2000 one-decimal gram values from
// 0.1 to 200.0, **1295 of them did not survive a g→oz→g round trip**, drifting
// by up to 0.10 g — and the smallest legitimate value was destroyed outright:
// `0.1 g → 0.00 oz → 0 g`. A `sessDefaultWeight` of "0" greys the session
// form's Save for ever, with nothing on screen saying why.
//
// Three decimals on the oz side makes the round trip the identity across that
// whole range (0 of 2000 fail). It is the SAME lever pulled once before —
// 1 dp → 2 dp, "so sub-1.4 g survives" per the header above — applied to the
// case that lever did not reach.
describe("convertWeightUnit — the g→oz→g round trip is the identity", () => {
  it("does not destroy the smallest value a user can type", () => {
    // 2 dp gave "0", and "0" is what makes the session form unsavable.
    const oz = convertWeightUnit("0.1", "g", "oz");
    expect(Number(oz)).toBeGreaterThan(0);
    expect(convertWeightUnit(oz!, "oz", "g")).toBe("0.1");
  });

  it("round-trips every 1-dp gram value from 0.1 to 200.0 EXACTLY", () => {
    // No tolerance: a tolerance is the layer that absorbs exactly this defect
    // (the old grid was wrong by at most 0.10 g, which any loose window hides).
    const bad: string[] = [];
    for (let i = 1; i <= 2000; i++) {
      const g = String(Math.round(i) / 10);
      const oz = convertWeightUnit(g, "g", "oz");
      const back = convertWeightUnit(oz!, "oz", "g");
      if (back !== g) bad.push(g + " -> " + oz + " -> " + back);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(bad.length).toBe(0);
  });

  it("still round-trips the two real defaults", () => {
    // sessDefaultWeight "3" and watchLowWeight "25" — the values the app ships.
    for (const g of ["3", "25"]) {
      const oz = convertWeightUnit(g, "g", "oz");
      expect(convertWeightUnit(oz!, "oz", "g")).toBe(g);
    }
  });

  // NON-VACUITY — more precision must not turn every conversion into a long
  // decimal the Settings field then displays. A converted value is still a
  // short, readable number.
  it("keeps the oz value short and readable", () => {
    for (const g of ["1", "2.5", "3", "25", "50", "200"]) {
      const oz = String(convertWeightUnit(g, "g", "oz"));
      const dp = oz.indexOf(".") < 0 ? 0 : oz.length - oz.indexOf(".") - 1;
      expect(dp, g + " g -> " + oz + " oz").toBeLessThanOrEqual(3);
    }
    expect(convertWeightUnit("28.35", "g", "oz")).toBe("1");
  });

  // RESIDUAL, disclosed rather than hidden: the oz→g→oz direction still drifts
  // ONE oz-grid step, because grams stay on the app's 1-dp grid (0.1 oz is
  // 2.835 g, stored as "2.8", which reads back as 0.099 oz). Widening the GRAM
  // side would change the grid the whole app deducts on, which is not this
  // function's to move. The g→oz→g direction is the one a preference travels.
  it("oz→g→oz stays within one gram-grid step (the disclosed residual)", () => {
    const g = convertWeightUnit("0.1", "oz", "g"); // "2.8"
    expect(g).toBe("2.8");
    const back = convertWeightUnit(g!, "g", "oz");
    expect(Math.abs(Number(back) - 0.1)).toBeLessThanOrEqual(0.002);
  });
});
