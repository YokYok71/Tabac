import { describe, it, expect } from "vitest";
import { computeSmokeSuggestions, suggestRestedPipe, rotateDailyHero, pickDailyTie, dailyWindow, seededShuffle, mulberry32, FEATURE_ROTATE_MS } from "../utils/suggest";

const DAY = 86400000;

const NOW = new Date("2026-06-12T12:00:00Z").getTime();

function tob(over: any = {}): any {
  return {
    id: 1, name: "Test", brand: "B", rating: 0, agingMax: "",
    lots: [{ status: "jar", weightG: "50", datePurchased: "2026-01-01" }],
    ...over,
  };
}

describe("computeSmokeSuggestions — eligibility", () => {
  it("returns empty for null / empty inventory", () => {
    expect(computeSmokeSuggestions(null, null, { now: NOW })).toEqual([]);
    expect(computeSmokeSuggestions([], [], { now: NOW })).toEqual([]);
  });

  it("excludes tobaccos with no usable lot (finished or zero weight)", () => {
    const tobs = [
      tob({ id: 1, lots: [{ status: "finished", weightG: "0" }] }),
      tob({ id: 2, lots: [{ status: "jar", weightG: "0" }] }),
      tob({ id: 3, lots: [] }),
      tob({ id: 4, lots: [{ status: "cellar", weightG: "100" }] }),
    ];
    const res = computeSmokeSuggestions(tobs, [], { now: NOW });
    expect(res.map(s => s.tobaccoId)).toEqual(["4"]);
  });

  it("caps the result at max (default 3)", () => {
    const tobs = [1, 2, 3, 4, 5].map(i => tob({ id: i }));
    expect(computeSmokeSuggestions(tobs, [], { now: NOW })).toHaveLength(3);
    expect(computeSmokeSuggestions(tobs, [], { now: NOW, max: 2 })).toHaveLength(2);
  });
});

describe("computeSmokeSuggestions — scoring signals", () => {
  it("ranks an overaged tobacco above a plain one", () => {
    const tobs = [
      tob({ id: 1 }),
      tob({
        id: 2, agingMax: "2",
        lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }],
      }),
    ];
    const res = computeSmokeSuggestions(tobs, [], { now: NOW });
    expect(res[0]!.tobaccoId).toBe("2");
    expect(res[0]!.reasons).toContain("aging_overaged");
  });

  it("flags a nearly-empty jar (threshold-aware)", () => {
    const tobs = [
      tob({ id: 1, lots: [{ status: "jar", weightG: "8" }] }),
      tob({ id: 2, lots: [{ status: "jar", weightG: "200" }] }),
    ];
    const res = computeSmokeSuggestions(tobs, [], { now: NOW, lowLotThreshold: 10 });
    expect(res[0]!.tobaccoId).toBe("1");
    expect(res[0]!.reasons).toContain("lot_low");
    expect(res[1]!.reasons).not.toContain("lot_low");
  });

  it("a nearly-empty CELLAR lot does not count as lot_low (sealed tin can't dry out)", () => {
    const res = computeSmokeSuggestions(
      [tob({ id: 1, lots: [{ status: "cellar", weightG: "5" }] })],
      [], { now: NOW, lowLotThreshold: 10 },
    );
    expect(res[0]!.reasons).not.toContain("lot_low");
  });

  it("marks never-smoked and not-recent correctly", () => {
    const tobs = [tob({ id: 1 }), tob({ id: 2 }), tob({ id: 3 })];
    const sessions = [
      { tobaccoId: 2, date: "2026-06-11" },  // yesterday
      { tobaccoId: 3, date: "2026-01-01" },  // 162 days ago
    ];
    const res = computeSmokeSuggestions(tobs, sessions, { now: NOW });
    const byId = Object.fromEntries(res.map(s => [s.tobaccoId, s]));
    expect(byId["1"]!.reasons).toContain("never_smoked");
    expect(byId["1"]!.daysSinceSmoked).toBeNull();
    expect(byId["2"]!.reasons).not.toContain("not_recent");
    expect(byId["2"]!.daysSinceSmoked).toBe(1);
    expect(byId["3"]!.reasons).toContain("not_recent");
  });

  it("ranks a long-unsmoked tobacco above one smoked yesterday (equal rating)", () => {
    const tobs = [tob({ id: 1 }), tob({ id: 2 })];
    const sessions = [
      { tobaccoId: 1, date: "2026-06-11" },
      { tobaccoId: 2, date: "2025-06-11" },
    ];
    const res = computeSmokeSuggestions(tobs, sessions, { now: NOW });
    expect(res[0]!.tobaccoId).toBe("2");
  });

  it("flags rating >= 4 as favorite and boosts the score", () => {
    const tobs = [tob({ id: 1, rating: 5 }), tob({ id: 2, rating: 1 })];
    const res = computeSmokeSuggestions(tobs, [], { now: NOW });
    expect(res[0]!.tobaccoId).toBe("1");
    expect(res[0]!.reasons).toContain("favorite");
    expect(res[1]!.reasons).not.toContain("favorite");
  });

  it("orders reasons by importance (aging first)", () => {
    // aging is cellar-only, so the over-aged lot is "cellar".
    const res = computeSmokeSuggestions(
      [tob({
        id: 1, rating: 5, agingMax: "2",
        lots: [{ status: "cellar", weightG: "5", dateProduction: "2020-01-01" }],
      })],
      [], { now: NOW, lowLotThreshold: 10 },
    );
    expect(res[0]!.reasons[0]).toBe("aging_overaged");
  });

  it("survives a hostile rating value", () => {
    const res = computeSmokeSuggestions(
      [tob({ id: 1, rating: Infinity }), tob({ id: 2, rating: "5" })],
      [], { now: NOW },
    );
    expect(res.every(s => Number.isFinite(s.score))).toBe(true);
  });
});

