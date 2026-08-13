// The browser half of the catalogue importer.
//
// The app stops shipping a catalogue and lets each user load their own, so a
// CSV now has to become the same in-memory shape `tobaccoDb.ts` has always
// served. Two things have to hold, and they pull in opposite directions:
//
//   • it must normalise EXACTLY like the Node importer, or a user's catalogue
//     is one the app half-understands (a non-canonical cut misses CUT_DENSITY,
//     has no xl() translation, matches no dropdown option — and opening that
//     tobacco's form then REWRITES the user's cut). The defect.
//   • it must be FORGIVING where the Node importer is strict, because its
//     input is a file a person filled in by hand rather than a delivered
//     master. Refusing every incomplete row would make the feature useless on
//     the first attempt and say nothing about why.
//
// The cross-check at the bottom is what makes the first claim a measurement
// instead of an intention.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseCatalogueCsv, buildCatalogueTemplateCsv, CATALOGUE_COLUMNS } from "../utils/userCatalogue.ts";
import { CATS, CUTS } from "../constants.ts";
import { FAMILY_AGING_MAX } from "../utils.ts";

const HEAD = CATALOGUE_COLUMNS.join(",");
/** One CSV row from a sparse field map, in the template's column order. */
function row(vals: Record<string, string>): string {
  return (CATALOGUE_COLUMNS as readonly string[])
    .map((c) => {
      const v = vals[c] || "";
      return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    })
    .join(",");
}
const csv = (...rows: string[]) => [HEAD, ...rows].join("\n") + "\n";

describe("identity is the only hard requirement", () => {
  it("a row with just brand_key + blend_name is imported", () => {
    // The Node importer would DROP this (no category, cut, composition, F/R/T
    // or descriptions). Here it must not: this is what a half-filled
    // spreadsheet looks like, and it is still a blend the user can match on.
    const r = parseCatalogueCsv(csv(row({ brand_key: "Halvorsen", blend_name: "Duskfall" })));
    expect(r.blends).toBe(1);
    expect(r.db!.blends["halvorsen|duskfall"]!.name).toBe("Duskfall");
    expect(r.skippedNoIdentity).toBe(0);
  });

  it("brand_name defaults to brand_key rather than dropping the row", () => {
    const r = parseCatalogueCsv(csv(row({ brand_key: "Yarrowmere", blend_name: "Gold Standard" })));
    expect(r.db!.brands["yarrowmere"]!.displayName).toBe("Yarrowmere");
  });

  it("a row with no brand_key or no blend_name is COUNTED, not silently lost", () => {
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "", blend_name: "Orphan" }),
      row({ brand_key: "Brand", blend_name: "" }),
      row({ brand_key: "Brand", blend_name: "Real" }),
    ));
    expect(r.blends).toBe(1);
    expect(r.skippedNoIdentity, "the user must be able to find out").toBe(2);
  });

  it("the first of two identical keys wins, and the collision is counted", () => {
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "B", blend_name: "X", blend: "first" }),
      row({ brand_key: "b", blend_name: "x", blend: "second" }),
    ));
    expect(r.blends).toBe(1);
    expect(r.duplicateKeys).toBe(1);
    expect(r.db!.blends["b|x"]!.blend).toBe("first");
  });
});

