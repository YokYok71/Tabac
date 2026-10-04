// A REVISION CHANGES ONLY WHEN THE CELLAR DOES (build 44).
//
// On build 43 the two devices played ping-pong with an IDENTICAL cellar: each
// merge of the other's copy went through save(), which stamped a fresh
// revision and marked the cellar unsynced, so it was uploaded under a revision
// the other device had never held, offered there, merged again… — with
// « Dernière édition » frozen. Reported with screenshots from both devices.
//
// Two links, each on real code: the import hands save() the SAME BYTES for a
// merge that changes nothing (useImportConfirm.test.ts), and save() of the
// same bytes neither stamps a revision nor raises the unsynced flag (here, on
// the real App, the way photoCacheReadsOnce.test.tsx mounts it).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("../utils/imgCache.ts", async () => {
  const real: any = await vi.importActual("../utils/imgCache.ts");
  return {
    ...real,
    imgCache: {
      open: () => Promise.resolve(null),
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(true),
      clear: () => Promise.resolve(),
    },
    gcOrphans: () => Promise.resolve(0),
  };
});

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
import { currentCellarRev } from "../hooks/useGdriveSync";
import { stableStringify } from "../utils";

const CELLAR = {
  tobaccos: [{ id: 1, uid: "u1", name: "Duskfall", brand: "Halvorsen", lots: [] }],
  pipes: [], accessories: [], sessions: [], wishlist: [],
  nxT: 2, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
};

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}
async function mount() {
  localStorage.setItem(SK, JSON.stringify(CELLAR));
  localStorage.setItem("cave-terms-accepted", "1");
  localStorage.setItem("cave-curator-welcomed", "1");
  localStorage.setItem("cave-last-export-ts", String(Date.now()));
  await act(async () => { render(<App />); });
  await settle();
}
async function save(next: any) {
  await act(async () => { CTX.save(next); });
  await settle();
}
const stored = () => JSON.parse(localStorage.getItem(SK) || "null");

beforeEach(() => { localStorage.clear(); CTX = null; });

describe("save() stamps a revision only when the cellar changes", () => {
  it("saving exactly what is stored: no new revision, no unsynced flag", async () => {
    await mount();
    await save(stored());                 // normalise storage to what save() writes
    const rev = currentCellarRev();
    localStorage.removeItem("cave-pending-sync");
    await save(stored());                 // the same bytes again
    expect(currentCellarRev()).toBe(rev);
    expect(localStorage.getItem("cave-pending-sync")).toBeNull();
  });

  it("a real change: a new revision and the unsynced flag", async () => {
    await mount();
    await save(stored());
    const rev = currentCellarRev();
    localStorage.removeItem("cave-pending-sync");
    const next = stored();
    next.tobaccos[0].name = "Duskfall (2024)";
    await save(next);
    expect(currentCellarRev()).not.toBe(rev);
    expect(localStorage.getItem("cave-pending-sync")).toBe("1");
  });

  it("the same content in another KEY ORDER is not a change (what a merge produces)", async () => {
    await mount();
    await save(stored());
    const rev = currentCellarRev();
    localStorage.removeItem("cave-pending-sync");
    const s = stored();
    const reordered: any = {};
    for (const k of Object.keys(s).reverse()) reordered[k] = s[k];
    await save(reordered);
    expect(currentCellarRev()).toBe(rev);
    expect(localStorage.getItem("cave-pending-sync")).toBeNull();
  });

  it("an earlier unsynced edit keeps its flag through an identical save", async () => {
    await mount();
    await save(stored());
    localStorage.setItem("cave-pending-sync", "1");
    await save(stored());
    expect(localStorage.getItem("cave-pending-sync")).toBe("1");
  });
});

describe("stableStringify", () => {
  it("ignores key order, at every depth", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }))
      .toBe(stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });
  it("still tells different content apart — values, array order, presence", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: null }));
  });
  it("matches JSON.stringify's skipping rules", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableStringify([undefined, () => 1])).toBe("[null,null]");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(null)).toBe("null");
  });
});
