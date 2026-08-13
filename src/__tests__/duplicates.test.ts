/**
 * The duplicate finder + merge.
 *
 * The load-bearing rule here is which inventory numbers may be trusted to say
 * "these two lots are the same physical tin". It was got WRONG TWICE before the
 * user corrected it, and both wrong versions are pinned below as fixtures:
 *
 *   1. "non-empty" — wrong, because jars are not numbered.
 *   2. "unique among THIS row's lots" — wrong, because the add-form default
 *      ("1") sits once on each of dozens of rows and would have passed.
 *
 * The rule that holds is CELLAR-WIDE RARITY, and it is right for a reason worth
 * keeping: a lot promoted cellar → jar KEEPS its incremented number (verified
 * in applyLifecycleDates), so a promoted jar stays identifying while a jar
 * created directly carries the shared default and is excluded — without the
 * test needing to know either lot's history.
 */
import { describe, it, expect } from "vitest";
import {
  findDuplicateGroups, duplicateCount, mergeDuplicates, boxNumberTally, rowBoxNumbers,
} from "../utils/duplicates.ts";

function lot(over: any = {}) {
  return Object.assign({ id: 1, status: "cellar", weightG: "50", boxNumber: "" }, over);
}
function cellar(over: any = {}) {
  return Object.assign({
    tobaccos: [], pipes: [], accessories: [], wishlist: [], sessions: [],
    nxT: 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
  }, over);
}

describe("finding the duplicates", () => {
  it("groups live rows that share brand+name, case-insensitively", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Duskfall", lots: [] },
      { id: 2, brand: "halvorsen", name: "DUSKFALL", lots: [] },
      { id: 3, brand: "Halvorsen", name: "Irish Flake", lots: [] },
    ] });
    const g = findDuplicateGroups(d, "tobacco");
    expect(g).toHaveLength(1);
    expect(g[0]!.members.map((m) => m.id).sort()).toEqual([1, 2]);
  });

  it("ignores rows already in the trash — merging into one would resurrect it", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [] },
      { id: 2, brand: "P", name: "N", lots: [], deletedAt: "2026-01-01T00:00:00.000Z" },
    ] });
    expect(findDuplicateGroups(d, "tobacco")).toEqual([]);
  });

  it("does not group rows that have neither brand nor name", () => {
    // That is missing data, not a duplicate signal; grouping on it would pile
    // unrelated rows together.
    const d = cellar({ tobaccos: [
      { id: 1, brand: "", name: "", lots: [] },
      { id: 2, brand: "", name: "", lots: [] },
    ] });
    expect(findDuplicateGroups(d, "tobacco")).toEqual([]);
  });

  it("reports the facts a human needs to choose", () => {
    const d = cellar({
      tobaccos: [
        { id: 1, brand: "P", name: "N", updatedAt: "2026-05-01T00:00:00.000Z",
          lots: [lot({ id: 11, weightG: "50", boxNumber: "7" }), lot({ id: 12, weightG: "20" })] },
        { id: 2, brand: "P", name: "N", lots: [lot({ id: 21, weightG: "30" })] },
      ],
      sessions: [{ id: 1, tobaccoId: 1 }, { id: 2, tobaccoId: 1 }, { id: 3, tobaccoId: 2 }],
    });
    const [g] = findDuplicateGroups(d, "tobacco");
    const m1 = g!.members.find((m) => m.id === 1)!;
    expect(m1.lotCount).toBe(2);
    expect(m1.weight).toBe(70);
    expect(m1.sessionCount).toBe(2);
    expect(m1.boxNumbers).toEqual(["7"]);
    expect(g!.members.find((m) => m.id === 2)!.sessionCount).toBe(1);
  });

  it("counts a finished lot's weight as zero — it is not stock", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [lot({ weightG: "50", status: "finished" })] },
      { id: 2, brand: "P", name: "N", lots: [] },
    ] });
    expect(findDuplicateGroups(d, "tobacco")[0]!.members[0]!.weight).toBe(0);
  });
});

