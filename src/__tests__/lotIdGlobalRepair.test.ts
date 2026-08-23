// `migrateData`'s own lot-id repair could MINT globally-colliding ids, and the
// trash operations then delete in pairs.
//
// `dedupeIds(arr, startAt?)` seeds its counter from `max(valid ids in the
// array it was handed) + 1`, and `seen` is local to the call. `migrateData`
// called it ONCE PER TOBACCO with no `startAt`:
//
//     for (const tob of d.tobaccos) dedupeIds(tob.lots);
//
// so two tobaccos whose lots lack ids BOTH start at 1, and a minted id could
// land on an id another tobacco already carried.
//
// WHY THAT IS DATA LOSS AND NOT UNTIDINESS. `useTrashOps.permanentlyDelete(
// "lot", id)` and `sweepExpiredTrash` both filter BY LOT ID ACROSS EVERY
// TOBACCO. So purging tobacco A's trashed lot hard-deletes tobacco B's LIVE
// lot with the same id, and the 30-day sweep clears `lotId` on B's sessions
// too. No user action, no message.
//
// THE FIX IS THE COUNTER, NOT THE DUPLICATE TEST — and the difference is the
// whole point of this file.
//
// A first version flattened every lot in the cellar into one array and
// deduped THAT, which also re-stamps ids two tobaccos ALREADY share. That is
// a data-loss bug of its own: `session.lotId` is matched by VALUE, so
// re-stamping a valid lot id orphans every session referencing it, and those
// sessions are the user's history. A pre-existing case in
// `migrateData.test.ts` pinned exactly that behaviour ("does not treat the
// same lot id across DIFFERENT tobaccos as a duplicate") and was RIGHT; it
// was nearly overwritten to make the wider repair pass.
//
// So: the counter is seeded from the GLOBAL max lot id and threaded across
// tobaccos, while the duplicate test stays per tobacco. A MINTED id clears
// every lot id anywhere; an EXISTING one is never touched.
//
// THE RESIDUAL IS DISCLOSED, not repaired. A cellar that already carries the
// same lot id under two tobaccos keeps it. The balance invariant keys on
// `tobaccoId|lotId`, so it is unambiguous where the arithmetic happens; the
// trash ops are the ones that can still reach across, and the remedy for that
// belongs at those call sites — scoping them by tobacco — not in a migration
// that rewrites ids nobody asked it to touch. Fixing it destructively is
// strictly worse than the state it fixes.
//
// `dedupeIds` itself was already correct and tested; what was missing was the
// SEED it was called with. The five top-level collections already thread their
// counters (`d.nxT = dedupeIds(d.tobaccos, d.nxT)`) — the lots were the one
// place that did not.

import { describe, it, expect } from "vitest";
import { migrateData } from "../utils.ts";

function lot(over: any = {}) {
  return {
    status: "cellar", weightG: "50", weightInitial: "50",
    datePurchased: "2026-01-01", boxNumber: "", price: "", seller: "",
    ...over,
  };
}
function cellar(tobs: any[]) {
  return {
    tobaccos: tobs, pipes: [], accessories: [], wishlist: [], sessions: [],
    nxT: tobs.length + 1, nxP: 1, nxA: 1, nxJ: 1, nxW: 1,
  } as any;
}
const allLotIds = (d: any) =>
  d.tobaccos.flatMap((t: any) => (t.lots || []).map((l: any) => String(l.id)));

describe("migrateData mints lot ids against the GLOBAL maximum", () => {
  it("two id-less lots under two tobaccos do not both become 1", () => {
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide", lots: [lot()] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot()] },
    ]));
    const ids = allLotIds(d);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size, "the repair minted the same id twice").toBe(2);
  });

  it("an id-less lot never lands on an id another tobacco already uses", () => {
    // The counter must clear EVERY existing lot id, not just the ones in the
    // array being repaired. Ordered so the naive per-array seed would pick 8
    // for the first tobacco and 1 for the second — the collision is with the
    // id that comes LATER in the cellar.
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide", lots: [lot()] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot({ id: 1 })] },
    ]));
    const ids = allLotIds(d);
    expect(new Set(ids).size, "the minted id collided with an existing one").toBe(2);
    expect(ids, "the EXISTING id must survive; only the missing one is minted")
      .toContain("1");
  });

  it("a TRASHED lot's id is cleared too — the trash ops filter across tobaccos", () => {
    // Wider than the `lot-id-unique-global` invariant, which skips soft-deleted
    // lots, because `permanentlyDelete("lot", id)` does not: a minted id
    // landing on a TRASHED lot elsewhere means purging that lot takes this
    // live one with it.
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide",
        lots: [lot({ id: 42, deletedAt: "2026-01-01T00:00:00.000Z" })] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot()] },
    ]));
    const ids = allLotIds(d);
    expect(new Set(ids).size, "the minted id landed on the trashed lot").toBe(2);
    expect(ids).toContain("42");
  });

  it("a duplicate that already SPANS two tobaccos is LEFT ALONE", () => {
    // The reversal, recorded on the assertion. Re-stamping the second lot
    // would silently orphan every session carrying `lotId: "42"` — the app
    // matches that field by value, and nothing warns. A visible duplicate is
    // recoverable; a journal that quietly lost its lot links is not.
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide", lots: [lot({ id: 42 })] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot({ id: 42 })] },
    ]));
    expect(allLotIds(d), "an existing lot id was re-stamped").toEqual(["42", "42"]);
  });

  it("leaves a clean cellar completely alone, and is idempotent", () => {
    // The repair must not renumber lots that are already fine — a lot id is
    // referenced by `session.lotId`, so a gratuitous re-stamp would orphan
    // every session in the journal.
    const before = cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide", lots: [lot({ id: 101 }), lot({ id: 102 })] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot({ id: 201 })] },
    ]);
    const once = migrateData(before);
    expect(allLotIds(once)).toEqual(["101", "102", "201"]);
    const twice = migrateData(once);
    expect(allLotIds(twice)).toEqual(["101", "102", "201"]);
  });

  it("a duplicate WITHIN one tobacco is still repaired", () => {
    // Narrowing the fix must not lose what `dedupeIds` was doing all along:
    // within one tobacco, update/remove/changeLotStatus match by id and would
    // hit both colliding lots.
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide",
        lots: [lot({ id: 5 }), lot({ id: 5 })] },
    ]));
    const ids = allLotIds(d);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0], "the FIRST occurrence keeps its id and its session links").toBe("5");
  });

  it("a non-numeric lot id is left alone, as dedupeIds already promised", () => {
    const d = migrateData(cellar([
      { id: 1, brand: "Halvorsen", name: "Early Tide", lots: [lot({ id: "L-A" })] },
      { id: 2, brand: "Vondel", name: "Kade 12", lots: [lot({ id: "L-B" })] },
    ]));
    expect(allLotIds(d).sort()).toEqual(["L-A", "L-B"]);
  });
});
