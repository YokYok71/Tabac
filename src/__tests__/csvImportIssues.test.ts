// The CELLAR csv import applies the same import contract as
// the catalogue, and says which row it could not read.
//
// THE DEFECT, measured before it was fixed. Feeding a cellar CSV containing
// `Navy Cut`, `Pipeweed` and a row with no brand produced:
//   • Navy Cut  -> "Autre", silently  (the catalogue turns it into `Flake`)
//   • Pipeweed  -> "Autre", silently
//   • the empty row dropped, counted in `skipped` — which NO CALLER READ.
//
// Three things were wrong and they are not the same kind of thing:
//
//   (a) `CAT_MAP` / `CUT_MAP` are the import contract — the trade labels a
//       source may write — and this importer never consulted them. An
//       oversight, not a decision: a hand-typed cellar CSV is at least as
//       likely to carry a trade label as a curated catalogue delivery, since
//       it is copied off the tin or exported from another app.
//
//   (b) snapping an unrecognised value to "Autre" is RIGHT here and wrong for
//       the catalogue, and the asymmetry is deliberate: a cellar fiche is
//       edited in a form whose dropdown is fixed, so keeping the value
//       verbatim would have it silently rewritten on the first save (build
//       102's defect). What was wrong is only the silence.
//
//   (c) `skipped` was computed and never surfaced — verbatim the
//       lesson one importer over: a file that silently dropped rows looks
//       exactly like one that loaded fine.

import { describe, it, expect } from "vitest";
import { parseTobaccoCsv, MAX_CSV_ISSUES } from "../utils/csvImport.ts";
import { CAT_MAP, CUT_MAP, CATS, CUTS } from "../constants.ts";

const HEAD = "Marque,Nom,Categorie,Coupe,Poids (g)";
const csv = (...rows: string[]) => [HEAD].concat(rows).join("\n");

describe("(a) the import contract reaches the cellar importer", () => {
  it("maps a trade cut label the way the catalogue does", () => {
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Navy Cut,50"));
    expect(r.tobaccos[0].cut).toBe("Flake");
    expect(r.badCut, "a mapped label is not a defect").toBe(0);
    expect(r.issues).toEqual([]);
  });

  it("maps a trade category label too", () => {
    const r = parseTobaccoCsv(csv("C&D,Yorktown,Cigar,Ribbon,50"));
    expect(r.tobaccos[0].category).toBe("Cigare");
    expect(r.badCategory).toBe(0);
  });

  it("is fold-tolerant on the map, unlike the catalogue's exact mapCut", () => {
    // This module has always been accent- and case-insensitive against
    // CATS/CUTS, so tolerating the same on the map is its own contract rather
    // than a new invention. The catalogue stays exact because a delivery is
    // curated and its gate depends on that.
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,anglais,krumble kake,50"));
    expect(r.tobaccos[0].cut).toBe("Crumble Cake");
    expect(r.tobaccos[0].category).toBe("Anglais");
  });

  it("a canonical value is never touched by the map", () => {
    // Guarded from the other side too: `enumMapsSingleSource.test.ts` asserts
    // no map key shadows an already-canonical value.
    for (const v of ["Flake", "Ribbon", "Plug"]) {
      expect(parseTobaccoCsv(csv(`B,N,Anglais,${v},50`)).tobaccos[0].cut).toBe(v);
    }
  });

  it("every map target is reachable — the map and the enums agree", () => {
    // Non-vacuity for the three cases above: if a target had drifted out of
    // CUTS the parser would fall through to "Autre" and they would still pass
    // for the wrong reason.
    for (const t of Object.values(CUT_MAP)) expect(CUTS as readonly string[]).toContain(t);
    for (const t of Object.values(CAT_MAP)) expect(CATS as readonly string[]).toContain(t);
  });
});

