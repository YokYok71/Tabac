import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../hooks/useSessionStore";
import { BJ } from "../constants";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: String(Math.random()),
    status: "cellar",
    weightG: "100",
    dateOpened: "",
    dateFinished: "",
    disposed: false,
    ...overrides,
  };
}

function makeData(overrides: Record<string, any> = {}) {
  return {
    tobaccos: [],
    sessions: [],
    nxJ: 1,
    ...overrides,
  };
}

function hookDeps(data: any, save: any, nav: any, weightUnit = "g", setSaveError?: any) {
  return { data, save, nav, weightUnit, setSaveError };
}

// ── initial state ─────────────────────────────────────────────────────────────

describe("useSessionStore — initial state", () => {
  it("starts with blank sessForm", () => {
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), vi.fn(), vi.fn()))
    );
    expect(result.current.sessForm).toEqual(Object.assign({}, BJ));
  });

  it("starts with sessGrouped = true", () => {
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), vi.fn(), vi.fn()))
    );
    expect(result.current.sessGrouped).toBe(true);
  });
});

// ── addSession ────────────────────────────────────────────────────────────────

describe("useSessionStore — addSession", () => {
  it("does nothing when date is empty", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({ ...f, date: "" }));
    });
    act(() => {
      result.current.addSession();
    });
    expect(save).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it("saves session and navigates to journal", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-15",
        weightG: "0",
      }));
    });
    act(() => {
      result.current.addSession();
    });
    expect(save).toHaveBeenCalledOnce();
    // add-session lands at the TOP of the journal (no
    // restoreScroll) so the just-added entry is visible.
    expect(nav).toHaveBeenCalledWith("journal");
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].date).toBe("2025-06-15");
    expect(saved.nxJ).toBe(2);
  });

  it("deducts weight from named lot", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const lotId = "lot-42";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "100" });
    const tob = { id: 5, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-15",
        tobaccoId: 5,
        lotId,
        weightG: "10",
      }));
    });
    act(() => {
      result.current.addSession();
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].weightG).toBe("90");
  });

  // A hand-typed >1 dp weight is ROUNDED to the deduction
  // grid before it's stored on the session AND deducted, so Σ(sessions) and
  // (weightInitial − weightG) stay byte-identical (no sub-grid drift that would
  // eventually trip a false lot-balance-overflow).
  it("rounds a >1dp session weight to the grid for BOTH the record and the debit", () => {
    const save = vi.fn();
    const lot = makeLot({ id: "L", status: "jar", weightG: "100", weightInitial: "100" });
    const tob = { id: 5, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15", tobaccoId: 5, lotId: "L", weightG: "2.75" }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    // stored session weight rounded to 1 dp g...
    expect(saved.sessions[0].weightG).toBe("2.8");
    // ...and the lot debited by the SAME 2.8 → 97.2 (not 97.25).
    expect(saved.tobaccos[0].lots[0].weightG).toBe("97.2");
  });

  // A session whose lotId points at a NON-EXISTENT lot must
  // NOT misdirect the deduction onto a different jar lot (the class its
  // updateSession sibling closed). The lot is orphaned (lotId "")
  // and no weight is deducted from any lot.
  it("does not misdirect the deduction when lotId points at a missing lot", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const otherJar = makeLot({ id: "jar-real", status: "jar", weightG: "100" });
    const tob = { id: 5, lots: [otherJar] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-15",
        tobaccoId: 5,
        lotId: "ghost-lot-999", // not present in tob.lots
        weightG: "10",
      }));
    });
    act(() => {
      result.current.addSession();
    });
    const saved = save.mock.calls[0]![0];
    // The real jar lot is untouched (no misdirected deduction).
    expect(saved.tobaccos[0].lots[0].weightG).toBe("100");
    // The session is orphaned so a later delete can't misdirect the restore.
    expect(saved.sessions[0].lotId).toBe("");
  });

  it("resolves lotId via pickJarLot when empty", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const lot = makeLot({ id: "jar-1", status: "jar", weightG: "80" });
    const tob = { id: 5, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-15",
        tobaccoId: 5,
        lotId: "",
        weightG: "20",
      }));
    });
    act(() => {
      result.current.addSession();
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].lotId).toBe("jar-1");
    expect(saved.tobaccos[0].lots[0].weightG).toBe("60");
  });

  it("does not deduct when weightG is 0", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const lot = makeLot({ id: "lot-1", status: "jar", weightG: "100" });
    const tob = { id: 5, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-15",
        tobaccoId: 5,
        lotId: "lot-1",
        weightG: "0",
      }));
    });
    act(() => {
      result.current.addSession();
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].weightG).toBe("100");
  });

  it("resets form after save", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), save, nav))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15" }));
    });
    act(() => {
      result.current.addSession();
    });
    expect(result.current.sessForm).toEqual(Object.assign({}, BJ));
  });
});