describe("suggestRestedPipe", () => {
  it("returns null with no active pipes", () => {
    expect(suggestRestedPipe([], [], NOW)).toBeNull();
    expect(suggestRestedPipe([{ id: 1, status: "finished" }], [], NOW)).toBeNull();
    expect(suggestRestedPipe(null, null, NOW)).toBeNull();
  });

  it("prefers the most-rested pipe", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 },
      { id: 2, status: "active", rating: 1 },
    ];
    const sessions = [
      { pipeId: 1, date: "2026-06-11" },  // 1 day
      { pipeId: 2, date: "2026-06-01" },  // 11 days
    ];
    expect(suggestRestedPipe(pipes, sessions, NOW)!.pipeId).toBe("2");
  });

  it("treats never-smoked as the most rested (restDays null)", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 },
      { id: 2, status: "active", rating: 1 },
    ];
    const sessions = [{ pipeId: 1, date: "2026-01-01" }];
    const res = suggestRestedPipe(pipes, sessions, NOW)!;
    expect(res.pipeId).toBe("2");
    expect(res.restDays).toBeNull();
  });

  it("rotates among equally-rested pipes by day, starting from the best-rated", () => {
    const pipes = [
      { id: 1, status: "active", rating: 2 },
      { id: 2, status: "active", rating: 4 },
    ];
    const sessions = [
      { pipeId: 1, date: "2026-06-05" },
      { pipeId: 2, date: "2026-06-05" },
    ]; // both rested 7 days at NOW → tie on rest → rotate (rating no longer gates)
    const a = suggestRestedPipe(pipes, sessions, NOW)!.pipeId;
    const b = suggestRestedPipe(pipes, sessions, NOW + DAY)!.pipeId;
    expect(a).not.toBe(b);
    expect(new Set([a, b])).toEqual(new Set(["1", "2"]));
  });

  it("ignores retired pipes even when most rested", () => {
    const pipes = [
      { id: 1, status: "finished", rating: 5 },
      { id: 2, status: "active", rating: 1 },
    ];
    const sessions = [{ pipeId: 2, date: "2026-06-11" }];
    expect(suggestRestedPipe(pipes, sessions, NOW)!.pipeId).toBe("2");
  });

  it("rotateNow drives the rotation, `now` drives restDays (decoupled)", () => {
    const pipes = [
      { id: 1, status: "active", rating: 2 },
      { id: 2, status: "active", rating: 4 },
    ];
    const sessions = [
      { pipeId: 1, date: "2026-06-05" },
      { pipeId: 2, date: "2026-06-05" },
    ]; // both rested equally at NOW → tie → rotate on the rotation clock
    // Same real clock (NOW) → restDays identical regardless of rotation shift.
    const a = suggestRestedPipe(pipes, sessions, NOW, null, DAY, NOW)!;
    const b = suggestRestedPipe(pipes, sessions, NOW, null, DAY, NOW + DAY)!;
    // The displayed rest count must NOT drift with the rotation shift.
    expect(a.restDays).toBe(b.restDays);
    // But the pick DOES rotate when only rotateNow advances by a bucket.
    expect(a.pipeId).not.toBe(b.pipeId);
    expect(new Set([a.pipeId, b.pipeId])).toEqual(new Set(["1", "2"]));
  });
});

