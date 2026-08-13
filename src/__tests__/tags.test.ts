// Tests for the pure tobacco-tags helpers.

import { describe, it, expect } from "vitest";
import { sanitizeTags, tobaccoHasTag, tagCounts, allTags, MAX_TAGS_PER_ITEM, MAX_TAG_LEN } from "../utils/tags";

describe("sanitizeTags", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeTags(null)).toEqual([]);
    expect(sanitizeTags("x" as any)).toEqual([]);
    expect(sanitizeTags(undefined)).toEqual([]);
  });

  it("trims, collapses whitespace, drops empties and non-strings", () => {
    expect(sanitizeTags(["  voyage  ", "", "  ", 7 as any, null, "matin\tcafé"]))
      .toEqual(["voyage", "matin café"]);
  });

  it("dedups case-insensitively keeping the first spelling", () => {
    expect(sanitizeTags(["Voyage", "voyage", "VOYAGE", "Cadeaux"]))
      .toEqual(["Voyage", "Cadeaux"]);
  });

  it("caps tag length and tag count", () => {
    const long = "a".repeat(MAX_TAG_LEN + 10);
    expect(sanitizeTags([long])[0]!.length).toBe(MAX_TAG_LEN);
    const many = Array.from({ length: MAX_TAGS_PER_ITEM + 5 }, (_, i) => "t" + i);
    expect(sanitizeTags(many)).toHaveLength(MAX_TAGS_PER_ITEM);
  });
});

describe("tobaccoHasTag", () => {
  it("matches case-insensitively", () => {
    const tob = { tags: ["Voyage", "Matin"] };
    expect(tobaccoHasTag(tob, "voyage")).toBe(true);
    expect(tobaccoHasTag(tob, "MATIN")).toBe(true);
    expect(tobaccoHasTag(tob, "soir")).toBe(false);
  });
  it("is safe on missing / empty inputs", () => {
    expect(tobaccoHasTag(null, "x")).toBe(false);
    expect(tobaccoHasTag({}, "x")).toBe(false);
    expect(tobaccoHasTag({ tags: ["a"] }, "")).toBe(false);
  });
});

describe("tagCounts / allTags", () => {
  const tobs = [
    { id: 1, tags: ["Voyage", "Matin"] },
    { id: 2, tags: ["voyage", "Cadeaux"] },
    { id: 3, tags: ["Voyage"] },
    { id: 4, tags: ["Cadeaux"], deletedAt: "x" },  // trashed → skipped
    { id: 5 },                                      // no tags
  ];

  it("counts distinct tags across live tobaccos, most-used first", () => {
    const c = tagCounts(tobs);
    expect(c).toEqual([
      { tag: "Voyage", count: 3 },
      { tag: "Cadeaux", count: 1 },
      { tag: "Matin", count: 1 },
    ]);
  });

  it("counts each tag once per tobacco even if duplicated on the row", () => {
    expect(tagCounts([{ id: 1, tags: ["a", "A", "a"] }])).toEqual([{ tag: "a", count: 1 }]);
  });

  it("picks the most-frequent spelling as the display label", () => {
    const c = tagCounts([
      { id: 1, tags: ["voyage"] },
      { id: 2, tags: ["voyage"] },
      { id: 3, tags: ["Voyage"] },
    ]);
    expect(c[0]).toEqual({ tag: "voyage", count: 3 });
  });

  it("allTags returns the sorted flat spellings", () => {
    expect(allTags(tobs)).toEqual(["Voyage", "Cadeaux", "Matin"]);
  });

  it("is safe on garbage input", () => {
    expect(tagCounts(null)).toEqual([]);
    expect(allTags(undefined)).toEqual([]);
  });
});
