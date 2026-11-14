import { describe, it, expect } from "vitest";
import { computeShoppingList, shoppingCount, shoppingReason, isUsedUp } from "../utils/shopping";

describe("computeShoppingList", () => {
  it("returns empty groups on invalid input", () => {
    expect(computeShoppingList(null, null)).toEqual({ restock: [], wishes: [] });
  });

  it("adds a low-stock owned tobacco to `restock` (active weight ≤ threshold)", () => {
    const tobs = [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [
      { status: "jar", weightG: "20" },
    ] }];
    const r = computeShoppingList(tobs, [], { lowWeightThreshold: 50 });
    expect(r.restock).toEqual([
      { key: "restock:1", kind: "restock", id: "1", brand: "Brackwater", name: "Duskfall", value: 20, reason: "low", soldOut: false },
    ]);
  });

  it("skips a well-stocked tobacco, an empty/finished one, and 'à ne pas reprendre'", () => {
    const tobs = [
      { id: 1, brand: "A", name: "Full", lots: [{ status: "cellar", weightG: "200" }] }, // over threshold
      { id: 2, brand: "B", name: "Empty", lots: [{ status: "cellar", weightG: "0" }] },   // no stock
      { id: 3, brand: "C", name: "Done", lots: [{ status: "finished", weightG: "0" }] },   // finished
      { id: 4, brand: "D", name: "NoRebuy", rebuy: false, lots: [{ status: "jar", weightG: "10" }] }, // excluded
    ];
    expect(computeShoppingList(tobs, [], { lowWeightThreshold: 50 }).restock).toEqual([]);
  });

  it("adds wishlist items to `wishes` and skips trashed ones", () => {
    const wl = [
      { id: 5, brand: "Halvorsen", name: "Irish Flake" },
      { id: 6, brand: "Orlik", name: "Golden Sliced", deletedAt: "x" }, // trashed → skip
    ];
    const r = computeShoppingList([], wl);
    expect(r.wishes).toEqual([
      { key: "wish:5", kind: "wish", id: "5", brand: "Halvorsen", name: "Irish Flake", value: 0 },
    ]);
  });

  it("sorts each group by brand then name", () => {
    const wl = [
      { id: 1, brand: "Zeta", name: "A" },
      { id: 2, brand: "Alpha", name: "B" },
      { id: 3, brand: "Alpha", name: "A" },
    ];
    expect(computeShoppingList([], wl).wishes.map((w) => w.id)).toEqual(["3", "2", "1"]);
  });

  it("carries imageUrl only when present (exactOptionalPropertyTypes-safe)", () => {
    const wl = [{ id: 1, brand: "X", name: "Y", imageUrl: "local-photo-1" }];
    expect(computeShoppingList([], wl).wishes[0]!.imageUrl).toBe("local-photo-1");
    const wl2 = [{ id: 2, brand: "X", name: "Y" }];
    expect("imageUrl" in computeShoppingList([], wl2).wishes[0]!).toBe(false);
  });

  it("shoppingCount sums both groups", () => {
    const tobs = [{ id: 1, brand: "A", name: "N", lots: [{ status: "jar", weightG: "10" }] }];
    const wl = [{ id: 2, brand: "B", name: "M" }, { id: 3, brand: "C", name: "O" }];
    expect(shoppingCount(computeShoppingList(tobs, wl))).toBe(3);
    expect(shoppingCount(null)).toBe(0);
  });
});

