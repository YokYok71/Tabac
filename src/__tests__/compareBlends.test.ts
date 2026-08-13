import { describe, it, expect } from "vitest";
import {
  COMPARE_MAX,
  compareItemFromTobacco, compareItemFromCatalogue, compareItemFromWish,
  buildComparison, hasExperienceColumn,
} from "../utils/compareBlends.ts";
import { BT, BW } from "../constants.ts";
import { translate } from "../i18n.ts";
import { LANGUAGES } from "../i18n/languages.ts";

// comparing two or three blends.
//
// Two rules carry the whole feature and both are easy to get wrong:
//
//   1. UNKNOWN IS `null`, NEVER 0. A Force never filled in must not read as
//      "very mild" and a blend with no sessions must not read as "rated 0" —
//      and in the stored data those are the same byte, because `BT` seeds
//      force: 0. Fixtures are built FROM the templates so a field that gains a
//      0 default later is covered by default rather than silently mis-reported.
//
//   2. THE COLUMNS ARE NOT SYMMETRIC. A catalogue or wishlist column cannot
//      answer "what did it give me", and reporting 0 there would be a lie about
//      a blend the user has never smoked.

const tob = (over: any = {}) => Object.assign({}, BT, {
  id: 1, brand: "Halvorsen", name: "Duskfall",
  category: "Anglais", cut: "Ribbon", blend: "Virginia, Latakia, Perique",
  force: 4, roomNote: 3, taste: 4, rating: 5, agingMax: "10",
  lots: [{ id: 700, status: "cellar", weightG: "50", datePurchased: "2024-01-01" }],
}, over);

const CAT = {
  name: "Duskfall", category: "Anglais", cut: "Ribbon", blend: "Virginia, Latakia",
  force: 4, roomNote: 3, taste: 4, agingMax: "6-10",
  description: { fr: "Prose du catalogue.", en: "Catalogue prose." },
};

describe("unknown is null, never 0", () => {
  it("reports a never-filled score as unknown, not as the lowest score", () => {
    // A fresh tobacco from the template carries force/roomNote/taste/rating = 0.
    const it0 = compareItemFromTobacco(Object.assign({}, BT, { id: 9, brand: "A", name: "B", lots: [] }), []);
    expect(it0.force).toBeNull();
    expect(it0.roomNote).toBeNull();
    expect(it0.taste).toBeNull();
    expect(it0.rating).toBeNull();
  });

  it("keeps a real score", () => {
    const i = compareItemFromTobacco(tob(), []);
    expect(i.force).toBe(4);
    expect(i.rating).toBe(5);
  });

  it("reports no stock as unknown rather than 0 g", () => {
    const empty = compareItemFromTobacco(tob({ lots: [] }), []);
    expect(empty.stockG).toBeNull();
  });

  it("counts sessions as 0 — a real answer, unlike an unfilled field", () => {
    // "You have never smoked this" IS information; "the Force is unknown" is not
    // the same thing as "the Force is 0". The two must not be conflated.
    const i = compareItemFromTobacco(tob(), []);
    expect(i.sessions).toBe(0);
    expect(i.avgSessionRating).toBeNull();   // …but there is no average of nothing
  });

  it("ignores an unparseable lot date instead of reading it as 0 days old", () => {
    const i = compareItemFromTobacco(tob({ lots: [{ id: 1, status: "cellar", weightG: "50", datePurchased: "pas une date" }] }), []);
    expect(i.oldestLotDays).toBeNull();
  });
});

describe("the columns are not symmetric", () => {
  it("a catalogue column answers the factual rows and none of the experience ones", () => {
    const c = compareItemFromCatalogue("halvorsen|duskfall", CAT, "fr", "Halvorsen");
    expect(c.category).toBe("Anglais");
    expect(c.force).toBe(4);
    expect(c.description).toBe("Prose du catalogue.");
    for (const f of ["rating", "stockG", "oldestLotDays", "sessions", "avgSessionRating", "costPerSession"] as const) {
      expect(c[f], `${f} cannot be known for a blend you do not own`).toBeNull();
    }
    expect(c.aromas).toEqual([]);
  });

  it("resolves the catalogue description in the ACTIVE language", () => {
    expect(compareItemFromCatalogue("k", CAT, "en").description).toBe("Catalogue prose.");
  });

  it("a wishlist column behaves like a catalogue one — factual, no history", () => {
    const w = compareItemFromWish(Object.assign({}, BW, { id: 3, brand: "P", name: "N", category: "Virginia", force: 2 }));
    expect(w.source).toBe("wish");
    expect(w.force).toBe(2);
    expect(w.sessions).toBeNull();
  });

  it("falls back to the FAMILY ageing default, like the fiche does", () => {
    // Otherwise the catalogue column would read "—" against a cellar column
    // showing the same family's default, and look like a difference that is not.
    const c = compareItemFromCatalogue("k", Object.assign({}, CAT, { agingMax: "" }), "fr");
    expect(c.agingMax).toBe("6-10");     // Anglais
  });

  it("says whether any column can answer the experience rows", () => {
    const c = compareItemFromCatalogue("k", CAT, "fr");
    expect(hasExperienceColumn([c, compareItemFromWish({ id: 1 })])).toBe(false);
    expect(hasExperienceColumn([c, compareItemFromTobacco(tob(), [])])).toBe(true);
  });
});

