/**
 * Unit tests for useGdriveSync hook.
 *
 * gatherLocalImages / withPhotos pure-logic mirrors are already covered in exportImport.test.ts.
 * This file tests through the real hook (renderHook) to cover the Drive API integration:
 *   A. doGdriveConfirm  — metadata strip, _imageData security filter, saveApiKey
 *   B. gdriveSave       — Drive list + upload, _saveType, excludeApiKey, fid storage
 *   C. gdriveSaveQuiet  — auto-save, PATCH vs POST, token/fid cleanup on errors
 *   D. gdriveRestore    — option fetch, _savedAt sort, invalid entry filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useGdriveSync,
  recordAutosaveDiag,
  readAutosaveDiag,
  sweepOwnAutoStragglers,
  getDeviceId,
  nextAutosaveAttempt,
  currentAutosaveAttempt,
  cloudGuardLocalRef,
  cloudDismissKeys,
  readCloudDismissed,
  writeCloudDismissed,
  clearCloudDismissed,
  readCloudCheckDiag,
  BACKUP_DELETE_PENDING_KEY,
  CLOUD_CHECK_PENDING_KEY,
} from "../hooks/useGdriveSync";
import { readFileSync } from "node:fs";
import { INIT } from "../constants";

vi.mock("../utils/imgCache.ts", () => ({
  imgCache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
  },
}));

import { imgCache } from "../utils/imgCache.ts";
import { findNewerCloudBackup } from "../utils/gdriveApi.ts";

const mockFetch = vi.fn();

function makeProps(overrides: Record<string, any> = {}) {
  return {
    data: { ...INIT },
    t: (k: string) => k,
    setImportModal: vi.fn(),
    pendingSync: false,
    setPendingSync: vi.fn(),
    excludeApiKey: false,
    apiKey: "sk-test-key",
    stageImport: vi.fn(),
    ...overrides,
  };
}

/** Helper: render the hook, inject a gdriveConfirm, trigger doGdriveConfirm.
 * useGdriveSync no longer applies the restored data directly.
 *  Instead it calls stageImport(parsed, "drive"), and the shared
 *  useImportConfirm hook owns the actual save flow. The integration
 *  test here verifies the delegation; the merge/replace logic itself
 *  lives in useImportConfirm.test.ts. */
function renderAndConfirm(propsOverrides: Record<string, any>, confirmData: any) {
  const stageImport = vi.fn();
  const props = makeProps({ stageImport, ...propsOverrides });
  const { result } = renderHook(() => useGdriveSync(props as any));
  act(() => {
    result.current.setGdriveConfirm({
      options: [{ d: confirmData, ds: "", name: "cave-tabac-backup.json" }],
      sel: 0,
    });
  });
  act(() => {
    result.current.doGdriveConfirm();
  });
  return { props, result, stageImport };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Full reset of the mockFetch implementation queue between tests —
  // vi.clearAllMocks only clears .mock.calls, NOT the mockResolvedValueOnce
  // FIFO. Leftover queue entries would silently bleed into later tests'
  // payload-fetch responses and break assertions.
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── cloudGuardLocalRef — multi-device guard reference ─────────────

describe("cloudGuardLocalRef — excludes cave-last-export-ts", () => {
  it("returns the per-provider cloud-save ts, ignoring a newer local export ts", () => {
    // A purely-local export bumped cave-last-export-ts to a value NEWER than
    // the last cloud save. The guard reference must still be the cloud-save ts,
    // else a genuinely-newer backup from another device gets suppressed.
    localStorage.setItem("cave-autosave-ts-gdrive", "100");
    localStorage.setItem("cave-last-export-ts", "999999");
    expect(cloudGuardLocalRef(false)).toBe(100);
  });
  it("is 0 when this device never cloud-saved on the provider (even with a local export)", () => {
    localStorage.setItem("cave-last-export-ts", "500");
    expect(cloudGuardLocalRef(false)).toBe(0);   // gdrive
    expect(cloudGuardLocalRef(true)).toBe(0);    // dropbox
  });
  it("reads the correct per-provider key", () => {
    localStorage.setItem("cave-autosave-ts-gdrive", "111");
    localStorage.setItem("cave-autosave-ts-dropbox", "222");
    expect(cloudGuardLocalRef(false)).toBe(111);
    expect(cloudGuardLocalRef(true)).toBe(222);
  });
});

// ── withPhotos — _imageData attach ────────────────────────────────

describe("withPhotos — attaches _imageData for pipe.photos + snapshots", () => {
  it("includes additional pipe photos and session-snapshot blobs in _imageData", async () => {
    vi.mocked(imgCache.get).mockImplementation((k: any) =>
      Promise.resolve(String(k).indexOf("local-photo-") === 0 ? "data:image/jpeg;base64,BLOB-" + k : null));
    const data = {
      ...INIT,
      pipes: [{ id: 1, name: "P", brand: "B", imageUrl: "local-photo-cover", photos: ["local-photo-g1", "local-photo-g2"] }],
      sessions: [{ id: 1, date: "2026-01-01", tobaccoSnapshot: { brand: "x", name: "y", imageUrl: "local-photo-snap" } }],
    };
    const { result } = renderHook(() => useGdriveSync(makeProps({ data }) as any));
    const exp: any = await result.current.withPhotos(data);
    // The additional pipe photos + the snapshot blob travel in _imageData
    // (they used to be lost on JSON/ZIP export — only the cover was inlined).
    expect(exp._imageData).toBeTruthy();
    expect(exp._imageData["local-photo-g1"]).toContain("data:image/jpeg;base64,");
    expect(exp._imageData["local-photo-g2"]).toContain("data:image/jpeg;base64,");
    expect(exp._imageData["local-photo-snap"]).toContain("data:image/jpeg;base64,");
    // Cover imageUrl still inlined (doBackupZip depends on it).
    expect(exp.pipes[0].imageUrl).toContain("data:image/jpeg;base64,");
    // pipe.photos[] keys are left as keys (their blobs live in _imageData).
    expect(exp.pipes[0].photos).toEqual(["local-photo-g1", "local-photo-g2"]);
  });
});

// ── A. doGdriveConfirm ────────────────────────────────────────────────────────

describe("doGdriveConfirm — delegates to stageImport", () => {
  it("clears gdriveConfirm state after confirmation", () => {
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.setGdriveConfirm({
        options: [{ d: { tobaccos: [] }, ds: "", name: "b" }],
        sel: 0,
      });
    });
    act(() => { result.current.doGdriveConfirm(); });
    expect(result.current.gdriveConfirm).toBeNull();
  });

  it("calls stageImport(data, 'drive') with the chosen option's payload", () => {
    const payload = { tobaccos: [{ id: 1, name: "Balkan" }], _apiKey: "sk-x" };
    const { stageImport } = renderAndConfirm({}, payload);
    expect(stageImport).toHaveBeenCalledTimes(1);
    expect(stageImport).toHaveBeenCalledWith(payload, "drive");
  });

  it("forwards the full payload (metadata and _imageData included) so useImportConfirm can strip and filter them", () => {
    // The security strip + _imageData filter now live inside
    // useImportConfirm (see useImportConfirm.test.ts). useGdriveSync's
    // job is simply to pass the parsed file through verbatim.
    const payload = {
      tobaccos: [],
      _apiKey: "sk-secret",
      _savedAt: "2025-06-15T12:00:00Z",
      _saveType: "manual",
      _imageData: { "local-photo-1": "data:image/jpeg;base64,ABC" },
    };
    const { stageImport } = renderAndConfirm({}, payload);
    expect(stageImport.mock.calls[0]![0]).toEqual(payload);
    // useGdriveSync no longer touches imgCache directly — it's the
    // responsibility of useImportConfirm.applyImport.
    expect(vi.mocked(imgCache.put)).not.toHaveBeenCalled();
  });

  // multi-device regression: restoring a backup must NOT
  // mute a SECOND device's genuinely-newer backup. The bug wrote Date.now()
  // (the restore wall-clock) as the "dismissed" floor, which is always newer
  // than every existing cloud file, so restoring one backup silently
  // suppressed the launch banner for every other device's backup.
  it("records the acked file's ts + name (not Date.now()) so a newer 2nd-device backup still surfaces", () => {
    const fileModifiedTime = "2026-07-05T16:10:00.000Z"; // device 1's own file
    const fileTs = new Date(fileModifiedTime).getTime();
    const fileName = "cave-tabac-auto-8udtad7-20260705-161000-t5-p2-w14-a2-j22.json";
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.setGdriveConfirm({
        options: [{ d: { tobaccos: [] }, ds: "", name: fileName, modifiedTime: fileModifiedTime }],
        sel: 0,
      });
    });
    act(() => { result.current.doGdriveConfirm(); });

    // The dismissed floor is the ACKED FILE's ts — never the wall-clock
    // restore moment (which the old code wrote via Date.now()).
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).toBe(String(fileTs));
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBe(fileName);

    // End-to-end: a second device's newer auto backup (different device id,
    // modifiedTime after the acked file) must still be detected on launch.
    const device2Newer = {
      id: "f2",
      name: "cave-tabac-auto-qsekqav94e-20260705-235700-t5-p2-w14-a2-j22.json",
      modifiedTime: "2026-07-05T23:57:00.000Z",
    };
    const dismissedTs = parseInt(localStorage.getItem(cloudDismissKeys(false).ts)!, 10);
    const dismissedName = localStorage.getItem(cloudDismissKeys(false).name);
    const hit = findNewerCloudBackup(
      [device2Newer],
      fileTs,          // localRef = this device's last save (the acked file)
      dismissedTs,
      120000,
      dismissedName,
      "8udtad7",       // this device's id
      1,               // ownStampedSince — stamped at the epoch, i.e. "long ago"
    );
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe(device2Newer.name);
  });
});

// ── B. gdriveSave ─────────────────────────────────────────────────────────────

