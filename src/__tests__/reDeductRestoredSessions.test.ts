// `reDeductRestoredSessions` — the helper that fixes the
// delete + restore session double-counting bug.
//
// Background: `useSessionStore.deleteSession` (soft-delete) stamps
// `deletedAt` AND restores the session's weight to the lot, so the
// inventory matches "this session never happened". When the user
// later restores the session from the Trash, the three restore paths
// (`restoreFromTrash`, `restoreSelectionFromTrash`,
// `restoreAllFromTrash`) clear `deletedAt` — and earlier they
// did NOT re-deduct, so every delete → restore cycle added the
// session's weight as free grammes to the lot. This helper
// centralises the re-deduction.

import { describe, it, expect } from "vitest";
import { applyLotWeightDelta, reDeductRestoredSessions } from "../utils/lotUtils";

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: "L1", status: "jar", weightG: "100", weightInitial: "100",
    originalStatus: "jar", dateOpened: "2024-01-01",
    ...overrides,
  };
}
function makeData(overrides: Record<string, any> = {}) {
  return {
    tobaccos: [{
      id: 1, brand: "X", name: "Y",
      lots: [makeLot()],
    }],
    sessions: [],
    pipes: [], wishlist: [], accessories: [],
    ...overrides,
  };
}
function getLot(data: any, lotId = "L1"): any {
  return data.tobaccos[0].lots.find((l: any) => String(l.id) === String(lotId));
}

describe("reDeductRestoredSessions — happy paths", () => {
  it("deducts weight for a single restored session", () => {
    const data = makeData({
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
      }],
    });
    const out = reDeductRestoredSessions(data, ["S1"], "g");
    expect(getLot(out).weightG).toBe("95");
  });

  it("deducts weight for several restored sessions on the same lot", () => {
    const data = makeData({
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "3" },
      ],
    });
    const out = reDeductRestoredSessions(data, ["S1", "S2"], "g");
    expect(getLot(out).weightG).toBe("92");
  });

  it("accepts a Set as the restoredIds argument", () => {
    const data = makeData({
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
      }],
    });
    const out = reDeductRestoredSessions(data, new Set(["S1"]), "g");
    expect(getLot(out).weightG).toBe("95");
  });

  it("matches string-vs-number ids via String() coercion", () => {
    const data = makeData({
      sessions: [{
        id: 42, tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
      }],
    });
    const out = reDeductRestoredSessions(data, ["42"], "g");
    expect(getLot(out).weightG).toBe("95");
  });
});

describe("reDeductRestoredSessions — no-op paths", () => {
  it("returns the input ref unchanged when restoredIds is empty", () => {
    const data = makeData({
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5" }],
    });
    expect(reDeductRestoredSessions(data, [], "g")).toBe(data);
    expect(reDeductRestoredSessions(data, new Set(), "g")).toBe(data);
  });

  it("skips a session whose lotId is empty (cleanly-orphaned)", () => {
    const data = makeData({
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "",
        date: "2025-01-01", weightG: "5" }],
    });
    const out = reDeductRestoredSessions(data, ["S1"], "g");
    expect(getLot(out).weightG).toBe("100"); // unchanged
  });

  it("skips a session whose weightG is 0 or missing", () => {
    const data = makeData({
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "0" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "" },
      ],
    });
    const out = reDeductRestoredSessions(data, ["S1", "S2"], "g");
    expect(getLot(out).weightG).toBe("100");
  });

  it("skips a session that still carries deletedAt (defensive)", () => {
    const data = makeData({
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
        deletedAt: "2026-05-15T10:00:00Z" }],
    });
    const out = reDeductRestoredSessions(data, ["S1"], "g");
    expect(getLot(out).weightG).toBe("100");
  });

  it("does not crash when the referenced lot id is missing", () => {
    // `applyLotWeightDelta` falls back to `pickJarLot` when the
    // declared lotId doesn't match — pre-existing behaviour that
    // supports orphaned sessions. With an EMPTY lots
    // array, the fallback also misses and the delta is a no-op.
    const data = Object.assign({}, makeData({
      sessions: [{ id: "S1", tobaccoId: 1, lotId: "GONE",
        date: "2025-01-01", weightG: "5" }],
    }), {
      tobaccos: [{ id: 1, brand: "X", name: "Y", lots: [] }],
    });
    const out = reDeductRestoredSessions(data, ["S1"], "g");
    expect(out.tobaccos[0].lots).toEqual([]);
    expect(out.sessions[0].deletedAt).toBeUndefined();
  });

  it("ignores sessions not in the restoredIds set", () => {
    const data = makeData({
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "3" },
      ],
    });
    // Only S2 in the set — S1's 5g must NOT be deducted.
    const out = reDeductRestoredSessions(data, ["S2"], "g");
    expect(getLot(out).weightG).toBe("97");
  });

  it("returns the input ref when data.sessions is null/undefined", () => {
    expect(reDeductRestoredSessions(null, ["S1"], "g")).toBeNull();
    const noSess: any = { tobaccos: [] };
    expect(reDeductRestoredSessions(noSess, ["S1"], "g")).toBe(noSess);
  });
});

