// PURGING ONE TABAC'S TRASHED LOT DELETED ANOTHER TABAC'S LIVE ONE.
//
// The trash operations locate a lot BY ID ALONE, across every tobacco:
//
//   permanentlyDelete("lot", id)  filters `t.lots` on every `t`, then clears
//                                 `lotId` on every session carrying that id;
//   sweepExpiredTrash             collects purged lot ids into one flat set
//                                 and clears sessions against it;
//   restoreFromTrash("lot", id)   clears `deletedAt` on every match.
//
// That is safe only while lot ids are globally unique — and `migrateData`
// DELIBERATELY leaves a pre-existing cross-tobacco duplicate alone, because
// re-stamping a valid lot id orphans every session referencing it
// (`session.lotId` is matched by value and nothing warns). See
// `lotIdGlobalRepair.test.ts`: the migration protects the MINT, not the
// existing pair, and the residual was disclosed with the remedy named — scope
// these call sites by tobacco.
//
// So the reachable sequence is: two tobaccos end up sharing lot id 42 (a
// pre-uid two-device merge, a hand-edited backup, an old cellar), the user
// deletes tobacco A's lot 42, and thirty days later — or on one tap of the ×
// in the trash — tobacco B's LIVE lot 42 is hard-deleted and its sessions
// lose their weight bookkeeping. No user action, no message.
//
// THE FIX IS THE PAIR `tobaccoId|lotId`, which is the key the balance
// invariant already uses (`checkLotInvariants`), so the arithmetic and the
// deletion now agree on what identifies a lot.
//
// WHY NOT MAKE THE IDS UNIQUE INSTEAD: that was tried and reverted before
// commit — it is data loss in the other direction. A visible duplicate is
// recoverable; a journal that quietly lost its lot links is not.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTrashOps } from "../hooks/useTrashOps.ts";
import { sweepExpiredTrash, sessionRefersToPurgedLot } from "../utils.ts";

function lot(over: any = {}) {
  return {
    status: "cellar", originalStatus: "cellar",
    weightG: "50", weightInitial: "50", datePurchased: "2026-01-01",
    boxNumber: "", price: "", seller: "", disposed: false,
    ...over,
  };
}

// Two tobaccos sharing lot id 42: A's copy is trashed, B's is LIVE. Two
// sessions, one on each — so a leak shows up as B's session losing its lot.
function collidingCellar() {
  return {
    tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Early Tide",
        lots: [lot({ id: 42, deletedAt: "2026-01-01T00:00:00.000Z" })] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot({ id: 42 })] },
    ],
    pipes: [], accessories: [], wishlist: [],
    sessions: [
      { id: 1, date: "2026-02-01", tobaccoId: 1, pipeId: 1, lotId: "42", weightG: "2", duration: "30" },
      { id: 2, date: "2026-02-02", tobaccoId: 2, pipeId: 1, lotId: "42", weightG: "3", duration: "30" },
    ],
    nxT: 3, nxP: 1, nxA: 1, nxJ: 3, nxW: 1,
  } as any;
}

function opsOn(data: any) {
  const save = vi.fn();
  const { result } = renderHook(() =>
    useTrashOps({ data, save, weightUnit: "g" } as any));
  return { ops: result.current, save };
}
const saved = (save: any) => save.mock.calls[save.mock.calls.length - 1]![0];
const lotsOf = (d: any, tobId: number) =>
  d.tobaccos.find((t: any) => t.id === tobId).lots;

describe("permanentlyDelete scopes a lot to its own tobacco", () => {
  it("purging tobacco A's trashed lot leaves tobacco B's live lot alone", () => {
    const data = collidingCellar();
    const { ops, save } = opsOn(data);
    act(() => { ops.permanentlyDelete("lot", 42, 1); });
    const next = saved(save);
    expect(lotsOf(next, 1), "the trashed lot was not purged").toHaveLength(0);
    expect(lotsOf(next, 2), "another tobacco's LIVE lot was deleted").toHaveLength(1);
  });

  it("…and B's session keeps its lot link", () => {
    const data = collidingCellar();
    const { ops, save } = opsOn(data);
    act(() => { ops.permanentlyDelete("lot", 42, 1); });
    const next = saved(save);
    const sA = next.sessions.find((s: any) => s.id === 1);
    const sB = next.sessions.find((s: any) => s.id === 2);
    expect(sA.lotId, "the purged lot's own session must be orphaned").toBe("");
    expect(sB.lotId, "another tobacco's session lost its lot link").toBe("42");
  });

  it("with no scope it still purges — the argument is optional, not required", () => {
    // Every existing caller that has no tobacco to hand (and the merge/import
    // paths) must keep working exactly as before. The scope NARROWS; its
    // absence must not silently make the operation a no-op.
    const data = collidingCellar();
    const { ops, save } = opsOn(data);
    act(() => { ops.permanentlyDelete("lot", 42); });
    const next = saved(save);
    expect(lotsOf(next, 1)).toHaveLength(0);
  });
});