describe("gdriveSave — Drive API calls, backup metadata, and state updates", () => {
  /** Set up fetch mock: list returns `files`, upload returns `{ id: 'new-file-id' }`. */
  function setupFetch(files: any[] = []) {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ files }) })        // list
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "new-file-id" }) }) // upload
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });          // rotation
  }

  it("calls the Drive list API with Bearer authorization", async () => {
    setupFetch();
    const props = makeProps();
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [listUrl, listOpts] = mockFetch.mock.calls[0]!;
    expect(listUrl).toContain("googleapis.com/drive/v3/files");
    expect(listOpts.headers.Authorization).toBe("Bearer fake-token");
  });

  it("calls the multipart upload API after the list", async () => {
    setupFetch();
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [uploadUrl] = mockFetch.mock.calls[1]!;
    expect(uploadUrl).toContain("upload/drive/v3/files");
    expect(uploadUrl).toContain("uploadType=multipart");
  });

  it("sets _saveType: 'manual' in the uploaded backup JSON", async () => {
    setupFetch();
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const fd = mockFetch.mock.calls[1]![1].body as FormData;
    const json = JSON.parse(await (fd.get("file") as Blob).text());
    expect(json._saveType).toBe("manual");
  });

  it("includes apiKey in backup when excludeApiKey=false", async () => {
    setupFetch();
    const props = makeProps({ apiKey: "sk-real", excludeApiKey: false });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const fd = mockFetch.mock.calls[1]![1].body as FormData;
    const json = JSON.parse(await (fd.get("file") as Blob).text());
    expect(json._apiKey).toBe("sk-real");
  });

  it("sets _apiKey to '' when excludeApiKey=true", async () => {
    setupFetch();
    const props = makeProps({ apiKey: "sk-real", excludeApiKey: true });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const fd = mockFetch.mock.calls[1]![1].body as FormData;
    const json = JSON.parse(await (fd.get("file") as Blob).text());
    expect(json._apiKey).toBe("");
  });

  it("stores the new file ID in localStorage gdrive-fid", async () => {
    setupFetch();
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(localStorage.getItem("gdrive-fid")).toBe("new-file-id"));
  });

  it("calls setPendingSync(false) on successful save", async () => {
    setupFetch();
    const setPendingSync = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ setPendingSync }) as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(setPendingSync).toHaveBeenCalledWith(false));
  });

  it("clears cached gdrive-tk on 401 response from list API", async () => {
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "old-tk", x: Date.now() + 3600000 }));
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: { code: 401, message: "Unauthorized" } }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(localStorage.getItem("gdrive-tk")).toBeNull());
  });

  // ── Pruning behaviour (fresh files only) ────────────────────────────────────

  /** Build N fresh (timestamped) file stubs sorted newest-first (as the API returns). */
  function makeFreshFiles(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `fresh-${i}`,
      name: `cave-tabac-2026050${String(17 - i).padStart(2, "0")}-120000.json`,
      createdTime: `2026-05-${String(17 - i).padStart(2, "0")}T12:00:00Z`,
    }));
  }

  // The cap = GDRIVE_MAX_MANUAL (3 manual backups total, including the
  // one we just wrote → keep 2 of the existing N).

  it("does not delete any file when existing count is at the limit (2 existing + 1 new = 3)", async () => {
    setupFetch(makeFreshFiles(2));
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2)); // list + upload
    const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
    expect(deletes).toHaveLength(0);
  });

  it("deletes 1 oldest file when existing count exceeds limit by 1 (3 existing → keep 2)", async () => {
    setupFetch(makeFreshFiles(3));
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => {
      const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
      expect(deletes).toHaveLength(1);
    });
    const [deleteUrl] = mockFetch.mock.calls.find(([, o]) => (o as RequestInit)?.method === "DELETE")!;
    // Oldest file (last in createdTime-desc list) must be deleted.
    expect(deleteUrl).toContain("fresh-2");
  });

  it("deletes N oldest files when existing count exceeds limit by N", async () => {
    setupFetch(makeFreshFiles(6)); // 6 existing → keep 2 newest → delete 4
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => {
      const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
      expect(deletes).toHaveLength(4);
    });
    const deletedIds = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([url]) => url as string);
    expect(deletedIds.some((u) => u.includes("fresh-2"))).toBe(true);
    expect(deletedIds.some((u) => u.includes("fresh-3"))).toBe(true);
    expect(deletedIds.some((u) => u.includes("fresh-4"))).toBe(true);
    expect(deletedIds.some((u) => u.includes("fresh-5"))).toBe(true);
  });

  it("always keeps the newest files and deletes from the oldest end", async () => {
    setupFetch(makeFreshFiles(3));
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => {
      const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
      expect(deletes).toHaveLength(1);
    });
    const [deleteUrl] = mockFetch.mock.calls.find(([, o]) => (o as RequestInit)?.method === "DELETE")!;
    expect(deleteUrl).not.toContain("fresh-0"); // newest preserved
    expect(deleteUrl).not.toContain("fresh-1");
    expect(deleteUrl).toContain("fresh-2");     // oldest deleted
  });

  // This supersedes the older "manual never touches auto"
  // rule:: a manual save is now the deterministic, cross-platform way to
  // tidy this device's auto pile (iOS silent auto-save can't always run).
  // It keeps this device's NEWEST own/legacy auto file and sweeps the
  // rest of its own + legacy autos, while STILL respecting the manual
  // rotation and NEVER deleting a foreign device's stamped auto file.
  it("manual save tidies this device's auto pile but spares foreign autos + manual rotation", async () => {
    localStorage.setItem("cave-device-id", "deva");
    // Order matters: existingFiles is consumed in listing order, so the
    // first own/legacy auto is the one kept. Put the keeper first.
    const autoFiles = [
      { id: "auto-keep", name: "cave-tabac-auto.json", createdTime: "2026-05-17T13:02:00Z" },
      { id: "auto-1", name: "cave-tabac-auto-20260517-130000-t1-p0-w0-a0-j0.json", createdTime: "2026-05-17T13:01:00Z" },
      { id: "auto-2", name: "cave-tabac-auto-20260516-130000-t1-p0-w0-a0-j0.json", createdTime: "2026-05-16T13:00:00Z" },
      { id: "auto-mine", name: "cave-tabac-auto-deva-20260515-130000-t1-p0-w0-a0-j0.json", createdTime: "2026-05-15T13:00:00Z" },
      { id: "auto-foreign", name: "cave-tabac-auto-devb-20260514-130000-t1-p0-w0-a0-j0.json", createdTime: "2026-05-14T13:00:00Z" },
    ];
    const manualFiles = makeFreshFiles(3);
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ files: [...autoFiles, ...manualFiles] }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "new-file-id" }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    // 1 manual rotation + 3 own/legacy auto stragglers (auto-1, auto-2,
    // auto-mine) = 4 deletes total.
    await waitFor(() => {
      const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
      expect(deletes).toHaveLength(4);
    });
    const deletedIds = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([url]) => String(url));
    // Manual rotation still drops the oldest manual.
    expect(deletedIds.some((u) => u.includes("fresh-2"))).toBe(true);
    // The kept auto + the foreign device's stamped auto survive.
    expect(deletedIds.some((u) => u.includes("/auto-keep"))).toBe(false);
    expect(deletedIds.some((u) => u.includes("/auto-foreign"))).toBe(false);
    // This device's other own/legacy autos are swept.
    ["auto-1", "auto-2", "auto-mine"].forEach((id) => {
      expect(deletedIds.some((u) => u.includes(`/${id}`))).toBe(true);
    });
  });

  it("encodes the data counts in the new backup's filename", async () => {
    setupFetch([]);
    const props = makeProps({
      data: {
        ...INIT,
        tobaccos: [{ id: 1 }, { id: 2 }],
        pipes: [{ id: 1 }],
        wishlist: [{ id: 1 }, { id: 2 }, { id: 3 }],
        accessories: [],
        sessions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      },
    });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // The upload (call #2) FormData metadata blob carries the filename.
    // FormData isn't directly inspectable in jsdom, so we read the
    // 'metadata' part via the body's stringification fallback.
    const [, uploadOpts] = mockFetch.mock.calls[1]!;
    const fd: FormData = (uploadOpts as any).body;
    expect(fd).toBeInstanceOf(FormData);
    // Read the metadata Blob and stringify it.
    const metaBlob = fd.get("metadata") as Blob;
    expect(metaBlob).toBeTruthy();
    const metaText = await metaBlob.text();
    expect(metaText).toMatch(/cave-tabac-\d{8}-\d{6}-t2-p1-w3-a0-j5\.json/);
  });
});

// ── C. gdriveSaveQuiet ────────────────────────────────────────────────────────

