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

/** Les valeurs de repli du seuil de stock bas, PAR UNITÉ D'AFFICHAGE.
 *
 *  25 g ≈ 0,88 oz : le repli en onces est arrondi à 0,9, ce qui est la valeur
 *  historique — ne pas le « corriger » en 0,88, il est affiché dans un champ
 *  que l'utilisateur édite et un nombre rond y vaut mieux qu'une conversion
 *  exacte. */
export var LOW_STOCK_DEFAULT_G = 25;
export var LOW_STOCK_DEFAULT_OZ = 0.9;

/** LE seuil de stock bas effectif, à partir de la préférence stockée.
 *
 *  L'EXPRESSION EXISTAIT EN CINQ COPIES — `App.tsx`, `HomeViewV2`,
 *  `InventoryListView` (deux fois) et `ShoppingModal` — toutes écrites
 *  `parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25)`. Elles
 *  s'accordaient, ce qui est précisément ce qui rend la classe dangereuse :
 *  rien ne signale une copie qui décroche, et la puce « Stock bas », son
 *  compteur, la liste de courses et la section « À surveiller » du Home
 *  sélectionneraient alors des ensembles différents en prétendant nommer le
 *  même. C'est la duplication que ce dépôt a déjà payée sur le prédicat de
 *  collections (quatre copies), sur `FAMILY_AGING_MAX` et sur `CATS`.
 *
 *  LE `|| ` EST CONSERVÉ, ET DÉLIBÉRÉMENT : la préférence est une chaîne
 *  saisie à la main, donc `parseFloat` rend `NaN` sur une valeur vide ou
 *  illisible, et **zéro doit aussi retomber sur le repli** — un seuil de 0
 *  ferait que `isLowStock` (qui exige `w > 0 && w <= seuil`) ne sélectionne
 *  plus JAMAIS rien, c'est-à-dire une puce qui disparaît sans que personne
 *  sache pourquoi. Un `?? ` ou un test `isFinite` laisserait passer le 0.
 *  Une valeur NÉGATIVE retombe aussi, pour la même raison. */
export function lowStockThreshold(stored: any, weightUnit: string): number {
  var n = parseFloat(String(stored));
  if (isFinite(n) && n > 0) return n;
  return weightUnit === "oz" ? LOW_STOCK_DEFAULT_OZ : LOW_STOCK_DEFAULT_G;
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
