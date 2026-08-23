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
      .mockResolvedValueOnce({ ok: true, text: async () => "brand_key,blend_name\nA,B\n" });
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
      .mockResolvedValueOnce({ ok: true, text: async () => "brand_key,blend_name\nA,B\n" });
    const { result } = renderHook(() => useGdriveSync(props()));
    await act(async () => { await result.current.catalogueCloudRestore("tok"); });
    expect(catalogueSave).toHaveBeenCalled();
    expect(String(catalogueSave.mock.calls[0]![0])).toContain("brand_key");
  });

  it("INVALIDATES the lookup cache, or the app answers from the old catalogue", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [{ id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "brand_key,blend_name\nA,B\n" });
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
      .mockResolvedValueOnce({ ok: true, text: async () => "not a catalogue" });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudRestore("tok"); });
    expect(ok).toBe(false);
    expect(tobaccoDbInvalidate).not.toHaveBeenCalled();
    expect(result.current.catalogueCloudStatus).toBe("cat_err_parse");
  });

  it("refuses an HTTP error BODY instead of parsing it as a catalogue", async () => {
    // A `fetch` that receives a 401/404 RESOLVES — it does not reject — so
    // without the `resp.ok` check the provider's error page reached
    // `parseCatalogueCsv`, which found no `brand_key` header and reported
    // « votre fichier n'est pas un catalogue valide ». The user then went off
    // to inspect a perfectly good CSV while the real fault was the token.
    // The three sibling downloads have always guarded; this one did not.
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ files: [{ id: "c1", name: NAME, modifiedTime: "2026-08-11T00:00:00Z" }] }) })
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{"error":{"code":401}}' });
    const { result } = renderHook(() => useGdriveSync(props()));
    let ok: any;
    await act(async () => { ok = await result.current.catalogueCloudRestore("tok"); });
    expect(ok).toBe(false);
    // NOT the parse message — the failure must name the transport.
    expect(result.current.catalogueCloudStatus).not.toBe("cat_err_parse");
    expect(catalogueSave, "an error page was written over the catalogue")
      .not.toHaveBeenCalled();
    expect(tobaccoDbInvalidate).not.toHaveBeenCalled();
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

