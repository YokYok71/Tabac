// regression lock for the wishlist-photo-loss bug.
//
// Bug history:
//   - The orphan-photo GC `gcOrphans` was introduced, and it runs
//     4 s after mount and deletes any local-photo-* IndexedDB entry
//     not referenced by the live inventory.
//   - A closure bug was then fixed, where the effect captured `data`
//     before load() resolved → empty `referenced` set → photos nuked.
//     The fix gated the effect on `if (!data) return;` AND used a ref
//     to read the latest data inside the timer callback.
//   - The instant-shell change silently re-broke it: `data` was switched
//     from initial `null` to initial `INIT` (empty inventory) for the
//     instant shell. The `if (!data) return;` guard became a no-op
//     because INIT is truthy. The effect fired immediately on mount,
//     `gcRanRef` flipped before load() resolved, and on slow devices
//     the 4 s timer would fire while `dataRefForGc.current` still
//     pointed at the (now stale) INIT snapshot — sending an empty
//     `referenced` set to gcOrphans. Users lost every local-photo-*
//     older than 5 min on cold start. Wishlist photos were the most
//     visible casualty because most users had external URLs for
//     tobacco/pipe imageUrl (untouched by the GC) while wishlist
//     photos were typically downloaded via "paste URL" and stored as
//     local-photo-* keys.
//   - The fix: gate the effect on `loading === false` (the
//     signal that load() actually finished). Dep array changed from
//     `[data]` to `[loading]`. The timer only schedules once the real
//     inventory is in state.
//
// What this test locks (mounts the REAL
// `useOrphanPhotoGC` hook — see the note just below this header — with
// `gcOrphans` mocked; it is NOT a mirror component that re-implements
// the `if (loading) return; … setTimeout(…)` pattern). Verifies:
//     1. While `loading=true`, NO timer is scheduled and gcOrphans is
//        never called. Advancing 10 s changes nothing.
//     2. When `loading` flips to false, the 4 s timer is scheduled.
//     3. Once the 4 s elapses, gcOrphans is called WITH the latest
//        data referenced via the ref.
//     4. A subsequent re-render with new data does NOT re-schedule
//        (single-shot semantics — gcRan stays true).
//
// If a future refactor changes the dep array back to `[data]` or
// drops the `loading` guard, the first assertion fails — the timer
// fires during the loading window and gcOrphans gets the wrong data.

import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useOrphanPhotoGC } from "../hooks/useOrphanPhotoGC.ts";

// The GC moved to a real hook (useOrphanPhotoGC), so this test
// now exercises the ACTUAL production code (via a mocked gcOrphans) instead
// of a hand-kept mirror of the effect. The gating invariants locked below are
// unchanged. If someone drops the `loading` guard or the `[loading]` dep in
// the hook, the first assertion fails here.
const { gcCalls } = vi.hoisted(() => ({ gcCalls: [] as Array<Set<string>> }));
vi.mock("../utils/imgCache.ts", () => ({
  // Clone so each assertion sees the set as it was at call time.
  gcOrphans: (referenced: Set<string>) => {
    gcCalls.push(new Set(referenced));
    return Promise.resolve(0);
  },
}));