// ── addSessionFromTasting ─────────────────────────────────────────────────────

describe("useSessionStore — addSessionFromTasting", () => {
  it("persists a session from an external form payload and navigates to journal", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const lot = makeLot({ id: "L1", status: "jar", weightG: "50" });
    const tob = { id: 9, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.addSessionFromTasting({
        date: "2026-02-01",
        tobaccoId: 9,
        pipeId: "p1",
        lotId: "L1",
        duration: "25",
        rating: 5,
        notes: "tasting flow",
        weightG: "3",
      });
    });
    expect(save).toHaveBeenCalledOnce();
    // tasting-end lands at the TOP of the journal (no
    // restoreScroll) so the just-added session is visible, instead of
    // restoring a stale mid-list scroll position.
    expect(nav).toHaveBeenCalledWith("journal");
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0]).toMatchObject({
      date: "2026-02-01",
      tobaccoId: 9,
      pipeId: "p1",
      lotId: "L1",
      duration: "25",
      rating: 5,
      notes: "tasting flow",
      weightG: "3",
    });
    // Lot deducted
    expect(saved.tobaccos[0].lots[0].weightG).toBe("47");
  });

  it("does not touch the sessForm state", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), save, vi.fn()))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({ ...f, notes: "form-state" }));
    });
    act(() => {
      result.current.addSessionFromTasting({
        date: "2026-02-01",
        tobaccoId: "",
        pipeId: "",
        lotId: "",
        duration: "10",
        rating: 0,
        notes: "tasting note",
        weightG: "",
      });
    });
    // The form state must remain untouched.
    expect(result.current.sessForm.notes).toBe("form-state");
  });

  it("bails out when date is missing (no save, no nav)", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), save, nav))
    );
    act(() => {
      result.current.addSessionFromTasting({
        date: "",
        tobaccoId: "",
        pipeId: "",
        lotId: "",
        duration: "10",
        rating: 0,
        notes: "",
        weightG: "",
      });
    });
    expect(save).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  // ── weight cap: entered > lot balance ──────────────────────────────────────

  it("caps session weightG to lot balance when entered weight exceeds it", () => {
    const save = vi.fn();
    const lotId = "lot-cap";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "3" });
    const tob = { id: 7, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 7, lotId, weightG: "4",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    // Session must record 3g (capped), not 4g (entered)
    expect(saved.sessions[0].weightG).toBe("3");
    // Lot must be at 0g and auto-finished
    expect(saved.tobaccos[0].lots[0].weightG).toBe("0");
    expect(saved.tobaccos[0].lots[0].status).toBe("finished");
  });

  it("does not cap when entered weight is within lot balance", () => {
    const save = vi.fn();
    const lotId = "lot-ok";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "10" });
    const tob = { id: 7, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 7, lotId, weightG: "4",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("4");
    expect(saved.tobaccos[0].lots[0].weightG).toBe("6");
  });

  it("delete round-trip restores exactly the capped amount (no phantom grams)", () => {
    // Lot has 3g, user enters 4g → session records 3g.
    // Deleting the session must restore 3g, not 4g.
    const save = vi.fn();
    const lotId = "lot-cap";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "3" });
    const tob = { id: 7, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 7, lotId, weightG: "4",
      }));
    });
    act(() => { result.current.addSession(); });
    const afterAdd = save.mock.calls[0]![0];
    // Now simulate the delete using the saved data
    const sessionId = afterAdd.sessions[0].id;
    const save2 = vi.fn();
    const { result: result2 } = renderHook(() =>
      useSessionStore(hookDeps(afterAdd, save2, vi.fn()))
    );
    act(() => { result2.current.deleteSession(sessionId); });
    const afterDelete = save2.mock.calls[0]![0];
    // Lot should be restored to exactly 3g, not 4g
    expect(afterDelete.tobaccos[0].lots[0].weightG).toBe("3");
    expect(afterDelete.tobaccos[0].lots[0].status).toBe("jar");
  });
});

// ── updateSession — lot auto-finished at 0g ───────────────────────────────────

describe("useSessionStore — updateSession required-date guard", () => {
  it("does NOT persist a session whose date was cleared (back-guard)", () => {
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "", weightG: "0" };
    const data = makeData({ tobaccos: [], sessions: [oldSession] });
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save, nav)));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "", tobaccoId: 5, weightG: "0" }));
    });
    act(() => { result.current.updateSession(); });
    expect(save).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});