describe("rotateDailyHero", () => {
  const list = ["a", "b", "c", "d", "e"];

  it("returns lists of length <= 1 unchanged", () => {
    expect(rotateDailyHero([], 0)).toEqual([]);
    expect(rotateDailyHero(["x"], 12345)).toEqual(["x"]);
  });

  it("rotates the featured item among the top `pool` by calendar day", () => {
    // day 0 → pick 0 (unchanged), day 1 → index 1 to front, etc.
    expect(rotateDailyHero(list, 0 * DAY, 4)[0]).toBe("a");
    expect(rotateDailyHero(list, 1 * DAY, 4)[0]).toBe("b");
    expect(rotateDailyHero(list, 2 * DAY, 4)[0]).toBe("c");
    expect(rotateDailyHero(list, 3 * DAY, 4)[0]).toBe("d");
    // pool = 4 → day 4 wraps back to index 0
    expect(rotateDailyHero(list, 4 * DAY, 4)[0]).toBe("a");
  });

  it("keeps the non-featured items and never loses one", () => {
    const r = rotateDailyHero(list, 2 * DAY, 4);
    expect(r).toHaveLength(list.length);
    expect([...r].sort()).toEqual([...list].sort());
    expect(r[0]).toBe("c");
  });

  it("is stable within a single day (hero doesn't jump between renders)", () => {
    const morning = 2 * DAY + 3600000;
    const evening = 2 * DAY + 20 * 3600000;
    expect(rotateDailyHero(list, morning, 4)[0]).toBe(rotateDailyHero(list, evening, 4)[0]);
  });

  it("clamps the pool to the list length", () => {
    expect(rotateDailyHero(["a", "b"], 5 * DAY, 4)[0]).toBe("b"); // 5 % 2 = 1
  });

  // optional 12 h cadence so the "Ce soir ?" hero refreshes on the
  // same rhythm as the secondary list + "du moment" picks.
  it("rotates the hero on a 12 h bucket when bucketMs = FEATURE_ROTATE_MS", () => {
    const H12 = FEATURE_ROTATE_MS;
    // Two 12 h halves of the SAME calendar day pick different heroes.
    expect(rotateDailyHero(list, 0 * H12, 4, FEATURE_ROTATE_MS)[0]).toBe("a");
    expect(rotateDailyHero(list, 1 * H12, 4, FEATURE_ROTATE_MS)[0]).toBe("b"); // +12 h
    expect(rotateDailyHero(list, 2 * H12, 4, FEATURE_ROTATE_MS)[0]).toBe("c"); // +24 h
  });

  it("hero falls back to the day bucket when bucketMs is non-positive", () => {
    expect(rotateDailyHero(list, 1 * DAY, 4, 0)[0]).toBe(rotateDailyHero(list, 1 * DAY, 4)[0]);
  });
});

