// Two tabs used to overwrite each other silently: each tab's save() wrote its
// whole in-memory cellar over what the other had just saved. The browser
// fires `storage` in every OTHER tab; App now adopts that cellar and says so,
// so its next save builds on it. Mounted on the real App.
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
import { LANG } from "../i18n";

const base = (names: string[]) => ({
  tobaccos: names.map((n, i) => ({ id: i + 1, uid: "u" + (i + 1), name: n, brand: "B", lots: [] })),
  pipes: [], accessories: [], sessions: [], wishlist: [],
  nxT: names.length + 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
});
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}
async function mount() {
  localStorage.setItem(SK, JSON.stringify(base(["A"])));
  localStorage.setItem("cave-terms-accepted", "1");
  localStorage.setItem("cave-curator-welcomed", "1");
  localStorage.setItem("cave-last-export-ts", String(Date.now()));
  await act(async () => { render(<App />); });
  await settle();
}
function otherTabWrites(value: string) {
  localStorage.setItem(SK, value);
  window.dispatchEvent(new StorageEvent("storage", { key: SK, newValue: value }));
}

beforeEach(() => { localStorage.clear(); CTX = null; });

describe("a save from another tab", () => {
  it("is adopted, announced, and this tab's next save builds on it", async () => {
    await mount();
    await act(async () => { otherTabWrites(JSON.stringify(base(["A", "B from the other tab"]))); });
    await settle();
    expect(CTX.dataRaw.tobaccos.map((t: any) => t.name)).toEqual(["A", "B from the other tab"]);
    expect(CTX.saveWarn).toBe((LANG as any).en.warn_other_tab_update);
    // This tab now edits: the other tab's addition must survive.
    const next = JSON.parse(JSON.stringify(CTX.dataRaw));
    next.tobaccos[0].name = "A renamed here";
    await act(async () => { CTX.save(next); });
    await settle();
    expect(JSON.parse(localStorage.getItem(SK)!).tobaccos.map((t: any) => t.name))
      .toEqual(["A renamed here", "B from the other tab"]);
  });

  it("an unreadable value is ignored, and so is a write of the same cellar", async () => {
    await mount();
    const before = CTX.dataRaw;
    await act(async () => { otherTabWrites("{\"tobaccos\":[{"); });
    await settle();
    expect(CTX.dataRaw).toBe(before);
    expect(CTX.saveWarn).toBeFalsy();
    await act(async () => { otherTabWrites(JSON.stringify(CTX.dataRaw)); });
    await settle();
    expect(CTX.saveWarn).toBeFalsy();
  });
});