describe("enum normalisation matches the Node importer", () => {
  it("maps trade labels onto canonical values", () => {
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "B", blend_name: "A", category: "Cigar", cut: "Krumble Kake" }),
      row({ brand_key: "B", blend_name: "C", category: "English Aromatic", cut: "Navy Cut" }),
    ));
    expect(r.db!.blends["b|a"]!.category).toBe("Cigare");
    expect(r.db!.blends["b|a"]!.cut).toBe("Crumble Cake");
    expect(r.db!.blends["b|c"]!.category).toBe("Anglais aromatique");
    expect(r.db!.blends["b|c"]!.cut).toBe("Flake");
  });

  it("REPORTS an unmappable label instead of coercing it", () => {
    // Silently rewriting a user's vocabulary is how a catalogue starts
    // disagreeing with the file it came from. The value is kept verbatim and
    // named in the result so the UI can say which rows need attention.
    const r = parseCatalogueCsv(csv(row({ brand_key: "B", blend_name: "A", category: "Zzz", cut: "Qqq" })));
    expect(r.unknownCategories).toEqual(["Zzz"]);
    expect(r.unknownCuts).toEqual(["Qqq"]);
    expect(r.db!.blends["b|a"]!.category).toBe("Zzz");
  });

  it("a forged enum label cannot resolve through Object.prototype", () => {
    // The key now comes from a USER-SUPPLIED FILE. On a plain map,
    // `category: "constructor"` would resolve to a prototype member — truthy,
    // not a category — and defeat the `MAP[c] || c` fallback.
    const r = parseCatalogueCsv(csv(row({ brand_key: "B", blend_name: "A", category: "constructor", cut: "__proto__" })));
    expect(r.db!.blends["b|a"]!.category).toBe("constructor");
    expect(r.db!.blends["b|a"]!.cut).toBe("__proto__");
    expect(r.unknownCategories).toEqual(["constructor"]);
  });

  it("drops an agingMax the app re-derives from the family", () => {
    // The rule, applied at import (moved it there for the
    // Node side): storing it would freeze a constant that gets revised, and
    // QuickAdd copies the stored value into the user's cellar.
    expect(FAMILY_AGING_MAX["Virginia"], "fixture assumes Virginia has a default").toBeTruthy();
    expect(FAMILY_AGING_MAX["Autre"], "fixture assumes Autre has none").toBeFalsy();
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "B", blend_name: "HasDefault", category: "Virginia", agingMax: "12" }),
      row({ brand_key: "B", blend_name: "NoDefault", category: "Autre", agingMax: "12" }),
    ));
    expect(r.db!.blends["b|hasdefault"]!.agingMax).toBe("");
    expect(r.db!.blends["b|nodefault"]!.agingMax).toBe("12");
  });

  it("clamps F/R/T to 0-5 and treats garbage as 0", () => {
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "B", blend_name: "A", force: "4", roomNote: "9", taste: "abc" }),
    ));
    const b = r.db!.blends["b|a"]!;
    expect(b.force).toBe(4);
    expect(b.roomNote).toBe(0);
    expect(b.taste).toBe(0);
  });
});

describe("columns are matched by NAME, not position", () => {
  it("reads a reordered header", () => {
    const text = "blend_name,category,brand_key\nDuskfall,Anglais,Halvorsen\n";
    const r = parseCatalogueCsv(text);
    expect(r.db!.blends["halvorsen|duskfall"]!.category).toBe("Anglais");
  });

  it("reads the camelCase columns — the ones a lowercasing lookup misses", () => {
    // This is the defect the cross-check below caught: `col` is keyed on the
    // normalised header, so a lookup that did not normalise its own argument
    // read `roomNote` and `agingMax` as empty on EVERY row — and agingMax was
    // invisible, because the real catalogue's every agingMax is dropped by the
    // family rule anyway. A bug the data happened to hide.
    const r = parseCatalogueCsv(csv(
      row({ brand_key: "B", blend_name: "A", category: "Autre", roomNote: "3", agingMax: "7" }),
    ));
    expect(r.db!.blends["b|a"]!.roomNote).toBe(3);
    expect(r.db!.blends["b|a"]!.agingMax).toBe("7");
  });

  it("tolerates a BOM, CRLF, semicolons and quoted newlines", () => {
    const text = "﻿brand_key;blend_name;description_fr\r\n"
      + 'Halvorsen;Duskfall;"Deux lignes\ndans une cellule"\r\n';
    const r = parseCatalogueCsv(text);
    expect(r.blends).toBe(1);
    expect(r.db!.blends["halvorsen|duskfall"]!.description["fr"]).toContain("\ndans une cellule");
  });
});

describe("descriptions are optional and per language", () => {
  it("a French-only catalogue is valid", () => {
    // pickLang resolves requested → en → fr → first present, so an English
    // reader sees the French prose rather than nothing. Requiring fr AND en
    // (as the Node importer does) would refuse a whole class of usable file.
    const r = parseCatalogueCsv(csv(row({ brand_key: "B", blend_name: "A", description_fr: "Un virginia." })));
    expect(r.langs).toEqual(["fr"]);
    expect(r.db!.blends["b|a"]!.description).toEqual({ fr: "Un virginia." });
  });

  it("picks up every language column present", () => {
    const r = parseCatalogueCsv(csv(row({
      brand_key: "B", blend_name: "A",
      description_fr: "fr", description_en: "en", description_de: "de",
      description_it: "it", description_es: "es", description_pt: "pt",
    })));
    expect(r.langs).toEqual(["de", "en", "es", "fr", "it", "pt"]);
  });
});

