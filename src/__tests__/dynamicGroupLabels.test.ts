import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SHAPE_FAMILIES, CAT_FAMILIES, CUT_FAMILIES,
  BOWL_MAT_FAMILIES, STEM_MAT_FAMILIES,
} from "../constants.ts";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

/**
 * The `<optgroup>` headers are i18n keys held in DATA, so
 * doc:check gate 9 cannot see them.
 *
 * That gate matches a literal `t("…")` call. These labels never appear in that
 * form: four of the five `*_FAMILIES` tables carry a `labelKey` field that a
 * form view passes straight to `t()`, and `SHAPE_FAMILIES` does not even carry
 * the key — it is BUILT, `"shape_family_" + f.key`, in two views. A key missing
 * from a dictionary therefore renders as its own raw name in a dropdown header:
 * `SHAPE_FAMILY_BENT` on screen.
 *
 * This is verbatim the defect one module over, where `compareBlends`'
 * `ROWS` table invented `lbl_category` and `lbl_rating` — keys that exist in NO
 * dictionary — and the comparison rendered `LBL_CATEGORY` as its first row. The
 * lesson recorded there is the one applied here: a lookup table of i18n keys is
 * only safe if something resolves it against the REAL dictionaries.
 *
 * Nothing is broken today — all 23 keys resolve in all six languages. This is
 * the net, written before the fall rather than after it.
 */

const CODES = LANGUAGES.map((l) => l.code);

/** Every group label the UI can ask for, with where it comes from. */
function allGroupKeys(): { key: string; from: string }[] {
  const out: { key: string; from: string }[] = [];
  // The one that is CONCATENATED, not stored — the riskiest of the five,
  // because a reader of constants.ts sees no i18n key at all.
  for (const f of SHAPE_FAMILIES) out.push({ key: "shape_family_" + f.key, from: "SHAPE_FAMILIES" });
  const stored: [string, { labelKey: string }[]][] = [
    ["CAT_FAMILIES", CAT_FAMILIES],
    ["CUT_FAMILIES", CUT_FAMILIES],
    ["BOWL_MAT_FAMILIES", BOWL_MAT_FAMILIES],
    ["STEM_MAT_FAMILIES", STEM_MAT_FAMILIES],
  ];
  for (const [name, rows] of stored) for (const r of rows) out.push({ key: r.labelKey, from: name });
  return out;
}

describe("dynamic <optgroup> labels resolve in every language", () => {
  const keys = allGroupKeys();

  it("collects labels from all five family tables, so the sweep cannot pass vacuously", () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const t of ["SHAPE_FAMILIES", "CAT_FAMILIES", "CUT_FAMILIES", "BOWL_MAT_FAMILIES", "STEM_MAT_FAMILIES"]) {
      expect(keys.some((k) => k.from === t), t).toBe(true);
    }
    expect(CODES.length).toBeGreaterThan(1);
  });

  it("never renders a group header as its own raw key", () => {
    for (const { key, from } of keys) {
      for (const code of CODES) {
        const v = translate(code, key);
        expect(v, `${from}: t("${key}") is missing in ${code} — the dropdown header renders the raw key`)
          .not.toBe(key);
        expect(String(v).trim().length, `${key} is empty in ${code}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the SHAPE_FAMILIES prefix in step with the two views that build it", () => {
    // The prefix is the join between a data table and two call sites. Renaming
    // it in constants.ts alone would leave both dropdowns printing raw keys,
    // and the case above would still pass — it derives the prefix from the same
    // literal it is meant to guard.
    for (const f of ["src/views/curator/PipeFormView.tsx", "src/views/curator/PipesListView.tsx"]) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(src.includes('"shape_family_" +'), `${f} must build the shape-family label from that prefix`).toBe(true);
    }
  });
});
