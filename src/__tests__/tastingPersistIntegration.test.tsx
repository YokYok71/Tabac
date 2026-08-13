// END-TO-END integration lock for the
// 🔴 cold-start data-loss bug.
//
// Unlike src/__tests__/useTastingSession.test.ts (which stubs
// addSessionFromTasting with a vi.fn), this test composes the REAL
// useSessionStore._persistSession + a REAL save closure behind
// useTastingSession, and reproduces the exact App.tsx load() ordering:
//
//   1. Cold mount: `data` is the empty INIT shell, `loading` is true
//      (App renders the instant shell while load() resolves localStorage
//      asynchronously). localStorage already holds the user's REAL cellar.
//   2. load() completes: `loading` flips false and `data` becomes the real
//      cellar.
//
// The bug: with an OVERTIME zombie tasting in localStorage, the auto-end
// effect used to fire during step 1 — persisting a phantom session against
// the empty INIT and calling save(INIT+phantom), which OVERWROTE the on-disk
// cellar before step 2 ever ran. The loading gate makes the auto-end wait for
// step 2, so the real cellar is the reference and the deduction is correct.
//
// This suite would FAIL on the earlier code (a phantom empty-cellar save
// lands during the loading window) and passes on the fix.

import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useSessionStore } from "../hooks/useSessionStore";
import { useTastingSession, TASTING_KEY } from "../hooks/useTastingSession";
import { INIT, SK } from "../constants";

// A tobacco/lot the zombie tasting references, with headroom to deduct from.
function realCellar() {
  return {
    ...INIT,
    tobaccos: [
      {
        id: "T1", brand: "A", name: "X",
        lots: [{ id: "L1", status: "jar", weightG: "50", weightInitial: "50",
                 originalStatus: "jar", dateOpened: "2024-01-01" }],
      },
    ],
    nxJ: 1,
  };
}

function seedOvertimeZombie() {
  localStorage.setItem(
    TASTING_KEY,
    JSON.stringify({
      stage: "running",
      startTs: Date.now() - 6 * 3600 * 1000, // 6 h ≫ 95 min threshold+auto
      pausedAccumMs: 0,
      pauseStartTs: null,
      tobaccoId: "T1", pipeId: "P1", lotId: "L1",
      rating: 0, notes: "", weightG: "3",
    }),
  );
}

// Composes the two hooks exactly as App.tsx does, with a real save closure
// that persists to localStorage (like App's save()).
function Harness({
  data, loading, onSave,
}: { data: any; loading: boolean; onSave: (d: any) => void }) {
  const save = React.useCallback((d: any) => {
    onSave(d);
    try { localStorage.setItem(SK, JSON.stringify(d)); } catch { /* ignore */ }
  }, [onSave]);
  const store = useSessionStore({ data, save, nav: () => {}, weightUnit: "g" });
  useTastingSession({
    addSessionFromTasting: store.addSessionFromTasting,
    nav: () => {},
    data,
    loading,
  });
  return null;
}

beforeEach(() => {
  localStorage.clear();
});

describe("tasting persistence — cold-start load() ordering (🔴 lock)", () => {
  it("does NOT persist a phantom session against INIT while loading, then persists correctly against the real cellar", () => {
    // localStorage holds the user's REAL cellar at launch.
    localStorage.setItem(SK, JSON.stringify(realCellar()));
    seedOvertimeZombie();

    const saves: any[] = [];
    const onSave = (d: any) => saves.push(d);

    // Step 1 — cold mount: instant shell (data=INIT) while load() is pending.
    const { rerender } = render(
      <Harness data={{ ...INIT }} loading={true} onSave={onSave} />,
    );

    // THE regression assertion: no save fired during the loading window, so
    // the on-disk cellar was NOT overwritten by an empty INIT + phantom.
    expect(saves).toHaveLength(0);
    const onDisk1 = JSON.parse(localStorage.getItem(SK)!);
    expect(onDisk1.tobaccos).toHaveLength(1);
    expect(onDisk1.tobaccos[0].lots[0].weightG).toBe("50"); // untouched

    // Step 2 — load() resolved: loading flips false, real cellar in state.
    act(() => {
      rerender(<Harness data={realCellar()} loading={false} onSave={onSave} />);
    });

    // NOW the overtime zombie auto-ends, against the REAL cellar.
    expect(saves.length).toBeGreaterThanOrEqual(1);
    const persisted = saves[saves.length - 1];
    // The real cellar survived — one tobacco, and its lot was DEBITED by 3g
    // (50 → 47), proving the deduction ran against the real lot, not INIT.
    expect(persisted.tobaccos).toHaveLength(1);
    expect(persisted.tobaccos[0].lots[0].weightG).toBe("47");
    // A session was recorded (the 6 h zombie, capped to real minutes).
    expect(persisted.sessions.length).toBeGreaterThanOrEqual(1);
    const sess = persisted.sessions[persisted.sessions.length - 1];
    expect(sess.tobaccoId).toBe("T1");
    expect(sess.lotId).toBe("L1");
    expect(sess.weightG).toBe("3");
    // And the on-disk copy reflects the real cellar, never the empty INIT.
    const onDisk2 = JSON.parse(localStorage.getItem(SK)!);
    expect(onDisk2.tobaccos[0].lots[0].weightG).toBe("47");
  });

  it("a NON-overtime running tasting is left running through the cold-start window (no premature save)", () => {
    // A tasting only 10 min in should never auto-end — regardless of loading.
    localStorage.setItem(SK, JSON.stringify(realCellar()));
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running", startTs: Date.now() - 10 * 60 * 1000,
        pausedAccumMs: 0, pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "L1",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    const saves: any[] = [];
    const { rerender } = render(
      <Harness data={{ ...INIT }} loading={true} onSave={(d) => saves.push(d)} />,
    );
    act(() => {
      rerender(<Harness data={realCellar()} loading={false} onSave={(d) => saves.push(d)} />);
    });
    // Not a zombie → nothing auto-ended, nothing persisted, cellar intact.
    expect(saves).toHaveLength(0);
    const onDisk = JSON.parse(localStorage.getItem(SK)!);
    expect(onDisk.tobaccos[0].lots[0].weightG).toBe("50");
  });
});
