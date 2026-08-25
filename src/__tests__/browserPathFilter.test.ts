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

const WF = ".github/workflows/browser.yml";
const wf = readFileSync(WF, "utf8");

/**
 * Les motifs `paths:` du workflow, lus dans le fichier.
 *
 * Aucun analyseur YAML n'est dépendance de ce dépôt, et en ajouter un pour ces
 * quinze lignes serait signalé par knip. Les motifs sont donc extraits de la
 * liste `&browser_paths` par lecture directe — les entrées sont toutes de la
 * forme `- "…"`, et l'ancre est réutilisée par `pull_request` via `*`, donc
 * la liste n'existe QU'UNE fois dans le fichier.
 */
function patterns(): string[] {
  const start = wf.indexOf("paths: &browser_paths");
  expect(start, "l'ancre `&browser_paths` a disparu du workflow").toBeGreaterThan(-1);
  const rest = wf.slice(start);
  const end = rest.indexOf("\n  pull_request:");
  expect(end, "la liste de motifs n'est pas suivie de pull_request").toBeGreaterThan(-1);
  return (rest.slice(0, end).match(/^\s*- "([^"]+)"/gm) || [])
    .map((l) => (l.match(/"([^"]+)"/) || [])[1]!)
    .filter(Boolean);
}

/**
 * Les motifs GitHub, réduits à ce que ce filtre utilise réellement : un chemin
 * littéral, ou un préfixe suivi de `**`. Un `!` en tête est une EXCLUSION.
 *
 * Volontairement pauvre : reproduire toute la syntaxe de filtrage de GitHub
 * serait écrire un second moteur qu'on ne pourrait pas vérifier. Un motif d'une
 * forme non reconnue fait échouer le test plutôt que d'être ignoré — sans quoi
 * une syntaxe plus riche introduite plus tard rendrait ce garde silencieux.
 */
function matches(pattern: string, file: string): boolean {
  const p = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (p.endsWith("/**")) return file.startsWith(p.slice(0, -2));
  if (!p.includes("*")) return file === p;
  throw new Error("motif non reconnu par ce test : " + pattern);
}

/** Le filtre déclenche-t-il la campagne pour ce fichier ? */
function triggers(file: string, pats: string[]): boolean {
  let on = false;
  for (const p of pats) {
    if (!matches(p, file)) continue;
    on = !p.startsWith("!");
  }
  return on;
}

/**
 * CE QUI NE PEUT PAS CHANGER UN PIXEL — chaque entrée est une décision, pas une
 * commodité. Court par construction : dès qu'une exemption demande une phrase
 * embarrassée, c'est que le fichier devrait déclencher la campagne.
 */
const INERT: Array<{ re: RegExp; why: string }> = [
  { re: /^src\/__tests__\//, why: "les tests n'entrent pas dans le bundle mesuré" },
  { re: /^CLAUDE\.md$/, why: "documentation interne, jamais rendue" },
  { re: /^README|^LICENSE|^SECURITY\.md$/, why: "documentation de dépôt" },
  // Le CNAME de la RACINE, à ne pas confondre avec `public/CNAME`, qui est
  // copié dans `dist/` et déclenche donc la campagne via `public/**`. Celui-ci
  // est le domaine que GitHub Pages lit ; il ne construit rien.
  { re: /^CNAME$/, why: "domaine GitHub Pages, hors de l'artefact construit" },
  { re: /^\.github\/workflows\/(?!browser\.yml)/, why: "les autres workflows ne construisent pas l'artefact mesuré" },
  { re: /^\.github\/(?!workflows\/)/, why: "configuration de dépôt (dependabot, modèles)" },
  { re: /^scripts\//, why: "outillage — les QUATRE scripts qui portent les campagnes sont, eux, dans le filtre" },
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

  it("les quatre scripts qui PORTENT les campagnes déclenchent la campagne", () => {
    // L'exemption `^scripts/` est large ; ces quatre-là doivent en sortir, ou
    // un vérificateur élargi partirait sans jamais avoir été exercé — « le
    // câblage est ce qui pourrit », encore.
    for (const s of ["scripts/i18n-layout.cjs", "scripts/theme-contrast.cjs",
                     "scripts/parallelRun.cjs", "scripts/distFreshness.cjs"]) {
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

  it("le workflow garde ses deux déclencheurs et son rattrapage manuel", () => {
    // La convention ici est de pousser directement sur main, donc un filtre
    // limité aux pull requests ne se déclencherait presque jamais. Et
    // `workflow_dispatch` est la sortie de secours quand on veut la matrice
    // complète sur un commit que le filtre a ignoré.
    expect(wf).toMatch(/^\s*push:\s*$/m);
    expect(wf).toMatch(/^\s*pull_request:\s*$/m);
    expect(wf).toMatch(/^\s*workflow_dispatch:\s*$/m);
    // `pull_request` réutilise l'ANCRE : deux listes recopiées dériveraient.
    expect(wf).toContain("paths: *browser_paths");
  });
});