describe("buildComparison", () => {
  const mine = () => compareItemFromTobacco(tob(), [
    { id: 1, tobaccoId: 1, rating: 4, aromas: ["leather", "smoky"] },
    { id: 2, tobaccoId: 1, rating: 2, aromas: ["leather"] },
    { id: 3, tobaccoId: 99, rating: 5 },          // another blend's session
  ]);

  it("needs at least two columns", () => {
    expect(buildComparison([mine()])).toEqual([]);
    expect(buildComparison([])).toEqual([]);
  });

  it("caps at COMPARE_MAX columns", () => {
    const rows = buildComparison([mine(), mine(), mine(), mine()]);
    expect(rows[0]!.values).toHaveLength(COMPARE_MAX);
  });

  it("marks the rows that actually DIFFER — the point of a comparison", () => {
    const a = mine();
    const b = compareItemFromCatalogue("halvorsen|duskfall", CAT, "fr", "Halvorsen");
    const rows = buildComparison([a, b]);
    const by = (f: string) => rows.find((r) => r.field === f)!;
    expect(by("category").differs, "both Anglais").toBe(false);
    expect(by("blend").differs, "one lists Perique, the other does not").toBe(true);
    expect(by("agingMax").differs, "10 vs 6-10").toBe(true);
  });

  it("drops a row no column can answer, rather than printing a line of dashes", () => {
    // Two catalogue columns can answer nothing under "experience"; a block of
    // "—" would read as a bug rather than as an absence.
    const rows = buildComparison([
      compareItemFromCatalogue("a|b", CAT, "fr"),
      compareItemFromCatalogue("c|d", Object.assign({}, CAT, { name: "Other" }), "fr"),
    ]);
    expect(rows.some((r) => r.experience), "no experience row survives").toBe(false);
    expect(rows.some((r) => r.field === "category"), "the factual rows still do").toBe(true);
  });

  it("keeps an experience row when ONE column can answer it", () => {
    const rows = buildComparison([mine(), compareItemFromCatalogue("a|b", CAT, "fr")]);
    const sess = rows.find((r) => r.field === "sessions");
    expect(sess).toBeTruthy();
    expect(sess!.values[0]).toBe(2);          // only this blend's own sessions
    expect(sess!.values[1]).toBeNull();       // the catalogue column says nothing
  });

  it("aggregates only the blend's OWN sessions", () => {
    const rows = buildComparison([mine(), compareItemFromCatalogue("a|b", CAT, "fr")]);
    const avg = rows.find((r) => r.field === "avgSessionRating")!;
    expect(avg.values[0]).toBe(3);            // (4 + 2) / 2 — the id-99 session is not ours
    const aro = rows.find((r) => r.field === "aromas")!;
    expect(aro.values[0][0]).toBe("leather"); // most frequent first
  });

  it("compares aroma lists by content, not by reference", () => {
    const a = compareItemFromTobacco(tob(), [{ id: 1, tobaccoId: 1, aromas: ["leather"] }]);
    const b = compareItemFromTobacco(tob({ id: 2 }), [{ id: 2, tobaccoId: 2, aromas: ["leather"] }]);
    const rows = buildComparison([a, b]);
    expect(rows.find((r) => r.field === "aromas")!.differs).toBe(false);
  });

  it("survives garbage without throwing", () => {
    expect(() => buildComparison([null as any, undefined as any])).not.toThrow();
    expect(() => compareItemFromTobacco(null, null)).not.toThrow();
    expect(() => compareItemFromCatalogue("", null, "fr")).not.toThrow();
    expect(() => compareItemFromWish(null)).not.toThrow();
  });
});

describe("the row set", () => {
  it("puts the purchase-decision rows before the history ones", () => {
    const rows = buildComparison([
      compareItemFromTobacco(tob(), [{ id: 1, tobaccoId: 1, rating: 4 }]),
      compareItemFromCatalogue("a|b", CAT, "fr"),
    ]);
    const firstExp = rows.findIndex((r) => r.experience);
    const lastFactual = rows.map((r) => r.experience).lastIndexOf(false);
    expect(firstExp).toBeGreaterThan(lastFactual);
  });

  it("every row carries an i18n key, never a raw label", () => {
    const rows = buildComparison([mineLike(), compareItemFromCatalogue("a|b", CAT, "fr")]);
    rows.forEach((r) => {
      expect(r.labelKey, r.field).toMatch(/^[a-z][a-z0-9_]*$/);
    });
  });

  // The assertion that was missing, and it cost the first row
  // of the table.
  //
  // `lbl_category` and `lbl_rating` were invented here and existed in NO
  // dictionary, so the app rendered LBL_CATEGORY / LBL_RATING on screen. Nothing
  // could catch it: doc:check gate 9 ("a called key exists in every language")
  // only sees a literal `t("…")`, and these are DATA — the same blind spot that
  // produced the defect, whose lesson ("never a built key") this file
  // had already recorded for the SOURCE labels while leaving these unchecked.
  //
  // The shape of the fix matters more than the two keys: a lookup table of i18n
  // keys is only safe if something resolves it against the real dictionaries.
  it("resolves every row label in EVERY language, not just French", () => {
    // Both bands, so no row is skipped: a catalogue-only pair drops the whole
    // experience block, which is exactly where lbl_rating was hiding.
    const rows = buildComparison([mineLike(), compareItemFromTobacco(tob({ id: 2 }), [])]);
    expect(rows.length).toBeGreaterThan(10);
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes.length).toBeGreaterThan(1);
    for (const r of rows) {
      for (const code of codes) {
        const v = translate(code, r.labelKey);
        expect(v, `${r.field}: t("${r.labelKey}") is missing in ${code} — it renders as the raw key`)
          .not.toBe(r.labelKey);
        expect(String(v).trim().length, `${r.labelKey} is empty in ${code}`).toBeGreaterThan(0);
      }
    }
  });
  function mineLike() { return compareItemFromTobacco(tob(), [{ id: 1, tobaccoId: 1, rating: 4 }]); }
});
