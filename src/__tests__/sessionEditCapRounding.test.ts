import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../hooks/useSessionStore";
import { roundWeightToUnit } from "../utils/lotUtils";

// The same-lot EDIT path caps the new weight against `current + ow` — a SUM of
// two grid values, which is NOT itself a grid value. `0.1 + 2.7` is
// 2.8000000000000003 in IEEE-754, and the cap result was stored with a bare
// `String(nw)`, so the journal rendered `2,8000000000000003g` and the CSV
// export wrote it verbatim. Every OTHER weight in the store goes through
// `roundWeightToUnit`; the cap was the one arithmetic result that did not.
//
// `_persistSession`'s cap is `Math.min(w, safeW(lot.weightG))` — no addition,
// so it can only ever return one of two values that are already on the grid.
// The edit path is the only one that adds.

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: "lot-1",
    status: "jar",
    weightG: "100",
    dateOpened: "2025-01-01",
    dateFinished: "",
    disposed: false,
    ...overrides,
  };
}

function hookDeps(data: any, save: any, weightUnit = "g") {
  return { data, save, nav: vi.fn(), weightUnit };
}

describe("updateSession — the same-lot cap lands on the weight grid", () => {
  it("does not store float noise when current + old weight is not representable", () => {
    // The reproduction, verbatim: a jar lot with 0.1 g left plus an existing
    // 2.7 g session, edited to 9 g. avail = 0.1 + 2.7 = 2.8000000000000003.
    expect(0.1 + 2.7).not.toBe(2.8); // the premise, pinned

    const lot = makeLot({ weightG: "0.1" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "2.7" };
    const data = { tobaccos: [tob], sessions: [oldSession], nxJ: 1 };
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save)));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "9",
      }));
    });
    act(() => { result.current.updateSession(); });

    const saved = save.mock.calls[0]![0];
    const stored = saved.sessions[0].weightG;
    expect(stored).toBe("2.8");
    // The defect as the user meets it: a 19-character weight in the journal.
    expect(stored.length).toBeLessThanOrEqual(6);
    // And the lot is emptied exactly, not left holding a negative-zero sliver.
    expect(saved.tobaccos[0].lots[0].weightG).toBe("0");
  });

  it("rounds the cap on the oz grid too (2 dp, not 1)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 — the same class, one grid finer.
    expect(0.1 + 0.2).not.toBe(0.3);
    const lot = makeLot({ weightG: "0.1" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "0.2" };
    const data = { tobaccos: [tob], sessions: [oldSession], nxJ: 1 };
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save, "oz")));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "5",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(save.mock.calls[0]![0].sessions[0].weightG).toBe("0.3");
  });

  // NON-VACUITY: the fix must not flatten an ordinary edit. A weight BELOW the
  // cap is never touched by it, and one that is already on the grid keeps its
  // exact value — a rounding fix that changed either of these would be a
  // regression, not a fix.
  it("leaves an uncapped edit exactly as the user typed it", () => {
    const lot = makeLot({ weightG: "80" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "10" };
    const data = { tobaccos: [tob], sessions: [oldSession], nxJ: 1 };
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save)));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "2.5",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("2.5");
    // 80 + 10 − 2.5
    expect(saved.tobaccos[0].lots[0].weightG).toBe("87.5");
  });

  it("still caps: a weight above the restored balance is clamped to it", () => {
    const lot = makeLot({ weightG: "1" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "2" };
    const data = { tobaccos: [tob], sessions: [oldSession], nxJ: 1 };
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save)));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 5, lotId: "lot-1", weightG: "99",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(save.mock.calls[0]![0].sessions[0].weightG).toBe("3");
  });
});

describe("roundWeightToUnit — the grid the cap must land on", () => {
  it("is idempotent on a value already on the grid", () => {
    // Guards the fix itself: applying the rounding to an in-grid cap result
    // must be a no-op, or the two cases above would pass for the wrong reason.
    expect(roundWeightToUnit(2.8, "g")).toBe(2.8);
    expect(roundWeightToUnit(0.3, "oz")).toBe(0.3);
  });
});