describe("pickDailyTie", () => {
  // sorted best-first; tieKey = the ranking signal (recent count + rating)
  const key = (x: any) => x.n + "|" + x.r;

  it("returns undefined on empty", () => {
    expect(pickDailyTie([], 0, key)).toBeUndefined();
  });

  it("returns the sole leader unchanged when the top key is unique", () => {
    const list = [{ id: "top", n: 5, r: 5 }, { id: "b", n: 2, r: 4 }, { id: "c", n: 2, r: 4 }];
    expect(pickDailyTie(list, 0 * DAY, key)!.id).toBe("top");
    expect(pickDailyTie(list, 9 * DAY, key)!.id).toBe("top"); // never rotates a clear leader
  });

  it("rotates among the top tie-group by calendar day", () => {
    // three tobaccos all with 3 sessions + rating 5 (the user's case)
    const list = [
      { id: "x", n: 3, r: 5 },
      { id: "y", n: 3, r: 5 },
      { id: "z", n: 3, r: 5 },
      { id: "w", n: 1, r: 5 }, // outside the tie group
    ];
    expect(pickDailyTie(list, 0 * DAY, key)!.id).toBe("x");
    expect(pickDailyTie(list, 1 * DAY, key)!.id).toBe("y");
    expect(pickDailyTie(list, 2 * DAY, key)!.id).toBe("z");
    expect(pickDailyTie(list, 3 * DAY, key)!.id).toBe("x"); // wraps (group size 3)
  });

  it("never picks outside the tie group", () => {
    const list = [{ id: "x", n: 3, r: 5 }, { id: "y", n: 3, r: 5 }, { id: "w", n: 1, r: 5 }];
    for (let d = 0; d < 10; d++) {
      expect(pickDailyTie(list, d * DAY, key)!.id).not.toBe("w");
    }
  });

  // The optional bucketMs param rotates the tie-group on a custom
  // cadence. The Home "du moment" picks pass FEATURE_ROTATE_MS (12 h) so the
  // featured tobacco + pipe alternate twice per day instead of once.
  it("rotates on a 12 h bucket when bucketMs = FEATURE_ROTATE_MS", () => {
    const list = [{ id: "x", n: 3, r: 5 }, { id: "y", n: 3, r: 5 }];
    const H12 = 12 * 3600 * 1000;
    expect(FEATURE_ROTATE_MS).toBe(H12);
    // Two picks within the SAME calendar day but different 12 h halves differ.
    expect(pickDailyTie(list, 0 * H12, key, FEATURE_ROTATE_MS)!.id).toBe("x");
    expect(pickDailyTie(list, 1 * H12, key, FEATURE_ROTATE_MS)!.id).toBe("y"); // +12 h → flips
    expect(pickDailyTie(list, 2 * H12, key, FEATURE_ROTATE_MS)!.id).toBe("x"); // +24 h → back
  });

  it("still rotates once per calendar day with the default bucket", () => {
    const list = [{ id: "x", n: 3, r: 5 }, { id: "y", n: 3, r: 5 }];
    // Two picks 6 h apart on the default (day) bucket stay identical.
    expect(pickDailyTie(list, 0, key)!.id).toBe(pickDailyTie(list, 6 * 3600 * 1000, key)!.id);
  });

  // The Home "du moment" picks key the tie on the recent-USE COUNT
  // ONLY (not count + rating). With the old count+rating key, the common
  // "no recent sessions" case (every candidate at count 0 but DIFFERENT
  // ratings) produced a unique top key → the feature was pinned to the
  // highest-rated one and never rotated. A count-only key puts all
  // equally-used candidates in one tie group so they cycle.
  const countKey = (x: any) => String(x.n);
  it("count-only tie-key rotates equally-used candidates that differ only by rating", () => {
    // Sorted best-first by rating within the same (zero) recent count.
    const list = [
      { id: "a", n: 0, r: 5 },
      { id: "b", n: 0, r: 3 },
      { id: "c", n: 0, r: 1 },
    ];
    const H12 = FEATURE_ROTATE_MS;
    const picks = [0, 1, 2, 3].map((h) => pickDailyTie(list, h * H12, countKey, FEATURE_ROTATE_MS)!.id);
    expect(picks).toEqual(["a", "b", "c", "a"]); // whole set cycles every 12 h
  });

  it("count-only tie-key still pins a uniquely most-used candidate", () => {
    const list = [
      { id: "top", n: 4, r: 1 }, // genuinely the most used → stays "du moment"
      { id: "b", n: 1, r: 5 },
      { id: "c", n: 0, r: 5 },
    ];
    for (let h = 0; h < 8; h++) {
      expect(pickDailyTie(list, h * FEATURE_ROTATE_MS, countKey, FEATURE_ROTATE_MS)!.id).toBe("top");
    }
  });
});