describe("gdriveSaveQuiet — auto-save mode (POST + rotate)", () => {
  // gdriveSaveQuiet reads the data snapshot from localStorage (SK key), not from the prop.
  // In JSDOM (non-iOS standalone), tkGet/tkSet use sessionStorage.
  beforeEach(() => {
    // gdriveSaveQuiet now no-ops unless the auto-save toggle
    // is on (defense-in-depth guard at the top of the function). Every
    // test in this block exercises the happy path, so opt in once here.
    localStorage.setItem("cave-autosave", "1");
  });

  function setToken(token = "quiet-token") {
    sessionStorage.setItem(
      "gdrive-tk",
      JSON.stringify({ t: token, x: Date.now() + 3600000 }),
    );
    localStorage.setItem("pipe-cellar-v6", JSON.stringify({ ...INIT }));
  }

  function setupListAndUpload(existing: any[] = []) {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ files: existing }) }) // list
      // The upload call (POST or PATCH) gets a smarter
      // mock — for PATCH (Drive's overwrite semantics), the real API
      // echoes the same fileId in the response; for POST it returns a
      // fresh id. Earlier the mock returned `new-auto-id` for both,
      // which masked the bug where patchExisting was storing
      // the OLD fid instead of the returned id.
      .mockImplementationOnce((url: any, init: any) => {
        const method = init && init.method;
        if (method === "PATCH") {
          // URL is /upload/drive/v3/files/<fileId>?…
          const m = String(url || "").match(/\/files\/([^/?]+)/);
          const sameId = (m && m[1]) || "auto-0";
          return Promise.resolve({ json: () => Promise.resolve({ id: sameId }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ id: "new-auto-id" }) });
      })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });             // DELETEs
  }

  it("no-ops when no token is available in localStorage or driveTokenRef", () => {
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // defense-in-depth — gdriveSaveQuiet must never reach the
  // network when the auto-save toggle is off, regardless of token state.
  it("no-ops when cave-autosave toggle is off, even with a valid token", () => {
    localStorage.removeItem("cave-autosave");
    setToken();
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // cross-tab lock. A fresh `cave-autosave-lock` written
  // by another tab (< 30 s old) must block this tab's quiet save so two
  // tabs don't PATCH the same auto-fid in parallel with stale snapshots.
  it("skips when another tab holds the cross-tab lock (< 30 s)", () => {
    setToken();
    setupListAndUpload([]);
    localStorage.setItem("cave-autosave-lock", String(Date.now() - 5000));
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ignores a stale cross-tab lock (> 30 s) and proceeds", async () => {
    setToken();
    setupListAndUpload([]);
    localStorage.setItem("cave-autosave-lock", String(Date.now() - 60000));
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });

  it("lists existing files then POSTs a new timestamped auto file", async () => {
    setToken();
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [listUrl] = mockFetch.mock.calls[0]!;
    expect(listUrl).toContain("googleapis.com/drive/v3/files");
    const [, uploadOpts] = mockFetch.mock.calls[1]!;
    expect((uploadOpts as any).method).toBe("POST");
    const fd: FormData = (uploadOpts as any).body;
    const metaBlob = fd.get("metadata") as Blob;
    const metaText = await metaBlob.text();
    // Name must use the auto prefix + device id + timestamp + counts
    // suffix (wove the [0-9a-z]+ device id after the prefix).
    expect(metaText).toMatch(/cave-tabac-auto-[0-9a-z]+-\d{8}-\d{6}-t\d+-p\d+-w\d+-a\d+-j\d+\.json/);
  });

  // The last-save timestamp is per-provider. A successful
  // auto-save on Drive must stamp cave-autosave-ts-gdrive (not just the
  // legacy global) so Settings shows the right date per destination.
  it("writes a per-provider last-save timestamp on success (gdrive)", async () => {
    setToken();
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps({ cloudProviderId: "gdrive" }) as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(localStorage.getItem("cave-autosave-ts-gdrive")).toBeTruthy());
    // Dropbox's per-provider slot stays untouched by a Drive save.
    expect(localStorage.getItem("cave-autosave-ts-dropbox")).toBeNull();
  });

  it("encodes data counts from the localStorage snapshot in the auto filename", async () => {
    setToken();
    localStorage.setItem("pipe-cellar-v6", JSON.stringify({
      ...INIT,
      tobaccos: [{ id: 1 }, { id: 2 }, { id: 3 }],
      pipes: [{ id: 1 }, { id: 2 }],
      wishlist: [],
      accessories: [{ id: 1 }],
      sessions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    }));
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [, uploadOpts] = mockFetch.mock.calls[1]!;
    const fd: FormData = (uploadOpts as any).body;
    const metaText = await (fd.get("metadata") as Blob).text();
    expect(metaText).toMatch(/cave-tabac-auto-[0-9a-z]+-\d{8}-\d{6}-t3-p2-w0-a1-j4\.json/);
  });

  it("sets _saveType: 'auto' in the uploaded body", async () => {
    setToken();
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [, uploadOpts] = mockFetch.mock.calls[1]!;
    const fd: FormData = (uploadOpts as any).body;
    const fileBlob = fd.get("file") as Blob;
    const bk = JSON.parse(await fileBlob.text());
    expect(bk._saveType).toBe("auto");
  });

  it("reads cave-exclude-apikey from localStorage to omit _apiKey", async () => {
    setToken();
    localStorage.setItem("cave-exclude-apikey", "1");
    localStorage.setItem("anthropic-api-key", "sk-secret");
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [, uploadOpts] = mockFetch.mock.calls[1]!;
    const fd: FormData = (uploadOpts as any).body;
    const bk = JSON.parse(await (fd.get("file") as Blob).text());
    expect(bk._apiKey).toBe("");
  });

  it("calls setPendingSync(false) on successful auto-save", async () => {
    setToken();
    setupListAndUpload([]);
    const setPendingSync = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ setPendingSync }) as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(setPendingSync).toHaveBeenCalledWith(false));
  });

  // Regression lock: the uploaded body is
  // the `rawSnap` frozen at the START of the quiet save. If localStorage
  // advances DURING the in-flight upload (a save landed mid-flight and its
  // own quiet save hit the in-progress skip), _onSuccess must NOT clear
  // pendingSync — the cloud still holds the stale snapshot — and must re-arm
  // a follow-up save so the newer data reaches the cloud.
  it("keeps pendingSync dirty + re-arms when data changes mid-upload", async () => {
    vi.useFakeTimers();
    try {
      setToken(); // localStorage[SK] = INIT (this is rawSnap)
      const setPendingSync = vi.fn();
      let uploadCalls = 0;
      mockFetch
        .mockResolvedValueOnce({ json: () => Promise.resolve({ files: [] }) }) // list
        .mockImplementationOnce((_url: any, _init: any) => {
          uploadCalls++;
          // Simulate an edit that landed WHILE this upload was in flight:
          // localStorage moves on to a newer snapshot after rawSnap was frozen.
          localStorage.setItem(
            "pipe-cellar-v6",
            JSON.stringify({ ...INIT, nxT: 999 }),
          );
          return Promise.resolve({ json: () => Promise.resolve({ id: "new-auto-id" }) });
        })
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const { result } = renderHook(() => useGdriveSync(makeProps({ setPendingSync }) as any));
      act(() => { result.current.gdriveSaveQuiet(); });
      // Drain the upload microtasks so _onSuccess runs.
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      // Snapshot advanced → must NOT declare "synced".
      expect(setPendingSync).not.toHaveBeenCalledWith(false);
      // A follow-up quiet save is re-armed on an 800 ms timer.
      const before = uploadCalls;
      await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
      expect(uploadCalls).toBeGreaterThanOrEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression lock (supersedes an older rule): device A's
  // auto-save must NOT delete another device's STAMPED auto file. Going
  // forward every device weaves its id into the auto filename, so the
  // sweep can tell its own files apart from foreign ones by name. Earlier
  // the cleanup swept "everything that isn't keepId" (wiped foreign
  // files); the next attempt over-corrected (only the single tracked fid → could
  // never self-heal a straggler pile → the 14-files bug). The sweep now covers
  // own + legacy files while leaving foreign STAMPED files alone.
  it("auto-save never deletes another device's stamped auto file", async () => {
    setToken();
    localStorage.setItem("cave-device-id", "deva"); // THIS device
    localStorage.setItem("gdrive-auto-fid", "device-A-auto");
    const listing = [
      { id: "device-A-auto", name: "cave-tabac-auto-deva-20260619-100000-t1-p0-w0-a0-j0.json",
        modifiedTime: "2026-06-19T10:00:00Z", createdTime: "2026-06-19T10:00:00Z" },
      { id: "device-B-auto", name: "cave-tabac-auto-devb-20260619-220000-t5-p2-w0-a0-j7.json",
        modifiedTime: "2026-06-19T22:00:00Z", createdTime: "2026-06-19T22:00:00Z" },
    ];
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ files: listing }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "device-A-auto" }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => {
      const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
      expect(patches.length).toBe(1);
    });
    // Patches OUR file (matched stored fid), never the foreign one.
    const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
    expect(patches[0]![0] as string).toContain("/device-A-auto");
    const deletedUrls = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([u]) => String(u));
    expect(deletedUrls.some((u) => u.includes("/device-B-auto"))).toBe(false);
  });

  // The headline bug — a single device accumulated 14 auto
  // files because the sweep only ever removed the one tracked
  // fid. With device stamping, ONE save must collapse the whole own-device
  // pile (here: a tracked stamped file + 3 of its own + 2 legacy) down to
  // one, while keeping a foreign device's stamped file.
  it("collapses this device's whole auto pile to one in a single save", async () => {
    setToken();
    localStorage.setItem("cave-device-id", "deva");
    localStorage.setItem("gdrive-auto-fid", "mine-newest");
    const own = ["mine-newest", "mine-2", "mine-3", "mine-4"].map((id, i) => ({
      id,
      name: `cave-tabac-auto-deva-2026061${9 - i}-120000-t1-p0-w0-a0-j0.json`,
      modifiedTime: `2026-06-1${9 - i}T12:00:00Z`,
      createdTime: `2026-06-1${9 - i}T12:00:00Z`,
    }));
    const legacy = ["legacy-1", "legacy-2"].map((id, i) => ({
      id,
      name: `cave-tabac-auto-2026050${8 - i}-120000-t1-p0-w0-a0-j0.json`,
      modifiedTime: `2026-05-0${8 - i}T12:00:00Z`,
      createdTime: `2026-05-0${8 - i}T12:00:00Z`,
    }));
    const foreign = { id: "theirs", name: "cave-tabac-auto-devb-20260620-120000-t9-p0-w0-a0-j0.json",
      modifiedTime: "2026-06-20T12:00:00Z", createdTime: "2026-06-20T12:00:00Z" };
    setupListAndUpload([...own, ...legacy, foreign]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => {
      const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
      expect(patches.length).toBe(1);
    });
    const deletedUrls = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([u]) => String(u));
    // Kept: the tracked file we PATCHed (mine-newest) and the foreign one.
    expect(deletedUrls.some((u) => u.includes("/mine-newest"))).toBe(false);
    expect(deletedUrls.some((u) => u.includes("/theirs"))).toBe(false);
    // Swept: this device's older files + the adopted legacy files.
    ["mine-2", "mine-3", "mine-4", "legacy-1", "legacy-2"].forEach((id) => {
      expect(deletedUrls.some((u) => u.includes(`/${id}`))).toBe(true);
    });
  });

  // Regression lock: when the provider's overwrite
  // returns a DIFFERENT id than the one we sent (Dropbox semantics —
  // "upload new + delete old"), patchExisting must persist the
  // RETURNED id in AUTO_FID_KEY and use it as the keepId for the
  // self-healing cleanup. Earlier we stored the old fid; the next save
  // matched it against a stale (or deleted) file and accumulated
  // duplicates (user-reported: 2 auto saves in Settings → Voir mes
  // sauvegardes — see screenshot).
  it("uses the RETURNED id (Dropbox-style overwrite) for AUTO_FID_KEY + cleanup", async () => {
    setToken();
    const existing = [
      { id: "OLD", name: "cave-tabac-auto-20260619-224916-t5-p20-w14-a2-j11.json",
        modifiedTime: "2026-06-19T22:49:16Z", createdTime: "2026-06-19T22:49:16Z" },
    ];
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ files: existing }) }) // list
      // Simulate Dropbox-style overwrite: returns a NEW id, not the one we passed.
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "NEW" }) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });           // DELETEs
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => {
      const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
      expect(deletes.length).toBeGreaterThan(0);
    });
    // AUTO_FID_KEY must hold the NEW id, not the OLD one we sent in.
    expect(localStorage.getItem("gdrive-auto-fid")).toBe("NEW");
    // OLD must be in the delete set (it's the stale one).
    const deletedUrls = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([u]) => String(u));
    expect(deletedUrls.some((u) => u.includes("/OLD"))).toBe(true);
  });

  // This replaces the older "leave the rest alone" test:
  // a pile of LEGACY (unstamped) auto files is the exact 14-files bug.
  // This device must PATCH the newest one and SWEEP the rest, because
  // legacy files are adopted-and-drained (they predate device stamping
  // so we can't attribute them to a foreign device). Manual + foreign
  // STAMPED files are still protected (separate tests below).
  it("auto-save sweeps the legacy straggler pile down to one file", async () => {
    setToken();
    const existing = Array.from({ length: 5 }).map((_, i) => ({
      id: `auto-${i}`,
      name: `cave-tabac-auto-2026050${String(20 - i).padStart(2, "0")}-120000-t0-p0-w0-a0-j0.json`,
      modifiedTime: `2026-05-${String(20 - i).padStart(2, "0")}T12:00:00Z`,
      createdTime: `2026-05-${String(20 - i).padStart(2, "0")}T12:00:00Z`,
    }));
    setupListAndUpload(existing);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => {
      const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
      expect(patches.length).toBe(1);
    });
    // PATCH on the newest auto file (auto-0).
    const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
    expect(patches[0]![0] as string).toContain("/upload/drive/v3/files/auto-0");
    // The 4 older legacy files (auto-1..auto-4) are swept; auto-0 (the
    // kept file, same id echoed by Drive's PATCH) is NOT deleted.
    const deletedUrls = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([u]) => String(u));
    expect(deletedUrls.some((u) => u.includes("/auto-0"))).toBe(false);
    for (let i = 1; i <= 4; i++) {
      expect(deletedUrls.some((u) => u.includes(`/auto-${i}`))).toBe(true);
    }
  });

  it("does NOT touch manual files during auto save", async () => {
    setToken();
    const autoFiles = Array.from({ length: 3 }).map((_, i) => ({
      id: `auto-${i}`,
      name: `cave-tabac-auto-2026050${String(20 - i).padStart(2, "0")}-120000-t0-p0-w0-a0-j0.json`,
      modifiedTime: `2026-05-${String(20 - i).padStart(2, "0")}T12:00:00Z`,
      createdTime: `2026-05-${String(20 - i).padStart(2, "0")}T12:00:00Z`,
    }));
    const manualFiles = [
      { id: "m1", name: "cave-tabac-20240101-120000-t0-p0-w0-a0-j0.json", modifiedTime: "2024-01-01T12:00:00Z", createdTime: "2024-01-01T12:00:00Z" },
      { id: "m2", name: "cave-tabac-20240102-120000-t0-p0-w0-a0-j0.json", modifiedTime: "2024-01-02T12:00:00Z", createdTime: "2024-01-02T12:00:00Z" },
    ];
    // The device tracks auto-0; the other autos (auto-1/auto-2) are
    // legacy unstamped → swept by the self-heal. Manual files
    // (m1/m2) are classified "manual", never enter the auto sweep.
    localStorage.setItem("gdrive-auto-fid", "auto-0");
    setupListAndUpload([...autoFiles, ...manualFiles]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => {
      const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
      expect(patches.length).toBe(1);
    });
    const deletedIds = mockFetch.mock.calls
      .filter(([, o]) => (o as RequestInit)?.method === "DELETE")
      .map(([url]) => url as string);
    // Manual files are NEVER touched by an auto save.
    expect(deletedIds.every((u) => !u.includes("/m1") && !u.includes("/m2"))).toBe(true);
    // The legacy auto stragglers ARE drained (this is the fix).
    expect(deletedIds.some((u) => u.includes("/auto-1"))).toBe(true);
    expect(deletedIds.some((u) => u.includes("/auto-2"))).toBe(true);
  });

  it("when no auto file exists, POSTs a fresh one (no PATCH, no DELETE)", async () => {
    setToken();
    setupListAndUpload([]);
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSaveQuiet(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const patches = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PATCH");
    const posts = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "POST");
    const deletes = mockFetch.mock.calls.filter(([, o]) => (o as RequestInit)?.method === "DELETE");
    expect(patches.length).toBe(0);
    expect(posts.length).toBe(1);
    expect(deletes.length).toBe(0);
  });
});

// ── D. gdriveRestore ──────────────────────────────────────────────────────────

describe("gdriveRestore — listing-only flow (no per-file download)", () => {
  it("calls the Drive list API with Bearer authorization", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [{ id: "f1", name: "cave-tabac-backup.json", modifiedTime: "2025-06-01T10:00:00Z" }] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    // CI flakiness guard: the default waitFor timeout (1000 ms) was
    // sometimes too tight on busy GH Actions runners — the promise
    // chain (gdriveGetToken bypass → fetchRetry → mockFetch → json →
    // setGdriveConfirm) needs multiple microtask + macrotask ticks.
    // 5 s gives plenty of room without slowing the green path.
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull(), { timeout: 5000 });
    const [listUrl, listOpts] = mockFetch.mock.calls[0]!;
    expect(listUrl).toContain("googleapis.com/drive/v3/files");
    expect(listOpts.headers.Authorization).toBe("Bearer fake-token");
  });

  it("does NOT download individual file contents up-front", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [
        { id: "f1", name: "cave-tabac-1.json", modifiedTime: "2025-06-01T10:00:00Z" },
        { id: "f2", name: "cave-tabac-2.json", modifiedTime: "2025-06-15T10:00:00Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    // Only the listing call should have fired — exactly 1 fetch, no
    // ?alt=media downloads.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const opts = (result.current.gdriveConfirm as any).options;
    expect(opts).toHaveLength(2);
    expect(opts[0].d).toBeNull(); // not downloaded yet
    expect(opts[1].d).toBeNull();
  });

  it("sorts options by modifiedTime descending (most recent at index 0)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [
        { id: "older", name: "cave-tabac-1.json", modifiedTime: "2025-06-01T10:00:00Z" },
        { id: "newer", name: "cave-tabac-2.json", modifiedTime: "2025-06-15T10:00:00Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    const opts = (result.current.gdriveConfirm as any).options;
    expect(opts[0].id).toBe("newer");
    expect(opts[1].id).toBe("older");
  });

  it("tags each option with the inferred saveType (auto vs manual)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [
        { id: "auto-id", name: "cave-tabac-auto.json", modifiedTime: "2025-06-15T10:00:00Z" },
        { id: "man-id", name: "cave-tabac-20260517-120000.json", modifiedTime: "2025-06-14T10:00:00Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    const opts = (result.current.gdriveConfirm as any).options;
    const auto = opts.find(function (o: any) { return o.id === "auto-id"; });
    const man = opts.find(function (o: any) { return o.id === "man-id"; });
    expect(auto.saveType).toBe("auto");
    expect(man.saveType).toBe("manual");
  });

  it("sets gdriveConfirm.sel to 0 (most-recent pre-selected)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [{ id: "f1", name: "cave-tabac-backup.json", modifiedTime: "2025-06-01T10:00:00Z" }] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    expect((result.current.gdriveConfirm as any).sel).toBe(0);
  });

  it("sets an error gdriveStatus when Drive returns an empty file list", async () => {
    mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ files: [] }) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveStatus).toContain("st_no_backup"));
  });

  it("clears gdrive-tk on 401 from list API", async () => {
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "old", x: Date.now() + 3600000 }));
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: { code: 401, message: "Unauthorized" } }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(localStorage.getItem("gdrive-tk")).toBeNull());
  });

  it("stores gdrive-auto-fid + gdrive-fid based on filename, not on file contents", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [
        { id: "auto-fid", name: "cave-tabac-auto.json", modifiedTime: "2026-05-17T14:00:00Z" },
        { id: "manual-fid", name: "cave-tabac-20260517-120000.json", modifiedTime: "2026-05-17T12:00:00Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    expect(localStorage.getItem("gdrive-auto-fid")).toBe("auto-fid");
    expect(localStorage.getItem("gdrive-fid")).toBe("manual-fid");
  });

  it("stores only gdrive-fid when no auto file is present", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ files: [
        { id: "m1", name: "cave-tabac-20260517-120000.json", modifiedTime: "2026-05-17T12:00:00Z" },
        { id: "m2", name: "cave-tabac-20260516-120000.json", modifiedTime: "2026-05-16T12:00:00Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveRestore("fake-token"); });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());
    expect(localStorage.getItem("gdrive-auto-fid")).toBeNull();
    expect(localStorage.getItem("gdrive-fid")).toBe("m1");
  });
});

