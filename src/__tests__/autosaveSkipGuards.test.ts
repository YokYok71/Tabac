// The two refusals added to the cloud auto-save (gdriveSaveQuiet), driven the
// way autosaveSilentFailure.test.ts drives it: a token present, a fetch that
// would accept the upload — and the guard must stop BEFORE any upload.
//  - the last LOCAL write failed: disk holds an older cellar than memory, so
//    uploading it and declaring « synchronisé » would be a lie;
//  - the local cellar was unreadable at launch and set aside: the app runs on
//    an empty cellar, which must not replace the cloud auto copy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGdriveSync, readAutosaveDiag } from "../hooks/useGdriveSync.ts";
import { setLocalWriteFailed } from "../utils/localWriteState.ts";
import { translate } from "../i18n.ts";

const t = (k: string) => translate("fr", k);
const EMPTY = JSON.stringify({ tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [], nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1 });
const FULL = JSON.stringify({ tobaccos: [{ id: 1, name: "T", brand: "B", lots: [] }], pipes: [], accessories: [], sessions: [], wishlist: [], nxT: 2, nxP: 1, nxA: 1, nxJ: 1, nxW: 1 });

function props() {
  return {
    cloudProviderId: "gdrive",
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    t, lang: "fr",
    setSaveError: vi.fn(), setSaveWarn: vi.fn(),
    stageImport: vi.fn(), pendingSync: true, setPendingSync: vi.fn(),
    markExported: vi.fn(), imgLocal: {}, setImgLocal: vi.fn(),
    setImportModal: vi.fn(), setSettingsTab: vi.fn(), setPhotoErr: vi.fn(),
  };
}

let fetchMock: any;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocalWriteFailed(false);
  localStorage.setItem("cave-autosave", "1");
  sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3600e3 }));
  localStorage.setItem("gdrive-auto-fid", "F1");
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ files: [], id: "F1" }) });
  (globalThis as any).fetch = fetchMock;
});

async function runOnce() {
  const p = props();
  const { result } = renderHook(() => useGdriveSync(p as any));
  await act(async () => { await (result.current as any).gdriveSaveQuiet(); });
  return p;
}
const uploads = () => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).indexOf("upload") >= 0).length;

describe("the cloud auto-save refuses to upload", () => {
  it("while the last local write failed", async () => {
    localStorage.setItem("pipe-cellar-v6", FULL);
    setLocalWriteFailed(true);
    const p = await runOnce();
    expect(readAutosaveDiag()!.stage).toBe("skip-local-write-failed");
    expect(uploads()).toBe(0);
    expect(p.setPendingSync).not.toHaveBeenCalledWith(false);
  });

  it("an EMPTY cellar while an unreadable one is set aside", async () => {
    localStorage.setItem("pipe-cellar-v6", EMPTY);
    localStorage.setItem("pipe-cellar-v6-unreadable", "{\"tobaccos\":[{");
    await runOnce();
    expect(readAutosaveDiag()!.stage).toBe("skip-unreadable");
    expect(uploads()).toBe(0);
  });

  it("but a cellar with data again is uploaded normally (the guard is not a lock)", async () => {
    localStorage.setItem("pipe-cellar-v6", FULL);
    localStorage.setItem("pipe-cellar-v6-unreadable", "{\"tobaccos\":[{");
    await runOnce();
    expect(readAutosaveDiag()!.stage).not.toBe("skip-unreadable");
  });
});
