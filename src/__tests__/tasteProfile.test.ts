import { describe, it, expect } from "vitest";
import { computeTasteProfile } from "../utils/tasteProfile";

describe("computeTasteProfile", () => {
  it("returns an empty profile on invalid / empty input (never throws)", () => {
    const e = { families: [], aromas: [], top: [], ratedCount: 0, aromaSessions: 0 };
    expect(computeTasteProfile(null, null)).toEqual(e);
    expect(computeTasteProfile([], [])).toEqual(e);
    // @ts-expect-error garbage
    expect(computeTasteProfile("x", 7)).toEqual(e);
  });

  it("ranks families by average tobacco rating", () => {
    const tobs = [
      { id: "1", category: "Anglais", rating: 5 },
      { id: "2", category: "Anglais", rating: 4 },
      { id: "3", category: "Aromatique", rating: 2 },
      { id: "4", category: "Virginia", rating: 0 }, // unrated → ignored
    ];
    const p = computeTasteProfile(tobs, []);
    expect(p.ratedCount).toBe(3);
    expect(p.families[0]).toEqual({ category: "Anglais", avg: 4.5, count: 2 });
    expect(p.families[1]).toEqual({ category: "Aromatique", avg: 2, count: 1 });
  });

  it("builds signature aromas, preferring highly-rated sessions", () => {
    const tobs = [{ id: "1", category: "Anglais", rating: 5 }];
    const sessions = [
      { tobaccoId: "1", rating: 5, aromas: ["leather", "smoky"] },
      { tobaccoId: "1", rating: 4, aromas: ["leather"] },
      { tobaccoId: "1", rating: 4, aromas: ["smoky"] },
      // a low-rated session with a different aroma — excluded from the
      // favourite tally (>=3 favourites exist)
      { tobaccoId: "1", rating: 1, aromas: ["vanilla"] },
    ];
    const p = computeTasteProfile(tobs, sessions);
    const keys = p.aromas.map((a) => a.key);
    expect(keys).toContain("leather");
    expect(keys).toContain("smoky");
    expect(keys).not.toContain("vanilla"); // low-rated, dropped by fav tally
    expect(p.aromaSessions).toBe(4);       // all 4 sessions carry aromas
  });

  it("recommends the tobacco best matching family + signature aromas", () => {
    const tobs = [
      { id: "1", category: "Anglais", rating: 5 },   // fav family + aromas
      { id: "2", category: "Aromatique", rating: 3 }, // weaker family, no aroma match
      { id: "3", category: "Anglais", rating: 4 },   // fav family, fewer aromas
    ];
    const sessions = [
      { tobaccoId: "1", rating: 5, aromas: ["leather", "smoky"] },
      { tobaccoId: "1", rating: 5, aromas: ["leather", "smoky"] },
      { tobaccoId: "3", rating: 4, aromas: ["leather"] },
      { tobaccoId: "2", rating: 3, aromas: ["vanilla"] },
    ];
    const p = computeTasteProfile(tobs, sessions);
    expect(p.top[0]!.tobaccoId).toBe("1");           // best match first
    expect(p.top[0]!.familyMatch).toBe(true);
    expect(p.top[0]!.matchedAromas).toEqual(expect.arrayContaining(["leather", "smoky"]));
    // all three score > 0, ranked
    expect(p.top.map((m) => m.tobaccoId)).toEqual(["1", "3", "2"]);
  });

  it("excludes trashed tobaccos from both ranking and recommendation", () => {
    const tobs = [
      { id: "1", category: "Anglais", rating: 5, deletedAt: "2026-01-01" },
      { id: "2", category: "Virginia", rating: 4 },
    ];
    const p = computeTasteProfile(tobs, []);
    expect(p.ratedCount).toBe(1);
    expect(p.families.map((f) => f.category)).toEqual(["Virginia"]);
    expect(p.top.map((m) => m.tobaccoId)).toEqual(["2"]);
  });

  it("degrades gracefully with ratings but no aromas", () => {
    const tobs = [
      { id: "1", category: "Anglais", rating: 5 },
      { id: "2", category: "Virginia", rating: 3 },
    ];
    const p = computeTasteProfile(tobs, []);
    expect(p.aromas).toEqual([]);
    expect(p.top[0]!.tobaccoId).toBe("1"); // family + rating still rank it
    expect(p.top[0]!.matchedAromas).toEqual([]);
  });

  it("respects the topN cap", () => {
    const tobs = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1), category: "Anglais", rating: 5,
    }));
    expect(computeTasteProfile(tobs, [], 3).top).toHaveLength(3);
  });
});
