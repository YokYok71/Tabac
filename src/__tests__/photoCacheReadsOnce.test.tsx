// THE COVER PHOTOS WERE RE-READ FROM INDEXEDDB ON EVERY SAVE, TWICE OVER.
//
// MEASURED before the fix, by driving the real `App` over a 300-cover cellar
// with a counting `imgCache`: **600 `imgCache.get` calls on the cold load and
// 600 more on EVERY save** — a save that touched only `nxT`. Two effects were
// walking the same collections (one filtered to `local-photo-*` and also
// covering the session snapshots, one taking every `imageUrl` and covering
// none), so each cover was asked for twice, and both wrote the result back
// with `imgMap(prev, upd)` — a FRESH object — so `imgLocal` changed identity on
// every save even when the resolved set was byte-identical (measured: 300 keys
// before, 300 after, `before === after` false). Every consumer of the map
// therefore re-rendered for a map that had not changed.
//
// The rule this locks: **a key already in the map is never asked for again.**
// A key that is NOT in the map still is — that is the eviction / late-write
// case, and freezing it would be the opposite defect (a photo that arrives
// after the first look would never be picked up). Both halves are asserted,
// because asserting only the skip would pass on a build that stopped reading
// altogether.
//
// The second effect is GONE rather than given the same guard. It could only
// ever contribute a key that is truthy, resolvable from `imgCache`, and NOT
// `local-photo-*` — and `migrateData._clearForeignImageRefs` blanks every
// `imageUrl` that is not a `local-photo-*` key or a `data:image/…` URI, while a
// `data:` URI is never an `imgCache` key. The last case below pins that
// property, so the deletion cannot quietly start losing photos.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, act } from "@testing-library/react";

const GET_CALLS: string[] = [];
let STORE: Record<string, string> = {};

vi.mock("../utils/imgCache.ts", async () => {
  const real: any = await vi.importActual("../utils/imgCache.ts");
  return {
    ...real,
    imgCache: {
      open: () => Promise.resolve(null),
      get: (k: string) => {
        GET_CALLS.push(k);
        return Promise.resolve(STORE[k]);
      },
      put: (k: string, v: string) => {
        STORE[k] = v;
        return Promise.resolve(true);
      },
      clear: () => Promise.resolve(),
    },
    gcOrphans: () => Promise.resolve(0),
  };
});

// The probe replaces CuratorApp so the ctx (and therefore `save`, `imgLocal`)
// is reachable without driving the whole UI — App is the subject here, not the
// views it renders.
let CTX: any = null;
vi.mock("../CuratorApp.tsx", async () => {
  const R: any = await vi.importActual("react");
  const { useAppCtx }: any = await vi.importActual("../AppContext");
  function Probe() {
    CTX = useAppCtx();
    return R.createElement("div", null, "probe");
  }
  return { CuratorApp: Probe, default: Probe };
});

import App from "../App";
import { SK } from "../constants";

const PHOTO = "data:image/jpeg;base64,AAA";

function tobacco(id: number, imageUrl: string) {
  return {
    id,
    uid: "u" + id,
    name: "T" + id,
    brand: "B",
    category: "Virginia",
    cut: "Flake",
    force: 0,
    roomNote: 0,
    taste: 0,
    rating: 0,
    rebuy: null,
    tastingNotes: "",
    description: "",
    imageUrl,
    lots: [],
    agingMax: "",
  };
}

function cellar(tobaccos: any[], sessions: any[] = []) {
  return {
    tobaccos,
    pipes: [],
    accessories: [],
    sessions,
    wishlist: [],
    nxT: tobaccos.length + 1,
    nxP: 1,
    nxA: 1,
    nxJ: 1,
    nxW: 1,
  };
}

