// An export button tapped twice must produce ONE artifact — and the ZIP
// path must not inject a second copy of the JSZip <script>.
//
// THE TWO MECHANISMS, because they fail differently.
//
// (a) THE SCRIPT. `doBackupZip` checks `window.JSZip` and, when absent,
// appends a cdnjs <script> whose `onload` is `_runZip`. Two taps before the
// CDN answers appended TWO tags; both loaded, both fired `onload`, so
// `_runZip` ran twice — two full in-memory ZIPs with every photo, and two
// `dlFile` calls. On iOS the second `navigator.share` rejects with
// `InvalidStateError` (a share is already in flight) and that is NOT
// `AbortError`, so `dlFile` falls through to the anchor download: the user
// gets a share sheet AND a file on disk from one intent.
//
// (b) THE ACTION. Even with JSZip already in memory, nothing stopped a
// second `_runZip` / `doExport` from starting beside the first.
//
// The guard must RELEASE on failure as well as on success, or one broken
// export disables the button for the rest of the session — which is why the
// non-vacuity cases here matter as much as the positive ones.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useExportImport } from "../hooks/useExportImport";
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

// Minimal stand-in for the CDN library: enough surface for `_runZip`.
function fakeJSZip() {
  function Z(this: any) {}
  Z.prototype.file = function () {};
  Z.prototype.folder = function () {
    return { file: function () {} };
  };
  Z.prototype.generateAsync = function () {
    return Promise.resolve(new Blob(["zip"]));
  };
  return Z;
}

var appended: any[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  appended = [];
  (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  // Capture the injected <script> instead of letting it reach the DOM: the
  // test needs to fire `onload` by hand, and a real appendChild would leave
  // a cdnjs tag in the document for every later file.
  vi.spyOn(document.head, "appendChild").mockImplementation(function (n: any) {
    appended.push(n);
    return n;
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).JSZip;
});

describe("doBackupZip — the JSZip <script> is injected once", () => {
  it("two taps before the CDN answers append ONE script and build ONE zip", async () => {
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => {
      result.current.doBackupZip();
      result.current.doBackupZip();
    });
    const scripts = appended.filter((n) => String(n.tagName).toLowerCase() === "script");
    expect(scripts).toHaveLength(1);

    // The one load must start exactly one ZIP build.
    (window as any).JSZip = fakeJSZip();
    await act(async () => {
      scripts[0].onload();
    });
    expect(props.withPhotos).toHaveBeenCalledTimes(1);
  });

  // NON-VACUITY for the script guard: a load that FAILS must not leave the
  // button dead — the user's remedy for a CDN blip is to tap again.
  it("a failed script load re-arms, so the next tap injects a fresh script", async () => {
    const alertSpy = vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => { result.current.doBackupZip(); });
    const first = appended.filter((n) => String(n.tagName).toLowerCase() === "script");
    expect(first).toHaveLength(1);
    act(() => { first[0].onerror(); });
    expect(alertSpy).toHaveBeenCalled();

    act(() => { result.current.doBackupZip(); });
    expect(appended.filter((n) => String(n.tagName).toLowerCase() === "script")).toHaveLength(2);
  });
});

describe("doBackupZip — re-entry with JSZip already loaded", () => {
  it("two taps build ONE zip", async () => {
    (window as any).JSZip = fakeJSZip();
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    act(() => {
      result.current.doBackupZip();
      result.current.doBackupZip();
    });
    expect(props.withPhotos).toHaveBeenCalledTimes(1);
  });

  // NON-VACUITY: the ordinary path — one export, then another later.
  it("a second tap AFTER the first finishes builds a second zip", async () => {
    (window as any).JSZip = fakeJSZip();
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doBackupZip(); });
    await waitFor(() => expect(props.withPhotos).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalled());
    await act(async () => { result.current.doBackupZip(); });
    await waitFor(() => expect(props.withPhotos).toHaveBeenCalledTimes(2));
  });

  // NON-VACUITY for the failure path: a rejected withPhotos (broken photo
  // store) must re-arm, or the diagnosis "my ZIP button stopped working"
  // replaces the honest "my photo store is unreadable".
  it("a failed zip re-arms the button", async () => {
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    (window as any).JSZip = fakeJSZip();
    const withPhotos = vi
      .fn()
      .mockRejectedValueOnce(new Error("IDB broken"))
      .mockImplementation((d: any) => Promise.resolve(d));
    const props = makeProps({ withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doBackupZip(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.doBackupZip(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalledTimes(2));
  });
});

describe("doExport — re-entry", () => {
  it("two taps produce ONE file", async () => {
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => {
      result.current.doExport();
      result.current.doExport();
    });
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(props.withPhotos).toHaveBeenCalledTimes(1);
  });

  // NON-VACUITY: exporting twice in a row, the ordinary way, still works.
  it("a second tap AFTER the first finishes produces a second file", async () => {
    const props = makeProps();
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doExport(); });
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.doExport(); });
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledTimes(2));
  });

  // NON-VACUITY for the failure path.
  it("a failed export re-arms the button", async () => {
    vi.spyOn(globalThis, "alert" as any).mockImplementation(() => {});
    const withPhotos = vi
      .fn()
      .mockRejectedValueOnce(new Error("IDB broken"))
      .mockImplementation((d: any) => Promise.resolve(d));
    const props = makeProps({ withPhotos });
    const { result } = renderHook(() => useExportImport(props as any));
    await act(async () => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.doExport(); });
    await waitFor(() => expect(withPhotos).toHaveBeenCalledTimes(2));
  });
});
