// After a failed LOCAL save, the cloud auto-save used to upload the older
// on-disk copy and clear « non synchronisé ». save() now records the failure
// in memory (localWriteState) and clears it on the next save that lands;
// the auto-save skips while it is set. Mounted on the real App.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("../utils/imgCache.ts", async () => {
  const real: any = await vi.importActual("../utils/imgCache.ts");
  return {
    ...real,
    imgCache: {
      open: () => Promise.resolve(null),
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(false),
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
import { localWriteFailed, setLocalWriteFailed } from "../utils/localWriteState";

const CELLAR = {
  tobaccos: [{ id: 1, uid: "u1", name: "Duskfall", brand: "Halvorsen", lots: [] }],
  pipes: [], accessories: [], sessions: [], wishlist: [],
  nxT: 2, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
};
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}

let full = false;
const realSet = Storage.prototype.setItem;
beforeEach(() => {
  localStorage.clear(); CTX = null; full = false; setLocalWriteFailed(false);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (full && k === SK) {
      const e: any = new Error("full"); e.name = "QuotaExceededError"; throw e;
    }
    return realSet.call(this, k, v);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("a failed local save is remembered until a save lands", () => {
  it("sets the flag on a quota failure and clears it on the next successful save", async () => {
    localStorage.setItem(SK, JSON.stringify(CELLAR));
    localStorage.setItem("cave-terms-accepted", "1");
    localStorage.setItem("cave-curator-welcomed", "1");
    localStorage.setItem("cave-last-export-ts", String(Date.now()));
    await act(async () => { render(<App />); });
    await settle();
    expect(localWriteFailed()).toBe(false);

    full = true;
    const next = JSON.parse(localStorage.getItem(SK)!);
    next.tobaccos[0].name = "Duskfall (2024)";
    await act(async () => { CTX.save(next); });
    await settle();
    expect(localWriteFailed()).toBe(true);
    expect(JSON.parse(localStorage.getItem(SK)!).tobaccos[0].name).toBe("Duskfall");

    full = false;
    const again = Object.assign({}, next, { nxT: 3 });
    await act(async () => { CTX.save(again); });
    await settle();
    expect(localWriteFailed()).toBe(false);
  });
});