// ─────────────────────────────────────────────────────────────────────────────
// THE OAUTH ACTION. On iOS standalone with no cached token, `getCloudToken`
// does `window.location.replace(...)` and the promise NEVER settles; on the
// way back the dispatcher routes on the pending ACTION STRING alone.
//
// Both catalogue buttons borrowed a cellar action, and the consequence is not
// a degraded feature — it is a DIFFERENT OPERATION:
//
//   "save" → `gdriveSave(tk)`: a full CELLAR backup, manual-file rotation,
//            `cave-autosave-ts` stamped, `markExported()`, status "✓ OK".
//            The user asked to save their catalogue and got a cellar backup,
//            under a success message, with the catalogue never uploaded.
//   "list" → falls through the three one-shot markers (delete / cloud-check /
//            sync-diag — the catalogue leaves none) to `runSyncDiagnostic`:
//            the backups panel, catalogue never fetched.
//
// This is the THIRD instance of the class. The dispatcher's own comment
// enumerates "FOUR buttons can now issue a 'list' redirect"; the catalogue
// restore was the fifth and left no marker. The two before it were the 🗑
// resuming under "restore" (which opened the DESTRUCTIVE picker) and
// « Vérifier les sauvegardes » resuming under "list" (which opened the
// backups list).
//
// THE FIX IS A DISTINCT ACTION PER OPERATION, not a fifth one-shot marker.
// The markers exist because three buttons genuinely share the "list my cloud
// files" operation and differ only in what to do with the result. A catalogue
// save is not a cellar save with a flag on it. `"restore-cnb"` is the
// precedent, added for exactly this reason: "the pre-existing `restore` action
// opens the full picker; this one resumes the direct restore-by-id flow".
// Overloading an action and disambiguating it out-of-band is the shape that
// produced all three bugs.
//
// WHY NOTHING CAUGHT IT: every one of the nine hook cases above passes "tok"
// as `preToken`, so `getCloudToken` is never reached at all.
describe("the catalogue buttons ask for their OWN OAuth action", () => {
  it("neither borrows a cellar action", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/hooks/useGdriveSync.ts", "utf8")
      // Comments name these actions while explaining the defect; a source
      // assertion that reads its own explanation is the trap this repo has
      // hit three times.
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

    function body(fn: string): string {
      const at = src.indexOf("function " + fn + "(");
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      // To the next top-level `function ` declaration.
      const next = src.indexOf("\n  function ", at + 10);
      return src.slice(at, next > at ? next : at + 4000);
    }

    expect(body("catalogueCloudSave")).toContain('getCloudToken("cat-save")');
    expect(body("catalogueCloudSave"), "a catalogue save must not resume as a CELLAR save")
      .not.toContain('getCloudToken("save")');
    expect(body("catalogueCloudRestore")).toContain('getCloudToken("cat-restore")');
    expect(body("catalogueCloudRestore"), "a catalogue fetch must not resume as the backups panel")
      .not.toContain('getCloudToken("list")');
  });

  it("both actions survive the fail-closed whitelists, on BOTH providers", async () => {
    // The whitelist is the single source of truth for "what were we doing".
    // An action it rejects is dropped silently, which would turn the fix into
    // a button that does nothing at all on iOS.
    const { processOAuthReturn } = await import("../utils/oauthReturn.ts");
    const { isValidDropboxAction } = await import("../utils/dropboxAuthCore.ts");

    expect(isValidDropboxAction("cat-save")).toBe(true);
    expect(isValidDropboxAction("cat-restore")).toBe(true);
    // Non-vacuity: the validator still refuses anything not on the list.
    expect(isValidDropboxAction("cat-wipe")).toBe(false);

    for (const ac of ["cat-save", "cat-restore"]) {
      localStorage.setItem("gdrive-pending", ac);
      localStorage.setItem("gdrive-state", "st");
      const w: any = {
        location: { hash: "#access_token=tk&state=st", href: "https://x/", pathname: "/", search: "" },
        history: { replaceState: vi.fn() },
        localStorage,
      };
      processOAuthReturn(w as Window);
      expect(w.__PENDING_GDRIVE_ACTION__, `${ac} was dropped by the whitelist`).toBe(ac);
      expect(w.__PENDING_GDRIVE_TOKEN__).toBe("tk");
    }
  });

  // The fetch mock is discriminated BY URL rather than by `mockResolvedValueOnce`
  // ordering: mounting the hook can fire the launch cloud-check or the silent
  // refresh, and a `once` queue silently hands those responses to the wrong
  // caller. That cost a debugging round here.
  function routeFetch(over: Record<string, any> = {}) {
    mockFetch.mockImplementation((url: any, init?: any) => {
      const u = String(url);
      if (u.indexOf("/upload/drive") >= 0) {
        uploads.push((init && init.body) || null);
        return Promise.resolve({ ok: true, json: async () => ({ id: "cat-1" }) });
      }
      if (u.indexOf("?alt=media") >= 0) {
        return Promise.resolve({ ok: true, text: async () => over.csv || "brand_key,blend_name\nX,Y\n" });
      }
      if (u.indexOf("/drive/v3/files?") >= 0) {
        return Promise.resolve({ ok: true, json: async () => ({ files: over.files || [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" });
    });
  }
  let uploads: any[] = [];

  /** The uploaded file name, out of the Drive multipart body.
   *  It is a FormData whose `metadata` part is a Blob of JSON — the only
   *  place the name appears, and the whole question this case asks. */
  async function uploadedNames(): Promise<string> {
    const out: string[] = [];
    for (const b of uploads) {
      if (b && typeof b.get === "function") {
        const meta = b.get("metadata");
        if (meta && typeof meta.text === "function") out.push(await meta.text());
      } else if (b) out.push(String(b));
    }
    return out.join(" ");
  }

  it("resuming 'cat-save' uploads the CATALOGUE, not a cellar backup", async () => {
    uploads = [];
    (window as any).__PENDING_GDRIVE_ACTION__ = "cat-save";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "tk";
    routeFetch();
    renderHook(() => useGdriveSync(props()));

    // NOT asserted: that Settings stays shut. `useGdriveAuth`'s capture opens
    // it for every action but `reconnect`/`autosave`, and for the catalogue
    // that is RIGHT — the panel and its `catalogueCloudStatus` line live in
    // Réglages → Données, so the user must land where the answer appears.
    // The first version of this case asserted the opposite and was wrong.
    //
    // What identifies the defect is WHICH FILE goes up.
    await vi.waitFor(() => { expect(uploads.length).toBeGreaterThan(0); });
    // The multipart body carries the file name — which is the whole question:
    // did the CATALOGUE go up, or a cellar backup?
    const body = await uploadedNames();
    expect(body).toContain(GDRIVE_CATALOGUE_PREFIX);
    expect(body, "a CELLAR backup was uploaded instead").not.toContain(GDRIVE_FILE_PREFIX + "2");
    expect(catalogueGetCsv, "the catalogue was never read").toHaveBeenCalled();
  });

  it("resuming 'cat-restore' fetches the CATALOGUE, not the backups panel", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "cat-restore";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "tk";
    routeFetch({ files: [
      { id: "c1", name: makeCatalogueName("ma-cave.csv"), modifiedTime: "2026-08-20T00:00:00Z" },
    ] });
    renderHook(() => useGdriveSync(props()));

    await vi.waitFor(() => { expect(catalogueSave).toHaveBeenCalled(); });
    // And the cache is dropped, or the app answers from the previous
    // catalogue for the rest of the session.
    expect(tobaccoDbInvalidate).toHaveBeenCalled();
  });
});