beforeEach(() => {
  gcCalls.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Mounts the real hook — nothing mirrored.
function ImgGcHarness({ data, loading }: { data: any; loading: boolean }) {
  useOrphanPhotoGC(data, loading);
  return null;
}

const INIT = { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] };
const LOADED = {
  tobaccos: [{ id: 1, imageUrl: "local-photo-1700000001" }],
  pipes: [{ id: 1, imageUrl: "local-photo-1700000002" }],
  wishlist: [{ id: 1, imageUrl: "local-photo-1700000003" }],
  accessories: [],
  sessions: [],
};

describe("imgGc gating — locks the fix for wishlist-photo loss", () => {
  it("does NOT call gcOrphans while loading=true, even after the 4s timer would have elapsed", () => {
    // INIT data + loading=true: the App.tsx state right after mount,
    // before load() resolves. The GC effect must early-return — if it
    // schedules anything, the test fails.
    render(<ImgGcHarness data={INIT} loading={true} />);
    vi.advanceTimersByTime(10_000);
    expect(gcCalls).toHaveLength(0);
  });

  it("schedules gcOrphans only once loading flips to false, and passes the loaded data refs", () => {
    const { rerender } = render(<ImgGcHarness data={INIT} loading={true} />);
    // The effect is gated — no timer is in flight yet.
    vi.advanceTimersByTime(10_000);
    expect(gcCalls).toHaveLength(0);

    // load() resolved: data is the real inventory, loading flips false.
    rerender(<ImgGcHarness data={LOADED} loading={false} />);
    // Timer is in flight but hasn't fired yet.
    vi.advanceTimersByTime(3_000);
    expect(gcCalls).toHaveLength(0);
    // Past the 4 s mark — gcOrphans fires.
    vi.advanceTimersByTime(2_000);
    expect(gcCalls).toHaveLength(1);
    // And it sees the LOADED refs, not the INIT snapshot.
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-1700000001")).toBe(true);
    expect(seen.has("local-photo-1700000002")).toBe(true);
    expect(seen.has("local-photo-1700000003")).toBe(true);
    expect(seen.size).toBe(3);
  });

  it("reads the LATEST data via ref — so an update right before the timer fires still sees it", () => {
    const { rerender } = render(<ImgGcHarness data={INIT} loading={false} />);
    // Mid-flight: a state update brings in the real data BEFORE the
    // 4 s timer fires. The ref must catch it.
    vi.advanceTimersByTime(2_000);
    rerender(<ImgGcHarness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(3_000);
    expect(gcCalls).toHaveLength(1);
    expect(gcCalls[0]!.size).toBe(3);
  });

  it("is single-shot — a later data change does not re-schedule the GC", () => {
    const { rerender } = render(<ImgGcHarness data={LOADED} loading={false} />);
    vi.advanceTimersByTime(5_000);
    expect(gcCalls).toHaveLength(1);

    // User edits a tabac (new data ref). gcRan is already true → no
    // additional GC fires.
    const more = { ...LOADED, tobaccos: [...LOADED.tobaccos, { id: 2, imageUrl: "local-photo-1700000099" }] };
    rerender(<ImgGcHarness data={more} loading={false} />);
    vi.advanceTimersByTime(10_000);
    expect(gcCalls).toHaveLength(1);
  });

});

// lock the two "keep the photo" reference walks
// the GC must never drop, or the orphan sweep silently deletes photos the app
// still needs:
//   (a) SESSION SNAPSHOTS: a session freezes its tobacco /
//       pipe `imageUrl` into `tobaccoSnapshot` / `pipeSnapshot` so the journal
//       keeps showing the photo AFTER the parent entity is permanently purged.
//       That key exists ONLY in the snapshot — if the walk drops it, the next
//       cold-start GC nukes it and the journal thumbnail goes blank.
//   (b) TRASHED ROWS: App.tsx feeds the RAW (trash-inclusive) `data` to the
//       hook, and the walk has NO `deletedAt` filter — a soft-deleted row is
//       restorable for 30 days, so its photo must survive the sweep.
describe("imgGc reference walk — snapshots + trashed rows are protected", () => {
  it("references session-snapshot photos even when no live entity points at them", () => {
    const data = {
      tobaccos: [],
      pipes: [],
      wishlist: [],
      accessories: [],
      // Fantôme session: the parent tobacco/pipe were permanently deleted,
      // so only the snapshot carries the local-photo key now.
      sessions: [
        {
          id: 1,
          tobaccoId: 99,
          pipeId: 88,
          tobaccoSnapshot: { brand: "X", name: "Y", imageUrl: "local-photo-snap-tob" },
          pipeSnapshot: { brand: "P", name: "Q", imageUrl: "local-photo-snap-pipe" },
        },
      ],
    };
    render(<ImgGcHarness data={data} loading={false} />);
    vi.advanceTimersByTime(5_000);
    expect(gcCalls).toHaveLength(1);
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-snap-tob")).toBe(true);
    expect(seen.has("local-photo-snap-pipe")).toBe(true);
  });

  // An audit found the third walk had no lock at all. A later release gave
  // pipes ADDITIONAL photos (`pipe.photos: string[]`, max 6) that are
  // deliberately never loaded into the global `imgLocal`: the fiche gallery
  // resolves them from IndexedDB on demand, so the ONLY thing standing between
  // those blobs and the orphan sweep is this walk. Deleting the `photos` branch
  // left all 3754 tests green while every extra pipe photo older than 5 minutes
  // became an orphan on the next cold start — the same silent-photo-loss
  // outcome as the original bug, reached through a door opened 129 releases later.
  // The cover photo would survive (it is an `imageUrl`), so the gallery would
  // lose its contents while the card still looked correct.
  it("references a pipe's ADDITIONAL photos, not just its cover", () => {
    const data = {
      tobaccos: [],
      pipes: [
        {
          id: 1,
          imageUrl: "local-photo-cover",
          photos: ["local-photo-extra-1", "local-photo-extra-2"],
        },
      ],
      wishlist: [],
      accessories: [],
      sessions: [],
    };
    render(<ImgGcHarness data={data} loading={false} />);
    vi.advanceTimersByTime(5_000);
    expect(gcCalls).toHaveLength(1);
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-cover")).toBe(true);
    expect(seen.has("local-photo-extra-1")).toBe(true);
    expect(seen.has("local-photo-extra-2")).toBe(true);
    expect(seen.size).toBe(3);
  });

  it("tolerates a malformed photos array without dropping the valid entries", () => {
    const data = {
      tobaccos: [],
      // A forged / legacy payload: photos is present but holds junk alongside
      // one real key. The walk must keep the real one and skip the rest rather
      // than throw (a throw inside the sweep would skip every later entity).
      pipes: [{ id: 1, photos: [null, 42, "http://example.com/x.jpg", "local-photo-ok"] }],
      wishlist: [],
      accessories: [],
      sessions: [],
    };
    render(<ImgGcHarness data={data} loading={false} />);
    vi.advanceTimersByTime(5_000);
    expect(gcCalls).toHaveLength(1);
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-ok")).toBe(true);
    expect(seen.size).toBe(1);
  });

  it("references a soft-deleted (trashed) row's photo — restorable for 30 days", () => {
    const data = {
      tobaccos: [
        { id: 1, imageUrl: "local-photo-live" },
        { id: 2, imageUrl: "local-photo-trashed", deletedAt: "2026-07-01T00:00:00Z" },
      ],
      pipes: [],
      wishlist: [],
      accessories: [],
      sessions: [],
    };
    render(<ImgGcHarness data={data} loading={false} />);
    vi.advanceTimersByTime(5_000);
    expect(gcCalls).toHaveLength(1);
    const seen = gcCalls[0]!;
    expect(seen.has("local-photo-live")).toBe(true);
    // The trashed row's photo must NOT be treated as an orphan.
    expect(seen.has("local-photo-trashed")).toBe(true);
  });
});
