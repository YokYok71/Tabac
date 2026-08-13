// The one-tap catalogue fill was hidden on every FRESH
// INSTALL, which is the only install that has no other way to fill a fiche.
//
// `dbHinted` read `if (autofillSource === "ai") return false`. The reason
// originally given is sound and is still true: under "ai" the tap goes to the
// provider first, so promising an instant catalogue fill would mislead. But
// `autofillSource` only DESCRIBES what the tap does when there is a key to
// call — `runAutoFill`'s AI-first branch goes STRAIGHT to `tobaccoDbLookup`
// When `!apiKey`. With "ai" the shipped default at the time, a new
// user with no key would have had the form filled instantly by that tap, and
// the banner offering it was the single thing suppressed.
//
// The default later moved back to "local", so a fresh install no longer
// reaches this gate — but these cases are NOT obsolete, and the first one's
// name was corrected rather than the case deleted: what they protect is now
// "picked Agent IA, has no key", which is the same defect through the door
// that is still open (choosing the provider, then never configuring one, or
// clearing the key later).
//
// The gate now keys on what the tap will ACTUALLY do. These cases drive the
// real views with a mocked catalogue, so they check the DECISION and not the
// spelling of it — the placement block in CatalogOffer.test.tsx already reads
// the source, and a source assertion here would pass on a rewrite that
// reintroduced the defect in different words.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithCtx } from "../viewTestUtils";

vi.mock("../../utils/tobaccoDb.ts", () => ({
  loadTobaccoDb: () => Promise.resolve({ blends: {}, brands: {} }),
  // A hit with fields the empty form lacks, so `catalogueCanFill` says yes.
  tobaccoDbLookupSync: () => ({
    brand: "Halvorsen", name: "Duskfall", category: "Anglais", cut: "Ready Rubbed",
    blend: "Virginia, Latakia, Perique", force: 4, roomNote: 3, taste: 4,
    agingMax: "", description: "A classic English blend.",
  }),
  tobaccoDbCanonicalKey: () => null,
  tobaccoDbSearchMatch: () => false,
  isTobaccoDbReady: () => true,
}));

import { CuratorTobaccoFormView } from "../../views/curator/TobaccoFormView";
import { CuratorWishFormView } from "../../views/curator/WishFormView";

const form = {
  name: "Duskfall", brand: "Halvorsen", category: "", cut: "", blend: "",
  force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
  imageUrl: "", tastingNotes: "", description: "", agingMax: "", lots: [],
};

const shown = (c: HTMLElement) => (c.textContent || "").includes("ai_db_hint");

async function renderTob(over: Record<string, any>) {
  const r = renderWithCtx(<CuratorTobaccoFormView />, {
    view: "addT", form, setForm: vi.fn(), data: { tobaccos: [], wishlist: [] },
    ...over,
  });
  // dbReady flips in a .finally() on the mocked load — let it land.
  await vi.waitFor(() => expect(r.container.textContent).toBeTruthy());
  await new Promise((res) => setTimeout(res, 0));
  return r;
}

async function renderWish(over: Record<string, any>) {
  const r = renderWithCtx(<CuratorWishFormView />, {
    showWishForm: true, editWishId: null, wishForm: form, setWishForm: vi.fn(),
    data: { tobaccos: [], wishlist: [] }, BW: {}, ...over,
  });
  await new Promise((res) => setTimeout(res, 0));
  return r;
}

describe("the catalogue offer reaches a fresh install", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("tobacco form: shown under source 'ai' when no API key is set", async () => {
    // This was the fresh-install state before the default moved to
    // "local"; it is now the "picked Agent IA, no key" state. Before the fix
    // this was `false`, and the tap would still have filled from the catalogue.
    const { container } = await renderTob({ autofillSource: "ai", apiKey: "" });
    expect(shown(container), "a new user must be offered the catalogue fill").toBe(true);
  });

  it("tobacco form: still hidden once a key IS configured", async () => {
    // The reason survives intact: with a key the tap really does go
    // to the provider first, so the instant-fill promise would be false.
    const { container } = await renderTob({ autofillSource: "ai", apiKey: "sk-real" });
    expect(shown(container)).toBe(false);
  });

  it("tobacco form: shown under the 'local' source whether or not a key exists", async () => {
    const a = await renderTob({ autofillSource: "local", apiKey: "" });
    expect(shown(a.container)).toBe(true);
    a.unmount();
    const b = await renderTob({ autofillSource: "local", apiKey: "sk-real" });
    expect(shown(b.container)).toBe(true);
  });

  it("wishlist form: the same three answers — the two forms must not diverge", async () => {
    const a = await renderWish({ autofillSource: "ai", apiKey: "" });
    expect(shown(a.container), "fresh install").toBe(true);
    a.unmount();
    const b = await renderWish({ autofillSource: "ai", apiKey: "sk-real" });
    expect(shown(b.container), "key configured").toBe(false);
    b.unmount();
    const c = await renderWish({ autofillSource: "local", apiKey: "" });
    expect(shown(c.container), "local source").toBe(true);
  });

  it("is still silent with only one identity field — the match needs both", async () => {
    const { container } = await renderTob({
      autofillSource: "ai", apiKey: "",
      form: { ...form, name: "" },
    });
    expect(shown(container)).toBe(false);
  });
});
