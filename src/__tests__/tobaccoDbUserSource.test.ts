// The user's catalogue is the source.
//
// An earlier release made `loadTobaccoDb` resolve a SOURCE — the user's file first, the
// bundled chunk as a fallback — and this file guarded the two things that had
// to hold: that a user catalogue was actually served, and that
// `ensureLangDescriptions` STOOD DOWN for it (a user CSV carries every
// language inline; merging the app's own chunk on top would have overwritten
// the user's prose, silently, for the blends whose keys collide).
//
// THE FALLBACK IS GONE, and with it half of these cases. The
// app ships no catalogue: `loadTobaccoDb` reads the store or resolves null.
// What survives is what still has a way to be wrong — the store is consulted,
// a catalogue with no blends is refused, a throw does not take the app down,
// the load is deduped, and the cache is invalidated when the user changes
// their file. The chunk-merge cases are not "moved elsewhere": there are no
// chunks. The `null` cases below are the same assertions read the other way
// round, and they matter MORE now, because null is the ordinary state of a
// fresh install rather than a failure.
//
// The store is mocked at the MODULE boundary — the convention `gcOrphans` and
// `exportImport` already use for `imgCache`. Its own logic has its own suite.

import { describe, it, expect, beforeEach, vi } from "vitest";

const userDb = {
  brands: { halvorsen: { displayName: "Halvorsen", country: "?", tier: 3, status: "active" } },
  blends: {
    "halvorsen|duskfall": {
      name: "Duskfall", category: "Anglais", cut: "Ribbon",
      blend: "Virginia, Latakia", force: 4, roomNote: 3, taste: 4, agingMax: "",
      // The user's OWN prose, in every language their file carried.
      description: { fr: "PROSE UTILISATEUR", en: "USER PROSE" },
    },
  },
};

let catalogueLoad = vi.fn(async () => null as any);
vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: (...a: any[]) => catalogueLoad(...(a as [])),
  catalogueSave: vi.fn(),
  catalogueClear: vi.fn(),
  catalogueGetMeta: vi.fn(),
  catalogueGetCsv: vi.fn(),
  _resetCatalogueStoreForTests: vi.fn(),
}));

let db: typeof import("../utils/tobaccoDb.ts");

beforeEach(async () => {
  vi.resetModules();
  catalogueLoad = vi.fn(async () => null as any);
  db = await import("../utils/tobaccoDb.ts");
  db._resetTobaccoDbForTests();
});

describe("source resolution", () => {
  it("serves the USER catalogue when there is one", async () => {
    catalogueLoad = vi.fn(async () => userDb as any);
    const loaded = await db.loadTobaccoDb();
    expect(loaded!.blends["halvorsen|duskfall"]!.description["fr"]).toBe("PROSE UTILISATEUR");
    expect(db.isTobaccoDbReady()).toBe(true);
    expect(db.tobaccoDbSize()).toBe(1);
  });

  it("resolves null when the user has no catalogue — the fresh-install state", async () => {
    // REVERSAL recorded on the assertion: this fell back to
    // the bundled chunk and asserted 1000+ blends. There is no chunk. What
    // callers must handle is null, and every catalogue surface now says so
    // and points at Réglages → Données.
    const loaded = await db.loadTobaccoDb();
    expect(loaded).toBeNull();
    expect(db.isTobaccoDbReady()).toBe(false);
    expect(db.tobaccoDbSize()).toBe(0);
  });

  it("survives a store that THROWS, rather than taking the caller down", async () => {
    catalogueLoad = vi.fn(async () => { throw new Error("idb exploded"); });
    const loaded = await db.loadTobaccoDb();
    expect(loaded).toBeNull();
  });

  it("ignores a stored catalogue with no blends — that is not a catalogue", async () => {
    catalogueLoad = vi.fn(async () => ({ brands: {}, blends: {} }) as any);
    const loaded = await db.loadTobaccoDb();
    expect(loaded).toBeNull();
  });

  it("loads ONCE — a second call does not re-consult the store", async () => {
    catalogueLoad = vi.fn(async () => userDb as any);
    await db.loadTobaccoDb();
    await db.loadTobaccoDb();
    expect(catalogueLoad).toHaveBeenCalledTimes(1);
  });

  it("dedupes CONCURRENT calls, so two surfaces opening at once load once", async () => {
    catalogueLoad = vi.fn(async () => userDb as any);
    const [a, b] = await Promise.all([db.loadTobaccoDb(), db.loadTobaccoDb()]);
    expect(a).toBe(b);
    expect(catalogueLoad).toHaveBeenCalledTimes(1);
  });
});

describe("invalidation", () => {
  it("re-resolves after the user loads or clears a catalogue", async () => {
    // Without this the module would serve the previous catalogue for the rest
    // of the session and the user would conclude the import had not worked.
    await db.loadTobaccoDb();
    expect(db.isTobaccoDbReady(), "nothing loaded yet").toBe(false);

    catalogueLoad = vi.fn(async () => userDb as any);
    db.tobaccoDbInvalidate();

    const loaded = await db.loadTobaccoDb();
    expect(db.isTobaccoDbReady()).toBe(true);
    expect(loaded!.blends["halvorsen|duskfall"]).toBeTruthy();
  });

  it("drops a loaded catalogue immediately, so a CLEAR is visible at once", async () => {
    catalogueLoad = vi.fn(async () => userDb as any);
    await db.loadTobaccoDb();
    expect(db.isTobaccoDbReady()).toBe(true);
    db.tobaccoDbInvalidate();
    expect(db.isTobaccoDbReady(), "the cache is dropped synchronously").toBe(false);
  });
});

describe("the user's own prose is what is served", () => {
  it("resolves ready-to-use: the description is there the instant the load is", async () => {
    // The rule: one load, one ready state, no window in which the
    // catalogue is present but its prose is not — that window is what made a
    // "sync with the catalogue" tap save an incomplete diff. It used to need
    // `ensureLangDescriptions` to have run; a user CSV carries every language
    // inline, so it holds by construction, and this is what asserts it.
    catalogueLoad = vi.fn(async () => JSON.parse(JSON.stringify(userDb)) as any);
    const loaded = await db.loadTobaccoDb();
    expect(loaded!.blends["halvorsen|duskfall"]!.description["fr"]).toBe("PROSE UTILISATEUR");
  });
});

describe("lookups work against a user catalogue", () => {
  it("resolves a blend, with the user's own description", async () => {
    catalogueLoad = vi.fn(async () => userDb as any);
    const hit = await db.tobaccoDbLookup("Halvorsen", "Duskfall", "fr");
    expect(hit).toBeTruthy();
    expect(hit!.category).toBe("Anglais");
    expect(hit!.description).toBe("PROSE UTILISATEUR");
  });

  it("a blend absent from the user's file simply misses", async () => {
    // The bundled catalogue must NOT answer for it — that would be the two
    // sources silently merging, and the user would see blends they never
    // put in their file.
    catalogueLoad = vi.fn(async () => userDb as any);
    const hit = await db.tobaccoDbLookup("Pellworm", "HH Old Dark Fired", "fr");
    expect(hit).toBeNull();
  });
});