describe("pipe-separated aliases", () => {
  it("splits, trims and drops empties on both alias columns", () => {
    const r = parseCatalogueCsv(csv(row({
      brand_key: "Halvorsen", blend_name: "Duskfall",
      brand_aliases: "Halvorsen of Dublin | Kapp & Halvorsen ||",
      blend_aliases: "Dusk Fall|",
    })));
    expect(r.db!.brands["halvorsen"]!.aliases).toEqual(["Halvorsen of Dublin", "Kapp & Halvorsen"]);
    expect(r.db!.blends["halvorsen|duskfall"]!.aliases).toEqual(["Dusk Fall"]);
  });

  it("omits the aliases key entirely when there are none", () => {
    // The shipped JSON does the same, and `displayAliases` keys on absence.
    const r = parseCatalogueCsv(csv(row({ brand_key: "B", blend_name: "A" })));
    expect(r.db!.blends["b|a"]).not.toHaveProperty("aliases");
  });
});

describe("failure modes are named, never a silent empty catalogue", () => {
  it("an empty file", () => {
    expect(parseCatalogueCsv("").error).toBe("empty");
    expect(parseCatalogueCsv("   \n ").error).toBe("empty");
  });
  it("a file with no recognisable header", () => {
    const r = parseCatalogueCsv("foo,bar\n1,2\n");
    expect(r.error).toBe("no-header");
    expect(r.db).toBeNull();
  });
  it("a header but no data rows", () => {
    const r = parseCatalogueCsv(HEAD + "\n");
    expect(r.error).toBe("empty");
    expect(r.db).toBeNull();
  });
  it("refuses a pathological row count", () => {
    const many = Array.from({ length: 20001 }, (_, i) => row({ brand_key: "B", blend_name: "n" + i }));
    const r = parseCatalogueCsv(csv(...many));
    expect(r.error).toBe("too-many-rows");
    expect(r.db).toBeNull();
  });
  it("never returns a db with zero blends", () => {
    // The caller stores whatever comes back; a truthy-but-empty catalogue
    // would replace a working one with nothing.
    for (const t of ["", HEAD + "\n", "foo\n1\n"]) {
      const r = parseCatalogueCsv(t);
      expect(r.db === null || r.blends > 0).toBe(true);
    }
  });
});

