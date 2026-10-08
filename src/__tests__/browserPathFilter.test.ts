// LE FILTRE PAR CHEMINS DES CAMPAGNES NAVIGATEUR — et pourquoi il ne peut pas
// être laissé à la relecture.
//
// `.github/workflows/browser.yml` ne se déclenche que sur les fichiers qui
// peuvent changer un pixel rendu. L'économie est modeste et MESURÉE — quatre
// exécutions sur vingt, toutes des commits purement tests ou documentation —
// mais le mécanisme, lui, est une LISTE DE CHEMINS ÉCRITE À LA MAIN, c'est-à-
// dire exactement la classe de liste figée que ce dépôt a trouvée six fois
// (les six repliants silencieux de langue, le défaut du vérificateur de mise en
// page, la liste de `reset.html`, celle de `useStartupNotice`…). Son mode de
// panne est le pire qui soit : **elle continue de paraître verte tout en ayant
// cessé de couvrir**, puisqu'un workflow ignoré ne rapporte rien du tout.
//
// LA CHARGE EST DONC INVERSÉE. Le test ne redit pas la liste — ce serait une
// deuxième source de vérité, la dérive que ce dépôt paie en boucle. Il parcourt
// les fichiers SUIVIS par git et exige que chacun soit dans l'un de deux états :
//
//   · couvert par un motif du filtre → il déclenche la campagne ;
//   · couvert par une exemption NOMMÉE ci-dessous, portant sa raison.
//
// Tout ce qui n'est ni l'un ni l'autre fait échouer la suite en se nommant. Un
// nouveau fichier sous `src/` est donc couvert d'office ; un septième
// répertoire de premier niveau ne peut pas sortir de la couverture en silence.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const WF = ".github/workflows/browser.yml";
const wf = readFileSync(WF, "utf8");

/**
 * Les motifs, et le moteur qui les applique, sont ceux de
 * `scripts/browserScope.cjs` — le script qui décide AU DÉPLOIEMENT si la
 * campagne tourne. Ce fichier en avait sa propre copie, écrite pour lui seul ;
 * depuis que la même liste sert aussi à `deploy.yml`, deux moteurs auraient pu
 * diverger, et le test aurait gardé un filtre que le déploiement n'applique
 * pas. Un seul moteur : celui qui tourne est celui qui est vérifié.
 *
 * Il reste volontairement pauvre (un chemin littéral, ou un préfixe suivi de
 * `**`, éventuellement nié) et LÈVE sur toute autre forme, sans quoi une
 * syntaxe plus riche introduite plus tard rendrait ce garde silencieux.
 */
const scope = createRequire(import.meta.url)("../../scripts/browserScope.cjs") as {
  patterns: (wf: string) => string[];
  triggers: (file: string, pats: string[]) => boolean;
};
function patterns(): string[] {
  expect(wf.indexOf("paths: &browser_paths"), "l'ancre `&browser_paths` a disparu du workflow").toBeGreaterThan(-1);
  return scope.patterns(wf);
}
const triggers = scope.triggers;

/**
 * CE QUI NE PEUT PAS CHANGER UN PIXEL — chaque entrée est une décision, pas une
 * commodité. Court par construction : dès qu'une exemption demande une phrase
 * embarrassée, c'est que le fichier devrait déclencher la campagne.
 */
