/**
 * The contract that kills the "it asks me to update again" bug.
 *
 * `loadTobaccoDb()` must resolve ONLY when the specs AND the description prose
 * are both in memory. Everything downstream rests on that: `dbReady` flips
 * once, `useDbSync` computes one diff, and the diff is complete — so applying
 * it saves every field the offer promised.
 *
 * The contract is now free by construction — a user's CSV
 * carries all six languages inline, so there is nothing to fetch second. The
 * cases stay because the CONTRACT is what downstream depends on, not the
 * mechanism that happened to satisfy it, and the last one reproduces the
 * user-visible loop end to end.
 *
 * The bug this replaces: with the two-phase load, opening an existing tobacco
 * matched instantly (brand and name already filled) and showed the sync offer
 * ~1 s before the prose arrived. Tapping it in that window synced everything
 * except the description, which was therefore never stored, so the next open
 * offered the same update again. Reproduced at 200/200 catalogued blends.
 *
 * These are DELIBERATELY tests of the loader and not of a rendered banner: the
 * defect was a timing window, and no assertion on output can see one. What is
 * checkable is the promise's contract — that when it resolves, nothing is
 * missing yet to come.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCatalogueFixture, resetCatalogueFixture } from "./catalogueFixture.ts";

vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import {
  loadTobaccoDb,
  tobaccoDbLookupSync,
  _resetTobaccoDbForTests,
} from "../utils/tobaccoDb.ts";

// A blend that is certainly in the bundled catalogue, and certainly has prose:
// It is the pair the entry forms use as their placeholder, so it is
// already load-bearing elsewhere and cannot quietly disappear.
const MARQUE = "Halvorsen";
const MELANGE = "Duskfall";

describe("the catalogue resolves as one unit", () => {
  beforeEach(() => {
    resetCatalogueFixture();
    _resetTobaccoDbForTests();
  });

  it("a description is available the instant the load resolves", async () => {
    const db = await loadTobaccoDb();
    expect(db, "the bundled catalogue must load").toBeTruthy();
    const hit: any = tobaccoDbLookupSync(MARQUE, MELANGE, "fr");
    expect(hit, `${MARQUE} ${MELANGE} must be in the catalogue`).toBeTruthy();
    // THE assertion. On the two-phase load this was "" at this point, and that
    // empty string is the whole bug: a field missing from the diff is a field
    // the user's tap never saves.
    expect(
      String(hit.description || "").trim(),
      "prose missing when the load resolved → the sync offer would be partial",
    ).not.toBe("");
  });

  it("a second call is a no-op and keeps the prose", async () => {
    await loadTobaccoDb();
    await loadTobaccoDb();
    const hit: any = tobaccoDbLookupSync(MARQUE, MELANGE, "fr");
    expect(String(hit.description || "").trim()).not.toBe("");
  });

  it("specs are enough to MATCH, without reading any prose", async () => {
    // This used to be "without a language it loads the specs
    // ONLY", i.e. the cheap half of a two-phase load. There is no second phase
    // any more: a user's CSV carries every language inline, so one read gives
    // the whole catalogue. What the case was really protecting survives and is
    // what it asserts now — identity matching (duplicate detection, search)
    // needs the specs and nothing else.
    const db = await loadTobaccoDb();
    expect(db).toBeTruthy();
    const hit: any = tobaccoDbLookupSync(MARQUE, MELANGE, "fr");
    expect(hit).toBeTruthy();
    expect(hit.category, "specs must be present").toBeTruthy();
  });

  it("applying the catalogue values leaves nothing to re-apply", async () => {
    // The user's loop, end to end: sync a blank form from the catalogue, then
    // recompute the diff exactly as re-opening the fiche would.
    await loadTobaccoDb();
    const hit: any = tobaccoDbLookupSync(MARQUE, MELANGE, "fr");
    const CHAMPS = ["name", "brand", "category", "cut", "blend", "force", "roomNote", "taste", "agingMax", "description"];
    const CLE: Record<string, string> = { brand: "brandDisplay" };
    const diff = (form: any) =>
      CHAMPS.filter((f) => {
        const db = hit[CLE[f] || f], cur = form[f];
        if (typeof db === "number" || typeof cur === "number") {
          if (!db && db !== 0) return false;
          return Number(db) !== Number(cur || 0);
        }
        const a = String(db || "").trim();
        return a !== "" && a !== String(cur || "").trim();
      });

    const form: any = { name: MELANGE, brand: MARQUE };
    const premier = diff(form);
    expect(premier.length, "there must be something to sync in the first place").toBeGreaterThan(0);
    expect(premier, "the description is the field the old race dropped").toContain("description");
    for (const f of premier) form[f] = hit[CLE[f] || f];
    expect(diff(form), "re-opening the fiche must offer nothing").toEqual([]);
  });
});
