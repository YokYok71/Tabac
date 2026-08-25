// TROIS VÉRIFICATEURS MESURENT `dist/`, ET UN SEUL VÉRIFIAIT QU'IL EST À JOUR.
//
// `size:check`, `i18n:layout` et `theme:contrast` jugent tous l'application
// CONSTRUITE. Seul le premier avait appris — à ses dépens — que l'existence de
// `dist/index.html` ne suffit pas : lancer la vérification après avoir édité une
// source rend un verdict confiant sur le bundle PRÉCÉDENT.
//
// Ce n'est pas hypothétique, et la démonstration s'est faite sur moi : deux
// campagnes `theme:contrast` complètes ont mesuré un bundle vieux d'une heure,
// vertes de bout en bout. C'est ce qui a fait passer un compte stable de 2566
// éléments à 2565 après une reconstruction, sans le moindre changement de
// source entre les deux. **Une vérification qui porte sur le mauvais artefact
// ressemble exactement à une vérification qui porte sur le bon.**

import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const FRESH = req("../../scripts/distFreshness.cjs");

function strip(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** Un faux dépôt : un index bâti à `builtAt`, des sources datées à volonté. */
function fixture(files: Record<string, number>, builtAt: number) {
  const root = mkdtempSync(join(tmpdir(), "fresh-"));
  const src = join(root, "src");
  mkdirSync(join(src, "__tests__"), { recursive: true });
  const index = join(root, "index.html");
  writeFileSync(index, "x");
  utimesSync(index, builtAt / 1000, builtAt / 1000);
  for (const [rel, when] of Object.entries(files)) {
    const full = join(src, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "y");
    utimesSync(full, when / 1000, when / 1000);
  }
  return { root, src, index };
}

const T0 = 1_700_000_000_000;

describe("un dist plus vieux que les sources est refusé", () => {
  it("une source plus récente que le build est signalée", () => {
    const f = fixture({ "App.tsx": T0 + 60_000 }, T0);
    expect(FRESH.staleSources(f.src, f.index).length).toBe(1);
  });

  it("un build plus récent que tout est accepté", () => {
    const f = fixture({ "App.tsx": T0 - 60_000, "utils.ts": T0 - 10 }, T0);
    expect(FRESH.staleSources(f.src, f.index)).toEqual([]);
  });

  it("les TESTS ne rendent jamais le bundle périmé", () => {
    // Ils n'entrent pas dans le bundle, donc les compter ferait échouer la
    // porte sur chaque commit purement test — une garde qu'on apprendrait à
    // contourner, ce que ce dépôt a déjà payé ailleurs.
    const f = fixture({ "__tests__/a.test.ts": T0 + 60_000 }, T0);
    expect(FRESH.staleSources(f.src, f.index)).toEqual([]);
  });

  it("une panne de système de fichiers est tolérée, une garde cassée ne l'est pas", () => {
    // La distinction est la leçon d'origine : un `catch` qui avale tout a déjà
    // fait rapporter OK sur un bundle périmé, parce qu'une garde qui ne fait
    // rien en silence se lit comme « vérifié ».
    expect(FRESH.staleSources("/n/existe/pas", "/n/existe/pas/index.html")).toEqual([]);
    expect(() => FRESH.staleSources(null as any, null as any)).toThrow();
  });

  it("le message dit quoi faire et ne porte PAS de nom de vérificateur", () => {
    // Deux des trois appelants passent par un `die()` qui préfixe déjà, d'où le
    // « theme:contrast — theme:contrast: … » observé avant correction.
    const m = FRESH.staleMessage(["/r/src/App.tsx"], "/r");
    expect(m).toContain("npm run build");
    expect(m).toContain("src/App.tsx");
    expect(m).not.toMatch(/theme:contrast|i18n:layout|check-bundle-size/);
  });
});

describe("les TROIS vérificateurs appliquent la règle", () => {
  // Ce qui pourrit ici n'est pas la règle mais le nombre de consommateurs : elle
  // a vécu un an dans un seul des trois. Un quatrième vérificateur qui mesure
  // `dist/` doit passer par le même module.
  const FILES = [
    "scripts/check-bundle-size.cjs",
    "scripts/i18n-layout.cjs",
    "scripts/theme-contrast.cjs",
  ];

  it("chacun consulte staleSources et s'arrête", () => {
    for (const f of FILES) {
      const src = strip(f);
      expect(src, f + " ne vérifie pas la fraîcheur de dist/")
        .toMatch(/FRESH\.staleSources\(/);
      expect(src, f + " détecte un dist périmé et continue quand même")
        .toMatch(/staleSrc\.length|stale\.length/);
    }
  });

  it("aucun n'a gardé une copie locale de la règle", () => {
    // Une deuxième implémentation est la dérive que ce dépôt paie en boucle :
    // elle part juste, puis l'une des deux est corrigée et pas l'autre.
    for (const f of FILES) {
      expect(strip(f), f + " re-implémente le parcours au lieu de l'importer")
        .not.toMatch(/mtimeMs\s*>\s*builtAt/);
    }
  });
});
