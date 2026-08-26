/**
 * Tests for useImportConfirm.
 *
 * Covers the merge-vs-replace engine shared by the JSON import and the
 * Google Drive restore flows. The hook exposes:
 *   • stageImport(parsed, source) — strips _apiKey/_savedAt/_saveType,
 *     pulls _imageData into a separate map, computes dup counts vs the
 *     current `data` prop, and stashes everything in `importConfirm`.
 *   • applyImport("replace" | "merge") — commits the staged payload.
 *   • cancelImport() — clears without saving.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, act } from "@testing-library/react";

// An earlier release audit: `_runImport` is the ONLY place an imported photo blob
// reaches IndexedDB, so the security invariant ("keys must start with
// local-photo-, values must match the data:image allow-list") can only be
// observed here. jsdom has no IndexedDB, and the production call is wrapped in
// try/catch + .catch(), so an unmocked imgCache swallows everything silently —
// the write has to be mocked to be seen at all.
const { putCalls } = vi.hoisted(() => ({ putCalls: [] as Array<[string, string]> }));
vi.mock("../utils/imgCache.ts", () => ({
  imgCache: {
    put: (k: string, v: string) => { putCalls.push([k, v]); return Promise.resolve(true); },
    get: () => Promise.resolve(null),
    open: () => Promise.resolve(null),
    clear: () => Promise.resolve(),
  },
  gcOrphans: () => Promise.resolve(0),
  isSafeExternalUrl: () => false,
  safeBgUrl: () => "",
  // The REAL implementation, not a stub. This mock stands in
  // for IndexedDB, and `imgMap` is a pure prototype-safety helper the import
  // path now uses — replacing it with `Object.assign({}, …)` here would make
  // the suite green against a photo map that has a prototype, i.e. it would
  // hide the very defect forgedImageUrl.test.ts exists to lock.
  imgMap: (...sources: any[]) => Object.assign(Object.create(null), ...sources),
}));

import { useImportConfirm, resolveMergeMatch, mergeRefusedByUid, mergeAmbiguousName, applyEntityLww } from "../hooks/useImportConfirm";
import { migrateData as realMigrateData } from "../utils.ts";
import { PIPE_MAX_EXTRA_PHOTOS } from "../constants.ts";
import { checkAllInvariants } from "../utils/lotInvariants.ts";

function makeProps(overrides: Record<string, any> = {}) {
  return {
    data: {} as any,
    save: vi.fn(),
    migrateData: (d: any) => d,
    saveApiKey: vi.fn(),
    setImgLocal: vi.fn(),
    setImportModal: vi.fn(),
    nav: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  putCalls.length = 0;
});

const baseLocal = {
  tobaccos: [
    { id: 1, brand: "Brackwater", name: "Duskfall", lots: [] },
    { id: 2, brand: "Pellworm", name: "HH Old Dark Fired", lots: [] },
  ],
  pipes: [{ id: 1, brand: "Halvorsen", name: "Sherlock Holmes" }],
  wishlist: [],
  accessories: [],
  sessions: [{ id: 1, tobaccoId: 1, pipeId: 1, date: "2026-01-15", duration: "30" }],
  nxT: 3, nxP: 2, nxJ: 2, nxW: 1, nxA: 1,
};

const imported = {
  tobaccos: [
    { id: 10, brand: "Brackwater", name: "Duskfall", lots: [] },
    { id: 11, brand: "Marlow & Finch", name: "Adagio Green", lots: [] },
  ],
  pipes: [{ id: 20, brand: "Savinelli", name: "Trevi" }],
  wishlist: [],
  accessories: [],
  sessions: [
    { id: 30, tobaccoId: 10, pipeId: 20, date: "2026-02-20", duration: "45" },
    { id: 31, tobaccoId: 10, pipeId: 20, date: "2026-02-20", duration: "45" },
  ],
  nxT: 12, nxP: 21, nxJ: 32, nxW: 1, nxA: 1,
};

describe("stageImport — dup counts and metadata extraction", () => {
  it("strips _apiKey + _imageData and computes dup totals", () => {
    const saveApiKey = vi.fn();
    const setImgLocal = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey, setImgLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, {
          _apiKey: "sk-imported",
          _imageData: { "local-photo-1": "data:image/jpeg;base64,xxx" },
        }),
        "file",
      );
    });
    // The API key is NOT persisted at stage time
    // anymore (a cancelled import must not clobber the stored key). It's
    // carried on importConfirm and only written when the import is applied.
    expect(saveApiKey).not.toHaveBeenCalled();
    const ic = result.current.importConfirm!;
    expect(ic).not.toBeNull();
    expect(ic.apiKey).toBe("sk-imported");
    // legacy backups without `_apiKeyProvider` → undefined.
    expect(ic.apiKeyProvider).toBeUndefined();
    expect(ic.parsed._apiKey).toBeUndefined();
    expect(ic.parsed._imageData).toBeUndefined();
    expect(ic.imgData["local-photo-1"]).toMatch(/^data:image\/jpeg/);
    expect(ic.dupCounts.tobaccos).toBe(1);
    expect(ic.dupCounts.pipes).toBe(0);
    expect(ic.incoming.tobaccos).toBe(2);
    expect(ic.incoming.sessions).toBe(2);
    expect(ic.source).toBe("file");
    // Applying the import persists the key (source-provider slot = active here).
    // on a REPLACE. This case used to apply "merge" and assert the
    // write — reversed deliberately, see the block at the end of this
    // file. What it still guards is the STAGING (the key is parsed, validated
    // and stripped from the payload), which is mode-independent.
    act(() => { result.current.applyImport("replace"); });
    expect(saveApiKey).toHaveBeenCalledWith("sk-imported", undefined);
  });

  it("BUG-2: a cancelled import does NOT persist the imported API key", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(Object.assign({}, imported, { _apiKey: "sk-should-not-land" }), "file");
    });
    expect(saveApiKey).not.toHaveBeenCalled();
    act(() => { result.current.cancelImport(); });
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(result.current.importConfirm).toBeNull();
  });

  it("records 'drive' as the source when called from the Drive path", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "drive"); });
    expect(result.current.importConfirm!.source).toBe("drive");
  });

  it("strips the _schemaVersion stamp from the staged payload", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(Object.assign({}, imported, { _schemaVersion: "v6" }), "file");
    });
    expect(result.current.importConfirm!.parsed._schemaVersion).toBeUndefined();
  });

  // An earlier release fix: legacy JSON exports inline base64 in `imageUrl`
  // directly (no `_imageData` map — that's the Drive convention).
  // stageImport now migrates those inline blobs to `imgData` under a
  // fresh local-photo-* key so save() doesn't hit localStorage with
  // megabytes of base64 and trigger the QuotaExceeded fallback banner.
  it("migrates inline base64 imageUrl photos into imgData (legacy JSON exports)", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const payload = {
      tobaccos: [
        { id: 100, brand: "X", name: "Y", lots: [], imageUrl: "data:image/jpeg;base64,AAAA" },
      ],
      pipes: [
        { id: 200, brand: "P", name: "Q", imageUrl: "data:image/png;base64,BBBB" },
      ],
      wishlist: [], accessories: [], sessions: [],
    };
    act(() => { result.current.stageImport(payload, "file"); });
    const ic = result.current.importConfirm!;
    // Inline base64 moved into imgData under a local-photo-* key.
    const keys = Object.keys(ic.imgData);
    expect(keys.length).toBe(2);
    keys.forEach((k) => expect(k).toMatch(/^local-photo-/));
    // Entities now reference the new keys instead of carrying the base64.
    expect(ic.parsed.tobaccos[0].imageUrl).toMatch(/^local-photo-/);
    expect(ic.parsed.pipes[0].imageUrl).toMatch(/^local-photo-/);
    // The blob is preserved in imgData (so applyImport can write to imgCache).
    expect(ic.imgData[ic.parsed.tobaccos[0].imageUrl]).toBe("data:image/jpeg;base64,AAAA");
    expect(ic.imgData[ic.parsed.pipes[0].imageUrl]).toBe("data:image/png;base64,BBBB");
  });

  it("leaves local-photo-* keys and external URLs untouched (only migrates inline data: blobs)", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const payload = {
      tobaccos: [
        { id: 100, brand: "X", name: "Y", lots: [], imageUrl: "local-photo-already-keyed" },
      ],
      pipes: [
        { id: 200, brand: "P", name: "Q", imageUrl: "https://example.com/photo.jpg" },
      ],
      wishlist: [], accessories: [], sessions: [],
    };
    act(() => { result.current.stageImport(payload, "file"); });
    const ic = result.current.importConfirm!;
    expect(Object.keys(ic.imgData).length).toBe(0);
    expect(ic.parsed.tobaccos[0].imageUrl).toBe("local-photo-already-keyed");
    expect(ic.parsed.pipes[0].imageUrl).toBe("https://example.com/photo.jpg");
  });
});

describe("applyImport('replace')", () => {
  it("wipes local data and uses the imported payload as-is", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("replace"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.map((t: any) => t.name).sort()).toEqual(
      ["Duskfall", "Adagio Green"].sort(),
    );
    expect(saved.pipes[0].name).toBe("Trevi");
    expect(result.current.importConfirm).toBeNull();
  });

  // land on Home after an import/restore (was "inv"), so a restore
  // launched from the Home cloud-newer banner leaves the user on Home.
  it("navigates to home when the import completes", () => {
    const nav = vi.fn();
    const props = makeProps({ data: baseLocal, nav });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("replace"); });
    expect(nav).toHaveBeenCalledWith("home");
  });

  it("dismisses the Settings modal when source is 'file'", () => {
    const setImportModal = vi.fn();
    const props = makeProps({ data: baseLocal, setImportModal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("replace"); });
    expect(setImportModal).toHaveBeenCalledWith(false);
  });

  it("does NOT dismiss the Settings modal when source is 'drive'", () => {
    const setImportModal = vi.fn();
    const props = makeProps({ data: baseLocal, setImportModal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "drive"); });
    act(() => { result.current.applyImport("replace"); });
    expect(setImportModal).not.toHaveBeenCalled();
  });
});

// ── _imageData write filter — the documented import-hardening invariant ────────
//
// An earlier release audit. CLAUDE.md lists this under "Security → Import hardening" and
// again as invariant #19: "`doGdriveConfirm` and `doImportFile` must ALWAYS
// validate `_imageData` keys (`local-photo-` prefix) and values
// (`/^data:image\/(jpeg|jpg|png|webp|gif);/`) before writing to IndexedDB",
// plus the 15 MB per-blob cap. Both restore paths funnel into
// `_runImport`, and the filter was there and correct — with nothing checking it.
// Deleting the key-prefix test, then the value regex, then the size cap each
// left all 3754 tests green.
//
// The staged side WAS covered ("strips _apiKey + _imageData"), which is what
// made the gap easy to miss: those tests read `importConfirm.imgData`, the map
// as it arrived, and never follow it to the write. The write is where the
// forged entry would land.
describe("applyImport — _imageData is filtered before it reaches IndexedDB", () => {
  const withImages = (imageData: Record<string, unknown>) => ({
    tobaccos: [{ id: 10, brand: "Halvorsen", name: "Duskfall", lots: [] }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    _imageData: imageData,
  });

  function applyWith(imageData: Record<string, unknown>) {
    const setImgLocal = vi.fn();
    const props = makeProps({ data: baseLocal, setImgLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(withImages(imageData), "file"); });
    act(() => { result.current.applyImport("replace"); });
    // What the app would actually hold in memory afterwards.
    const merged: Record<string, string> = {};
    setImgLocal.mock.calls.forEach((c) => {
      Object.assign(merged, (c[0] as (prev: any) => any)({}));
    });
    return { written: putCalls.map((c) => c[0]), merged };
  }

  it("writes a well-formed local-photo entry", () => {
    const { written, merged } = applyWith({
      "local-photo-1700000001": "data:image/jpeg;base64,AAAA",
    });
    expect(written).toEqual(["local-photo-1700000001"]);
    expect(Object.keys(merged)).toEqual(["local-photo-1700000001"]);
  });

  it("drops a key that does not carry the local-photo- prefix", () => {
    // A forged backup naming its blob after an unrelated storage key. Without
    // the prefix check the import writes attacker-chosen keys into the shared
    // photo store, where the app resolves them by name.
    const { written, merged } = applyWith({
      "local-photo-1700000001": "data:image/jpeg;base64,AAAA",
      "pipe-cellar-v6": "data:image/png;base64,BBBB",
      "../../etc/passwd": "data:image/png;base64,CCCC",
      "gdrive-tk": "data:image/gif;base64,DDDD",
    });
    expect(written).toEqual(["local-photo-1700000001"]);
    expect(Object.keys(merged)).toEqual(["local-photo-1700000001"]);
  });

  it("drops a value that is not an allow-listed data:image blob", () => {
    const { written, merged } = applyWith({
      "local-photo-ok": "data:image/webp;base64,AAAA",
      "local-photo-svg": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", // scriptable
      "local-photo-html": "data:text/html;base64,PHNjcmlwdD4=",
      "local-photo-js": "javascript:alert(1)",
      "local-photo-url": "https://example.com/photo.jpg",
      "local-photo-empty": "",
    });
    expect(written).toEqual(["local-photo-ok"]);
    expect(Object.keys(merged)).toEqual(["local-photo-ok"]);
  });

  it("drops a non-string value without throwing (forged JSON shapes)", () => {
    const { written } = applyWith({
      "local-photo-ok": "data:image/png;base64,AAAA",
      "local-photo-obj": { toString: () => "data:image/png;base64,BBBB" },
      "local-photo-num": 42,
      "local-photo-null": null,
      "local-photo-arr": ["data:image/png;base64,CCCC"],
    });
    expect(written).toEqual(["local-photo-ok"]);
  });

  it("drops a blob over the 15 MB per-image cap", () => {
    // Regex-valid but oversized: uploaded photos are canvas-resized to ~800 px
    // JPEG, so anything past 15 MB is abuse, and writing it would evict real
    // photos from the IndexedDB quota.
    const head = "data:image/jpeg;base64,";
    const { written } = applyWith({
      "local-photo-small": head + "A".repeat(1024),
      "local-photo-huge": head + "A".repeat(15 * 1024 * 1024),
    });
    expect(written).toEqual(["local-photo-small"]);
  });

  it("touches IndexedDB on the MERGE path too, with the same filter", () => {
    // Both restore modes share _runImport; a filter that only held on replace
    // would leave the merge path (the CSV + cloud-restore default) open.
    const setImgLocal = vi.fn();
    const props = makeProps({ data: baseLocal, setImgLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        withImages({
          "local-photo-ok": "data:image/jpeg;base64,AAAA",
          "not-a-photo": "data:image/jpeg;base64,BBBB",
        }),
        "file",
      );
    });
    act(() => { result.current.applyImport("merge"); });
    expect(putCalls.map((c) => c[0])).toEqual(["local-photo-ok"]);
  });

  it("writes nothing at all when every entry is rejected", () => {
    const { written, merged } = applyWith({ "evil": "data:image/png;base64,AAAA" });
    expect(written).toEqual([]);
    expect(merged).toEqual({});
  });
});

// `stageImport(..., { autoApply: "replace" })` skips
// the picker entirely — used by the Home cloud-newer banner. The
// importConfirm state stays null (nothing to render), and the same
// data mutation runs as the explicit applyImport("replace") path.
describe("stageImport({ autoApply }) — the transparent restore", () => {
  it("autoApply: 'replace' bypasses the picker and runs the replace path", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(imported, "drive", { autoApply: "replace" });
    });
    // No picker state — direct write.
    expect(result.current.importConfirm).toBeNull();
    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.map((t: any) => t.name).sort()).toEqual(
      ["Duskfall", "Adagio Green"].sort(),
    );
  });

  it("autoApply: 'merge' bypasses the picker and runs the merge path", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(imported, "drive", { autoApply: "merge" });
    });
    expect(result.current.importConfirm).toBeNull();
    expect(save).toHaveBeenCalled();
    // Merge preserves existing local entries.
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBeGreaterThan(baseLocal.tobaccos.length);
  });

  it("default (no autoApply) still shows the picker", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "drive"); });
    // Picker is staged; no save until the user picks.
    expect(result.current.importConfirm).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("merge is prototype-pollution-safe", () => {
  it("survives a forged tobacco id of \"__proto__\" without crashing or polluting", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: "__proto__", brand: "Forged", name: "Blend", lots: [] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 30, tobaccoId: "__proto__", pipeId: "", date: "2026-02-20", duration: "10" }],
      nxT: 5, nxP: 1, nxJ: 31, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    expect(() => {
      act(() => { result.current.stageImport(incoming, "file"); });
      act(() => { result.current.applyImport("merge"); });
    }).not.toThrow();
    // Object.prototype is not polluted.
    expect(({} as any).brand).toBeUndefined();
    // The merge still ran and saved a coherent payload.
    const saved = save.mock.calls[0]![0];
    expect(Array.isArray(saved.tobaccos)).toBe(true);
  });
});

describe("merge recap toast target", () => {
  it("routes a lot-topup recap to the inventory view", () => {
    const save = vi.fn();
    const recap = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 9, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 5, status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "7" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save, setImportRecap: recap });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    expect(recap).toHaveBeenCalledTimes(1);
    const arg = recap.mock.calls[0]![0];
    expect(arg.view).toBe("inv");
    expect(String(arg.msg)).toMatch(/merge_recap_lots|lot/);
    // A single-blend top-up deep-links to that tobacco's fiche.
    expect(arg.tobId).toBe(1);
  });

  it("does NOT set a single-blend target when two blends are touched", () => {
    const save = vi.fn();
    const recap = vi.fn();
    const local = {
      tobaccos: [
        { id: 1, brand: "Brackwater", name: "Duskfall", lots: [] },
        { id: 2, brand: "Pellworm", name: "Slate Harbour", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [
        { id: 9, brand: "Brackwater", name: "Duskfall", lots: [{ id: 5, status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "7" }] },
        { id: 8, brand: "Pellworm", name: "Slate Harbour", lots: [{ id: 6, status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "3" }] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save, setImportRecap: recap });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const arg = recap.mock.calls[0]![0];
    expect(arg.view).toBe("inv");
    expect(arg.tobId).toBeUndefined();
  });

  it("routes a session-only recap to the journal view", () => {
    const save = vi.fn();
    const recap = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "", updatedAt: "2026-05-15T10:00:00.000Z" }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "edited", updatedAt: "2026-06-01T10:00:00.000Z" }],
    };
    const props = makeProps({ data: local, save, setImportRecap: recap });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    expect(recap).toHaveBeenCalledTimes(1);
    expect(recap.mock.calls[0]![0].view).toBe("journal");
  });
});

describe("applyImport('merge') — entity LWW", () => {
  it("overwrites a dup tobacco's descriptive fields from a NEWER import (identity + lots + photo preserved)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{
        id: 1, brand: "Brackwater", name: "Duskfall", category: "Anglais", rating: 3,
        description: "old", imageUrl: "local-photo-1",
        lots: [{ id: 100, status: "cellar", weightG: "50", weightInitial: "50", boxNumber: "1" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 9, brand: "Brackwater", name: "Duskfall", category: "Balkan", rating: 5,
        description: "edited on device B", imageUrl: "",
        lots: [], updatedAt: "2026-05-01T00:00:00.000Z",
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const tob = save.mock.calls[0]![0].tobaccos[0];
    expect(tob.category).toBe("Balkan");        // descriptive field overwritten
    expect(tob.rating).toBe(5);
    expect(tob.description).toBe("edited on device B");
    expect(tob.brand).toBe("Brackwater");          // identity preserved
    expect(tob.name).toBe("Duskfall");
    expect(tob.imageUrl).toBe("local-photo-1"); // local photo NOT erased
    expect(tob.lots).toHaveLength(1);           // lots preserved (not the empty import)
    expect(tob.updatedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("keeps a dup tobacco's local fields when the import is OLDER", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", category: "Anglais", rating: 5, lots: [], updatedAt: "2026-06-01T00:00:00.000Z" }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 9, brand: "Brackwater", name: "Duskfall", category: "Balkan", rating: 2, lots: [], updatedAt: "2026-01-01T00:00:00.000Z" }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const tob = save.mock.calls[0]![0].tobaccos[0];
    expect(tob.category).toBe("Anglais");
    expect(tob.rating).toBe(5);
  });

  it("never LWW-clobbers when only the import has updatedAt (legacy-safe)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", category: "Anglais", lots: [] }], // no updatedAt
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 9, brand: "Brackwater", name: "Duskfall", category: "Balkan", lots: [], updatedAt: "2026-05-01T00:00:00.000Z" }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    expect(save.mock.calls[0]![0].tobaccos[0].category).toBe("Anglais");
  });

  it("applies LWW to a dup accessory too (newer import wins, imageUrl preserved)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [],
      accessories: [{ id: 1, brand: "Czech", name: "Tool", type: "Bourre-pipe", notes: "old", imageUrl: "local-photo-a", updatedAt: "2026-01-01T00:00:00.000Z" }],
      sessions: [], nxT: 1, nxP: 1, nxJ: 1, nxW: 1, nxA: 2,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [],
      accessories: [{ id: 9, brand: "Czech", name: "Tool", type: "Bourre-pipe", notes: "new", imageUrl: "", updatedAt: "2026-05-01T00:00:00.000Z" }],
      sessions: [], nxT: 1, nxP: 1, nxJ: 1, nxW: 1, nxA: 10,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const acc = save.mock.calls[0]![0].accessories[0];
    // This REVERSES the line. It used to expect "new" — a newer
    // import overwriting the local note — and that is the per-row LWW defect:
    // one `updatedAt` covers the whole row, so a device that changed only, say,
    // the rating replaced the note it had never touched. `notes` is the user's
    // own personal prose (same category as `tastingNotes`, which `useDbSync`
    // refuses to touch for exactly this reason), so it is now FILL-IF-EMPTY:
    // an import lands only where the local side is blank.
    expect(acc.notes).toBe("old");
    expect(acc.imageUrl).toBe("local-photo-a"); // preserved
  });
});

describe("applyImport('merge')", () => {
  it("keeps existing entries and appends only non-duplicates", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.map((t: any) => t.name).sort()).toEqual(
      ["HH Old Dark Fired", "Duskfall", "Adagio Green"].sort(),
    );
    expect(saved.pipes.map((p: any) => p.name).sort()).toEqual(
      ["Sherlock Holmes", "Trevi"].sort(),
    );
  });

  it("dedups identical sessions (date+tob+pipe+duration) within the import", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions.length).toBe(2);
  });

  it("remaps session.tobaccoId to the kept local id for duplicates", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const appended = saved.sessions.find((s: any) => s.date === "2026-02-20");
    expect(appended.tobaccoId).toBe(1); // local Brackwater id, not imported 10
  });

  it("remaps session.pipeId to a newly-assigned local id for newly-added pipes", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const appended = saved.sessions.find((s: any) => s.date === "2026-02-20");
    // Local Halvorsen is id=1, imported Savinelli was id=20 in the file.
    // Merge assigns a fresh local id (next from nxP=2). The session
    // should now point at that new id (which must NOT be 20, and must
    // NOT be 1 since the import pipe is genuinely new).
    expect(appended.pipeId).not.toBe(20);
    expect(appended.pipeId).not.toBe(1);
  });

  // lot-level merge. A brand+name-matched imported tobacco now
  // contributes its NEW lots to the existing local blend instead of being
  // discarded outright.
  it("appends new lots from a dup-matched imported tobacco onto the local one", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{
        id: 1, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 100, status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "1", datePurchased: "2025-01-01" }],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall",
        lots: [
          // same box+purchase identity as local lot 100 → NOT re-added
          { id: 200, status: "jar", weightG: "40", weightInitial: "50", boxNumber: "1", datePurchased: "2025-01-01" },
          // genuinely new lot → appended
          { id: 201, status: "cellar", weightG: "50", weightInitial: "50", boxNumber: "2", datePurchased: "2025-06-01" },
        ],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBe(1); // still one blend, no duplicate
    const lots = saved.tobaccos[0].lots;
    expect(lots.length).toBe(2); // original + one appended (the box-1 dup skipped)
    expect(lots.map((l: any) => l.boxNumber).sort()).toEqual(["1", "2"]);
    // the appended lot got a fresh id, not the imported 201
    const box2 = lots.find((l: any) => l.boxNumber === "2");
    expect(box2.id).not.toBe(201);
  });

  it("re-links an imported session to the freshly-appended lot (balance-preserving)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 300, status: "jar", weightInitial: "50", weightG: "47", boxNumber: "1", datePurchased: "2025-01-01" }],
      }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 40, tobaccoId: 10, pipeId: "", lotId: 300, date: "2026-03-01", duration: "20", weightG: "3" }],
      nxT: 11, nxP: 1, nxJ: 41, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const lot = saved.tobaccos[0].lots[0];
    const sess = saved.sessions[0];
    // session points at the appended lot's NEW id, not the imported 300
    expect(sess.lotId).toBe(lot.id);
    expect(sess.lotId).not.toBe(300);
    // balance holds: Σsession(3) === weightInitial(50) − weightG(47)
    expect(Number(lot.weightInitial) - Number(lot.weightG)).toBe(Number(sess.weightG));
  });

  // When BOTH devices share a lot id
  // (the normal state after an earlier restore/sync), an imported NEW session
  // referencing that shared/deduped lot must be ORPHANED (lotId cleared) — the
  // local lot's weightG was NOT reduced for that foreign consumption, so
  // keeping the ref would push Σsessions above weightInitial−weightG
  // (lot-balance-overflow) and double-count stock. Earlier only a MISSING lot
  // was cleared, so a shared id (hasLot === true) slipped through.
  it("orphans a session that references a SHARED/deduped lot id (no balance overflow)", () => {
    const save = vi.fn();
    // Local: lot 5000, initial 60, 50 remaining (10g smoked by the local S1).
    const local = {
      tobaccos: [{
        id: 1, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 5000, status: "jar", weightInitial: "60", weightG: "50", boxNumber: "1", datePurchased: "2025-01-01" }],
      }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 90, tobaccoId: 1, pipeId: "", lotId: 5000, date: "2026-01-01", duration: "10", weightG: "10" }],
      nxT: 2, nxP: 1, nxJ: 91, nxW: 1, nxA: 1,
    };
    // Incoming (device B): SAME lot 5000 (identical acquisition identity, so
    // deduped/not-appended) but smoked down to 45 there, plus a NEW session S_B
    // (5g) referencing lot 5000.
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 5000, status: "jar", weightInitial: "60", weightG: "45", boxNumber: "1", datePurchased: "2025-01-01" }],
      }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 91, tobaccoId: 10, pipeId: "", lotId: 5000, date: "2026-05-01", duration: "5", weightG: "5" }],
      nxT: 11, nxP: 1, nxJ: 92, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    // one blend, one (deduped) lot, weightG unchanged (LWW preserves lots).
    expect(saved.tobaccos.length).toBe(1);
    expect(saved.tobaccos[0].lots.length).toBe(1);
    const lot = saved.tobaccos[0].lots[0];
    expect(String(lot.id)).toBe("5000");
    expect(lot.weightG).toBe("50");
    // S_B was added but ORPHANED — its shared lotId is cleared.
    const sB = saved.sessions.find((s: any) => String(s.id) !== "90" && String(s.weightG) === "5");
    expect(sB).toBeTruthy();
    expect(sB.lotId).toBe("");
    // balance holds: only S1 (10g) references lot 5000 → Σ 10 === 60−50.
    const refSum = saved.sessions
      .filter((s: any) => !s.deletedAt && String(s.lotId) === "5000")
      .reduce((a: number, s: any) => a + (Number(s.weightG) || 0), 0);
    expect(refSum).toBe(Number(lot.weightInitial) - Number(lot.weightG)); // 10 === 10
  });

  // Lot uid: two genuinely-different tins with IDENTICAL acquisition
  // data (same unnumbered box + price + dates) now carry DISTINCT uids, so a
  // device holding an EXTRA such tin no longer has it silently dropped on merge
  // (the import stock-loss gap). uid-first dedup: same-uid tins collapse,
  // a new-uid tin appends even though its lotMergeKey collides.
  it("appends an EXTRA identical-acquisition tin by uid (no stock loss)", () => {
    const acq = { status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "", datePurchased: "2024-01-01", price: "12", seller: "x" };
    const save = vi.fn();
    const local = {
      tobaccos: [{
        id: 1, brand: "Brackwater", name: "Duskfall", uid: "tob-uid",
        lots: [
          { id: 100, uid: "lu1", ...acq },
          { id: 101, uid: "lu2", ...acq }, // same acquisition as lu1
        ],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall", uid: "tob-uid",
        lots: [
          { id: 200, uid: "lu1", ...acq }, // same tin as local lu1 → dedup
          { id: 201, uid: "lu2", ...acq }, // same tin as local lu2 → dedup
          { id: 202, uid: "lu3", ...acq }, // a THIRD physical tin → must append
        ],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const lots = saved.tobaccos[0].lots;
    expect(lots.length).toBe(3); // lu1, lu2 deduped; lu3 appended (NOT dropped)
    expect(lots.map((l: any) => l.uid).sort()).toEqual(["lu1", "lu2", "lu3"]);
  });

  // MERGING WHILE A LOT IS IN THE TRASH must not duplicate it.
  //
  // Found by the pre-public-release integrity drill and reproduced before the
  // fix: the lot seen-sets were built from LIVE lots only, so an imported lot
  // whose twin sat in this device's trash matched nothing and was APPENDED —
  // two lots, one uid. Restore the trashed one and the same physical tin is in
  // the cellar twice. Measured at 16 % of 400 randomised two-device merges,
  // ~123 g of ghost stock each, with EVERY invariant silent (the per-device id
  // differed, and the balance rule is overflow-only while this is underflow).
  //
  // The sequence is ordinary: delete a lot on phone B, then merge phone A's
  // backup — or tap the cloud-newer banner's « Restaurer ».
  //
  // An earlier release made exactly this fix one level up, for entities. Lots never got
  // it. SKIP, not resurrect: the trashed lot IS this tin, so adding a copy
  // duplicates it, while un-deleting would overrule a deliberate deletion.
  it("does NOT append an imported lot whose twin is in the local trash", () => {
    const save = vi.fn();
    const acq = { status: "cellar", weightInitial: "100", weightG: "100", boxNumber: "7", datePurchased: "2024-01-01", price: "12", seller: "x" };
    const local = {
      tobaccos: [{
        id: 1, brand: "Brackwater", name: "Duskfall", uid: "tob-uid",
        lots: [{ id: 5001, uid: "LOT-UID", ...acq, deletedAt: "2026-01-01" }],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall", uid: "tob-uid",
        lots: [{ id: 5001, uid: "LOT-UID", ...acq, weightG: "80" }],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.length, "the trashed twin must not be joined by a live copy").toBe(1);
    expect(lots[0].deletedAt, "and it stays trashed — restoring is the user's call").toBeTruthy();
    // The end state the old code produced would trip the new rule; assert the
    // fixed one does not, so the two halves of this build agree.
    expect(checkAllInvariants(save.mock.calls[0]![0]).filter((v: any) => v.rule === "lot-uid-unique")).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // The lot uid sets were built from the MATCHED tobacco's own lots, while
  // every other consumer of a lot uid is GLOBAL — `lot-uid-unique` says so in
  // its own comment ("the tins it protects can end up under different rows (a
  // merge moves them)"), and `restoreAllFromTrash` walks every tobacco.
  //
  // What moves a lot between rows is `mergeDuplicates`, the app's own healing
  // tool for the doubling. Reproduced here end to end: after the
  // merge on device A, device B's untouched copy appends the SAME tin under
  // T1 while keeping its own live copy under T2 — 200 g where the user has
  // 100, and the only thing that noticed was a post-hoc invariant.
  it("does not re-append a lot that a duplicate-merge moved to another row", () => {
    const save = vi.fn();
    const acq = { status: "cellar", weightInitial: "100", weightG: "100", boxNumber: "7", datePurchased: "2024-01-01", price: "12", seller: "x" };
    // Device B: the pre-uid doubling, tin under T2.
    const local = {
      tobaccos: [
        { id: 1, brand: "Brackwater", name: "Duskfall", uid: "uid-A", lots: [] },
        { id: 2, brand: "Brackwater", name: "Duskfall", uid: "uid-B", lots: [{ id: 100, uid: "TIN", ...acq }] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    // Device A's backup, AFTER merging T2 into T1: the tin moved (fresh id,
    // same uid) and the source copy is soft-deleted.
    const incoming = {
      tobaccos: [
        { id: 1, brand: "Brackwater", name: "Duskfall", uid: "uid-A", lots: [{ id: 900, uid: "TIN", ...acq }] },
        { id: 2, brand: "Brackwater", name: "Duskfall", uid: "uid-B", deletedAt: "2026-02-01", lots: [{ id: 100, uid: "TIN", ...acq, deletedAt: "2026-02-01" }] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const out = save.mock.calls[0]![0];
    const live = out.tobaccos.flatMap((t: any) => (t.lots || []).filter((l: any) => !l.deletedAt));
    expect(live.filter((l: any) => l.uid === "TIN").length,
      "the same physical tin must not end up live under two rows").toBe(1);
    expect(checkAllInvariants(out).filter((v: any) => v.rule === "lot-uid-unique")).toEqual([]);
  });

  it("still appends a genuinely NEW tin whose uid is nowhere in the cellar", () => {
    // The guard must not turn into "never append": the global set is about
    // identity, and an unknown uid is a tin this device does not have.
    const save = vi.fn();
    const acq = { status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "1", datePurchased: "2024-01-01" };
    const local = {
      tobaccos: [{ id: 1, brand: "D", name: "N", uid: "tu", lots: [{ id: 100, uid: "TIN-1", ...acq }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 1, brand: "D", name: "N", uid: "tu", lots: [{ id: 100, uid: "TIN-1", ...acq }, { id: 101, uid: "TIN-2", ...acq }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.length).toBe(2);
    expect(lots.map((l: any) => l.uid).sort()).toEqual(["TIN-1", "TIN-2"]);
  });

  it("acquisition-key dedup STAYS per-tobacco", () => {
    // Two different blends bought the same day at the same price are not the
    // same tin, so widening `lotMergeKey` to the whole cellar would DROP a
    // real lot. Only the uid is an identity.
    const save = vi.fn();
    const acq = { status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "", datePurchased: "2024-01-01", price: "12" };
    const local = {
      tobaccos: [
        { id: 1, brand: "D", name: "One", uid: "u1", lots: [{ id: 100, ...acq }] },
        { id: 2, brand: "D", name: "Two", uid: "u2", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 2, brand: "D", name: "Two", uid: "u2", lots: [{ id: 200, ...acq }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const two = save.mock.calls[0]![0].tobaccos.find((t: any) => t.name === "Two");
    expect(two.lots.length, "a uid-less lot on ANOTHER blend must not shadow this one").toBe(1);
  });

  it("counts that skip instead of staying silent", () => {
    // Silence here reads as "my backup did not bring my tin back", and the
    // remedy is one tap away in a place the user may not think to look.
    const save = vi.fn();
    const onMerged = vi.fn();
    const acq = { status: "cellar", weightInitial: "100", weightG: "100", boxNumber: "7", datePurchased: "2024-01-01" };
    const local = {
      tobaccos: [{ id: 1, brand: "D", name: "N", uid: "tu", lots: [{ id: 5001, uid: "LU", ...acq, deletedAt: "2026-01-01" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 10, brand: "D", name: "N", uid: "tu", lots: [{ id: 5001, uid: "LU", ...acq }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    // `onMerged` is threaded through the AUTO-APPLY path — which is the one
    // the cloud-newer banner's one-tap « Restaurer » uses, i.e. a real route
    // to this defect and not a convenience for the test.
    act(() => { result.current.stageImport(incoming, "file", { autoApply: "merge", onMerged }); });
    expect(onMerged).toHaveBeenCalled();
    expect(onMerged.mock.calls[0]![0].lotsTrashedSkipped).toBe(1);
  });

  it("a uid-LESS trashed lot is matched on its acquisition key (legacy fallback)", () => {
    // Earlier lots carry no uid, so `lotMergeKey` is the only identity
    // available. Disclosed rather than guessed at — the precedent.
    const save = vi.fn();
    const acq = { status: "cellar", weightInitial: "100", weightG: "100", boxNumber: "7", datePurchased: "2024-01-01", price: "12", seller: "x" };
    const local = {
      tobaccos: [{ id: 1, brand: "D", name: "N", uid: "tu", lots: [{ id: 5001, ...acq, deletedAt: "2026-01-01" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 10, brand: "D", name: "N", uid: "tu", lots: [{ id: 5001, ...acq }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [], nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    expect(save.mock.calls[0]![0].tobaccos[0].lots.length).toBe(1);
  });

  // re-importing your own backup (uid'd lots) appends nothing —
  // every imported lot's uid matches a local lot → all deduped.
  it("re-import of uid'd lots is idempotent (0 appended by uid match)", () => {
    const save = vi.fn();
    const mkLots = () => [
      { id: 100, uid: "lu1", status: "jar", weightInitial: "50", weightG: "40", boxNumber: "1", datePurchased: "2024-01-01" },
      { id: 101, uid: "lu2", status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "2", datePurchased: "2024-02-01" },
    ];
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", uid: "tob-uid", lots: mkLots() }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 10, brand: "Brackwater", name: "Duskfall", uid: "tob-uid", lots: mkLots() }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots.length).toBe(2); // no re-append
  });

  it("does not re-append lots on a second identical import (idempotent)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{
        id: 10, brand: "Brackwater", name: "Duskfall",
        lots: [{ id: 400, status: "cellar", weightInitial: "50", weightG: "50", boxNumber: "7", datePurchased: "2025-02-02" }],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 11, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    // first import: lot appended
    const props1 = makeProps({ data: local, save });
    const h1 = renderHook(() => useImportConfirm(props1 as any));
    act(() => { h1.result.current.stageImport(incoming, "file"); });
    act(() => { h1.result.current.applyImport("merge"); });
    const afterFirst = save.mock.calls[0]![0];
    expect(afterFirst.tobaccos[0].lots.length).toBe(1);
    // second import of the SAME file against the post-first data: no new lot
    save.mockClear();
    const props2 = makeProps({ data: afterFirst, save });
    const h2 = renderHook(() => useImportConfirm(props2 as any));
    act(() => { h2.result.current.stageImport(incoming, "file"); });
    act(() => { h2.result.current.applyImport("merge"); });
    const afterSecond = save.mock.calls[0]![0];
    expect(afterSecond.tobaccos[0].lots.length).toBe(1);
  });

  // dedup-on-merge no longer drops optional fields from
  // the imported copy. If the local session has no geo and the imported
  // copy does, lat/lng are pulled across. Local values are never
  // overwritten — local edits stay authoritative.
  it("enriches a local session with lat/lng from the imported dup", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{
        id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "",
        duration: "30", weightG: "3", rating: 4, notes: "",
      }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{
        id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "",
        duration: "30", weightG: "3", rating: 4, notes: "",
        lat: 48.8566, lng: 2.3522,
      }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    // Still one session (dedup), but lat/lng are now present.
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].lat).toBeCloseTo(48.8566);
    expect(saved.sessions[0].lng).toBeCloseTo(2.3522);
  });

  // The tasting-wheel aromas now travel across a merge
  // when the local dup has none (weightG/time/duration are deliberately NOT
  // enriched — see the store comment).
  it("enriches a local session with aromas from the imported dup when local has none", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3", aromas: [] }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3", aromas: ["vanilla", "leather"] }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].aromas).toEqual(["vanilla", "leather"]);
  });

  it("does NOT overwrite existing local aromas from the imported dup", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3", aromas: ["hay"] }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3", aromas: ["vanilla"] }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    expect(save.mock.calls[0]![0].sessions[0].aromas).toEqual(["hay"]);
  });

  // last-write-wins for genuine multi-device edits. When BOTH
  // copies carry `updatedAt` and the imported one is strictly newer, its
  // non-key optional fields OVERWRITE the local ones.
  it("overwrites local notes/rating with a NEWER imported dup (updatedAt LWW)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "old note", rating: 3, aromas: ["hay"], updatedAt: "2026-05-15T10:00:00.000Z" }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "edited on device B", rating: 5, aromas: ["vanilla"], updatedAt: "2026-06-01T12:00:00.000Z" }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const s = save.mock.calls[0]![0].sessions[0];
    expect(s.notes).toBe("edited on device B");
    expect(s.rating).toBe(5);
    expect(s.aromas).toEqual(["vanilla"]);
    expect(s.updatedAt).toBe("2026-06-01T12:00:00.000Z"); // newer stamp carried
    // weightG (accounting-linked) is NEVER touched by LWW.
    expect(s.weightG).toBe("3");
  });

  it("keeps local notes when the imported dup is OLDER (updatedAt LWW)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "local edit", rating: 5, updatedAt: "2026-06-10T09:00:00.000Z" }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "stale backup", rating: 2, updatedAt: "2026-05-15T10:00:00.000Z" }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const s = save.mock.calls[0]![0].sessions[0];
    expect(s.notes).toBe("local edit");
    expect(s.rating).toBe(5);
  });

  it("never clobbers a non-empty local edit when only the imported copy has updatedAt (legacy-safe)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      // no updatedAt on the local (pre-feature) session
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3", notes: "hand-written locally" }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "", duration: "30", weightG: "3",
        notes: "imported", updatedAt: "2026-06-01T12:00:00.000Z" }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    // fill-if-empty only (both-updatedAt gate not met) → local edit preserved.
    expect(save.mock.calls[0]![0].sessions[0].notes).toBe("hand-written locally");
  });

  it("never overwrites local notes/rating with the imported dup's", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{
        id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "",
        duration: "30", weightG: "3", rating: 4, notes: "local-note",
      }],
      nxJ: 2, nxT: 1, nxW: 1, nxP: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [{
        id: 1, date: "2026-05-15", tobaccoId: "", pipeId: "",
        duration: "30", weightG: "3", rating: 5, notes: "imported-overwrite",
      }],
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].notes).toBe("local-note");
    expect(saved.sessions[0].rating).toBe(4);
  });
});

// applyImport now takes an optional `selection` Set of
// "kind:id" strings (matching the trash modal + the import picker
// UI). When mode is "merge" AND a non-empty selection is passed,
// tabacs / pipes / wishlist / accessories are filtered to keep
// ONLY the picked rows before the merge runs. Sessions pass
// through unfiltered — the existing dedup logic keeps the
// journal clean.
describe("applyImport('merge', selection) — the selective merge", () => {
  it("only adds tabacs / pipes whose id is in the selection set", () => {
    const save = vi.fn();
    const localBigger = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, brand: "Halvorsen", name: "Sherlock Holmes" }],
      wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 2, nxJ: 1, nxW: 1, nxA: 1,
    };
    const importedExpanded = {
      tobaccos: [
        { id: 10, brand: "Marlow & Finch", name: "Bayou Morning", lots: [] },
        { id: 11, brand: "Pellworm", name: "HH Old Dark Fired", lots: [] },
        { id: 12, brand: "G.L. Pease", name: "Robusto", lots: [] },
      ],
      pipes: [
        { id: 20, brand: "Savinelli", name: "Trevi" },
        { id: 21, brand: "Stanwell", name: "Sterling" },
      ],
      wishlist: [], accessories: [], sessions: [],
      nxT: 13, nxP: 22, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: localBigger, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(importedExpanded, "file"); });
    // Pick only tabac 10 (Bayou Morning) + pipe 21 (Sterling).
    const sel = new Set(["tobacco:10", "pipe:21"]);
    act(() => { result.current.applyImport("merge", sel); });
    const saved = save.mock.calls[0]![0];
    const tobNames = saved.tobaccos.map((t: any) => t.name).sort();
    const pipeNames = saved.pipes.map((p: any) => p.name).sort();
    // Local Duskfall kept; Bayou Morning added; the other two NOT added.
    expect(tobNames).toEqual(["Bayou Morning", "Duskfall"]);
    expect(pipeNames).toEqual(["Sherlock Holmes", "Sterling"]);
  });

  it("empty selection set behaves like a normal merge (selection ignored)", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    // Same call as the existing 'merge' test, but with empty Set.
    act(() => { result.current.applyImport("merge", new Set()); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.map((t: any) => t.name).sort())
      .toEqual(["HH Old Dark Fired", "Duskfall", "Adagio Green"].sort());
  });

  // sessions are now filterable like every other kind.
  // If the user doesn't pick any session, NONE are imported. If they
  // pick some, only those (after dedup) are merged.
  it("sessions are filtered by the selection — none picked → none imported", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    // Select only the new tabac — no session keys in the set.
    const sel = new Set(["tobacco:11"]);
    act(() => { result.current.applyImport("merge", sel); });
    const saved = save.mock.calls[0]![0];
    // Local session preserved (id 1 from baseLocal). Imported sessions
    // skipped because none were picked.
    expect(saved.sessions.length).toBe(1);
    expect(saved.sessions[0].id).toBe(1);
  });

  it("session selection imports only the picked sessions", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    // Pick session 30 only (id 31 is a perfect duplicate that the
    // existing dedup would drop anyway — covered by the next test).
    const sel = new Set(["session:30"]);
    act(() => { result.current.applyImport("merge", sel); });
    const saved = save.mock.calls[0]![0];
    // Local session + imported session 30. Dedup leaves both because
    // they have different (date, tobId, pipeId, duration) tuples.
    const dates = saved.sessions.map((s: any) => s.date).sort();
    expect(dates).toEqual(["2026-01-15", "2026-02-20"]);
  });

  it("session dedup still applies inside the selected subset", () => {
    // Sessions 30 and 31 share (date+tobId+pipeId+duration). Picking
    // both must still drop the dup.
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    const sel = new Set(["session:30", "session:31"]);
    act(() => { result.current.applyImport("merge", sel); });
    const saved = save.mock.calls[0]![0];
    // Local session + ONE imported session (the dup is dropped).
    expect(saved.sessions.length).toBe(2);
  });

  it("replace mode ignores the selection set (semantics are mutually exclusive)", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    // Replace + a partial selection: must still wipe + use the full
    // imported payload (replace + select is not a meaningful combo).
    act(() => { result.current.applyImport("replace", new Set(["tobacco:10"])); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.map((t: any) => t.name).sort())
      .toEqual(["Duskfall", "Adagio Green"].sort());
    expect(saved.pipes[0].name).toBe("Trevi");
  });
});

describe("cancelImport", () => {
  it("clears the staged payload without calling save", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(imported, "file"); });
    act(() => { result.current.cancelImport(); });
    expect(result.current.importConfirm).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

// ── defensive validation of forged payloads ──────────────
describe("stageImport — _apiKey validation", () => {
  // The imported key is DEFERRED — stashed on the
  // staged state and only written to localStorage once the user actually
  // confirms the import. A cancelled import must never leak a foreign key.
  it("accepts a string _apiKey within length limits (deferred to apply)", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, { _apiKey: "sk-ant-api03-abc" }),
        "file",
      );
    });
    // Not written yet — only stashed on the staged state.
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(result.current.importConfirm!.apiKey).toBe("sk-ant-api03-abc");
    // replace, not merge — the write is replace-only now.
    act(() => { result.current.applyImport("replace"); });
    // second arg is the source provider — undefined
    // for legacy backups means "active provider".
    expect(saveApiKey).toHaveBeenCalledWith("sk-ant-api03-abc", undefined);
  });

  // A backup made under one provider must not silently
  // overwrite the key slot of another provider on the importing device.
  it("forwards _apiKeyProvider so the key lands in the matching slot", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, {
          _apiKey: "sk-ant-source-key",
          _apiKeyProvider: "anthropic",
        }),
        "file",
      );
    });
    // _apiKeyProvider is stripped from the staged payload like _apiKey.
    expect(result.current.importConfirm!.parsed._apiKeyProvider).toBeUndefined();
    expect(result.current.importConfirm!.apiKey).toBe("sk-ant-source-key");
    expect(result.current.importConfirm!.apiKeyProvider).toBe("anthropic");
    // replace, not merge. The provider ROUTING this case exists for
    // is orthogonal to the mode; it just needs a mode that writes.
    act(() => { result.current.applyImport("replace"); });
    expect(saveApiKey).toHaveBeenCalledWith("sk-ant-source-key", "anthropic");
  });

  it("rejects a non-string _apiKey (object, number, boolean)", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, { _apiKey: { malicious: "payload" } }),
        "file",
      );
    });
    expect(saveApiKey).not.toHaveBeenCalled();
    // rejected key is never even stashed for the deferred apply.
    expect(result.current.importConfirm!.apiKey).toBeUndefined();
  });

  it("rejects an empty string _apiKey", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, { _apiKey: "" }),
        "file",
      );
    });
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(result.current.importConfirm!.apiKey).toBeUndefined();
  });

  // An audit found this case had gone VACUOUS and nothing said so. Deferring
  // the write did it: `stageImport` no longer calls `saveApiKey` for ANY key,
  // valid or not, so `expect(saveApiKey).not.toHaveBeenCalled()` after a stage
  // is true whether or not the length cap exists. Its two siblings above were
  // given the `importConfirm.apiKey` assertion in that same build; this one was
  // not, so raising the cap from 200 to 200 000 000 left the whole suite green.
  // The assertions below follow the key to both places it can land.
  it("rejects a too-long _apiKey (> 200 chars — DoS guard)", () => {
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const huge = "x".repeat(1_000_000);
    act(() => {
      result.current.stageImport(
        Object.assign({}, imported, { _apiKey: huge }),
        "file",
      );
    });
    expect(saveApiKey).not.toHaveBeenCalled();
    // Never stashed for the deferred apply…
    expect(result.current.importConfirm!.apiKey).toBeUndefined();
    // …and therefore never written when the user does confirm.
    act(() => { result.current.applyImport("merge"); });
    expect(saveApiKey).not.toHaveBeenCalled();
  });

  it("accepts a key exactly at the 200-char boundary", () => {
    // Pins which side of the cap is inclusive, so "tighten the guard" can't
    // silently start rejecting a real provider key. Anthropic keys run to
    // ~110 chars, so 200 is headroom, not a limit anyone should trip.
    const saveApiKey = vi.fn();
    const props = makeProps({ data: baseLocal, saveApiKey });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const atCap = "x".repeat(200);
    act(() => {
      result.current.stageImport(Object.assign({}, imported, { _apiKey: atCap }), "file");
    });
    expect(result.current.importConfirm!.apiKey).toBe(atCap);

    const { result: r2 } = renderHook(() => useImportConfirm(makeProps({ data: baseLocal, saveApiKey }) as any));
    act(() => {
      r2.current.stageImport(Object.assign({}, imported, { _apiKey: "x".repeat(201) }), "file");
    });
    expect(r2.current.importConfirm!.apiKey).toBeUndefined();
  });
});

describe("stageImport — shape sanitization", () => {
  it("coerces non-array top-level fields to [] (partially-valid payload)", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      // at least one array (tobaccos) makes this a plausible
      // backup so it passes the front-door gate; the other garbage fields
      // are still coerced to [] by sanitizeImportShape.
      result.current.stageImport({
        tobaccos: [],
        pipes: { not: "an array" },
        wishlist: null,
        accessories: 42,
        sessions: undefined,
      } as any, "file");
    });
    const ic = result.current.importConfirm!;
    expect(Array.isArray(ic.parsed.pipes)).toBe(true);
    expect(Array.isArray(ic.parsed.wishlist)).toBe(true);
    expect(Array.isArray(ic.parsed.accessories)).toBe(true);
    expect(Array.isArray(ic.parsed.sessions)).toBe(true);
    expect(ic.parsed.pipes).toEqual([]);
  });

  it("refuses a payload that isn't a plausible backup", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport({
        tobaccos: "oops", pipes: 42, wishlist: null,
      } as any, "file");
    });
    // No collection is an array → rejected outright, nothing staged.
    expect(result.current.importConfirm).toBeNull();
  });

  it("coerces non-array tobacco.lots to []", () => {
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport({
        tobaccos: [
          { id: 1, brand: "X", name: "Y", lots: "garbage" },
          { id: 2, brand: "X", name: "Z", lots: null },
          { id: 3, brand: "X", name: "W" }, // lots absent
          { id: 4, brand: "X", name: "V", lots: [{ id: 1, status: "jar" }] },
        ],
      } as any, "file");
    });
    const ic = result.current.importConfirm!;
    ic.parsed.tobaccos.forEach((t: any) => {
      expect(Array.isArray(t.lots)).toBe(true);
    });
    expect(ic.parsed.tobaccos[3].lots.length).toBe(1);
  });

  it("downstream applyImport never crashes on garbage-shaped input", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      // fully garbage payload is now refused at the front door,
      // so nothing is staged and applyImport is a safe no-op (never throws,
      // never saves) — the local data is untouched.
      result.current.stageImport({
        tobaccos: "broken",
        pipes: 42,
      } as any, "file");
    });
    expect(result.current.importConfirm).toBeNull();
    expect(() => {
      act(() => { result.current.applyImport("merge"); });
    }).not.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("applyImport('merge') — latent-bug fixes", () => {
  it("clears a fantôme session ref instead of colliding with a live local entity", () => {
    const save = vi.fn();
    // Session references tobaccoId 2, which is NOT in the imported tobaccos
    // (its tobacco was permanently deleted before the backup — a fantôme
    // ref). Local baseLocal HAS a tobacco id 2 (Pellworm). Pre-fix the raw
    // id 2 survived the merge and the session mis-attributed to Pellworm.
    const payload = {
      tobaccos: [{ id: 10, brand: "New", name: "Blend", lots: [] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{
        id: 30, tobaccoId: 2, pipeId: "", date: "2026-03-01", duration: "20",
        tobaccoSnapshot: { brand: "Ghost", name: "Blend" },
      }],
      nxT: 11, nxP: 1, nxJ: 31, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    const merged = saved.sessions.find((s: any) => s.tobaccoSnapshot && s.tobaccoSnapshot.brand === "Ghost");
    expect(merged).toBeTruthy();
    expect(merged.tobaccoId).toBe(""); // cleared, NOT 2 (would hit local Pellworm)
  });

  // An earlier release reversal of the drop behavior: a dup tobacco's imported
  // lot is now MERGED onto the local blend and the session re-links to it
  // (was: dropped + lotId cleared). See the lot-level-merge tests.
  it("re-links a session to the appended lot when a dup tobacco's imported lots are merged", () => {
    const save = vi.fn();
    // Imported "Brackwater Duskfall" is a dup of local id 1 (lots:[]). Its lot L9
    // is NOT already present, so it's appended with a fresh id and the session
    // re-links to that new lot instead of losing the ref.
    const payload = {
      tobaccos: [{ id: 10, brand: "Brackwater", name: "Duskfall", lots: [{ id: "L9", status: "jar", weightG: "40", weightInitial: "40", boxNumber: "9" }] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 30, tobaccoId: 10, lotId: "L9", pipeId: "", date: "2026-03-02", duration: "25" }],
      nxT: 11, nxP: 1, nxJ: 31, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    const local1 = saved.tobaccos.find((t: any) => t.id === 1);
    expect(local1.lots.length).toBe(1); // lot merged onto the local dup
    const merged = saved.sessions.find((s: any) => s.duration === "25");
    expect(merged.tobaccoId).toBe(1);           // remapped to the local dup
    expect(merged.lotId).toBe(local1.lots[0].id); // re-linked to the appended lot
    expect(merged.lotId).not.toBe("L9");        // not the raw imported id
  });

  it("still clears a dangling lotId when the dup tobacco's imported lot is soft-deleted (not merged)", () => {
    const save = vi.fn();
    // The imported lot carries deletedAt → it's SKIPPED by the merge, so the
    // session's lotId has nothing to link to and must be cleared.
    const payload = {
      tobaccos: [{ id: 10, brand: "Brackwater", name: "Duskfall", lots: [{ id: "L9", status: "jar", weightG: "40", deletedAt: "2026-01-01T00:00:00.000Z" }] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 30, tobaccoId: 10, lotId: "L9", pipeId: "", date: "2026-03-02", duration: "25" }],
      nxT: 11, nxP: 1, nxJ: 31, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    const local1 = saved.tobaccos.find((t: any) => t.id === 1);
    expect(local1.lots.length).toBe(0); // soft-deleted lot not merged
    const merged = saved.sessions.find((s: any) => s.duration === "25");
    expect(merged.tobaccoId).toBe(1); // remapped to the local dup
    expect(merged.lotId).toBe("");    // dangling lot cleared
  });

  it("keeps two same-day sessions that differ only by time (dedup includes time)", () => {
    const save = vi.fn();
    const payload = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 30, tobaccoId: "", pipeId: "", date: "2026-03-03", time: "09:00", duration: "30" },
        { id: 31, tobaccoId: "", pipeId: "", date: "2026-03-03", time: "21:00", duration: "30" },
      ],
      nxT: 1, nxP: 1, nxJ: 32, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    const day = saved.sessions.filter((s: any) => s.date === "2026-03-03");
    expect(day.length).toBe(2); // pre-fix: 1 (second dropped as dup)
  });
});

// ── audit fixes — trash boundary + empty-replace guard ────────────────────
describe("audit fixes — trash boundary + empty-replace guard", () => {
  it("BUG-1: merge does NOT dedup against a soft-deleted local row (imported live copy is added, session links live)", () => {
    const save = vi.fn();
    const localWithTrashed = {
      tobaccos: [
        { id: 5, brand: "Brackwater", name: "965", lots: [], deletedAt: "2020-01-01T00:00:00.000Z" },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 6, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const backup = {
      tobaccos: [{ id: 12, brand: "Brackwater", name: "965", lots: [{ id: "LX", status: "cellar", weightG: "50" }] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 30, tobaccoId: 12, pipeId: "", date: "2026-03-01", duration: "20", weightG: "0" }],
      nxT: 13, nxP: 1, nxJ: 31, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: localWithTrashed, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(backup, "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const live = saved.tobaccos.filter((t: any) => !t.deletedAt && t.brand === "Brackwater" && t.name === "965");
    const trashed = saved.tobaccos.filter((t: any) => t.deletedAt);
    expect(live.length).toBe(1);            // imported live copy ADDED (was dropped pre-fix)
    expect(live[0].lots.length).toBe(1);    // with its lot
    expect(trashed.length).toBe(1);         // trashed local copy preserved
    const sess = saved.sessions.find((s: any) => s.date === "2026-03-01");
    expect(sess.tobaccoId).toBe(live[0].id); // session links to the LIVE id…
    expect(sess.tobaccoId).not.toBe(5);      // …not the invisible trashed one
  });

  it("BUG-3: an empty autoApply:'replace' does NOT wipe a wishlist/accessory-only cellar", () => {
    const save = vi.fn();
    const localWishOnly = {
      tobaccos: [], pipes: [], sessions: [],
      wishlist: [{ id: 1, brand: "W", name: "want" }],
      accessories: [{ id: 1, brand: "A", name: "lighter" }],
      nxT: 1, nxP: 1, nxJ: 1, nxW: 2, nxA: 2,
    };
    const props = makeProps({ data: localWishOnly, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const emptyBackup = { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] };
    act(() => { result.current.stageImport(emptyBackup, "file", { autoApply: "replace" } as any); });
    expect(save).not.toHaveBeenCalled(); // refused — would have wiped wishlist + accessories
  });
});

// ── Tier 2 stable cross-device `uid` identity ─────────────────────

describe("resolveMergeMatch (Tier 2 identity resolution)", () => {
  const staged = (k: string, n = 1) => { const c: any = Object.create(null); c[k] = n; return c; };
  const keyed = (k: string, ids: any[]) => { const c: any = Object.create(null); c[k] = ids; return c; };
  const uided = (u: string, id: any) => { const c: any = Object.create(null); c[u] = id; return c; };

  it("matches by uid when the imported uid exists locally", () => {
    const m = resolveMergeMatch(
      { uid: "U1", brand: "Brackwater", name: "Duskfall" },
      uided("U1", 7), keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall"),
    );
    expect(m).toEqual({ localId: 7, byUid: true });
  });

  it("falls back to brand|name when unambiguous 1:1", () => {
    const m = resolveMergeMatch(
      { brand: "Brackwater", name: "Duskfall" },
      Object.create(null), keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall"),
    );
    expect(m).toEqual({ localId: 7, byUid: false });
  });

  it("returns null when >1 LOCAL rows share the brand|name (ambiguity guard)", () => {
    const m = resolveMergeMatch(
      { brand: "Brackwater", name: "Duskfall" },
      Object.create(null), keyed("brackwater|duskfall", [7, 8]), staged("brackwater|duskfall"),
    );
    expect(m).toBeNull();
  });

  it("returns null when >1 STAGED rows share the brand|name (import-side ambiguity)", () => {
    const m = resolveMergeMatch(
      { brand: "Brackwater", name: "Duskfall" },
      Object.create(null), keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall", 2),
    );
    expect(m).toBeNull();
  });

  it("uid match wins even when brand|name is ambiguous", () => {
    const m = resolveMergeMatch(
      { uid: "U1", brand: "Brackwater", name: "Duskfall" },
      uided("U1", 8), keyed("brackwater|duskfall", [7, 8]), staged("brackwater|duskfall", 2),
    );
    expect(m).toEqual({ localId: 8, byUid: true });
  });

  it("returns null on no match", () => {
    expect(resolveMergeMatch(
      { brand: "X", name: "Y" }, Object.create(null), Object.create(null), Object.create(null),
    )).toBeNull();
  });

  // The brand|name fallback must NOT collapse a
  // uid'd import onto a local candidate that carries a DIFFERENT uid — they are
  // distinct entities (a rename freed the old name). Add as new instead.
  it("returns null when the import has a uid and the sole local candidate has a DIFFERENT uid", () => {
    const idUid: any = Object.create(null); idUid["7"] = "LOCAL-UID";
    const m = resolveMergeMatch(
      { uid: "IMPORT-UID", brand: "Brackwater", name: "Duskfall" },
      Object.create(null), // uidMap: import uid not present → falls through to the name path
      keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall"), idUid,
    );
    expect(m).toBeNull();
  });

  it("STILL falls back (adopts) when the import has a uid but the local candidate is uid-LESS", () => {
    const idUid: any = Object.create(null); // local 7 has no uid entry
    const m = resolveMergeMatch(
      { uid: "IMPORT-UID", brand: "Brackwater", name: "Duskfall" },
      Object.create(null), keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall"), idUid,
    );
    expect(m).toEqual({ localId: 7, byUid: false });
  });

  it("STILL falls back when the IMPORT has no uid (legacy) even if the local candidate has one", () => {
    const idUid: any = Object.create(null); idUid["7"] = "LOCAL-UID";
    const m = resolveMergeMatch(
      { brand: "Brackwater", name: "Duskfall" },
      Object.create(null), keyed("brackwater|duskfall", [7]), staged("brackwater|duskfall"), idUid,
    );
    expect(m).toEqual({ localId: 7, byUid: false });
  });

  it("a forged uid equal to a prototype member does not false-match", () => {
    // hasOwnProperty guard: uidMap["toString"] must not resolve to a function.
    const m = resolveMergeMatch(
      { uid: "toString", brand: "X", name: "Y" },
      Object.create(null), Object.create(null), Object.create(null),
    );
    expect(m).toBeNull();
  });
});

describe("merge — Tier 2 uid identity", () => {
  it("does NOT collapse two same-name blends that carry distinct uids", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [
        { id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] },
        { id: 2, uid: "TB", brand: "Brackwater", name: "Duskfall", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    // Imported from another device that received the same pair (uids preserved).
    const incoming = {
      tobaccos: [
        { id: 90, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] },
        { id: 91, uid: "TB", brand: "Brackwater", name: "Duskfall", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 92, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.filter((t: any) => t.brand === "Brackwater").length).toBe(2);
    expect(saved.tobaccos.filter((t: any) => t.uid === "TA").length).toBe(1);
    expect(saved.tobaccos.filter((t: any) => t.uid === "TB").length).toBe(1);
  });

  it("is idempotent: re-importing a uid-stamped backup adds nothing", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 2, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 2, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBe(1);
    expect(saved.pipes.length).toBe(1);
  });

  it("ambiguity guard: a same-name import adds as NEW (no cross-contamination) when 2 local rows share the name", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [
        { id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [{ id: "L1", status: "jar", weightG: "30", weightInitial: "50" }] },
        { id: 2, uid: "TB", brand: "Brackwater", name: "Duskfall", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    // A legacy (uid-less) same-name import: can't be confidently matched → new.
    const incoming = {
      tobaccos: [{ id: 90, brand: "Brackwater", name: "Duskfall", lots: [{ id: "LX", status: "jar", weightG: "20", weightInitial: "20" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 91, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.filter((t: any) => t.brand === "Brackwater").length).toBe(3);
    // TA's lots are untouched (the imported lot was NOT appended onto it).
    const ta = saved.tobaccos.find((t: any) => t.uid === "TA");
    expect(ta.lots.length).toBe(1);
  });

  it("adoption: a uid-less local blend adopts the imported uid on a brand|name match", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }], // legacy, no uid
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 90, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 91, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBe(1);     // matched, not duplicated
    expect(saved.tobaccos[0].uid).toBe("TA");  // adopted the stable id
  });

  it("session dedup: two same-key sessions with distinct uids are BOTH kept", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [],
      sessions: [{ id: 1, uid: "SA", tobaccoId: 1, pipeId: 1, date: "2026-01-15", time: "", duration: "30" }],
      nxT: 2, nxP: 2, nxJ: 2, nxW: 1, nxA: 1,
    };
    // Same sessKey (date/time/tob/pipe/duration) but a DIFFERENT uid → distinct bowl.
    const incoming = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [],
      sessions: [{ id: 5, uid: "SB", tobaccoId: 1, pipeId: 1, date: "2026-01-15", time: "", duration: "30" }],
      nxT: 2, nxP: 2, nxJ: 6, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions.length).toBe(2);
  });

  it("a rename that frees a name does NOT collapse a new distinct same-name entity", () => {
    const save = vi.fn();
    // Local device B still has the OLD name for uid U.
    const local = {
      tobaccos: [{ id: 1, uid: "U", brand: "Brackwater", name: "Duskfall", lots: [{ id: "LU", status: "jar", weightG: "30", weightInitial: "50" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    // Source device A: renamed U → "Duskfall 2019", then added a NEW distinct tin
    // V that reuses the freed old name "Duskfall".
    const incoming = {
      tobaccos: [
        { id: 90, uid: "U", brand: "Brackwater", name: "Duskfall 2019", lots: [] },
        { id: 91, uid: "V", brand: "Brackwater", name: "Duskfall", lots: [{ id: "LV", status: "jar", weightG: "20", weightInitial: "20" }] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 92, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    // V is added as its OWN row (not collapsed into U). Two Brackwater tobaccos.
    expect(saved.tobaccos.filter((t: any) => t.brand === "Brackwater").length).toBe(2);
    expect(saved.tobaccos.filter((t: any) => t.uid === "V").length).toBe(1);
    // U's lots are NOT contaminated by V's lot.
    const u = saved.tobaccos.find((t: any) => t.uid === "U");
    expect(u.lots.length).toBe(1);
    expect(u.lots[0].id).toBe("LU");
  });

  it("session dedup: the SAME uid dedups even when the sessKey differs (idempotent edit)", () => {
    const save = vi.fn();
    const local = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [],
      sessions: [{ id: 1, uid: "SA", tobaccoId: 1, pipeId: 1, date: "2026-01-15", time: "08:00", duration: "30" }],
      nxT: 2, nxP: 2, nxJ: 2, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 1, uid: "TA", brand: "Brackwater", name: "Duskfall", lots: [] }],
      pipes: [{ id: 1, uid: "PA", brand: "Halvorsen", name: "Sherlock" }],
      wishlist: [], accessories: [],
      sessions: [{ id: 5, uid: "SA", tobaccoId: 1, pipeId: 1, date: "2026-03-01", time: "09:00", duration: "40" }],
      nxT: 2, nxP: 2, nxJ: 6, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "drive", { autoApply: "merge" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions.length).toBe(1);
  });
});

// THE SILENT DOUBLING, and why it is only made visible.
//
// migrateData backfills a RANDOM uid, so two devices that shared a cellar
// BEFORE uids existed mint DIFFERENT ones for the SAME row. The merge refuses
// to collapse them (right: a wrong collapse loses a row and cross-contaminates
// its lots/sessions, irreversibly, while a duplicate is undone by deleting
// one) — but it reported the result only as "N tabacs ajoutés".
describe("identity conflicts are counted and reported", () => {
  it("mergeRefusedByUid agrees with resolveMergeMatch — they cannot drift", () => {
    const uidMap: Record<string, any> = Object.create(null);
    const keyIds: Record<string, any[]> = Object.create(null);
    keyIds["halvorsen|duskfall"] = [1];
    const staged: Record<string, number> = Object.create(null);
    staged["halvorsen|duskfall"] = 1;
    const idUid: Record<string, string> = Object.create(null);
    idUid["1"] = "uid-local";
    const imp = { brand: "Halvorsen", name: "Duskfall", uid: "uid-imported" };
    // Whenever the predicate says true, the matcher must really have refused.
    expect(mergeRefusedByUid(imp, uidMap, keyIds, staged, idUid)).toBe(true);
    expect(resolveMergeMatch(imp, uidMap, keyIds, staged, idUid)).toBeNull();
  });

  it("is FALSE when the local row is uid-less (legacy adoption, not a conflict)", () => {
    const uidMap: Record<string, any> = Object.create(null);
    const keyIds: Record<string, any[]> = Object.create(null);
    keyIds["halvorsen|duskfall"] = [1];
    const staged: Record<string, number> = Object.create(null);
    staged["halvorsen|duskfall"] = 1;
    const idUid: Record<string, string> = Object.create(null);
    const imp = { brand: "Halvorsen", name: "Duskfall", uid: "uid-imported" };
    expect(mergeRefusedByUid(imp, uidMap, keyIds, staged, idUid)).toBe(false);
    expect(resolveMergeMatch(imp, uidMap, keyIds, staged, idUid)).not.toBeNull();
  });

  it("is FALSE when the uid matches — the normal converged case", () => {
    const uidMap: Record<string, any> = Object.create(null);
    uidMap["uid-shared"] = 1;
    const keyIds: Record<string, any[]> = Object.create(null);
    const staged: Record<string, number> = Object.create(null);
    const idUid: Record<string, string> = Object.create(null);
    const imp = { brand: "Halvorsen", name: "Duskfall", uid: "uid-shared" };
    expect(mergeRefusedByUid(imp, uidMap, keyIds, staged, idUid)).toBe(false);
  });

  it("REPRODUCES two pre-uid devices: the cellar doubles, and the recap SAYS so", () => {
    // The real sequence. A cellar from before uids existed, migrated
    // INDEPENDENTLY on two devices — which is what actually happens, because
    // each device runs migrateData on its own copy at first load.
    const preUid = () => ({
      tobaccos: [{ id: 1, brand: "Halvorsen", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    });
    const devA: any = realMigrateData(preUid());
    const devB: any = realMigrateData(preUid());
    // Independent backfills → different identities for the SAME blend.
    expect(devA.tobaccos[0].uid).not.toBe(devB.tobaccos[0].uid);

    let saved: any = null;
    let summary: any = null;
    const props = makeProps({
      data: devA,
      save: (d: any) => { saved = d; },
      migrateData: realMigrateData,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      // autoApply runs the same _runImport the picker's "Fusionner" button
      // does; it is the path that carries the onMerged summary callback.
      result.current.stageImport(JSON.parse(JSON.stringify(devB)), "file",
        { autoApply: "merge", onMerged: (sm: any) => { summary = sm; } });
    });

    // The duplicate is DELIBERATE — collapsing two distinct identities would
    // lose a row irreversibly. What the counter changes is that it is REPORTED,
    // so the recap can say why the cellar just grew.
    expect(saved.tobaccos).toHaveLength(2);
    expect(summary).not.toBeNull();
    expect(summary.identityConflicts).toBe(1);
  });
});

// LWW was PER-ROW, and that silently destroyed prose.
// One `updatedAt` covers the whole row, so a device that touched ONE field
// overwrote every unprotected field, including ones it never edited.
// A merge must not CLEAR the per-fiche catalogue lock.
//
// Found by an adversarial review, and it is the lesson
// applied to a field the lock forgot to bring: `applyEntityLww` copies every
// UNPROTECTED key from a strictly-newer imported row, and `catalogueLock` was
// in neither protect list.
//
// The reachable sequence is ordinary, not contrived: you tick the box on
// device A; device B holds an older copy where it was never ticked; you change
// anything at all on B (a rating), so B's `updatedAt` advances past A's; the
// next merge on A silently drops the lock, and the recap reports the row as
// merely « mise à jour ». The next bulk catalogue pass then rewrites the very
// fiche the box existed to protect.
//
// WHY PROTECT rather than let last-write-wins settle it, since an UNLOCK on B
// arguably ought to propagate too:
//  · `false` is the TEMPLATE DEFAULT (BT/BW seed it), so the vast majority of
//    `false` values are not a decision at all — verbatim the finding
//    that a device overwrites fields it never touched;
//  · the error costs are asymmetric. Wrongly KEEPING a lock skips one row in
//    one bulk pass, and the confirm modal SAYS SO (`plan.locked`). Wrongly
//    CLEARING it rewrites a hand-curated fiche with nothing to warn you,
//    because the row now looks unlocked;
//  · `deletedAt` sits in all four protect lists for exactly this reason — an
//    import must not flip a flag whose whole job is to hold a row out of a
//    process.
// Unlocking stays a one-tap act on whichever device you are holding.
const LWW_PROTECT_TOB_FIXTURE = ["id", "uid", "brand", "name", "deletedAt", "imageUrl", "lots"];
const LWW_PROTECT_WISH_FIXTURE = ["id", "uid", "brand", "name", "deletedAt", "imageUrl"];
const STICKY = ["catalogueLock"];

// The other half of the question the merge tests above answer: does the lock
// actually TRAVEL in a backup? Asked by the user. The blob is
// serialised whole, so the answer ought to be yes — but "ought to" is what
// this file exists to replace, and a field silently dropped on restore would
// look identical to one that was never ticked.
//
// Driven through the REAL hook and a REAL JSON round trip (a backup is
// `JSON.stringify(data)`), on both restore branches: replace, and the merge's
// added-wholesale path.
describe("the catalogue lock travels in a backup", () => {
  const locked = {
    tobaccos: [{ id: 1, brand: "Halvorsen", name: "Duskfall", lots: [], catalogueLock: true }],
    wishlist: [{ id: 2, brand: "Cranmere", name: "Salt Marsh", catalogueLock: true }],
    pipes: [], accessories: [], sessions: [],
    nxT: 2, nxW: 3, nxP: 1, nxA: 1, nxJ: 1,
  };
  // What a Drive / JSON / ZIP backup actually contains: the data blob, whole.
  const throughBackup = () => JSON.parse(JSON.stringify(locked));

  it("survives a RESTORE (replace)", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(throughBackup(), "drive"); });
    act(() => { result.current.applyImport("replace"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.find((t: any) => t.name === "Duskfall").catalogueLock).toBe(true);
    expect(saved.wishlist.find((w: any) => w.name === "Salt Marsh").catalogueLock).toBe(true);
  });

  it("survives a MERGE that adds the row wholesale", () => {
    // The branch that mints a fresh id for a row the local cellar does not
    // have. It spreads the whole row, but an allowlist here would silently
    // drop the flag on every first sync to a new device.
    const save = vi.fn();
    const props = makeProps({ data: { tobaccos: [], wishlist: [], pipes: [], accessories: [], sessions: [], nxT: 1, nxW: 1, nxP: 1, nxA: 1, nxJ: 1 }, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(throughBackup(), "drive"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBe(1);
    expect(saved.tobaccos[0].catalogueLock, "a first sync to a new device must carry the lock").toBe(true);
    expect(saved.wishlist[0].catalogueLock).toBe(true);
  });

  it("is not stripped by the staging step", () => {
    // stageImport removes the envelope keys (_settings, _apiKey, …). Assert it
    // does not reach into the entities while doing so.
    const props = makeProps({ data: baseLocal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(throughBackup(), "file"); });
    expect(result.current.importConfirm!.parsed.tobaccos[0].catalogueLock).toBe(true);
    expect(result.current.importConfirm!.parsed.wishlist[0].catalogueLock).toBe(true);
  });
});

describe("a merge cannot clear the catalogue lock", () => {
  const NEWER = { updatedAt: "2026-08-05T10:00:00.000Z" };
  const OLDER = { updatedAt: "2026-08-04T10:00:00.000Z" };

  it("keeps a local lock when the imported copy is newer and unlocked", () => {
    const local = { id: 1, brand: "Halvorsen", name: "Duskfall", catalogueLock: true, rating: 3, ...OLDER };
    const imported = { id: 1, brand: "Halvorsen", name: "Duskfall", catalogueLock: false, rating: 5, ...NEWER };
    const r = applyEntityLww(local, imported, LWW_PROTECT_TOB_FIXTURE, ["tastingNotes", "notes", "tags"], STICKY);
    expect(r.row.catalogueLock, "a newer device that never touched the lock must not clear it").toBe(true);
    // The rest of LWW must still work — this is a targeted shield, not a freeze.
    expect(r.row.rating).toBe(5);
  });

  it("keeps the lock for a wishlist item too", () => {
    const local = { id: 7, brand: "Halvorsen", name: "Duskfall", catalogueLock: true, ...OLDER };
    const imported = { id: 7, brand: "Halvorsen", name: "Duskfall", catalogueLock: false, priority: "high", ...NEWER };
    const r = applyEntityLww(local, imported, LWW_PROTECT_WISH_FIXTURE, [], STICKY);
    expect(r.row.catalogueLock).toBe(true);
    expect(r.row.priority).toBe("high");
  });

  it("still ADOPTS a lock the local row does not have", () => {
    // Protection is one-directional on purpose: it stops a lock being lost,
    // not a lock being gained. Object.assign copies the imported key first and
    // the restore puts the LOCAL value back — so a local `false` beating an
    // imported `true` would be the same defect mirrored. Assert it does not.
    const local = { id: 1, brand: "P", name: "N", catalogueLock: false, ...OLDER };
    const imported = { id: 1, brand: "P", name: "N", catalogueLock: true, ...NEWER };
    const r = applyEntityLww(local, imported, LWW_PROTECT_TOB_FIXTURE, [], STICKY);
    expect(r.row.catalogueLock, "protecting must not block a lock from arriving").toBe(true);
  });

  it("wires the field into the REAL protect lists, not just this fixture", () => {
    // The cases above pass a list built here, so they would stay green if the
    // production lists were reverted. Read the source and assert both.
    const src = readFileSync("src/hooks/useImportConfirm.ts", "utf8");
    const tob = src.match(/var LWW_STICKY_TOB = \[([^\]]*)\]/);
    const wish = src.match(/var LWW_STICKY_WISH = \[([^\]]*)\]/);
    expect(tob, "could not read LWW_STICKY_TOB — this test must not pass vacuously").toBeTruthy();
    expect(wish).toBeTruthy();
    expect(tob![1]).toContain("catalogueLock");
    expect(wish![1]).toContain("catalogueLock");
    // …and that both call sites actually PASS them — a list nothing consumes
    // is the shape this repo keeps finding.
    expect(src).toContain("LWW_FILL_TOB, LWW_STICKY_TOB)");
    expect(src).toContain("LWW_FILL_WISH, LWW_STICKY_WISH)");
  });
});

describe("entity LWW no longer overwrites the user's own prose", () => {
  const T0 = "2026-07-01T10:00:00.000Z";
  const T1 = "2026-07-01T10:05:00.000Z";

  it("REPRODUCES the reported loss: a newer row must not replace an existing note", () => {
    // iPad wrote the note at 10:00. iPhone changed only the rating at 10:05,
    // carrying its week-old copy of the note.
    const local = { id: 1, brand: "P", name: "N", rating: 3,
      tastingNotes: "Note écrite à l'instant sur l'iPad", updatedAt: T0 };
    const imported = { id: 1, brand: "P", name: "N", rating: 5,
      tastingNotes: "vieille note de l'iPhone", updatedAt: T1 };
    const r = applyEntityLww(local, imported, ["id", "brand", "name"],
      ["tastingNotes", "notes", "tags"]);
    expect(r.changed).toBe(true);
    // The deliberate scalar still propagates…
    expect(r.row.rating).toBe(5);
    // …but the prose the user typed is untouched.
    expect(r.row.tastingNotes).toBe("Note écrite à l'instant sur l'iPad");
  });

  it("still FILLS prose when the local side is blank — new content propagates", () => {
    const local = { id: 1, tastingNotes: "", notes: "   ", tags: [], updatedAt: T0 };
    const imported = { id: 1, tastingNotes: "du contenu", notes: "aussi", tags: ["voyage"], updatedAt: T1 };
    const r = applyEntityLww(local, imported, ["id"], ["tastingNotes", "notes", "tags"]);
    expect(r.row.tastingNotes).toBe("du contenu");
    expect(r.row.notes).toBe("aussi");
    expect(r.row.tags).toEqual(["voyage"]);
  });

  it("treats an empty tag array as blank, but never drops existing collections", () => {
    const local = { id: 1, tags: ["cadeaux"], updatedAt: T0 };
    const imported = { id: 1, tags: [], updatedAt: T1 };
    const r = applyEntityLww(local, imported, ["id"], ["tags"]);
    expect(r.row.tags).toEqual(["cadeaux"]);
  });

  it("leaves scalars on last-write-wins — a correction must still propagate", () => {
    // Freezing these would be the opposite mistake: a genuine fix on the other
    // device would never arrive.
    const local = { id: 1, rating: 2, category: "Anglais", updatedAt: T0 };
    const imported = { id: 1, rating: 4, category: "Balkan", updatedAt: T1 };
    const r = applyEntityLww(local, imported, ["id"], ["tastingNotes"]);
    expect(r.row.rating).toBe(4);
    expect(r.row.category).toBe("Balkan");
  });

  it("is inert when the import is not strictly newer", () => {
    const local = { id: 1, tastingNotes: "à moi", updatedAt: T1 };
    const imported = { id: 1, tastingNotes: "autre", updatedAt: T0 };
    const r = applyEntityLww(local, imported, ["id"], ["tastingNotes"]);
    expect(r.changed).toBe(false);
    expect(r.row.tastingNotes).toBe("à moi");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// A merge that ADDS a tobacco wholesale minted a fresh TOBACCO id and carried
// its lots verbatim, so the added row shared lot ids with the local twin it had
// just refused to match. Lot ids must be unique GLOBALLY (lotInvariants
// `lot-id-unique-global`) because useTrashOps and the 30-day sweep
// both delete / orphan BY LOT ID ACROSS EVERY TOBACCO.
//
// Two paths already got this right and this one was missed: the CSV importer
// re-stamps every lot (useExportImport, under a comment describing
// this exact damage) and the lot-level merge re-stamps each appended lot.
// The invariant's own comment claimed "the source is fixed
// (the importer re-stamps from monotonicId)" — true of the CSV importer alone.
describe("added-wholesale lots get fresh ids", () => {
  // The refusal is the ordinary pre-uid two-device state: same brand|name,
  // DIFFERENT uid, so resolveMergeMatch refuses to collapse them
  // and the imported row is added as new. Documented + counted as
  // identityConflicts; the point here is what its LOTS carry.
  const local = () => ({
    tobaccos: [{
      id: 1, uid: "uid-local-A", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: 700, uid: "lot-A", status: "cellar", weightInitial: "50", weightG: "50" }],
    }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  });
  const incoming = (sessions: any[] = []) => ({
    tobaccos: [{
      id: 9, uid: "uid-remote-B", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: 700, uid: "lot-B", status: "jar", weightInitial: "50", weightG: "40", dateOpened: "2026-01-01" }],
    }],
    pipes: [], wishlist: [], accessories: [], sessions,
    nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  });

  it("never leaves one lot id under two tobaccos", () => {
    const save = vi.fn();
    const props = makeProps({ data: local(), save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming(), "file"); });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.length).toBe(2);          // the refusal stands, deliberately
    const ids = saved.tobaccos.flatMap((t: any) => (t.lots || []).map((l: any) => String(l.id)));
    expect(ids.length).toBe(2);
    expect(new Set(ids).size, "a lot id must not exist under two tobaccos").toBe(2);
  });

  it("passes the global lot-id invariant, so no trash op can cross-fire", () => {
    // The consequence, stated as the app states it: with a shared id,
    // permanentlyDelete("lot") on one row takes the other row's LIVE lot, and
    // the 30-day sweep orphans the survivor's session with no user action.
    const save = vi.fn();
    const props = makeProps({ data: local(), save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming(), "file"); });
    act(() => { result.current.applyImport("merge"); });
    const v = checkAllInvariants(save.mock.calls[0]![0]);
    expect(v.filter((x: any) => x.rule === "lot-id-unique-global")).toEqual([]);
  });

  it("keeps the added row's session attached to its own re-stamped lot", () => {
    // Re-stamping must not orphan what it renumbers: an added-wholesale
    // tobacco arrives with its lots AND its sessions as a consistent unit
    // (Σ = weightInitial − weightG), so the session has to follow the new id.
    const save = vi.fn();
    const props = makeProps({ data: local(), save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(incoming([
        { id: 1, date: "2026-01-05", tobaccoId: 9, pipeId: "", lotId: 700, weightG: "10", duration: "30" },
      ]), "file");
    });
    act(() => { result.current.applyImport("merge"); });
    const saved = save.mock.calls[0]![0];
    const added = saved.tobaccos.find((t: any) => t.uid === "uid-remote-B");
    const sess = saved.sessions[0];
    expect(added).toBeTruthy();
    expect(sess.tobaccoId).toBe(added.id);
    expect(String(sess.lotId), "the session must point at the re-stamped lot")
      .toBe(String(added.lots[0].id));
    // …and the balance it describes is still exact.
    expect(checkAllInvariants(saved).filter((x: any) => x.scope === "lot")).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Merging your OWN backup was a perfect no-op except for one case: a row that
// is in your TRASH. `buildLocalMaps` skips `deletedAt` rows
// (deliberately — so an imported LIVE copy is not merged into, and shadowed by,
// an invisible trashed row), so the backup's copy found nothing to match and
// was added as new — CARRYING THE SAME `uid`. Two rows, one identity: `uidMap`
// is last-wins, so every later merge matches one of them arbitrarily and leaves
// the other permanently stale. Measured by the audit at 419 failures out of
// 1500 randomised cellars with trashed rows, and 0 out of 1500 without.
//
// The resolution keeps the intent for the case it was written for and
// refuses to guess in this one: a uid that matches a TRASHED local row is the
// SAME entity, so nothing is added and nothing is resurrected behind the user's
// back — the row is already in their cellar, in the trash, one tap from
// returning. It is COUNTED instead, so the recap can say so.
describe("merging your own backup does not duplicate a TRASHED row", () => {
  const trashedLocal = () => ({
    tobaccos: [{
      id: 1, uid: "uid-A", brand: "Halvorsen", name: "Duskfall",
      deletedAt: "2026-07-20T10:00:00.000Z",
      lots: [{ id: 700, uid: "lot-A", status: "cellar", weightInitial: "50", weightG: "50" }],
    }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  });
  // The same row as it stands in the backup taken before the delete.
  const backup = () => ({
    tobaccos: [{
      id: 1, uid: "uid-A", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: 700, uid: "lot-A", status: "cellar", weightInitial: "50", weightG: "50" }],
    }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  });
  const mergeInto = (local: any, incoming: any) => {
    const save = vi.fn();
    const props = makeProps({ data: local, save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file"); });
    act(() => { result.current.applyImport("merge"); });
    return save.mock.calls[0] ? save.mock.calls[0][0] : null;
  };

  it("adds nothing, and never mints a second row with the same uid", () => {
    const saved = mergeInto(trashedLocal(), backup());
    expect(saved.tobaccos.length, "the trashed row IS the row — nothing to add").toBe(1);
    const uids = saved.tobaccos.map((t: any) => t.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("leaves the deletion alone — a merge must not resurrect what you deleted", () => {
    // The backup may be a month old and the deletion deliberate. The row stays
    // in the trash, where the user can restore it themselves.
    const saved = mergeInto(trashedLocal(), backup());
    expect(saved.tobaccos[0].deletedAt).toBe("2026-07-20T10:00:00.000Z");
  });

  it("cannot produce two live rows sharing a uid after a trash restore", () => {
    // The sequence that made this dangerous: merge, then un-delete the row.
    const saved = mergeInto(trashedLocal(), backup());
    const restored = JSON.parse(JSON.stringify(saved));
    restored.tobaccos.forEach((t: any) => { delete t.deletedAt; });
    const live = restored.tobaccos.filter((t: any) => !t.deletedAt);
    expect(new Set(live.map((t: any) => t.uid)).size).toBe(live.length);
    expect(checkAllInvariants(restored).filter((v: any) => v.rule === "lot-id-unique-global")).toEqual([]);
  });

  it("is idempotent — merging the same backup twice adds nothing either time", () => {
    // The trap in the obvious alternative (mint a fresh uid on the added copy):
    // the imported uid would still match nothing live, so EVERY merge would add
    // another copy.
    const first = mergeInto(trashedLocal(), backup());
    const second = mergeInto(first, backup());
    expect(second === null || second.tobaccos.length === 1).toBe(true);
  });

  it("does the same for a trashed SESSION", () => {
    const local: any = trashedLocal();
    local.tobaccos[0] = Object.assign({}, local.tobaccos[0]); delete local.tobaccos[0].deletedAt;
    local.sessions = [{ id: 1, uid: "sess-A", date: "2026-05-01", tobaccoId: 1, pipeId: "", lotId: "", weightG: "0", duration: "30", deletedAt: "2026-07-20T10:00:00.000Z" }];
    const inc: any = backup();
    inc.sessions = [{ id: 1, uid: "sess-A", date: "2026-05-01", tobaccoId: 1, pipeId: "", lotId: "", weightG: "0", duration: "30" }];
    const saved = mergeInto(local, inc);
    expect(saved.sessions.length, "a trashed session must not be duplicated").toBe(1);
    expect(saved.sessions[0].deletedAt).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `imgCache.put` RESOLVES `false` on a transaction error or abort (quota
// exceeded, private mode) and only REJECTS when `open()` fails — the rule
// CLAUDE.md has stated. This caller inspected the resolution not
// at all, so a photo write that failed reported nothing.
//
// The shape is what made it costly: `save(next)` runs FIRST, so every row
// already points at its `local-photo-*` key, and the in-memory map serves those
// photos for the rest of the session. The restore looked perfect until the next
// launch, when every photo became a placeholder — permanently, with the import
// having reported success.
describe("a photo that fails to persist is reported", () => {
  const withPhoto = () => ({
    tobaccos: [{ id: 1, uid: "u1", brand: "Halvorsen", name: "Duskfall", imageUrl: "local-photo-1700000000000-abcd1234", lots: [] }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    _imageData: { "local-photo-1700000000000-abcd1234": "data:image/jpeg;base64,AAAA" },
  });
  const run = async (putImpl: (k: string, v: string) => any) => {
    const { imgCache } = await import("../utils/imgCache.ts");
    const spy = vi.spyOn(imgCache, "put").mockImplementation(putImpl as any);
    const setPhotoErr = vi.fn();
    const props = makeProps({
      data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] },
      save: vi.fn(), setPhotoErr,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    await act(async () => { result.current.stageImport(withPhoto(), "file"); });
    await act(async () => { result.current.applyImport("replace"); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    spy.mockRestore();
    return setPhotoErr;
  };

  it("raises the photo banner when the write RESOLVES false", async () => {
    // The reachable case — a `.catch` cannot see this one.
    const setPhotoErr = await run(() => Promise.resolve(false));
    expect(setPhotoErr).toHaveBeenCalled();
    expect(String(setPhotoErr.mock.calls[0]![0])).toContain("1");
  });

  it("raises it when the write REJECTS too", async () => {
    const setPhotoErr = await run(() => Promise.reject(new Error("no indexeddb")));
    expect(setPhotoErr).toHaveBeenCalled();
  });

  it("says NOTHING when every write lands", async () => {
    const setPhotoErr = await run(() => Promise.resolve(true));
    expect(setPhotoErr).not.toHaveBeenCalled();
  });

  it("survives a synchronous throw from put", async () => {
    const setPhotoErr = await run(() => { throw new Error("boom"); });
    expect(setPhotoErr).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// An earlier release shipped `_settings` in every backup with a comment reading "they
// take effect on the reload the restore path already performs". No import or
// restore path reloaded, anywhere. So after a replace-restore the language,
// theme, mode, text size, currency, date format and accounting toggle sat in
// localStorage while the running React state kept the OLD values — and
// `saveWeightUnit` converts the two unit-scoped weights from REACT STATE, so the
// next unit toggle silently discarded the restored values.
describe("a REPLACE that adopts preferences reloads", () => {
  const backupWithSettings = (settings: any = { "cave-lang": "de", "cave-theme": "steel" }) => ({
    tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 1, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    _settings: settings,
  });
  const runReplace = async (payload: any) => {
    const reload = vi.fn();
    const spy = vi.spyOn(window, "location", "get")
      .mockReturnValue({ ...window.location, reload } as any);
    const props = makeProps({ data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] }, save: vi.fn() });
    const { result } = renderHook(() => useImportConfirm(props as any));
    await act(async () => { result.current.stageImport(payload, "file"); });
    await act(async () => { result.current.applyImport("replace"); await Promise.resolve(); await Promise.resolve(); });
    spy.mockRestore();
    return reload;
  };

  it("reloads, so the pre-mount preferences actually take effect", async () => {
    expect(await runReplace(backupWithSettings())).toHaveBeenCalled();
  });

  it("does NOT reload an earlier backup that carries no preferences", async () => {
    const p: any = backupWithSettings(); delete p._settings;
    expect(await runReplace(p)).not.toHaveBeenCalled();
  });

  it("does NOT reload when the block carries nothing we accept", async () => {
    // sanitizeSettings drops everything off the allowlist, so nothing landed and
    // there is nothing a restart would reveal.
    expect(await runReplace(backupWithSettings({ "gdrive-tk": "secret", "pipe-cellar-v6": "{}" })))
      .not.toHaveBeenCalled();
  });

  it("does NOT reload on a MERGE — a merge never adopts preferences", async () => {
    const reload = vi.fn();
    const spy = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as any);
    const props = makeProps({ data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] }, save: vi.fn() });
    const { result } = renderHook(() => useImportConfirm(props as any));
    await act(async () => { result.current.stageImport(backupWithSettings(), "file"); });
    await act(async () => { result.current.applyImport("merge"); await Promise.resolve(); });
    spy.mockRestore();
    expect(reload).not.toHaveBeenCalled();
  });

  it("saves the cellar BEFORE reloading — the restore must survive the restart", async () => {
    const reload = vi.fn();
    const spy = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as any);
    const save = vi.fn();
    const props = makeProps({ data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] }, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const payload: any = backupWithSettings();
    payload.tobaccos = [{ id: 1, uid: "u1", brand: "Halvorsen", name: "Duskfall", lots: [] }];
    await act(async () => { result.current.stageImport(payload, "file"); });
    await act(async () => { result.current.applyImport("replace"); await Promise.resolve(); await Promise.resolve(); });
    spy.mockRestore();
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls[0]![0].tobaccos).toHaveLength(1);
    expect(reload).toHaveBeenCalled();
  });

  it("waits for the imported photos to be written before restarting", async () => {
    // Reloading over an in-flight IndexedDB write would lose exactly the photos
    // The fix exists to account for.
    const { imgCache } = await import("../utils/imgCache.ts");
    let release: (v: any) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const putSpy = vi.spyOn(imgCache, "put").mockImplementation(() => gate as any);
    const reload = vi.fn();
    const spy = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as any);
    const props = makeProps({ data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] }, save: vi.fn() });
    const { result } = renderHook(() => useImportConfirm(props as any));
    const payload: any = backupWithSettings();
    payload.tobaccos = [{ id: 1, uid: "u1", brand: "P", name: "N", imageUrl: "local-photo-1700000000000-aaaa1111", lots: [] }];
    payload._imageData = { "local-photo-1700000000000-aaaa1111": "data:image/jpeg;base64,AAAA" };
    await act(async () => { result.current.stageImport(payload, "file"); });
    await act(async () => { result.current.applyImport("replace"); await Promise.resolve(); await Promise.resolve(); });
    expect(reload, "must not restart while a photo write is in flight").not.toHaveBeenCalled();
    await act(async () => { release(true); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(reload).toHaveBeenCalled();
    putSpy.mockRestore();
    spy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The OTHER refusal, and the one nothing counted. `resolveMergeMatch`'s
// brand|name fallback fires only when EXACTLY ONE local and ONE staged row share
// The key (the ambiguity guard); when several do it refuses — rightly,
// it cannot tell which row this is — and the import lands as a NEW row beside
// them. `mergeRefusedByUid` could never see that: it requires the import to carry
// a uid AND the local candidate to be unique. A CSV row has no uid at all, so on
// the CSV path NOTHING was counted and the recap announced "already present, no
// new lot" for an import that had just created a duplicate. It compounds: one
// duplicate pair makes every later import of that blend add another copy.
describe("an AMBIGUOUS name refusal is counted", () => {
  it("mergeAmbiguousName fires when several LOCAL rows share the name", () => {
    const keyIds: any = { "halvorsen|duskfall": [1, 2] };
    expect(mergeAmbiguousName({ brand: "Halvorsen", name: "Duskfall" }, keyIds, { "halvorsen|duskfall": 1 })).toBe(true);
  });

  it("…and when several STAGED rows do", () => {
    const keyIds: any = { "halvorsen|duskfall": [1] };
    expect(mergeAmbiguousName({ brand: "Halvorsen", name: "Duskfall" }, keyIds, { "halvorsen|duskfall": 2 })).toBe(true);
  });

  it("is silent for an ordinary addition — a name that matches nothing", () => {
    expect(mergeAmbiguousName({ brand: "New", name: "Blend" }, {} as any, {} as any)).toBe(false);
    expect(mergeAmbiguousName({ brand: "New", name: "Blend" }, { "new|blend": [] } as any, {} as any)).toBe(false);
  });

  it("is DISJOINT from mergeRefusedByUid, so one counter cannot double-count", () => {
    // That one requires ids.length === 1; this one > 1 on one side or the other.
    const imp = { brand: "P", name: "N", uid: "imported" };
    const keyIds: any = { "p|n": [1] };
    const idUid: any = { "1": "local-different" };
    const staged: any = { "p|n": 1 };
    expect(mergeRefusedByUid(imp, {} as any, keyIds, staged, idUid)).toBe(true);
    expect(mergeAmbiguousName(imp, keyIds, staged)).toBe(false);
  });

  it("agrees with resolveMergeMatch — when it says true, the merge really refused", () => {
    const keyIds: any = { "p|n": [1, 2] };
    const staged: any = { "p|n": 1 };
    const imp = { brand: "P", name: "N" };
    expect(resolveMergeMatch(imp, {} as any, keyIds, staged, {} as any)).toBeNull();
    expect(mergeAmbiguousName(imp, keyIds, staged)).toBe(true);
  });

  it("reports the duplicate it created instead of calling it 'already present'", () => {
    // Two local rows with the same brand+name (the state the
    // DuplicatesPanel exists to clean up) + one import of that blend.
    const save = vi.fn();
    let summary: any = null;
    const local = {
      tobaccos: [
        { id: 1, uid: "a", brand: "Halvorsen", name: "Duskfall", lots: [] },
        { id: 2, uid: "b", brand: "Halvorsen", name: "Duskfall", lots: [] },
      ],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 3, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 9, brand: "Halvorsen", name: "Duskfall", lots: [] }],   // no uid: a CSV row
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    // The CSV route: autoApply skips the picker, which is where onMerged lives.
    act(() => { result.current.stageImport(incoming, "file", { autoApply: "merge", onMerged: (s: any) => { summary = s; } }); });
    expect(save.mock.calls[0]![0].tobaccos.length).toBe(3);        // it DID add one
    expect(summary.identityConflicts, "the duplicate must be reported").toBe(1);
    expect(summary.tobaccosMatched, "nothing matched — so nothing is 'already present'").toBe(0);
  });

  it("reports a genuinely-matched row as matched", () => {
    const save = vi.fn();
    let summary: any = null;
    const local = {
      tobaccos: [{ id: 1, uid: "a", brand: "Halvorsen", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const incoming = {
      tobaccos: [{ id: 9, brand: "Halvorsen", name: "Duskfall", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 10, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
    };
    const props = makeProps({ data: local, save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(incoming, "file", { autoApply: "merge", onMerged: (s: any) => { summary = s; } }); });
    expect(save.mock.calls[0]![0].tobaccos.length).toBe(1);
    expect(summary.tobaccosMatched).toBe(1);
    expect(summary.identityConflicts).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// LWW_PROTECT_PIPE shields `maintenance` and `photos` from being OVERWRITTEN —
// right, since a whole-row overwrite would drop whatever the local device logged
// — but nothing ever MERGED them. So a dup-matched pipe silently kept only the
// local set while the recap said « 1 fiche mise à jour », which a user reads as
// "this pipe is now current". A pipe smoked on two devices lost one device's
// cleanings outright. Same shape as the lot gap closed earlier, one entity over.
describe("a dup pipe's maintenance log and photos are merged", () => {
  const localPipe = (over: any = {}) => Object.assign({
    id: 1, uid: "pipe-A", brand: "Halvorsen", name: "Sherlock",
    maintenance: [{ id: 11, uid: "m-A1", date: "2026-01-05", kind: "light", tasks: ["swab"], notes: "" }],
    photos: ["local-photo-A1"],
  }, over);
  const remotePipe = (over: any = {}) => Object.assign({
    id: 9, uid: "pipe-A", brand: "Halvorsen", name: "Sherlock",
    updatedAt: "2026-07-01T00:00:00.000Z",
    maintenance: [
      { id: 11, uid: "m-A1", date: "2026-01-05", kind: "light", tasks: ["swab"], notes: "" },  // same entry
      { id: 12, uid: "m-B2", date: "2026-03-02", kind: "full", tasks: ["ream"], notes: "B" },
      { id: 13, uid: "m-B3", date: "2026-05-09", kind: "light", tasks: ["stem"], notes: "" },
    ],
    photos: ["local-photo-A1", "local-photo-B2", "local-photo-B3"],
  }, over);
  const merge = (lp: any, rp: any) => {
    const save = vi.fn();
    let summary: any = null;
    const local = { tobaccos: [], pipes: [lp], wishlist: [], accessories: [], sessions: [], nxT: 1, nxP: 2, nxJ: 1, nxW: 1, nxA: 1 };
    const inc = { tobaccos: [], pipes: [rp], wishlist: [], accessories: [], sessions: [], nxT: 1, nxP: 10, nxJ: 1, nxW: 1, nxA: 1 };
    const props = makeProps({ data: local, save, migrateData: realMigrateData });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(inc, "file", { autoApply: "merge", onMerged: (s: any) => { summary = s; } }); });
    return { pipe: save.mock.calls[0]![0].pipes[0], summary };
  };

  it("brings the other device's cleanings across, without duplicating the shared one", () => {
    const { pipe, summary } = merge(localPipe(), remotePipe());
    expect(pipe.maintenance.map((m: any) => m.uid).sort()).toEqual(["m-A1", "m-B2", "m-B3"]);
    expect(summary.maintenanceAppended).toBe(2);
  });

  it("an appended entry carries its TIME across", () => {
    // MOVED HERE from maintTimeSurvivesBackup.test.ts, where the case was
    // vacuous: it built `Object.assign({}, imported, { id })` by hand and
    // asserted the result still had a `time`, i.e. it asserted a property of
    // the JavaScript language. It would have passed with this whole merge
    // branch deleted.
    //
    // The time is what makes the maintenance reminder able to order a bowl
    // against a cleaning logged the same day, so losing it across a
    // cross-device merge silently un-does that feature on the merged device.
    const { pipe } = merge(
      localPipe({ maintenance: [] }),
      remotePipe({ maintenance: [
        { id: 12, uid: "m-B2", date: "2026-03-02", time: "09:15", kind: "full", tasks: ["ream"], notes: "B" },
      ] }),
    );
    const brought = pipe.maintenance.find((m: any) => m.uid === "m-B2");
    expect(brought, "the entry did not come across at all").toBeTruthy();
    expect(brought.time, "the merge dropped the cleaning's time").toBe("09:15");
  });

  it("re-stamps each appended entry's id — maintenance-id-unique is per pipe", () => {
    const { pipe } = merge(localPipe(), remotePipe());
    const ids = pipe.maintenance.map((m: any) => String(m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("unions the extra photos and respects the form's cap", () => {
    const { pipe, summary } = merge(localPipe(), remotePipe());
    expect(pipe.photos).toEqual(["local-photo-A1", "local-photo-B2", "local-photo-B3"]);
    expect(summary.photosAppended).toBe(2);
    // A merge must never produce a gallery the form would refuse to edit — and
    // WHERE that guarantee comes from is worth being exact about, because two
    // probes on this case were VACUOUS before I looked properly. `migrateData`
    // ALSO caps `pipe.photos` (it runs on the staged payload AND on the merged
    // result), so deleting the merge's own cap changes the stored gallery not at
    // all. What the merge's cap does earn is a TRUTHFUL COUNT: without it the
    // recap would announce 6 photos added when only 2 survived the trim.
    const fourLocal = localPipe({ photos: ["local-photo-l1", "local-photo-l2", "local-photo-l3", "local-photo-l4"] });
    const sixRemote = remotePipe({ photos: Array.from({ length: PIPE_MAX_EXTRA_PHOTOS }, (_, i) => "local-photo-r" + i) });
    const { pipe: capped, summary: cappedSum } = merge(fourLocal, sixRemote);
    expect(capped.photos.length).toBe(PIPE_MAX_EXTRA_PHOTOS);
    expect(capped.photos.slice(0, 4), "the local photos are never displaced")
      .toEqual(["local-photo-l1", "local-photo-l2", "local-photo-l3", "local-photo-l4"]);
    expect(cappedSum.photosAppended, "the recap must not claim more than survived")
      .toBe(PIPE_MAX_EXTRA_PHOTOS - 4);
  });

  it("is idempotent — a second merge of the same backup adds nothing", () => {
    const first = merge(localPipe(), remotePipe());
    const second = merge(first.pipe, remotePipe());
    expect(second.pipe.maintenance).toHaveLength(3);
    expect(second.summary.maintenanceAppended).toBe(0);
    expect(second.summary.photosAppended).toBe(0);
  });

  it("dedups a PRE-uid entry by its content, so legacy logs stay idempotent", () => {
    // maintenance uid arrived; an older backup carries none.
    const lp = localPipe({ maintenance: [{ id: 11, date: "2026-01-05", kind: "light", tasks: ["swab", "bowl"], notes: "propre" }] });
    const rp = remotePipe({ maintenance: [{ id: 77, date: "2026-01-05", kind: "light", tasks: ["bowl", "swab"], notes: "Propre" }] });
    const { pipe, summary } = merge(lp, rp);
    expect(pipe.maintenance, "same date+kind+tasks+notes, task order and case aside").toHaveLength(1);
    expect(summary.maintenanceAppended).toBe(0);
  });

  it("still refuses to OVERWRITE the local log — the LWW protection stands", () => {
    // The imported copy is newer, but a whole-row overwrite would drop whatever
    // this device logged. Merge, never replace.
    const { pipe } = merge(localPipe(), remotePipe({ maintenance: [] , photos: [] }));
    expect(pipe.maintenance.map((m: any) => m.uid)).toEqual(["m-A1"]);
    expect(pipe.photos).toEqual(["local-photo-A1"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Three ways the import said nothing when it should have spoken.
describe("the import stops being silent", () => {
  it("names an invalid file instead of closing the picker and doing nothing", () => {
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const save = vi.fn();
    const props = makeProps({ data: { tobaccos: [] }, save, t: (k: string) => k });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport({ error: "not a backup" }, "file"); });
    expect(result.current.importConfirm, "nothing is staged").toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(String(alertSpy.mock.calls[0]?.[0])).toContain("err_import_invalid");
    alertSpy.mockRestore();
  });

  it("names a CORRUPT file instead of a modal that simply does not respond", () => {
    // A `null` element in a staged array throws inside _runImport, which runs in
    // a click handler — so the exception went nowhere: nothing written, no
    // message, the button apparently dead. Nothing is saved at that point
    // (`save` is the last step), so failing loudly here is safe as well as honest.
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const save = vi.fn(() => { throw new Error("boom"); });
    const props = makeProps({
      data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] },
      save, t: (k: string) => k,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport({
        tobaccos: [{ id: 1, brand: "A", name: "B", lots: [] }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      }, "file");
    });
    act(() => { result.current.applyImport("replace"); });
    expect(String(alertSpy.mock.calls[alertSpy.mock.calls.length - 1]?.[0])).toContain("err_import_crash");
    expect(result.current.importConfirm, "the picker is cleared, not left hanging").toBeNull();
    alertSpy.mockRestore();
  });

  it("says when an imported API key replaced this device's", () => {
    // Excluded from exports by DEFAULT, so a backup carrying one is unusual — and
    // it silently replaced a setting the user chose and pays for.
    const setImportRecap = vi.fn();
    const saveApiKey = vi.fn();
    const props = makeProps({
      data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] },
      save: vi.fn(), saveApiKey, setImportRecap, t: (k: string) => k,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport({
        tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [],
        _apiKey: "sk-ant-abcdefghijklmnop", _apiKeyProvider: "anthropic",
      }, "file");
    });
    act(() => { result.current.applyImport("replace"); });
    expect(saveApiKey).toHaveBeenCalled();
    const msgs = setImportRecap.mock.calls.map((c) => String(c[0]?.msg));
    expect(msgs.some((m) => m.indexOf("import_apikey_replaced") >= 0)).toBe(true);
  });
});

// ── the merge detached sessions from their lot and said
// ── nothing at all ───────────────────────────────────────────────────────────
//
// The rule that does the detaching is CORRECT and is NOT changing:
// on a DUP-matched tobacco, a session pointing at a lot whose LOCAL weight was
// never reduced for that bowl would push Σsessions past (weightInitial −
// weightG), overflow the balance and double-count the stock. Clearing the ref
// to a safe orphan is the only balance-preserving answer.
//
// What was wrong is that it was SILENT, and the shape of the silence is the
// point: the other device's bowls DO arrive — they show up in the journal, so
// the import looks complete — while none of their grams reach your stock. A
// cellar that quietly stops adding up, with no line anywhere saying why.
// Measured by the pre-launch drill at 78 % of randomised two-device merges
// detaching at least one session.
//
// The counter is deliberately narrow: only a session that ARRIVED with a lot
// reference, LOST it, and was then ADDED. A session that dedups into a local
// one leaves the local row untouched, so nothing was detached and counting it
// would report a loss that did not happen.
describe("detached sessions are counted and reported", () => {
  const localCellar = () => ({
    tobaccos: [{
      id: 1, uid: "T-SHARED", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: 900, uid: "L-SHARED", status: "jar", weightG: "50", weightInitial: "50",
               originalStatus: "jar", datePurchased: "2024-01-01", boxNumber: "1", price: "10" }],
    }],
    pipes: [], wishlist: [], accessories: [], sessions: [],
    nxT: 2, nxP: 1, nxJ: 1, nxW: 1, nxA: 1,
  });

  // The other device: SAME tobacco (same uid → dup-matched) and the SAME lot
  // id, which is the normal post-restore multi-device state, plus a bowl
  // smoked over there that this device's copy of the lot knows nothing about.
  const remoteCellar = () => ({
    tobaccos: [{
      id: 1, uid: "T-SHARED", brand: "Halvorsen", name: "Duskfall",
      lots: [{ id: 900, uid: "L-SHARED", status: "jar", weightG: "47.5", weightInitial: "50",
               originalStatus: "jar", datePurchased: "2024-01-01", boxNumber: "1", price: "10" }],
    }],
    pipes: [], wishlist: [], accessories: [],
    sessions: [{ id: 77, uid: "S-REMOTE", date: "2026-01-05", tobaccoId: 1, pipeId: "",
                 lotId: "900", duration: "30", weightG: "2.5", rating: 4, notes: "" }],
    nxT: 2, nxP: 1, nxJ: 78, nxW: 1, nxA: 1,
  });

  function merge(local: any, remote: any) {
    let saved: any = null;
    let summary: any = null;
    const props = makeProps({ data: local, save: (d: any) => { saved = d; } });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(JSON.parse(JSON.stringify(remote)), "file",
        { autoApply: "merge", onMerged: (sm: any) => { summary = sm; } });
    });
    return { saved, summary };
  }

  it("REPRODUCES it: the bowl arrives in the journal, its grams reach no lot", () => {
    const { saved, summary } = merge(localCellar(), remoteCellar());
    const added = saved.sessions.find((s: any) => s.uid === "S-REMOTE");
    expect(added, "the session IS imported — that is what makes the loss invisible").toBeTruthy();
    expect(added.lotId, "and it is detached, which is correct and balance-preserving").toBe("");
    expect(saved.tobaccos[0].lots[0].weightG, "the local lot is untouched").toBe("50");
    // The change: it is now COUNTED.
    expect(summary.sessionsDetached).toBe(1);
  });

  it("counts nothing when the session had no lot to begin with", () => {
    const remote = remoteCellar();
    remote.sessions[0]!.lotId = "";
    const { summary } = merge(localCellar(), remote);
    expect(summary.sessionsDetached || 0).toBe(0);
  });

  it("counts nothing when the session DEDUPS — the local row is untouched", () => {
    // The same bowl already logged locally. Nothing is added, so nothing is
    // detached; reporting a loss here would be reporting one that never
    // happened. This is why the counter fires at the ADD site, not at the
    // clearing site.
    const local = localCellar();
    (local.sessions as any[]).push({
      id: 5, uid: "S-REMOTE", date: "2026-01-05", tobaccoId: 1, pipeId: "",
      lotId: "900", duration: "30", weightG: "2.5", rating: 4, notes: "",
    });
    const { summary } = merge(local, remoteCellar());
    expect(summary.sessionsDetached || 0).toBe(0);
  });

  it("counts nothing when the whole tobacco is ADDED — its lots and sessions arrive together", () => {
    // The safe case (a): an added-wholesale tobacco brings a
    // consistent set, so the reference is kept and there is nothing to report.
    const remote = remoteCellar();
    remote.tobaccos[0]!.uid = "T-OTHER";
    remote.tobaccos[0]!.name = "Regent Mixture";
    const { saved, summary } = merge(localCellar(), remote);
    const added = saved.sessions.find((s: any) => s.uid === "S-REMOTE");
    expect(added.lotId, "kept — the lot came with it").not.toBe("");
    expect(summary.sessionsDetached || 0).toBe(0);
  });

  it("the recap SAYS so — the line states the consequence, not the mechanism", () => {
    // Through the PICKER (`applyImport`), which is the path that wires
    // `_mergeRecapAlert`; the `autoApply` path forwards the caller's own
    // `onMerged` instead (the CSV importer builds its own sentence). The
    // counter is shared, so covering one path proves the number and this
    // case proves the sentence.
    const setImportRecap = vi.fn();
    const props = makeProps({
      data: localCellar(), save: vi.fn(), setImportRecap, t: (k: string) => k,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(JSON.parse(JSON.stringify(remoteCellar())), "file"); });
    act(() => { result.current.applyImport("merge"); });
    const msgs = setImportRecap.mock.calls.map((c) => String(c[0]?.msg || ""));
    expect(msgs.some((m) => m.indexOf("merge_recap_detached") >= 0),
      `no detached line in: ${JSON.stringify(msgs)}`).toBe(true);
  });
});

// ── an imported API key lands on REPLACE only ───────────────
//
// The key is excluded from exports by default (`cave-exclude-apikey` is an
// opt-OUT), so a backup carrying one required a deliberate act from whoever
// exported it. But the write was mode-blind, and MERGE is precisely how you
// accept a file from SOMEONE ELSE — combining their cellar with yours. Their
// key then became yours: your auto-fill calls billed to their account, visible
// in their provider console, and your own key overwritten with nothing on the
// device to recover it from.
//
// The split is the rule already made for `_settings`, one storey up
// and for the same question: a REPLACE adopts the backup's device
// configuration, a MERGE does not, because combining two cellars is no reason
// to inherit the other device's language, theme and units. An API key is the
// same class of thing with a billing account attached.
//
// Three older cases in this file asserted the write on a MERGE; they were
// repointed to "replace" and each records the reversal at its own assertion,
// because what they exist to guard (validation, provider routing, deferral) is
// orthogonal to the mode.
describe("an imported API key lands on REPLACE only", () => {
  const payload = () => ({
    tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [],
    _apiKey: "sk-ant-someone-elses-key", _apiKeyProvider: "anthropic",
  });

  function run(mode: "replace" | "merge") {
    const saveApiKey = vi.fn();
    const setImportRecap = vi.fn();
    const props = makeProps({
      data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] },
      save: vi.fn(), saveApiKey, setImportRecap, t: (k: string) => k,
    });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload(), "file"); });
    act(() => { result.current.applyImport(mode); });
    return { saveApiKey, setImportRecap };
  }

  it("MERGE does not write it — accepting someone's cellar is not accepting their key", () => {
    const { saveApiKey } = run("merge");
    expect(saveApiKey).not.toHaveBeenCalled();
  });

  it("MERGE says nothing about it either — there is nothing to report", () => {
    const { setImportRecap } = run("merge");
    const msgs = setImportRecap.mock.calls.map((c) => String(c[0]?.msg || ""));
    expect(msgs.some((m) => m.indexOf("import_apikey_replaced") >= 0)).toBe(false);
  });

  it("REPLACE still writes it — you asked to make this device look like the backup", () => {
    const { saveApiKey } = run("replace");
    expect(saveApiKey).toHaveBeenCalledWith("sk-ant-someone-elses-key", "anthropic");
  });

  it("REPLACE still announces it", () => {
    const { setImportRecap } = run("replace");
    const msgs = setImportRecap.mock.calls.map((c) => String(c[0]?.msg || ""));
    expect(msgs.some((m) => m.indexOf("import_apikey_replaced") >= 0)).toBe(true);
  });

  it("the merge still STAGES the key — the refusal is at the write, not the parse", () => {
    // Worth pinning: if a future change made stageImport drop the key for a
    // merge instead, the picker could no longer offer a replace with it, and
    // the two modes would disagree about what the file contains.
    const props = makeProps({ data: baseLocal, saveApiKey: vi.fn() });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(payload(), "file"); });
    expect(result.current.importConfirm!.apiKey).toBe("sk-ant-someone-elses-key");
    expect(result.current.importConfirm!.parsed._apiKey,
      "and it is still stripped from the data blob").toBeUndefined();
  });

  it("matches the rule `_settings` already follows — replace adopts, merge does not", () => {
    // Non-vacuity for the reasoning above: if the settings rule ever changed,
    // this key's rule should be revisited with it rather than drifting apart.
    const src = readFileSync("src/hooks/useImportConfirm.ts", "utf8");
    expect(src).toMatch(/mode === "replace"[\s\S]{0,600}?applySettings/);
    expect(src).toContain('apiKey && saveApiKey && mode === "replace"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `keepModalOpen` — the only thing that decides whether the CSV report is
// readable at all.
//
// The flag exists because of a defect nothing could see: `_runImport` closes
// the Settings modal for `source === "file"`, so the CSV import's row-level
// issue panel — which renders INSIDE that modal, under the button that
// produced it — was painted into a tab that had just shut. It was found by
// driving the real file picker in a browser; the panel renders perfectly in
// isolation, which is exactly why no unit test saw it.
//
// The CALLER half is fully guarded already (four probes on
// `useExportImport`'s `keepModalOpen: _hasIssues` all redden). What was
// asserted by nothing is the half that ACTS on the flag: the hook could
// ignore it entirely, the caller stay perfect, and the reported defect come
// back verbatim. Two paths, and it is the second that was untested.
describe("keepModalOpen — le panneau CSV doit rester lisible", () => {
  const csvish = { tobaccos: [{ id: 1, brand: "Vondel", name: "Nº 7", lots: [] }] };

  it("un import « file » FERME les réglages quand rien n'est à rapporter", () => {
    // The historical behaviour, and the counter-case: a clean import still
    // closes, because the recap toast's « Voir » chip takes you to your
    // tobaccos, which is where you want to be.
    const setImportModal = vi.fn();
    const props = makeProps({ data: baseLocal, setImportModal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(csvish, "file", { autoApply: "merge" }); });
    expect(setImportModal).toHaveBeenCalledWith(false);
  });

  it("le drapeau les laisse OUVERTS — sinon le panneau se peint dans un onglet fermé", () => {
    const setImportModal = vi.fn();
    const props = makeProps({ data: baseLocal, setImportModal });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => {
      result.current.stageImport(csvish, "file", { autoApply: "merge", keepModalOpen: true });
    });
    expect(setImportModal,
      "le drapeau est le seul moyen de garder le rapport à l'écran").not.toHaveBeenCalled();
  });

  it("l'import « drive » ne touche jamais aux réglages, drapeau ou pas", () => {
    // Scope guard: a careless fix could make the modal state depend on the
    // flag alone and start closing (or leaving open) a modal the drive path
    // never owned.
    for (const keepModalOpen of [true, false]) {
      const setImportModal = vi.fn();
      const props = makeProps({ data: baseLocal, setImportModal });
      const { result } = renderHook(() => useImportConfirm(props as any));
      act(() => {
        result.current.stageImport(csvish, "drive", { autoApply: "merge", keepModalOpen });
      });
      expect(setImportModal).not.toHaveBeenCalled();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The FIVE envelope fields are metadata ABOUT the file, never data IN the
// cellar — and two of the five deletions were asserted by nothing.
//
// `_apiKey`, `_settings` and `_schemaVersion` each redden under probe;
// `_savedAt` and `_saveType` did not, so either could have been dropped and
// the cellar would have started carrying the backup file's own timestamp and
// save-type as if they were its own. This file's header comment has claimed
// the strip since it was written ("stageImport — strips
// _apiKey/_savedAt/_saveType"), which is what makes it worth pinning: a
// promise stated in a comment is not a promise.
//
// All five are asserted together on purpose — it is one rule, and splitting
// it is how three of them came to be guarded while two were not.
describe("les champs d'enveloppe ne deviennent jamais des données de cave", () => {
  const ENVELOPE = ["_apiKey", "_apiKeyProvider", "_savedAt", "_saveType", "_schemaVersion", "_settings"];

  function envelopedBackup() {
    return {
      tobaccos: [{ id: 1, brand: "Vondel", name: "Nº 7", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
      nxT: 2, nxP: 1, nxW: 1, nxA: 1, nxJ: 1,
      _apiKey: "sk-not-mine",
      _apiKeyProvider: "openai",
      _savedAt: "2020-01-01T00:00:00.000Z",
      _saveType: "manual",
      _schemaVersion: "v6",
      _settings: { "cave-lang": "de" },
    };
  }

  it("aucun des six ne survit à un REPLACE", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(envelopedBackup(), "drive", { autoApply: "replace" }); });
    expect(save, "la cave doit avoir été écrite").toHaveBeenCalled();
    const written = save.mock.calls[0]![0] as any;
    for (const k of ENVELOPE) {
      expect(Object.prototype.hasOwnProperty.call(written, k),
        `${k} a fui dans la cave enregistrée`).toBe(false);
    }
  });

  it("ni à un MERGE", () => {
    const save = vi.fn();
    const props = makeProps({ data: baseLocal, save });
    const { result } = renderHook(() => useImportConfirm(props as any));
    act(() => { result.current.stageImport(envelopedBackup(), "drive", { autoApply: "merge" }); });
    expect(save).toHaveBeenCalled();
    const written = save.mock.calls[0]![0] as any;
    for (const k of ENVELOPE) {
      expect(Object.prototype.hasOwnProperty.call(written, k),
        `${k} a fui dans la cave fusionnée`).toBe(false);
    }
  });

  it("non-vacuité : le fichier de test les portait bien tous les six", () => {
    // Without this the two cases above pass on a fixture that never carried
    // the fields — the shape of vacuous assertion this repo keeps recording.
    const b = envelopedBackup() as any;
    for (const k of ENVELOPE) {
      expect(Object.prototype.hasOwnProperty.call(b, k), k).toBe(true);
    }
  });
});