describe("tobaccoActiveWeight + isLowStock", () => {
  it("sums active (non-finished, non-trashed) lot weights", async () => {
    const { tobaccoActiveWeight } = await import("../utils/shopping");
    const tob = { lots: [
      { status: "jar", weightG: "20" },
      { status: "cellar", weightG: "30" },
      { status: "finished", weightG: "0" },      // finished → skip
      { status: "cellar", weightG: "50", deletedAt: "x" }, // trashed → skip
    ] };
    expect(tobaccoActiveWeight(tob)).toBe(50);
    expect(tobaccoActiveWeight(null)).toBe(0);
  });

  it("flags low stock only in (0, threshold]", async () => {
    const { isLowStock } = await import("../utils/shopping");
    expect(isLowStock({ lots: [{ status: "jar", weightG: "20" }] }, 25)).toBe(true);
    expect(isLowStock({ lots: [{ status: "jar", weightG: "25" }] }, 25)).toBe(true); // inclusive
    expect(isLowStock({ lots: [{ status: "jar", weightG: "40" }] }, 25)).toBe(false);
    expect(isLowStock({ lots: [{ status: "jar", weightG: "0" }] }, 25)).toBe(false);  // no stock
    expect(isLowStock({ lots: [{ status: "finished", weightG: "0" }] }, 25)).toBe(false);
  });
});

// The two ways onto « À racheter » that are not « stock bas ». Until they
// existed, a tabac you had FINISHED — the most natural thing to rebuy — could
// not appear at all (`isLowStock` demands w > 0), and there was no way to put
// one on the list by hand short of a wish, which creates a duplicate on
// « Je l'ai acheté ».
describe("shoppingReason — used up + « À reprendre », and the manual flag", () => {
  const finished = [{ status: "finished", weightG: "0" }];

  it("a used-up tabac marked « À reprendre » is on the list, shown as sold out", () => {
    const tobs = [{ id: 7, brand: "A", name: "Gone", rebuy: true, lots: finished }];
    const r = computeShoppingList(tobs, [], { lowWeightThreshold: 25 });
    expect(r.restock).toHaveLength(1);
    expect(r.restock[0]).toMatchObject({ id: "7", reason: "out", soldOut: true, value: 0 });
  });

  it("a used-up tabac that is merely undecided stays OFF — or every blend ever finished would be listed", () => {
    expect(shoppingReason({ id: 1, rebuy: null, lots: finished }, 25)).toBeNull();
    expect(shoppingReason({ id: 1, lots: finished }, 25)).toBeNull();
    expect(shoppingReason({ id: 1, rebuy: false, lots: finished }, 25)).toBeNull();
  });

  it("« Sans lot » is not « épuisé »: a tabac with no lot is incomplete data, not finished", () => {
    expect(isUsedUp({ lots: [] })).toBe(false);
    expect(shoppingReason({ id: 1, rebuy: true, lots: [] }, 25)).toBeNull();
    // A soft-deleted lot does not count, in either direction.
    expect(isUsedUp({ lots: [{ status: "finished" }, { status: "jar", weightG: "50", deletedAt: "x" }] })).toBe(true);
    expect(isUsedUp({ lots: [{ status: "finished", deletedAt: "x" }] })).toBe(false);
  });

  it("an active lot left at 0 g is neither low nor used up", () => {
    expect(shoppingReason({ id: 1, rebuy: true, lots: [{ status: "cellar", weightG: "0" }] }, 25)).toBeNull();
  });

  it("the manual flag lists a well-stocked tabac, and wins over « à ne pas reprendre »", () => {
    const full = [{ status: "cellar", weightG: "200" }];
    expect(shoppingReason({ id: 1, toBuy: true, lots: full }, 25)).toBe("manual");
    expect(shoppingReason({ id: 1, toBuy: true, rebuy: false, lots: full }, 25)).toBe("manual");
    // Only the literal true: a hand-edited backup's "yes" is not a flag.
    expect(shoppingReason({ id: 1, toBuy: "yes", lots: full }, 25)).toBeNull();
    const r = computeShoppingList([{ id: 3, brand: "B", name: "Plenty", toBuy: true, lots: full }], []);
    expect(r.restock[0]).toMatchObject({ reason: "manual", soldOut: false, value: 200 });
  });

  it("a trashed tabac is never on the list, flag or not", () => {
    expect(shoppingReason({ id: 1, toBuy: true, deletedAt: "x", lots: [] }, 25)).toBeNull();
  });
});
