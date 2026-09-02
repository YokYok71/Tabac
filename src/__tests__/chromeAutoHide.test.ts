/**
 * L'ESCAMOTAGE DE LA CHROME — la règle, et son câblage.
 *
 * Deux moitiés, parce que ce dépôt a payé six fois la seconde : une règle
 * éprouvée là où elle est DÉFINIE et non gardée là où elle est APPELÉE
 * (`chooseAutoSaveTarget`, `reDeductRestoredSessions`, `findParityGaps`,
 * `useUnsavedFormGuard`…). `nextChromeHidden` peut être parfaite et
 * `CuratorApp` ne jamais la brancher : le résultat serait une fonctionnalité
 * qui n'existe pas, avec une suite verte.
 *
 * CE QUE LA RUPTURE COÛTE, par clause :
 *
 *  • périmètre — escamoter sur `catalogue` retire le bouton RETOUR pendant
 *    qu'on parcourt une longue liste ; sur un formulaire, la barre porte
 *    « Enregistrer ». C'est la clause qui protège une sortie, pas un confort.
 *  • remontée — si un mouvement vers le haut ne révèle pas, la recherche et
 *    les filtres deviennent inatteignables autrement qu'en allant jusqu'au
 *    sommet. Le geste par lequel on les redemande n'aboutirait plus.
 *  • page courte — sans elle, une liste de trois lignes voit sa navigation
 *    clignoter pour un gain nul.
 *  • zone haute — sans elle, un défilement d'un pixel depuis le sommet fait
 *    disparaître la barre avant qu'on ait gagné la moindre place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canAutoHideChrome, nextChromeHidden, AUTO_HIDE_VIEWS,
  CHROME_REVEAL_TOP_PX, CHROME_HIDE_DELTA_PX, CHROME_MIN_OVERFLOW_RATIO,
} from "../utils/chromeAutoHide";
import { NO_DOCK_VIEWS } from "../utils/dockVisibility";

/** Une page franchement plus longue que l'écran, loin du sommet. */
const LONGUE = { viewportH: 800, docH: 4000 };
const BAS = CHROME_REVEAL_TOP_PX + 500;

describe("canAutoHideChrome — le périmètre", () => {
  it("les quatre racines de liste escamotent", () => {
    for (const v of ["inv", "pipes", "journal", "acc"]) {
      expect(canAutoHideChrome(v), v).toBe(true);
    }
  });

  it("le CATALOGUE n'escamote pas — sa barre porte le bouton retour", () => {
    // La distinction qui a fixé le périmètre : sur les quatre racines le
    // `leading` de la TopBar est une icône décorative, sur `catalogue` c'est
    // un `IconBtn icon="back"` qui appelle `nav("inv")`.
    expect(canAutoHideChrome("catalogue")).toBe(false);
  });

  it("ni le Home, ni les fiches, ni la dégustation, ni les pages de doc", () => {
    for (const v of ["home", "detail", "pipeDet", "accDet", "tasting",
                     "stats", "help", "changelog", "privacy", "licenses"]) {
      expect(canAutoHideChrome(v), v).toBe(false);
    }
  });

  it("aucun formulaire plein écran n'escamote", () => {
    // Ils prennent l'écran et leur barre porte l'action d'enregistrement.
    // Dérivé de `NO_DOCK_VIEWS` plutôt que réécrit : une vue ajoutée là-bas
    // doit rester exclue ici, et une liste recopiée s'accorderait toujours
    // avec elle-même.
    const communes = [...AUTO_HIDE_VIEWS].filter((v) => NO_DOCK_VIEWS.has(v));
    expect(communes, "une vue est à la fois sans dock et escamotable").toEqual([]);
  });

  it("la superposition d'envies suspend l'escamotage", () => {
    // Elle recouvre l'écran comme un formulaire : même garde que le dock.
    expect(canAutoHideChrome("inv", { showWishForm: true })).toBe(false);
    expect(canAutoHideChrome("inv", { editWishId: 42 })).toBe(false);
    expect(canAutoHideChrome("inv", { showWishForm: false, editWishId: null })).toBe(true);
  });
});

