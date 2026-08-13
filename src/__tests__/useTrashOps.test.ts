import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrashOps } from "../hooks/useTrashOps.ts";

function setup(data: any) {
  const save = vi.fn();
  const { result } = renderHook(() =>
    useTrashOps({ data, save, weightUnit: "g" }),
  );
  return { save, ops: result.current };
}

const baseData = () => ({
  tobaccos: [
    { id: 1, brand: "A", name: "X", lots: [{ id: 11, status: "jar", weightG: "10" }] },
    { id: 2, brand: "B", name: "Y", deletedAt: "2020-01-01T00:00:00Z", lots: [] },
  ],
  pipes: [{ id: 3, brand: "P", name: "Q", deletedAt: "2020-01-01T00:00:00Z" }],
  wishlist: [],
  accessories: [],
  sessions: [],
  nxT: 3, nxP: 4, nxA: 1, nxJ: 1, nxW: 1,
});

describe("useTrashOps.restoreFromTrash", () => {
  it("clears deletedAt on a top-level row", () => {
    const { save, ops } = setup(baseData());
    ops.restoreFromTrash("tobacco", 2);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.find((t: any) => t.id === 2).deletedAt).toBeUndefined();
    // untouched rows preserved
    expect(saved.tobaccos.find((t: any) => t.id === 1)).toBeTruthy();
  });
  it("clears deletedAt on a soft-deleted lot (kind=lot)", () => {
    const d = baseData();
    d.tobaccos[0]!.lots[0] = { id: 11, status: "jar", weightG: "10", deletedAt: "2020-01-01" } as any;
    const { save, ops } = setup(d);
    ops.restoreFromTrash("lot", 11);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].deletedAt).toBeUndefined();
  });
});

describe("useTrashOps.restoreSelectionFromTrash", () => {
  it("restores a multi-pick selection in ONE save", () => {
    const { save, ops } = setup(baseData());
    ops.restoreSelectionFromTrash(new Set(["tobacco:2", "pipe:3"]));
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.find((t: any) => t.id === 2).deletedAt).toBeUndefined();
    expect(saved.pipes.find((p: any) => p.id === 3).deletedAt).toBeUndefined();
  });
  it("no-ops on an empty selection", () => {
    const { save, ops } = setup(baseData());
    ops.restoreSelectionFromTrash(new Set());
    expect(save).not.toHaveBeenCalled();
  });

  // A forged selection `kind` equal to a prototype
  // member must not resolve `picks["__proto__"]` to Object.prototype and crash
  // on `set.add` — the whole restore would blow up.
  it("does not crash on a forged prototype-key selection kind", () => {
    const { ops } = setup(baseData());
    expect(() => {
      ops.restoreSelectionFromTrash(new Set(["__proto__:2", "constructor:3", "tobacco:2"]));
    }).not.toThrow();
  });
});

describe("useTrashOps.permanentlyDelete", () => {
  it("hard-removes a trashed top-level row", () => {
    const { save, ops } = setup(baseData());
    ops.permanentlyDelete("pipe", 3);
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes.find((p: any) => p.id === 3)).toBeUndefined();
  });
  it("removes a lot AND orphanises referencing sessions (kind=lot)", () => {
    const d = baseData();
    d.sessions = [{ id: 100, tobaccoId: 1, lotId: "11", weightG: "2" }] as any;
    const { save, ops } = setup(d);
    ops.permanentlyDelete("lot", 11);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots.find((l: any) => l.id === 11)).toBeUndefined();
    expect(saved.sessions[0].lotId).toBe("");
  });

  // permanently deleting a TOBACCO takes
  // its lots with it, so referencing sessions must have lotId cleared — the
  // same guarantee the "lot" branch + the 30-day sweep already give.
  it("clears lotId on sessions whose lot dies with a permanently-deleted tobacco", () => {
    const d = baseData();
    // Trash tobacco 2 and give it a lot referenced by a session.
    d.tobaccos[1] = {
      id: 2, brand: "B", name: "Y", deletedAt: "2020-01-01T00:00:00Z",
      lots: [{ id: 22, status: "jar", weightG: "10" }],
    } as any;
    d.sessions = [
      { id: 100, tobaccoId: 2, lotId: "22", weightG: "2" },
      { id: 101, tobaccoId: 1, lotId: "11", weightG: "1" }, // untouched
    ] as any;
    const { save, ops } = setup(d);
    ops.permanentlyDelete("tobacco", 2);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.find((t: any) => t.id === 2)).toBeUndefined();
    expect(saved.sessions.find((s: any) => s.id === 100).lotId).toBe("");
    // A session pointing at a surviving tobacco's lot is left alone.
    expect(saved.sessions.find((s: any) => s.id === 101).lotId).toBe("11");
  });
});

