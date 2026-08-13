// « Vérifier mon catalogue ».
//
// SCOPE IS THE FEATURE, and it was set by the user in one sentence: the
// MANDATORY fields and the IMPOSED values, nothing else. So this file's job is
// as much to pin what the check does NOT do as what it does — a report that
// quietly grew a prose or length rule would start answering a question the
// button does not ask, and « aucun problème » would stop meaning what the
// panel says it means.
//
// The counts have been reported; what is new is the ROW. On a
// 1594-row catalogue « valeurs non reconnues : Krumble Kake » is a fact the
// user cannot act on — they have to find the lines in a spreadsheet, and
// nothing told them where.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCatalogueCsv, MAX_CATALOGUE_ISSUES } from "../utils/userCatalogue.ts";

const HEAD = "brand_key,brand_name,blend_name,category,cut,force,roomNote,taste";
const row = (o: Record<string, string> = {}) => {
  const b: Record<string, string> = {
    brand_key: "Halvorsen", brand_name: "Halvorsen", blend_name: "Duskfall",
    category: "Anglais", cut: "Ribbon", force: "4", roomNote: "3", taste: "4",
  };
  Object.assign(b, o);
  return HEAD.split(",").map((h) => b[h] ?? "").join(",");
};
const csv = (...rows: string[]) => [HEAD].concat(rows).join("\n") + "\n";

describe("the two MANDATORY columns", () => {
  it("reports the row of a line with no brand", () => {
    const r = parseCatalogueCsv(csv(row(), row({ brand_key: "", brand_name: "" })));
    expect(r.skippedNoIdentity).toBe(1);
    expect(r.issues).toHaveLength(1);
    // Line 3: the header is line 1 and the good row is line 2. A spreadsheet
    // gutter shows the same number, which is the whole point of reporting it.
    expect(r.issues[0]).toMatchObject({ row: 3, kind: "no-identity", name: "Duskfall" });
  });

  it("reports the row of a line with no blend name", () => {
    const r = parseCatalogueCsv(csv(row({ blend_name: "" })));
    expect(r.issues).toMatchObject([{ row: 2, kind: "no-identity", brand: "Halvorsen" }]);
  });

  it("reports a duplicate brand+name, and keeps the FIRST", () => {
    const r = parseCatalogueCsv(csv(row({ cut: "Flake" }), row({ cut: "Plug" })));
    expect(r.duplicateKeys).toBe(1);
    expect(r.issues).toMatchObject([{ row: 3, kind: "duplicate" }]);
    expect(r.db!.blends["halvorsen|duskfall"]!.cut, "first wins").toBe("Flake");
  });
});

describe("the two IMPOSED-taxonomy columns", () => {
  it("reports a category outside CATS, with the offending label", () => {
    const r = parseCatalogueCsv(csv(row({ category: "Pipeweed" })));
    expect(r.unknownCategories).toEqual(["Pipeweed"]);
    expect(r.issues).toMatchObject([{ row: 2, kind: "category", value: "Pipeweed" }]);
  });

  it("reports a cut outside CUTS", () => {
    // NOT `Krumble Kake`, which is the obvious-looking example and is WRONG:
    // CUT_MAP sends it to Crumble Cake, so it is understood. CLAUDE.md used it
    // as its illustration of a half-understood cut in two places, and writing
    // This fixture is what caught that — both were corrected.
    const r = parseCatalogueCsv(csv(row({ cut: "Zigzag Cut" })));
    expect(r.issues).toMatchObject([{ row: 2, kind: "cut", value: "Zigzag Cut" }]);
  });

  it("says NOTHING about a trade label the import map converts", () => {
    // `Navy Cut` → Flake and `Cigar` → Cigare are the import contract, not
    // defects. Reporting them would send the reviewer 'fixing' rows that are
    // already understood — the over-strict-guard failure this repo keeps
    // recording.
    const r = parseCatalogueCsv(csv(row({ cut: "Navy Cut", category: "Cigar" })));
    expect(r.issues).toEqual([]);
    expect(r.unknownCuts).toEqual([]);
    expect(r.unknownCategories).toEqual([]);
  });

  it("says nothing about an EMPTY category or cut — optional is optional", () => {
    const r = parseCatalogueCsv(csv(row({ category: "", cut: "" })));
    expect(r.issues).toEqual([]);
  });

  it("keeps the value verbatim in the catalogue, and only REPORTS it", () => {
    // Silently rewriting a user's vocabulary is worse than a half-understood
    // blend — the rule. The report is what makes it visible.
    const r = parseCatalogueCsv(csv(row({ cut: "Zigzag Cut" })));
    expect(r.db!.blends["halvorsen|duskfall"]!.cut).toBe("Zigzag Cut");
  });
});

describe("what the check deliberately does NOT look at", () => {
  // The user set this scope explicitly. A future 'improvement' that adds a
  // prose or coverage rule here changes what « aucun problème » claims, so it
  // has to break these first.
  it("ignores a missing description, in every language", () => {
    const r = parseCatalogueCsv(csv(row()));
    expect(r.issues).toEqual([]);
  });

  it("ignores a description present in only one language", () => {
    const h = HEAD + ",description_fr,description_de";
    const body = h.split(",").map((k) => (k === "description_fr" ? "Un flake anglais." : k === "description_de" ? "" : ({
      brand_key: "Halvorsen", brand_name: "Halvorsen", blend_name: "Duskfall",
      category: "Anglais", cut: "Ribbon", force: "4", roomNote: "3", taste: "4",
    } as Record<string, string>)[k] ?? "")).join(",");
    const r = parseCatalogueCsv([h, body].join("\n"));
    expect(r.issues).toEqual([]);
    expect(r.blends).toBe(1);
  });

  it("ignores an empty composition, an empty agingMax and a two-word description", () => {
    const h = HEAD + ",blend,agingMax,description_fr";
    const r = parseCatalogueCsv([h, [
      "Halvorsen", "Halvorsen", "Duskfall", "Anglais", "Ribbon", "4", "3", "4", "", "", "Bon.",
    ].join(",")].join("\n"));
    expect(r.issues).toEqual([]);
  });
});

