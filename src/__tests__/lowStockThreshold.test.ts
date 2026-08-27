/**
 * LE SEUIL DE STOCK BAS N'A QU'UNE SEULE DÉFINITION.
 *
 * L'expression `parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25)`
 * existait en CINQ copies — `App.tsx`, `HomeViewV2`, `InventoryListView` (deux
 * fois) et `ShoppingModal` — plus une SIXIÈME qui divergeait déjà.
 *
 * Les cinq s'accordaient, et c'est précisément ce qui rend la classe dangereuse :
 * rien ne signale la copie qui décroche. Le jour où l'une d'elles change, la
 * puce « Stock bas », son compteur, la liste de courses et la section « À
 * surveiller » du Home sélectionnent des ensembles DIFFÉRENTS en prétendant
 * nommer le même — un contrôle qui ment sur ce qu'il sélectionne, le défaut que
 * ce dépôt a déjà payé sur la puce « À fumer rapidement » et sur celle « At
 * peak ». C'est la duplication déjà payée sur le prédicat de collections (quatre
 * copies), sur `FAMILY_AGING_MAX` et sur `CATS`.
 *
 * LA SIXIÈME DIVERGEAIT DÉJÀ, ET PERSONNE NE POUVAIT LE VOIR. Le champ de
 * Réglages affichait `watchLowWeight || "25"` — un 25 en dur, AVEUGLE À
 * L'UNITÉ. En onces, le réglage montrait donc 25 pendant que les cinq
 * consommateurs appliquaient 0,9 : le réglage mentait sur la valeur en vigueur,
 * d'un facteur 28.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  lowStockThreshold,
  isLowStock,
  LOW_STOCK_DEFAULT_G,
  LOW_STOCK_DEFAULT_OZ,
} from "../utils/shopping";

describe("lowStockThreshold — la règle", () => {
  it("rend la valeur stockée quand elle est lisible et positive", () => {
    expect(lowStockThreshold("40", "g")).toBe(40);
    expect(lowStockThreshold("1.5", "oz")).toBe(1.5);
    expect(lowStockThreshold(40, "g"), "un nombre, pas seulement une chaîne").toBe(40);
  });

  it("retombe sur le repli DE L'UNITÉ quand rien n'est stocké", () => {
    expect(lowStockThreshold("", "g")).toBe(LOW_STOCK_DEFAULT_G);
    expect(lowStockThreshold("", "oz")).toBe(LOW_STOCK_DEFAULT_OZ);
    expect(lowStockThreshold(undefined, "oz")).toBe(LOW_STOCK_DEFAULT_OZ);
    // La moitié qui compte : les deux replis DIFFÈRENT. Sans ça, un résolveur
    // aveugle à l'unité passerait tous les cas ci-dessus.
    expect(LOW_STOCK_DEFAULT_G).not.toBe(LOW_STOCK_DEFAULT_OZ);
  });

  it("ZÉRO retombe sur le repli — et c'est la garde qui compte", () => {
    // `isLowStock` exige `w > 0 && w <= seuil`, donc un seuil de 0 ne
    // sélectionne plus JAMAIS rien : la puce « Stock bas » disparaît et son
    // compteur tombe à zéro, sans que personne sache pourquoi. Un `??` ou un
    // simple test `isFinite` laisserait passer ce 0.
    expect(lowStockThreshold("0", "g")).toBe(LOW_STOCK_DEFAULT_G);
    expect(lowStockThreshold(0, "oz")).toBe(LOW_STOCK_DEFAULT_OZ);
    const presqueVide = { lots: [{ status: "jar", weightG: "5" }] };
    expect(
      isLowStock(presqueVide, lowStockThreshold("0", "g")),
      "avec un seuil de 0 mal résolu, plus rien n'est jamais en stock bas",
    ).toBe(true);
  });

  it("une valeur illisible ou négative retombe aussi", () => {
    for (const v of ["", "  ", "abc", "-5", null, {}, NaN, Infinity]) {
      expect(lowStockThreshold(v as any, "g"), String(v)).toBe(LOW_STOCK_DEFAULT_G);
    }
  });
});

describe("…et il n'existe qu'UNE implémentation", () => {
  /** Sources de production, commentaires blanchis : les commentaires de ce
   *  correctif CITENT l'ancienne expression pour expliquer ce qu'elle coûtait,
   *  et une recherche brute trouverait la prose au lieu du code — le piège que
   *  ce dépôt a déjà rencontré quatre fois. */
  function sansCommentaires(p: string): string {
    return readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  }

  const CONSOMMATEURS = [
    "src/App.tsx",
    "src/views/curator/HomeViewV2.tsx",
    "src/views/curator/InventoryListView.tsx",
    "src/views/curator/ShoppingModal.tsx",
    "src/views/curator/SettingsModal.tsx",
  ];

  it("aucun consommateur ne résout `watchLowWeight` à la main", () => {
    // LA RÈGLE PORTE SUR LA PRÉFÉRENCE, PAS SUR LA FORME DU TERNAIRE — et la
    // première version de ce cas s'est trompée là-dessus. Elle interdisait tout
    // ternaire `weightUnit === "oz" ? … : …`, ce qui a flagué `lowLotThreshold`
    // dans `HomeViewV2` : un AUTRE seuil (le pot presque vide), à un seul site,
    // donc pas la même classe. Une garde qui fait réécrire du code correct est
    // pire qu'une absence de garde ; ce qu'il faut interdire est de résoudre
    // `watchLowWeight` ailleurs que par le résolveur.
    const fautifs: string[] = [];
    for (const p of CONSOMMATEURS) {
      for (const l of sansCommentaires(p).split("\n")) {
        if (!l.includes("watchLowWeight")) continue;
        if (l.includes("lowStockThreshold(")) continue;   // la bonne voie
        if (/watchLowWeight\s*\)?\s*(\|\||\?\?)/.test(l) || /parseFloat\(\s*watchLowWeight/.test(l)) {
          fautifs.push(`${p} :: ${l.trim().slice(0, 70)}`);
        }
      }
    }
    expect(fautifs, "`watchLowWeight` est résolu à la main").toEqual([]);
  });

  it("…et tous passent bien par le résolveur", () => {
    // La non-vacuité : sans elle, supprimer le seuil partout satisferait le cas
    // ci-dessus en n'ayant plus aucun consommateur du tout.
    for (const p of CONSOMMATEURS) {
      expect(sansCommentaires(p), p + " n'appelle pas lowStockThreshold")
        .toContain("lowStockThreshold(");
    }
  });
});
