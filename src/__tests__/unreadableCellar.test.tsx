// AN UNREADABLE CELLAR USED TO LOAD AS AN EMPTY ONE, SILENTLY, and the first
// save then wrote the empty cellar over the only copy. Mounted on the real App
// the way saveRevisionGate.test.tsx does it: a truncated `pipe-cellar-v6`
// must be set aside before anything can overwrite it, and the user told.
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
import { hasCellarData } from "../hooks/useGdriveSync";

const TRUNCATED = '{"tobaccos":[{"id":1,"uid":"u1","name":"Duskfall","brand":"Halvorsen","lots":[{"id":1,"stat';

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}
async function mountWith(raw: string) {
  localStorage.setItem(SK, raw);
  localStorage.setItem("cave-terms-accepted", "1");
  localStorage.setItem("cave-curator-welcomed", "1");
  localStorage.setItem("cave-last-export-ts", String(Date.now()));
  await act(async () => { render(<App />); });
  await settle();
}

beforeEach(() => { localStorage.clear(); CTX = null; });

describe("an unreadable cellar at launch", () => {
  it("is set aside verbatim and the user is told", async () => {
    await mountWith(TRUNCATED);
    expect(localStorage.getItem(SK + "-unreadable")).toBe(TRUNCATED);
    expect(Number(localStorage.getItem(SK + "-unreadable-ts"))).toBeGreaterThan(0);
    expect(CTX.saveError).toBe((LANG as any).en.warn_cellar_unreadable_kept);
  });

  it("the set-aside copy survives the first save of the empty cellar", async () => {
    await mountWith(TRUNCATED);
    await act(async () => { CTX.save(Object.assign({}, CTX.dataRaw)); });
    await settle();
    expect(localStorage.getItem(SK + "-unreadable")).toBe(TRUNCATED);
  });

  it("a readable cellar sets nothing aside and shows nothing", async () => {
    await mountWith(JSON.stringify({ tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] }));
    expect(localStorage.getItem(SK + "-unreadable")).toBeNull();
    expect(CTX.saveError).toBeFalsy();
  });
});

describe("hasCellarData — the auto-save's « nothing to upload » test", () => {
  it("is false for an empty or missing cellar, true as soon as one collection holds a row", () => {
    expect(hasCellarData(null)).toBe(false);
    expect(hasCellarData({ tobaccos: [], pipes: [], sessions: [] })).toBe(false);
    expect(hasCellarData({ sessions: [{ id: 1 }] })).toBe(true);
    expect(hasCellarData({ wishlist: [{ id: 1 }] })).toBe(true);
  });
});
