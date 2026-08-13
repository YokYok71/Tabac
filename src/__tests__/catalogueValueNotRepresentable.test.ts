// A catalogue value the CELLAR cannot represent is not applied.
//
// THE DEFECT, reproduced before it was fixed. The catalogue is
// the user's OWN file, and `parseCatalogueCsv` deliberately keeps an
// unrecognised taxonomy label VERBATIM (silently rewriting someone's
// vocabulary is worse than reporting it). THREE writers copied `category` /
// `cut` straight from a catalogue hit into the cellar:
//
//   • `planCatalogueApply` / `applyCataloguePlan` — the bulk pass
//   • `useDbSync` — the per-fiche « Synchroniser » offer
//   • `useAiAutoFill.applyDbHit` — the catalogue branch of the auto-fill,
//     whose own comment justified skipping validation with "the DB values are
//     already validated by scripts/validate-tobacco-db.cjs" — a script DELETED
// With the bundled catalogue. The guarantee it named had not
//     existed for seven releases.
//
// From there it is the defect: no `CUT_DENSITY` for the session
// bowl-weight estimate, no `xl()` translation so the raw string renders in all
// six languages, no `FAMILY_AGING_MAX` entry so the blend loses its maturity
// band entirely, and no matching option in the form's fixed dropdown — so the
// first time the user opens and saves that fiche the app rewrites the value
// itself, silently.
//
// WHY THE FIX IS HERE AND NOT AT THE JSON IMPORT, which is where it was first
// looked for. Measured over the whole history of `constants.ts`: `CATS` has had
// 5 successive values and `CUTS` 3, and each is a strict SUPERSET of the one
// before — no value has ever been removed or renamed. So an app-generated
// backup cannot carry a label the app no longer knows, and the only way one
// gets in is the catalogue. Guarding `migrateData` instead would run on EVERY
// load, not just imports: a wrong table would silently rewrite the whole cellar
// at launch with no undo, which is a worse failure than the gap.

import { describe, it, expect } from "vitest";
import { canonCategory, canonCut, CATS, CUTS, CAT_MAP, CUT_MAP, BT } from "../constants.ts";
import { planCatalogueApply, applyCataloguePlan } from "../utils/catalogueApply.ts";

/** A catalogue hit shaped like `tobaccoDbLookupSync` returns one. */
const hit = (o: Record<string, any> = {}) => Object.assign({
  name: "633", brandDisplay: "Vondel", category: "Anglais", cut: "Flake",
  blend: "Virginia, Perique", force: 3, roomNote: 3, taste: 3,
  agingMax: "10-15", description: "",
}, o);

describe("the canonicaliser", () => {
  it("accepts a canonical value unchanged", () => {
    for (const v of CATS) expect(canonCategory(v), v).toBe(v);
    for (const v of CUTS) expect(canonCut(v), v).toBe(v);
  });

  it("accepts a trade label the import contract maps", () => {
    expect(canonCut("Navy Cut")).toBe("Flake");
    expect(canonCategory("Cigar")).toBe("Cigare");
  });

  it("every map entry resolves — the two tables agree", () => {
    // Non-vacuity: if a map target had drifted out of the enum, the case above
    // would pass on a lucky pair while the rest silently returned null.
    for (const k of Object.keys(CAT_MAP)) expect(canonCategory(k), k).toBeTruthy();
    for (const k of Object.keys(CUT_MAP)) expect(canonCut(k), k).toBeTruthy();
  });

  it("is fold-tolerant, because the catalogue is hand-filled", () => {
    expect(canonCategory("  anglais ")).toBe("Anglais");
    expect(canonCategory("ecossais")).toBe("Écossais");
    expect(canonCut("krumble kake")).toBe("Crumble Cake");
  });

  it("returns NULL — never a guess — for a label the cellar cannot store", () => {
    expect(canonCategory("Pipeweed")).toBeNull();
    expect(canonCut("Zigzag Cut")).toBeNull();
  });

  it("returns null for an empty value: there is nothing to apply", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(canonCategory(v)).toBeNull();
      expect(canonCut(v)).toBeNull();
    }
  });

  it("a forged label cannot resolve through the prototype", () => {
    // The label comes from a user-supplied CSV, so on a plain object
    // "constructor" would resolve to a member of Object.prototype — truthy,
    // and not a category.
    for (const forged of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(canonCategory(forged), forged).toBeNull();
      expect(canonCut(forged), forged).toBeNull();
    }
  });
});

