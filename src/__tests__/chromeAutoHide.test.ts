/**
 * L'ESCAMOTAGE DE LA CHROME — la règle, et son câblage.
 *
 * Deux moitiés, parce que ce dépôt a payé six fois la seconde : une règle
 * éprouvée là où elle est DÉFINIE et non gardée là où elle est APPELÉE
 * (`chooseAutoSaveTarget`, `reDeductRestoredSessions`, `findParityGaps`,
 * `useUnsavedFormGuard`…). `nextChromeState` peut être parfaite et
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
import { readFileSync, readdirSync } from "node:fs";
import {
  canAutoHideChrome, nextChromeState, initialChromeScrollState,
  CHROME_REVEAL_TOP_PX, CHROME_HIDE_DELTA_PX, CHROME_MIN_OVERFLOW_RATIO,
  type ChromeScrollState,
} from "../utils/chromeAutoHide";
import { shouldShowDock } from "../utils/dockVisibility";

/** Une page franchement plus longue que l'écran, loin du sommet. */
const LONGUE = { viewportH: 800, docH: 4000 };
const BAS = CHROME_REVEAL_TOP_PX + 500;

/** Rejoue une SUITE de positions comme le ferait le hook — une mesure par
 *  trame — et rend l'état final.
 *
 *  Les cas passent par ici plutôt que par un appel isolé parce que la règle
 *  porte désormais sur une COURSE et non sur un pas : un cas à un seul appel ne
 *  peut plus, par construction, distinguer « 12 px d'un coup » de « quatre fois
 *  3 px », qui est exactement la différence que le défaut livré avait laissée
 *  passer. */
function rejoue(positions: number[], page = LONGUE, depart?: ChromeScrollState): ChromeScrollState {
  let s = depart ?? initialChromeScrollState(positions[0] ?? 0);
  for (const y of positions) s = nextChromeState(s, { ...page, scrollY: y });
  return s;
}

/** Les identifiants de vue RÉELS, extraits des vues elles-mêmes.
 *
 *  ÉCRIT APRÈS UN TEST CREUX, ET C'EST LA RAISON DE CETTE DÉRIVATION. La
 *  première version de ce fichier assertait `canAutoHideChrome("catalogue")`
 *  — or la vue s'appelle `catalog`. Le cas passait donc pour une mauvaise
 *  raison : il mesurait une chaîne qui n'existe NULLE PART dans l'application,
 *  et il serait resté vert même si le vrai `catalog` avait été ajouté au
 *  périmètre. C'est l'exclusion la plus importante du lot (sa barre porte
 *  l'unique sortie) et elle n'était gardée par rien.
 *
 *  Une liste réécrite à la main aurait le même défaut. On lit donc les gardes
 *  des vues (`view !== "x"` / `view === "x"`) : un identifiant qui ne s'y
 *  trouve pas n'existe pas. */
function idsDeVueReels(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync("src/views/curator")) {
    if (!f.endsWith(".tsx")) continue;
    const src = readFileSync("src/views/curator/" + f, "utf8");
    for (const m of src.matchAll(/view\s*[!=]==\s*"([a-zA-Z]+)"/g)) out.add(m[1]!);
    // Les pages de documentation ne se gardent pas par `view !== "x"` : elles
    // passent par un registre et sont atteintes par `nav("changelog")`. Sans
    // cette seconde source, elles compteraient comme des fantômes.
    for (const m of src.matchAll(/nav\(\s*"([a-zA-Z]+)"/g)) out.add(m[1]!);
  }
  return out;
}