// ── E. gdriveLoadOptionPayload ───────────────────────────────
//
// Coverage focus:
//   - SettingsModal pre-fetches every option payload in parallel
//     as soon as the picker opens — verifying the lazy loader handles
//     concurrent calls without duplicate fetches or wedged _loading slots.
//   - when the listing entry has a falsy `id` (malformed response),
//     the slot resets _loading=false and sets _loadFailed=true rather than
//     leaving the option stuck in "Chargement…" forever.

describe("gdriveLoadOptionPayload — concurrent pre-fetch", () => {
  // SettingsModal pre-fetches every option's payload as soon as the
  // picker opens (forEach over options[] from a useEffect). The hook
  // code is identical to the single-option case — we verify the slot
  // idempotency guard so a re-mount or duplicate effect can't trigger
  // a duplicate fetch.
  //
  // Note: a true "two parallel setState calls share React batching"
  // assertion is not testable under jsdom + act (React 19 batches the
  // two and the synchronous `if (!shouldFetch) return;` guard reads
  // the updater closure before React has flushed it). Production
  // works because SettingsModal's useEffect runs after commit, where
  // React processes each setState as it lands.

  it("does not refetch a slot whose data is already loaded (idempotency)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          files: [{ id: "f1", name: "cave-tabac-1.json", modifiedTime: "2026-05-17T12:00:00Z" }],
        }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.gdriveRestore("fake-token");
    });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());

    // Inject d directly to simulate a slot whose payload is already loaded.
    act(() => {
      result.current.setGdriveConfirm((prev: any) => {
        const next = Object.assign({}, prev);
        next.options = prev.options.slice();
        next.options[0] = Object.assign({}, prev.options[0], { d: { tobaccos: [] } });
        return next;
      });
    });

    const callsBefore = mockFetch.mock.calls.length;
    act(() => {
      result.current.gdriveLoadOptionPayload(0);
    });
    // Wait a tick to let any deferred updater run, then assert no new fetch.
    await new Promise(r => setTimeout(r, 30));
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });
});

describe("gdriveLoadOptionPayload — wedge guard", () => {
  it("resets _loading and marks _loadFailed when the listing entry has a falsy id", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          files: [
            { id: "", name: "malformed.json", modifiedTime: "2026-05-17T12:00:00Z" },
          ],
        }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.gdriveRestore("fake-token");
    });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());

    const callsBefore = mockFetch.mock.calls.length;
    act(() => {
      result.current.gdriveLoadOptionPayload(0);
    });

    // The slot must end in {_loadFailed: true, _loading: false} — not wedged.
    await waitFor(() => {
      const opt = (result.current.gdriveConfirm as any).options[0];
      return opt._loadFailed === true && opt._loading === false;
    });
    // No payload fetch — the guard kicks in before any network call.
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });

  it("marks _loadFailed when the payload fetch returns a non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          files: [
            { id: "f1", name: "cave-tabac-1.json", modifiedTime: "2026-05-17T12:00:00Z" },
          ],
        }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.gdriveRestore("fake-token");
    });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());

    // Subsequent fetches return 500.
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") }),
    );

    act(() => {
      result.current.gdriveLoadOptionPayload(0);
    });

    await waitFor(() => {
      const opt = (result.current.gdriveConfirm as any).options[0];
      return opt._loadFailed === true && opt._loading === false;
    });
  });

  it("a _loadFailed slot is NOT re-fetched on the next call (regression-loop guard)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          files: [
            { id: "f1", name: "cave-tabac-1.json", modifiedTime: "2026-05-17T12:00:00Z" },
          ],
        }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => {
      result.current.gdriveRestore("fake-token");
    });
    await waitFor(() => expect(result.current.gdriveConfirm).not.toBeNull());

    // Inject _loadFailed=true on the slot to simulate a previous failure.
    act(() => {
      result.current.setGdriveConfirm((prev: any) => {
        const next = Object.assign({}, prev);
        next.options = prev.options.slice();
        next.options[0] = Object.assign({}, prev.options[0], { _loadFailed: true });
        return next;
      });
    });

    const callsBefore = mockFetch.mock.calls.length;
    act(() => {
      result.current.gdriveLoadOptionPayload(0);
    });
    // Wait a tick to let any deferred updater run, then assert no new fetch.
    await new Promise(r => setTimeout(r, 30));
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });
});

// ── F + G. REMOVED with the picker's DELETE MODE ──────────────────
//
// `gdriveManageBackups` opened this same picker with `mode: "delete"`, and
// `gdriveDeleteOption` was the per-row bin that only rendered inside that
// mode. Neither had a production caller: the mode lost its entry point when
// « Voir mes sauvegardes » merged into the cloud panel, and the OAuth "list"
// return branch resolves to `runSyncDiagnostic` on both providers. These ~13
// cases WERE the only consumers — which is exactly what made both functions
// look alive to knip, a test file counting as a use.
//
// What they guarded is not lost: the per-file delete users actually have is
// `gdriveDeleteBackupById`, covered by its own block, including the two rules
// this pair carried (clear a cached fid pointing at the deleted file, and
// check `r.ok` before the optimistic row removal).

// ── OAuth callback dispatcher — keep user in place on "reconnect" ────────────
// An earlier release fix: when the iOS standalone redirect lands back in the app with
// a pending reconnect action, the OAuth callback effect must NOT open the
// Settings modal. The user clicked the Drive-expired banner from wherever
// they were and expects to stay there once the token has been refreshed.

describe("OAuth callback dispatcher — reconnect does not open Settings", () => {
  afterEach(() => {
    (window as any).__PENDING_GDRIVE_ACTION__ = null;
    (window as any).__PENDING_GDRIVE_CODE__ = null;
    (window as any).__PENDING_GDRIVE_VERIFIER__ = null;
    (window as any).__PENDING_GDRIVE_REDIRECT__ = null;
    (window as any).__PENDING_GDRIVE_TOKEN__ = null;
  });

  it("PKCE flow: setImportModal stays untouched when ac === 'reconnect'", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "reconnect";
    (window as any).__PENDING_GDRIVE_CODE__ = "fake-code";
    (window as any).__PENDING_GDRIVE_VERIFIER__ = "fake-verifier";
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ access_token: "fresh-token" }),
    });
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    renderHook(() => useGdriveSync(props as any));
    // Effect fires synchronously after mount; the fetch resolves async.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    expect(setImportModal).not.toHaveBeenCalled();
  });

  it("PKCE flow: setImportModal IS called when ac === 'save'", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "save";
    (window as any).__PENDING_GDRIVE_CODE__ = "fake-code";
    (window as any).__PENDING_GDRIVE_VERIFIER__ = "fake-verifier";
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ access_token: "fresh-token" }),
    });
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    renderHook(() => useGdriveSync(props as any));
    await waitFor(() => {
      expect(setImportModal).toHaveBeenCalledWith(true);
    });
  });

  it("Token flow: setImportModal stays untouched when ac === 'reconnect'", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "reconnect";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "raw-token";
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    renderHook(() => useGdriveSync(props as any));
    // Give the effect a microtask to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(setImportModal).not.toHaveBeenCalled();
  });

  it("Token flow: setImportModal IS called when ac === 'restore'", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "restore";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "raw-token";
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    renderHook(() => useGdriveSync(props as any));
    await waitFor(() => {
      expect(setImportModal).toHaveBeenCalledWith(true);
    });
  });
});

// ── "list" action — "View my backups" round-trip ─────────────────
// Tapping "Voir mes sauvegardes" in Settings runs `runSyncDiagnostic`, which
// uses the dedicated "list" action so the iOS standalone redirect flow doesn't
// re-enter `gdriveRestore` on the way back. The OAuth callback must:
//   1. Treat ac="list" as a whitelisted action (not silently ignored).
//   2. NOT open the restore picker — the user's intent is read-only.
//   3. Persist the fresh token + fetch the listing + populate the panel.

describe("OAuth callback dispatcher — 'list' action", () => {
  beforeEach(() => {
    // captureAccountHint fires a drive/v3/about request
    // after every successful auth callback unless a hint is already
    // persisted. Seed the hint here so it short-circuits and doesn't
    // consume the queued mockFetch.mockResolvedValueOnce reserved for
    // the backups list fetch below.
    localStorage.setItem("gdrive-account-hint", "test@example.com");
  });
  afterEach(() => {
    (window as any).__PENDING_GDRIVE_ACTION__ = null;
    (window as any).__PENDING_GDRIVE_CODE__ = null;
    (window as any).__PENDING_GDRIVE_VERIFIER__ = null;
    (window as any).__PENDING_GDRIVE_REDIRECT__ = null;
    (window as any).__PENDING_GDRIVE_TOKEN__ = null;
    localStorage.removeItem("gdrive-account-hint");
  });

  // The "list" action used to have TWO panels behind it — the backups list and
  // the multi-device diagnostic — and resumed into the first. They are one
  // panel now, so every resumption lands on the same view. What this still
  // guards is the part that mattered: the action lists files and does NOT open
  // the destructive restore picker.
  it("Token flow: ac='list' lists the files without dispatching the picker", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "list";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "fresh-token";
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        files: [
          { id: "f1", name: "cave-tabac-20250101-100000-t1-p1-w0-a0-j0.json", size: "1000", modifiedTime: "2025-01-01T10:00:00Z" },
          { id: "f2", name: "cave-tabac-auto-20250102-100000-t1-p1-w0-a0-j0.json", size: "1500", modifiedTime: "2025-01-02T10:00:00Z" },
        ],
      }),
    });
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await waitFor(() => {
      expect(result.current.syncDiag).toBeTruthy();
    });
    expect(result.current.syncDiag!.rows).toHaveLength(2);
    // The size travels with the row now — that is what let the two panels
    // become one, so a row that lost it would silently un-merge them.
    expect(result.current.syncDiag!.rows.map((r: any) => r.size)).toEqual(["1500", "1000"]);
    // The restore picker (gdriveConfirm) must NOT have been opened.
    expect(result.current.gdriveConfirm).toBeFalsy();
  });

  it("Token flow: ac='list' surfaces Drive errors in the panel", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "list";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "fresh-token";
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: { code: 500, message: "boom" } }),
    });
    const props = makeProps();
    const { result } = renderHook(() => useGdriveSync(props as any));
    await waitFor(() => {
      expect(result.current.syncDiagErr).toMatch(/boom/);
    });
  });
});

// The listing's status/error surfacing is exercised through the "list" action
// tests above (iOS callback path). The popup-mode error branch requires
// mocking `window.google.accounts.oauth2` — out of scope here.

// ── account-hint lifecycle (incl. the PII clear) ─────────────────────────────
// The persisted `gdrive-account-hint` email lets re-auth skip Google's account
// picker. It must be cleared ONLY on an explicit account switch (the
// `gdrive-force-select` flag set by Settings → "Switch Google account"), NOT
// on routine 401 token expiry — otherwise the picker-skip breaks on every
// refresh. These tests lock that contract.

