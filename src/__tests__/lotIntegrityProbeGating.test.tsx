// regression lock for the useLotIntegrityProbe stale-closure bug.
//
// The probe was `useEffect(fn, [])` reading `data` from the mount-time
// closure. The initial state is INIT (empty) and load() is
// async, so the 1.5 s timer always saw the empty snapshot: the probe never
// surfaced real corruption, and — worse — when a persisted diagnostic counter
// existed it ran checkAllInvariants(INIT) → [] → clearDiagnostic() on EVERY
// launch, silently standing down a live diagnostic. The fix gates on
// `loading === false` and reads the latest data via a ref (same shape as
// useOrphanPhotoGC). This test mounts the REAL hook.

import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLotIntegrityProbe } from "../hooks/useLotIntegrityProbe.ts";

const { state } = vi.hoisted(() => ({
  state: { assert: [] as any[], checkAll: [] as any[], clear: 0, diagCount: 0, violations: [] as any[] },
}));
vi.mock("../utils/lotInvariants.ts", () => ({
  assertLotInvariants: (d: any) => { state.assert.push(d); },
  checkAllInvariants: (d: any) => { state.checkAll.push(d); return state.violations; },
}));
vi.mock("../utils/diagnostic.ts", () => ({
  getDiagnosticSnapshot: () => ({ count: state.diagCount }),
  clearDiagnostic: () => { state.clear++; },
}));

beforeEach(() => {
  state.assert.length = 0; state.checkAll.length = 0; state.clear = 0;
  state.diagCount = 0; state.violations = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function Harness({ data, loading }: { data: any; loading: boolean }) {
  useLotIntegrityProbe(data, loading);
  return null;
}

const INIT = { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] };
const LOADED = { tobaccos: [{ id: 1, lots: [] }], pipes: [], wishlist: [], accessories: [], sessions: [] };

describe("useLotIntegrityProbe gating", () => {
  it("does NOT run while loading=true, even past the 1.5s timer", () => {
    state.diagCount = 3;
    render(<Harness data={INIT} loading={true} />);
    vi.advanceTimersByTime(10_000);
    expect(state.assert).toHaveLength(0);
    expect(state.checkAll).toHaveLength(0);
    expect(state.clear).toBe(0);
  });

  it("runs assertLotInvariants against the LOADED data once loading flips false", () => {
    const { rerender } = render(<Harness data={INIT} loading={true} />);
    vi.advanceTimersByTime(10_000);
    expect(state.assert).toHaveLength(0);
    rerender(<Harness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);
    expect(state.assert).toHaveLength(1);
    expect(state.assert[0]).toBe(LOADED); // NOT the empty INIT snapshot
  });

  it("does NOT wrongly clear a live diagnostic — checks the LOADED data, keeps the counter when violations remain", () => {
    state.diagCount = 2;
    state.violations = [{ code: "x" }]; // LOADED still violates
    render(<Harness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);
    expect(state.checkAll[0]).toBe(LOADED); // ran on real data, not INIT
    expect(state.clear).toBe(0);            // counter NOT stood down
  });

  it("clears a stale counter only when the LOADED data is genuinely clean", () => {
    state.diagCount = 2;
    state.violations = []; // clean
    render(<Harness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);
    expect(state.clear).toBe(1);
  });

  // An earlier release audit — the half of the fix that was never exercised.
  //
  // An earlier release was TWO changes: gate on `loading`, and read the latest data
  // through a ref instead of the effect's closure. The cases above lock the
  // gate; none of them can see the ref, because every one of them flips
  // `loading` and swaps `data` in the SAME rerender — at which point the
  // effect's own closure already holds LOADED and reading it directly gives
  // the right answer. Replacing `dataRef.current` with the closure `data` —
  // The bug verbatim — left all 3760 tests green.
  //
  // Separating the two moves is what exposes it: mount already loaded but with
  // the shell still in state (which is exactly the real sequence — App flips
  // `loading` off as `setData` lands, and React may render the two in either
  // order), then let the real cellar arrive before the 1.5 s timer fires. The
  // consequence of getting it wrong is not cosmetic: `checkAllInvariants(INIT)`
  // comes back empty, so a live diagnostic is stood down on every launch and
  // real corruption stops being reported. Mirrors the case
  // imgGcGating.test.tsx has carried for its sibling.
  it("reads the LATEST data via ref — data arriving after the effect ran still counts", () => {
    const { rerender } = render(<Harness data={INIT} loading={false} />);
    // The effect has already scheduled its timer against the INIT snapshot.
    vi.advanceTimersByTime(500);
    expect(state.assert).toHaveLength(0);
    // load() resolves a beat later: same `loading`, new `data`.
    rerender(<Harness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);
    expect(state.assert).toHaveLength(1);
    expect(state.assert[0]).toBe(LOADED); // NOT the INIT the closure captured
  });

  it("does not stand down a live diagnostic using the pre-load snapshot", () => {
    // The nastier face of the same bug: with a persisted counter, the probe
    // takes the checkAllInvariants branch. Against INIT that returns clean and
    // clears the counter — silently hiding corruption the user does have.
    state.diagCount = 2;
    state.violations = [{ code: "lot-balance-overflow" }]; // LOADED is dirty
    const { rerender } = render(<Harness data={INIT} loading={false} />);
    vi.advanceTimersByTime(500);
    rerender(<Harness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(1_500);
    expect(state.checkAll[0]).toBe(LOADED);
    expect(state.clear).toBe(0);
  });
});