const INERT: Array<{ re: RegExp; why: string }> = [
  { re: /^src\/__tests__\//, why: "les tests n'entrent pas dans le bundle mesuré" },
  { re: /^CLAUDE\.md$/, why: "documentation interne, jamais rendue" },
  // Les six fichiers dans lesquels la narration de `CLAUDE.md` a été déplacée
  // au découpage : même nature, même raison. Ils sont lus par `doc:check`
  // (`docChecks.DOC_FILES`), jamais par le bundle.
  { re: /^docs\/.*\.md$/, why: "documentation interne, jamais rendue" },
  { re: /^README|^LICENSE|^SECURITY\.md$/, why: "documentation de dépôt" },
  // Le CNAME de la RACINE, à ne pas confondre avec `public/CNAME`, qui est
  // copié dans `dist/` et déclenche donc la campagne via `public/**`. Celui-ci
  // est le domaine que GitHub Pages lit ; il ne construit rien.
  { re: /^CNAME$/, why: "domaine GitHub Pages, hors de l'artefact construit" },
  { re: /^\.github\/workflows\/(?!browser\.yml|deploy\.yml)/, why: "les autres workflows ne construisent pas l'artefact mesuré" },
  { re: /^\.github\/(?!workflows\/)/, why: "configuration de dépôt (dependabot, modèles)" },
  { re: /^scripts\//, why: "outillage — les CINQ scripts qui portent les campagnes sont, eux, dans le filtre" },
  { re: /^eslint-rules\//, why: "règles de lint : elles échouent à la compilation, elles ne rendent rien" },
  { re: /^(eslint\.config\.js|tsconfig[^/]*\.json|knip\.json|vitest[^/]*|\.npmrc|\.gitignore|\.lighthouserc\.json)$/,
    why: "configuration d'outillage, hors chaîne de construction de dist/" },
];

function inertReason(file: string): string | null {
  for (const e of INERT) if (e.re.test(file)) return e.why;
  return null;
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean);

describe("le filtre par chemins des campagnes navigateur", () => {
  const pats = patterns();

  it("la liste est lisible et non vide (non-vacuité)", () => {
    // Sans ça, une ancre renommée ferait passer TOUT le balayage ci-dessous
    // pour cause de zéro motif — vert en n'ayant rien vérifié.
    expect(pats.length).toBeGreaterThanOrEqual(10);
    expect(pats).toContain("src/**");
    expect(pats).toContain("public/**");
  });

  it("le dépôt est lisible (non-vacuité)", () => {
    expect(tracked.length).toBeGreaterThan(300);
  });

  it("chaque fichier suivi déclenche la campagne OU porte une exemption", () => {
    const orphans = tracked.filter((f) => !triggers(f, pats) && !inertReason(f));
    expect(orphans,
      "ces fichiers ne déclencheraient PAS les campagnes et ne sont déclarés inertes nulle part — " +
      "soit les ajouter au filtre, soit inscrire la raison dans INERT")
      .toEqual([]);
  });

  it("aucune exemption n'est morte", () => {
    // Une exemption qui ne couvre plus rien est une licence dormante : elle ne
    // protège aucun fichier et blanchira le premier qui tombera dessus.
    const dead = INERT.filter((e) => !tracked.some((f) => e.re.test(f)));
    expect(dead.map((e) => String(e.re))).toEqual([]);
  });

  it("les cinq scripts qui PORTENT les campagnes déclenchent la campagne", () => {
    // L'exemption `^scripts/` est large ; ces quatre-là doivent en sortir, ou
    // un vérificateur élargi partirait sans jamais avoir été exercé — « le
    // câblage est ce qui pourrit », encore.
    for (const s of ["scripts/i18n-layout.cjs", "scripts/theme-contrast.cjs",
                     "scripts/parallelRun.cjs", "scripts/distFreshness.cjs",
                     // Le cinquième décide AU DÉPLOIEMENT de lancer la campagne et
                     // la découpe ; deploy.yml la porte. Les deux sont son câblage.
                     "scripts/browserScope.cjs", ".github/workflows/deploy.yml"]) {
      expect(triggers(s, pats), s + " ne déclenche pas les campagnes").toBe(true);
    }
  });

  it("un commit purement tests n'allume rien, un commit de vue si", () => {
    // Les deux sens de la décision, en une ligne chacun : sans le second, un
    // filtre qui n'attraperait plus rien passerait pour économe.
    expect(triggers("src/__tests__/curator/HomeViewV2.test.tsx", pats)).toBe(false);
    expect(triggers("src/views/curator/HomeViewV2.tsx", pats)).toBe(true);
    expect(triggers("src/hooks/useGdriveSync.ts", pats),
      "un hook peut écrire un statut que Réglages affiche — et Réglages est un écran de la matrice").toBe(true);
    expect(triggers("public/help.html", pats),
      "le guide EST un écran de la matrice").toBe(true);
  });

  it("ce workflow ne se déclenche PLUS sur push — c'est deploy.yml qui garde main", () => {
    // RENVERSEMENT, consigné sur l'assertion plutôt que réécrit en silence.
    // Ce cas exigeait `push:` en soutenant qu'« un filtre limité aux pull
    // requests ne se déclencherait presque jamais, la convention étant de
    // pousser directement sur main ». L'argument tenait, et il a été résolu
    // par l'autre bout : sur main les campagnes tournent DANS `deploy.yml`, où
    // elles retiennent l'artefact. Les garder ici aussi ferait tourner 864
    // rendus deux fois pour un seul commit.
    const code = wf.replace(/^\s*#[^\n]*$/gm, "");
    expect(code, "le déclencheur push est revenu : les campagnes tourneraient en double sur main")
      .not.toMatch(/^\s*push:\s*$/m);
    expect(wf).toMatch(/^\s*pull_request:\s*$/m);
    expect(wf).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });

  it("et deploy.yml porte bien les campagnes à la place", () => {
    // Sans ce cas, le retrait ci-dessus vaudrait suppression de la couverture :
    // vert en n'ayant plus rien qui mesure main.
    const dep = readFileSync(".github/workflows/deploy.yml", "utf8");
    expect(dep).toContain("npm run theme:contrast");
    expect(dep).toContain("npm run i18n:layout");
  });
});
