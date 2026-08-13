// "a catalogue is loaded" as a test fixture.
//
// The app shipped a catalogue, so every lookup test simply
// called `loadTobaccoDb()` and got 1594 blends. The only source now is the
// user's own file, which means a test that needs a catalogue has to SUPPLY
// one — and the honest way to supply it is the same data, through the same
// parser, rather than a hand-built object that would let the tests agree with
// a parser that had drifted.
//
// So this loads `fixtures/catalogue-excerpt.csv` through the real
// `parseCatalogueCsv` and hands the result to `catalogueLoad` via a mock.
//
// THE 30 ROWS ARE ENTIRELY SYNTHETIC — invented brands, blends and prose.
// They replaced an excerpt lifted verbatim from the catalogue this app used to
// ship, which was the author's own research and is no longer public anywhere.
// What the substitution preserved is not the DATA but the STRUCTURE each test
// exercises, so read the fixture as a set of shapes rather than a sample:
//
//   Halvorsen        multi-blend brand; the form placeholders; a distance-1
//                    brand typo ("Halvorse"); "Early Tide" is prefix-unique
//                    while "Harbour/Regent Mixture" keep a substring ambiguous
//   R.T. Mallow      punctuation-tolerant brand match ("R T Mallow")
//   Marlow & Finch   "&" vs "and" vs glued, plus the short alias "M&F"
//   Vondel           numeric blend aliases (a catalogue-number query)
//   Aldwych          the merged row — retired names survive as blend aliases
//   Fauconnier       accent folding ("riviere doree")
//   Corvane          tokenised search ("Corvane blue" is not contiguous)
//
// One consequence is recorded rather than hidden: the expected side of
// `userCatalogue.test.ts` is now a re-derivation of what this parser produces,
// where it used to be the deleted Node importer's frozen output. That
// non-circularity is gone — but so is the importer, so the comparison it
// protected had lost its second term already. It remains a regression lock.
//
// USAGE — the mock must be hoisted, so declare it in the test file itself:
//
//   vi.mock("../utils/catalogueStore.ts", () => ({
//     catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
//   }));
//
// and call `_resetTobaccoDbForTests()` in beforeEach as before.
//
// `useCatalogueCsv(csv)` swaps in a purpose-built catalogue for one case —
// used where the behaviour under test is about the SHAPE of a catalogue (two
// brands colliding on an alias, say) rather than about its contents, and where
// building that shape out of real rows would mean shipping a fixture chosen to
// contain a collision instead of one chosen to be representative.

import { readFileSync } from "node:fs";
import { parseCatalogueCsv } from "../utils/userCatalogue.ts";

export const CATALOGUE_FIXTURE_CSV_PATH = "src/__tests__/fixtures/catalogue-excerpt.csv";

let parsed: any = null;
let override: any = null;
let emptied = false;

/** The fixture parsed once, as `catalogueLoad` would resolve it. */
export function loadCatalogueFixture(): any {
  if (emptied) return null;
  if (override) return JSON.parse(JSON.stringify(override));
  if (!parsed) {
    const r = parseCatalogueCsv(readFileSync(CATALOGUE_FIXTURE_CSV_PATH, "utf8"));
    if (r.error || !r.db) throw new Error("catalogue fixture failed to parse: " + r.error);
    parsed = r.db;
  }
  // A fresh deep copy per call, so one test's mutation of a blend cannot leak
  // into the next. Cheap at 28 rows.
  return JSON.parse(JSON.stringify(parsed));
}

/** Serve `csv` instead of the excerpt until `resetCatalogueFixture()`. */
export function useCatalogueCsv(csv: string): void {
  const r = parseCatalogueCsv(csv);
  if (r.error || !r.db) throw new Error("test catalogue failed to parse: " + r.error);
  override = r.db;
}

/**
 * NO catalogue at all — what `catalogueLoad` resolves on a device that has
 * never loaded one, or has just removed the one it had. Modelled here rather
 * than by feeding an empty CSV, because `useCatalogueCsv` rightly REFUSES a
 * catalogue that parses to nothing (replacing a working catalogue
 * with an empty one because the user picked the wrong file is the failure that
 * guard exists for), so the two states are genuinely different.
 */
export function emptyCatalogueFixture(): void {
  emptied = true;
}

/** Back to the committed excerpt. Call in `beforeEach`. */
export function resetCatalogueFixture(): void {
  override = null;
  emptied = false;
}
