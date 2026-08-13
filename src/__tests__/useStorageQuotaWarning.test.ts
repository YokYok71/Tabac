import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useStorageQuotaWarning } from "../hooks/useStorageQuotaWarning";

// The "usage came back below 80%" branch must
// only clear a warning THIS hook raised — never the save() QuotaExceeded
// migration warning, which shares setSaveWarn. estimate() commonly excludes
// localStorage, so the origin ratio can read < 0.8 in the exact tick the
// migration (localStorage's own ~5MB sub-quota overflowed) raised its
// actionable "back up before writes fail" prompt.

function mockEstimate(usage: number, quota: number) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { estimate: vi.fn().mockResolvedValue({ usage, quota }) },
  });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStorageQuotaWarning", () => {
  it("raises the warning when usage >= 80%", async () => {
    mockEstimate(90, 100);
    const setSaveWarn = vi.fn();
    renderHook(() => useStorageQuotaWarning({ tobaccos: [] }, "fr", (k) => k, setSaveWarn));
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
    // Raised with a non-empty message (the localised warn_storage_high key).
    expect(setSaveWarn.mock.calls.every((c) => c[0] !== "")).toBe(true);
  });

  it("does NOT clear a warning it did not raise (protects the migration warning)", async () => {
    // Origin quota reads healthy (< 80%) — the migration fired on localStorage's
    // separate sub-quota, which estimate() doesn't see.
    mockEstimate(5, 100);
    const setSaveWarn = vi.fn();
    renderHook(() => useStorageQuotaWarning({ tobaccos: [] }, "fr", (k) => k, setSaveWarn));
    // Give the async estimate().then a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    // Since this hook never raised (ratio < 0.8 from the start), it must not
    // call setSaveWarn("") — the migration warning stays on screen.
    expect(setSaveWarn).not.toHaveBeenCalledWith("");
  });

  it("clears its OWN warning once usage drops back below 80%", async () => {
    // First render at 90% → raises. Rerender at 5% → clears (own warning).
    const setSaveWarn = vi.fn();
    mockEstimate(90, 100);
    const { rerender } = renderHook(
      ({ d }) => useStorageQuotaWarning(d, "fr", (k) => k, setSaveWarn),
      { initialProps: { d: { tobaccos: [{ id: 1 }] } } },
    );
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
    setSaveWarn.mockClear();
    mockEstimate(5, 100);
    rerender({ d: { tobaccos: [{ id: 2 }] } }); // new data ref re-fires the effect
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalledWith(""));
  });

  // The DISMISSAL moved here for the same reason the clearing branch
  // was given `raisedRef`. The banner's × used to write
  // `cave-quota-warn-dismissed` unconditionally, and `saveWarn` is a SHARED
  // channel: the tasting auto-end notice rides it, so closing
  // « Dégustation clôturée automatiquement après 95 min » silenced the
  // "storage is 80 % full" warning for SEVEN DAYS, with nothing said.
  describe("the dismissal is owned by the hook", () => {
    it("records the 7-day suppression when it raised the banner", async () => {
      mockEstimate(90, 100);
      const setSaveWarn = vi.fn();
      const { result } = renderHook(() =>
        useStorageQuotaWarning({ tobaccos: [] }, "fr", (k) => k, setSaveWarn));
      await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
      result.current();
      const stamped = parseInt(localStorage.getItem("cave-quota-warn-dismissed") || "0");
      expect(stamped).toBeGreaterThan(0);
      expect(Date.now() - stamped).toBeLessThan(1000);
    });

    it("records NOTHING when the banner on screen is someone else's", async () => {
      // Origin quota healthy — this hook never raised. The notice being closed
      // is the tasting auto-end (or the save() migration), which must not cost
      // the user a week of storage warnings.
      mockEstimate(5, 100);
      const setSaveWarn = vi.fn();
      const { result } = renderHook(() =>
        useStorageQuotaWarning({ tobaccos: [] }, "fr", (k) => k, setSaveWarn));
      await new Promise((r) => setTimeout(r, 0));
      result.current();
      expect(localStorage.getItem("cave-quota-warn-dismissed")).toBeNull();
    });

    it("does not re-arm the suppression on a second close of the same banner", async () => {
      mockEstimate(90, 100);
      const setSaveWarn = vi.fn();
      const { result } = renderHook(() =>
        useStorageQuotaWarning({ tobaccos: [] }, "fr", (k) => k, setSaveWarn));
      await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
      result.current();
      const first = localStorage.getItem("cave-quota-warn-dismissed");
      localStorage.removeItem("cave-quota-warn-dismissed");
      result.current();
      expect(first).toBeTruthy();
      expect(localStorage.getItem("cave-quota-warn-dismissed")).toBeNull();
    });
  });
});