describe("useSessionStore — updateSession cross-lot lot-existence guard", () => {
  it("does not misdirect the deduction onto a foreign jar when the new lotId is missing", () => {
    const lotA = makeLot({ id: "lotA", status: "jar", weightG: "100", dateOpened: "2024-01-01" });
    const lotB = makeLot({ id: "lotB", status: "jar", weightG: "80", dateOpened: "2024-01-01" });
    const tob = { id: 5, lots: [lotA, lotB] };
    // Old session referenced lotA with 0 weight (nothing to restore); edited to
    // point at a NONEXISTENT lot "ghost" of the same tobacco → cross-lot branch.
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId: "lotA", weightG: "0" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15", tobaccoId: 5, lotId: "ghost", weightG: "5" }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // capL2 is null (ghost lot) → no deduction. Neither live jar lot
    // was debited via pickJarLot's misdirection.
    expect(saved.tobaccos[0].lots[0].weightG).toBe("100");
    expect(saved.tobaccos[0].lots[1].weightG).toBe("80");
  });
});

describe("useSessionStore — updateSession when lot was auto-finished at 0g", () => {
  it("reactivates the finished lot and deducts the new weight", () => {
    // Scenario: session consumed the last 10g → lot auto-finished at 0g
    // User edits session from 10g to 5g
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "finished", weightG: "0", dateFinished: "2025-06-15" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "10" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "5" }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // restore +10g reactivates lot to "jar" at 10g, then deduct -5g → 5g
    expect(saved.tobaccos[0].lots[0].weightG).toBe("5");
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("");
  });

  it("reactivates and leaves lot full when new weight is 0", () => {
    // User removes the weight from the session entirely
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "finished", weightG: "0", dateFinished: "2025-06-15" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "10" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "0" }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // restore +10g reactivates to "jar" at 10g, no deduction (nw=0)
    expect(saved.tobaccos[0].lots[0].weightG).toBe("10");
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
  });

  it("re-finishes lot when new weight equals restored weight", () => {
    // User keeps the same weight → lot should end up at 0g again
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "finished", weightG: "0", dateFinished: "2025-06-15" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "10" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "10" }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // restore → 10g jar, then deduct 10g → 0g → auto-finishes again
    expect(saved.tobaccos[0].lots[0].weightG).toBe("0");
    expect(saved.tobaccos[0].lots[0].status).toBe("finished");
  });
});

// ── updateSession ─────────────────────────────────────────────────────────────

describe("useSessionStore — updateSession", () => {
  it("restores old weight then deducts new weight", () => {
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "80" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-10", tobaccoId: 5, lotId, weightG: "20" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f,
        date: "2025-06-10",
        tobaccoId: 5,
        lotId,
        weightG: "30",
      }));
    });
    act(() => {
      result.current.updateSession();
    });
    const saved = save.mock.calls[0]![0];
    // 80 (current) + 20 (restore old) - 30 (deduct new) = 70
    expect(saved.tobaccos[0].lots[0].weightG).toBe("70");
  });

  it("changing the tobacco restores the OLD lot and deducts the NEW lot (wrong-tobacco fix)", () => {
    // The user logged a 5g session against tobacco A (lot A1) but it was
    // actually tobacco B. On edit they switch the tobacco to B (lot B1).
    // Expected: A1 gets its 5g back (not smoked after all), B1 loses 5g.
    const lotA = makeLot({ id: "A1", status: "jar", weightG: "45" }); // 50 − 5 already consumed
    const lotB = makeLot({ id: "B1", status: "jar", weightG: "50" });
    const tobA = { id: 1, lots: [lotA] };
    const tobB = { id: 2, lots: [lotB] };
    const oldSession = { id: 30, date: "2025-06-10", tobaccoId: 1, lotId: "A1", weightG: "5" };
    const data = makeData({ tobaccos: [tobA, tobB], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(30);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 2, lotId: "B1", weightG: "5",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    const savedA = saved.tobaccos.find((t: any) => t.id === 1).lots[0];
    const savedB = saved.tobaccos.find((t: any) => t.id === 2).lots[0];
    // A1 restored: 45 + 5 = 50 (back to its pre-session balance).
    expect(savedA.weightG).toBe("50");
    // B1 deducted: 50 − 5 = 45.
    expect(savedB.weightG).toBe("45");
    // The session now points at B1.
    expect(saved.sessions[0].tobaccoId).toBe(2);
    expect(saved.sessions[0].lotId).toBe("B1");
  });

  it("resets editSessId and form after update", () => {
    const oldSession = { id: 10, date: "2025-06-10", tobaccoId: null, weightG: "0", lotId: "" };
    const data = makeData({ sessions: [oldSession] });
    const save = vi.fn();
    const nav = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, nav))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({ ...f, date: "2025-06-10" }));
    });
    act(() => {
      result.current.updateSession();
    });
    expect(result.current.editSessId).toBeNull();
    expect(result.current.sessForm).toEqual(Object.assign({}, BJ));
  });

  // ── weight cap on update ────────────────────────────────────────────────────

  it("caps new weight to lot balance after old weight is restored", () => {
    // Lot currently at 2g (old session consumed 8g from original 10g).
    // User edits the session to 15g → after restoring 8g, lot is at 10g.
    // New weight must be capped to 10g, not 15g.
    const lotId = "lot-cap";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "2" });
    const tob = { id: 7, lots: [lot] };
    const oldSession = { id: 20, date: "2025-06-10", tobaccoId: 7, lotId, weightG: "8" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(20);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 7, lotId, weightG: "15",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // Session must record 10g (capped to restored balance), lot must be at 0g
    expect(saved.sessions[0].weightG).toBe("10");
    expect(saved.tobaccos[0].lots[0].weightG).toBe("0");
    expect(saved.tobaccos[0].lots[0].status).toBe("finished");
  });

  it("does not cap when new weight is within restored lot balance", () => {
    // Lot at 2g, old session was 8g (so original was 10g). User edits to 5g → 10-5=5g remaining.
    const lotId = "lot-ok";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "2" });
    const tob = { id: 7, lots: [lot] };
    const oldSession = { id: 20, date: "2025-06-10", tobaccoId: 7, lotId, weightG: "8" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(20);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 7, lotId, weightG: "5",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("5");
    expect(saved.tobaccos[0].lots[0].weightG).toBe("5");
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
  });
});

