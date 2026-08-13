// The WRITER for the catalogue's own cloud stream.
//
// An earlier release gave the catalogue a filename prefix and taught every cellar
// mechanism to ignore it — the manual rotation, the auto sweep, the
// multi-device guard, the restore picker. This is what puts a file in that
// stream, and the two directions it can go wrong are opposite:
//
//   • the catalogue save must not touch a CELLAR file. `pruneByType` is what
//     does the sweep, and it is shared with the rotation that deletes cellar
//     backups — pass it the wrong `keepType` and a catalogue save wipes the
//     user's manual backups.
//   • the catalogue save must sweep its OWN older files, or the promise "one
//     reference document for the account" turns into the pile several releases
//     were spent on.
//
// The name is checked as a DECISION, not a format: no device id (a catalogue
// is per-account, and a slug at the front would be read as one by
// `autoFileDeviceId`), a `.csv` extension (what travels is the raw file, so
// the other device re-parses with the CURRENT parser), and a prefix that
// `classifyBackup` recognises — without which three cellar saves would delete
// it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The store is mocked at the MODULE boundary (the `imgCache` convention): its
// own logic has its own suite, and what these cases are about is the WIRING —
// An earlier release found a whole doc:check gate whose call site could be deleted with
// 3672 tests still green, and the lesson was that a tested decision behind
// untested wiring guarantees nothing.
const catalogueGetCsv = vi.fn(async () => "brand_key,blend_name\nX,Y\n" as string | null);
const catalogueGetMeta = vi.fn(async () => ({ name: "ma-cave.csv" }) as any);
const catalogueSave = vi.fn(async (..._a: any[]) => ({ ok: true }) as any);
vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueGetCsv: (...a: any[]) => catalogueGetCsv(...(a as [])),
  catalogueGetMeta: (...a: any[]) => catalogueGetMeta(...(a as [])),
  catalogueSave: (...a: any[]) => catalogueSave(...(a as [])),
  catalogueLoad: async () => null,
  catalogueClear: vi.fn(),
  _resetCatalogueStoreForTests: vi.fn(),
}));
const tobaccoDbInvalidate = vi.fn();
vi.mock("../utils/tobaccoDb.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/tobaccoDb.ts")>()),
  tobaccoDbInvalidate: () => tobaccoDbInvalidate(),
}));
vi.mock("../utils/imgCache.ts", () => ({
  imgCache: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined), open: vi.fn() },
}));

import { useGdriveSync } from "../hooks/useGdriveSync.ts";
import { INIT } from "../constants.ts";
import {
  makeCatalogueName, classifyBackup, pruneByType, autoFileDeviceId,
  parseBackupCounts, findNewerCloudBackup,
} from "../utils/gdriveApi.ts";
import { GDRIVE_CATALOGUE_PREFIX, GDRIVE_FILE_PREFIX, GDRIVE_AUTO_PREFIX } from "../constants.ts";

describe("makeCatalogueName", () => {
  it("is recognised by classifyBackup — the exclusions all key on that", () => {
    expect(classifyBackup(makeCatalogueName("mon-catalogue.csv"))).toBe("catalogue");
    expect(classifyBackup(makeCatalogueName())).toBe("catalogue");
  });

  it("carries NO device id, because a catalogue is per-account", () => {
    // A cellar auto-file is per-device to stop two devices converging on one
    // file (the data loss of three earlier releases). A catalogue is the opposite:
    // one reference document, which is the point of putting it in the cloud.
    const n = makeCatalogueName("ma-cave.csv");
    expect(autoFileDeviceId(n), "no device id may be parsed out of it").toBeNull();
  });

  it("puts the file-name slug at the TAIL, sanitised", () => {
    // At the front it could be read as a device id; unsanitised it could
    // smuggle a dash or a dot into the timestamp.
    const n = makeCatalogueName("Mon Catalogue Été #2.csv");
    expect(n.indexOf(GDRIVE_CATALOGUE_PREFIX)).toBe(0);
    expect(n).toMatch(/^cave-tabac-catalogue-\d{8}-\d{6}-[a-z0-9]+\.csv$/);
    expect(n, "accents folded, punctuation dropped").toContain("moncatalogue");
  });

  it("ends in .csv — the RAW file travels, not the parsed cache", () => {
    // So the other device runs the CURRENT parser over the user's own file
    // rather than replaying a cache built by an older one.
    expect(makeCatalogueName("x.csv").endsWith(".csv")).toBe(true);
  });

  it("survives a hostile file name without corrupting the shape", () => {
    const n = makeCatalogueName("../../etc/passwd-\u0000-" + "x".repeat(500));
    expect(n).toMatch(/^cave-tabac-catalogue-\d{8}-\d{6}(-[a-z0-9]{1,16})?\.csv$/);
  });
});

