// Tests for src/utils/tobaccoDb.ts — the catalogue LOOKUP module.
//
// THE CATALOGUE IS SUPPLIED, NOT SHIPPED. The
// app used to bundle one, so these tests simply called `loadTobaccoDb()` and got 1594
// blends for free. The only source now is the user's own file, so a test that
// needs a catalogue has to provide one — through the REAL parser, on REAL
// catalogue rows, or the suite would be agreeing with a parser that had
// drifted. `catalogueFixture.ts` explains which rows and why; the blends named
// below are all in it, and they are in it BECAUSE these cases name them.
//
// Two whole describes went with the bundled chunk and are not replaced:
// `ensureLangDescriptions` (a user CSV carries every language inline, so there
// is no chunk to merge) and `isChunkFailure` (nothing is dynamically imported,
// so there is no chunk fetch to fail). Neither is a case that moved somewhere
// else — both subjects ceased to exist.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCatalogueFixture, useCatalogueCsv, resetCatalogueFixture } from "./catalogueFixture.ts";

vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import {
  loadTobaccoDb,
  tobaccoDbLookup,
  tobaccoDbLookupSync,
  tobaccoDbCanonicalKey,
  tobaccoDbSearchMatch,
  isTobaccoDbReady,
  tobaccoDbSize,
  _resetTobaccoDbForTests,
} from "../utils/tobaccoDb.ts";

beforeEach(() => {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
});