// ── cellar lot refusal (defence in depth) ─────────────────────────────────────
// SessionFormView intercepts cellar lots in the UI (confirm flow),
// but the store must also refuse them so a programmatic caller (tasting end
// with a lot edited mid-flight, an import, a future refactor) can't silently
// deduct from a sealed cellar lot.

describe("useSessionStore — cellar lot refusal", () => {
  it("addSession refuses when the targeted lot is still in cellar status", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    const lotId = "lot-sealed";
    const lot = makeLot({ id: lotId, status: "cellar", weightG: "50" });
    const tob = { id: 5, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 5, lotId, weightG: "3",
      }));
    });
    act(() => { result.current.addSession(); });
    expect(save).not.toHaveBeenCalled();
    expect(setSaveError).toHaveBeenCalled();
    expect(setSaveError.mock.calls[0]![0]).toMatch(/cave|cellar/i);
  });

  it("addSessionFromTasting refuses a cellar lot and returns false", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    const lotId = "lot-sealed";
    const lot = makeLot({ id: lotId, status: "cellar", weightG: "50" });
    const tob = { id: 9, lots: [lot] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    let ok: boolean | undefined;
    act(() => {
      ok = result.current.addSessionFromTasting({
        date: "2026-02-01", tobaccoId: 9, pipeId: "p", lotId,
        duration: "25", rating: 0, notes: "", weightG: "3",
      });
    });
    expect(ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(setSaveError).toHaveBeenCalled();
  });

  it("updateSession (cross-lot) refuses targeting a cellar lot", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    // old session points to lot-A (jar), user edits to lot-B (cellar)
    const lotA = makeLot({ id: "lot-A", status: "jar", weightG: "40" });
    const lotB = makeLot({ id: "lot-B", status: "cellar", weightG: "50" });
    const tob = { id: 5, lots: [lotA, lotB] };
    const oldSession = { id: 10, date: "2025-06-10", tobaccoId: 5, lotId: "lot-A", weightG: "5" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId: "lot-B", weightG: "3",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(save).not.toHaveBeenCalled();
    expect(setSaveError).toHaveBeenCalled();
    expect(setSaveError.mock.calls[0]![0]).toMatch(/cave|cellar/i);
  });

  it("updateSession (same-lot) allows weight edits on a jar lot (sanity baseline)", () => {
    // Sanity check that the cross-lot guard didn't accidentally break
    // the same-lot path — same-lot edits on a jar lot are still allowed.
    const save = vi.fn();
    const setSaveError = vi.fn();
    const lot = makeLot({ id: "lot-J", status: "jar", weightG: "40" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 11, date: "2025-06-10", tobaccoId: 5, lotId: "lot-J", weightG: "5" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setEditSessId(11);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId: "lot-J", weightG: "8",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(save).toHaveBeenCalledOnce();
    expect(setSaveError).not.toHaveBeenCalled();
  });

  it("updateSession on an orphaned session (lotId=\"\") never mutates any lot weight (latent-bug fix)", () => {
    const save = vi.fn();
    // Two jar lots so a misdirected +ow/-nw would be observable.
    const j1 = makeLot({ id: "j1", status: "jar", weightG: "44" }); // non-round
    const j2 = makeLot({ id: "j2", status: "jar", weightG: "50" }); // round
    const tob = { id: 7, lots: [j1, j2] };
    const orphan = { id: 20, date: "2025-01-01", tobaccoId: 7, lotId: "", weightG: "6" };
    const data = makeData({ tobaccos: [tob], sessions: [orphan] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g"))
    );
    act(() => {
      result.current.setEditSessId(20);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-01-01", tobaccoId: 7, lotId: "", weightG: "6", notes: "edited",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    // Both lots untouched. Pre-fix: +6 restore went to pickJarLot (j1→50)
    // and −6 deduct to j2 (→44), breaking the accounting invariant.
    expect(saved.tobaccos[0].lots.find((l: any) => l.id === "j1").weightG).toBe("44");
    expect(saved.tobaccos[0].lots.find((l: any) => l.id === "j2").weightG).toBe("50");
    // The metadata edit still applied.
    expect(saved.sessions[0].notes).toBe("edited");
  });
});

// ── deleteSession ─────────────────────────────────────────────────────────────

describe("useSessionStore — deleteSession", () => {
  // deleteSession now soft-deletes (stamps `deletedAt`)
  // instead of removing the row. The weight is still restored to the
  // lot so the inventory stays accurate; the session row lives in the
  // trash for 30 days before being hard-removed.
  it("marks the session deleted (soft-delete) and restores lot weight", () => {
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "60" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId, weightG: "20", date: "" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.deleteSession(10);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].deletedAt).toMatch(/^\d{4}-/);
    expect(saved.tobaccos[0].lots[0].weightG).toBe("80");
  });

  // deleteSession credits +w back to the lot; a second
  // call on an already soft-deleted session would double-credit → weightG can
  // exceed weightInitial. The idempotency guard makes it a strict no-op.
  it("is a no-op on an already soft-deleted session (no double-credit)", () => {
    const lot = makeLot({ id: "L", status: "jar", weightG: "70", weightInitial: "100" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId: "L", weightG: "30", deletedAt: "2020-01-01T00:00:00Z" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() => useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => { result.current.deleteSession(10); });
    expect(save).not.toHaveBeenCalled();
  });

  it("skips weight restore for orphaned session (lotId empty)", () => {
    const lot = makeLot({ id: "lot-1", status: "jar", weightG: "60" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId: "", weightG: "20", date: "" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.deleteSession(10);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].deletedAt).toMatch(/^\d{4}-/);
    expect(saved.tobaccos[0].lots[0].weightG).toBe("60");
  });

  it("reactivates a finished lot when soft-deleting the session that consumed the last grams", () => {
    const lotId = "lot-1";
    const lot = makeLot({ id: lotId, status: "finished", weightG: "0", dateFinished: "2025-06-15" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId, weightG: "10", date: "2025-06-15" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => { result.current.deleteSession(10); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].deletedAt).toMatch(/^\d{4}-/);
    // restore +10g reactivates lot: 0g finished → 10g jar
    expect(saved.tobaccos[0].lots[0].weightG).toBe("10");
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("");
  });

  // A DISPOSED lot (physically thrown /
  // given away) must NOT be resurrected as usable stock when an old session
  // that consumed from it is deleted. The weight is still credited back, but
  // the lot stays finished+disposed — no phantom inventory.
  it("does NOT resurrect a DISPOSED lot on session delete (stays finished+disposed)", () => {
    const lotId = "lot-d";
    const lot = makeLot({ id: lotId, status: "finished", weightG: "20", weightInitial: "50", dateFinished: "2025-06-15", disposed: true });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId, weightG: "30", date: "2025-06-15" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => { result.current.deleteSession(10); });
    const saved = save.mock.calls[0]![0];
    const savedLot = saved.tobaccos[0].lots[0];
    // weight is credited back (20 + 30 = 50)...
    expect(savedLot.weightG).toBe("50");
    // ...but the lot stays finished + disposed — NOT reactivated to jar stock.
    expect(savedLot.status).toBe("finished");
    expect(savedLot.disposed).toBe(true);
  });

  it("skips weight restore when weightG is 0", () => {
    const lot = makeLot({ id: "lot-1", status: "jar", weightG: "60" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId: "lot-1", weightG: "0", date: "" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.deleteSession(10);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].weightG).toBe("60");
  });

  // The tobacco exists but the session's lotId is dangling
  // (forged/corrupt data). The restore must NOT misdirect +w onto a different
  // jar lot of the same tobacco via pickJarLot — it must skip.
  it("does NOT misdirect the weight restore onto another jar lot when lotId is dangling", () => {
    const lot = makeLot({ id: "real-lot", status: "jar", weightG: "60" });
    const tob = { id: 5, lots: [lot] };
    const sess = { id: 10, tobaccoId: 5, lotId: "ghost-lot", weightG: "10", date: "2025-06-15" };
    const data = makeData({ tobaccos: [tob], sessions: [sess] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => { result.current.deleteSession(10); });
    const saved = save.mock.calls[0]![0];
    // The real jar lot is untouched (earlier pickJarLot would have credited +10 → 70).
    expect(saved.tobaccos[0].lots[0].weightG).toBe("60");
    expect(saved.sessions[0].deletedAt).toMatch(/^\d{4}-/);
  });
});

// ── toggleSessGroup ───────────────────────────────────────────────────────────

describe("useSessionStore — toggleSessGroup (inverted collapse)", () => {
  it("undefined (absent) means collapsed by default", () => {
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), vi.fn(), vi.fn()))
    );
    expect(result.current.collapsedSessGroups["2025"]).toBeUndefined();
  });

  it("first toggle expands (sets false)", () => {
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), vi.fn(), vi.fn()))
    );
    act(() => {
      result.current.toggleSessGroup("2025");
    });
    expect(result.current.collapsedSessGroups["2025"]).toBe(false);
  });

  it("second toggle collapses (removes key)", () => {
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(makeData(), vi.fn(), vi.fn()))
    );
    act(() => {
      result.current.toggleSessGroup("2025");
    });
    act(() => {
      result.current.toggleSessGroup("2025");
    });
    expect(result.current.collapsedSessGroups["2025"]).toBeUndefined();
  });
});