describe("suggestRestedPipe — daily rotation among ties", () => {
  it("alternates between two equally-rested (never-smoked, same rating) pipes by day", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 },
      { id: 2, status: "active", rating: 5 },
    ];
    const p0 = suggestRestedPipe(pipes, [], 0 * DAY)!.pipeId;
    const p1 = suggestRestedPipe(pipes, [], 1 * DAY)!.pipeId;
    const p2 = suggestRestedPipe(pipes, [], 2 * DAY)!.pipeId;
    expect(p0).not.toBe(p1);              // alternates
    expect(p2).toBe(p0);                  // 2-pipe cycle
    expect(new Set([p0, p1])).toEqual(new Set(["1", "2"]));
  });

  it("rotates a clear rest leader among the top pool (variety like the tonight tobacco)", () => {
    // Earlier a uniquely most-rested pipe was PINNED forever (pickDailyTie
    // rotated only the exact top-rest tie group, size 1). An earlier release rotates
    // among the top-N most-rested pipes, so the suggestion varies bucket to
    // bucket (and, via the per-launch-shifted clock the Home passes, launch to
    // launch) — the fix for "the same pipe is proposed every relaunch".
    const pipes = [
      { id: 1, status: "active", rating: 5 }, // never smoked → infinitely rested (leader)
      { id: 2, status: "active", rating: 5 },
    ];
    const sessions = [{ pipeId: 2, date: "2026-06-01" }];
    const picks = new Set<string>();
    for (let d = 0; d < 5; d++) {
      picks.add(suggestRestedPipe(pipes, sessions, NOW + d * DAY)!.pipeId);
    }
    expect(picks).toEqual(new Set(["1", "2"]));
  });

  it("rotates on a 12 h cadence when bucketMs = FEATURE_ROTATE_MS", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 },
      { id: 2, status: "active", rating: 5 },
    ]; // both never-smoked → tie → rotate
    const H12 = FEATURE_ROTATE_MS;
    const a = suggestRestedPipe(pipes, [], 0 * H12, null, H12)!.pipeId;
    const b = suggestRestedPipe(pipes, [], 1 * H12, null, H12)!.pipeId;
    const c = suggestRestedPipe(pipes, [], 2 * H12, null, H12)!.pipeId;
    expect(a).not.toBe(b);   // +12 h flips
    expect(c).toBe(a);       // +24 h back (2-pipe cycle)
  });
});

describe("suggestRestedPipe — ghosting exclusion", () => {
  it("skips a pipe flagged as a ghosting risk for tonight's tobacco", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 }, // would ghost (excluded by caller)
      { id: 2, status: "active", rating: 3 },
    ];
    const r = suggestRestedPipe(pipes, [], NOW, new Set(["1"]));
    expect(r!.pipeId).toBe("2");
  });

  it("accepts an array of exclude ids too", () => {
    const pipes = [
      { id: 1, status: "active", rating: 5 },
      { id: 2, status: "active", rating: 5 },
      { id: 3, status: "active", rating: 5 },
    ];
    const r = suggestRestedPipe(pipes, [], 0 * DAY, ["1", "2"]);
    expect(r!.pipeId).toBe("3"); // only pipe 3 survives the filter
  });

  it("ignores the exclusion if it would leave no pipe (a pick beats none)", () => {
    const pipes = [{ id: 1, status: "active", rating: 5 }];
    const r = suggestRestedPipe(pipes, [], NOW, new Set(["1"]));
    expect(r!.pipeId).toBe("1");
  });
});

describe("computeSmokeSuggestions — openOnly + ignoreRating", () => {
  it("openOnly keeps only tobaccos with an OPEN jar lot (weight > 0)", () => {
    const tobs = [
      tob({ id: 1, lots: [{ status: "cellar", weightG: "100" }] }),          // sealed
      tob({ id: 2, lots: [{ status: "jar", weightG: "0" }] }),               // opened but empty
      tob({ id: 3, lots: [{ status: "jar", weightG: "20" }] }),              // OPEN ✓
      tob({ id: 4, lots: [{ status: "finished", weightG: "0" }] }),          // finished
      tob({ id: 5, lots: [{ status: "cellar", weightG: "50" }, { status: "jar", weightG: "5" }] }), // OPEN ✓
    ];
    const ids = computeSmokeSuggestions(tobs, [], { now: NOW, openOnly: true, max: 50 })
      .map(s => s.tobaccoId).sort();
    expect(ids).toEqual(["3", "5"]);
  });

  it("openOnly still excludes a 'don't rebuy' open tobacco", () => {
    const tobs = [
      tob({ id: 1, rebuy: false, lots: [{ status: "jar", weightG: "20" }] }),
      tob({ id: 2, rebuy: null, lots: [{ status: "jar", weightG: "20" }] }),
    ];
    const ids = computeSmokeSuggestions(tobs, [], { now: NOW, openOnly: true, max: 50 }).map(s => s.tobaccoId);
    expect(ids).toEqual(["2"]);
  });

  it("ignoreRating drops the 'favorite' reason and the rating score", () => {
    const tobs = [
      tob({ id: 1, rating: 5, lots: [{ status: "jar", weightG: "20" }] }),
      tob({ id: 2, rating: 0, lots: [{ status: "jar", weightG: "20" }] }),
    ];
    const res = computeSmokeSuggestions(tobs, [], { now: NOW, openOnly: true, ignoreRating: true, max: 50 });
    res.forEach(s => expect(s.reasons).not.toContain("favorite"));
    // With rating ignored and identical everything else, the two scores match
    // (so rating no longer floats id 1 above id 2).
    const byId = Object.fromEntries(res.map(s => [s.tobaccoId, s.score]));
    expect(byId["1"]).toBe(byId["2"]);
  });
});

