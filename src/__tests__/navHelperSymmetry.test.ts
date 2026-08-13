/**
 * nav-helper filter-reset symmetry (source-analysis test).
 *
 * Every `navTo*` drill helper in App.tsx lands on a filtered LIST and must
 * clear-or-set the SAME group of filter setters, so none leaves a stale filter
 * silently narrowing the destination. Two folds were exactly this
 * class: `navToInvFiltered` forgot `setTagFilter("")` (a lingering tag filter
 * narrowed the family/brand chart drill), and `navToJournalFiltered` forgot the
 * commune/country clears its two siblings had.
 *
 * This test parses App.tsx, extracts each helper's body by brace-matching, and
 * asserts every helper in a group references every setter in that group's
 * canonical set. A future helper that forgets one setter fails here instead of
 * shipping a silent filter leak. (Source-level, not a render test — the
 * helpers are App.tsx closures over ~30 setters, not unit-mountable.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_SRC = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");

/** Extract a `function NAME(...) { ... }` body by brace-matching. */
function extractFnBody(src: string, name: string): string {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at === -1) throw new Error(`helper not found: ${name}`);
  const open = src.indexOf("{", at);
  if (open === -1) throw new Error(`no body brace: ${name}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced body: ${name}`);
}

/** Every helper in `helpers` must call every setter in `setters`. */
function expectGroupSymmetry(helpers: string[], setters: string[]) {
  for (const h of helpers) {
    const body = extractFnBody(APP_SRC, h);
    for (const s of setters) {
      expect(
        body.includes(s + "("),
        `${h} must call ${s}(...) — every drill helper in its group resets the same filter set`,
      ).toBe(true);
    }
  }
}

describe("nav-helper filter-reset symmetry", () => {
  it("every inventory-drill helper touches the whole tobacco filter set", () => {
    expectGroupSymmetry(
      ["navToInvFiltered", "navToInvByAroma", "navToInvByTag", "navToInvByRating"],
      [
        "setCatFilter",
        "setCutFilter",
        "setBrandFilter",
        "setTagFilter",
        "setAromaFilter",
        "setRatingFilter",
        "setSearch",
        "setStatusFilter",
      ],
    );
  });

  it("every journal-drill helper touches the whole journal filter set", () => {
    expectGroupSymmetry(
      ["navToJournalFiltered", "navToJournalFilteredByDate", "navToJournalFilteredByLocation"],
      [
        "setJournalFilterYear",
        "setJournalFilterDate",
        "setJournalFilterPipe",
        "setJournalFilterTobacco",
        "setJournalFilterCommune",
        "setJournalFilterCountry",
      ],
    );
  });

  it("every pipe-drill helper touches the whole pipe filter set", () => {
    expectGroupSymmetry(
      ["navToPipesFiltered", "navToPipesFilteredByMaterial", "navToPipesByTag"],
      [
        "setPShapeFilter",
        "setPBrandFilter",
        "setPFilterFilter",
        "setPRatingFilter",
        "setPTagFilter",
        "setPBowlMaterialFilter",
        "setPStemMaterialFilter",
        "setShowFinishedPipes",
      ],
    );
  });
});