describe("the catalogue sweep keeps exactly one, and only its own", () => {
  const cat = (n: number) => ({
    id: "c" + n, name: makeCatalogueName("cat" + n),
    createdTime: "2026-08-1" + n + "T12:00:00Z",
  });
  const manual = { id: "m1", name: GDRIVE_FILE_PREFIX + "20260811-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-08-11T12:00:00Z" };
  const auto = { id: "a1", name: GDRIVE_AUTO_PREFIX + "dev1-20260811-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-08-11T12:00:00Z" };

  it("deletes the older catalogue files and NOTHING else", async () => {
    const removed: string[] = [];
    const remove = vi.fn(async (_t: string, id: string) => { removed.push(id); });
    await pruneByType([cat(1), cat(2), cat(3), manual, auto], "catalogue", 1, "tok", remove);
    // Newest kept (createdTime desc), the two older ones swept.
    expect(removed.sort()).toEqual(["c1", "c2"]);
    expect(removed, "a catalogue save must never delete a cellar backup").not.toContain("m1");
    expect(removed).not.toContain("a1");
  });

  it("is a no-op when there is only the one just written", async () => {
    const removed: string[] = [];
    await pruneByType([cat(3), manual], "catalogue", 1, "tok",
      async (_t: string, id: string) => { removed.push(id); });
    expect(removed).toEqual([]);
  });
});

describe("the two streams stay independent", () => {
  it("a catalogue file is never offered as a newer cellar backup", () => {
    // Its « Restaurer » stages an import of the whole cellar, which would
    // refuse a CSV — so the user would get a banner that cannot do what it
    // says. (Re-asserted here against a REAL generated name.)
    const hit = findNewerCloudBackup(
      [{ id: "c1", name: makeCatalogueName("x.csv"), modifiedTime: "2026-08-11T12:00:00Z" }],
      0, 0, 0, null, null, 0,
    );
    expect(hit).toBeNull();
  });

  it("the counts parser does not mistake it for a cellar backup", () => {
    // parseBackupCounts feeds the restore picker's "t12 · p3 · j40" line; a
    // catalogue name carries no counts and must not fabricate any.
    const c = parseBackupCounts(makeCatalogueName("x.csv"));
    expect(c).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// The hook itself. The helpers above are the DECISIONS; these are the wiring.
// ─────────────────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
function props(extra: Record<string, any> = {}) {
  return {
    data: { ...INIT }, t: (k: string) => k,
    setImportModal: vi.fn(), pendingSync: false, setPendingSync: vi.fn(),
    excludeApiKey: false, apiKey: "", stageImport: vi.fn(), ...extra,
  } as any;
}

beforeEach(() => {
  localStorage.clear();
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
  catalogueGetCsv.mockClear(); catalogueGetMeta.mockClear();
  catalogueSave.mockClear(); tobaccoDbInvalidate.mockClear();
  catalogueGetCsv.mockResolvedValue("brand_key,blend_name\nX,Y\n");
  catalogueSave.mockResolvedValue({ ok: true });
});

describe("catalogueCloudSave (the hook)", () => {
  it("uploads under a CATALOGUE name, then sweeps with keepType 'catalogue'", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ id: "cat-1" }) })   // upload
      .mockResolvedValueOnce({ json: async () => ({ files: [] }) })     // list for the sweep
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudSave("tok"); });
    expect(ok).toBe(true);
    const fd = mockFetch.mock.calls[0]![1].body as FormData;
    const meta = JSON.parse(await (fd.get("metadata") as Blob).text());
    expect(classifyBackup(meta.name), "the prefix is what every exclusion keys on").toBe("catalogue");
    expect(meta.name.endsWith(".csv")).toBe(true);
  });

  it("sends the RAW CSV, not the parsed cache", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ id: "cat-1" }) })
      .mockResolvedValueOnce({ json: async () => ({ files: [] }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useGdriveSync(props()));
    await act(async () => { await result.current.catalogueCloudSave("tok"); });
    const fd = mockFetch.mock.calls[0]![1].body as FormData;
    const body = await (fd.get("file") as Blob).text();
    expect(body).toContain("brand_key");
  });

  it("the SWEEP deletes the older catalogue and leaves the cellar backups", async () => {
    // THE PROBE THAT FOUND THIS CASE. The two cases above assert the upload;
    // neither reaches the sweep, because the listing they stage is empty — so
    // passing `pruneByType` the WRONG keepType ("manual", i.e. a catalogue
    // save rotating away the user's cellar backups) left the whole file green.
    // Verbatim the lesson: when a probe stays green, find out which
    // layer is absorbing it.
    const older = makeCatalogueName("vieux.csv");
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ id: "cat-new" }) })  // upload
      .mockResolvedValueOnce({ json: async () => ({ files: [            // list for the sweep
        { id: "cat-new", name: makeCatalogueName("neuf.csv"), createdTime: "2026-08-12T12:00:00Z" },
        { id: "cat-old", name: older, createdTime: "2026-08-01T12:00:00Z" },
        { id: "m1", name: GDRIVE_FILE_PREFIX + "20260811-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-07-01T12:00:00Z" },
        { id: "a1", name: GDRIVE_AUTO_PREFIX + "dev1-20260710-120000-t1-p0-w0-a0-j0.json", createdTime: "2026-07-10T12:00:00Z" },
      ] }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) });          // the delete(s)
    const { result } = renderHook(() => useGdriveSync(props()));
    await act(async () => { await result.current.catalogueCloudSave("tok"); });
    const deletes = mockFetch.mock.calls
      .filter((c) => c[1] && String(c[1].method).toUpperCase() === "DELETE")
      .map((c) => String(c[0]));
    expect(deletes.length, "exactly one file swept").toBe(1);
    expect(deletes[0]).toContain("cat-old");
    expect(deletes.join(" "), "a catalogue save must never delete a cellar backup").not.toContain("m1");
    expect(deletes.join(" ")).not.toContain("a1");
  });

  it("says so — and uploads NOTHING — when there is no catalogue to send", async () => {
    // A no-op reported as success is how a user concludes their catalogue is
    // safe in the cloud when it is not.
    catalogueGetCsv.mockResolvedValue(null);
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudSave("tok"); });
    expect(ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.catalogueCloudStatus).toBe("cat_cloud_none");
  });
});

