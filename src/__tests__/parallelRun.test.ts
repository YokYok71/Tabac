// LE FAN-OUT DES DEUX VÉRIFICATEURS NAVIGATEUR.
//
// Ces deux campagnes sont OPT-IN parce qu'elles coûtaient ~55 min et ~45 min,
// et l'opt-in est précisément ce qui a laissé `prune` au rouge pendant neuf
// versions : une porte que personne ne lance est de la documentation. Le coût
// déformait aussi le travail autour d'elles — valider un vérificateur ÉLARGI
// demandait une campagne entière, donc le geste honnête (mesurer) entrait en
// concurrence avec une heure d'attente.
//
// Mesuré après : la matrice de mise en page complète (864 rendus) passe de
// ~55 min à ~10, le contraste de ~45 min à ~2. Ce fichier épingle les trois
// propriétés sans lesquelles ce gain serait un mensonge.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const PAR = req("../../scripts/parallelRun.cjs");

/** Source d'un script, commentaires blanchis (longueur préservée). */
function strip(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const OPTS = {
  label: "x", script: "i18n-layout.cjs", envVar: "X_AXIS",
  shards: ["a", "b", "c"], portVar: "X_PORT", port: 9999, url: "http://localhost:9999/",
};

describe("un shard ne se re-divise jamais", () => {
  afterEach(() => { delete process.env[PAR.SHARD_ENV]; });

  it("rend false quand le marqueur de shard est posé", async () => {
    // LA GARDE PORTEUSE. Sans elle chaque enfant se re-divise, et six enfants
    // en engendrent trente-six : une bombe à fork qui se présente comme une
    // campagne un peu lente. Elle doit être testée en premier parce que la
    // brancher DANS le processus de test est le seul moyen de la vérifier sans
    // exécuter le chemin qui appelle process.exit.
    process.env[PAR.SHARD_ENV] = "1";
    expect(await PAR.maybeFanOut(OPTS),
      "un shard s'est re-divisé — chaque enfant en engendre N de plus").toBe(false);
  });

  it("rend false pour un axe déjà réduit à une valeur", async () => {
    // `-- --langs de` réduit `shards` à une entrée ; diviser en un seul enfant
    // ajouterait un processus et une redirection de sortie pour rien.
    expect(await PAR.maybeFanOut(Object.assign({}, OPTS, { shards: ["de"] }))).toBe(false);
    expect(await PAR.maybeFanOut(Object.assign({}, OPTS, { shards: [] }))).toBe(false);
  });
});

describe("le serveur d'aperçu est PARTAGÉ, pas dupliqué", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("adopte un serveur déjà en écoute au lieu d'en lancer un second", async () => {
    // C'est ce qui rend N shards possibles : chaque script lançait son propre
    // `vite preview --strictPort`, donc six shards auraient signifié cinq échecs
    // sur un port pris. Le parent en lance UN et chaque shard le trouve debout.
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    const r = await PAR.startPreview(9999, "http://localhost:9999/");
    expect(r.adopted, "un second serveur a été lancé sur un port déjà occupé").toBe(true);
    expect(r.failed).toBeFalsy();
    expect((globalThis.fetch as any).mock.calls.length,
      "la sonde n'a pas été faite").toBeGreaterThan(0);
  });

  it("le port du parent est transmis aux shards", () => {
    // Sans `portVar`, chaque enfant retomberait sur le port par défaut et
    // relancerait un serveur — l'adoption ci-dessus ne servirait à rien.
    const src = strip("scripts/parallelRun.cjs");
    expect(src, "le port n'est pas transmis à l'enfant").toMatch(/\[o\.portVar\]:\s*String\(o\.port\)/);
    expect(src, "le marqueur de shard n'est pas posé sur l'enfant")
      .toMatch(/\[SHARD_ENV\]:/);
  });
});

describe("les deux vérificateurs sont câblés sur le même mécanisme", () => {
  // Le manque-au-voisin est le défaut le plus répété de ce couple de scripts :
  // trois fois un axe ajouté d'un côté et jamais lu de l'autre. Un mécanisme
  // partagé ne vaut que s'il est branché des deux côtés.
  const FILES = ["scripts/i18n-layout.cjs", "scripts/theme-contrast.cjs"];

  it("chacun se divise et chacun adopte le serveur", () => {
    for (const f of FILES) {
      const src = strip(f);
      expect(src, f + " ne se divise pas").toMatch(/PAR\.maybeFanOut\(/);
      expect(src, f + " lance son propre serveur au lieu d'adopter celui du parent")
        .toMatch(/PAR\.startPreview\(/);
      expect(src, f + " lance encore un `vite preview` en direct")
        .not.toMatch(/spawn\([^)]*vite/);
    }
  });

  it("chacun se divise sur SON axe, et l'axe existe", () => {
    // Un shard doit nommer une chose — « de », « steel/dark » — pour qu'un
    // échec soit lisible ; un index ne dit rien et un round-robin sur la
    // matrice aplatie peut se tromper d'une combinaison sans que ça se voie.
    expect(strip("scripts/i18n-layout.cjs")).toMatch(/shards:\s*LANGS/);
    expect(strip("scripts/theme-contrast.cjs")).toMatch(/THEMES\.flatMap/);
  });

  it("la palette d'un shard PRIME sur les deux variables d'axe", () => {
    // Deux sources pour le même axe finissent toujours par se contredire —
    // la raison pour laquelle argv n'est pas transmis aux enfants non plus.
    const src = strip("scripts/theme-contrast.cjs");
    expect(src, "THEMES ne respecte pas la palette du shard")
      .toMatch(/PALETTE\[0\]\s*\?\s*\[PALETTE\[0\]\]/);
    expect(src, "MODES ne respecte pas la palette du shard")
      .toMatch(/PALETTE\[1\]\s*\?\s*\[PALETTE\[1\]\]/);
  });

  it("un shard rouge reste rouge", () => {
    // La seule propriété qui compte pour une PORTE : agréger six sorties ne
    // doit pas noyer un échec. Sans ce `exit(1)` la campagne parallèle
    // rapporterait vert quoi qu'il arrive, ce qui est pire que pas de campagne.
    const src = strip("scripts/parallelRun.cjs");
    expect(src).toMatch(/bad\.length[\s\S]{0,400}process\.exit\(1\)/);
  });
});