// ── Snapshot capture with imageUrl ───────────────────────────────
// Sessions store {brand, name, imageUrl} of the referenced tabac /
// pipe at save time so the journal can render the photo even after
// the entity is permanently deleted. The journal display already
// prefers the live entity; the snapshot only kicks in as a fallback.

describe("useSessionStore — snapshot.imageUrl capture", () => {
  it("addSession freezes the tabac imageUrl into tobaccoSnapshot", () => {
    const save = vi.fn();
    const tob = {
      id: "T1", brand: "Brackwater", name: "Duskfall",
      imageUrl: "local-photo-12345",
      lots: [makeLot({ id: "L1", status: "jar", dateOpened: "2024-01-01" })],
    };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2024-06-01", tobaccoId: "T1", lotId: "L1",
        duration: "30", weightG: "0",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    const sess = saved.sessions[saved.sessions.length - 1];
    expect(sess.tobaccoSnapshot).toEqual({
      brand: "Brackwater",
      name: "Duskfall",
      imageUrl: "local-photo-12345",
    });
  });

  it("addSession freezes the pipe imageUrl into pipeSnapshot", () => {
    const save = vi.fn();
    const data = makeData({
      tobaccos: [],
      pipes: [{ id: "P1", brand: "Halvorsen", name: "Sherlock",
                imageUrl: "https://example.com/sherlock.jpg" }],
    });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2024-06-01", pipeId: "P1",
        duration: "30", weightG: "0",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    const sess = saved.sessions[saved.sessions.length - 1];
    expect(sess.pipeSnapshot).toEqual({
      brand: "Halvorsen",
      name: "Sherlock",
      imageUrl: "https://example.com/sherlock.jpg",
    });
  });

  it("snapshot.imageUrl is an empty string when the entity has no image", () => {
    const save = vi.fn();
    const tob = { id: "T1", brand: "X", name: "Y", lots: [makeLot({ id: "L1" })] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2024-06-01", tobaccoId: "T1", lotId: "L1",
        duration: "30", weightG: "0",
      }));
    });
    act(() => { result.current.addSession(); });
    const sess = save.mock.calls[0]![0].sessions[0];
    expect(sess.tobaccoSnapshot.imageUrl).toBe("");
  });
});