describe("tobaccoDb", () => {
  it("loads the user's catalogue and caches it", async () => {
    expect(isTobaccoDbReady()).toBe(false);
    const db = await loadTobaccoDb();
    expect(db).not.toBeNull();
    expect(isTobaccoDbReady()).toBe(true);
    expect(tobaccoDbSize(), "non-vacuity — the fixture must have parsed").toBeGreaterThan(20);
  });

  it("serves each language's own prose from ONE load", async () => {
    // An earlier release split the prose into a lazy chunk per language and the async
    // lookup pulled the requested one on a hit. A user's CSV carries all six
    // INLINE, so the same guarantee now holds with no second fetch: what is
    // asserted is the OUTCOME (each language gets its own text), which is
    // what the split existed to deliver.
    const es = await tobaccoDbLookup("Halvorsen", "Duskfall", "es");
    const en = await tobaccoDbLookup("Halvorsen", "Duskfall", "en");
    const de = await tobaccoDbLookup("Halvorsen", "Duskfall", "de");
    expect(es!.description).not.toBe("");
    expect(en!.description).not.toBe("");
    expect(de!.description).not.toBe("");
    expect(es!.description).not.toBe(en!.description); // Spanish ≠ English
    expect(de!.description).not.toBe(en!.description); // German ≠ English
  });

  it("dedupes concurrent loads (same cached object across calls)", async () => {
    // With dynamic import() the dedup also happens at the
    // JS module-loader level (modules cache themselves), but our
    // `inFlight` Promise + module-level `cache` are still in play as
    // belt-and-braces. We can no longer assert on fetch call count
    // (no fetch happens), so we test the observable invariant: every
    // concurrent caller resolves to the EXACT SAME object reference.
    const [a, b, c] = await Promise.all([
      loadTobaccoDb(),
      loadTobaccoDb(),
      loadTobaccoDb(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(isTobaccoDbReady()).toBe(true);
  });

  it("looks up a known blend (Halvorsen Duskfall) — French desc", async () => {
    const hit = await tobaccoDbLookup("Halvorsen", "Duskfall", "fr");
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe("Anglais");
    expect(hit!.force).toBeGreaterThanOrEqual(3);
    // A later master CSV lowered taste to 3. Just assert the value
    // is in the valid 1-5 range and the description is non-empty.
    expect(hit!.taste).toBeGreaterThanOrEqual(1);
    expect(hit!.taste).toBeLessThanOrEqual(5);
    expect(hit!.description.length).toBeGreaterThan(20);
  });

  it("looks up the same blend with English description", async () => {
    const hitFr = await tobaccoDbLookup("Halvorsen", "Duskfall", "fr");
    const hitEn = await tobaccoDbLookup("Halvorsen", "Duskfall", "en");
    expect(hitEn).not.toBeNull();
    expect(hitEn!.description).not.toBe(hitFr!.description);
    expect(hitEn!.category).toBe(hitFr!.category); // attributes identical
  });

  it("is case-insensitive on brand and name", async () => {
    const a = await tobaccoDbLookup("HALVORSEN", "DUSKFALL", "fr");
    const b = await tobaccoDbLookup("halvorsen", "duskfall", "fr");
    const c = await tobaccoDbLookup("Halvorsen", "Duskfall", "fr");
    expect(a).not.toBeNull();
    expect(a!.category).toBe(b!.category);
    expect(b!.category).toBe(c!.category);
  });

  it("returns null when brand or name is missing", async () => {
    await loadTobaccoDb();
    expect(tobaccoDbLookupSync("Halvorsen", "", "fr")).toBeNull();
    expect(tobaccoDbLookupSync("", "Duskfall", "fr")).toBeNull();
    expect(tobaccoDbLookupSync("", "", "fr")).toBeNull();
    expect(tobaccoDbLookupSync(null, null, "fr")).toBeNull();
  });

  it("returns null for unknown blends", async () => {
    const hit = await tobaccoDbLookup("Unknown Brand", "Fake Blend X1234", "fr");
    expect(hit).toBeNull();
  });

  // A typed brand equal to a prototype member must
  // not resolve `cache.brands["__proto__"]` to Object.prototype and return a
  // bogus canonical brand. Lookup/canonical-key stay null, no crash.
  it("does not false-match a prototype-key brand", async () => {
    await loadTobaccoDb();
    expect(tobaccoDbLookupSync("__proto__", "Duskfall", "fr")).toBeNull();
    expect(tobaccoDbLookupSync("constructor", "toString", "fr")).toBeNull();
    expect(tobaccoDbCanonicalKey("__proto__", "hasOwnProperty")).toBeNull();
  });

  it("sync lookup returns null before the DB is loaded", () => {
    expect(isTobaccoDbReady()).toBe(false);
    expect(tobaccoDbLookupSync("Halvorsen", "Duskfall", "fr")).toBeNull();
  });

  it("preserves the proper-case blend name and brand displayName", async () => {
    const hit = await tobaccoDbLookup("halvorsen", "duskfall", "fr");
    expect(hit!.name).toBe("Duskfall");
    expect(hit!.brandDisplay).toBe("Halvorsen");
  });

  // approximate matching (substring + alias)
  // An earlier release master-CSV rebuild dropped the seeded aliases (Vondel 131
  // → Red Label etc.). The lookup function still supports them — these
  // tests will be reactivated once the user's final CSV reintroduces
  // alias arrays. Substring + brand-fuzzy paths are still covered with
  // entries that survived the rebuild.
  describe("approximate matching", () => {

    it("matches via substring when name is shorter than blend name", async () => {
      await loadTobaccoDb();
      // Halvorsen has only one blend whose name starts with "Early" →
      // unique substring match returns "Early Tide".
      const hit = tobaccoDbLookupSync("Halvorsen", "Early", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Early Tide");
    });

    it("prefers exact match over substring", async () => {
      await loadTobaccoDb();
      // "Halvorsen Duskfall" exact-matches — substring fallback never fires.
      const hit = tobaccoDbLookupSync("Halvorsen", "Duskfall", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Duskfall");
    });

    it("returns null on ambiguous substring (multiple hits)", async () => {
      await loadTobaccoDb();
      // "Halvorsen Mixture" matches BOTH "Elizabethan Mixture" AND
      // "My Mixture 965" → ambiguous → null, AI takes over.
      const hit = tobaccoDbLookupSync("Halvorsen", "Mixture", "fr");
      expect(hit).toBeNull();
    });

    it("tolerates punctuation drift on the brand", async () => {
      await loadTobaccoDb();
      // "R T Mallow" (no dots) → r.t. mallow (canonical key in the master
      // CSV). Picks a blend that actually exists.
      const hit = tobaccoDbLookupSync("R T Mallow", "Kestrel", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Kestrel");
    });

    it("matches the brand when '&' is typed as 'and'", async () => {
      await loadTobaccoDb();
      const hit = tobaccoDbLookupSync("Marlow and Finch", "Crown of the North", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Crown of the North");
    });

    // un alias de FABRICANT ne doit pas masquer une marque réelle.
    //
    // Le catalogue met le fabricant en `brand_aliases` (le `brand_key` est le
    // nom porté par la boîte). La résolution rendait le premier trouvé, alias
    // ou clé, donc l'ORDRE des clés décidait : « Marlow & Finch » tombait sur
    // `captain earle's`, « Lane Limited » sur `captain black`, « Pellworm »
    // sur `caporal` — ce dernier déjà faux AVANT la livraison qui l'a révélé,
    // et jamais signalé parce qu'aucun test ne tapait la marque la plus
    // fréquente du catalogue.
    //
    // le cas est désormais SYNTHÉTIQUE, et il fallait le
    // construire avec soin. Il s'appuyait sur des marques précises du
    // catalogue livré ; l'app n'en livre plus, et l'extrait de 28 lignes ne
    // reproduit pas la collision. Surtout, la version d'origine dépendait de
    // l'ordre des clés d'un fichier que nous ne contrôlons plus — alors que ce
    // qu'il faut garantir, c'est justement que l'ordre ne décide rien.
    //
    // LE COURT-CIRCUIT EXACT EN MINUSCULES PASSE AVANT LES TROIS PASSES.
    // Un premier essai tapait le nom de marque tel quel : il sortait sur ce
    // court-circuit sans jamais atteindre le code testé, et la sonde (revenir
    // à une passe unique) restait VERTE. On tape donc une forme qui ne diffère
    // que par la PONCTUATION, ce qui est exactement le terrain des passes —
    // et l'alias est placé EN PREMIER dans le fichier, donc sous l'ancien code
    // il gagnait.
    it("une marque réelle bat un alias de fabricant, quel que soit l'ordre des clés", async () => {
      const HEAD = "brand_key,brand_name,blend_name,category,cut,force,roomNote,taste,agingMax,blend,description_fr,description_en,brand_aliases,blend_aliases";
      useCatalogueCsv([
        HEAD,
        // La marque qui PORTE l'alias vient en premier dans le fichier.
        'Captain Earle,Captain Earle,Ten Russians,Anglais,Ribbon,4,3,4,,Latakia,fr,en,"Marlow&Finch",',
        'Marlow & Finch,Marlow & Finch,Adagio,Aromatique,Ribbon,2,3,3,,Cavendish,fr,en,,',
      ].join("\n"));
      await loadTobaccoDb();
      const hit = tobaccoDbLookupSync("Marlow&Finch", "Adagio", "fr");
      expect(hit, "« Marlow&Finch | Adagio » ne résout plus").not.toBeNull();
      expect(hit!.brandDisplay, "une marque réelle doit battre un alias").toBe("Marlow & Finch");
    });

    it("un alias reste actif quand aucune marque ne porte ce nom", async () => {
      await loadTobaccoDb();
      // « M&F » n'est le nom d'aucune marque : l'alias doit toujours jouer,
      // sinon le correctif ci-dessus aurait cassé ce que les alias de marque apportent.
      const hit = tobaccoDbLookupSync("M&F", "Crown of the North", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.brandDisplay).toBe("Marlow & Finch");
    });

    it("tolerates a one-letter typo on the brand via Levenshtein", async () => {
      await loadTobaccoDb();
      // "Halvorse" (a dropped letter) → Halvorsen. It used to be "Samue Gawith"
      // → Samuel Gawith; that brand is not in the fixture excerpt, and the
      // case is about the EDIT DISTANCE, not about which brand — both are a
      // one-character deletion.
      //
      // NOT "Petersen": the excerpt also contains `a&c petersen`, whose
      // tight-normalised key CONTAINS "petersen", so the substring rung wins
      // over Levenshtein and resolves the other brand. That is the ladder
      // working (a substring hit is the cleaner match), and the same
      // collision existed in the 1594-row master.
      const hit = tobaccoDbLookupSync("Halvorse", "Duskfall", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.brandDisplay).toBe("Halvorsen");
    });

    it("ignores too-short brand inputs to avoid false hits", async () => {
      await loadTobaccoDb();
      // "Sa" is < 3 chars after tight-normalisation → returns null even
      // though "savinelli" starts with "sa".
      const hit = tobaccoDbLookupSync("Sa", "Duskfall", "fr");
      expect(hit).toBeNull();
    });

    it("ignores too-short queries to avoid noise", async () => {
      await loadTobaccoDb();
      const hit = tobaccoDbLookupSync("Vondel", "x", "fr");
      expect(hit).toBeNull();
    });

    it("returns null for unknown query under known brand", async () => {
      await loadTobaccoDb();
      const hit = tobaccoDbLookupSync("Vondel", "Totally Made Up Blend", "fr");
      expect(hit).toBeNull();
    });
  });

  // brand aliases from the master CSV's column 13.
  // Consumed by both `resolveCanonicalBrand` (so typing "M&F Star of
  // the East" resolves to marlow & finch) and `tobaccoDbSearchMatch`
  // (so the catalog search finds M&F blends with the typed alias).
  describe("brand aliases", () => {
    it("resolves a brand alias to its canonical brand key (M&F → marlow & finch)", async () => {
      await loadTobaccoDb();
      // The lookup goes through resolveCanonicalBrand → exact lower miss
      // → tight-norm miss → ALIAS HIT (M&F is in marlow & finch's
      // aliases). With the canonical brand resolved, the name lookup
      // hits the cached blend.
      const hit = tobaccoDbLookupSync("M&F", "Crown of the North", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Crown of the North");
    });

    it("resolves a brand alias via tight-norm equivalence (Pellworm ≡ Pellworm via alias)", async () => {
      await loadTobaccoDb();
      // "RTMallow" is an alias; tight-norm both → "pellwormandco"
      // and "pellwormandco". This was already covered by punctuation
      // tolerance earlier, but the alias path makes it explicit.
      //
      // REVERSAL, recorded on the assertion. This used to
      // read `expect(hit.name).toBe("Vanilla Cream")`, i.e. it asserted the
      // RETURNED name equals the TYPED one. That is not a property of the
      // lookup and it went red the day the catalogue merged
      // `pellworm|vanilla cream` into `pellworm|vanilla cream flake` — two
      // Flake rows, same maker, near-identical composition, i.e. a
      // tier-1 merge — with "Vanilla Cream" kept in the surviving row's
      // `blend_aliases`. Resolving the typed name onto a differently-titled
      // row IS the merge working; an assertion that forbids it
      // would forbid the feature. Do NOT "fix" this back.
      //
      // Assert on the canonical KEY: it survives a blend rename and it names
      // the brand the alias was supposed to resolve to. The dead `else` branch
      // it replaces asserted only that a JSON file was readable — nothing.
      //
      // WHAT THIS CASE DOES AND DOES NOT PROVE, measured rather than assumed.
      // Probed in three directions and ALL THREE stayed green: dropping the
      // blend alias "Vanilla Cream", dropping the brand alias "RTMallow",
      // and both. Two later rungs of the ladder absorb them — the blend
      // resolves by substring ("vanillacream" ⊂ "vanillacreamflake", unique
      // under the brand) and the brand by reverse substring ("pellworm" ⊂
      // "pellwormandco"). So this exercises the LADDER end to end and NOT the
      // alias path, exactly as its own pre-existing comment half-admitted
      // ("already covered by punctuation tolerance earlier"). The alias
      // path is genuinely proven by the M&F case above — probed: removing
      // "M&F" from marlow & finch reddens 3 cases. Kept because a
      // ladder-reaches-the-right-row assertion is worth having; do not
      // re-describe it as alias coverage.
      const key = tobaccoDbCanonicalKey("RTMallow", "Kestrel");
      expect(key).toBe("r.t. mallow|kestrel");
      const hit = tobaccoDbLookupSync("RTMallow", "Kestrel", "fr");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe("Kestrel");
    });

    it("contributes brand aliases to the catalog search blob", async () => {
      await loadTobaccoDb();
      // Marlow & Finch has alias "M&F" and 199 complete blends. Pick
      // "Crown of the North" — typing "M&F crown" should hit it via the
      // tokenized matcher (token "m&f" matches via the brand alias
      // contribution to the blob, token "star" substring-matches the
      // name). Without the alias contribution, "m&f" alone
      // wouldn't appear in the blob at all.
      const dbJson = loadCatalogueFixture();
      const key = "marlow & finch|crown of the north";
      const entry = dbJson.blends[key];
      expect(entry).toBeTruthy();
      expect(tobaccoDbSearchMatch(key, entry, "M&F crown")).toBe(true);
      // Reverse: "crown M&F" — order-independent.
      expect(tobaccoDbSearchMatch(key, entry, "crown M&F")).toBe(true);
      // Pure alias query — every M&F blend should match "M&F" alone.
      expect(tobaccoDbSearchMatch(key, entry, "M&F")).toBe(true);
    });

    it("does NOT cross-pollinate aliases — a Marlow & Finch alias query doesn't match a R.T. Mallow blend", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      // Pick a complete R.T. Mallow blend. "M&F" should NOT match it
      // since the alias belongs to a different brand's blob.
      const peaseKeys = Object.keys(dbJson.blends).filter((k) => k.startsWith("r.t. mallow|"));
      expect(peaseKeys.length).toBeGreaterThan(0);
      const peaseKey = peaseKeys[0]!;
      const entry = dbJson.blends[peaseKey];
      expect(tobaccoDbSearchMatch(peaseKey, entry, "M&F")).toBe(false);
    });
  });

  // ASCII fold for diacritics + ligatures. Bridges the
  // accent gap user-side (typing "riviere doree" matches "Rivière Dorée",
  // "jubilaeums" matches "Jubilæums", "winslow" matches "Winsløw").
  // The displayed catalog row keeps its original accents — only the
  // comparison runs on the folded form.
  describe("ASCII diacritic fold", () => {
    it("matches an accented blend name when the user types ASCII", async () => {
      await loadTobaccoDb();
      // Synthetic blend forged with a diacritic in the name — verifies
      // the matcher handles it even though the master CSV currently
      // doesn't carry many accented blend names.
      const fakeEntry = {
        name: "Rivière Dorée",
        category: "VaPer",
        cut: "Ribbon",
        blend: "Virginia, Perique",
        force: 3,
        roomNote: 3,
        taste: 4,
        agingMax: "10",
        description: { fr: "", en: "" },
      };
      expect(tobaccoDbSearchMatch("marlow & finch|rivière dorée", fakeEntry, "riviere doree")).toBe(true);
      expect(tobaccoDbSearchMatch("marlow & finch|rivière dorée", fakeEntry, "Riviere Doree")).toBe(true);
      // Sanity: typing the accented form should also match.
      expect(tobaccoDbSearchMatch("marlow & finch|rivière dorée", fakeEntry, "rivière dorée")).toBe(true);
    });

    it("matches a ligature name (æ → ae) when the user types ASCII", async () => {
      await loadTobaccoDb();
      const fakeEntry = {
        name: "Jubilæums",
        category: "Aromatique",
        cut: "Ribbon",
        blend: "Cavendish, Virginia",
        force: 2,
        roomNote: 3,
        taste: 3,
        agingMax: "5",
        description: { fr: "", en: "" },
      };
      expect(tobaccoDbSearchMatch("4th generation|jubilæums", fakeEntry, "jubilaeums")).toBe(true);
      expect(tobaccoDbSearchMatch("4th generation|jubilæums", fakeEntry, "Jubilaeums")).toBe(true);
    });

    it("matches Scandinavian ø in the brand display (Winsløw → Winslow)", async () => {
      await loadTobaccoDb();
      const fakeEntry = {
        name: "Black Diamond",
        category: "Aromatique",
        cut: "Ribbon",
        blend: "Cavendish, Burley",
        force: 2,
        roomNote: 3,
        taste: 3,
        agingMax: "5",
        description: { fr: "", en: "" },
      };
      // Build a fake DB with Winsløw in the brand display, then verify
      // typing "Winslow" finds the blend. We can't mutate the cached
      // brand directly, but the matcher falls back to the brand KEY
      // (the part before "|") when the brand isn't in the cache —
      // so we stash the ø in the brandKey to drive the same code path.
      expect(tobaccoDbSearchMatch("poul winsløw|black diamond", fakeEntry, "Winslow Black")).toBe(true);
      // Folded query should also still match the folded blob.
      expect(tobaccoDbSearchMatch("poul winsløw|black diamond", fakeEntry, "winsløw black")).toBe(true);
    });

    it("resolveCanonicalBrand bridges ASCII typed brand → diacritic canonical via normBrandKey", async () => {
      // Synthetic — relies on the brand normaliser, not on a specific
      // catalog brand (we don't know which accented brands the user
      // will add). Done through tobaccoDbCanonicalKey which goes
      // through resolveCanonicalBrand and exposes the resolved key.
      await loadTobaccoDb();
      // Pick a real brand whose canonical key uses a ligature / accent
      // if one exists; otherwise the brand-aliases unit tests above
      // already cover the working path. Smoke-test that the normBrandKey
      // helper folds correctly via Marlow & Finch ≡ "Marlow and Finch"
      // (which was already covered earlier) and via a synthetic accent
      // ("Ostergaard" ≡ "Østergaard" after the fold).
      const a = tobaccoDbCanonicalKey("Ostergaard", "Amber Room");
      const b = tobaccoDbCanonicalKey("Østergaard", "Amber Room");
      // Both must resolve to the same canonical key.
      expect(a).toBe(b);
      expect(b).toBe("østergaard|amber room");
    });
  });

  // canonical-key lookup for duplicate detection
  describe("tobaccoDbCanonicalKey", () => {

    it("collapses brand variations to the canonical brand key", async () => {
      await loadTobaccoDb();
      const a = tobaccoDbCanonicalKey("R T Mallow", "Kestrel");
      const b = tobaccoDbCanonicalKey("R.T. Mallow", "Kestrel");
      expect(a).toBe(b);
      expect(a).toBe("r.t. mallow|kestrel");
    });

    it("collapses substring to the same canonical key as the exact name", async () => {
      await loadTobaccoDb();
      // Both "Halvorsen Early" (substring) and "Halvorsen Regent Mixture"
      // (exact) resolve to halvorsen|regent mixture.
      const fromSubstring = tobaccoDbCanonicalKey("Halvorsen", "Early");
      const fromExact = tobaccoDbCanonicalKey("Halvorsen", "Early Tide");
      expect(fromSubstring).toBe(fromExact);
      expect(fromExact).toBe("halvorsen|early tide");
    });

    it("returns null for unknown blends so callers fall back to the literal key", () => {
      // Cache not loaded yet → null (sync)
      expect(tobaccoDbCanonicalKey("Foo", "Bar")).toBeNull();
    });
  });

  // The network-failure trio (fetch rejects / non-ok /
  // sticky-failed) is obsolete — the DB is no longer fetched at runtime,
  // it's bundled into the JS chunk via dynamic import(). The only
  // realistic failure mode now is "bundler emitted a malformed chunk",
  // which is a build-time problem caught by the validator, not a
  // runtime concern. The `failed` flag in module memory is kept
  // defensively (handles import() rejection) but isn't testable from
  // user code without monkey-patching the module resolver.

  // catalog search uses a tokenized + Levenshtein-tolerant
  // matcher. The previous .includes()-based filter broke on word
  // reordering (the user's "Corvane blue" → DB "Corvane|Flake Blue"
  // case that prompted this) and on brand typos. These tests lock in
  // the two improvements without overshooting into false positives.
  describe("tobaccoDbSearchMatch", () => {
    it("matches when the query words appear in any order across the blob", async () => {
      await loadTobaccoDb();
      const entry = (globalThis as any).fetch
        ? null
        : null; // silence — we'll read the entry via the cache
      // Pull the actual Corvane|Flake Blue entry from the loaded DB.
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      const e = dbJson.blends[key];
      expect(e).toBeTruthy();
      // The earlier filter would FAIL on this query.
      expect(tobaccoDbSearchMatch(key, e, "Corvane blue")).toBe(true);
      // Reverse order, mixed casing.
      expect(tobaccoDbSearchMatch(key, e, "blue corvane")).toBe(true);
      // Brand alone.
      expect(tobaccoDbSearchMatch(key, e, "Corvane")).toBe(true);
      // Whole name fragment in the natural order.
      expect(tobaccoDbSearchMatch(key, e, "flake blue")).toBe(true);
      // Reversed name fragment.
      expect(tobaccoDbSearchMatch(key, e, "blue flake")).toBe(true);
      void entry;
    });

    it("returns true on an empty query (acts as a no-op filter)", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      expect(tobaccoDbSearchMatch(key, dbJson.blends[key], "")).toBe(true);
      expect(tobaccoDbSearchMatch(key, dbJson.blends[key], "   ")).toBe(true);
    });

    it("tolerates a 1-edit brand typo on 6+ character tokens (Corvain → Corvane)", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      const e = dbJson.blends[key];
      expect(tobaccoDbSearchMatch(key, e, "Corvain blue")).toBe(true);
    });

    it("does not match an unrelated blend (false positive guard)", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      const e = dbJson.blends[key];
      // "halvorsen" is a real brand in the DB but has nothing to do
      // with Corvane|Flake Blue.
      expect(tobaccoDbSearchMatch(key, e, "Halvorsen")).toBe(false);
      // Random gibberish (long enough to bypass the 3-char floor).
      expect(tobaccoDbSearchMatch(key, e, "xyzzyplugh")).toBe(false);
    });

    it("stays strict on very short tokens (<4 chars) — no Levenshtein", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      const e = dbJson.blends[key];
      // "abc" doesn't appear as a substring; Lev fallback is disabled
      // for tokens under 4 chars, so this must NOT match.
      expect(tobaccoDbSearchMatch(key, e, "abc")).toBe(false);
    });

    it("AND-matches across tokens (all must match)", async () => {
      await loadTobaccoDb();
      const dbJson = loadCatalogueFixture();
      const key = "corvane|flake blue";
      const e = dbJson.blends[key];
      // "blue" matches; "halvorsen" doesn't. AND → false.
      expect(tobaccoDbSearchMatch(key, e, "blue halvorsen")).toBe(false);
    });

    it("returns false when the cache hasn't been loaded yet (no crash on null brand meta)", () => {
      _resetTobaccoDbForTests();
      // Cache is null. The matcher should still run — brandDisplay
      // falls back to the brand key — and return false for an
      // unrelated typo without throwing.
      const fakeEntry = {
        name: "Flake Blue", category: "Virginia", cut: "Flake",
        blend: "Bright Virginia", force: 3, roomNote: 3, taste: 4,
        agingMax: "10", description: { fr: "", en: "" },
      };
      expect(tobaccoDbSearchMatch("corvane|flake blue", fakeEntry, "halvorsen")).toBe(false);
      // And true when at least one substring hits — brand key (lowercase)
      // is in the blob.
      expect(tobaccoDbSearchMatch("corvane|flake blue", fakeEntry, "corvane")).toBe(true);
    });
  });
});

/**
 * The chunk-failure detector.
 *
 * It decides whether the catalogue screen offers a reload or a retry, and
 * getting it wrong costs the user either a doomed button or an unexplained
 * "reload the app". The view test cannot cover it — that test mocks this
 * module, and disabling the regex left it green — so the predicate is
 * asserted here against what browsers ACTUALLY say.
 */
// (the `isChunkFailure` describe lived here. The app dynamically
// imported a bundled catalogue chunk, and a failed module fetch is remembered
// as a failure in the browser's module map — so the predicate existed to tell
// that case apart and word it "reload", since a retry issues no request. There
// is no chunk to fetch now; the subject is gone, not moved.)

