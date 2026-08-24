// A factory reset must not upload the EMPTIED cellar over the user's cloud
// backup.
//
// THE RACE. `resetAll` calls `save(INIT)`, and App's `save` writes the cellar
// to localStorage and sets `pendingSync` — which arms the 1.2 s debounced
// `gdriveSaveQuiet` in useGdriveSync. That quiet save reads the cellar
// straight out of localStorage (by then INIT) and re-checks
// `localStorage["cave-autosave"] === "1"` before uploading, so the ONE thing
// that disarms it is `wipeAppStorage()`.
//
// `wipeAppStorage()` used to run inside the `done` callback, i.e. only after
// an AWAITED `imgCache.clear()`. Clearing a photo store holding hundreds of
// base64 blobs can outlast 1.2 s on a phone — and in that window the flag is
// still set, so the reset uploads an empty cellar and stamps it as the newest
// save. That destroys the one copy that could undo a reset tapped by mistake,
// which is the worst possible outcome for this particular button.
//
// The fix is the ORDER: wipe synchronously, in the same tick as `save`, long
// before any timer can fire. The photo clear still gates the RELOAD, because
// restarting over an in-flight transaction is how the photos survive a wipe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
import { imgCache } from "../utils/imgCache";
import { INIT } from "../constants";

function makeProps(overrides: Record<string, any> = {}) {
  return {
    data: { ...INIT },
    save: vi.fn(),
    withPhotos: vi.fn().mockImplementation((d: any) => Promise.resolve(d)),
    nav: vi.fn(),
    t: (k: string) => k,
    excludeApiKey: false,
    apiKey: "",
    aiProvider: "anthropic",
    weightUnit: "g",
    lengthUnit: "mm",
    currencySymbol: "€",
    ageLabel: () => "",
    stageImport: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("resetAll disarms the cloud auto-save before the photo clear", () => {
  it("cave-autosave is already gone while imgCache.clear is still pending", () => {
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("dropbox-rt", "refresh-token");
    localStorage.setItem("unrelated-app-key", "keep-me");
    // A clear that never resolves stands in for a slow one: the assertion
    // below then runs inside exactly the window the 1.2 s timer fires in.
    vi.spyOn(imgCache, "clear").mockImplementation(function () {
      return new Promise<any>(function () {});
    } as any);

    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });

    expect(localStorage.getItem("cave-autosave")).toBeNull();
    // The wipe is the real sweep, not a targeted removal of one flag.
    expect(localStorage.getItem("dropbox-rt")).toBeNull();
    // NON-VACUITY: a foreign key on the same origin is still left alone —
    // this is `wipeAppStorage`, never `localStorage.clear()`.
    expect(localStorage.getItem("unrelated-app-key")).toBe("keep-me");
  });

  // NON-VACUITY: the reorder must not drop the photo wipe. A reset that
  // leaves every blob in IndexedDB is the defect this ordering could
  // plausibly introduce.
  it("still clears the photo store", () => {
    const clear = vi.spyOn(imgCache, "clear").mockResolvedValue(undefined as any);
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });
    expect(clear).toHaveBeenCalled();
  });

  // NON-VACUITY: the cellar is still emptied in memory, and the confirm is
  // still the only gate.
  it("still saves INIT, and does nothing at all when the confirm is declined", () => {
    vi.spyOn(imgCache, "clear").mockResolvedValue(undefined as any);
    const save = vi.fn();
    const props = makeProps({ save });
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.resetAll(); });
    expect(save).toHaveBeenCalledOnce();

    (window.confirm as any).mockReturnValue(false);
    localStorage.setItem("cave-autosave", "1");
    act(() => { result.current.resetAll(); });
    expect(save).toHaveBeenCalledOnce();
    expect(localStorage.getItem("cave-autosave")).toBe("1");
  });
});