async function mount(data: any) {
  localStorage.setItem(SK, JSON.stringify(data));
  localStorage.setItem("cave-terms-accepted", "1");
  localStorage.setItem("cave-curator-welcomed", "1");
  localStorage.setItem("cave-last-export-ts", String(Date.now()));
  await act(async () => {
    render(<App />);
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

async function save(next: any) {
  await act(async () => {
    CTX.save(next);
  });
  await settle();
}

beforeEach(() => {
  GET_CALLS.length = 0;
  STORE = {};
  CTX = null;
  localStorage.clear();
});

describe("cover photos are read from IndexedDB once, not on every save", () => {
  it("a save that changes nothing photo-related re-reads nothing, and leaves the map's identity alone", async () => {
    const keys = ["local-photo-1700000000001-a", "local-photo-1700000000002-b"];
    keys.forEach((k) => (STORE[k] = PHOTO));
    await mount(cellar([tobacco(1, keys[0]!), tobacco(2, keys[1]!)]));

    // Non-vacuity: the cold load MUST have read them, or the skip below would
    // be passing on a build that never reads a photo at all.
    expect(GET_CALLS.length).toBeGreaterThan(0);
    expect(new Set(GET_CALLS)).toEqual(new Set(keys));
    // Each key asked for exactly once — the two overlapping effects made this 2.
    expect(GET_CALLS.length).toBe(keys.length);
    expect(Object.keys(CTX.imgLocal).sort()).toEqual([...keys].sort());

    const before = CTX.imgLocal;
    GET_CALLS.length = 0;
    const d = CTX.dataRaw;
    await save(Object.assign({}, d, { nxT: d.nxT + 1 }));

    expect(GET_CALLS).toEqual([]);
    expect(CTX.imgLocal).toBe(before);
  });

  it("a cover added by a save IS read — the skip must not freeze the map", async () => {
    const first = "local-photo-1700000000001-a";
    const added = "local-photo-1700000000009-z";
    STORE[first] = PHOTO;
    STORE[added] = PHOTO;
    await mount(cellar([tobacco(1, first)]));
    GET_CALLS.length = 0;

    const d = CTX.dataRaw;
    await save(
      Object.assign({}, d, {
        tobaccos: d.tobaccos.concat([tobacco(2, added)]),
        nxT: 3,
      }),
    );

    expect(GET_CALLS).toEqual([added]);
    expect(CTX.imgLocal[added]).toBe(PHOTO);
  });

  it("a key that did not resolve is retried on the next save", async () => {
    // Deliberate: a miss means the blob is not there YET (an eviction, or an
    // import whose photo writes land after its save). Marking a miss as
    // "asked" would make such a photo unrecoverable for the session.
    const missing = "local-photo-1700000000003-c";
    await mount(cellar([tobacco(1, missing)]));
    expect(GET_CALLS).toEqual([missing]);
    expect(CTX.imgLocal[missing]).toBeUndefined();

    GET_CALLS.length = 0;
    STORE[missing] = PHOTO; // the blob arrives late
    const d = CTX.dataRaw;
    await save(Object.assign({}, d, { nxT: d.nxT + 1 }));

    expect(GET_CALLS).toEqual([missing]);
    expect(CTX.imgLocal[missing]).toBe(PHOTO);
  });

  it("a photo referenced ONLY by a session snapshot is still resolved", async () => {
    // The surviving effect is the one that walks snapshots; the deleted one
    // never did. This is what makes the deletion a strict reduction.
    const ghost = "local-photo-1700000000004-d";
    STORE[ghost] = PHOTO;
    await mount(
      cellar(
        [],
        [
          {
            id: 1,
            date: "2026-01-01",
            tobaccoId: 99,
            pipeId: 0,
            duration: 20,
            rating: 0,
            notes: "",
            weightG: "0",
            lotId: "",
            tobaccoSnapshot: { brand: "B", name: "N", imageUrl: ghost },
          },
        ],
      ),
    );

    expect(GET_CALLS).toEqual([ghost]);
    expect(CTX.imgLocal[ghost]).toBe(PHOTO);
  });

  it("an imageUrl that is not a local-photo key is never asked for", async () => {
    // This is the property that makes the deleted second effect a no-op: it
    // collected every `imageUrl`, and the only shapes `migrateData` allows
    // besides a `local-photo-*` key are `data:image/…` URIs, which are never
    // IndexedDB keys.
    const inline = "data:image/png;base64,BBB";
    await mount(cellar([tobacco(1, inline)]));

    expect(GET_CALLS).toEqual([]);
  });
});
