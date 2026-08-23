// The catalogue page grouped blends by brand into a PLAIN object, and the
// brand key comes from the user's own CSV.
//
// `parseCatalogueCsv` keeps an unrecognised `brand_key` VERBATIM — that is its
// stated contract, and the right one: silently rewriting someone's vocabulary
// is worse than reporting it. So a row saying `brand_key: __proto__` reaches
// the view, where
//
//     if (!groups[bk]) groups[bk] = [];
//     groups[bk].push(k);
//
// resolves `groups["__proto__"]` to `Object.prototype` — truthy, so the
// initialisation is skipped — and then calls `.push` on it, which is
// `undefined`. The TypeError happens during render, so the root error boundary
// replaces the whole app, not just this page.
//
// WHY THIS DOOR IS REAL. The catalogue is an EXCHANGEABLE artefact: the app
// ships a downloadable template, an export, and a cloud save/restore pair. "A
// friend sent me their catalogue" is the intended workflow. Unlike the
// `ghosting.ts` brick this one is recoverable — the catalogue chunk only loads
// for `view === "catalog"`, so a reload gets the user back — but the Catalogue
// page stays unusable until they remove the file.
//
// The sibling idiom at `pipeMaint.ts` (`(map[k] || (map[k] = [])).push()`) is
// the same shape on a null-prototype map and is safe; this was the plain one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor, fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { loadCatalogueFixture, resetCatalogueFixture, useCatalogueCsv } from "../catalogueFixture";

vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import { CuratorCatalogView } from "../../views/curator/CatalogView";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../../utils/tobaccoDb";
import { parseCatalogueCsv } from "../../utils/userCatalogue.ts";
import { BT, BW } from "../../constants";

beforeEach(() => {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
});

// Three brand keys that resolve to something truthy on Object.prototype, plus
// one ordinary brand so the page has something legitimate to group as well.
const POISONED_CSV = [
  "brand_key;brand_name;blend_name;category;cut",
  "__proto__;Aldwych;Night Ferry;Virginia;Flake",
  "constructor;Vondel;Kade 12;Latakia;Ribbon",
  "tostring;Corvane;Blue Ensign;Burley;Plug",
  "halvorsen;Halvorsen;Early Tide;Virginia;Flake",
].join("\n");

function ctx(over: any = {}) {
  return {
    view: "catalog",
    data: { tobaccos: [], wishlist: [] },
    BT, BW,
    addTobacco: vi.fn(),
    addWish: vi.fn(),
    nav: vi.fn(),
    ...over,
  };
}

describe("the catalogue page survives a forged brand key", () => {
  it("the parser really does keep the forged key — so the case is not vacuous", () => {
    // If a future normalisation started rejecting these, this test would go on
    // passing while testing nothing. Assert the premise.
    //
    // The FIRST version of this assertion read `Object.keys(parsed.db)` and
    // failed — the parse result is `{ brands, blends }` and the blend map is
    // one level down. Recorded because it is the point of asserting a premise
    // at all: it was my reading of the shape that was wrong, not the parser.
    const parsed = parseCatalogueCsv(POISONED_CSV);
    const keys = Object.keys((parsed.db as any).blends);
    expect(keys.some((k) => k.startsWith("__proto__|"))).toBe(true);
    expect(keys.some((k) => k.startsWith("constructor|"))).toBe(true);
    expect(parsed.blends).toBe(4);
  });

  it("renders the grouped view without throwing, and groups every brand", async () => {
    useCatalogueCsv(POISONED_CSV);
    _resetTobaccoDbForTests();
    await loadTobaccoDb();
    // Grouping is this view's DEFAULT (`grouped` is local state seeded true),
    // so the map is built on the first render. Before the fix this threw
    // `groups[bk].push is not a function` and took the whole app to the error
    // boundary.
    const { container } = renderWithCtx(<CuratorCatalogView />, ctx());
    await waitFor(() => {
      expect(container.textContent || "").toContain("Halvorsen");
    });
    // The fix must not have been "drop the forged rows": the catalogue is the
    // user's own file, and a row the app cannot classify is still a row they
    // typed. Groups render collapsed, so what is on screen is the brand's
    // DISPLAY name — which is exactly what the poisoned key maps to.
    const text = container.textContent || "";
    for (const brand of ["Aldwych", "Vondel", "Corvane", "Halvorsen"]) {
      expect(text, `${brand} vanished from the catalogue`).toContain(brand);
    }
  });

  it("a forged brand group can actually be expanded", async () => {
    // The quieter half of the same defect, and the one a user would report as
    // "this group does not open". `collapsed` is keyed by the same brand key:
    // the read resolves to `Object.prototype` (so `!== false` keeps it shut)
    // and `toggleGroup`'s write goes through the `__proto__` setter, which
    // ignores a non-object — so the group stays collapsed however many times
    // it is tapped.
    useCatalogueCsv(POISONED_CSV);
    _resetTobaccoDbForTests();
    await loadTobaccoDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, ctx());
    await waitFor(() => {
      expect(container.textContent || "").toContain("Aldwych");
    });
    expect(container.textContent || "").not.toContain("Night Ferry");

    // The group header is a PressCard (a div with role="button"), and
    // PressCard swallows a programmatic click via its ghost-click defence —
    // so activate by KEYBOARD, which also exercises the a11y path.
    const header = Array.from(container.querySelectorAll('[role="button"]'))
      .find((b) => (b.textContent || "").includes("Aldwych")) as HTMLElement | undefined;
    expect(header, "no group header for the forged brand").toBeTruthy();
    fireEvent.keyDown(header!, { key: "Enter" });

    await waitFor(() => {
      expect(container.textContent || "").toContain("Night Ferry");
    });
  });
});