// defensive coercion regression tests. The `parseFloat(x) || 0`
// pattern catches NaN but lets `Infinity` slip through (Infinity is
// truthy). A forged backup with `weightG: "Infinity"` on a lot or
// session would otherwise propagate Infinity into every cap / delta
// calc — see useSessionStore lines 50, 104, 170, 171, 221, 263, 301
// before the safeW() switch.
describe("useSessionStore — safeW coercion", () => {
  it("addSession: form.weightG === 'Infinity' is treated as 0 (no Infinity leak)", () => {
    const save = vi.fn();
    const tob = { id: "T1", brand: "X", name: "Y",
      lots: [makeLot({ id: "L1", status: "jar", weightG: "100" })] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2024-06-01", tobaccoId: "T1", lotId: "L1",
        duration: "30", weightG: "Infinity",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("0");
    // Lot weight stays at 100 (no deduction since w=0).
    expect(saved.tobaccos[0].lots[0].weightG).toBe("100");
  });

  it("addSession: form.weightG === '-1e-45' (denormal negative) is treated as 0", () => {
    const save = vi.fn();
    const tob = { id: "T1", brand: "X", name: "Y",
      lots: [makeLot({ id: "L1", status: "jar", weightG: "100" })] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2024-06-01", tobaccoId: "T1", lotId: "L1",
        duration: "30", weightG: "-1e-45",
      }));
    });
    act(() => { result.current.addSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("0");
  });

  it("deleteSession: a forged session with weightG='Infinity' restores 0 to the lot (no poison)", () => {
    const save = vi.fn();
    const tob = { id: "T1", brand: "X", name: "Y",
      lots: [makeLot({ id: "L1", status: "jar", weightG: "50" })] };
    const forged = {
      id: 1, date: "2024-06-01", tobaccoId: "T1", pipeId: "P1", lotId: "L1",
      weightG: "Infinity", duration: "30",
    };
    const data = makeData({ tobaccos: [tob], sessions: [forged] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn())));
    act(() => { result.current.deleteSession(1); });
    const saved = save.mock.calls[0]![0];
    // The session is soft-deleted (deletedAt stamped) — not removed.
    expect(saved.sessions[0].deletedAt).toBeTruthy();
    // Lot weight stays at 50 (Infinity coerced to 0 ⇒ no restoration).
    expect(saved.tobaccos[0].lots[0].weightG).toBe("50");
  });
});