describe("which inventory numbers may pair two tins", () => {
  it("pairs on a RARE number carried by both sides", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [lot({ id: 11, boxNumber: "17" })] },
      { id: 2, brand: "P", name: "N", lots: [lot({ id: 21, boxNumber: "17" })] },
      { id: 3, brand: "Q", name: "Z", lots: [lot({ id: 31, boxNumber: "18" })] },
    ] });
    expect(findDuplicateGroups(d, "tobacco")[0]!.sharedBoxNumbers).toEqual(["17"]);
  });

  it("REFUSES the add-form default, even though it is unique within each row", () => {
    // THE fixture. Reported by the user: "my jars mostly read 1, the ones made
    // early on". "1" appears exactly once per row — so the rejected per-row
    // rule would have called it identifying and paired unrelated jars.
    const many = [1, 2, 3, 4, 5, 6].map((i) => (
      { id: 10 + i, brand: "B" + i, name: "N" + i, lots: [lot({ id: 100 + i, boxNumber: "1" })] }
    ));
    const d = cellar({ tobaccos: many.concat([
      { id: 1, brand: "P", name: "N", lots: [lot({ id: 11, boxNumber: "1" })] },
      { id: 2, brand: "P", name: "N", lots: [lot({ id: 21, boxNumber: "1" })] },
    ] as any) });
    const g = findDuplicateGroups(d, "tobacco").find((x) => x.brand === "P")!;
    expect(g.members).toHaveLength(2);
    expect(g.sharedBoxNumbers).toEqual([]);
  });

  it("an empty number is never a signal — two unnumbered jars are not one tin", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [lot({ id: 11, boxNumber: "" })] },
      { id: 2, brand: "P", name: "N", lots: [lot({ id: 21, boxNumber: "  " })] },
    ] });
    expect(findDuplicateGroups(d, "tobacco")[0]!.sharedBoxNumbers).toEqual([]);
  });

  it("a promoted jar keeps its rare number and still pairs", () => {
    // cellar → jar preserves boxNumber (applyLifecycleDates), so status is
    // irrelevant to the signal.
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [lot({ id: 11, status: "jar", boxNumber: "42" })] },
      { id: 2, brand: "P", name: "N", lots: [lot({ id: 21, status: "cellar", boxNumber: "42" })] },
    ] });
    expect(findDuplicateGroups(d, "tobacco")[0]!.sharedBoxNumbers).toEqual(["42"]);
  });

  it("tallies the cellar and reads a row's numbers", () => {
    const d = cellar({ tobaccos: [
      { id: 1, brand: "P", name: "N", lots: [lot({ boxNumber: "1" }), lot({ boxNumber: "2" })] },
      { id: 2, brand: "Q", name: "M", lots: [lot({ boxNumber: "1" })] },
    ] });
    expect(boxNumberTally(d)).toEqual({ "1": 2, "2": 1 });
    expect(rowBoxNumbers(d.tobaccos[0].lots)).toEqual(["1", "2"]);
  });
});