describe("useTrashOps.emptyTrash / restoreAllFromTrash", () => {
  it("emptyTrash wipes every soft-deleted row", () => {
    const { save, ops } = setup(baseData());
    ops.emptyTrash();
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.every((t: any) => t.id !== 2)).toBe(true);
    expect(saved.pipes.length).toBe(0);
    // live rows survive
    expect(saved.tobaccos.find((t: any) => t.id === 1)).toBeTruthy();
  });
  it("restoreAllFromTrash clears every deletedAt in one save", () => {
    const { save, ops } = setup(baseData());
    ops.restoreAllFromTrash();
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.find((t: any) => t.id === 2).deletedAt).toBeUndefined();
    expect(saved.pipes.find((p: any) => p.id === 3).deletedAt).toBeUndefined();
  });

  // emptyTrash purges a trashed top-level
  // tobacco wholesale — its lots go too, so a session referencing one of them
  // must be orphaned (lotId=""), not left dangling.
  it("emptyTrash clears lotId on sessions whose lot lived in a purged trashed tobacco", () => {
    const d = baseData();
    d.tobaccos[1] = {
      id: 2, brand: "B", name: "Y", deletedAt: "2020-01-01T00:00:00Z",
      lots: [{ id: 22, status: "jar", weightG: "10" }],
    } as any;
    d.sessions = [{ id: 100, tobaccoId: 2, lotId: "22", weightG: "2" }] as any;
    const { save, ops } = setup(d);
    ops.emptyTrash();
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos.every((t: any) => t.id !== 2)).toBe(true);
    expect(saved.sessions[0].lotId).toBe("");
  });
});

// ─── re-deduct on restore — the WIRING, not the helper ────────────
//
// `deleteSession` (soft-delete) does TWO things: it stamps `deletedAt` AND it
// credits the session's weight back to the lot, so the inventory reads "this
// session never happened". Every restore path must therefore RE-DEDUCT that
// weight, or each delete→restore round-trip hands the user free grams: the
// session is back in the journal AND the lot still holds the grams it smoked.
//
// The pure helper (`reDeductRestoredSessions`) has its own suite. What had no
// coverage at all was whether these three call sites still CALL it — the
// The wiring-gap shape: a helper can be perfectly tested while the code
// that is supposed to invoke it quietly stops doing so. A mutation run found
// all three `reDeductRestoredSessions(...)` lines could be DELETED with the
// whole suite green, plus the `deletedAt` filter that decides WHICH sessions
// restore-all re-deducts (dropping it re-deducts every LIVE session too —
// silently draining the entire cellar on one "Tout restaurer" tap).
describe("useTrashOps — re-deduct on restore (weight round-trip)", () => {
  // A cellar where session #100 smoked 3 g of lot 11 and was then soft-deleted:
  // the lot is back at its full 10 g and the session carries `deletedAt`.
  function trashedSessionData() {
    return {
      tobaccos: [
        { id: 1, brand: "A", name: "X", lots: [{ id: 11, status: "jar", weightG: "10", weightInitial: "10" }] },
      ],
      pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 100, tobaccoId: 1, lotId: "11", weightG: "3", deletedAt: "2020-01-01T00:00:00Z" },
      ],
      nxT: 2, nxP: 1, nxA: 1, nxJ: 101, nxW: 1,
    };
  }
  const lotWeight = (saved: any) => saved.tobaccos[0].lots[0].weightG;

  it("restoreFromTrash re-deducts the restored session's weight from its lot", () => {
    const { save, ops } = setup(trashedSessionData());
    ops.restoreFromTrash("session", 100);
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].deletedAt).toBeUndefined();
    // 10 g − 3 g: the session is live again, so its grams leave the lot again.
    expect(lotWeight(saved)).toBe("7");
  });

  it("restoreSelectionFromTrash re-deducts every restored session's weight", () => {
    const { save, ops } = setup(trashedSessionData());
    ops.restoreSelectionFromTrash(new Set(["session:100"]));
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].deletedAt).toBeUndefined();
    expect(lotWeight(saved)).toBe("7");
  });

  it("restoreAllFromTrash re-deducts every restored session's weight", () => {
    const { save, ops } = setup(trashedSessionData());
    ops.restoreAllFromTrash();
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].deletedAt).toBeUndefined();
    expect(lotWeight(saved)).toBe("7");
  });

  // The other half of restore-all: it must re-deduct ONLY the sessions it
  // actually un-trashed. A LIVE session was already debited when it was
  // logged — debiting it a second time here would silently drain the cellar
  // by the whole journal's worth of grams on a single "Tout restaurer".
  it("restoreAllFromTrash leaves LIVE sessions alone (no second deduction)", () => {
    const d = trashedSessionData();
    // Lot 12 holds 20 g and has already been debited for live session #101.
    d.tobaccos[0]!.lots.push({ id: 12, status: "jar", weightG: "20", weightInitial: "25" } as any);
    d.sessions.push({ id: 101, tobaccoId: 1, lotId: "12", weightG: "5" } as any);
    const { save, ops } = setup(d);
    ops.restoreAllFromTrash();
    const saved = save.mock.calls[0]![0];
    const lot12 = saved.tobaccos[0].lots.find((l: any) => l.id === 12);
    expect(lot12.weightG).toBe("20");
    // …and the genuinely-restored one is still re-deducted.
    expect(saved.tobaccos[0].lots.find((l: any) => l.id === 11).weightG).toBe("7");
  });
});