describe("restoreFromTrash scopes a lot to its own tobacco", () => {
  it("restoring A's lot does not touch B's identically-numbered lot", () => {
    // Less destructive than a purge — a restore is undoable — but restoring
    // one lot must not silently resurrect another tobacco's.
    const data = {
      tobaccos: [
        { id: 1, brand: "Halvorsen", name: "Early Tide",
          lots: [lot({ id: 42, deletedAt: "2026-01-01T00:00:00.000Z" })] },
        { id: 2, brand: "Vondel", name: "Kade 12",
          lots: [lot({ id: 42, deletedAt: "2026-01-01T00:00:00.000Z" })] },
      ],
      pipes: [], accessories: [], wishlist: [], sessions: [],
      nxT: 3, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
    } as any;
    const { ops, save } = opsOn(data);
    act(() => { ops.restoreFromTrash("lot", 42, 1); });
    const next = saved(save);
    expect(lotsOf(next, 1)[0].deletedAt, "the asked-for lot stayed trashed").toBeUndefined();
    expect(lotsOf(next, 2)[0].deletedAt,
      "another tobacco's lot was restored too").toBeTruthy();
  });
});

describe("sweepExpiredTrash pairs the lot with its tobacco", () => {
  it("the 30-day sweep does not orphan another tobacco's session", () => {
    // The same defect through the door nobody taps: this runs 6 s after
    // launch, unattended.
    const data = collidingCellar();
    // A's lot is 30+ days old; B's lot is live and has no deletedAt at all.
    const cutoff = new Date("2026-03-01T00:00:00.000Z").getTime();
    const { next, changed } = sweepExpiredTrash(data, cutoff) as any;
    expect(changed, "nothing was swept — check the fixture dates").toBe(true);
    expect(lotsOf(next, 1)).toHaveLength(0);
    expect(lotsOf(next, 2), "the sweep deleted a LIVE lot").toHaveLength(1);
    const sB = next.sessions.find((s: any) => s.id === 2);
    expect(sB.lotId, "the sweep orphaned another tobacco's session").toBe("42");
  });

  it("…and still orphans the session belonging to the purged lot", () => {
    // Non-vacuity: scoping must not turn the sweep into a no-op. Without the
    // clear, `deleteSession`'s `&& sess.lotId` guard would credit weight back
    // to a lot that no longer exists.
    const data = collidingCellar();
    const cutoff = new Date("2026-03-01T00:00:00.000Z").getTime();
    const { next } = sweepExpiredTrash(data, cutoff) as any;
    const sA = next.sessions.find((s: any) => s.id === 1);
    expect(sA.lotId).toBe("");
  });
});

describe("emptyTrash pairs the lot with its tobacco", () => {
  it("does not orphan a session on another tobacco's LIVE lot", () => {
    // The bulk door, and the one that sidesteps the 30-day safety net: it
    // purges every trashed lot at once, so a flat set of ids reached across
    // to tobacco B's live lot 42 and cleared its session's link.
    const data = collidingCellar();
    const { ops, save } = opsOn(data);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => { ops.emptyTrash(); });
    const next = saved(save);
    const sA = next.sessions.find((s: any) => s.id === 1);
    const sB = next.sessions.find((s: any) => s.id === 2);
    expect(sA.lotId, "the purged lot's own session must be orphaned").toBe("");
    expect(sB.lotId, "another tobacco's session lost its lot link").toBe("42");
    expect(lotsOf(next, 2), "the live lot survived the empty").toHaveLength(1);
    vi.restoreAllMocks();
  });
});

// ── THE FALLBACK, AND THE OVER-REACH THAT EARNED IT ───────────────────────
//
// The first version of this fix keyed the session clear on the pair
// unconditionally, and TWO PRE-EXISTING FIXTURES in `sweepExpiredTrash.test.ts`
// failed — rightly. Their sessions carry a `lotId` and NO `tobaccoId` at all,
// and there the reference is dangling whatever the answer: requiring a pair
// would leave exactly the stale `lotId` the sweep exists to clear, and
// `deleteSession`'s `&& sess.lotId` guard would then credit weight back to a
// lot that no longer exists.
//
// So the rule is: PAIR when the session names its tobacco, BARE ID when it
// does not. That is not a loophole — the fallback applies precisely when
// there is no tobacco to disambiguate against.
describe("sessionRefersToPurgedLot — pair when possible, bare id otherwise", () => {
  const purged = { "1|42": true } as Record<string, true>;

  it("a session naming ANOTHER tobacco is not touched", () => {
    expect(sessionRefersToPurgedLot({ tobaccoId: 2, lotId: "42" }, purged)).toBe(false);
  });

  it("a session naming the SAME tobacco is cleared", () => {
    expect(sessionRefersToPurgedLot({ tobaccoId: 1, lotId: "42" }, purged)).toBe(true);
  });

  it("a session naming NO tobacco falls back to the bare lot id", () => {
    // The legacy / hand-edited shape the two older fixtures encode.
    for (const tid of [undefined, null, ""] as any[]) {
      expect(sessionRefersToPurgedLot({ tobaccoId: tid, lotId: "42" }, purged),
        "a dangling lotId survived the sweep").toBe(true);
    }
  });

  it("…and that fallback still does not fire for an unrelated lot", () => {
    // Non-vacuity: the fallback must not become "clear every lotId".
    expect(sessionRefersToPurgedLot({ lotId: "99" }, purged)).toBe(false);
  });

  it("a session with no lotId is never touched", () => {
    expect(sessionRefersToPurgedLot({ tobaccoId: 1, lotId: "" }, purged)).toBe(false);
  });

  it("a fantôme tobacco id still matches — sessions keep it after a purge", () => {
    // `permanentlyDelete("tobacco")` leaves `session.tobaccoId` pointing at
    // the gone row on purpose (the journal renders from the snapshot), and the
    // purge collects the pair under that same id, so the two agree.
    expect(sessionRefersToPurgedLot({ tobaccoId: "1", lotId: 42 }, purged)).toBe(true);
  });
});
