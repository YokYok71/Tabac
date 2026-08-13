// refreshSnapshotsForRemoval — extracted from App.tsx.
// Pure helper, no React. Used by every removal path (soft-delete in
// the stores, permanent-delete in App.tsx, emptyTrash, 30-day startup
// cleanup) to lock in the entity's latest `{brand, name, imageUrl}`
// onto the snapshot of every referencing session — so the journal
// keeps showing what the user was looking at the moment the entity
// left the live view.

import { describe, it, expect } from "vitest";
import { refreshSnapshotsForRemoval } from "../utils";

describe("refreshSnapshotsForRemoval — happy paths", () => {
  it("returns the input ref unchanged when no sessions match", () => {
    const sessions = [{ id: 1, tobaccoId: 99, date: "2025-01-01" }];
    const tobs = [{ id: 1, brand: "X", name: "Y", imageUrl: "" }];
    expect(refreshSnapshotsForRemoval(sessions, tobs, [])).toBe(sessions);
  });

  it("returns the input ref unchanged when both deleted lists are empty", () => {
    const sessions = [{ id: 1, tobaccoId: 1, date: "2025-01-01" }];
    expect(refreshSnapshotsForRemoval(sessions, [], [])).toBe(sessions);
  });

  it("returns the input ref unchanged when sessions is empty / null", () => {
    expect(refreshSnapshotsForRemoval([], [{ id: 1 }], [])).toEqual([]);
    expect(refreshSnapshotsForRemoval(null as any, [{ id: 1 }], [])).toBeNull();
  });
});

describe("refreshSnapshotsForRemoval — tobacco snapshot refresh", () => {
  it("stamps the tabac's current brand/name/imageUrl onto referencing sessions", () => {
    const sessions = [
      { id: 100, tobaccoId: 1, pipeId: "", date: "2025-01-01",
        tobaccoSnapshot: { brand: "OldBrand", name: "OldName",
                           imageUrl: "local-photo-old" } },
    ];
    const tobs = [{
      id: 1, brand: "NewBrand", name: "NewName",
      imageUrl: "local-photo-new",
    }];
    const out = refreshSnapshotsForRemoval(sessions, tobs, []);
    expect(out).not.toBe(sessions);
    expect(out[0].tobaccoSnapshot).toEqual({
      brand: "NewBrand", name: "NewName", imageUrl: "local-photo-new",
    });
  });

  it("fills imageUrl with '' when the entity has no image", () => {
    const sessions = [{ id: 100, tobaccoId: 1, date: "2025-01-01" }];
    const tobs = [{ id: 1, brand: "X", name: "Y" }];
    const out = refreshSnapshotsForRemoval(sessions, tobs, []);
    expect(out[0].tobaccoSnapshot).toEqual({
      brand: "X", name: "Y", imageUrl: "",
    });
  });

  it("matches string-stored tobaccoId against numeric entity id", () => {
    const sessions = [{ id: 100, tobaccoId: "1", date: "2025-01-01" }];
    const tobs = [{ id: 1, brand: "X", name: "Y", imageUrl: "img" }];
    const out = refreshSnapshotsForRemoval(sessions, tobs, []);
    expect(out[0].tobaccoSnapshot.imageUrl).toBe("img");
  });
});

describe("refreshSnapshotsForRemoval — pipe snapshot refresh", () => {
  it("stamps the pipe's current brand/name/imageUrl onto referencing sessions", () => {
    const sessions = [
      { id: 100, tobaccoId: "", pipeId: 10, date: "2025-01-01" },
    ];
    const pipes = [{
      id: 10, brand: "Halvorsen", name: "Sherlock",
      imageUrl: "https://example.com/p.jpg",
    }];
    const out = refreshSnapshotsForRemoval(sessions, [], pipes);
    expect(out[0].pipeSnapshot).toEqual({
      brand: "Halvorsen", name: "Sherlock",
      imageUrl: "https://example.com/p.jpg",
    });
  });

  it("refreshes both tabac and pipe snapshots on the same session in one pass", () => {
    const sessions = [
      { id: 100, tobaccoId: 1, pipeId: 10, date: "2025-01-01" },
    ];
    const tobs = [{ id: 1, brand: "T", name: "TN", imageUrl: "ti" }];
    const pipes = [{ id: 10, brand: "P", name: "PN", imageUrl: "pi" }];
    const out = refreshSnapshotsForRemoval(sessions, tobs, pipes);
    expect(out[0].tobaccoSnapshot).toEqual({ brand: "T", name: "TN", imageUrl: "ti" });
    expect(out[0].pipeSnapshot).toEqual({ brand: "P", name: "PN", imageUrl: "pi" });
  });
});

describe("refreshSnapshotsForRemoval — isolation", () => {
  it("does not touch sessions referencing other entities", () => {
    const sessions = [
      { id: 100, tobaccoId: 1, date: "2025-01-01" }, // matches tabac 1
      { id: 101, tobaccoId: 2, date: "2025-01-02" }, // matches tabac 2 (not in deleted)
    ];
    const tobs = [{ id: 1, brand: "X", name: "Y", imageUrl: "" }];
    const out = refreshSnapshotsForRemoval(sessions, tobs, []);
    expect(out[0].tobaccoSnapshot).toBeTruthy();
    expect(out[1].tobaccoSnapshot).toBeUndefined();
  });

  it("does not mutate the input arrays", () => {
    const original = { id: 100, tobaccoId: 1, date: "2025-01-01" };
    const sessions = [original];
    const tobs = [{ id: 1, brand: "X", name: "Y", imageUrl: "" }];
    refreshSnapshotsForRemoval(sessions, tobs, []);
    // The original session object stays without tobaccoSnapshot.
    expect((original as any).tobaccoSnapshot).toBeUndefined();
  });
});
