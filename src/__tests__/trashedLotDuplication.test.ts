// Two ways a LOT got duplicated silently, and the net that
// would have caught both.
//
// Both were found by a pre-public-release data-integrity drill, both were
// reproduced before anything was changed, and both are the same shape: the
// same physical tin ends up counted twice, with a distinct per-device `id` so
// no id rule fires, and in the UNDERFLOW direction so `lot-balance-overflow`
// (deliberately one-sided) cannot see it either. Across ~1500 drilled
// end-states that overflow rule fired zero times.
//
//   HIGH-1  merging while a lot sits in this device's trash appended the
//           imported twin — 16 % of 400 randomised two-device merges, ~123 g
//           of ghost stock each.
//   HIGH-2  « Tout restaurer » un-deleted the SOURCE half of a duplicate-merge
//           move — 110 g / 2 lots became 160 g / 3 lots, one button, no confirm.
//
// The third change is the reason they were invisible: `lot-uid-unique`. The
// lot `uid` has been the cross-device identity and was the one
// identity with no uniqueness rule at all.
//
// Probed: reverting any of the three reddens this file on its own.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrashOps } from "../hooks/useTrashOps";
import { checkUidInvariants, checkAllInvariants } from "../utils/lotInvariants";
import { mergeDuplicates } from "../utils/duplicates";

const lot = (over: any = {}) => ({
  id: 5001, uid: "LOT-UID-A", status: "cellar", weightG: "100", weightInitial: "100",
  originalStatus: "cellar", datePurchased: "2024-01-01", dateProduction: "",
  dateOpened: "", dateFinished: "", boxNumber: "1", price: "10", seller: "",
  disposed: false, ...over,
});

