/**
 * merging two catalogue rows must not make a name unfindable.
 *
 * A catalogue can carry two rows for what is really ONE product, sold under a
 * single compound name and identical on every column. Merging them is right;
 * a plain DELETION would not be, because a user's tin is labelled one way or
 * the other and the catalogue is a LOOKUP aid — so the dropped name has to
 * keep resolving. The mechanism already existed (`blend_aliases`), and this
 * file is the assertion that it works end to end rather than merely shipping
 * in the data: the alias must resolve through the real lookup, which is the
 * only thing a user ever touches.
 *
 * The prose is MERGED, not replaced, for the same reason — each row can carry
 * a fact the other does not, and a deletion that keeps one loses information
 * that was verified once.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCatalogueFixture, resetCatalogueFixture } from "./catalogueFixture.ts";

vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import {
  loadTobaccoDb,
  tobaccoDbLookupSync,
  tobaccoDbCanonicalKey,
  _resetTobaccoDbForTests,
} from "../utils/tobaccoDb.ts";

const BRAND = "Aldwych";
const KEPT = "Centenary Pipe Tobacco";
const DROPPED = "50th Anniversary";

describe("a merged catalogue row keeps every name findable", () => {
  beforeEach(() => { resetCatalogueFixture(); _resetTobaccoDbForTests(); });

  it("still resolves the name that was kept", async () => {
    await loadTobaccoDb();
    expect(tobaccoDbLookupSync(BRAND, KEPT, "fr")).toBeTruthy();
  });

  it("resolves the DROPPED name through the alias — the point of the merge", async () => {
    await loadTobaccoDb();
    const hit = tobaccoDbLookupSync(BRAND, DROPPED, "fr");
    expect(hit, "a tin labelled '50th Anniversary' must still find the blend").toBeTruthy();
  });

  it("resolves the retailer's compound name too", async () => {
    await loadTobaccoDb();
    expect(tobaccoDbLookupSync(BRAND, "Centenary - 50th Anniversary", "fr")).toBeTruthy();
    expect(tobaccoDbLookupSync(BRAND, "Centenary", "fr")).toBeTruthy();
  });

  it("maps both names to the SAME canonical key", async () => {
    await loadTobaccoDb();
    const a = tobaccoDbCanonicalKey(BRAND, KEPT);
    const b = tobaccoDbCanonicalKey(BRAND, DROPPED);
    expect(a).toBeTruthy();
    // This is what makes the duplicate actually GONE: the owned/wished badges
    // and the duplicate-entry warning both key on this string, so two spellings
    // collapsing to one key is the merge being real rather than cosmetic.
    expect(b).toBe(a);
  });

  // REMOVED — "keeps the facts from BOTH proses, in every language".
  //
  // It pinned editorial CONTENT of the merged row's six descriptions: a fact
  // carried by each original. The catalogue those proses came from is no longer in this
  // repo — the fixture is synthetic — so the case lost its SUBJECT, exactly
  // like the three cases removed with the Node catalogue tooling.
  //
  // It was deliberately not rewritten against the synthetic prose: that would
  // assert the fixture generator's own template and prove nothing. The four
  // cases above are structural (alias resolution, canonical identity) and are
  // what the merge actually has to guarantee; they survive the substitution.
  //
  // If a curated catalogue is ever shipped again, restore this case WITH it.
});
