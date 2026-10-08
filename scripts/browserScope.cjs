"use strict";
/**
 * FAUT-IL MESURER CE DÉPLOIEMENT DANS UN NAVIGATEUR ? ET EN COMBIEN DE MORCEAUX ?
 *
 * Deux questions que `deploy.yml` pose à chaque push sur main, et qu'il ne doit
 * pas trancher à la main.
 *
 * 1. LA PORTÉE. Les deux campagnes (`i18n:layout`, `theme:contrast`) ne peuvent
 *    rien trouver sur un commit qui ne touche aucun fichier capable de changer un
 *    pixel — un commit de `.md`, de tests, d'outillage. Le filtre existait déjà,
 *    pour les pull requests (`browser.yml`), et il avait été REFUSÉ au
 *    déploiement pour une raison exacte : diffé contre `github.event.before`, il
 *    a un trou, parce que `cancel-in-progress` annule les runs intermédiaires —
 *    une vue poussée puis de la documentation poussée aussitôt, et le run
 *    survivant ne voit que la documentation. La vue partirait non mesurée.
 *
 *    LA BASE ICI N'EST PAS LE PUSH PRÉCÉDENT, C'EST LE DERNIER COMMIT DÉPLOYÉ
 *    AVEC SUCCÈS. Un run annulé n'a rien déployé, donc ses fichiers restent dans
 *    le diff du suivant. Par récurrence, chaque commit en ligne a été mesuré, ou
 *    ne diffère du dernier commit mesuré que par des fichiers qui ne rendent
 *    rien. Le trou est fermé à sa source plutôt que contourné.
 *
 *    FAIL-CLOSED, SANS EXCEPTION : pas de base, base illisible, diff impossible,
 *    déclenchement manuel → on mesure. Une porte qui saute par erreur est la
 *    panne que ce dépôt a payée le plus cher ; une porte qui tourne pour rien
 *    coûte quelques minutes.
 *
 *    LA LISTE DES CHEMINS N'EST PAS RECOPIÉE : elle est lue dans `browser.yml`
 *    (ancre `&browser_paths`), que `browserPathFilter.test.ts` garde déjà contre
 *    la dérive. Une seule liste, deux usages.
 *
 * 2. LE DÉCOUPAGE. La mise en page tournait en un job, six langues sur 4 vCPU,
 *    5 min 28 à elle seule. Un job PAR LANGUE les fait tourner côte à côte.
 *    Les langues sont lues dans le registre (`registryLangs()` de
 *    `i18n-layout.cjs`, qui lit `src/i18n/languages.ts` — et non `LANGS`, que
 *    `--langs` ou I18N_LAYOUT_LANGS rétrécissent), JAMAIS écrites dans le workflow :
 *    une matrice littérale est exactement la liste figée qui a fait sauter le
 *    portugais au vérificateur pendant des semaines. L'union des morceaux est
 *    la matrice complète par construction, et le test le vérifie.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BROWSER_WF = ".github/workflows/browser.yml";

/** Les motifs `paths:` de `browser.yml`, lus dans le fichier (pas de YAML en dépendance). */
function patterns(wfText) {
  const start = wfText.indexOf("paths: &browser_paths");
  if (start < 0) throw new Error("browserScope: l'ancre `&browser_paths` a disparu de " + BROWSER_WF);
  const rest = wfText.slice(start);
  const end = rest.indexOf("\n  workflow_dispatch:");
  if (end < 0) throw new Error("browserScope: la liste de motifs n'est pas suivie de workflow_dispatch");
  const pats = (rest.slice(0, end).match(/^\s*- "([^"]+)"/gm) || [])
    .map((l) => (l.match(/"([^"]+)"/) || [])[1])
    .filter(Boolean);
  if (!pats.length) throw new Error("browserScope: aucun motif lu dans " + BROWSER_WF);
  return pats;
}

/**
 * Un chemin littéral, ou un préfixe suivi de `**`, éventuellement nié par `!`.
 * Une forme plus riche LÈVE au lieu d'être ignorée — sinon une syntaxe ajoutée
 * plus tard rendrait le filtre silencieusement plus étroit.
 */
function matches(pattern, file) {
  const p = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (p.endsWith("/**")) return file.startsWith(p.slice(0, -2));
  if (!p.includes("*")) return file === p;
  throw new Error("browserScope: motif non reconnu : " + pattern);
}

/** Le dernier motif qui correspond décide, comme dans le filtre de GitHub. */
function triggers(file, pats) {
  let on = false;
  for (const p of pats) {
    if (!matches(p, file)) continue;
    on = !p.startsWith("!");
  }
  return on;
}

/** Les morceaux de la campagne : le contraste entier, puis une langue par job. */
function shards(langs) {
  if (!Array.isArray(langs) || !langs.length) throw new Error("browserScope: aucune langue dans le registre");
  return [{ name: "Contrast — all palettes", check: "theme:contrast", langs: "" }]
    .concat(langs.map((l) => ({ name: "Layout — " + l, check: "i18n:layout", langs: l })));
}

/**
 * La décision, pure : `base` est le dernier commit déployé (ou vide), `changed`
 * la liste des fichiers modifiés depuis (ou null si le diff a échoué).
 */
function decide({ event, base, changed, pats }) {
  if (event !== "push") return { browser: true, why: "déclenchement « " + event + " » : campagne complète" };
  if (!base) return { browser: true, why: "aucun déploiement réussi trouvé : campagne complète" };
  if (!Array.isArray(changed)) return { browser: true, why: "diff contre " + base.slice(0, 7) + " impossible : campagne complète" };
  const hits = changed.filter((f) => triggers(f, pats));
  if (hits.length) {
    return { browser: true, why: hits.length + " fichier(s) rendus depuis " + base.slice(0, 7) + ", dont " + hits.slice(0, 3).join(", ") };
  }
  return { browser: false, why: changed.length + " fichier(s) depuis " + base.slice(0, 7) + ", aucun ne change un pixel rendu" };
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME || "";
  const base = (process.env.BROWSER_SCOPE_BASE || "").trim();
  let changed = null;
  if (base) {
    try {
      changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").map((s) => s.trim()).filter(Boolean);
    } catch (_e) { changed = null; }
  }
  const pats = patterns(fs.readFileSync(path.join(ROOT, BROWSER_WF), "utf8"));
  const d = decide({ event, base, changed, pats });
  const list = shards(require("./i18n-layout.cjs").registryLangs());
  console.log("browserScope: " + (d.browser ? "MESURER" : "sauter") + " — " + d.why);
  console.log("browserScope: " + list.length + " morceau(x) : " + list.map((s) => s.name).join(" · "));
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    fs.appendFileSync(out, "browser=" + (d.browser ? "true" : "false") + "\n");
    fs.appendFileSync(out, "shards=" + JSON.stringify(list) + "\n");
  }
}

module.exports = { patterns, matches, triggers, shards, decide };

if (require.main === module) main();