describe("catalogueCloudRestore (the hook)", () => {
  const NAME = makeCatalogueName("distant.csv");

  it("picks the newest CATALOGUE file and ignores the cellar backups", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [
        { id: "m1", name: GDRIVE_FILE_PREFIX + "20260811-120000-t1-p0-w0-a0-j0.json", modifiedTime: "2026-08-12T00:00:00Z" },
        { id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" },
      ] }) })
      .mockResolvedValueOnce({ text: async () => "brand_key,blend_name\nA,B\n" });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudRestore("tok"); });
    expect(ok).toBe(true);
    // The download URL must name the CATALOGUE file, not the newer cellar one.
    expect(String(mockFetch.mock.calls[1]![0])).toContain("c1");
  });

  it("goes through catalogueSave — one parse path, one set of warnings", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [{ id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" }] }) })
      .mockResolvedValueOnce({ text: async () => "brand_key,blend_name\nA,B\n" });
    const { result } = renderHook(() => useGdriveSync(props()));
    await act(async () => { await result.current.catalogueCloudRestore("tok"); });
    expect(catalogueSave).toHaveBeenCalled();
    expect(String(catalogueSave.mock.calls[0]![0])).toContain("brand_key");
  });

  it("INVALIDATES the lookup cache, or the app answers from the old catalogue", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [{ id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" }] }) })
      .mockResolvedValueOnce({ text: async () => "brand_key,blend_name\nA,B\n" });
    const { result } = renderHook(() => useGdriveSync(props()));
    await act(async () => { await result.current.catalogueCloudRestore("tok"); });
    expect(tobaccoDbInvalidate).toHaveBeenCalled();
  });

  it("does NOT invalidate when the download could not be stored", async () => {
    // Dropping the cache after a refused write would leave the app with no
    // catalogue at all while the previous one is still on disk.
    catalogueSave.mockResolvedValue({ ok: false, reason: "parse" });
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [{ id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" }] }) })
      .mockResolvedValueOnce({ text: async () => "not a catalogue" });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudRestore("tok"); });
    expect(ok).toBe(false);
    expect(tobaccoDbInvalidate).not.toHaveBeenCalled();
    expect(result.current.catalogueCloudStatus).toBe("cat_err_parse");
  });

  it("reports an empty cloud rather than failing silently", async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ files: [
      { id: "m1", name: GDRIVE_FILE_PREFIX + "20260811-120000-t1-p0-w0-a0-j0.json", modifiedTime: "2026-08-12T00:00:00Z" },
    ] }) });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudRestore("tok"); });
    expect(ok).toBe(false);
    expect(result.current.catalogueCloudStatus).toBe("cat_cloud_none_remote");
  });
});

describe("the two buttons are wired into Settings", () => {
  it("Réglages → Données offers both, and the SAVE only with a catalogue loaded", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    expect(src).toContain("catalogueCloudSave");
    expect(src).toContain("catalogueCloudRestore");
    // Fetch is offered ALWAYS — the device that most needs it is the one with
    // no catalogue at all.
    const restore = src.indexOf('t("cat_cloud_restore")');
    const guardBefore = src.lastIndexOf("{catalogueMeta && (", restore);
    const saveAt = src.indexOf('t("cat_cloud_save")');
    expect(saveAt).toBeGreaterThan(-1);
    expect(guardBefore, "the restore button must not sit under a catalogueMeta guard")
      .toBeLessThan(saveAt);
  });
});