describe("nextChromeHidden — la règle", () => {
  it("une descente franche masque", () => {
    expect(nextChromeHidden(false, {
      ...LONGUE, prevScrollY: BAS, scrollY: BAS + CHROME_HIDE_DELTA_PX + 1,
    })).toBe(true);
  });

  it("TOUT mouvement vers le haut révèle, même d'un pixel", () => {
    // La moitié qui rend la chrome récupérable. Un seuil symétrique paraîtrait
    // cohérent et serait le défaut : il faudrait remonter franchement pour
    // récupérer une barre partie au moindre tremblement.
    expect(nextChromeHidden(true, {
      ...LONGUE, prevScrollY: BAS, scrollY: BAS - 1,
    })).toBe(false);
  });

  it("une descente SOUS le seuil ne change rien — pas d'oscillation", () => {
    expect(nextChromeHidden(false, {
      ...LONGUE, prevScrollY: BAS, scrollY: BAS + CHROME_HIDE_DELTA_PX,
    })).toBe(false);
    expect(nextChromeHidden(true, {
      ...LONGUE, prevScrollY: BAS, scrollY: BAS + CHROME_HIDE_DELTA_PX,
    })).toBe(true);
  });

  it("près du sommet, toujours visible — même en descendant", () => {
    expect(nextChromeHidden(true, {
      ...LONGUE, prevScrollY: 0, scrollY: CHROME_REVEAL_TOP_PX,
    })).toBe(false);
    // Et la borne mord bien : un pixel plus bas, la descente reprend ses droits.
    expect(nextChromeHidden(false, {
      ...LONGUE, prevScrollY: CHROME_REVEAL_TOP_PX,
      scrollY: CHROME_REVEAL_TOP_PX + CHROME_HIDE_DELTA_PX + 1,
    })).toBe(true);
  });

  it("une page trop courte n'escamote JAMAIS", () => {
    const courte = { viewportH: 800, docH: 800 + 800 * CHROME_MIN_OVERFLOW_RATIO };
    expect(nextChromeHidden(true, {
      ...courte, prevScrollY: BAS, scrollY: BAS + 500,
    })).toBe(false);
    // Non-vacuité : la MÊME descente sur une page longue masque bien. Sans
    // cette moitié, une règle qui ne masque jamais passerait le cas ci-dessus.
    expect(nextChromeHidden(true, {
      ...LONGUE, prevScrollY: BAS, scrollY: BAS + 500,
    })).toBe(true);
  });

  it("le rebond iOS (défilement négatif) révèle au lieu de masquer", () => {
    expect(nextChromeHidden(true, { ...LONGUE, prevScrollY: 0, scrollY: -60 })).toBe(false);
  });
});

describe("…et la coquille BRANCHE bien la règle", () => {
  const shell = readFileSync("src/CuratorApp.tsx", "utf8");

  it("CuratorApp compose l'escamotage AVEC shouldShowDock, pas à côté", () => {
    // La visibilité du dock garde UNE définition. Une seconde source de vérité
    // divergerait en silence — la classe que ce dépôt a payée sur le seuil de
    // stock bas (six copies) et sur le prédicat de collections (quatre).
    expect(shell).toContain("shouldShowDock(view,");
    expect(shell).toContain("canAutoHideChrome(view,");
    expect(shell).toContain("useChromeAutoHide(");
  });

  it("la barre du haut ET le dock reçoivent l'escamotage", () => {
    // LES DEUX MOITIÉS SONT EXIGÉES. Câbler le dock seul laisserait la
    // fonctionnalité à moitié faite avec une suite verte, et c'est exactement
    // la moitié que l'utilisateur a demandé d'ajouter.
    expect(shell, "la coquille ne pose pas --chrome-shift pour la TopBar")
      .toContain("--chrome-shift");
    expect(shell, "le dock ne reçoit pas hidden — il est en portail, il ne peut pas hériter")
      .toMatch(/hidden=\{chromeHidden\}/);
  });

  it("la TopBar honore la variable, et le dock COMPOSE son translateZ", () => {
    const topbar = readFileSync("src/components/curator/primitives.tsx", "utf8");
    expect(topbar).toContain("var(--chrome-shift, none)");
    const dock = readFileSync("src/components/curator/BottomDock.tsx", "utf8");
    // `translateZ(0)` est délibéré (racine du flou d'arrière-plan) : l'écraser
    // casserait un invariant gagné à la main, donc la translation s'y ajoute.
    expect(dock, "le translateZ(0) du dock a été remplacé au lieu d'être composé")
      .toContain('"translateZ(0) translateY(140%)"');
  });
});
