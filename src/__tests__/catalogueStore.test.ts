// Where a user's own catalogue lives between sessions.
//
// The fake below is a MINIMAL IndexedDB, deliberately: mocking the store away
// would leave its actual logic — the parse gate, the version-stamped cache,
// the write-failure paths — untested, and those are the whole module. What is
// faked is the browser API; what runs is `catalogueStore.ts`.
//
// The write contract is the part that has bitten this codebase twice. An
// IDBTransaction failure is NOT a rejection: a quota-exceeded write ABORTS,
// and depending on the engine that surfaces as `abort` rather than `error`.
// An earlier release lost cover photos exactly there (`.then` ran with `ok === false`
// and the app confirmed a key whose blob never persisted); another release
// lost imported ones on the other side of the same mistake. So the fake can be told
// to fail by either route, and both must be observed.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── a small in-memory IndexedDB ─────────────────────────────────────────────
type Mode = "ok" | "error" | "abort" | "open-fail";
let mode: Mode = "ok";
let store: Record<string, any> = {};
/** Set to fail only writes whose key set includes this one. */
let failOn: string | null = null;
/** how many transactions were opened — `catalogueSave`
 *  promises the three records land in ONE, and nothing checked it. */
let txCount = 0;

function installFakeIdb() {
  const later = (fn: () => void) => setTimeout(fn, 0);
  (globalThis as any).indexedDB = {
    open(_name: string, _v: number) {
      const req: any = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      later(() => {
        if (mode === "open-fail") { if (req.onerror) req.onerror(); return; }
        const db: any = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          transaction(_s: string, _m: string) {
            txCount++;
            const t: any = { oncomplete: null, onerror: null, onabort: null };
            const touched: string[] = [];
            // A real aborted transaction ROLLS BACK. Without this the fake
            // keeps whatever the writes put there, and a test asserting "the
            // failed write left no trace" would be passing on the fake rather
            // than on the code.
            const undo: Array<[string, any, boolean]> = [];
            const remember = (k: string) => {
              undo.push([k, store[k], Object.prototype.hasOwnProperty.call(store, k)]);
            };
            const rollback = () => {
              for (let i = undo.length - 1; i >= 0; i--) {
                const [k, v, had] = undo[i]!;
                if (had) store[k] = v; else delete store[k];
              }
            };
            t._rollback = rollback;
            t.objectStore = () => ({
              put(v: any, k: string) { touched.push(k); remember(k); store[k] = v; },
              get(k: string) {
                const r: any = { onsuccess: null, onerror: null, result: undefined };
                later(() => {
                  if (mode === "error") { if (r.onerror) r.onerror(); return; }
                  r.result = store[k];
                  if (r.onsuccess) r.onsuccess();
                });
                return r;
              },
              delete(k: string) { touched.push(k); remember(k); delete store[k]; },
            });
            later(() => {
              const targeted = failOn === null || touched.includes(failOn);
              if (mode === "error" && targeted) { rollback(); if (t.onerror) t.onerror(); return; }
              if (mode === "abort" && targeted) { rollback(); if (t.onabort) t.onabort(); return; }
              if (t.oncomplete) t.oncomplete();
            });
            return t;
          },
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

const CSV = [
  "brand_key,brand_name,blend_name,category,cut,force,roomNote,taste,blend,description_fr",
  "Halvorsen,Halvorsen,Duskfall,Anglais,Ribbon,4,3,4,Virginia|Latakia,Un anglais corsé.",
  "Pellworm,Pellworm,Slate Harbour,Dark Fired,Ready Rubbed,4,3,4,Kentucky,Un kentucky fumé.",
].join("\n") + "\n";

let mod: typeof import("../utils/catalogueStore.ts");

beforeEach(async () => {
  mode = "ok"; store = {}; failOn = null; txCount = 0;
  installFakeIdb();
  vi.resetModules();
  mod = await import("../utils/catalogueStore.ts");
  mod._resetCatalogueStoreForTests();
});

describe("saving a catalogue", () => {
  it("stores the CSV, the parsed cache and the meta", async () => {
    const r = await mod.catalogueSave(CSV, "mon-catalogue.csv", 1_700_000_000_000);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.meta!.blends).toBe(2);
    expect(r.meta!.name).toBe("mon-catalogue.csv");
    expect(r.meta!.loadedAt).toBe(1_700_000_000_000);
    expect(r.meta!.langs).toEqual(["fr"]);
    // The RAW CSV is kept: it is the user's own file, what a backup carries,
    // and the only thing that makes a re-parse possible later.
    expect(typeof store["csv"]).toBe("string");
    expect(store["parsed"].blends["halvorsen|duskfall"]).toBeTruthy();
  });

  it("has no clock of its own — the caller injects the time", async () => {
    const a = await mod.catalogueSave(CSV, "a.csv", 111);
    expect(a.meta!.loadedAt).toBe(111);
  });

  it("REFUSES a file that yields no blends, and writes NOTHING", async () => {
    // Replacing a working catalogue with an empty one because the user picked
    // the wrong file is the failure this guard exists for.
    await mod.catalogueSave(CSV, "good.csv", 1);
    const before = JSON.stringify(store);
    const r = await mod.catalogueSave("not,a,catalogue\n1,2,3\n", "wrong.csv", 2);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("parse");
    expect(JSON.stringify(store), "the good catalogue must survive").toBe(before);
  });

  it("reports a write failure instead of claiming success — onerror", async () => {
    mode = "error";
    const r = await mod.catalogueSave(CSV, "x.csv", 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("write");
  });

  it("…and onABORT, which is how quota-exceeded surfaces on some engines", async () => {
    // The lesson: an aborted transaction never rejects. A caller that
    // only inspects `.catch` confirms a write that did not happen.
    mode = "abort";
    const r = await mod.catalogueSave(CSV, "x.csv", 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("write");
  });

  it("survives IndexedDB being unavailable entirely", async () => {
    delete (globalThis as any).indexedDB;
    mod._resetCatalogueStoreForTests();
    const r = await mod.catalogueSave(CSV, "x.csv", 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("write");
  });
});

describe("loading it back", () => {
  it("serves the parsed cache when the parser version matches", async () => {
    await mod.catalogueSave(CSV, "x.csv", 1);
    const db = await mod.catalogueLoad();
    expect(Object.keys(db!.blends)).toHaveLength(2);
    expect(db!.blends["halvorsen|duskfall"]!.category).toBe("Anglais");
  });

  it("RE-PARSES from the CSV when the cache came from another parser", async () => {
    // Otherwise a normalisation fix would never reach a catalogue already
    // loaded, and the app would keep serving a mapping the current code does
    // not agree with.
    await mod.catalogueSave(CSV, "x.csv", 1);
    store["meta"] = Object.assign({}, store["meta"], { parserVersion: -1 });
    store["parsed"] = { brands: {}, blends: { "stale|row": { name: "Stale" } } };
    const db = await mod.catalogueLoad();
    expect(Object.keys(db!.blends).sort()).toEqual(["halvorsen|duskfall", "pellworm|slate harbour"]);
    // …and the refreshed cache is written back, so the cost is paid once.
    expect(store["meta"].parserVersion).not.toBe(-1);
    expect(store["parsed"].blends["halvorsen|duskfall"]).toBeTruthy();
  });

  it("rebuilds from the CSV when the cache is missing or empty", async () => {
    await mod.catalogueSave(CSV, "x.csv", 1);
    delete store["parsed"];
    const db = await mod.catalogueLoad();
    expect(Object.keys(db!.blends)).toHaveLength(2);
  });

  it("returns null when nothing was ever loaded", async () => {
    expect(await mod.catalogueLoad()).toBeNull();
    expect(await mod.catalogueGetMeta()).toBeNull();
    expect(await mod.catalogueGetCsv()).toBeNull();
  });

  it("returns null rather than throwing when storage is broken", async () => {
    // Every caller treats null as "no user catalogue" and falls through to the
    // bundled one, so a rejection here would be an unhandled one.
    mode = "open-fail";
    mod._resetCatalogueStoreForTests();
    await expect(mod.catalogueLoad()).resolves.toBeNull();
    await expect(mod.catalogueGetMeta()).resolves.toBeNull();
    await expect(mod.catalogueGetCsv()).resolves.toBeNull();
  });

  it("a re-parse that cannot write still serves the catalogue", async () => {
    // The cache refresh is best-effort: failing it costs a re-parse next
    // session, never correctness.
    await mod.catalogueSave(CSV, "x.csv", 1);
    store["meta"] = Object.assign({}, store["meta"], { parserVersion: -1 });
    // Fail WRITES only. A blanket `mode = "abort"` also aborts the read that
    // fetches the CSV, and then there is genuinely nothing to serve — which is
    // what the first version of this case actually asserted, and why it failed
    // against correct code. `failOn` targets transactions that touch a written
    // key; a read transaction writes none, so it completes.
    mode = "abort"; failOn = "parsed";
    const db = await mod.catalogueLoad();
    expect(Object.keys(db!.blends)).toHaveLength(2);
    // …and the cache is still stale, so next session pays the parse again.
    expect(store["meta"].parserVersion).toBe(-1);
  });

  it("returns null when even the CSV cannot be read back", () => {
    // The other half of the case above, made explicit: a re-parse needs the
    // CSV, and without it the only honest answer is "no user catalogue" — the
    // caller then falls through to the bundled one.
    return (async () => {
      await mod.catalogueSave(CSV, "x.csv", 1);
      store["meta"] = Object.assign({}, store["meta"], { parserVersion: -1 });
      mode = "abort"; failOn = null;
      expect(await mod.catalogueLoad()).toBeNull();
    })();
  });
});

describe("the meta line and the user's file", () => {
  it("meta reads without touching the CSV or the cache", async () => {
    await mod.catalogueSave(CSV, "mine.csv", 42);
    const m = await mod.catalogueGetMeta();
    expect(m!.name).toBe("mine.csv");
    expect(m!.blends).toBe(2);
    expect(m!.csvChars).toBe(CSV.length);
  });

  it("hands the user's own file back, byte for byte", async () => {
    await mod.catalogueSave(CSV, "mine.csv", 1);
    expect(await mod.catalogueGetCsv()).toBe(CSV);
  });

  it("carries what the import could not read, so the UI can say so", async () => {
    const dirty = [
      "brand_key,blend_name,category,cut",
      "B,A,Zzz,Qqq",
      ",Orphan,,",
      "B,A,Anglais,Ribbon",
    ].join("\n") + "\n";
    const r = await mod.catalogueSave(dirty, "d.csv", 1);
    expect(r.ok).toBe(true);
    expect(r.meta!.unknownCategories).toEqual(["Zzz"]);
    expect(r.meta!.unknownCuts).toEqual(["Qqq"]);
    expect(r.meta!.skippedNoIdentity).toBe(1);
    expect(r.meta!.duplicateKeys).toBe(1);
  });

  it("caps a runaway file name", async () => {
    const r = await mod.catalogueSave(CSV, "x".repeat(500), 1);
    expect(r.meta!.name.length).toBeLessThanOrEqual(120);
  });
});

describe("clearing", () => {
  it("removes all three records", async () => {
    await mod.catalogueSave(CSV, "x.csv", 1);
    expect(await mod.catalogueClear()).toBe(true);
    expect(store["csv"]).toBeUndefined();
    expect(store["parsed"]).toBeUndefined();
    expect(store["meta"]).toBeUndefined();
    expect(await mod.catalogueLoad()).toBeNull();
  });

  it("reports failure rather than claiming the catalogue is gone", async () => {
    await mod.catalogueSave(CSV, "x.csv", 1);
    mode = "abort";
    expect(await mod.catalogueClear()).toBe(false);
  });
});

describe("ONE transaction, and it is a promise the code makes", () => {
  // `catalogueSave`'s own comment says « One transaction, so a partial write is
  // not possible » — and a probe rewriting it into three sequential `put()`
  // calls left the WHOLE suite green. The rollback cases below prove a FAILED
  // write leaves no trace; nothing proved the three records are atomic in the
  // first place, which is what makes that guarantee mean anything.

  it("the three records are written in a single transaction", async () => {
    const before = txCount;
    expect(await mod.catalogueSave(CSV, "x.csv", 1)).toMatchObject({ ok: true });
    // One open() + one write transaction. What matters is that the WRITE is
    // one, so the bound is stated generously and still catches a 3-way split.
    expect(txCount - before, "transactions opened by one save").toBeLessThanOrEqual(2);
    expect(store["csv"]).toBeTruthy();
    expect(store["parsed"]).toBeTruthy();
    expect(store["meta"]).toBeTruthy();
  });

  it("THE CONSEQUENCE: a failure on the LAST record leaves none of the three", async () => {
    // Split into three transactions this passes for the first two keys and
    // then strands a CSV with no meta — a catalogue the status panel cannot
    // describe and `catalogueLoad` re-parses on every launch.
    mode = "abort"; failOn = "meta";
    expect(await mod.catalogueSave(CSV, "x.csv", 1)).toMatchObject({ ok: false, reason: "write" });
    expect(store["csv"], "no orphaned CSV").toBeUndefined();
    expect(store["parsed"], "no orphaned cache").toBeUndefined();
    expect(store["meta"]).toBeUndefined();
  });

  it("…and a previously-stored catalogue survives a failed replacement intact", async () => {
    // The reason the guard exists at all: replacing a working catalogue with
    // half of a new one is worse than refusing the new one.
    await mod.catalogueSave(CSV, "first.csv", 1);
    const keptCsv = store["csv"], keptMeta = store["meta"];
    mode = "abort"; failOn = "meta";
    expect(await mod.catalogueSave(CSV, "second.csv", 2)).toMatchObject({ ok: false });
    expect(store["csv"]).toBe(keptCsv);
    expect(store["meta"]).toBe(keptMeta);
    expect(store["meta"].name, "still the first file").toBe("first.csv");
  });
});
