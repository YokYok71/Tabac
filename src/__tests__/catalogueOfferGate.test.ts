/**
 * The catalogue offer must have something to offer.
 *
 * `CatalogOffer` says "this blend is in the reference catalogue — fill the
 * fiche in one tap". Its `show` used to be nothing but "brand + name match a
 * catalogue entry", which stays true for ever once a blend is catalogued. So on
 * an already-complete fiche the banner appeared on EVERY open, offering to fill
 * A form that had nothing left to fill. An earlier release made applying dismiss it, but
 * that flag is component state: re-opening the form remounted the component,
 * reset it, and the banner was back. Reported twice from the app — the second
 * time as "the bug is still there", after I had fixed a DIFFERENT banner
 * (`useDbSync`'s diff offer) on the same screen.
 *
 * The distinction these cases pin, and the reason there are two banners:
 *   catalogueCanFill  → a field the catalogue supplies is EMPTY  → fill it
 *   useDbSync's diff  → a field DIVERGES from the catalogue      → ask first
 * Conflating them is what produced a banner that never left.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { catalogueCanFill } from "../hooks/useDbSync.ts";

// A catalogue hit carries specs + prose. `brandDisplay` is the aliased key.
const HIT = {
  brandDisplay: "Vondel",
  name: "Red Label",
  category: "Aromatique",
  cut: "Flake",
  blend: "Virginia, Black Cavendish",
  force: 3,
  roomNote: 3,
  taste: 3,
  agingMax: "10-15",
  description: "Un flake danois…",
};

const COMPLETE = {
  brand: "Vondel",
  name: "Red Label",
  category: "Aromatique",
  cut: "Flake",
  blend: "Virginia, Black Cavendish",
  force: 3,
  roomNote: 3,
  taste: 3,
  agingMax: "10-15",
  description: "Un flake danois…",
};

describe("catalogueCanFill", () => {
  it("a complete fiche has nothing to fill — THE regression", () => {
    // This is the user's screenshot: an existing Vondel 131 fiche, every field
    // already set, and the banner offering to fill it.
    expect(catalogueCanFill(COMPLETE, HIT)).toBe(false);
  });

  it("a fresh entry with only brand+name has everything to fill", () => {
    expect(catalogueCanFill({ brand: "Vondel", name: "Red Label" }, HIT)).toBe(true);
  });

  it("one empty field is enough", () => {
    for (const champ of ["category", "cut", "blend", "agingMax", "description"]) {
      const form: any = { ...COMPLETE, [champ]: "" };
      expect(catalogueCanFill(form, HIT), `${champ} empty must offer the fill`).toBe(true);
    }
  });

  it("a zero rating counts as empty — 0 is what an unfilled scale holds", () => {
    for (const champ of ["force", "roomNote", "taste"]) {
      const form: any = { ...COMPLETE, [champ]: 0 };
      expect(catalogueCanFill(form, HIT), `${champ}=0 must offer the fill`).toBe(true);
    }
  });

  it("a DIFFERENT value is not a missing one — that is the diff banner's job", () => {
    // The user typed their own category. The offer must stay silent; useDbSync
    // is what surfaces a divergence, with the values shown side by side.
    expect(catalogueCanFill({ ...COMPLETE, category: "Virginia" }, HIT)).toBe(false);
    expect(catalogueCanFill({ ...COMPLETE, force: 5 }, HIT)).toBe(false);
  });

  it("a field the catalogue itself lacks is never counted as fillable", () => {
    const maigre = { brandDisplay: "Vondel", name: "Red Label", category: "Aromatique" };
    // Everything else is absent from the hit, so an empty form field cannot be
    // filled from it — offering would produce a fill that changes nothing.
    expect(catalogueCanFill({ brand: "Vondel", name: "Red Label", category: "Aromatique" }, maigre)).toBe(false);
  });

  it("identity is never 'missing' — it is what produced the match", () => {
    // No name in the form yet the hit has one: the caller already requires both
    // before looking up, so this must not be what triggers the offer.
    expect(catalogueCanFill({ ...COMPLETE, name: "" }, HIT)).toBe(false);
  });

  it("guards against a missing form or hit", () => {
    expect(catalogueCanFill(null, HIT)).toBe(false);
    expect(catalogueCanFill(COMPLETE, null)).toBe(false);
  });
});

/**
 * One banner per mode, as decided by the catalogue's owner:
 *   NEW entry  → "this blend is in the catalogue", the one-tap fill
 *   EDITING it → the LIST of what will change (useDbSync's diff)
 *
 * Before this the simple offer showed in BOTH modes. On an existing tobacco
 * that meant a "fill the fiche" banner over a fiche already filled, and on a
 * divergence it competed with the diff banner — which says the same thing but
 * usefully: which fields, both values, side by side.
 *
 * These cases pin the SPLIT rather than either banner's internals, because the
 * way this regresses is by one of them creeping back into the other's mode.
 */
describe("one banner per mode", () => {
  it("the tobacco form offers the fill in add mode only", () => {
    const src = fs.readFileSync("src/views/curator/TobaccoFormView.tsx", "utf8");
    const memo = src.slice(src.indexOf("const dbHinted = useMemo"), src.indexOf("}, [form, dbReady"));
    expect(memo, "the offer must stand down outside addT").toContain('if (view !== "addT") return false;');
    // and the detailed diff must be the edit-mode one
    expect(src, "the diff banner is the edit-mode one").toContain('enabled: view === "editT"');
  });

  it("the wishlist form does the same, keyed on its own edit flag", () => {
    const src = fs.readFileSync("src/views/curator/WishFormView.tsx", "utf8");
    const memo = src.slice(src.indexOf("const dbHinted = useMemo"), src.indexOf("}, [form, dbReady"));
    expect(memo, "the offer must stand down while editing a wish").toContain("if (editWishId) return false;");
    expect(src, "the diff banner is the edit-mode one").toContain("enabled: !!editWishId");
  });

  it("both memos declare the mode they read", () => {
    // A stale dep array would freeze the banner on the mode it first saw.
    const tob = fs.readFileSync("src/views/curator/TobaccoFormView.tsx", "utf8");
    const wish = fs.readFileSync("src/views/curator/WishFormView.tsx", "utf8");
    expect(tob.slice(tob.indexOf("const dbHinted"))).toMatch(/\}, \[form, dbReady, view,/);
    expect(wish.slice(wish.indexOf("const dbHinted"))).toMatch(/\}, \[form, dbReady, editWishId,/);
  });
});