// ── Regression test: full delete + restore round-trip ────────────────────────
// This is the user-visible behaviour the fix guards.
// Scenario:
//   1. A lot starts at 100g.
//   2. A session is logged that consumes 5g → lot at 95g.
//   3. The session is soft-deleted → `useSessionStore.deleteSession`
//      restores the 5g to the lot → lot back at 100g.
//   4. The user restores the session from the Trash → without the
//      fix the lot stays at 100g (bug: +5g free). WITH the
//      fix, `reDeductRestoredSessions` re-debits → lot back at 95g.
//
// We simulate steps 2/3/4 with the actual `applyLotWeightDelta` and
// `reDeductRestoredSessions` helpers — no React, no store, no
// rendering. The reducer-style sequence captures exactly what the
// three restore paths in App.tsx now do.

describe("reDeductRestoredSessions — delete+restore round-trip", () => {
  it("a delete → restore cycle on a single session preserves the lot balance", () => {
    let data: any = makeData({
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
      }],
    });
    // Step 2: session creation deducts 5g.
    data = applyLotWeightDelta(data, 1, "L1", -5, "g");
    expect(getLot(data).weightG).toBe("95");
    // Step 3: soft-delete restores 5g (current useSessionStore behaviour).
    data = applyLotWeightDelta(data, 1, "L1", +5, "g");
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) =>
        s.id === "S1" ? Object.assign({}, s, { deletedAt: "2026-05-15T10:00:00Z" }) : s),
    });
    expect(getLot(data).weightG).toBe("100");
    // Step 4: user restores from Trash — caller clears deletedAt
    // BEFORE invoking the helper (App.tsx pattern).
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) => {
        if (s.id !== "S1") return s;
        const c = Object.assign({}, s);
        delete c.deletedAt;
        return c;
      }),
    });
    data = reDeductRestoredSessions(data, ["S1"], "g");
    // Net effect after the round-trip: lot weight matches step 2.
    expect(getLot(data).weightG).toBe("95");
  });

  it("a delete-all → restore-all cycle on multiple sessions preserves the balance", () => {
    let data: any = makeData({
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "3" },
        { id: "S3", tobaccoId: 1, lotId: "L1", date: "2025-01-03", weightG: "2" },
      ],
    });
    // Step 2: each session deducts.
    data = applyLotWeightDelta(data, 1, "L1", -5, "g");
    data = applyLotWeightDelta(data, 1, "L1", -3, "g");
    data = applyLotWeightDelta(data, 1, "L1", -2, "g");
    expect(getLot(data).weightG).toBe("90");
    // Step 3: soft-delete all three (each restores +weight).
    data = applyLotWeightDelta(data, 1, "L1", +5, "g");
    data = applyLotWeightDelta(data, 1, "L1", +3, "g");
    data = applyLotWeightDelta(data, 1, "L1", +2, "g");
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) =>
        Object.assign({}, s, { deletedAt: "2026-05-15T10:00:00Z" })),
    });
    expect(getLot(data).weightG).toBe("100");
    // Step 4: bulk restore from the Trash.
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) => {
        const c = Object.assign({}, s);
        delete c.deletedAt;
        return c;
      }),
    });
    data = reDeductRestoredSessions(data, ["S1", "S2", "S3"], "g");
    expect(getLot(data).weightG).toBe("90");
  });

  it("restoring a SUBSET only re-deducts the picked sessions", () => {
    // Mirrors the 'restoreSelectionFromTrash' flow.
    let data: any = makeData({
      sessions: [
        { id: "S1", tobaccoId: 1, lotId: "L1", date: "2025-01-01", weightG: "5" },
        { id: "S2", tobaccoId: 1, lotId: "L1", date: "2025-01-02", weightG: "3" },
      ],
    });
    data = applyLotWeightDelta(data, 1, "L1", -5, "g");
    data = applyLotWeightDelta(data, 1, "L1", -3, "g");
    expect(getLot(data).weightG).toBe("92");
    // Both soft-deleted.
    data = applyLotWeightDelta(data, 1, "L1", +5, "g");
    data = applyLotWeightDelta(data, 1, "L1", +3, "g");
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) =>
        Object.assign({}, s, { deletedAt: "2026-05-15T10:00:00Z" })),
    });
    expect(getLot(data).weightG).toBe("100");
    // Restore ONLY S1 — S2 stays in the trash.
    data = Object.assign({}, data, {
      sessions: data.sessions.map((s: any) => {
        if (s.id !== "S1") return s;
        const c = Object.assign({}, s);
        delete c.deletedAt;
        return c;
      }),
    });
    data = reDeductRestoredSessions(data, new Set(["S1"]), "g");
    // 100 − 5 = 95 (S1 re-deducted; S2 still in trash, its 3g
    // restoration stays).
    expect(getLot(data).weightG).toBe("95");
  });

  it("restoring a session whose lot was permanently deleted is a no-op (no crash)", () => {
    let data: any = makeData({
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "L1",
        date: "2025-01-01", weightG: "5",
        deletedAt: "2026-05-15T10:00:00Z",
      }],
    });
    // Lot was hard-removed in the interval (e.g. parent tabac
    // permanently deleted). The session keeps its lotId as a
    // fantôme ref. Clear deletedAt then restore.
    data = Object.assign({}, data, {
      tobaccos: [Object.assign({}, data.tobaccos[0], { lots: [] })],
      sessions: data.sessions.map((s: any) => {
        const c = Object.assign({}, s);
        delete c.deletedAt;
        return c;
      }),
    });
    data = reDeductRestoredSessions(data, ["S1"], "g");
    expect(data.tobaccos[0].lots).toEqual([]); // unchanged
    expect(data.sessions[0].deletedAt).toBeUndefined();
  });

  // The tobacco EXISTS but the session's lotId is dangling
  // (forged data). The re-deduction must NOT misdirect −w onto a different jar
  // lot of the same tobacco via pickJarLot — it must skip entirely.
  it("does NOT misdirect the re-deduction onto another jar lot when the lotId is dangling", () => {
    let data: any = makeData({
      tobaccos: [{
        id: 1, brand: "X", name: "Y",
        lots: [makeLot({ id: "REAL", weightG: "100", weightInitial: "100" })],
      }],
      sessions: [{
        id: "S1", tobaccoId: 1, lotId: "GHOST", // no lot with id "GHOST"
        date: "2025-01-01", weightG: "5",
      }],
    });
    data = reDeductRestoredSessions(data, ["S1"], "g");
    // The real jar lot's balance is untouched (earlier it would have been
    // debited to 95 via the pickJarLot fallback).
    expect(getLot(data, "REAL").weightG).toBe("100");
  });
});