describe("the detail list is bounded and says so", () => {
  it("caps at MAX_CATALOGUE_ISSUES while the COUNT stays exact", () => {
    const n = MAX_CATALOGUE_ISSUES + 25;
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(row({ blend_name: "B" + i, cut: "Zigzag" }));
    const r = parseCatalogueCsv(csv(...rows));
    expect(r.issues.length, "the list is capped").toBe(MAX_CATALOGUE_ISSUES);
    expect(r.blends, "every row still loaded").toBe(n);
    // The count the panel shows comes from the deduped label list, which is
    // unaffected by the cap — a truncated list can never read as complete.
    expect(r.unknownCuts).toEqual(["Zigzag"]);
  });
});

describe("the real fixture stays clean", () => {
  it("the committed excerpt has no mandatory-field or taxonomy issue", () => {
    // Non-vacuity for every case above: if the fixture had a defect, a broken
    // collector would look correct here by reporting it.
    const r = parseCatalogueCsv(readFileSync("src/__tests__/fixtures/catalogue-excerpt.csv", "utf8"));
    expect(r.blends, "the fixture parsed").toBeGreaterThan(20);
    expect(r.issues).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Two defects an audit found, both of the same shape: the CORRECT version of
// The rule was written one file over, in `csvImport.ts`,.

describe("the counts are EXACT, the detail is capped", () => {
  // The panel's entire job is to say what is wrong. Deriving the counts by
  // filtering the capped `issues` list made a badly-broken file UNDER-report —
  // and, worse, a file whose cap fills with no-identity rows first report ZERO
  // bad categories: the reassuring number, on the one screen that must not
  // give it. `csvImport` keeps exact counters beside the capped list; this is
  // the same rule.
  const many = (n: number, o: Record<string, string>) =>
    Array.from({ length: n }, (_, i) => row({ blend_name: "B" + i, ...o }));

  it("counts every bad category, well past the detail cap", () => {
    const n = MAX_CATALOGUE_ISSUES + 40;
    const r = parseCatalogueCsv(csv(...many(n, { category: "Pipeweed" })));
    expect(r.badCategory, "exact").toBe(n);
    expect(r.issues.length, "detail capped").toBe(MAX_CATALOGUE_ISSUES);
  });

  it("THE POINT: a cap filled by OTHER issues still reports the bad cuts", () => {
    // No-identity rows come first and eat the whole detail budget, so a
    // filtered count would report 0 cuts on a file that has 30 of them.
    const noId = Array.from({ length: MAX_CATALOGUE_ISSUES },
      (_, i) => row({ brand_key: "", brand_name: "", blend_name: "N" + i }));
    const bad = many(30, { cut: "Zigzag Cut" });
    const r = parseCatalogueCsv(csv(...noId, ...bad));
    expect(r.issues.length).toBe(MAX_CATALOGUE_ISSUES);
    expect(r.issues.some((i) => i.kind === "cut"), "no cut row fits").toBe(false);
    expect(r.badCut, "…and it is reported anyway").toBe(30);
  });

  it("a clean file counts zero, so the assertions above are not vacuous", () => {
    const r = parseCatalogueCsv(csv(row(), row({ blend_name: "Other" })));
    expect(r.badCategory).toBe(0);
    expect(r.badCut).toBe(0);
  });
});

describe("the reported row is the TRUE spreadsheet line", () => {
  // A reviewer opens their spreadsheet at the number this panel prints. Blank
  // rows are dropped from the parse, and the row number used to be the index
  // of the FILTERED array — so on any file padded with empties it drifted, and
  // a number that is quietly wrong is worse than no number at all. The comment
  // on the old code STATED the drift instead of fixing it.
  it("a blank line before a defect does not shift its row number", () => {
    // header=1, good=2, blank=3, defect=4.
    const r = parseCatalogueCsv(csv(row(), "", row({ blend_name: "X", category: "Pipeweed" })));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.row, "line 4, not 3").toBe(4);
  });

  it("several blank lines accumulate, and every kind agrees", () => {
    const r = parseCatalogueCsv(csv(
      "", "",                                             // lines 2, 3
      row({ blend_name: "A", category: "Pipeweed" }),      // line 4
      "",                                                  // line 5
      row({ brand_key: "", brand_name: "", blend_name: "B" }), // line 6
      "",                                                  // line 7
      row({ blend_name: "C", cut: "Zigzag Cut" }),         // line 8
    ));
    const at = (k: string) => r.issues.filter((i) => i.kind === k).map((i) => i.row);
    expect(at("category")).toEqual([4]);
    expect(at("no-identity")).toEqual([6]);
    expect(at("cut")).toEqual([8]);
  });

  it("with no blank lines the numbering is unchanged", () => {
    const r = parseCatalogueCsv(csv(row(), row({ blend_name: "X", category: "Pipeweed" })));
    expect(r.issues[0]!.row).toBe(3);
  });
});