describe("lot-uid-unique", () => {
  it("flags two LIVE lots sharing a uid — the end state of both HIGH findings", () => {
    const data = {
      tobaccos: [{ id: 1, brand: "B", name: "N", lots: [lot(), lot({ id: 5002, weightG: "80" })] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    const v = checkUidInvariants(data).filter((x) => x.rule === "lot-uid-unique");
    expect(v.length).toBe(1);
    expect(v[0]!.detail).toContain("LOT-UID-A");
  });

  it("is SILENT when the twin is trashed — a legitimate move leaves exactly that", () => {
    // mergeDuplicates carries the uid onto the kept row and soft-deletes the
    // source. That state must not be reported, or every healthy merge would
    // raise a violation.
    const data = {
      tobaccos: [{ id: 1, brand: "B", name: "N", lots: [lot(), lot({ id: 5002, deletedAt: "2026-01-01" })] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    expect(checkUidInvariants(data).filter((x) => x.rule === "lot-uid-unique")).toEqual([]);
  });

  it("spans tobaccos — a merge moves tins between rows, so per-row scope would miss it", () => {
    const data = {
      tobaccos: [
        { id: 1, brand: "B", name: "N", lots: [lot()] },
        { id: 2, brand: "C", name: "M", lots: [lot({ id: 5002 })] },
      ],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    expect(checkUidInvariants(data).filter((x) => x.rule === "lot-uid-unique").length).toBe(1);
  });

  it("ignores uid-less legacy lots rather than inventing an identity for them", () => {
    const data = {
      tobaccos: [{ id: 1, brand: "B", name: "N", lots: [lot({ uid: "" }), lot({ id: 5002, uid: "" })] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    expect(checkUidInvariants(data).filter((x) => x.rule === "lot-uid-unique")).toEqual([]);
  });

  it("survives a non-array `tobaccos` — the payload comes from disk or a file", () => {
    // The pre-existing "survives a garbage payload" case caught the first
    // version of this rule missing its Array.isArray guard. Kept explicit.
    expect(() => checkUidInvariants({ tobaccos: "nope" } as any)).not.toThrow();
    expect(() => checkAllInvariants({ tobaccos: 7 } as any)).not.toThrow();
  });

  it("is wired into checkAllInvariants — the rule only helps if save() runs it", () => {
    const data = {
      tobaccos: [{ id: 1, brand: "B", name: "N", lots: [lot(), lot({ id: 5002 })] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    expect(checkAllInvariants(data).some((x) => x.rule === "lot-uid-unique")).toBe(true);
  });
});

describe("HIGH-2 — 'Tout restaurer' must not resurrect a moved lot", () => {
  // The restore-all rule, exercised against the state mergeDuplicates actually
  // produces rather than a hand-written fixture: if the merge ever stopped
  // carrying the uid onto the moved lot, this test would go red and tell us,
  // which is the point of building the input from the real function.
  const twoRows = () => ({
    tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Duskfall", uid: "T1",
        lots: [lot({ id: 11, uid: "L11", weightG: "60", weightInitial: "60" })] },
      { id: 2, brand: "Halvorsen", name: "Duskfall", uid: "T2",
        lots: [lot({ id: 21, uid: "L21", weightG: "50", weightInitial: "50" })] },
    ],
    pipes: [], accessories: [], wishlist: [], sessions: [],
  });

  const liveWeight = (d: any) => d.tobaccos
    .filter((t: any) => !t.deletedAt)
    .flatMap((t: any) => (t.lots || []).filter((l: any) => !l.deletedAt))
    .reduce((n: number, l: any) => n + parseFloat(l.weightG || "0"), 0);

  it("the merge itself conserves stock, and marks the source lots trashed-with-a-live-twin", () => {
    const merged: any = mergeDuplicates(twoRows() as any, "tobacco", 1, [2]).data;
    expect(liveWeight(merged)).toBe(110);
    // The signal restoreAllFromTrash keys on: same uid, one live and one trashed.
    const all = merged.tobaccos.flatMap((t: any) => t.lots || []);
    const l21 = all.filter((l: any) => l.uid === "L21");
    expect(l21.length).toBe(2);
    expect(l21.filter((l: any) => !l.deletedAt).length).toBe(1);
    expect(l21.filter((l: any) => l.deletedAt).length).toBe(1);
  });

  it("restoring everything afterwards must NOT inflate the stock", () => {
    // Drives the REAL hook, not a re-implementation of its rule. The first
    // version of this case rebuilt the predicate inline and stayed GREEN when
    // the hook's clause was deleted — it proved nothing. (Its source-level
    // companion was weak for the same reason: `/liveLotUids\[l\.uid\]/` also
    // matches the loop that POPULATES the map.) The recurring lesson:
    // when a probe stays green, find out which layer absorbs it.
    const merged: any = mergeDuplicates(twoRows() as any, "tobacco", 1, [2]).data;
    const save = vi.fn();
    const { result } = renderHook(() => useTrashOps({ data: merged, save, weightUnit: "g" }));
    act(() => { result.current.restoreAllFromTrash(); });
    expect(save).toHaveBeenCalledTimes(1);
    const after = save.mock.calls[0]![0];
    expect(liveWeight(after), "restoring must not create stock").toBe(110);
    expect(checkAllInvariants(after).filter((v: any) => v.rule === "lot-uid-unique")).toEqual([]);
  });

  it("a lot the user trashed HERSELF is still restored — not a blanket refusal", () => {
    const d: any = {
      tobaccos: [{ id: 1, brand: "B", name: "N",
        lots: [lot({ id: 11, uid: "L11" }), lot({ id: 12, uid: "L12", weightG: "40", deletedAt: "2026-01-01" })] }],
      pipes: [], accessories: [], wishlist: [], sessions: [],
    };
    const save = vi.fn();
    const { result } = renderHook(() => useTrashOps({ data: d, save, weightUnit: "g" }));
    act(() => { result.current.restoreAllFromTrash(); });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.filter((l: any) => l.deletedAt).length, "the user's own trashed lot comes back").toBe(0);
    expect(liveWeight(save.mock.calls[0]![0])).toBe(140);
  });

  it("the per-row restore is untouched — there the user names the lot", () => {
    // restoreFromTrash and restoreSelectionFromTrash were both already correct
    // (the drill measured 110 g staying 110 g), which is what isolated the
    // culprit. The fix must not spread to them: naming one lot is a choice the
    // user is entitled to make, even if it duplicates.
    const merged: any = mergeDuplicates(twoRows() as any, "tobacco", 1, [2]).data;
    const moved = merged.tobaccos
      .flatMap((t: any) => (t.lots || []))
      .find((l: any) => l.uid === "L21" && l.deletedAt);
    const save = vi.fn();
    const { result } = renderHook(() => useTrashOps({ data: merged, save, weightUnit: "g" }));
    act(() => { result.current.restoreFromTrash("lot", moved.id); });
    const after = save.mock.calls[0]![0];
    const back = after.tobaccos.flatMap((t: any) => t.lots || []).find((l: any) => String(l.id) === String(moved.id));
    expect(back.deletedAt, "an explicitly named lot still comes back").toBeFalsy();
    // Live stock is unchanged at 110 because the lot's PARENT row is itself
    // trashed by the merge, so the restored lot is not yet in the cellar —
    // which is why the per-row path was never the defect. Asserted rather than
    // assumed: the first version of this case expected 160 and was wrong.
    expect(liveWeight(after)).toBe(110);
  });
});
