// A primitive inside `data.pipes` made migrateData THROW,
// and what that costs depends on which path called it.
//
//   • LOAD: the .catch fires, the app boots on INIT, and the first save
//     overwrites the intact blob — the whole cellar, gone (a known
//     shape through a different door).
//   • CLOUD RESTORE: `stageImport(…, {autoApply:"replace"})` has no guard at
//     all, so the tap on « Restaurer » in the cloud-newer banner simply died,
//     with nothing on screen.
//
// REPRODUCED before fixing, across all five collections × three primitive
// kinds. ONLY `pipes` threw:
//     TypeError: Cannot create property 'maintenance' on number '5'
//     TypeError: Cannot assign to read only property 'length' of string 'x'
// (`length` is in `_PIPE_STR_FIELDS`, and assigning any property of a
// primitive throws in strict mode — ES modules are strict.)
//
// The other four SURVIVED, and that is luck, not design: they happen to write
// nothing unconditionally today, so the next field added to any of them
// re-opens the hole. Hence one rule at the top for all five rather than a
// guard bolted onto the pipe loop — and hence the cases below cover the four
// that never threw, which is where the regression would appear.

import { describe, it, expect } from "vitest";
import { migrateData } from "../utils";

const KINDS: Array<[string, any]> = [
  ["number", 5],
  ["string", "x"],
  ["boolean", true],
  ["null", null],
  ["nested array", [1, 2]],
];

const COLLECTIONS = ["tobaccos", "pipes", "wishlist", "accessories", "sessions"];

describe("migrateData survives a primitive row", () => {
  for (const col of COLLECTIONS) {
    for (const [label, val] of KINDS) {
      it(`${col}: a ${label} element neither throws nor survives`, () => {
        let out: any;
        expect(() => { out = migrateData({ [col]: [val] } as any); }).not.toThrow();
        expect(out[col], `${col} must be an array`).toEqual([]);
      });
    }
  }

  it("keeps the real rows beside the junk — this is a filter, not a bail-out", () => {
    const out: any = migrateData({
      pipes: [5, { id: 1, brand: "Halvorsen", name: "Sherlock" }, "x", null],
      tobaccos: [{ id: 1, brand: "B", name: "N", lots: [] }, true],
    } as any);
    expect(out.pipes).toHaveLength(1);
    expect(out.pipes[0].name).toBe("Sherlock");
    expect(out.tobaccos).toHaveLength(1);
  });

  it("DROPS rather than coerces to {} — a ghost row is worse than a missing one", () => {
    // `{}` would be minted an id by dedupeIds and shown to the user as a blank
    // entry they never created, in a cellar they are already trying to repair.
    // A primitive carries nothing to recover, so there is nothing to keep.
    const out: any = migrateData({ pipes: [7] } as any);
    expect(out.pipes).toEqual([]);
    expect(out.nxP, "and no id was spent on it").toBe(1);
  });

  it("stays idempotent — migrateData ∘ migrateData is unchanged", () => {
    const once: any = migrateData({ pipes: [5, { id: 1, brand: "B", name: "N" }] } as any);
    const twice: any = migrateData(JSON.parse(JSON.stringify(once)));
    expect(twice.pipes).toEqual(once.pipes);
  });

  it("the pipe loop specifically — the one that actually threw", () => {
    // Pinned on its own so a future refactor that moves the filter but keeps
    // the pipe loop's unconditional writes fails HERE, naming the collection.
    expect(() => migrateData({ pipes: ["x"] } as any)).not.toThrow();
    expect(() => migrateData({ pipes: [5] } as any)).not.toThrow();
  });
});
