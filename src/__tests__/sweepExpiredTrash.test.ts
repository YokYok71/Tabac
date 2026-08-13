import { describe, it, expect } from "vitest";
import { sweepExpiredTrash } from "../utils";

// Cutoff: rows with deletedAt <= this are purged.
const CUTOFF = Date.parse("2026-06-01T00:00:00Z");
const OLD = "2026-01-01T00:00:00Z";   // <= cutoff → expired
const RECENT = "2026-07-01T00:00:00Z"; // > cutoff → kept

describe("sweepExpiredTrash (30-day Trash retention)", () => {
  it("returns changed=false and the same ref when nothing is expired", () => {
    const snap = {
      tobaccos: [{ id: 1, lots: [] }],
      pipes: [{ id: 2, deletedAt: RECENT }],
      wishlist: [], accessories: [], sessions: [],
    };
    const r = sweepExpiredTrash(snap, CUTOFF);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(snap);
  });

  it("drops expired top-level rows but keeps fresh ones", () => {
    const snap = {
      tobaccos: [{ id: 1, lots: [] }, { id: 2, deletedAt: OLD, lots: [] }, { id: 3, deletedAt: RECENT, lots: [] }],
      pipes: [{ id: 10, deletedAt: OLD }],
      wishlist: [{ id: 20, deletedAt: OLD }],
      accessories: [{ id: 30 }],
      sessions: [{ id: 40, deletedAt: OLD }, { id: 41 }],
    };
    const r = sweepExpiredTrash(snap, CUTOFF);
    expect(r.changed).toBe(true);
    expect(r.next.tobaccos.map((t: any) => t.id)).toEqual([1, 3]); // 2 (old) purged, 3 (recent) kept
    expect(r.next.pipes).toHaveLength(0);
    expect(r.next.wishlist).toHaveLength(0);
    expect(r.next.accessories).toHaveLength(1);
    expect(r.next.sessions.map((s: any) => s.id)).toEqual([41]);
  });

  it("purges an expired lot and orphanises sessions that referenced it", () => {
    const snap = {
      tobaccos: [{ id: 1, lots: [
        { id: "L1", deletedAt: OLD },
        { id: "L2" },
      ] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 40, lotId: "L1", weightG: "3" }, // its lot is purged → lotId cleared
        { id: 41, lotId: "L2", weightG: "3" }, // its lot survives → untouched
      ],
    };
    const r = sweepExpiredTrash(snap, CUTOFF);
    expect(r.changed).toBe(true);
    expect(r.next.tobaccos[0].lots.map((l: any) => l.id)).toEqual(["L2"]);
    expect(r.next.sessions.find((s: any) => s.id === 40).lotId).toBe("");
    expect(r.next.sessions.find((s: any) => s.id === 41).lotId).toBe("L2");
  });

  it("clears session.lotId for a lot inside a PURGED tobacco (parity with emptyTrash)", () => {
    // Whole tobacco trashed + expired → purged. Its ride-along lot (no deletedAt
    // of its own) vanishes with it, so referencing sessions must be orphaned —
    // earlier the auto-sweep left a dangling lotId here.
    const snap = {
      tobaccos: [
        { id: 1, brand: "B", name: "N", deletedAt: OLD, lots: [{ id: "LX", weightG: "20" }] },
        { id: 2, brand: "B2", name: "N2", lots: [{ id: "LY", weightG: "20" }] },
      ],
      pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 50, lotId: "LX", weightG: "3" }, // lot lived in the purged tobacco → cleared
        { id: 51, lotId: "LY", weightG: "3" }, // live tobacco's lot → untouched
      ],
    };
    const r = sweepExpiredTrash(snap, CUTOFF);
    expect(r.changed).toBe(true);
    expect(r.next.tobaccos.map((t: any) => t.id)).toEqual([2]); // tobacco 1 purged
    expect(r.next.sessions.find((s: any) => s.id === 50).lotId).toBe("");
    expect(r.next.sessions.find((s: any) => s.id === 51).lotId).toBe("LY");
  });

  it("refreshes the snapshot on a session pointing at a purged tobacco", () => {
    const snap = {
      tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", imageUrl: "local-photo-x", deletedAt: OLD, lots: [] }],
      pipes: [], wishlist: [], accessories: [],
      sessions: [{ id: 40, tobaccoId: 1, tobaccoSnapshot: { brand: "old", name: "old", imageUrl: "" } }],
    };
    const r = sweepExpiredTrash(snap, CUTOFF);
    expect(r.changed).toBe(true);
    expect(r.next.tobaccos).toHaveLength(0); // tobacco purged
    // session kept, snapshot refreshed to the tobacco's last-known state
    expect(r.next.sessions[0].tobaccoSnapshot).toMatchObject({ brand: "Brackwater", name: "Duskfall", imageUrl: "local-photo-x" });
  });

  it("treats an unparseable deletedAt as fresh (never purges garbage timestamps)", () => {
    const snap = { tobaccos: [{ id: 1, deletedAt: "not-a-date", lots: [] }], pipes: [], wishlist: [], accessories: [], sessions: [] };
    expect(sweepExpiredTrash(snap, CUTOFF).changed).toBe(false);
  });
});