// ─── The updateSession half of the guards addSession already had ────────────
//
// A mutation run over this store found that several protections exist on BOTH
// entry points but are only tested on one. That asymmetry is exactly what
// the same-lot cellar guard was added to fix: a rule that
// holds on the add path and quietly stopped holding on the edit path is
// invisible, because the user reaches the same lot either way.
describe("useSessionStore — updateSession parity with addSession", () => {
  // `_persistSession` rounds the typed weight to the deduction grid
  // so the stored `weightG` and the lot debit are byte-identical; that half is
  // covered. `updateSession` rounds too — and nothing checked it. Unrounded,
  // the session records 2.55 while the lot is debited 2.6, so Σ(sessions)
  // drifts from (weightInitial − weightG) by 0.05 g per edit until it crosses
  // the balance tolerance and the diagnostic reports a `lot-balance-overflow`
  // the user cannot explain or clear.
  it("rounds a >1dp edited weight to the grid for BOTH the record and the debit", () => {
    const lotId = "lot-r";
    const lot = makeLot({ id: lotId, status: "jar", weightG: "80", weightInitial: "100" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-10", tobaccoId: 5, lotId, weightG: "20" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId, weightG: "2.55",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    const rec = saved.sessions[0].weightG;
    const lotAfter = saved.tobaccos[0].lots[0].weightG;
    // Recorded and debited must agree exactly: 80 + 20 − 2.6 = 97.4
    expect(rec).toBe("2.6");
    expect(lotAfter).toBe("97.4");
    // The invariant that matters, stated directly: what left the lot is what
    // the session says it smoked.
    expect(100 - parseFloat(lotAfter)).toBeCloseTo(parseFloat(rec), 10);
  });

  // The cross-lot branch has long refused a sealed cellar lot and is
  // tested; the same-lot branch got its guard later and until then
  // had none. Without it, editing the weight of a session whose lot was moved
  // back to "cellar" deducts from a sealed tin.
  it("(same-lot) refuses to deduct from a lot that is back in cellar status", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    const lotId = "lot-sealed-same";
    const lot = makeLot({ id: lotId, status: "cellar", weightG: "50" });
    const tob = { id: 5, lots: [lot] };
    const oldSession = { id: 10, date: "2025-06-10", tobaccoId: 5, lotId, weightG: "5" };
    const data = makeData({ tobaccos: [tob], sessions: [oldSession] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId, weightG: "9",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(save).not.toHaveBeenCalled();
    expect(setSaveError).toHaveBeenCalled();
    expect(setSaveError.mock.calls[0]![0]).toMatch(/cave|cellar/i);
  });
});

// ─── Weight may never go off the books ──────────────────────────────────────
//
// If a session records grams but no lot can be resolved to debit
// them from, the save must be REFUSED. Persisting it anyway leaves a quantity
// the user's stats count as smoked while no lot ever gave it up — the cellar
// total and the consumption chart stop agreeing, with nothing to point at.
describe("useSessionStore — no off-books weight", () => {
  it("refuses to save a weighed session when no lot can be resolved", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    // The tobacco exists but has no JAR lot, so pickJarLot returns null.
    const tob = { id: 7, lots: [makeLot({ id: "c1", status: "cellar", weightG: "50" })] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 7, lotId: "", weightG: "3",
      }));
    });
    act(() => { result.current.addSession(); });
    expect(save).not.toHaveBeenCalled();
    expect(setSaveError).toHaveBeenCalled();
  });

  it("still saves an UNWEIGHED session with no lot (accounting-off flow)", () => {
    const save = vi.fn();
    const setSaveError = vi.fn();
    const tob = { id: 7, lots: [makeLot({ id: "c1", status: "cellar", weightG: "50" })] };
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn(), "g", setSaveError))
    );
    act(() => {
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-15", tobaccoId: 7, lotId: "", weightG: "0",
      }));
    });
    act(() => { result.current.addSession(); });
    expect(save).toHaveBeenCalledOnce();
    expect(setSaveError).not.toHaveBeenCalled();
  });
});