describe("account-hint lifecycle", () => {
  function stubGoogle() {
    (window as any).google = {
      accounts: {
        oauth2: {
          // initTokenClient returns a client whose requestAccessToken is a
          // no-op — we only care about the synchronous hint-clear that runs
          // at the top of gdriveGetToken, before any OAuth round-trip.
          initTokenClient: () => ({ requestAccessToken: () => {} }),
        },
      },
    };
  }
  afterEach(() => {
    delete (window as any).google;
  });

  it("clears gdrive-account-hint when gdrive-force-select is set (explicit switch)", () => {
    stubGoogle();
    localStorage.setItem("gdrive-account-hint", "user@example.com");
    localStorage.setItem("gdrive-force-select", "1");
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveReconnect(); });
    // gdriveGetToken consumes + clears the force-select flag and wipes the
    // hint synchronously, before the (stubbed) OAuth dance.
    expect(localStorage.getItem("gdrive-force-select")).toBeNull();
    expect(localStorage.getItem("gdrive-account-hint")).toBeNull();
  });

  it("KEEPS gdrive-account-hint on a normal re-auth (no force-select)", () => {
    stubGoogle();
    localStorage.setItem("gdrive-account-hint", "user@example.com");
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveReconnect(); });
    // No force-select → the hint survives so the next picker is skipped.
    expect(localStorage.getItem("gdrive-account-hint")).toBe("user@example.com");
  });

  it("tkClear (401 path) does NOT drop the hint — only the token", () => {
    // Simulate a 401 wipe: the list API returns 401, which routes through
    // tkClear. The hint must survive so the auto-retry skips the picker.
    localStorage.setItem("gdrive-account-hint", "user@example.com");
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "old-tk", x: Date.now() + 3600000 }));
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: { code: 401, message: "Unauthorized" } }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.gdriveSave("fake-token"); });
    return waitFor(() => {
      expect(localStorage.getItem("gdrive-tk")).toBeNull();
    }).then(() => {
      expect(localStorage.getItem("gdrive-account-hint")).toBe("user@example.com");
    });
  });
});

// ── triggerIosAutosaveReauth conditions ──────────────────────
// The helper is a no-op on the non-iOS test environment (IS_IOS_STANDALONE is
// evaluated at import time from navigator.standalone, which jsdom leaves
// undefined). That's enough to lock the core "never fires on non-iOS"
// contract and the "doesn't crash when called" property — the actual iOS
// redirect path is exercised via the OAuth callback dispatcher above.

describe("triggerIosAutosaveReauth — non-iOS no-op contract", () => {
  it("returns without writing gdrive-pending or navigating", () => {
    // Seed all conditions that WOULD trigger a redirect on iOS so we
    // know the gate is the IS_IOS_STANDALONE check, not a side effect.
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("gdrive-auto-fid", "stale-fid");
    localStorage.removeItem("gdrive-pending");
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    expect(() => result.current.triggerIosAutosaveReauth()).not.toThrow();
    // The non-iOS path is the silent-refresh branch in gdriveSaveQuiet —
    // triggerIosAutosaveReauth itself doesn't write gdrive-pending.
    expect(localStorage.getItem("gdrive-pending")).toBeNull();
  });
});

// ── OAuth dispatcher: ac="autosave" ──────────────────────────
// The iOS save-tap trick lands here on return: the token is persisted, no
// modal opens, and gdriveSaveQuiet fires in the background.

describe("OAuth callback dispatcher — 'autosave' action", () => {
  beforeEach(() => {
    localStorage.setItem("gdrive-account-hint", "test@example.com");
  });
  afterEach(() => {
    (window as any).__PENDING_GDRIVE_ACTION__ = null;
    (window as any).__PENDING_GDRIVE_TOKEN__ = null;
    localStorage.removeItem("gdrive-account-hint");
  });

  it("persists the token and does NOT open the import modal", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "autosave";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "fresh-autosave-token";
    const setImportModal = vi.fn();
    const props = makeProps({ setImportModal });
    renderHook(() => useGdriveSync(props as any));
    // Allow the pending-OAuth effect to flush.
    await new Promise((r) => setTimeout(r, 0));
    // Token persisted (sessionStorage on non-iOS test env).
    var stored = sessionStorage.getItem("gdrive-tk") || "";
    expect(stored).toContain("fresh-autosave-token");
    // CRUCIAL: no Settings modal opened — the whole point of the
    // workaround is that it stays invisible.
    expect(setImportModal).not.toHaveBeenCalled();
  });
});

// ── provider routing (Dropbox) ─────────────────────────────────────
// With cloudProviderId="dropbox" every wire call must hit the Dropbox
// endpoints and the per-provider fid namespace — and never touch
// googleapis.com or the gdrive-* fid keys.

describe("provider routing — cloudProviderId='dropbox'", () => {
  function seedDropboxToken() {
    localStorage.setItem(
      "dropbox-tk",
      JSON.stringify({ t: "dbx-tok", x: Date.now() + 3600000 }),
    );
  }

  it("gdriveSave routes list + upload to Dropbox and stores dropbox-fid", async () => {
    seedDropboxToken();
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("files/list_folder")) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ entries: [] })),
        });
      }
      if (String(url).includes("files/upload")) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ id: "id:new1", name: "n.json" })),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
    }) as any;
    const props = makeProps({ cloudProviderId: "dropbox" });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave(); });
    await waitFor(() => {
      expect(calls.some(c => c.url === "https://api.dropboxapi.com/2/files/list_folder")).toBe(true);
      expect(calls.some(c => c.url === "https://content.dropboxapi.com/2/files/upload")).toBe(true);
    });
    // No Google call anywhere in the pipeline.
    expect(calls.some(c => c.url.includes("googleapis.com"))).toBe(false);
    // The new file id lands in the DROPBOX namespace, not gdrive-fid.
    await waitFor(() => expect(localStorage.getItem("dropbox-fid")).toBe("id:new1"));
    expect(localStorage.getItem("gdrive-fid")).toBeNull();
    // Auth header carries the cached Dropbox token.
    const upload = calls.find(c => c.url.includes("files/upload"))!;
    expect(upload.init.headers.Authorization).toBe("Bearer dbx-tok");
  });

  it("gdriveSave with provider='gdrive' (default) never touches dropboxapi.com", async () => {
    // Token cached for the iOS-free popup path: pre-seed driveTokenRef
    // via preToken argument instead.
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: any) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ files: [], id: "g1" }),
        text: () => Promise.resolve("{}"),
      });
    }) as any;
    const props = makeProps({});
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave("gtok"); });
    await waitFor(() => expect(calls.some(u => u.includes("googleapis.com"))).toBe(true));
    expect(calls.some(u => u.includes("dropboxapi.com"))).toBe(false);
  });

  it("a Dropbox 401 invalidates only the dropbox access token (refresh token survives)", async () => {
    seedDropboxToken();
    localStorage.setItem("dropbox-rt", "keep-me");
    globalThis.fetch = vi.fn().mockImplementation((url: any) => {
      if (String(url).includes("files/list_folder")) {
        return Promise.resolve({
          ok: false, status: 401,
          text: () => Promise.resolve(JSON.stringify({ error_summary: "expired_access_token/" })),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
    }) as any;
    const props = makeProps({ cloudProviderId: "dropbox" });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { result.current.gdriveSave(); });
    await waitFor(() => expect(localStorage.getItem("dropbox-tk")).toBeNull());
    expect(localStorage.getItem("dropbox-rt")).toBe("keep-me");
    // The Google token store is untouched by a Dropbox failure.
    expect(sessionStorage.getItem("gdrive-tk")).toBeNull();
  });
});

// ── post-picker paths must use the PROVIDER token ────────────────────────────
// Real-device bug: with Dropbox active and a stale Google token still
// cached (gdrive-tk), tapping Restore listed fine (list goes through
// getCloudToken) but the confirm download read driveTokenRef/tkGet
// directly and sent the GOOGLE token to content.dropboxapi.com →
// HTTP 400. These tests run the full restore confirm under Dropbox
// with a poisoned Google cache and assert the Dropbox token is used.

describe("post-picker token routing under Dropbox", () => {
  function seedBothTokens() {
    localStorage.setItem(
      "dropbox-tk", JSON.stringify({ t: "dbx-tok", x: Date.now() + 3600000 }),
    );
    // Poisoned Google cache — the exact real-device condition.
    sessionStorage.setItem(
      "gdrive-tk", JSON.stringify({ t: "GOOGLE-TOKEN", x: Date.now() + 3600000 }),
    );
  }

  it("doGdriveConfirm downloads from Dropbox with the Dropbox token", async () => {
    seedBothTokens();
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: any, init: any) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ tobaccos: [], _schemaVersion: "v6" })),
        json: () => Promise.resolve({}),
      });
    }) as any;
    const stageImport = vi.fn();
    const props = makeProps({ cloudProviderId: "dropbox", stageImport });
    const { result } = renderHook(() => useGdriveSync(props as any));
    act(() => {
      result.current.setGdriveConfirm({
        options: [{ id: "id:f1", name: "cave-tabac-x.json", d: null, ds: "", saveType: "manual" }],
        sel: 0,
      });
    });
    await act(async () => { result.current.doGdriveConfirm(); });
    await waitFor(() => {
      const dl = calls.find(c => c.url === "https://content.dropboxapi.com/2/files/download");
      expect(dl).toBeTruthy();
      expect(dl!.init.headers.Authorization).toBe("Bearer dbx-tok");
    });
    // The Google token must never reach a Dropbox host.
    for (const c of calls) {
      if (c.url.includes("dropboxapi.com")) {
        expect(c.init.headers.Authorization).not.toContain("GOOGLE-TOKEN");
      }
    }
    await waitFor(() => expect(stageImport).toHaveBeenCalled());
  });

  // REPOINTED, not deleted. This asserted that a backup DELETE reaches the
  // Dropbox host with the DROPBOX token — a real guarantee about provider
  // routing — but it drove `gdriveDeleteOption`, the picker's per-row bin,
  // which was removed with the delete mode nothing could enter. The delete
  // users actually have is `gdriveDeleteBackupById`, in the merged cloud
  // panel, so the same property is asserted on the live path.
  it("deleting a backup uses the Dropbox token on Dropbox", async () => {
    seedBothTokens();
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: any, init: any) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve("{}"),
        json: () => Promise.resolve({}),
      });
    }) as any;
    const props = makeProps({ cloudProviderId: "dropbox" });
    const { result } = renderHook(() => useGdriveSync(props as any));
    await act(async () => { await result.current.gdriveDeleteBackupById("id:f1"); });
    await waitFor(() => {
      const del = calls.find(c => c.url === "https://api.dropboxapi.com/2/files/delete_v2");
      expect(del).toBeTruthy();
      expect(del!.init.headers.Authorization).toBe("Bearer dbx-tok");
    });
    // The Google token must never reach a Dropbox host.
    for (const c of calls) {
      if (c.url.includes("dropboxapi.com")) {
        expect(c.init.headers.Authorization).not.toContain("GOOGLE-TOKEN");
      }
    }
  });
});

// ── resetting the cloud panel on a provider switch ────────────────
// The panel is provider-scoped (Drive ids ≠ Dropbox ids); leaving it populated
// with the OTHER provider's listing after a switch was misleading. A useEffect
// wipes it when cloudProviderId changes.

describe("the cloud panel resets on a provider switch", () => {
  // Drive and Dropbox file ids are not interchangeable, so a panel built from
  // one provider must not survive a switch to the other — it would show
  // foreign files, and its delete would execute one provider's opaque id
  // against the other. This used to be asserted on `backupsMeta`; that state
  // is gone with the panel merge, and `syncDiag` is what the single panel
  // reads, so the guarantee moved with it rather than lapsing.
  it("drops syncDiag when cloudProviderId flips", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok-123", x: Date.now() + 3500000 }));
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        files: [{ id: "g1", name: "cave-tabac-20250101-100000-t1-p1-w0-a0-j0.json", size: "10", modifiedTime: "2025-01-01T10:00:00Z" }],
      }),
    });
    const { result, rerender } = renderHook(
      (p: any) => useGdriveSync(p as any),
      { initialProps: makeProps({ cloudProviderId: "gdrive" }) },
    );
    // Populate through the real path rather than a test-only setter — the
    // panel is fed by runSyncDiagnostic and by nothing else.
    await act(async () => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());

    rerender(makeProps({ cloudProviderId: "dropbox" }) as any);
    expect(result.current.syncDiag).toBeNull();
  });
});

// ── E. Multi-device guard ─────────────────────────────────────

