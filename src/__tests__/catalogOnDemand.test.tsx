/**
 * The catalogue loads as ONE unit, and it loads ONLY on a catalogue surface.
 *
 * THIS FILE ONCE LOCKED THE OPPOSITE RULE, and the reversal is
 * deliberate. An earlier release split the load in two: the 32 KB specs base on form
 * open, the 122 KB prose only once a typed blend matched. The saving was real
 * — a blend outside the catalogue never needs the prose — but the two-phase
 * load had a defect no byte count could show.
 *
 * On an EXISTING tobacco the brand and name are already filled, so the match
 * fires on the first render and the "sync with the catalogue" offer appears
 * about a second before the prose lands. Tapping it inside that second synced
 * every field EXCEPT the description, which was therefore never saved — so
 * re-opening the fiche offered the same update again. Reproduced at 200/200
 * catalogued blends. The user's report: "I update from the catalogue, I save,
 * and when I reopen it asks me to update again."
 *
 * The ONE-UNIT rule is now free, and the ON-DEMAND rule is
 * what still needs guarding. A user's catalogue is one CSV carrying all six
 * languages inline, so there is no second phase to get wrong and no
 * `ensureLangDescriptions` to call late; `loadTobaccoCatalogue(lang)` went with
 * it and the views call `loadTobaccoDb()`. What has not changed is the cold-
 * start gating: the three catalogue surfaces are mounted
 * unconditionally, so an ungated load would read the catalogue on the home
 * screen — and that is still invisible to any rendered-output assertion, which
 * is why these cases exist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithCtx } from "./viewTestUtils";

const loadTobaccoDb = vi.fn(() => Promise.resolve({ blends: {}, brands: {} }));

// PARTIAL mock — the spread is load-bearing, not tidiness.
//
// A `vi.mock` FACTORY replaces the module wholesale: an export it does not
// list does not fall back, it THROWS on access. So every export added to
// `tobaccoDb.ts` and then read by a view broke this file, and broke it in the
// worst available way — a release added `tobaccoDbFailKind()` to both form
// views, inside a `.finally()`, i.e. after each test had already resolved.
// All five assertions passed, vitest printed "3754 passed", and exited 1 on
// the unhandled error. A green summary is not a green run.
//
// With `importOriginal` the failure mode is gone rather than patched: an
// unlisted export is simply the real one. What stays below is only what these
// cases deliberately STAGE — the load spy, plus the lookups pinned so no case
// depends on catalogue contents.
vi.mock("../utils/tobaccoDb.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/tobaccoDb.ts")>()),
  loadTobaccoDb: (...a: unknown[]) => loadTobaccoDb(...(a as [])),
  tobaccoDbCanonicalKey: () => null,
  tobaccoDbLookupSync: () => null,
  tobaccoDbSearchMatch: () => false,
  // The real one reads the cache the spy above never fills, so it must be
  // stated: the views gate their render on it.
  isTobaccoDbReady: () => true,
}));

const { CuratorTobaccoFormView } = await import("../views/curator/TobaccoFormView");
const { CuratorWishFormView } = await import("../views/curator/WishFormView");
const { CuratorCatalogView } = await import("../views/curator/CatalogView");

const blank = {
  name: "", brand: "", category: "", cut: "", blend: "",
  force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
  imageUrl: "", tastingNotes: "", description: "", agingMax: "", lots: [],
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  loadTobaccoDb.mockClear();
});

describe("the catalogue loads as one unit", () => {
  it("the tobacco form loads the catalogue when it opens", async () => {
    renderWithCtx(<CuratorTobaccoFormView />, { view: "addT", form: blank, lang: "fr" });
    await waitFor(() => expect(loadTobaccoDb).toHaveBeenCalled());
  });

  it("an UNKNOWN blend loads it too — the match does not gate it", async () => {
    // The reversal: the prose is present without waiting for a match,
    // so the sync offer is never computed from specs alone. With one inline
    // file that is true by construction; the case stays because what it pins
    // is the OUTCOME (never a half-loaded catalogue behind the offer).
    renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT", lang: "fr",
      form: { ...blank, brand: "Marque Inconnue", name: "Mélange Maison" },
    });
    await waitFor(() => expect(loadTobaccoDb).toHaveBeenCalled());
  });

  it("the wishlist form does the same", async () => {
    // NOTE: the ctx key is `wishForm` (destructured as `form` inside the view),
    // not `form`. Passing `form` here made an earlier test fail against correct
    // code — the mistake was in the test, which is the right way round.
    renderWithCtx(<CuratorWishFormView />, { showWishForm: true, wishForm: blank, lang: "it" });
    await waitFor(() => expect(loadTobaccoDb).toHaveBeenCalled());
  });

  it("the catalogue browser does the same", async () => {
    renderWithCtx(<CuratorCatalogView />, { view: "catalog", lang: "de" });
    await waitFor(() => expect(loadTobaccoDb).toHaveBeenCalled());
  });

  it("nothing is read while every catalogue surface is closed", async () => {
    // The cold-start rule, and the only case here that can still fail:
    // all three views are mounted unconditionally by CuratorApp, so an ungated
    // load would hit the catalogue on the home screen.
    renderWithCtx(<CuratorTobaccoFormView />, { view: "home", form: blank, lang: "fr" });
    await settle(); await settle();
    expect(loadTobaccoDb).not.toHaveBeenCalled();
  });
});