describe("the BULK pass leaves an unrepresentable value alone", () => {
  const cellar = (o: Record<string, any> = {}) => ({
    tobaccos: [Object.assign({}, BT, { id: 1, brand: "Vondel", name: "633" }, o)],
    wishlist: [], pipes: [], accessories: [], sessions: [],
  });
  const plan = (data: any, h: any) =>
    planCatalogueApply(data, "fr", (() => h) as any);

  it("does not plan a change for a category outside CATS", () => {
    const p = plan(cellar(), hit({ category: "Pipeweed", cut: "Flake" }));
    const fields = p.entries.flatMap((e: any) => e.changes.map((c: any) => c.field));
    expect(fields).not.toContain("category");
    expect(fields, "the rest of the row still applies").toContain("cut");
  });

  it("does not overwrite a CORRECT category with the catch-all", () => {
    // Snapping to "Autre" would be a downgrade, and this pass's whole promise
    // is that personal data is never overwritten.
    const data: any = cellar({ category: "Virginia" });
    const p = plan(data, hit({ category: "Pipeweed" }));
    const next = applyCataloguePlan(data, p, "2026-08-12T00:00:00.000Z");
    expect(next.tobaccos[0].category).toBe("Virginia");
  });

  it("leaves an EMPTY field empty rather than writing Autre", () => {
    const data: any = cellar({ category: "", cut: "" });
    const p = plan(data, hit({ category: "Pipeweed", cut: "Zigzag Cut" }));
    const next = applyCataloguePlan(data, p, "2026-08-12T00:00:00.000Z");
    expect(next.tobaccos[0].category).toBe("");
    expect(next.tobaccos[0].cut).toBe("");
  });

  it("a row whose ONLY diff is unrepresentable counts as already current", () => {
    // …and not as a change that then applies nothing — the "banner that never
    // leaves" shape, one subsystem over.
    const data: any = cellar(Object.assign({}, hit(), {
      brand: "Vondel", name: "633", brandDisplay: undefined, category: "Virginia",
    }));
    const p = plan(data, hit({ category: "Pipeweed" }));
    expect(p.entries).toEqual([]);
    expect(p.alreadyCurrent).toBe(1);
  });

  it("APPLIES a trade label, canonicalised", () => {
    // The contract still works: `Navy Cut` is understood and lands as `Flake`,
    // never as the raw label.
    const data: any = cellar({ cut: "Ribbon" });
    const p = plan(data, hit({ cut: "Navy Cut" }));
    const next = applyCataloguePlan(data, p, "2026-08-12T00:00:00.000Z");
    expect(next.tobaccos[0].cut).toBe("Flake");
  });
});

describe("the PER-FICHE offer never proposes what it cannot apply", () => {
  it("catalogueCanFill ignores an unrepresentable value", async () => {
    // If the only empty field is one the catalogue cannot legally fill, the
    // offer must NOT appear — otherwise tapping it changes nothing and the
    // banner comes back on every open (the defect, other subsystem).
    const { catalogueCanFill } = await import("../hooks/useDbSync.ts");
    const form = Object.assign({}, BT, {
      brand: "Vondel", name: "633", category: "", cut: "Flake",
      blend: "Virginia", force: 3, roomNote: 3, taste: 3, agingMax: "10-15",
      description: "x",
    });
    expect(catalogueCanFill(form, hit({ category: "Pipeweed" })), "unrepresentable").toBe(false);
    expect(catalogueCanFill(form, hit({ category: "Balkan" })), "representable").toBe(true);
  });
});

describe("the AUTO-FILL catalogue branch canonicalises too", () => {
  it("applyDbHit keeps the form's value rather than planting a raw label", async () => {
    // Its own comment used to justify skipping the check with a script that
    // was deleted. The assertion is on the SETTER's payload,
    // driven through the real module.
    // Source-level: `applyDbHit` is inside a hook whose surrounding machinery
    // (React state, the provider dispatch, the fetch pipeline) is irrelevant to
    // the one line at issue, and what rots is WHICH HELPER the write site calls.
    // Comments are blanked first — the recurring trap, where a check
    // was satisfied by the prose explaining the fix.
    const { readFileSync } = await import("node:fs");
    const file = readFileSync("src/hooks/useAiAutoFill.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(file, "applyDbHit must canonicalise the category")
      .toMatch(/category:\s*canonCategory\(hit\.category\)\s*\|\|\s*f\.category/);
    expect(file, "…and the cut")
      .toMatch(/cut:\s*canonCut\(hit\.cut\)\s*\|\|\s*f\.cut/);
    expect(file, "the deleted-script justification must not come back")
      .not.toMatch(/validate-tobacco-db/);
  });
});

describe("the enums have only ever GROWN — why the JSON import needs no guard", () => {
  it("every historical CATS / CUTS value is still canonical", () => {
    // Measured from git: CATS has had 5 successive values and
    // CUTS 3, each a strict superset of the one before. Pinned as the OLDEST
    // of each, so removing a value — which would make old app-generated
    // backups carry an unknown label and change this whole analysis — turns
    // this red and forces the question to be re-answered.
    const OLDEST_CATS = ["Anglais","Aromatique","Balkan","Burley","Cavendish","Dark Fired","Écossais","Latakia","Oriental","Perique","Turkish","VaPer","Virginia","Virginia/Burley","Autre"];
    const OLDEST_CUTS = ["Broken Flake","Coins","Crumble Cake","Cube Cut","Curly Cut","Flake","Loose Cut","Plug","Pressed","Ready Rubbed","Ribbon","Rope","Rough Cut","Shag","Sliced","Autre"];
    for (const v of OLDEST_CATS) expect(CATS as readonly string[], v).toContain(v);
    for (const v of OLDEST_CUTS) expect(CUTS as readonly string[], v).toContain(v);
  });
});