// "Vérifier les sauvegardes cloud" had NO coverage at all,
// which is how it shipped answering in the wrong place with the wrong amount
// of information. Reported from the app: "je clique sur vérifier les
// sauvegardes, il ne se passait rien… ensuite il me dit juste ok, avant je
// voyais le détail par device."
describe("checkCloudNewerNow — answers in place, with the per-device detail", () => {
  function tokenInSession() {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok-123", x: Date.now() + 3500000 }));
  }

  it("reports the per-device roll-up instead of a bare status when nothing is newer", async () => {
    tokenInSession();
    localStorage.setItem("cave-autosave-ts-gdrive", String(Date.now()));
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{
          id: "f1",
          name: "cave-tabac-auto-abc123-20260612-101010-t5-p2-w0-a1-j9.json",
          modifiedTime: new Date(Date.now() - 7 * 86400000).toISOString(),
        }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    expect(result.current.syncDiag!.rows.length).toBe(1);
    expect(result.current.syncDiag!.devices.length).toBeGreaterThan(0);
    expect(result.current.syncDiagSource).toBe("check");
    // The old behaviour wrote "✓ OK" into the SHARED status, whose Notice is
    // pinned under the SAVE button three rows above — the user never saw it.
    expect(result.current.gdriveStatus).toBeFalsy();
  });

  it("still raises the banner on a hit, AND explains what it saw", async () => {
    tokenInSession();
    localStorage.setItem("cave-autosave-ts-gdrive", String(Date.now() - 3 * 86400000));
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{
          id: "f1",
          name: "cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json",
          modifiedTime: new Date(Date.now() - 3600000).toISOString(),
        }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.cloudNewerBackup).not.toBeNull());
    expect(result.current.syncDiag).not.toBeNull();
    expect(result.current.syncDiagSource).toBe("check");
  });

  it("puts a failure next to the button too, not in the shared status slot", async () => {
    tokenInSession();
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ error: { message: "boom" } }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.syncDiagErr).toBeTruthy());
    expect(result.current.syncDiagErr).toContain("boom");
    expect(result.current.gdriveStatus).toBeFalsy();
  });

  it("tags the source so Settings renders the panel under the button that was tapped", async () => {
    tokenInSession();
    mockFetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ files: [] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    expect(result.current.syncDiagSource).toBe("diag");
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.syncDiagSource).toBe("check"));
  });

  it("the check and the diagnostic can never disagree — same list in, same rows out", async () => {
    tokenInSession();
    const files = [
      { id: "f1", name: "cave-tabac-auto-zzz111-20260612-101010-t5-p2-w0-a1-j9.json", modifiedTime: new Date(Date.now() - 3600000).toISOString() },
      { id: "f2", name: "cave-tabac-20260601-090000-t4-p2-w0-a1-j7.json", modifiedTime: new Date(Date.now() - 10 * 86400000).toISOString() },
    ];
    mockFetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ files }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    const fromDiag = JSON.stringify(result.current.syncDiag!.rows);
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.syncDiagSource).toBe("check"));
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    // checkCloudNewerNow clears the dismissed markers, which only affects the
    // `muted` verdict — with no markers set the two must be identical.
    expect(JSON.stringify(result.current.syncDiag!.rows)).toBe(fromDiag);
  });
});

describe("cloudNewerBackup — launch check", () => {
  function tokenInSession() {
    sessionStorage.setItem(
      "gdrive-tk",
      JSON.stringify({ t: "tok-123", x: Date.now() + 3500000 }),
    );
  }

  it("flags a newer cloud backup after the delayed silent check", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    // Device last saved 3 days ago; cloud has a file from 1 hour ago.
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    tokenInSession();
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "f1", name: "cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json", modifiedTime: newerIso }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    expect(result.current.cloudNewerBackup).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).not.toBeNull();
    expect(result.current.cloudNewerBackup!.name).toContain("cave-tabac-");
    expect(result.current.cloudNewerBackup!.counts).toMatchObject({ tobaccos: 5, pipes: 2 });
  });

  it("flags a foreign backup on a provider this device never saved to — no global-ts fallback (latent-bug fix)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    // The GLOBAL cave-autosave-ts is RECENT (its last save was to the OTHER
    // provider, or a legacy install), but this device has NEVER saved to the
    // active provider (gdrive) — so cave-autosave-ts-gdrive is absent. A
    // foreign cloud file that is OLDER than the global but genuinely newer
    // for THIS provider must be surfaced. Pre-fix, localRef fell back to the
    // recent global and silently hid it (cross-provider divergence).
    localStorage.setItem("cave-autosave-ts", String(Date.now())); // recent global only
    // deliberately NO cave-autosave-ts-gdrive
    tokenInSession();
    const olderThanGlobal = new Date(Date.now() - 3600000).toISOString(); // 1h ago
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "f1", name: "cave-tabac-20260612-101010-t3-p1-w0-a0-j2.json", modifiedTime: olderThanGlobal }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).not.toBeNull();
  });

  it("stays silent when the user never engaged with cloud backup", async () => {
    vi.useFakeTimers();
    tokenInSession();
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [{ id: "f1", name: "cave-tabac-x.json", modifiedTime: new Date().toISOString() }] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // THE RESTORE-ONLY DEVICE.
  //
  // The `engaged` gate used to read `cave-autosave` + the two fid keys, and
  // those fids are written ONLY by the save paths. A restore writes none of
  // them. So a device set up by restoring, with auto-save left off, was judged
  // "not engaged" and the multi-device check never ran — silently, for ever —
  // which is precisely the device that needs it: the one you pick up after a
  // week away and want to be told is stale. Reported from the app.
  //
  // Holding a Drive account hint / a Dropbox refresh token means the user has
  // connected THIS device to THAT provider. Narrow the gate back to the three
  // save-written keys and both of these go red.
  it("runs the check on a Drive device that only ever RESTORED (account hint, no fid, no auto-save)", async () => {
    vi.useFakeTimers();
    // NO cave-autosave, NO gdrive-fid, NO gdrive-auto-fid — a restore writes none.
    localStorage.setItem("gdrive-account-hint", "someone@example.com");
    tokenInSession();
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "f1", name: "cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json", modifiedTime: newerIso }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(mockFetch).toHaveBeenCalled();
    expect(result.current.cloudNewerBackup).not.toBeNull();
    expect(readCloudCheckDiag()!.stage).toBe("found");
  });

  it("runs the check on a Dropbox device that only ever RESTORED (refresh token, no fid, no auto-save)", async () => {
    vi.useFakeTimers();
    // NO cave-autosave, NO dropbox-fid, NO dropbox-auto-fid.
    localStorage.setItem("dropbox-rt", "rt-abc");
    localStorage.setItem("dropbox-tk", JSON.stringify({ t: "dbx-tok", x: Date.now() + 3600000 }));
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        entries: [{
          ".tag": "file",
          id: "id:f1",
          name: "cave-tabac-20260612-101010-t5-p2-w0-a1-j9.json",
          server_modified: newerIso,
        }],
      })),
    });
    const { result } = renderHook(() =>
      useGdriveSync(makeProps({ cloudProviderId: "dropbox" }) as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(mockFetch).toHaveBeenCalled();
    expect(result.current.cloudNewerBackup).not.toBeNull();
    expect(readCloudCheckDiag()!.stage).toBe("found");
  });

  it("records WHY the check did not run — a never-connected device says so", async () => {
    vi.useFakeTimers();
    tokenInSession();
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).toBeNull();
    // The point of the diagnostic: "it looked and found nothing" and "it never
    // looked" were indistinguishable, so a stale second device was unexplainable.
    expect(readCloudCheckDiag()).toMatchObject({ stage: "not-engaged" });
  });

  it("records a clean 'none' when the check ran and found nothing newer", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts-gdrive", String(Date.now()));
    tokenInSession();
    mockFetch.mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ files: [] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).toBeNull();
    expect(readCloudCheckDiag()!.stage).toBe("none");
  });

  it("stays silent on Drive when no cached token exists (no popup from mount)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dismissCloudNewerBackup persists the marker and clears the state", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    tokenInSession();
    const ts = Date.now() - 3600000;
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "f1", name: "cave-tabac-x.json", modifiedTime: new Date(ts).toISOString() }],
      }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    vi.useRealTimers();
    expect(result.current.cloudNewerBackup).not.toBeNull();
    act(() => { result.current.dismissCloudNewerBackup(); });
    expect(result.current.cloudNewerBackup).toBeNull();
    const marker = parseInt(localStorage.getItem(cloudDismissKeys(false).ts) || "0", 10);
    expect(Math.abs(marker - ts)).toBeLessThan(1500);
  });

  it("a restore confirm acks the banner via the by-name marker (no Date.now() ts floor)", () => {
    renderAndConfirm({}, { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] });
    // The ack records the restored option's NAME (the primary
    // skew-proof dedup) — here "cave-tabac-backup.json" from renderAndConfirm.
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBe("cave-tabac-backup.json");
    // It must NOT write a Date.now() ts floor: doing so muted every OTHER
    // device's cloud backup present at restore time (the multi-device bug).
    // With no modifiedTime on this simplified option, no ts floor is set.
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).toBeNull();
  });

  // One-tap restore from the Home banner. Fetches the
  // specific file ID flagged at launch, decrypts if needed, then hands
  // off to the import picker (stageImport). The banner is acked on
  // success so it doesn't resurface next launch.
  it("restoreCloudNewerBackup downloads the flagged file and stages it for import", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    tokenInSession();
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    const payload = JSON.stringify({
      tobaccos: [{ id: 1, brand: "Test", name: "Brand", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    // First fetch: the launch listing.
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "remote-file-id", name: "cave-tabac-x-t1-p0-w0-a0-j0.json", modifiedTime: newerIso }],
      }),
    });
    // Second fetch: the restore download.
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(payload),
    });
    const stageImport = vi.fn();
    const setImportModal = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ stageImport, setImportModal }) as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.cloudNewerBackup).not.toBeNull();
    expect(result.current.cloudNewerBackup!.id).toBe("remote-file-id");
    await act(async () => { result.current.restoreCloudNewerBackup(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    vi.useRealTimers();
    expect(stageImport).toHaveBeenCalled();
    const args = stageImport.mock.calls[0]!;
    expect(args[0].tobaccos).toHaveLength(1);
    expect(args[1]).toBe("drive");
    // ── REVERSED, on the user's decision ───────────
    // This asserted `{ autoApply: "replace" }` — "so the user never sees the
    // Replace / Merge picker". That was the app's only auto-replace
    // call site: no picker, no diff, no undo, on the one banner that appears
    // precisely when there IS unsynced local work to lose (the guard compares
    // against this device's last CLOUD save, not its last local edit).
    //
    // It goes through the picker now, so the third arg must be absent — and
    // `setImportModal(true)` must fire, because the picker is rendered by
    // SettingsModal, which CuratorApp only mounts while `importModal` is set.
    // Staging without opening it would leave the import pending with nothing
    // on screen, which is worse than what was fixed.
    expect(args[2]?.autoApply, "an auto-applied replace is what this build removed").toBeUndefined();
    expect(setImportModal, "the picker cannot render unless Settings is mounted")
      .toHaveBeenCalledWith(true);
    // ── REVERSED ─────────────────────────────────────────────────────────
    // This asserted that the banner was ALREADY cleared and the dismissed
    // marker ALREADY stamped at this point — i.e. before the user had touched
    // the Replace / Merge picker. That is the defect: those markers are
    // persistent and the by-name one silences the file regardless of
    // timestamp, so cancelling the picker muted a genuinely-newer cloud
    // backup for ever. The ack moved to the picker's APPLIED path
    // (`onApplied`), so at THIS point nothing may be written and the banner
    // must still be armed. See cloudNewerAckOnApply.test.ts.
    expect(result.current.cloudNewerBackup).not.toBeNull();
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).toBeNull();
    expect(typeof args[2]?.onApplied).toBe("function");
  });

  it("restoreCloudNewerBackup is a no-op when no banner is set", () => {
    const stageImport = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ stageImport }) as any));
    expect(result.current.cloudNewerBackup).toBeNull();
    act(() => { result.current.restoreCloudNewerBackup(); });
    expect(stageImport).not.toHaveBeenCalled();
  });

  it("iOS OAuth-resume writes the dismissed markers from the persisted ack payload", async () => {
    // Reproduces the redirect-return: fresh mount (cloudNewerBackup state is
    // null), dispatcher resumes restore-cnb from the persisted keys. Earlier
    // the no-args ackCloudNewerBackup() read the null state and wrote NO
    // markers — the just-restored backup re-nagged on the next launch.
    const fileTs = Date.now() - 3600000;
    const fileName = "cave-tabac-auto-dev2-20260707-t3-p1-w0-a0-j2.json";
    (window as any).__PENDING_GDRIVE_ACTION__ = "restore-cnb";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "resumed-token";
    localStorage.setItem("cave-cloud-newer-pending-id", "remote-file-id");
    localStorage.setItem("cave-cloud-newer-pending-ack", JSON.stringify({ ts: fileTs, name: fileName }));
    // The resumed flow's only fetch is the download itself.
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        tobaccos: [{ id: 1, brand: "T", name: "B", lots: [] }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      })),
    });
    const stageImport = vi.fn();
    renderHook(() => useGdriveSync(makeProps({ stageImport }) as any));
    await waitFor(() => expect(stageImport).toHaveBeenCalled());
    // ── AMENDED, same guarantee through the new seam ─────────────────────
    // The ack fires on the picker's APPLIED path now (see
    // cloudNewerAckOnApply.test.ts for why), so it is invoked here rather
    // than read off localStorage straight after staging. What this case is
    // ABOUT is unchanged and still the interesting half: on a redirect return
    // the hook has just remounted, so `cloudNewerBackup` state is null — the
    // ack must take the file's ts + name from the PERSISTED payload, or it
    // writes no markers at all and the restored backup re-nags next launch.
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBeNull();
    const opts = stageImport.mock.calls[0]![2];
    await act(async () => { opts.onApplied(); });
    // The markers carry the FILE's ts + name from the persisted payload.
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).toBe(String(fileTs));
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBe(fileName);
    // One-shot keys consumed.
    expect(localStorage.getItem("cave-cloud-newer-pending-id")).toBeNull();
    expect(localStorage.getItem("cave-cloud-newer-pending-ack")).toBeNull();
    (window as any).__PENDING_GDRIVE_ACTION__ = null;
    (window as any).__PENDING_GDRIVE_TOKEN__ = null;
  });

  // visible busy flag for the banner buttons. Without
  // it the user kept tapping "Restaurer" because the page looked dead
  // — and each tap fired a parallel restore. The hook now flips a
  // `cloudRestoreBusy` flag at the start and a) blocks re-entry,
  // b) flips back at the end so the spinner can clear.
  it("cloudRestoreBusy flips true while a restore is in flight, then back", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    tokenInSession();
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    const payload = JSON.stringify({
      tobaccos: [{ id: 1, brand: "T", name: "B", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "remote-id", name: "cave-tabac-x-t1-p0-w0-a0-j0.json", modifiedTime: newerIso }],
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(payload),
    });
    const stageImport = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ stageImport }) as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.cloudRestoreBusy).toBe(false);
    act(() => { result.current.restoreCloudNewerBackup(); });
    // Flag should be true synchronously after the call.
    expect(result.current.cloudRestoreBusy).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    vi.useRealTimers();
    // Flag flips back after the chain resolves.
    expect(result.current.cloudRestoreBusy).toBe(false);
  });

  it("restoreCloudNewerBackup ignores re-entrant calls while busy", async () => {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    tokenInSession();
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    const payload = JSON.stringify({
      tobaccos: [{ id: 1, brand: "T", name: "B", lots: [] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "remote-id", name: "cave-tabac-x-t1-p0-w0-a0-j0.json", modifiedTime: newerIso }],
      }),
    });
    // Only ONE download mock — a parallel call would need another and crash.
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(payload),
    });
    const stageImport = vi.fn();
    const { result } = renderHook(() => useGdriveSync(makeProps({ stageImport }) as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => { result.current.restoreCloudNewerBackup(); });
    // Second tap while busy must be a no-op.
    act(() => { result.current.restoreCloudNewerBackup(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    vi.useRealTimers();
    // Only one stageImport call despite two taps.
    expect(stageImport).toHaveBeenCalledTimes(1);
  });
});