describe("merging a duplicate into the one you keep", () => {
  const base = () => cellar({
    tobaccos: [
      { id: 1, brand: "P", name: "N", tastingNotes: "à garder",
        lots: [lot({ id: 11, boxNumber: "7" })] },
      { id: 2, brand: "P", name: "N", tastingNotes: "l'autre",
        lots: [lot({ id: 21, boxNumber: "8" }), lot({ id: 22, boxNumber: "9" })] },
    ],
    sessions: [
      { id: 100, tobaccoId: 2, lotId: 21, weightG: "2" },
      { id: 101, tobaccoId: 1, lotId: 11, weightG: "2" },
    ],
  });

  it("moves the lots, repoints the sessions, and trashes the dropped row", () => {
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    expect(r.lotsMoved).toBe(2);
    const keep = r.data.tobaccos.find((t: any) => t.id === 1);
    expect(keep.lots).toHaveLength(3);
    expect(keep.tastingNotes).toBe("à garder");   // the kept row's own prose wins
    const dropped = r.data.tobaccos.find((t: any) => t.id === 2);
    expect(dropped.deletedAt).toBeTruthy();       // soft — the 30-day trash is the undo
    const s = r.data.sessions.find((x: any) => x.id === 100);
    expect(s.tobaccoId).toBe(1);
  });

  it("NEVER rewrites an inventory number — it is written on the physical tin", () => {
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const keep = r.data.tobaccos.find((t: any) => t.id === 1);
    expect(keep.lots.map((l: any) => l.boxNumber).sort()).toEqual(["7", "8", "9"]);
  });

  it("gives moved lots fresh ids and drags each session's lotId along", () => {
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const keep = r.data.tobaccos.find((t: any) => t.id === 1);
    const ids = keep.lots.map((l: any) => l.id);
    expect(new Set(ids).size).toBe(3);            // no collision with the kept lot
    const moved = keep.lots.find((l: any) => l.boxNumber === "8");
    expect(r.data.sessions.find((x: any) => x.id === 100).lotId).toBe(moved.id);
  });

  it("clears a lotId whose lot did not come across, rather than leaving it dangling", () => {
    const d = base();
    d.tobaccos[1].lots[0].deletedAt = "2026-01-01T00:00:00.000Z"; // lot 21 trashed
    const r = mergeDuplicates(d, "tobacco", 1, [2]);
    expect(r.data.sessions.find((x: any) => x.id === 100).lotId).toBe("");
  });

  it("leaves sessions of the KEPT row untouched", () => {
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const s = r.data.sessions.find((x: any) => x.id === 101);
    expect(s.tobaccoId).toBe(1);
    expect(s.lotId).toBe(11);
  });

  it("is a no-op when the kept id does not exist, or nothing is dropped", () => {
    expect(mergeDuplicates(base(), "tobacco", 999, [2]).lotsMoved).toBe(0);
    expect(mergeDuplicates(base(), "tobacco", 1, []).droppedIds).toEqual([]);
    expect(mergeDuplicates(base(), "tobacco", 1, [1]).droppedIds).toEqual([]);
  });

  it("carries a pipe's maintenance log and repoints its sessions", () => {
    const d = cellar({
      pipes: [
        { id: 1, brand: "P", name: "N", maintenance: [{ id: 1, date: "2026-01-01" }] },
        { id: 2, brand: "P", name: "N", maintenance: [{ id: 2, date: "2026-02-01" }] },
      ],
      sessions: [{ id: 50, pipeId: 2 }],
    });
    const r = mergeDuplicates(d, "pipe", 1, [2]);
    expect(r.maintenanceMoved).toBe(1);
    expect(r.data.pipes.find((p: any) => p.id === 1).maintenance).toHaveLength(2);
    expect(r.data.sessions[0].pipeId).toBe(1);
  });

  it("counts the rows awaiting a decision across every kind", () => {
    const d = cellar({
      tobaccos: [{ id: 1, brand: "P", name: "N", lots: [] }, { id: 2, brand: "P", name: "N", lots: [] }],
      pipes: [{ id: 1, brand: "Q", name: "M" }, { id: 2, brand: "Q", name: "M" }, { id: 3, brand: "Q", name: "M" }],
    });
    expect(duplicateCount(d)).toBe(3); // 1 extra tobacco + 2 extra pipes
  });

  it("does not mutate the data it was given", () => {
    const d = base();
    const before = JSON.stringify(d);
    mergeDuplicates(d, "tobacco", 1, [2]);
    expect(JSON.stringify(d)).toBe(before);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The merge said "moves the lots" and in fact COPIED them: the live lots were
// re-stamped onto the kept row while the dropped row was soft-deleted with its
// originals intact. The trash is documented as this merge's undo — so restoring
// the dropped row (a single tap, no warning) put the SAME physical tins in the
// cellar twice, silently doubling the stock.
//
// Found while verifying the import fix, which shares the class: a
// physical tin must exist in exactly one live place.
describe("the merge MOVES lots — it must not leave a live copy behind", () => {
  const lot = (over: any = {}) => Object.assign(
    { id: 1, status: "cellar", weightInitial: "50", weightG: "50", datePurchased: "2025-01-01" }, over);
  const base = () => ({
    tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Duskfall", lots: [lot({ id: 11, boxNumber: "7" })] },
      { id: 2, brand: "Halvorsen", name: "Duskfall", lots: [lot({ id: 21, boxNumber: "8" })] },
    ],
    pipes: [], accessories: [], wishlist: [], sessions: [],
  });

  it("leaves no live lot on the dropped row", () => {
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const dropped = r.data.tobaccos.find((t: any) => t.id === 2);
    const live = (dropped.lots || []).filter((l: any) => l && !l.deletedAt);
    expect(live, "a moved lot must not stay live on the row it was moved off").toEqual([]);
  });

  it("does not double the stock when the dropped row is restored from the trash", () => {
    // The trash IS this merge's undo, so this is the ordinary sequence: merge,
    // change your mind, restore. It must not leave two tins where there is one.
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const restored = JSON.parse(JSON.stringify(r.data));
    const row = restored.tobaccos.find((t: any) => t.id === 2);
    delete row.deletedAt;                                     // restoreFromTrash
    const liveWeight = restored.tobaccos
      .filter((t: any) => !t.deletedAt)
      .flatMap((t: any) => (t.lots || []).filter((l: any) => l && !l.deletedAt))
      .reduce((n: number, l: any) => n + Number(l.weightG || 0), 0);
    expect(liveWeight, "restoring the dropped row must not duplicate the moved tin").toBe(100);
  });

  it("keeps the moved lot's history rather than deleting it outright", () => {
    // Soft-delete, not removal: the row in the trash still records what it held,
    // and nothing is destroyed that a user could not get back.
    const r = mergeDuplicates(base(), "tobacco", 1, [2]);
    const dropped = r.data.tobaccos.find((t: any) => t.id === 2);
    expect(dropped.lots).toHaveLength(1);
    expect(dropped.lots[0].deletedAt).toBeTruthy();
    expect(dropped.lots[0].boxNumber).toBe("8");   // the number on the tin, untouched
  });
});