describe("canAutoHideChrome — le périmètre est celui du DOCK", () => {
  const REELS = idsDeVueReels();

  it("l'escamotage vaut EXACTEMENT là où la chrome est affichée", () => {
    // L'ASSERTION QUI REMPLACE UNE LISTE, et qui supprime une classe de bug
    // entière. J'ai tenu un `AUTO_HIDE_VIEWS` à la main pendant trois commits ;
    // il a produit TROIS chaînes fantômes — « catalogue » (la vue est
    // `catalog`), puis « detail »/« pipeDet »/« accDet » (des sous-états, pas
    // des vues) — dont la dernière a livré le défaut que le périmètre existait
    // pour empêcher. Une liste recopiée s'accorde toujours avec elle-même.
    // Ici on ne compare plus à une liste : on compare les DEUX décisions sur
    // tous les identifiants que l'application déclare, et sur les deux états de
    // la superposition d'envies.
    expect(REELS.size, "aucun identifiant lu — la comparaison serait creuse")
      .toBeGreaterThan(10);
    const desaccords: string[] = [];
    for (const v of REELS) {
      for (const g of [{}, { showWishForm: true }, { editWishId: 7 }]) {
        if (canAutoHideChrome(v, g) !== shouldShowDock(v, g)) desaccords.push(v + " " + JSON.stringify(g));
      }
    }
    expect(desaccords, "l'escamotage et le dock ne s'accordent plus").toEqual([]);
  });

  it("les pages QUI PORTENT les menus escamotent — fiches et catalogue compris", () => {
    // Le critère est de l'utilisateur : « toutes les pages où se trouvent les
    // menus ». Le catalogue en fait partie, et les fiches aussi — elles ne
    // changent pas de vue, elles se rendent sous `inv`/`pipes`/`acc`, donc
    // elles sont couvertes par leur liste sans clause supplémentaire.
    for (const v of ["home", "inv", "pipes", "acc", "journal", "stats", "catalog"]) {
      expect(REELS.has(v), `« ${v} » n'est pas un identifiant de vue réel`).toBe(true);
      expect(canAutoHideChrome(v), v).toBe(true);
    }
  });

  it("les pages SANS menus n'escamotent pas — il n'y a rien à effacer", () => {
    for (const v of ["tasting", "addT", "editT", "addP", "editP", "addA", "editA",
                     "addJ", "editJ", "help", "changelog", "privacy", "licenses"]) {
      expect(REELS.has(v), `« ${v} » n'est pas un identifiant de vue réel`).toBe(true);
      expect(canAutoHideChrome(v), v).toBe(false);
    }
  });

  it("la superposition d'envies suspend l'escamotage", () => {
    // Elle recouvre l'écran comme un formulaire — et comme elle masque déjà le
    // dock, la dérivation le donne gratuitement.
    expect(canAutoHideChrome("inv", { showWishForm: true })).toBe(false);
    expect(canAutoHideChrome("inv", { editWishId: 42 })).toBe(false);
    expect(canAutoHideChrome("inv", { showWishForm: false, editWishId: null })).toBe(true);
  });
});

