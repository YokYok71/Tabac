/**
 * LA BASE DE TRAVAIL EST-ELLE À JOUR ? — une porte contre une erreur mesurée.
 *
 * CE QUI EST ARRIVÉ, LE 21 SEPTEMBRE 2026. Pour éprouver trois PR Dependabot,
 * j'ai fait `git checkout -B test-deps main`, installé les montées, et lancé les
 * sept portes. **Toutes vertes.** Or `main` LOCAL avait sept builds de retard :
 * ce dépôt pousse avec `git push origin HEAD:main`, ce qui met à jour
 * `refs/remotes/origin/main` et **jamais** la branche locale `main`. Les portes
 * ont donc certifié un arbre vieux de sept builds, sans qu'une seule ne
 * bronche — parce qu'elles étaient toutes vertes SUR CET ARBRE-LÀ.
 *
 * CE QUI L'A RÉVÉLÉ N'EST PAS UNE ERREUR MAIS UN COMPTE : 310 fichiers /
 * 5967 tests au lieu de 311 / 6036. Un fichier de test écrit depuis manquait.
 * Sans ce chiffre dans la sortie de vitest, la sonde non appliquée passait pour
 * un succès — et c'est exactement la classe de défaut que ce dépôt a payée
 * plusieurs fois : *une sonde qui ne s'applique pas ne prouve rien, verte comme
 * rouge.*
 *
 * CE QUE CETTE GARDE FAIT. Elle exige que `HEAD` DESCENDE de `origin/main`. Un
 * `HEAD` qui n'en descend pas veut dire que le travail est bâti sur une base
 * périmée — ou sur une divergence — et que tout ce que les portes diront porte
 * sur autre chose que ce qui est en ligne.
 *
 * CE QU'ELLE NE FAIT PAS, ET POURQUOI. Elle n'exige PAS que la branche locale
 * `main` soit à jour. Dans ce dépôt elle est périmée par construction, à chaque
 * poussée ; en faire une erreur produirait un rouge permanent qui n'apprend
 * rien. Le remède n'est pas de rafraîchir `main`, c'est de **ne jamais partir
 * de `main` — partir de `origin/main`**, ce que le message d'échec dit.
 *
 * LA NON-APPLICABILITÉ EST ELLE-MÊME UNE ERREUR, HORS CI. En CI le dépôt est
 * cloné à `fetch-depth: 1` sur un HEAD détaché : `origin/main` n'y existe pas,
 * la garde ne peut pas s'appliquer, et c'est LÉGITIME — là-bas, `HEAD` EST le
 * commit poussé, il n'y a pas de base périmée possible. En local, en revanche,
 * ne pas pouvoir résoudre la référence est un défaut d'environnement qu'il vaut
 * mieux voir rouge qu'ignorer : sans cette clause, la garde se transformerait
 * silencieusement en `it("ne vérifie rien")` le jour où git deviendrait
 * introuvable.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/** Tourne `git` et rend sa sortie, ou `null` si la commande échoue. Le `null`
 *  est TOUJOURS traité par l'appelant — jamais avalé. */
function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** GitHub Actions pose `CI=true` ; c'est aussi la convention de tous les autres
 *  fournisseurs. On ne teste PAS `GITHUB_ACTIONS` en particulier, pour que la
 *  garde reste correcte si l'intégration change de maison. */
const EN_CI = process.env.CI === "true" || process.env.CI === "1";

describe("la base de travail n'est pas périmée", () => {
  it("HEAD descend de origin/main — ou l'on est en CI, où la question ne se pose pas", () => {
    const tete = git("rev-parse", "HEAD");
    const origine = git("rev-parse", "refs/remotes/origin/main");

    if (origine === null || tete === null) {
      // Ici la garde ne peut PAS s'appliquer. En CI c'est normal (clone
      // superficiel, HEAD détaché, pas de référence distante). En local, non :
      // c'est un environnement cassé, et le taire reviendrait à livrer une
      // garde creuse.
      expect(
        EN_CI,
        "impossible de résoudre HEAD ou origin/main hors CI — la garde ne peut pas s'appliquer. "
          + "Lancer `git fetch origin main` pour lui rendre son sujet.",
      ).toBe(true);
      return;
    }

    if (tete === origine) return; // pile sur la pointe publiée

    const descend = git("merge-base", "--is-ancestor", origine, tete) !== null;
    expect(
      descend,
      `la base de travail est périmée : HEAD (${tete.slice(0, 7)}) ne descend pas de `
        + `origin/main (${origine.slice(0, 7)}). Les portes vont certifier un arbre qui n'est `
        + `pas celui en ligne — c'est ainsi que sept builds ont été mesurés à vide le `
        + `21 septembre 2026. Remède : repartir de la référence DISTANTE, pas de la branche `
        + `locale du même nom, qui est périmée par construction ici :\n`
        + `    git checkout -B <branche> origin/main\n`
        + `ou, si le travail en cours doit être gardé :\n`
        + `    git fetch origin main && git rebase origin/main`,
    ).toBe(true);
  });
});
