/**
 * UNE RÉPONSE D'IA NE SE POSE PAS SUR LE FORMULAIRE SUIVANT.
 *
 * L'appel au fournisseur dispose de 60 s, n'est pas annulé à la navigation, et
 * son résultat se pose sur la copie de travail COURANTE. La garde par `id`
 * règle les fiches en ÉDITION ; elle laissait un trou ÉNONCÉ pour deux
 * formulaires d'AJOUT successifs, qui portent tous deux `undefined` : ouvrir
 * « nouveau tabac », lancer la recherche, ressortir, rouvrir « nouveau tabac »,
 * et la première réponse atterrissait dans le second formulaire.
 *
 * CE FICHIER ÉPINGLE LES DEUX MOITIÉS, parce qu'une seule ne vaut rien :
 * le MÉCANISME (`utils/formSession.ts`) et le CÂBLAGE — les sites qui ouvrent
 * une session et les trois écrivains qui la vérifient. C'est la forme
 * `chooseAutoSaveTarget`, testée et non câblée, que ce dépôt a payée quatre
 * fois : un compteur parfait derrière un `nav()` qui ne l'appelle pas ne
 * garde rien.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  bumpFormSession,
  currentFormSession,
  _resetFormSessionForTests,
} from "../utils/formSession";

/** Source COMMENTAIRES BLANCHIS. Indispensable ici : les commentaires que ce
 *  correctif ajoute citent `currentFormSession` et `bumpFormSession` en toutes
 *  lettres, donc une recherche brute trouverait la prose au lieu du code — le
 *  piège que ce dépôt a déjà rencontré trois fois. */
function sourceSansCommentaires(p: string): string {
  const s = readFileSync(p, "utf8");
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/./g, " "));
}

const APP = sourceSansCommentaires("src/App.tsx");
const AI = sourceSansCommentaires("src/hooks/useAiAutoFill.ts");
const INV = sourceSansCommentaires("src/views/curator/InventoryListView.tsx");

beforeEach(() => { _resetFormSessionForTests(); });

describe("formSession — le mécanisme", () => {
  it("chaque ouverture donne une valeur NOUVELLE", () => {
    const a = currentFormSession();
    const b = bumpFormSession();
    expect(b).not.toBe(a);
    expect(currentFormSession()).toBe(b);
  });

  it("il ne recule jamais — deux ouvertures ne peuvent pas se confondre", () => {
    // Une valeur qui se répéterait ferait exactement ce que la garde doit
    // empêcher : deux sessions distinctes jugées identiques.
    const vus = new Set<number>();
    for (let i = 0; i < 50; i++) vus.add(bumpFormSession());
    expect(vus.size).toBe(50);
  });

  it("sans ouverture, la session ne bouge pas", () => {
    // Le contre-cas : un compteur qui avancerait tout seul jetterait des
    // réponses que l'utilisateur attend, ce qui est le défaut symétrique.
    const a = currentFormSession();
    expect(currentFormSession()).toBe(a);
    expect(currentFormSession()).toBe(a);
  });
});

describe("…et le câblage, qui est la moitié qui pourrit", () => {
  it("nav() ouvre une session", () => {
    // Le goulot. Aucun nom de vue n'est listé — « l'utilisateur a navigué »
    // suffit — donc c'est la PRÉSENCE de l'appel dans `nav` qui est la règle.
    const i = APP.indexOf("function nav(");
    expect(i, "nav() doit exister").toBeGreaterThan(-1);
    const corps = APP.slice(i, i + 1400);
    expect(corps).toContain("bumpFormSession()");
  });

  it("le calque « envie » l'ouvre lui-même, puisque nav() ne le voit pas", () => {
    // Le formulaire d'envie n'est pas une vue : sans ces deux appels, deux
    // « nouvelle envie » successives restent indistinguables.
    for (const ouvreur of ["openAddWish", "openEditWish"]) {
      const i = INV.indexOf("const " + ouvreur + " =");
      expect(i, `${ouvreur} doit exister`).toBeGreaterThan(-1);
      expect(
        INV.slice(i, i + 700),
        `${ouvreur} doit ouvrir une session`,
      ).toContain("bumpFormSession()");
    }
  });

  it("l'appel CAPTURE la session au départ", () => {
    expect(AI).toContain("var targetSession = currentFormSession();");
  });

  it("LES TROIS écrivains la vérifient — pas deux", () => {
    // Une garde posée sur deux écrivains sur trois est un correctif pour les
    // deux tiers du défaut. Le COMPTE est donc la règle, pas la présence :
    // un quatrième écrivain ajouté plus tard sans garde fera rougir ce cas.
    const gardes = AI.match(/currentFormSession\(\) !== targetSession/g) || [];
    expect(gardes.length).toBe(3);
    // Et chacune reste couplée à la garde par `id` : la session seule ne
    // distingue pas deux fiches ouvertes dans la même session de navigation.
    const couplees = AI.match(
      /f\.id !== targetId \|\| currentFormSession\(\) !== targetSession/g,
    ) || [];
    expect(couplees.length).toBe(3);
  });
});