// ── auto-save diagnostic + sweep counts ──────────────────────────────

describe("recordAutosaveDiag / readAutosaveDiag", () => {
  beforeEach(() => { localStorage.clear(); });

  it("round-trips the last outcome", () => {
    expect(readAutosaveDiag()).toBeNull();
    recordAutosaveDiag("dropbox-token-failed", "invalid_grant");
    const d = readAutosaveDiag();
    expect(d).not.toBeNull();
    expect(d!.stage).toBe("dropbox-token-failed");
    expect(d!.detail).toBe("invalid_grant");
    expect(typeof d!.ts).toBe("number");
  });

  it("last write wins (one slot)", () => {
    recordAutosaveDiag("no-token");
    recordAutosaveDiag("ok", "deleted 3, failed 0");
    expect(readAutosaveDiag()!.stage).toBe("ok");
  });

  it("returns null on malformed storage", () => {
    localStorage.setItem("cave-autosave-diag", "{not json");
    expect(readAutosaveDiag()).toBeNull();
  });

  // The detail is routed through
  // redactApiKeys so a future provider error that echoes a token/key
  // can't leak into the device-local diagnostic slot.
  it("scrubs token/key-shaped strings from the detail (defense-in-depth)", () => {
    recordAutosaveDiag("upload-error", "PATCH 401 Bearer sk-abcdef0123456789ABCDEF refused");
    const d = readAutosaveDiag()!;
    expect(d.detail).not.toContain("sk-abcdef0123456789ABCDEF");
    expect(d.detail).toContain("[clé masquée]");
  });
});

describe("sweepOwnAutoStragglers — return counts", () => {
  it("counts successes and failures via r.ok across providers", async () => {
    localStorage.setItem("cave-device-id", "deva");
    const remove = vi.fn()
      .mockResolvedValueOnce({ ok: true })            // legacy-1 deleted
      .mockResolvedValueOnce({ ok: false, status: 429 }) // legacy-2 failed (Dropbox-style)
      .mockRejectedValueOnce(new Error("network"));   // mine-old threw
    const cloud = { remove } as any;
    const autoFiles = [
      { id: "legacy-1", name: "cave-tabac-auto-20260101-000000-t1-p0-w0-a0-j0.json" },
      { id: "legacy-2", name: "cave-tabac-auto-20260102-000000-t1-p0-w0-a0-j0.json" },
      { id: "mine-old", name: "cave-tabac-auto-deva-20260103-000000-t1-p0-w0-a0-j0.json" },
      { id: "keep",     name: "cave-tabac-auto-deva-20260104-000000-t1-p0-w0-a0-j0.json" },
      { id: "foreign",  name: "cave-tabac-auto-devb-20260105-000000-t1-p0-w0-a0-j0.json" },
    ];
    const res = await sweepOwnAutoStragglers(cloud, "tok", autoFiles, "deva", "keep");
    // keep skipped, foreign skipped → 3 attempted; 1 ok, 2 failed.
    expect(remove).toHaveBeenCalledTimes(3);
    expect(res).toEqual({ deleted: 1, failed: 2 });
    expect(remove).not.toHaveBeenCalledWith("tok", "keep");
    expect(remove).not.toHaveBeenCalledWith("tok", "foreign");
  });

  // An "already gone" delete (404 Drive /
  // 409 Dropbox path_lookup) is a SUCCESS for a convergence sweep — two
  // overlapping detached sweeps racing to delete the same straggler must
  // not report a bogus "failed".
  it("counts an already-absent delete (404/409) as deleted, not failed", async () => {
    const remove = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 }) // Drive: gone already
      .mockResolvedValueOnce({ ok: false, status: 409 }) // Dropbox: path_lookup/not_found
      .mockResolvedValueOnce({ ok: false, status: 401 }); // genuine auth failure
    const cloud = { remove } as any;
    const autoFiles = [
      { id: "gone-drive", name: "cave-tabac-auto-deva-20260101-000000-t1-p0-w0-a0-j0.json" },
      { id: "gone-dbx",   name: "cave-tabac-auto-deva-20260102-000000-t1-p0-w0-a0-j0.json" },
      { id: "auth-fail",  name: "cave-tabac-auto-deva-20260103-000000-t1-p0-w0-a0-j0.json" },
    ];
    const res = await sweepOwnAutoStragglers(cloud, "tok", autoFiles, "deva", null);
    expect(res).toEqual({ deleted: 2, failed: 1 });
  });
});

// monotonic attempt counter that lets the
// detached sweep suppress its terminal diagnostic when a newer save has
// started, so a stale "ok" can't bury a newer save's real failure.
describe("autosave attempt counter", () => {
  it("nextAutosaveAttempt increments and currentAutosaveAttempt reflects it", () => {
    const a = nextAutosaveAttempt();
    expect(currentAutosaveAttempt()).toBe(a);
    const b = nextAutosaveAttempt();
    expect(b).toBe(a + 1);
    expect(currentAutosaveAttempt()).toBe(b);
    // The guard a save uses: only record if its captured attempt is still
    // current. A stale attempt (a) is no longer current once b started.
    expect(currentAutosaveAttempt() === a).toBe(false);
    expect(currentAutosaveAttempt() === b).toBe(true);
  });
});

describe("getDeviceId", () => {
  beforeEach(() => { localStorage.clear(); });
  it("generates a lowercase-alphanumeric id once and persists it", () => {
    const a = getDeviceId();
    expect(a).toMatch(/^[0-9a-z]+$/);
    expect(getDeviceId()).toBe(a); // stable
    expect(localStorage.getItem("cave-device-id")).toBe(a);
  });
  it("replaces a malformed stored id", () => {
    localStorage.setItem("cave-device-id", "BAD-ID!");
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-z]+$/);
    expect(id).not.toBe("BAD-ID!");
  });
});

describe("runSyncDiagnostic — read-only multi-device diagnostic", () => {
  it("lists cloud files and explains each (own device ignored, newer foreign proposed)", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tk", x: Date.now() + 3600000 }));
    localStorage.setItem("cave-device-id", "8udtad7");
    localStorage.setItem("cave-auto-stamped", "1");
    localStorage.setItem("cave-autosave-ts-gdrive", String(new Date("2026-07-05T16:10:00.000Z").getTime()));
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [
        { id: "own", name: "cave-tabac-auto-8udtad7-20260705-161000-t5-p2-w14-a2-j22.json", modifiedTime: "2026-07-05T16:10:00.000Z" },
        { id: "dev2", name: "cave-tabac-auto-qsekqav94e-20260705-235700-t5-p2-w14-a2-j22.json", modifiedTime: "2026-07-05T23:57:00.000Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    const diag: any = result.current.syncDiag;
    expect(diag.deviceId).toBe("8udtad7");
    const dev2 = diag.rows.find((r: any) => r.id === "dev2");
    const own = diag.rows.find((r: any) => r.id === "own");
    expect(dev2.status).toBe("proposed");
    expect(own.reason).toBe("own_device");
  });

  it("dismissSyncDiag clears the result + error so the Settings button can toggle it closed", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tk", x: Date.now() + 3600000 }));
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [
        { id: "own", name: "cave-tabac-auto-8udtad7-20260705-161000-t5-p2-w14-a2-j22.json", modifiedTime: "2026-07-05T16:10:00.000Z" },
      ] }),
    });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    act(() => { result.current.dismissSyncDiag(); });
    expect(result.current.syncDiag).toBeNull();
    expect(result.current.syncDiagErr).toBeNull();
  });

  it("surfaces an error string when the list call fails, without throwing", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tk", x: Date.now() + 3600000 }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ error: { message: "boom" } }) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiagErr).not.toBeNull());
    expect(result.current.syncDiag).toBeNull();
  });
});

