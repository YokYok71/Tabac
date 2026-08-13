import { describe, it, expect } from "vitest";
import { safeJsonParse } from "../utils/safeJson";

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hi"', "")).toBe("hi");
    expect(safeJsonParse("42", 0)).toBe(42);
  });

  it("returns the fallback on malformed JSON (no throw)", () => {
    expect(safeJsonParse("{not json", null)).toBeNull();
    expect(safeJsonParse("{a:1}", { a: 0 })).toEqual({ a: 0 });
    expect(safeJsonParse("undefined", "fb")).toBe("fb");
    expect(safeJsonParse("", 7)).toBe(7);
  });

  it("returns the fallback for null / undefined source", () => {
    expect(safeJsonParse(null, "fb")).toBe("fb");
    expect(safeJsonParse(undefined, 5)).toBe(5);
  });

  it("preserves the fallback type when parse fails", () => {
    const fb = { ts: 0, name: "" };
    expect(safeJsonParse("garbage", fb)).toBe(fb);
  });
});
