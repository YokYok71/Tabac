/**
 * UNE LICENCE MORTE EST PIRE QU'UNE ABSENCE DE LICENCE.
 *
 * `doc-check.allowlist.json` déclare des PRÉFIXES de clés i18n construites
 * dynamiquement (`t(prefix + v)`, une table `labelKey`, un accès `L.<clé>`).
 * Ces clés sont invisibles à l'extraction, qui ne voit qu'un `t("…")` littéral,
 * donc sans le préfixe elles apparaîtraient toutes comme « jamais appelée » et
 * noieraient le signal — c'est pour ça que les préfixes existent.
 *
 * MAIS UN PRÉFIXE QUI NE SUPPRIME PLUS RIEN N'EST PAS INOFFENSIF : il blanchit
 * d'avance la PREMIÈRE clé de sa famille qui deviendra morte. C'est exactement
 * comme ça que `bak_word_other` a survécu — orpheline depuis le premier commit
 * public, dans les six langues, ré-vérifiée par la porte de parité à chaque
 * commit, et jamais signalée parce qu'un préfixe la couvrait.
 *
 * MESURÉ, un préfixe à la fois, contre les vraies sources : sur 27 déclarés,
 * TROIS ne supprimaient rien (`bak_word_`, `home_mat_`, `warn_storage_`), et ils
 * ont été retirés. Ce fichier empêche les suivants de s'installer.
 *
 * ET IL CORRIGE UNE ERREUR QUI A FAILLI PASSER. Un rapport d'agent affirmait que
 * la famille `tasting_err_` était entièrement littérale et que son préfixe était
 * donc inutile. La mesure dit l'inverse : ses deux clés passent par `tr(lang,
 * "…")`, un helper LOCAL que l'extraction — qui matche `t("…")` — ne voit pas.
 * Le préfixe est nécessaire. **On ne retire pas un préfixe sur une lecture, on
 * le retire sur une mesure.**
 *
 * La règle est donc la même que celle de `storageBlockedBoot.test.ts` pour sa
 * liste de fichiers exemptés : une exemption doit nommer quelque chose qui
 * existe ET qui a encore besoin d'elle.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const docChecks = require("../../scripts/docChecks.cjs");
const allowlist = JSON.parse(readFileSync("scripts/doc-check.allowlist.json", "utf8"));

/** Toutes les sources de PRODUCTION, dans le même périmètre que doc-check :
 *  hors tests, hors les dictionnaires eux-mêmes et hors le registre i18n. */
function productionSources(): string[] {
  const out: string[] = [];
  const skip = new Set(["src/i18n.ts", "src/i18n/languages.ts"]);
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/\.test\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (skip.has(p) || p.startsWith("src/i18n/")) continue;
      out.push(p);
    }
  }
  walk("src");
  return out;
}

/** Les clés que l'extraction voit réellement — LA MÊME que celle de la porte.
 *  La réécrire ici ferait de ce test une seconde source de vérité, c'est-à-dire
 *  la dérive que ce dépôt paie en boucle. */
function literallyCalledKeys(): Set<string> {
  const srcs = productionSources().map((f) => readFileSync(f, "utf8"));
  return new Set<string>(docChecks.extractTKeys(srcs));
}

/** Les clés du dictionnaire de référence. */
function referenceKeys(): string[] {
  const fr = readFileSync("src/i18n/fr.ts", "utf8");
  return [...fr.matchAll(/^\s*([a-zA-Z0-9_]+):"/gm)].map((m) => m[1] as string);
}

describe("les préfixes dynamiques de doc-check sont tous encore utiles", () => {
  const prefixes: string[] = allowlist.dynamicKeyPrefixes || [];
  const keys = referenceKeys();
  const called = literallyCalledKeys();

  it("NON-VACUITÉ : la liste et l'extraction rendent quelque chose", () => {
    // Sans cette garde, une allowlist vide ou une extraction cassée rendrait
    // tous les cas ci-dessous verts en n'examinant rien.
    expect(prefixes.length, "aucun préfixe déclaré").toBeGreaterThan(10);
    expect(keys.length, "dictionnaire de référence illisible").toBeGreaterThan(500);
    expect(called.size, "extraction cassée").toBeGreaterThan(200);
  });

  it("chaque préfixe nomme une famille qui EXISTE", () => {
    // Un préfixe sans une seule clé est une licence pour un nom qui n'est plus
    // employé nulle part : elle blanchirait la première clé future à s'y coller.
    const orphelins = prefixes.filter((p) => !keys.some((k) => k.startsWith(p)));
    expect(orphelins, "préfixe(s) ne couvrant aucune clé du dictionnaire").toEqual([]);
  });

  it("…et chaque préfixe SUPPRIME encore au moins un avertissement", () => {
    // La vraie règle. Un préfixe dont toutes les clés sont appelées
    // littéralement ne cache rien aujourd'hui — et cachera la première qui
    // meurt demain. Retire-le : la porte redeviendra bavarde au bon moment.
    const inertes = prefixes.filter((p) => {
      const fam = keys.filter((k) => k.startsWith(p));
      return fam.length > 0 && fam.every((k) => called.has(k));
    });
    expect(
      inertes,
      "préfixe(s) devenus inertes — toutes leurs clés sont appelées littéralement, " +
      "donc ils ne blanchissent plus qu'un futur orphelin. Retire-les de " +
      "scripts/doc-check.allowlist.json.",
    ).toEqual([]);
  });

  it("les clés dynamiques nommées une par une existent aussi", () => {
    // Même règle sur l'autre moitié de l'allowlist.
    const nommees: string[] = allowlist.dynamicKeys || [];
    const absentes = nommees.filter((k) => !keys.includes(k));
    expect(absentes, "clé(s) allowlistée(s) qui n'existent plus").toEqual([]);
  });
});
