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

  it("does NOT collapse a small value to 0 on g→oz (2-dp oz)", () => {
    // Earlier this rounded to "0" (1 dp) then became 85 g back. Now it survives.
    expect(convertWeightUnit("1", "g", "oz")).toBe("0.04");
    expect(convertWeightUnit("2.5", "g", "oz")).toBe("0.09");
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
    expect(convertWeightUnit("3", "g", "oz")).toBe("0.11");
    expect(convertWeightUnit("0.1", "oz", "g")).toBe("2.8"); // 0.1 oz ≈ 2.835 g → 2.8
  });

  it("accepts a comma decimal", () => {
    expect(convertWeightUnit("2,5", "g", "oz")).toBe("0.09");
  });
});
