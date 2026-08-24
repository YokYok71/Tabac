// THE CELLAR SITS IN A BUDGET NOTHING WAS MEASURING.
//
// `useStorageQuotaWarning` probes `navigator.storage.estimate()`, which reports
// the ORIGIN quota — the one IndexedDB (the photo store) spends. The cellar
// itself lives in `localStorage`, which has its own ~5 MB sub-quota that the
// StorageManager commonly does not account for at all. The hook's own comment
// conceded this ("estimate() commonly excludes localStorage"); what was never
// measured is HOW CLOSE a real collection already is.
//
// MEASURED in Chromium by filling localStorage to failure:
//   hard ceiling before QuotaExceededError   5 200 000 chars
//   a serious collector's cellar             2 899 338 chars  = 55.8 % of it
//   navigator.storage.estimate() at that moment   0.112 % of 1049 MB
//
// So the guard was watching a budget three orders of magnitude away from the
// one that actually fails. And the failure is worse than a refused write:
// `save()` calls `setData(nd)` BEFORE `appStorage.set`, and the QuotaExceeded
// retry migrates inline photos — of which a modern cellar has none, they are
// already `local-photo-*` keys — so the user sees "Stockage trop plein" while
// the edit stays in memory and IS GONE on the next launch.
//
// The fix measures the payload the app already has in hand at save time. The
// origin probe STAYS: it is the right measurement for the photo store, and the
// two budgets are independent — the guard now warns on whichever is worse.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useStorageQuotaWarning } from "../hooks/useStorageQuotaWarning.ts";
import { LOCALSTORAGE_BUDGET_CHARS } from "../constants.ts";

function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const HEALTHY = { usage: 1.18 * 1024 * 1024, quota: 1049 * 1024 * 1024 };  // 0.112 %

// A REAL template, not a key-returning `t`. The shared harness's `mockT` gives
// back the key, and under it `{pct}` never interpolates — so an assertion on
// the reported number would read identically whatever the code computed.
const T = (k: string) => k === "warn_storage_high"
  ? "Stockage à {pct}% ({used} Mo / {quota} Mo). Pensez à exporter." : k;

function withEstimate(est: any | null) {
  const nav: any = navigator;
  if (est === null) { delete nav.storage; return; }
  nav.storage = { estimate: () => Promise.resolve(est) };
}

function run(cellarChars: number, est: any | null = HEALTHY) {
  withEstimate(est);
  const setSaveWarn = vi.fn();
  const r = renderHook(() => useStorageQuotaWarning(
    { tobaccos: [] }, "fr", T, setSaveWarn, cellarChars,
  ));
  return { setSaveWarn, ...r };
}

const realStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  localStorage.clear();
  if (realStorage) Object.defineProperty(navigator, "storage", realStorage);
  else delete (navigator as any).storage;
});

describe("the cellar's own budget is measured", () => {
  it("warns on a large cellar even though the origin estimate is healthy", async () => {
    // The whole point: 0.112 % of the origin quota, 88 % of the one that fails.
    const { setSaveWarn } = run(Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.88));
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
    expect(String(setSaveWarn.mock.calls[0]![0])).toContain("88");
  });

  it("stays silent on a cellar that is nowhere near it", async () => {
    // Non-vacuity: a guard that warned unconditionally would pass the case
    // above and cry wolf on every launch.
    const { setSaveWarn } = run(Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.10));
    await new Promise((r) => setTimeout(r, 5));
    const raised = setSaveWarn.mock.calls.filter((c) => c[0]);
    expect(raised).toHaveLength(0);
  });

  it("a real collector's cellar (2.9 M chars) is still under the bar", async () => {
    // The measured figure, pinned so the threshold cannot be tightened into
    // permanent noise for a cellar that is merely large.
    const { setSaveWarn } = run(2_899_338);
    await new Promise((r) => setTimeout(r, 5));
    expect(setSaveWarn.mock.calls.filter((c) => c[0])).toHaveLength(0);
  });

  it("runs even when the browser has no storage.estimate at all", async () => {
    // The payload check must not be gated on the origin probe: the hook used
    // to `return` before doing anything when `estimate` was missing, so on
    // such a browser NOTHING was measured.
    const { setSaveWarn } = run(Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.9), null);
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
  });

  it("survives an estimate() that rejects", async () => {
    const nav: any = navigator;
    nav.storage = { estimate: () => Promise.reject(new Error("denied")) };
    const setSaveWarn = vi.fn();
    renderHook(() => useStorageQuotaWarning(
      { tobaccos: [] }, "fr", T, setSaveWarn, Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.9),
    ));
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
  });
});

describe("the ORIGIN probe is not lost", () => {
  it("a full origin quota still warns, with a small cellar", async () => {
    // The photo store is the thing this hook was written for; the cellar
    // budget is a SECOND measurement, not a replacement.
    const { setSaveWarn } = run(1000, { usage: 90 * 1024 * 1024, quota: 100 * 1024 * 1024 });
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
    expect(String(setSaveWarn.mock.calls[0]![0])).toContain("90");
  });

  it("when both are high, the WORSE one is what the user is told", async () => {
    // Reporting the milder of the two would understate the risk and point at
    // the wrong remedy.
    const { setSaveWarn } = run(Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.95),
      { usage: 85 * 1024 * 1024, quota: 100 * 1024 * 1024 });
    await waitFor(() => expect(setSaveWarn).toHaveBeenCalled());
    expect(String(setSaveWarn.mock.calls[0]![0])).toContain("95");
  });
});

describe("the dismissal and the clear still work on the new axis", () => {
  it("a 7-day dismissal suppresses the cellar warning too", async () => {
    localStorage.setItem("cave-quota-warn-dismissed", String(Date.now()));
    const { setSaveWarn } = run(Math.round(LOCALSTORAGE_BUDGET_CHARS * 0.95));
    await new Promise((r) => setTimeout(r, 5));
    expect(setSaveWarn.mock.calls.filter((c) => c[0])).toHaveLength(0);
  });

  it("dropping back under the bar clears the dismissal", async () => {
    localStorage.setItem("cave-quota-warn-dismissed", String(Date.now()));
    run(1000);
    await waitFor(() => expect(localStorage.getItem("cave-quota-warn-dismissed")).toBe(null));
  });
});

describe("the wiring — the length comes from the string save() already built", () => {
  const app = blankComments(readFileSync("src/App.tsx", "utf8"));

  it("save() records the serialized length it is about to write", () => {
    // Re-stringifying inside the hook would double a cost measured at
    // 13-15 ms on a large cellar, on every data change.
    expect(app).toMatch(/setCellarChars\(json\.length\)/);
  });

  it("the load path seeds it, so the very first launch is measured too", () => {
    expect(app).toMatch(/setCellarChars\(\s*(?:String\()?r\.value/);
  });

  it("and the hook is handed it", () => {
    expect(app).toMatch(/useStorageQuotaWarning\(data, lang, t, setSaveWarn, cellarChars\)/);
  });

  it("the budget is a named constant, not a literal at the call site", () => {
    const consts = blankComments(readFileSync("src/constants.ts", "utf8"));
    expect(consts).toMatch(/export var LOCALSTORAGE_BUDGET_CHARS/);
    expect(LOCALSTORAGE_BUDGET_CHARS).toBeGreaterThan(1_000_000);
    expect(LOCALSTORAGE_BUDGET_CHARS,
      "must stay UNDER the 5.2 M chars measured in Chromium").toBeLessThanOrEqual(5_200_000);
  });
});