// ─── The misdirection family ────────────────────────────────────────────────
//
// One bug class, fixed five separate times: when a session's `lotId` names a lot that no longer exists,
// `applyLotWeightDelta` falls through `locateLotIdx` to `pickJarLot` and moves
// the grams onto a DIFFERENT jar of the same tobacco. Nothing throws; a jar
// the user never touched simply gains or loses weight. Each site now carries
// an existence check, and each check must be exercised — the cross-lot deduct
// one was, these three were not.
describe("useSessionStore — never misdirect a delta onto a foreign jar", () => {
  // Two jars, and a session pointing at a third lot id that is gone.
  function danglingData(oldWeight: string) {
    return makeData({
      tobaccos: [{
        id: 5,
        lots: [
          makeLot({ id: "J1", status: "jar", weightG: "40", dateOpened: "2025-01-01" }),
          makeLot({ id: "J2", status: "jar", weightG: "37", dateOpened: "2025-02-01" }),
        ],
      }],
      sessions: [{ id: 10, date: "2025-06-10", tobaccoId: 5, lotId: "GONE", weightG: oldWeight }],
    });
  }
  const weights = (saved: any) => saved.tobaccos[0].lots.map((l: any) => l.weightG);

  // Same-lot branch: editing the weight of a session whose lot
  // vanished must not net the difference onto another jar.
  it("same-lot edit on a vanished lot moves no weight at all", () => {
    const save = vi.fn();
    const data = danglingData("5");
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId: "GONE", weightG: "9",
      }));
    });
    act(() => { result.current.updateSession(); });
    expect(weights(save.mock.calls[0]![0])).toEqual(["40", "37"]);
  });

  // Cross-lot branch, the RESTORE half: re-pointing such a session
  // at a real lot must not credit the old weight onto an unrelated jar.
  it("cross-lot edit away from a vanished lot credits nothing back", () => {
    const save = vi.fn();
    const data = danglingData("5");
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId: "J1", weightG: "4",
      }));
    });
    act(() => { result.current.updateSession(); });
    // J1 pays the new 4 g. J2 — and the phantom +5 — must not appear anywhere.
    expect(weights(save.mock.calls[0]![0])).toEqual(["36", "37"]);
  });

  // pointing a session at a lot id that does not exist must ORPHAN
  // it (lotId ""), not store a dangling reference — otherwise a later delete
  // or edit re-enters the misdirection path with the same bad id.
  it("cross-lot edit ONTO a vanished lot orphans the session instead of storing the bad id", () => {
    const save = vi.fn();
    const data = makeData({
      tobaccos: [{ id: 5, lots: [makeLot({ id: "J1", status: "jar", weightG: "40" })] }],
      sessions: [{ id: 10, date: "2025-06-10", tobaccoId: 5, lotId: "J1", weightG: "5" }],
    });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => {
      result.current.setEditSessId(10);
      result.current.setSessForm((f: any) => ({
        ...f, date: "2025-06-10", tobaccoId: 5, lotId: "NOPE", weightG: "3",
      }));
    });
    act(() => { result.current.updateSession(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].lotId).toBe("");
    // J1 gets its 5 g back (it really did lose them) and pays nothing new.
    expect(saved.tobaccos[0].lots[0].weightG).toBe("45");
  });
});

// ─── Accounting off: a zero-weight session never touches a lot ───────────────
//
// With the global accounting toggle off, sessions carry weightG "0" but still
// name a lot. Deleting one must be a pure journal operation. The `w > 0` gate
// is what makes that true: without it, `applyLotWeightDelta(+0)` still runs the
// lot through the pipeline, re-rounding its balance to the display grid and
// auto-finishing a jar that happens to sit at 0. Small numbers, but they move
// with no session to explain them.
describe("useSessionStore — accounting-off delete leaves the lot untouched", () => {
  it("deleting a 0 g session does not re-round the lot balance", () => {
    const save = vi.fn();
    const lot = makeLot({ id: "L1", status: "jar", weightG: "2.55", weightInitial: "10" });
    const data = makeData({
      tobaccos: [{ id: 5, lots: [lot] }],
      sessions: [{ id: 10, date: "2025-06-10", tobaccoId: 5, lotId: "L1", weightG: "0" }],
    });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => { result.current.deleteSession(10); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].deletedAt).toBeTruthy();
    expect(saved.tobaccos[0].lots[0].weightG).toBe("2.55");
  });

  it("deleting a 0 g session does not auto-finish a jar sitting at zero", () => {
    const save = vi.fn();
    const lot = makeLot({ id: "L1", status: "jar", weightG: "0", weightInitial: "10" });
    const data = makeData({
      tobaccos: [{ id: 5, lots: [lot] }],
      sessions: [{ id: 10, date: "2025-06-10", tobaccoId: 5, lotId: "L1", weightG: "0" }],
    });
    const { result } = renderHook(() =>
      useSessionStore(hookDeps(data, save, vi.fn()))
    );
    act(() => { result.current.deleteSession(10); });
    expect(save.mock.calls[0]![0].tobaccos[0].lots[0].status).toBe("jar");
  });
});
