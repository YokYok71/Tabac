import { describe, it, expect } from "vitest";
import { safeSellerHref } from "../utils";

describe("safeSellerHref", () => {
  it("returns '' for empty / nullish input", () => {
    expect(safeSellerHref("")).toBe("");
    expect(safeSellerHref("   ")).toBe("");
    expect(safeSellerHref(null)).toBe("");
    expect(safeSellerHref(undefined)).toBe("");
  });

  it("keeps http(s) URLs", () => {
    expect(safeSellerHref("https://smokingpipes.com")).toBe("https://smokingpipes.com/");
    expect(safeSellerHref("http://example.com/shop")).toBe("http://example.com/shop");
  });

  it("prepends https:// when no scheme is given", () => {
    expect(safeSellerHref("smokingpipes.com")).toBe("https://smokingpipes.com/");
    expect(safeSellerHref("shop.example.com/path")).toBe("https://shop.example.com/path");
  });

  it("blocks dangerous / non-http schemes", () => {
    expect(safeSellerHref("javascript:alert(1)")).toBe("");
    expect(safeSellerHref("data:text/html,hi")).toBe("");
    expect(safeSellerHref("ftp://example.com")).toBe("");
  });
});