describe("nextChromeState — la règle", () => {
  it("une descente franche masque", () => {
    expect(rejoue([BAS, BAS + CHROME_HIDE_DELTA_PX + 1]).hidden).toBe(true);
  });

  it("UN GLISSEMENT LENT masque aussi — le seuil est une DISTANCE, pas une vitesse", () => {
    // LE DÉFAUT LIVRÉ, ET LE SEUL CAS QUI L'AURAIT VU. Le seuil était comparé
    // au pas d'UNE TRAME ; comme le hook ne mesure qu'une fois par trame, il
    // était devenu ~720 px/s. Quatre pas de 3 px descendent bien 12 px et ne
    // franchissaient rien. Chaque pas ci-dessous est INDIVIDUELLEMENT sous le
    // seuil : c'est ce qui rend le cas non trivial.
    const pas = 3;
    expect(pas).toBeLessThan(CHROME_HIDE_DELTA_PX);
    const suite = [BAS, BAS + pas, BAS + 2 * pas, BAS + 3 * pas, BAS + 4 * pas, BAS + 5 * pas];
    expect(rejoue(suite).hidden).toBe(true);
  });

  it("TOUT mouvement vers le haut révèle, même d'un pixel APRÈS une longue descente", () => {
    // La moitié qui rend la chrome récupérable. Un seuil symétrique paraîtrait
    // cohérent et serait le défaut : il faudrait remonter franchement pour
    // récupérer une barre partie au moindre tremblement.
    //
    // « APRÈS UNE LONGUE DESCENTE » EST LA PART QUI COMPTE, et elle est neuve.
    // Avec un cumul, un seul repère ne suffisait plus : descendu de 300 px puis
    // remonté de 1, le cumul reste +299 et la barre serait restée cachée. C'est
    // le piège que le second repère (`anchorY`, remis à zéro au retournement)
    // existe pour éviter, et ce cas est ce qui l'atteste.
    const descendu = rejoue([BAS, BAS + 300]);
    expect(descendu.hidden).toBe(true);
    expect(nextChromeState(descendu, { ...LONGUE, scrollY: BAS + 299 }).hidden).toBe(false);
  });

  it("une descente SOUS le seuil ne change rien — pas d'oscillation", () => {
    expect(rejoue([BAS, BAS + CHROME_HIDE_DELTA_PX]).hidden).toBe(false);
    const cache = { hidden: true, anchorY: BAS, lastY: BAS };
    expect(rejoue([BAS + CHROME_HIDE_DELTA_PX], LONGUE, cache).hidden).toBe(true);
  });

  it("près du sommet, toujours visible — même en descendant", () => {
    const cache = { hidden: true, anchorY: 0, lastY: 0 };
    expect(rejoue([CHROME_REVEAL_TOP_PX], LONGUE, cache).hidden).toBe(false);
    // Et la borne mord bien : un pixel plus bas, la descente reprend ses droits.
    expect(rejoue([
      CHROME_REVEAL_TOP_PX + 1,
      CHROME_REVEAL_TOP_PX + CHROME_HIDE_DELTA_PX + 2,
    ]).hidden).toBe(true);
  });

  it("les zones où l'on ne masque pas REPARTENT DE ZÉRO", () => {
    // CE CAS PORTE SUR L'ÉTAT, PAS SUR `hidden`, ET C'EST DÉLIBÉRÉ — écrit
    // ainsi après qu'une sonde a refusé la première version. J'avais affirmé
    // que sans cette remise à zéro « repartir du sommet et descendre de deux
    // pixels masquerait d'un coup » ; c'est FAUX, la règle de retournement
    // recale l'ancrage au premier changement de sens, donc la sortie `hidden`
    // est identique dans les deux formes. Un cas qui aurait mesuré `hidden`
    // serait resté vert le défaut réintroduit : il l'était.
    //
    // Ce que la remise à zéro garantit réellement est plus modeste et vaut
    // qu'on l'épingle : l'état ne conserve AUCUNE mémoire d'une course entamée
    // là où l'escamotage ne s'applique pas — c'est la même normalisation dont
    // le minuteur d'immobilité se sert pour révéler.
    expect(rejoue([BAS, BAS + 300, 40])).toEqual(initialChromeScrollState(40));
    const courte = { viewportH: 800, docH: 900 };
    expect(rejoue([BAS, BAS + 300], courte)).toEqual(initialChromeScrollState(BAS + 300));
  });

  it("une page trop courte n'escamote JAMAIS", () => {
    const courte = { viewportH: 800, docH: 800 + 800 * CHROME_MIN_OVERFLOW_RATIO };
    expect(rejoue([BAS, BAS + 500], courte).hidden).toBe(false);
    // Non-vacuité : la MÊME descente sur une page longue masque bien. Sans
    // cette moitié, une règle qui ne masque jamais passerait le cas ci-dessus.
    expect(rejoue([BAS, BAS + 500]).hidden).toBe(true);
  });

  it("le rebond iOS (défilement négatif) révèle au lieu de masquer", () => {
    const cache = { hidden: true, anchorY: 0, lastY: 0 };
    expect(rejoue([-60], LONGUE, cache).hidden).toBe(false);
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
    // LA MÊME PORTE AUX DEUX APPELS. La dérivation ne vaut que si le site
    // d'appel donne aux deux fonctions le MÊME état : leur passer des portes
    // différentes les ferait diverger malgré une règle dérivée, et ce serait
    // d'autant plus difficile à voir que le code aurait l'air correct.
    const porte = (re: RegExp) => (shell.match(re) || [])[1];
    const gDock = porte(/shouldShowDock\(view,\s*(\{[^}]*\})/);
    const gChrome = porte(/canAutoHideChrome\(view,\s*(\{[^}]*\})/);
    expect(gDock, "appel à shouldShowDock introuvable").toBeTruthy();
    expect(gChrome, "appel à canAutoHideChrome introuvable").toBeTruthy();
    expect(gChrome, "le dock et l'escamotage ne reçoivent pas le même état").toBe(gDock);
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

  it("le Home a son PROPRE en-tête, et il honore la variable lui aussi", () => {
    // `HomeViewV2` n'utilise pas le primitif `TopBar` : elle bâtit son en-tête
    // à la main, avec la même recette collante et floutée. C'est donc un SECOND
    // site d'appel, invisible depuis `primitives.tsx` — et le genre d'endroit
    // où une fonctionnalité s'arrête sans que rien ne le dise. Elle hérite de
    // `--chrome-shift` parce que son en-tête est un descendant de `<main>`.
    const home = readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
    expect(home, "l'en-tête du Home n'honore pas --chrome-shift : la page ne s'escamote pas")
      .toContain("var(--chrome-shift, none)");
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
