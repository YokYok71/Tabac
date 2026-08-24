// The legacy inline-base64 photo migration must write onto the LATEST cellar,
// not onto the snapshot it captured before the IndexedDB round-trip.
//
// THE RACE. The migration effect in App.tsx captures `data`, awaits
// `Promise.all(imgCache.put(...))` — a real IndexedDB transaction per photo —
// and only then builds its payload. Anything the user saved inside that window
// (a rating, a lot, a session, a deletion) is REVERTED by that save, silently,
// because the payload was assembled from the pre-await snapshot. Two other
// startup paths in App.tsx already read the latest data through a ref for
// exactly this reason (the 30-day trash sweep and the orphan photo GC).
//
// WHY A NAIVE REBASE IS NOT ENOUGH, and why this helper matches on
// (collection, id, dataURL) rather than on OBJECT IDENTITY. The old `_swap`
// found its task with `_tasks.find(x => x.item === item)` — a reference
// comparison against the object captured before the await. A concurrent save
// rebuilds those rows (`Object.assign({}, t, …)` all over the stores), so on
// the fresh cellar NOTHING matches and the swap silently becomes a no-op:
// every photo would be written to IndexedDB and then never referenced, so the
// base64 stays inline for ever and the migration never completes. Rebasing
// without re-keying the match trades a visible revert for an invisible
// no-op — worse, not better.
//
// The dataURL is part of the key on purpose: if the user REPLACED that photo
// during the window, the current row no longer carries the base64 we migrated,
// and pointing it at our key would show them a picture they had just changed.
import { describe, it, expect } from "vitest";
import { applyMigratedPhotoKeys } from "../utils";
import { INIT } from "../constants";

const DU = "data:image/jpeg;base64,AAA";
const DU2 = "data:image/jpeg;base64,BBB";

// `any` on purpose: the cases below reassign whole collections to hand-built
// rows (that is what a concurrent save does), and the literal types INIT gives
// those empty arrays would refuse them.
function cellar(overrides: Record<string, any> = {}): any {
  return Object.assign({}, INIT, {
    tobaccos: [{ id: 1, name: "T1", imageUrl: DU, lots: [] }],
    pipes: [{ id: 7, name: "P1", imageUrl: DU2, maintenance: [] }],
    accessories: [],
    wishlist: [],
    sessions: [],
  }, overrides);
}

describe("applyMigratedPhotoKeys", () => {
  it("swaps the inline base64 for the IndexedDB key", () => {
    const out = applyMigratedPhotoKeys(cellar(), [
      { coll: "tobaccos", id: 1, key: "local-photo-1-a", du: DU },
    ]);
    expect(out.tobaccos[0].imageUrl).toBe("local-photo-1-a");
    // Untouched collections keep their values.
    expect(out.pipes[0].imageUrl).toBe(DU2);
  });

  // THE LOAD-BEARING CASE. A concurrent save replaced every row object, so an
  // identity-keyed match finds nothing. Matching on (collection, id, dataURL)
  // still lands the swap AND keeps the concurrent edit.
  it("still swaps when a concurrent save replaced the row objects", () => {
    const fresh = cellar();
    // What a save does: new array, new object per row, one field changed.
    fresh.tobaccos = [Object.assign({}, fresh.tobaccos[0], { rating: 5 })];
    fresh.sessions = [{ id: 9, date: "2026-01-01", tobaccoId: 1, pipeId: 7 }];

    const out = applyMigratedPhotoKeys(fresh, [
      { coll: "tobaccos", id: 1, key: "local-photo-1-a", du: DU },
    ]);
    expect(out.tobaccos[0].imageUrl).toBe("local-photo-1-a");
    // The concurrent edit SURVIVES — that is the whole point of rebasing.
    expect(out.tobaccos[0].rating).toBe(5);
    expect(out.sessions).toHaveLength(1);
  });

  // The user replaced the photo while the write was in flight: the row no
  // longer carries the base64 we persisted, so pointing it at our key would
  // show a picture they had just changed.
  it("does NOT swap when the row's imageUrl changed during the write", () => {
    const fresh = cellar();
    fresh.tobaccos = [Object.assign({}, fresh.tobaccos[0], { imageUrl: "local-photo-new" })];
    const out = applyMigratedPhotoKeys(fresh, [
      { coll: "tobaccos", id: 1, key: "local-photo-1-a", du: DU },
    ]);
    expect(out.tobaccos[0].imageUrl).toBe("local-photo-new");
  });

  // The row was deleted while the write was in flight.
  it("ignores a task whose row is gone, without throwing", () => {
    const fresh = cellar({ tobaccos: [] });
    const out = applyMigratedPhotoKeys(fresh, [
      { coll: "tobaccos", id: 1, key: "local-photo-1-a", du: DU },
    ]);
    expect(out.tobaccos).toHaveLength(0);
  });

  // NON-VACUITY for the caller's save guard: nothing applied must return the
  // SAME object, so the migration cannot dirty the cellar (and trigger a cloud
  // save) on every launch when there is nothing left to migrate.
  it("returns the SAME object when nothing applies", () => {
    const fresh = cellar();
    expect(applyMigratedPhotoKeys(fresh, [])).toBe(fresh);
    expect(
      applyMigratedPhotoKeys(fresh, [
        { coll: "tobaccos", id: 999, key: "local-photo-x", du: DU },
      ]),
    ).toBe(fresh);
  });

  // NON-VACUITY: the ordinary multi-collection case still works, and each
  // collection is keyed independently (id 1 in tobaccos is not id 1 in pipes).
  it("applies across collections and never crosses them", () => {
    const fresh = cellar();
    fresh.pipes = [{ id: 1, name: "P-one", imageUrl: DU, maintenance: [] }];
    const out = applyMigratedPhotoKeys(fresh, [
      { coll: "tobaccos", id: 1, key: "local-photo-tob", du: DU },
      { coll: "pipes", id: 1, key: "local-photo-pipe", du: DU },
    ]);
    expect(out.tobaccos[0].imageUrl).toBe("local-photo-tob");
    expect(out.pipes[0].imageUrl).toBe("local-photo-pipe");
  });
});

describe("App wires the migration onto the freshest cellar", () => {
  it("builds its payload from latestData(), not from the captured snapshot", () => {
    const src = blankComments(
      require("node:fs").readFileSync(
        require("node:path").join(process.cwd(), "src/App.tsx"),
        "utf8",
      ),
    );
    // The migration block is identified by its unique helper call.
    const i = src.indexOf("applyMigratedPhotoKeys(");
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, i - 400), i + 400);
    // The base is the freshest cellar, and the pre-await snapshot is NOT
    // spread into the payload any more.
    expect(block).toMatch(/latestData\(\)/);
    expect(block).not.toMatch(/Object\.assign\(\{\}, data,/);
    // And the identity-keyed match must be gone for good.
    expect(src).not.toMatch(/_tasks\.find\([^)]*x\.item === item/);
  });
});

// Comments explain the fix and NAME what they replaced, so a source assertion
// that reads them would pass on prose alone (the documented trap).
function blankComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}
