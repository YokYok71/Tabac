/**
 * LE DOCUMENT DE PROJET EST SEPT FICHIERS, ET LES PORTES DOIVENT LES VOIR TOUS.
 *
 * `CLAUDE.md` est injecté en entier dans chaque session ET dans chaque
 * sous-agent. MESURÉ à 1,08 Mo (~270 k jetons), il évinçait les sous-agents de
 * leur propre contexte : trois agents de sondage sur quatre sont morts avant
 * leur première sonde, et le seul survivant était celui dont la cible tenait en
 * une vue. La narration a donc été déplacée VERBATIM dans `docs/*.md` — rien
 * n'a été réécrit ni résumé, ce qui est la seule forme de découpage qui ne
 * perde pas le RAISONNEMENT que ce document existe pour porter.
 *
 * CE QUE CE FICHIER GARDE N'EST PAS LE DÉCOUPAGE, C'EST QUE LES PORTES
 * CONTINUENT DE LIRE LE TOUT. Quatre portes de `doc-check.cjs` grepent ce
 * document : « tout module de `src/utils/` y est nommé » (2), la même pour
 * `src/hooks/` (3), « toute clé de stockage figure dans la table » (4), et
 * l'arbre du dépôt (9). Chacune est une porte qui, privée de son sujet, ne
 * rapporte RIEN — c'est-à-dire qui se lit exactement comme un dépôt propre.
 * C'est la plus vieille forme de panne de ce dépôt (`prune` rouge pendant neuf
 * versions sous une prose qui l'annonçait vert), et un découpage en fichiers
 * est précisément l'occasion de la reproduire : il suffit d'ajouter un
 * `docs/*.md` sans l'inscrire dans `DOC_FILES`.
 *
 * LA CHARGE EST DONC INVERSÉE, comme dans `browserPathFilter.test.ts` : plutôt
 * que de redire la liste — ce qui n'apprendrait rien, une liste écrite deux
 * fois s'accordant toujours avec elle-même — on parcourt les fichiers que git
 * SUIT et on exige que chacun soit couvert.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../../scripts/docChecks.cjs");
const DOC_FILES: string[] = D.DOC_FILES;

/** Les `.md` de premier plan que git suit, hors dépendances et hors artefacts. */
function docsSuivisParGit(): string[] {
  const out = execSync("git ls-files 'docs/*.md' 'docs/**/*.md'", { encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

describe("DOC_FILES couvre le document entier", () => {
  it("liste des fichiers qui existent, sans doublon, et CLAUDE.md en tête", () => {
    expect(DOC_FILES.length, "liste vide — chaque porte lirait le néant").toBeGreaterThan(1);
    expect(new Set(DOC_FILES).size, "doublon dans DOC_FILES").toBe(DOC_FILES.length);
    // Le premier reste `CLAUDE.md` : c'est le fichier que l'outillage charge
    // automatiquement, donc celui qui doit porter le noyau normatif.
    expect(DOC_FILES[0]).toBe("CLAUDE.md");
    for (const f of DOC_FILES) expect(existsSync(f), f + " est listé mais absent").toBe(true);
  });

  it("tout `docs/*.md` suivi par git y figure", () => {
    // LA MOITIÉ QUI COMPTE. Un fichier de doc ajouté et non inscrit ici est
    // invisible aux quatre portes : elles continuent de passer en n'examinant
    // plus leur sujet. C'est le sens de l'inversion — on part du dépôt, jamais
    // de la liste.
    const suivis = docsSuivisParGit();
    expect(suivis.length, "aucun docs/*.md suivi — le parcours est vide, donc le cas est creux")
      .toBeGreaterThan(0);
    const manquants = suivis.filter((f) => !DOC_FILES.includes(f));
    expect(manquants, "des fichiers de doc échappent aux portes").toEqual([]);
  });
});

describe("la concaténation porte encore ce que les portes y cherchent", () => {
  const tout = DOC_FILES.map((f) => readFileSync(f, "utf8")).join("\n");

  it("les quatre sujets des portes 2/3/4/9 sont présents", () => {
    // Non pas une redite du découpage — ces quatre titres sont ce que les
    // portes SLICENT ou GREPENT, donc déplacer l'un d'eux dans un fichier non
    // listé le ferait disparaître ici en premier. La porte 9 échouerait
    // bruyamment (« section not found ») ; les portes 2/3/4, elles, se
    // contenteraient de ne plus rien trouver à reprocher.
    for (const titre of [
      "## Repository Structure",
      "## Custom Hooks",
      "## Pure Utility Functions",
      "## localStorage / sessionStorage Keys Reference",
    ]) {
      expect(tout.includes(titre), "titre absent de la concaténation : " + titre).toBe(true);
    }
  });

  it("l'arbre du dépôt s'analyse toujours, où qu'il vive", () => {
    const { paths, errors } = D.extractTreePaths(tout, "## Repository Structure");
    expect(errors).toEqual([]);
    expect(paths.length).toBeGreaterThan(50);
  });
});

describe("…et `doc-check.cjs` lit BIEN cette liste", () => {
  it("la porte prend DOC_FILES et n'en garde pas une copie", () => {
    // LE CÂBLAGE EST CE QUI POURRIT — la leçon déjà payée sur
    // `chooseAutoSaveTarget` et `reDeductRestoredSessions` : une liste parfaite
    // et un appelant qui ne la lit pas font une garantie et non deux. Une
    // seconde copie dans `doc-check.cjs` serait libre de diverger en silence.
    const gate = readFileSync("scripts/doc-check.cjs", "utf8");
    expect(gate).toContain("docChecks.DOC_FILES");
    expect(
      /const\s+DOC_FILES\s*=/.test(gate),
      "doc-check.cjs redéclare DOC_FILES — deux listes, une seule sera corrigée",
    ).toBe(false);
  });

  it("CLAUDE.md indexe les fichiers déplacés", () => {
    // Le noyau doit dire OÙ le reste est parti, sinon le découpage ne fait que
    // cacher la documentation à celui qui la cherche.
    const core = readFileSync("CLAUDE.md", "utf8");
    for (const f of DOC_FILES.slice(1)) {
      expect(core.includes(f), "CLAUDE.md ne renvoie pas vers " + f).toBe(true);
    }
  });
});
