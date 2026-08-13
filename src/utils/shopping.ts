// shopping.ts — the "Liste de courses" engine. Pure, like
// computeWatchlist: derives, at render time, an actionable shopping list from
// data the app already holds. Two sources:
//   • restock — OWNED tobaccos running low on stock (active weight ≤ threshold)
//               that you'd rebuy (rebuy !== false). The "buy more of what you
//               love before it runs out" list.
//   • wishes  — the wishlist (things you want to try).
// Each item carries a stable `key` ("restock:<id>" / "wish:<id>") so the view
// can persist a "got it" checkbox per row. Sorted brand → name within each
// group. Tested in shopping.test.ts.

import { safeNonNeg } from "./stats.ts";

export interface ShoppingItem {
  key: string;
  kind: "restock" | "wish";
  id: string;
  brand: string;
  name: string;
  imageUrl?: string;
  /** restock → remaining active weight (rounded, user's unit); wish → 0. */
  value: number;
}
export interface ShoppingList {
  restock: ShoppingItem[];
  wishes: ShoppingItem[];
}

function byBrandThenName(a: ShoppingItem, b: ShoppingItem): number {
  return String(a.brand || "").localeCompare(String(b.brand || ""))
    || String(a.name || "").localeCompare(String(b.name || ""));
}

// Active (non-finished, non-trashed) weight of a tobacco, in the
// user's display unit. Shared by the shopping list, the "Stock bas" inventory
// filter chip and its count so all three agree on one definition.
export function tobaccoActiveWeight(tob: any): number {
  if (!tob) return 0;
  return ((tob.lots || []) as any[]).reduce(function (sum: number, l: any) {
    if (!l || l.deletedAt || l.status === "finished") return sum;
    return sum + safeNonNeg(l.weightG);
  }, 0);
}
export function isLowStock(tob: any, threshold: number): boolean {
  var w = tobaccoActiveWeight(tob);
  return w > 0 && w <= threshold;
}

export function computeShoppingList(
  tobaccos: any[] | null | undefined,
  wishlist: any[] | null | undefined,
  opts?: { lowWeightThreshold?: number },
): ShoppingList {
  var lowThreshold = (opts && opts.lowWeightThreshold) || 50;

  var restock: ShoppingItem[] = [];
  (tobaccos || []).forEach(function (t: any) {
    if (!t || t.deletedAt || t.id === undefined || t.id === null) return;
    // "à ne pas reprendre" is out — no point restocking what you won't rebuy.
    if (t.rebuy === false) return;
    var totalActive = tobaccoActiveWeight(t);
    if (totalActive > 0 && totalActive <= lowThreshold) {
      restock.push({
        key: "restock:" + String(t.id),
        kind: "restock",
        id: String(t.id),
        brand: String(t.brand || ""),
        name: String(t.name || ""),
        ...(t.imageUrl ? { imageUrl: String(t.imageUrl) } : {}),
        value: Math.round(totalActive * 10) / 10,
      });
    }
  });

  var wishes: ShoppingItem[] = [];
  (wishlist || []).forEach(function (w: any) {
    if (!w || w.deletedAt || w.id === undefined || w.id === null) return;
    wishes.push({
      key: "wish:" + String(w.id),
      kind: "wish",
      id: String(w.id),
      brand: String(w.brand || ""),
      name: String(w.name || ""),
      ...(w.imageUrl ? { imageUrl: String(w.imageUrl) } : {}),
      value: 0,
    });
  });

  restock.sort(byBrandThenName);
  wishes.sort(byBrandThenName);
  return { restock: restock, wishes: wishes };
}

// Total number of shopping rows (for the badge on the cart icon).
export function shoppingCount(list: ShoppingList | null | undefined): number {
  if (!list) return 0;
  return (list.restock ? list.restock.length : 0) + (list.wishes ? list.wishes.length : 0);
}