describe("(b) an unrecognised value is snapped to Autre — and REPORTED", () => {
  it("snaps it, because the fiche's dropdown has no option for it", () => {
    const r = parseTobaccoCsv(csv("Vondel,633,Pipeweed,Zigzag Cut,50"));
    expect(r.tobaccos[0].category).toBe("Autre");
    expect(r.tobaccos[0].cut).toBe("Autre");
  });

  it("counts it exactly and names the row and the label", () => {
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Ribbon,50", "Vondel,633,Pipeweed,Zigzag Cut,50"));
    expect(r.badCategory).toBe(1);
    expect(r.badCut).toBe(1);
    // Line 3: header is 1, the good row is 2.
    expect(r.issues).toMatchObject([
      { row: 3, kind: "category", brand: "Vondel", name: "633", value: "Pipeweed" },
      { row: 3, kind: "cut", value: "Zigzag Cut" },
    ]);
  });

  it("says nothing about a row that literally says Autre", () => {
    // It was understood. Reporting it would send the user 'fixing' a value the
    // app accepts — the over-strict-guard failure this repo keeps recording.
    const r = parseTobaccoCsv(csv("Thurlow,Old Bench,Autre,Autre,50"));
    expect(r.issues).toEqual([]);
    expect(r.badCategory + r.badCut).toBe(0);
  });

  it("says nothing about an EMPTY category or cut", () => {
    const r = parseTobaccoCsv(csv("Thurlow,Old Bench,,,50"));
    expect(r.tobaccos[0].category).toBe("");
    expect(r.issues).toEqual([]);
  });

  it("reports the row the value was READ from, not the group's last row", () => {
    // Rows sharing brand+name collapse into one tobacco with several lots, and
    // the enums are read from the FIRST of them — so that is the row to name.
    const r = parseTobaccoCsv(csv(
      "Vondel,633,Pipeweed,Ribbon,50",
      "Vondel,633,Pipeweed,Ribbon,100",
    ));
    expect(r.tobaccos).toHaveLength(1);
    expect(r.tobaccos[0].lots).toHaveLength(2);
    expect(r.badCategory, "read once, reported once").toBe(1);
    expect(r.issues[0]!.row).toBe(2);
  });
});

describe("(c) a row dropped for want of an identity is named", () => {
  it("counts it and gives its line number", () => {
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Ribbon,50", ",,Anglais,Ribbon,50"));
    expect(r.skipped).toBe(1);
    expect(r.issues).toMatchObject([{ row: 3, kind: "no-identity" }]);
  });

  it("an EMPTY row is not a dropped row — only a row with data but no identity", () => {
    // Written expecting `,,,,` to count as skipped; it does not, and the code
    // is right: the blank-line guard fires before the identity check, so a row
    // of nothing but separators is noise rather than a row the user lost.
    // Reporting it would put phantom line numbers in the panel for every
    // trailing newline a spreadsheet leaves behind.
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Ribbon,50", "", ",,,,"));
    expect(r.skipped).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.tobaccos).toHaveLength(1);
    // …whereas a row carrying data but no brand and no name IS a loss.
    const r2 = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Ribbon,50", ",,Anglais,Ribbon,50"));
    expect(r2.skipped).toBe(1);
  });
});

describe("the detail list is bounded, the counts are not", () => {
  it("caps at MAX_CSV_ISSUES while the counts stay exact", () => {
    const n = MAX_CSV_ISSUES + 20;
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(`B${i},N${i},Pipeweed,Ribbon,50`);
    const r = parseTobaccoCsv(csv(...rows));
    expect(r.issues.length).toBe(MAX_CSV_ISSUES);
    expect(r.issuesTruncated).toBe(true);
    expect(r.badCategory, "the count is exact").toBe(n);
    expect(r.tobaccos.length, "every row still imported").toBe(n);
  });

  it("a clean file reports nothing at all", () => {
    const r = parseTobaccoCsv(csv("Halvorsen,Duskfall,Anglais,Ribbon,50"));
    expect(r.issues).toEqual([]);
    expect(r.issuesTruncated).toBe(false);
    expect(r.skipped + r.badCategory + r.badCut).toBe(0);
  });
});

describe("the app's own export round-trips clean", () => {
  it("no issue is raised by canonical values", () => {
    // The export writes canonical enums, so re-importing one must produce an
    // empty report — otherwise the panel would cry wolf on the commonest path.
    const rows = (CUTS as readonly string[]).slice(0, 8)
      .map((cut, i) => `Brand${i},Name${i},${(CATS as readonly string[])[i]},${cut},50`);
    const r = parseTobaccoCsv(csv(...rows));
    expect(r.tobaccos).toHaveLength(rows.length);
    expect(r.issues).toEqual([]);
  });
});
