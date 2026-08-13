/**
 * Tests for the i18n gate logic in scripts/i18nChecks.cjs.
 *
 * WHY. doc-check.cjs had grown to ~15 gates with no tests of its own. The
 * identical-value gate in particular was rewritten (flat allowlist
 * → per-language) and verified only by two manual probes. A gate whose own
 * correctness is unverified still prints "doc:check OK" just as confidently
 * once it has silently stopped checking anything — which is the one failure
 * mode a guard cannot afford, so these cases lean hard on the NEGATIVE side:
 * what must still be flagged, and what must never be silenced.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";

const requireCjs = createRequire(import.meta.url);
const C = requireCjs("../../scripts/i18nChecks.cjs");

describe("parseDictSource", () => {
  it("extracts key:\"value\" pairs", () => {
    const d = C.parseDictSource('export var FR = {\n  a:"un",\n  b_2:"deux",\n};');
    expect(d.a).toBe("un");
    expect(d.b_2).toBe("deux");
  });

  it("tolerates escaped quotes inside a value", () => {
    const d = C.parseDictSource('  q:"il a dit \\"oui\\"",');
    expect(d.q).toBe('il a dit \\"oui\\"');
  });

  it("ignores comments and code around the pairs", () => {
    const d = C.parseDictSource('// a:"commented" is still matched by the regex\nconst x = 1;\n  real:"value",');
    expect(d.real).toBe("value");
  });

  it("is prototype-safe — a __proto__ key cannot poison the map", () => {
    // The dictionaries are source files, but the parse result is indexed by
    // keys taken from them; a plain {} would let `__proto__:"…"` alter the
    // object's prototype instead of adding an entry.
    const d = C.parseDictSource('  __proto__:"boom",\n  ok:"fine",');
    expect(Object.getPrototypeOf(d)).toBeNull();
    expect(d.ok).toBe("fine");
    expect(({} as any).boom).toBeUndefined();
  });
});

describe("parseIdenticalAllowlist", () => {
  it("accepts the per-language object form", () => {
    const m = C.parseIdenticalAllowlist({ catalog_title: ["en"], emoji_key: "*" });
    expect(m.get("catalog_title")).toEqual(["en"]);
    expect(m.get("emoji_key")).toBe("*");
  });

  it("REJECTS the earlier flat array, with a migration message", () => {
    // Honouring it silently would restore the exact bug this rule fixed: one
    // cognate silencing all four language pairs.
    expect(() => C.parseIdenticalAllowlist(["catalog_title"]))
      .toThrow(/flat array/);
    expect(() => C.parseIdenticalAllowlist(["catalog_title"]))
      .toThrow(/catalog_title.*\["en"\]/s);
  });

  it("rejects a non-object and a malformed entry", () => {
    expect(() => C.parseIdenticalAllowlist(null)).toThrow(/expected an/);
    expect(() => C.parseIdenticalAllowlist("nope")).toThrow(/expected an/);
    expect(() => C.parseIdenticalAllowlist({ k: 42 })).toThrow(/array of language codes/);
    expect(() => C.parseIdenticalAllowlist({ k: [1, 2] })).toThrow(/must be strings/);
  });

  it("the SHIPPED allowlist parses and is per-language", () => {
    const raw = JSON.parse(readFileSync("scripts/doc-check.allowlist.json", "utf8"));
    const m = C.parseIdenticalAllowlist(raw.identical);
    expect(m.size).toBeGreaterThan(20);
    // Every entry names languages (or "*") — a hand-edit back to a bare key
    // would throw above, and an empty list would silence nothing.
    for (const [k, v] of m) {
      expect(v === "*" || (Array.isArray(v) && v.length > 0), `${k} has no languages`).toBe(true);
    }
  });
});

describe("identicalAllowed — per-language precision", () => {
  const allow = C.parseIdenticalAllowlist({ catalog_title: ["en"], both: ["en", "es"], any: "*" });

  it("silences only the language the match was verified in", () => {
    expect(C.identicalAllowed(allow, "catalog_title", "en")).toBe(true);
    // A future Italian left as "Catalogue" must STILL warn — under the flat
    // allowlist it did not, which is why the shape changed.
    expect(C.identicalAllowed(allow, "catalog_title", "it")).toBe(false);
    expect(C.identicalAllowed(allow, "catalog_title", "de")).toBe(false);
  });

  it("supports several languages and the \"*\" wildcard", () => {
    expect(C.identicalAllowed(allow, "both", "es")).toBe(true);
    expect(C.identicalAllowed(allow, "both", "de")).toBe(false);
    for (const c of ["en", "es", "de", "it"]) {
      expect(C.identicalAllowed(allow, "any", c)).toBe(true);
    }
  });

  it("returns false for an unknown key or a non-Map allowlist", () => {
    expect(C.identicalAllowed(allow, "nope", "en")).toBe(false);
    expect(C.identicalAllowed(undefined, "any", "en")).toBe(false);
    expect(C.identicalAllowed({} as any, "any", "en")).toBe(false);
  });
});

describe("findSuspiciousIdentical", () => {
  const allow = C.parseIdenticalAllowlist({ journal: ["en"] });
  const ref = {
    journal: "Journal",        // cognate, allowlisted for en only
    description: "Description", // identical, NOT allowlisted → flagged
    lot: "lot",                // ≤ 3 chars → skipped
    chart: "📊",                // no letter → skipped
    translated: "Cave",        // genuinely translated → not flagged
    absent: "Absente",         // missing from the translation → parity's job
  };

  it("flags an identical value that is not allowlisted for this language", () => {
    const tr = { journal: "Journal", description: "Description", lot: "lot", chart: "📊", translated: "Cellar" };
    const hits = C.findSuspiciousIdentical(ref, tr, "en", allow).map((h: any) => h.k);
    expect(hits).toEqual(["description"]);
  });

  it("flags the SAME key in a language it was not allowlisted for", () => {
    const it = { journal: "Journal", description: "Descrizione", lot: "lot", chart: "📊", translated: "Cantina" };
    const hits = C.findSuspiciousIdentical(ref, it, "it", allow).map((h: any) => h.k);
    expect(hits).toEqual(["journal"]);
  });

  it("skips short codes and symbol-only values", () => {
    const tr = { lot: "lot", chart: "📊", dash: "—" };
    expect(C.findSuspiciousIdentical({ lot: "lot", chart: "📊", dash: "—" }, tr, "en", allow)).toEqual([]);
  });

  it("returns nothing when everything is translated", () => {
    const tr = { journal: "Diario", description: "Descrizione", lot: "lotto", chart: "📊", translated: "Cantina" };
    expect(C.findSuspiciousIdentical(ref, tr, "it", allow)).toEqual([]);
  });
});

describe("findLengthOutliers", () => {
  it("flags a translation past the ratio and reports the measurements", () => {
    const hits = C.findLengthOutliers({ jar: "Pot" }, { jar: "Barattolo" }, "it", 1.4);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ k: "jar", lf: 3, lt: 9 });
    expect(hits[0].ratio).toBeCloseTo(3, 5);
  });

  it("ignores a reference string too short to be meaningful", () => {
    expect(C.findLengthOutliers({ ok: "ok" }, { ok: "einverstanden" }, "de", 1.4)).toEqual([]);
  });

  it("ignores a translation at or under the ratio", () => {
    // Equal length, and a 1.5× pair under a 2× threshold.
    expect(C.findLengthOutliers({ k: "Journal" }, { k: "Logbuch" }, "de", 1.4)).toEqual([]);
    expect(C.findLengthOutliers({ k: "Cave" }, { k: "Keller" }, "de", 2)).toEqual([]);
  });

  it("is strictly greater-than at the boundary", () => {
    // 7/5 = exactly 1.4 → not a finding; one character more → a finding.
    expect(C.findLengthOutliers({ k: "Notes" }, { k: "Anmerku" }, "de", 1.4)).toEqual([]);
    expect(C.findLengthOutliers({ k: "Notes" }, { k: "Anmerkun" }, "de", 1.4)).toHaveLength(1);
  });

  it("sorts worst-first so the truncated report shows the worst cases", () => {
    const ref = { a: "Pot", b: "Cave", c: "Note" };
    const tr = { a: "Barattolo", b: "Cantinaaa", c: "Nota" };
    const hits = C.findLengthOutliers(ref, tr, "it", 1.4).map((h: any) => h.k);
    expect(hits[0]).toBe("a"); // ×3.00 beats ×2.25
    expect(hits).toEqual(["a", "b"]);
  });

  it("defaults to the documented 1.4 threshold", () => {
    expect(C.RATIO_THRESHOLD).toBe(1.4);
    expect(C.findLengthOutliers({ k: "Cave" }, { k: "Cellar" }, "en")).toHaveLength(1);
  });
});

describe("findParityGaps", () => {
  it("reports keys missing from and extra in a translation", () => {
    const g = C.findParityGaps({ a: "1", b: "2" }, { a: "1", c: "3" });
    expect(g.missing).toEqual(["b"]);
    expect(g.extra).toEqual(["c"]);
  });

  it("is empty when the key sets match", () => {
    const g = C.findParityGaps({ a: "1" }, { a: "uno" });
    expect(g.missing).toEqual([]);
    expect(g.extra).toEqual([]);
  });
});

describe("the shipped dictionaries, through the shipped rules", () => {
  // doc:check already runs these against the real files; asserting the CLEAN
  // state here too means a regression shows up in `npm test` as well, and it
  // proves the extracted module agrees with the data it was extracted from.
  const dicts: Record<string, any> = {};
  for (const c of LANGUAGES.map((l) => l.code)) {   // derived, never copied
    dicts[c] = C.parseDictSource(readFileSync(`src/i18n/${c}.ts`, "utf8"));
  }
  const allow = C.parseIdenticalAllowlist(
    JSON.parse(readFileSync("scripts/doc-check.allowlist.json", "utf8")).identical,
  );

  it("parses a real dictionary into a plausible number of keys", () => {
    expect(Object.keys(dicts.fr).length).toBeGreaterThan(500);
  });

  it("has no unexplained identical value in any language", () => {
    // This loop was the literal ["en","es","de","it"] — sitting one
    // line under a map the sweep had already DERIVED, and inside a test
    // that claims "any language". Portuguese drift went unchecked here from the
    // day it shipped. `languageAxisTests` could not see it: that guard reads
    // module-scope lists only, and this one lives in an `it` body.
    for (const code of LANGUAGES.map((l) => l.code).filter((c) => c !== "fr")) {
      const hits = C.findSuspiciousIdentical(dicts.fr, dicts[code], code, allow).map((h: any) => h.k);
      expect(hits, `fr/${code} identical values need an allowlist entry or a translation`).toEqual([]);
    }
  });
});