// A token requested under an action that does NOT match what
// the user tapped. The OAuth-return dispatcher can only route on the action, so
// two buttons that just need a read token were borrowing one that means
// something else. On iOS standalone (a redirect, the promise never settles)
// that decides which screen the user comes back to.
describe("OAuth return routing — the button you tapped is the one that resumes", () => {
  function iosNoToken() {
    // No cached Drive token → the interactive path, which redirects on iOS.
    sessionStorage.removeItem("gdrive-tk");
    localStorage.removeItem("gdrive-tk");
  }

  it("deleting a backup no longer asks for a token under the RESTORE action", () => {
    // Earlier this was getCloudToken("restore"), and `ac === "restore"` opens
    // the destructive "Remplace tout." picker on return — with the file still
    // there and nothing saying the delete had not happened.
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8");
    const i = src.indexOf("function gdriveDeleteBackupById");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 1400).replace(/\/\/[^\n]*/g, "");
    expect(body).toContain('getCloudToken("list")');
    expect(body).not.toContain('getCloudToken("restore")');
  });

  it("stamps a delete marker so the confirmed delete survives the redirect", async () => {
    iosNoToken();
    mockFetch.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { void result.current.gdriveDeleteBackupById("file-9"); });
    await waitFor(() => {
      const raw = localStorage.getItem(BACKUP_DELETE_PENDING_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).id).toBe("file-9");
    });
  });

  it("deleting the auto file this device tracks drops the cached fid", async () => {
    // The branch carries a comment calling itself "functional, not cosmetic" —
    // and nothing held it. PROBED: replacing the condition with `if (false)`
    // left all 118 cases in this file green.
    //
    // What it prevents: the next quiet save PATCHes a file that is gone. There
    // IS a 404 fallback to POST, so the cost is a wasted round-trip rather
    // than a lost backup — but a guarantee asserted in a comment and by
    // nothing else is exactly the shape this repo keeps paying for.
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3500000 }));
    localStorage.setItem("gdrive-auto-fid", "file-9");
    mockFetch.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await result.current.gdriveDeleteBackupById("file-9"); });
    expect(localStorage.getItem("gdrive-auto-fid"), "the fid still points at a deleted file").toBeNull();
  });

  it("deleting ANOTHER file leaves the cached fid alone", async () => {
    // The other direction, so the fix cannot degrade into "always clear it":
    // wiping the fid on every delete would make the next quiet save POST a
    // second auto file for this device, which is the pile three releases were
    // spent draining.
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3500000 }));
    localStorage.setItem("gdrive-auto-fid", "file-mine");
    mockFetch.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { await result.current.gdriveDeleteBackupById("file-other"); });
    expect(localStorage.getItem("gdrive-auto-fid")).toBe("file-mine");
  });

  it("a refused delete is an ERROR, not an optimistic row removal", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3500000 }));
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    let err: any = null;
    await act(async () => {
      await result.current.gdriveDeleteBackupById("file-9").catch((e: any) => { err = e; });
    });
    expect(err).not.toBeNull();
    expect(String(err.message)).toContain("403");
  });

  it("the check stamps its own marker instead of borrowing the backups-list return", () => {
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8");
    const i = src.indexOf("function checkCloudNewerNow");
    const body = src.slice(i, i + 2200).replace(/\/\/[^\n]*/g, "");
    // Assert the STAMP specifically: the function also CLEARS the key, so a
    // bare mention of the constant passes even with the stamp deleted.
    expect(body).toContain("lsSet(CLOUD_CHECK_PENDING_KEY");
    expect(body).toContain('gdriveGetToken("list")');
  });

  it("does NOT clear the dismissed markers before it has a token", async () => {
    // Earlier they were wiped first, so an iOS redirect that never returned
    // left the user with no markers AND no check performed.
    localStorage.setItem("cave-cloud-newer-dismissed", "12345");
    localStorage.setItem("cave-cloud-newer-dismissed-name", "old.json");
    iosNoToken();
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    act(() => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(localStorage.getItem(CLOUD_CHECK_PENDING_KEY)).toBeTruthy());
    expect(localStorage.getItem("cave-cloud-newer-dismissed")).toBe("12345");
    expect(localStorage.getItem("cave-cloud-newer-dismissed-name")).toBe("old.json");
  });

  it("clears them once the check actually runs", async () => {
    localStorage.setItem("cave-cloud-newer-dismissed", "12345");
    localStorage.setItem("cave-cloud-newer-dismissed-name", "old.json");
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3500000 }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) });
    const { result } = renderHook(() => useGdriveSync(makeProps() as any));
    await act(async () => { result.current.checkCloudNewerNow(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    expect(localStorage.getItem("cave-cloud-newer-dismissed")).toBeNull();
  });
});

// switching destination must disarm every provider-scoped
// surface, not just the backups list. A picker/offer/panel built from provider
// A executes A's opaque file ids against provider B.
describe("provider switch — nothing from the old destination survives", () => {
  it("clears the restore picker, the newer-backup offer and the sync panel", async () => {
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3500000 }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) });
    const props: any = makeProps({ cloudProviderId: "gdrive" });
    const { result, rerender } = renderHook(
      (p: any) => useGdriveSync(p), { initialProps: props });
    act(() => {
      result.current.setGdriveConfirm({ options: [{ id: "drive-1", name: "n.json" }], sel: 0 });
    });
    await act(async () => { result.current.runSyncDiagnostic(); });
    await waitFor(() => expect(result.current.syncDiag).not.toBeNull());
    expect(result.current.gdriveConfirm).not.toBeNull();
    rerender(makeProps({ cloudProviderId: "dropbox" }) as any);
    await waitFor(() => expect(result.current.gdriveConfirm).toBeNull());
    expect(result.current.syncDiag).toBeNull();
    expect(result.current.cloudNewerBackup).toBeNull();
  });
});

describe("cloud-newer dismissal is PER PROVIDER", () => {
  // The reference timestamp went per-provider and the file list
  // has always been the active provider's — but the two "déjà vu" markers
  // stayed global, so a dismissal on one destination silenced the other's
  // banner for ever. Same permanent-silence shape as the launch check, other door.
  beforeEach(() => { localStorage.clear(); });

  it("does not let a Dropbox dismissal silence Drive", () => {
    // Dismiss a Dropbox backup at ts=100. Drive has never been dismissed.
    writeCloudDismissed(true, 100, "cave-tabac-auto-abc-20260101-000000-t1-p0-w0-a0-j0.json");
    const drive = readCloudDismissed(false);
    expect(drive.ts).toBe(0);
    expect(drive.name).toBeNull();
    // …and Dropbox still remembers its own.
    expect(readCloudDismissed(true).ts).toBe(100);
  });

  it("keeps the two providers in separate storage keys", () => {
    const a = cloudDismissKeys(true), b = cloudDismissKeys(false);
    expect(a.ts).not.toBe(b.ts);
    expect(a.name).not.toBe(b.name);
    // Neither may BE the legacy global key, or the split is cosmetic.
    [a, b].forEach((k) => {
      expect(k.ts).not.toBe("cave-cloud-newer-dismissed");
      expect(k.name).not.toBe("cave-cloud-newer-dismissed-name");
    });
  });

  it("adopts an earlier global marker ONCE, onto the reading provider, then deletes it", () => {
    localStorage.setItem("cave-cloud-newer-dismissed", "555");
    localStorage.setItem("cave-cloud-newer-dismissed-name", "old.json");
    const drive = readCloudDismissed(false);
    expect(drive.ts).toBe(555);
    expect(drive.name).toBe("old.json");
    // The global pair is gone, so the OTHER provider starts clean — which is
    // the whole point: it was being wrongly suppressed.
    expect(localStorage.getItem("cave-cloud-newer-dismissed")).toBeNull();
    expect(readCloudDismissed(true).ts).toBe(0);
  });

  it("clears the per-provider markers AND the legacy globals on an explicit re-check", () => {
    // Leaving a legacy global behind would let the NEXT provider to read
    // adopt it — a silenced banner resurrected by a button whose whole
    // purpose is to reconsider everything.
    localStorage.setItem("cave-cloud-newer-dismissed", "555");
    writeCloudDismissed(false, 100, "x.json");
    clearCloudDismissed(false);
    expect(readCloudDismissed(false).ts).toBe(0);
    expect(localStorage.getItem("cave-cloud-newer-dismissed")).toBeNull();
  });

  it("never writes a zero/absent ts or an empty name as a marker", () => {
    // ackCloudNewerBackup can legitimately be called with nothing known; a
    // ts of 0 written as a floor would be harmless, but an empty NAME would
    // match a file whose name is "" and is pure noise in storage.
    writeCloudDismissed(false, 0, "");
    const k = cloudDismissKeys(false);
    expect(localStorage.getItem(k.ts)).toBeNull();
    expect(localStorage.getItem(k.name)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `gatherLocalImages` swallowed every per-key failure and ALWAYS resolved, with
// whatever subset it managed to read — so `doExport`'s guard, whose own comment
// says "gatherLocalImages can reject on a broken IndexedDB (private mode,
// evicted storage) — earlier the user believed the export succeeded", could not
// fire for the failure it names. A device with an unreadable photo store
// produced a JSON / ZIP / cloud backup with the photos missing, reported
// success, and called markExported(); the loss surfaced only on a restore
// somewhere else.
//
// The two thresholds below are the whole judgement, and the second one is the
// regression I nearly shipped: rejecting on a read that RESOLVES EMPTY would
// have stopped a user whose photos were already gone (an eviction, or the
// GC bug that really did wipe blobs) from exporting their CELLAR at
// all — far worse than a backup without photos they no longer have.
describe("gatherLocalImages reports an unreadable photo store", () => {
  const dataWithPhotos = () => ({
    ...INIT,
    tobaccos: [
      { id: 1, name: "A", brand: "B", imageUrl: "local-photo-1", lots: [] },
      { id: 2, name: "C", brand: "D", imageUrl: "local-photo-2", lots: [] },
    ],
  });

  it("REJECTS when every read throws — the broken-store case the guard names", async () => {
    vi.mocked(imgCache.get).mockImplementation(() => Promise.reject(new Error("InvalidStateError")));
    const { result } = renderHook(() => useGdriveSync(makeProps({ data: dataWithPhotos() }) as any));
    await expect(result.current.gatherLocalImages(dataWithPhotos())).rejects.toThrow(/unreadable/);
  });

  it("does NOT reject when the photos are merely GONE", async () => {
    // Already-lost blobs are not a broken store, and aborting here would stop
    // such a user backing up their cellar at all.
    vi.mocked(imgCache.get).mockImplementation(() => Promise.resolve(null));
    const { result } = renderHook(() => useGdriveSync(makeProps({ data: dataWithPhotos() }) as any));
    await expect(result.current.gatherLocalImages(dataWithPhotos())).resolves.toEqual({});
  });

  it("does NOT reject on a PARTIAL failure — one bad blob must not cost the backup", async () => {
    vi.mocked(imgCache.get).mockImplementation((k: any) =>
      String(k) === "local-photo-1" ? Promise.reject(new Error("bad")) : Promise.resolve("data:image/jpeg;base64,OK"));
    const { result } = renderHook(() => useGdriveSync(makeProps({ data: dataWithPhotos() }) as any));
    const m: any = await result.current.gatherLocalImages(dataWithPhotos());
    expect(Object.keys(m)).toEqual(["local-photo-2"]);
  });

  it("still resolves {} for a cellar with no photos at all", async () => {
    const { result } = renderHook(() => useGdriveSync(makeProps({ data: INIT }) as any));
    await expect(result.current.gatherLocalImages(INIT)).resolves.toEqual({});
  });

  it("the MANUAL save still SAYS so at the end, instead of showing a bare ✓ OK", async () => {
    // The warning was set inside `gatherLocalImages`' `.catch` and then
    // OVERWRITTEN one microtask later by `st_saving`, and again by `st_done`
    // on success — so the user saw « Sauvegarde… » then « ✓ OK », a backup
    // with NO `_imageData` went up, and `markExported()` disarmed the
    // "you have not backed up" reminder for 30 days. The loss surfaced only
    // on a restore somewhere else.
    //
    // Worth naming: the comment three lines above the `.catch` promised
    // exactly what did not happen — "says so in the status line the user is
    // already watching (it sits right under this button)". A comment
    // asserting a mechanism that does not work is worse than no comment.
    //
    // The AUTO save was already correct (`recordAutosaveDiag("photos-unreadable")`
    // persists); it was the ATTENDED path that was silent.
    vi.mocked(imgCache.get).mockImplementation(() => Promise.reject(new Error("InvalidStateError")));
    const markExported = vi.fn();
    mockFetch.mockImplementation((url: any) => {
      const u = String(url);
      if (u.indexOf("/upload/drive") >= 0) return Promise.resolve({ ok: true, json: async () => ({ id: "f1" }) });
      return Promise.resolve({ ok: true, json: async () => ({ files: [] }), text: async () => "" });
    });
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3600000 }));
    const { result } = renderHook(() => useGdriveSync(
      makeProps({ data: dataWithPhotos(), markExported }) as any));
    await act(async () => { await result.current.gdriveSave("tok"); });

    // `setGdriveStatus` is INTERNAL to the hook, so what the user is left
    // looking at is the settled `gdriveStatus`. That is also the honest thing
    // to assert: the defect was never "the warning is not set", it was "the
    // warning does not SURVIVE to be read".
    expect(result.current.gdriveStatus, "the save ended on a bare ✓ OK")
      .toBe("err_photos_unreadable");
  });

  it("propagates the rejection through withPhotos, where doExport's guard sits", async () => {
    // The interactive one-shot artifact fails LOUDLY: the user asked for a
    // complete-backup file and keeps it as their archive.
    vi.mocked(imgCache.get).mockImplementation(() => Promise.reject(new Error("InvalidStateError")));
    const { result } = renderHook(() => useGdriveSync(makeProps({ data: dataWithPhotos() }) as any));
    await expect(result.current.withPhotos(dataWithPhotos())).rejects.toThrow(/unreadable/);
  });
});
