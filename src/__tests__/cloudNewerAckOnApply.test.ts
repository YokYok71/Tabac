// Tapping « Restaurer » on the newer-cloud-backup banner and then CANCELLING
// the picker must not silence that backup for ever.
//
// THE DEFECT. `_executeCloudNewerRestore` called `ackCloudNewerBackup` as soon
// as the download parsed — before `stageImport` had even opened the
// Replace / Merge picker. The ack writes the persistent dismissed markers
// (`cave-cloud-newer-dismissed-name-<provider>` above all, which
// `findNewerCloudBackup` matches by NAME regardless of timestamp), so backing
// out of the picker left the app permanently silent about a cloud backup that
// is genuinely newer than anything this device saved. The only way back is
// Réglages → « Vérifier les sauvegardes cloud », which the user has no reason
// to look for: from their side nothing happened at all.
//
// It became reachable when the banner's one-tap restore stopped auto-applying
// and started going through the picker: while the restore was unconditional,
// "downloaded and parsed" and "applied" were the same moment.
//
// THE FIX, and why it is the ack that moves rather than a re-arm on cancel.
// Re-arming would have to RESTORE the previous marker values, which nothing
// captured, and it would leave a window in which the app has already forgotten
// a warning it may still need. Acking on the APPLIED path instead states the
// rule directly: this backup is reconciled once its contents are in the
// cellar, and not before. Cancelling then needs no code at all — the banner
// state was never cleared, so it simply comes back.
//
// The banner does not sit over the picker in the meantime: every `top: 0`
// banner stands down while a modal is open, and `importModal` is one of the
// four states that gate reaches.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportConfirm } from "../hooks/useImportConfirm";
import { useGdriveSync, cloudDismissKeys } from "../hooks/useGdriveSync";

// ── half 1: the picker fires onApplied, on BOTH modes, and never on cancel ──

function importProps(overrides: Record<string, any> = {}) {
  return {
    data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] } as any,
    save: vi.fn(),
    migrateData: (d: any) => d,
    saveApiKey: vi.fn(),
    setImgLocal: vi.fn(),
    setImportModal: vi.fn(),
    nav: vi.fn(),
    ...overrides,
  };
}

const backup = {
  tobaccos: [{ id: 10, brand: "Brackwater", name: "Duskfall", lots: [] }],
  pipes: [], wishlist: [], accessories: [], sessions: [],
};

describe("useImportConfirm — onApplied", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fires after a REPLACE", () => {
    const save = vi.fn();
    const onApplied = vi.fn();
    const { result } = renderHook(() => useImportConfirm(importProps({ save }) as any));
    act(() => { result.current.stageImport(backup, "drive", { onApplied }); });
    expect(onApplied).not.toHaveBeenCalled();
    act(() => { result.current.applyImport("replace"); });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalled();
  });

  // A merge is just as much an acknowledgement of that cloud file: its
  // contents are now in the cellar, so the banner has nothing left to warn
  // about. Wiring only the replace branch would leave the banner nagging for
  // ever after a successful merge — the mirror of the defect.
  it("fires after a MERGE", () => {
    const onApplied = vi.fn();
    const { result } = renderHook(() => useImportConfirm(importProps() as any));
    act(() => { result.current.stageImport(backup, "drive", { onApplied }); });
    act(() => { result.current.applyImport("merge"); });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  // THE CASE THE FIX EXISTS FOR.
  it("does NOT fire when the user cancels the picker", () => {
    const save = vi.fn();
    const onApplied = vi.fn();
    const { result } = renderHook(() => useImportConfirm(importProps({ save }) as any));
    act(() => { result.current.stageImport(backup, "drive", { onApplied }); });
    act(() => { result.current.cancelImport(); });
    expect(onApplied).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  // NON-VACUITY: a caller that wires nothing must still import cleanly —
  // every other stageImport call site passes no `onApplied`.
  it("is optional", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useImportConfirm(importProps({ save }) as any));
    act(() => { result.current.stageImport(backup, "drive"); });
    act(() => { result.current.applyImport("replace"); });
    expect(save).toHaveBeenCalled();
  });
});

// ── half 2: the banner stays armed until the import lands ──

const mockFetch = vi.fn();

function driveProps(overrides: Record<string, any> = {}) {
  return {
    data: { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] } as any,
    t: (k: string) => k,
    lang: "fr",
    stageImport: vi.fn(),
    setImportModal: vi.fn(),
    setImgLocal: vi.fn(),
    markExported: vi.fn(),
    pendingSync: false,
    setPendingSync: vi.fn(),
    cloudProviderId: "gdrive",
    excludeApiKey: true,
    apiKey: "",
    aiProvider: "anthropic",
    driveEncryptionEnabled: false,
    drivePassphrase: "",
    setDrivePassphrase: vi.fn(),
    promptPassphrase: vi.fn(),
    setPhotoErr: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as any).fetch = mockFetch;
});
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("the cloud-newer banner is acked only once the import lands", () => {
  async function armAndRestore() {
    vi.useFakeTimers();
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("cave-autosave-ts", String(Date.now() - 3 * 86400000));
    sessionStorage.setItem("gdrive-tk", JSON.stringify({ t: "tok", x: Date.now() + 3600000 }));
    const newerIso = new Date(Date.now() - 3600000).toISOString();
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        files: [{ id: "remote-file-id", name: "cave-tabac-x-t1-p0-w0-a0-j0.json", modifiedTime: newerIso }],
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
        pipes: [], wishlist: [], accessories: [], sessions: [],
      })),
    });
    const stageImport = vi.fn();
    const { result } = renderHook(() => useGdriveSync(driveProps({ stageImport }) as any));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.cloudNewerBackup).not.toBeNull();
    await act(async () => { result.current.restoreCloudNewerBackup(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    vi.useRealTimers();
    return { result, stageImport };
  }

  it("stages the import WITHOUT writing the dismissed markers", async () => {
    const { result, stageImport } = await armAndRestore();
    expect(stageImport).toHaveBeenCalled();
    // Neither marker is written yet — the user has not decided anything.
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBeNull();
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).toBeNull();
    // …and the banner is still armed, so cancelling the picker leaves the
    // warning intact for the next launch.
    expect(result.current.cloudNewerBackup).not.toBeNull();
  });

  it("passes an onApplied that DOES ack, so a confirmed import silences it", async () => {
    const { result, stageImport } = await armAndRestore();
    const opts = stageImport.mock.calls[0]![2];
    expect(typeof opts?.onApplied, "the ack must reach the picker's success path").toBe("function");
    await act(async () => { opts.onApplied(); });
    expect(localStorage.getItem(cloudDismissKeys(false).name)).toBe("cave-tabac-x-t1-p0-w0-a0-j0.json");
    expect(localStorage.getItem(cloudDismissKeys(false).ts)).not.toBeNull();
    expect(result.current.cloudNewerBackup).toBeNull();
  });
});
