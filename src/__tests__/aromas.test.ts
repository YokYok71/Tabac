import { describe, it, expect } from "vitest";
import {
  AROMA_WHEEL, ALL_AROMAS, isValidAroma, sanitizeAromas,
  buildTobaccoAromaIndex, tobaccoMatchesAromas,
} from "../utils/aromas";

describe("aroma wheel taxonomy", () => {
  it("has 6 groups of 5 aromas (30 total, no duplicates)", () => {
    expect(AROMA_WHEEL).toHaveLength(6);
    AROMA_WHEEL.forEach((g) => expect(g.aromas).toHaveLength(5));
    expect(ALL_AROMAS).toHaveLength(30);
    expect(new Set(ALL_AROMAS).size).toBe(30); // all unique
  });

  it("group keys are unique", () => {
    const keys = AROMA_WHEEL.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isValidAroma", () => {
  it("accepts known keys, rejects everything else", () => {
    expect(isValidAroma("vanilla")).toBe(true);
    expect(isValidAroma("leather")).toBe(true);
    expect(isValidAroma("unknown")).toBe(false);
    expect(isValidAroma("")).toBe(false);
    expect(isValidAroma(null)).toBe(false);
    expect(isValidAroma(42)).toBe(false);
    // a group key is not an aroma key
    expect(isValidAroma("sweet")).toBe(false);
  });
});

describe("sanitizeAromas", () => {
  it("drops unknown / non-string entries and de-duplicates", () => {
    const r = sanitizeAromas(["vanilla", "bogus", "vanilla", 7, null, "leather"]);
    expect(r).toEqual(["vanilla", "leather"]);
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeAromas(null)).toEqual([]);
    expect(sanitizeAromas(undefined)).toEqual([]);
    expect(sanitizeAromas("vanilla")).toEqual([]);
  });

  it("normalises to canonical wheel order regardless of input order", () => {
    // caramel is the 1st aroma of the wheel, nutty is the last
    const r = sanitizeAromas(["nutty", "caramel"]);
    expect(r).toEqual(["caramel", "nutty"]);
  });
});

describe("buildTobaccoAromaIndex + tobaccoMatchesAromas", () => {
  const sessions = [
    { tobaccoId: "1", aromas: ["vanilla", "leather"] },
    { tobaccoId: "1", aromas: ["honey"] },
    { tobaccoId: "2", aromas: ["smoky", "leather"] },
    { tobaccoId: "3", aromas: ["bogus", 7] as any }, // sanitised → empty → no entry
    { tobaccoId: "4" },                               // no aromas
  ];

  it("indexes each tobacco's aggregated aromas", () => {
    const idx = buildTobaccoAromaIndex(sessions);
    expect([...idx["1"]!].sort()).toEqual(["honey", "leather", "vanilla"]);
    expect([...idx["2"]!].sort()).toEqual(["leather", "smoky"]);
    expect(idx["3"]).toBeUndefined();
    expect(idx["4"]).toBeUndefined();
  });

  it("returns {} for non-array input", () => {
    expect(buildTobaccoAromaIndex(null)).toEqual({});
  });

  it("matches only tobaccos whose set contains EVERY wanted aroma (AND)", () => {
    const idx = buildTobaccoAromaIndex(sessions);
    // tobacco 1 has vanilla + leather → matches
    expect(tobaccoMatchesAromas(idx, "1", ["vanilla", "leather"])).toBe(true);
    // tobacco 2 has leather but not vanilla → no match
    expect(tobaccoMatchesAromas(idx, "2", ["vanilla", "leather"])).toBe(false);
    // single aroma
    expect(tobaccoMatchesAromas(idx, "2", ["smoky"])).toBe(true);
    // tobacco with no aroma entry never matches a non-empty filter
    expect(tobaccoMatchesAromas(idx, "4", ["leather"])).toBe(false);
  });

  it("an empty want-list matches everything (filter inactive)", () => {
    const idx = buildTobaccoAromaIndex(sessions);
    expect(tobaccoMatchesAromas(idx, "4", [])).toBe(true);
    expect(tobaccoMatchesAromas(idx, "999", null)).toBe(true);
  });

  // A forged session with a prototype-key tobaccoId must
  // not crash the index build (idx["__proto__"] used to resolve to
  // Object.prototype → the `new Set` init skipped → set.add threw).
  it("does not crash on a prototype-key tobaccoId (Object.create(null) map)", () => {
    const forged = [
      { tobaccoId: "__proto__", aromas: ["vanilla", "leather"] },
      { tobaccoId: "constructor", aromas: ["smoky"] },
      { tobaccoId: "1", aromas: ["honey"] },
    ];
    let idx: any;
    expect(() => { idx = buildTobaccoAromaIndex(forged); }).not.toThrow();
    // The forged proto keys are indexed as ordinary own keys, not merged
    // into Object.prototype, and matching still works.
    expect(tobaccoMatchesAromas(idx, "__proto__", ["vanilla", "leather"])).toBe(true);
    expect(tobaccoMatchesAromas(idx, "1", ["honey"])).toBe(true);
    // A benign tobacco that was never in a session doesn't accidentally
    // inherit the forged proto entry.
    expect(tobaccoMatchesAromas(idx, "999", ["vanilla"])).toBe(false);
  });
});
