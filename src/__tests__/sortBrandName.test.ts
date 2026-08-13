import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { compareByBrandThenName, sortByBrandThenName } from "../utils/sortBrandName";

/**
 * One brand-then-name comparator, shared by the inventory list
 * and the collection report.
 *
 * The report used to print rows in insertion order (the id counter), which is
 * unusable in a document you file and look a maker up in. The app already had
 * this exact sort; writing it a second time is the failure this repo keeps
 * paying for — the tag predicate lived in four copies.
 */
describe("compareByBrandThenName", () => {
  const s = (list: any[]) => sortByBrandThenName(list).map((x) => `${x.brand}|${x.name}`);

  it("orders by brand first, then by name within a brand", () => {
    expect(s([
      { brand: "Halvorsen", name: "Duskfall" },
      { brand: "Marlow & Finch", name: "Sun Bear" },
      { brand: "Halvorsen", name: "Regent Mixture" },
    ])).toEqual(["Halvorsen|Duskfall", "Halvorsen|Regent Mixture", "Marlow & Finch|Sun Bear"]);
  });

  it("is accent-aware, so É sorts under E and not after Z", () => {
    // The reason for localeCompare rather than a byte comparison: a plain `<`
    // puts "Éclipse" after "Zippo", which in a printed inventory reads as a
    // sorting bug.
    expect(s([{ brand: "Zippo", name: "a" }, { brand: "Éclipse", name: "a" },
              { brand: "Halvorsen", name: "a" }]))
      .toEqual(["Éclipse|a", "Halvorsen|a", "Zippo|a"]);
  });

  it("keeps case variants of one brand adjacent", () => {
    const out = s([{ brand: "Yarrowmere", name: "b" }, { brand: "marlow & finch", name: "a" },
                   { brand: "Marlow & Finch", name: "z" }]);
    expect(out.slice(0, 2).every((x) => /marlow/i.test(x))).toBe(true);
  });

  it("treats a missing brand or name as empty, and never throws on garbage", () => {
    expect(() => sortByBrandThenName([{}, { brand: null }, { name: 42 } as any, null as any])).not.toThrow();
    // Blank brands sort FIRST — the same as the app's own `sortBy === "brand"`.
    // Matching the list was the deciding argument, so this is asserted rather
    // than left to chance.
    expect(s([{ brand: "A", name: "x" }, { brand: "", name: "y" }])[0]).toBe("|y");
  });

  it("coerces a non-string field instead of crashing", () => {
    // The `tabac-local/string-locale-compare` rule exists for the
    // crash: `.localeCompare` on a number throws. A hand-edited backup can put
    // anything in these fields.
    expect(() => compareByBrandThenName({ brand: 7 } as any, { brand: "a" })).not.toThrow();
  });

  it("returns a COPY and leaves the caller's array untouched", () => {
    const src = [{ brand: "B", name: "1" }, { brand: "A", name: "2" }];
    const out = sortByBrandThenName(src);
    expect(out).not.toBe(src);
    expect(src[0]!.brand, "the input must not be reordered").toBe("B");
  });

  it("is the comparator App.tsx actually uses — no second copy", () => {
    // What rots is the WIRING, not the function. If the inventory sort grows its
    // own comparator again, the printed report silently stops matching the list.
    const app = readFileSync("src/App.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(app, "App.tsx must call the shared comparator").toContain("compareByBrandThenName(a, b)");
    expect(app, "no inline brand/name comparison may survive in App.tsx")
      .not.toMatch(/String\(a\.brand[\s\S]{0,140}(localeCompare|toLowerCase)/);
    const inv = readFileSync("src/views/curator/InventoryListView.tsx", "utf8");
    expect(inv, "the wishlist brand sort must use it too").toContain("compareByBrandThenName");
    const rep = readFileSync("src/utils/collectionReport.ts", "utf8");
    // COUNTED, not merely present: all THREE sections must sort. A containment
    // check passes while one of them silently reverts to insertion order —
    // probed, and it did.
    expect((rep.match(/sortByBrandThenName\(\(\(data/g) || []).length,
      "each of the three sections must sort").toBe(3);
  });
});