describe("seededShuffle / mulberry32", () => {
  const list = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("returns [] for empty / null input", () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(null, 1)).toEqual([]);
  });

  it("is deterministic — same seed → same permutation", () => {
    expect(seededShuffle(list, 12345)).toEqual(seededShuffle(list, 12345));
  });

  it("does not mutate the input", () => {
    const copy = list.slice();
    seededShuffle(list, 7);
    expect(list).toEqual(copy);
  });

  it("preserves the exact multiset of elements", () => {
    expect([...seededShuffle(list, 999)].sort()).toEqual([...list].sort());
  });

  it("different seeds generally produce different orders", () => {
    const a = seededShuffle(list, 1).join("");
    const b = seededShuffle(list, 2).join("");
    const c = seededShuffle(list, 3).join("");
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("mulberry32 yields floats in [0, 1)", () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("computeSmokeSuggestions — don't-rebuy exclusion", () => {
  it("excludes a tobacco flagged rebuy=false; keeps null/true", () => {
    const tobs = [
      tob({ id: 1, rebuy: false }),
      tob({ id: 2, rebuy: null }),
      tob({ id: 3, rebuy: true }),
    ];
    const ids = computeSmokeSuggestions(tobs, [], { now: NOW }).map(s => s.tobaccoId);
    expect(ids).not.toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
  });
});

describe("dailyWindow", () => {
  const list = ["a", "b", "c", "d", "e"];

  it("returns [] on empty or non-positive size", () => {
    expect(dailyWindow([], 0, 3)).toEqual([]);
    expect(dailyWindow(list, 0, 0)).toEqual([]);
  });

  it("returns a window of `size` starting at day % length, wrapping", () => {
    expect(dailyWindow(list, 0 * DAY, 3)).toEqual(["a", "b", "c"]);
    expect(dailyWindow(list, 1 * DAY, 3)).toEqual(["b", "c", "d"]);
    expect(dailyWindow(list, 4 * DAY, 3)).toEqual(["e", "a", "b"]); // wraps
  });

  it("caps at the list length when size exceeds it", () => {
    expect(dailyWindow(["x", "y"], 0, 5)).toEqual(["x", "y"]);
  });

  it("is stable within a day", () => {
    expect(dailyWindow(list, 2 * DAY + 3600000, 3)).toEqual(dailyWindow(list, 2 * DAY + 20 * 3600000, 3));
  });

  // custom 12 h cadence + guaranteed rotation when the window is
  // smaller than the pool. This is the exact "Ce soir ?" runners-up scenario:
  // a small pool that used to look frozen because size === pool.length.
  it("rotates on a 12 h bucket when bucketMs = FEATURE_ROTATE_MS", () => {
    const H12 = 12 * 3600 * 1000;
    expect(FEATURE_ROTATE_MS).toBe(H12);
    // Same calendar day, two different 12 h halves → different window content.
    expect(dailyWindow(list, 0 * H12, 3, FEATURE_ROTATE_MS)).toEqual(["a", "b", "c"]);
    expect(dailyWindow(list, 1 * H12, 3, FEATURE_ROTATE_MS)).toEqual(["b", "c", "d"]);
    expect(dailyWindow(list, 2 * H12, 3, FEATURE_ROTATE_MS)).toEqual(["c", "d", "e"]);
  });

  it("a size-2 window over a 3-item pool cycles through all three (the frozen-list fix)", () => {
    const pool = ["a", "b", "c"];
    const H12 = FEATURE_ROTATE_MS;
    const w0 = dailyWindow(pool, 0 * H12, 2, H12);
    const w1 = dailyWindow(pool, 1 * H12, 2, H12);
    const w2 = dailyWindow(pool, 2 * H12, 2, H12);
    expect(w0).toEqual(["a", "b"]);
    expect(w1).toEqual(["b", "c"]);
    expect(w2).toEqual(["c", "a"]); // wraps — every item surfaces over the cycle
    // The set of distinct items shown across the cycle is the whole pool.
    expect(new Set([...w0, ...w1, ...w2])).toEqual(new Set(pool));
  });

  it("falls back to the day bucket when bucketMs is non-positive", () => {
    expect(dailyWindow(list, 1 * DAY, 3, 0)).toEqual(dailyWindow(list, 1 * DAY, 3));
  });
});