describe("the template", () => {
  it("carries the exact header the parser reads", () => {
    expect(buildCatalogueTemplateCsv().split("\n")[0]).toBe(HEAD);
  });

  it("round-trips through the parser — the template is a VALID catalogue", () => {
    // A template that does not itself import is the defect found in
    // the inventory CSV template, where the shipped example row tripped an
    // invariant on the very path the help documents.
    const r = parseCatalogueCsv(buildCatalogueTemplateCsv());
    expect(r.error).toBeNull();
    expect(r.blends).toBe(2);
    expect(r.skippedNoIdentity).toBe(0);
    expect(r.duplicateKeys).toBe(0);
  });

  it("its example rows use CANONICAL enum values", () => {
    // The template is the app DEMONSTRATING its own vocabulary. An example
    // needing normalisation would teach the wrong spelling.
    const r = parseCatalogueCsv(buildCatalogueTemplateCsv());
    expect(r.unknownCategories).toEqual([]);
    expect(r.unknownCuts).toEqual([]);
    for (const b of Object.values(r.db!.blends)) {
      expect(CATS as readonly string[]).toContain(b.category);
      expect(CUTS as readonly string[]).toContain(b.cut);
    }
  });

  it("demonstrates the two things people get wrong", () => {
    const r = parseCatalogueCsv(buildCatalogueTemplateCsv());
    const duskfall = r.db!.blends["halvorsen|duskfall"]!;
    expect(duskfall.aliases, "the pipe-separated alias list").toBeTruthy();
    expect(r.db!.brands["halvorsen"]!.aliases!.length).toBeGreaterThan(1);
    expect(r.langs, "that a description column exists per language").toContain("fr");
    expect(r.langs).toContain("en");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CROSS-CHECK — the browser parser against the Node importer's own output.
// This is what turns "normalises exactly like the importer" from an intention
// into a measurement, and it is how the camelCase defect above was found.
//
// CONVERTED, as the stage note required. Until then it
// ran against the 1594-row bundled master and the JSON the importer produced
// from it; the bundled catalogue AND the importer were removed, so both
// sides of that comparison are gone. Deleting the block was not an option —
// "a cross-check that quietly stops running is the passes-vacuously failure
// this file's siblings keep catching" — so it now runs against a COMMITTED
// EXCERPT: 20 rows lifted verbatim out of the last shipped master (20 distinct
// brands, chosen to exercise brand aliases, blend aliases, compound
// categories, accented French and quote-bearing prose), paired with the exact
// specs / aliases / brands / six-language prose the importer emitted for those
// rows. The expected side is therefore still the Node importer's own output,
// frozen — it is not a re-derivation of what this parser happens to do.
//
// What the conversion LOSES, stated so nobody mistakes the excerpt for the
// whole: coverage of 1574 other rows, and the sheer breadth that made the
// original run persuasive. What it KEEPS is the property that matters — the
// two implementations agree, field by field, on real catalogue data. It also
// keeps the shape that found the camelCase bug: `roomNote` and `agingMax` are
// compared, and those are the two columns whose lookup was silently empty.
// ─────────────────────────────────────────────────────────────────────────────
describe("cross-check against the Node importer's frozen output", () => {
  const CSV = "src/__tests__/fixtures/catalogue-excerpt.csv";
  const EXP = "src/__tests__/fixtures/catalogue-excerpt.expected.json";

  it("the fixtures are present — the cross-check must never pass vacuously", () => {
    expect(existsSync(CSV), CSV + " missing").toBe(true);
    expect(existsSync(EXP), EXP + " missing").toBe(true);
  });

  it("produces the importer's specs, aliases and brands, field by field", () => {
    const expected = JSON.parse(readFileSync(EXP, "utf8"));
    const r = parseCatalogueCsv(readFileSync(CSV, "utf8"));

    expect(r.error).toBeNull();
    expect(r.skippedNoIdentity).toBe(0);
    expect(r.duplicateKeys).toBe(0);
    expect(r.unknownCategories, "the excerpt is real catalogue data, so canonical").toEqual([]);
    expect(r.unknownCuts).toEqual([]);

    const mine = r.db!.blends as Record<string, any>;
    expect(Object.keys(mine).sort()).toEqual(Object.keys(expected.blends).sort());
    expect(Object.keys(mine).length, "non-vacuity — the excerpt must not be empty").toBeGreaterThan(15);

    const diffs: string[] = [];
    for (const k of Object.keys(expected.blends)) {
      const a = mine[k], b = expected.blends[k];
      for (const f of ["name", "category", "cut", "blend", "force", "roomNote", "taste", "agingMax"]) {
        if (String(a[f] ?? "") !== String(b[f] ?? "")) {
          diffs.push(`${k}.${f}: browser=${JSON.stringify(a[f])} node=${JSON.stringify(b[f])}`);
        }
      }
      if (JSON.stringify(a.aliases || []) !== JSON.stringify(b.aliases || [])) {
        diffs.push(`${k}.aliases: ${JSON.stringify(a.aliases)} vs ${JSON.stringify(b.aliases)}`);
      }
    }
    expect(diffs.slice(0, 10)).toEqual([]);

    const bd: string[] = [];
    for (const k of Object.keys(expected.brands)) {
      const a = (r.db!.brands as Record<string, any>)[k], b = expected.brands[k];
      if (!a) { bd.push("missing brand " + k); continue; }
      if (a.displayName !== b.displayName) bd.push(`${k}.displayName`);
      if (JSON.stringify(a.aliases || []) !== JSON.stringify(b.aliases || [])) bd.push(`${k}.aliases`);
    }
    expect(bd.slice(0, 10)).toEqual([]);
    expect(Object.keys(expected.brands).length, "brand diversity").toBeGreaterThan(15);
  });

  it("recovers every language's prose, matching what the desc chunks carried", () => {
    // The Node importer SPLIT the prose out of the base JSON into one chunk per
    // language; the browser keeps it inline, since a user's CSV carries all its
    // languages in one file. Same content, different packaging — the fixture
    // records the chunks' values, so this still compares against them.
    const expected = JSON.parse(readFileSync(EXP, "utf8"));
    expect(r_langs(), "all six languages present in the excerpt").toEqual(["fr", "en", "de", "it", "es", "pt"].sort());
    const r = parseCatalogueCsv(readFileSync(CSV, "utf8"));
    const bad: string[] = [];
    for (const k of Object.keys(expected.blends)) {
      for (const lang of Object.keys(expected.blends[k].description)) {
        const got = r.db!.blends[k]?.description[lang] || "";
        if (got !== expected.blends[k].description[lang]) bad.push(`${k}.${lang}`);
      }
    }
    expect(bad.slice(0, 5), "prose differs").toEqual([]);

    function r_langs(): string[] {
      return parseCatalogueCsv(readFileSync(CSV, "utf8")).langs.slice().sort();
    }
  });
});
