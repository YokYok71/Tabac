// WORK DONE, NOT MILLISECONDS.
//
// A timing assertion flakes on shared CI, so each case here counts the WORK a
// computation performs — the shape this repo already uses for the pipe
// maintenance guard. What is pinned is linear-vs-quadratic and
// once-vs-per-item, which is the property that regressed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computePipeUsageProfile, buildPipeCategoryIndex } from "../utils/ghosting.ts";
import { ENTER_MAX_DELAY_MS } from "../components/curator/primitives.tsx";

function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// Sessions whose `pipeId` counts every read. One pass over the array reads it
// once per session; one pass PER PIPE reads it `pipes x sessions` times.
function countingSessions(n: number, pipes: number) {
  let reads = 0;
  const arr = Array.from({ length: n }, (_, i) => {
    const pid = String(1 + (i % pipes));
    return {
      id: i + 1, date: "2026-01-01", tobaccoId: String(1 + (i % 3)),
      get pipeId() { reads++; return pid; },
    };
  });
  return { arr, reads: () => reads };
}
const TOBS = [
  { id: "1", category: "Virginia" },
  { id: "2", category: "Latakia" },
  { id: "3", category: "Anglais" },
];

describe("the per-pipe family tally is ONE pass over the sessions", () => {
  it("reads each session's pipe once, not once per pipe", () => {
    // MEASURED before the fix: 200 pipes x 5000 sessions took 61.8 ms, against
    // 0.96 ms for `computePipeRest` and 2.23 ms for the maintenance reminders
    // on the identical inputs — the two siblings in the same component, both
    // of which hoist their index. `PipesListView`'s memo depends on all three
    // liveData arrays, so it re-paid that on every save, from every screen.
    const PIPES = 20, SESSIONS = 400;
    const { arr, reads } = countingSessions(SESSIONS, PIPES);
    const idx = buildPipeCategoryIndex(arr, TOBS);
    const afterIndex = reads();
    for (let p = 1; p <= PIPES; p++) computePipeUsageProfile(String(p), arr, TOBS, idx);
    expect(afterIndex, "the index itself must be a single pass").toBe(SESSIONS);
    expect(reads(), "a pipe re-scanned the sessions despite the index").toBe(SESSIONS);
  });

  it("…and without an index it still works, one pipe at a time", () => {
    // The single-pipe callers (the fiche) pass nothing and must be unchanged.
    const { arr } = countingSessions(60, 3);
    const prof = computePipeUsageProfile("1", arr, TOBS);
    expect(prof.total).toBe(20);
    expect(prof.dominant).toBeTruthy();
  });

  it("the indexed and unindexed answers are identical", () => {
    // Non-vacuity for the whole change: an index that produced a DIFFERENT
    // tally would still be one pass, and would silently relabel every pipe.
    const { arr } = countingSessions(300, 7);
    const idx = buildPipeCategoryIndex(arr, TOBS);
    for (let p = 1; p <= 7; p++) {
      const a = computePipeUsageProfile(String(p), arr, TOBS);
      const b = computePipeUsageProfile(String(p), arr, TOBS, idx);
      expect(b).toEqual(a);
    }
  });

  it("a pipe absent from the index reports empty, not a crash", () => {
    const { arr } = countingSessions(30, 2);
    const idx = buildPipeCategoryIndex(arr, TOBS);
    expect(computePipeUsageProfile("999", arr, TOBS, idx).total).toBe(0);
  });

  it("the index is prototype-safe on both keys", () => {
    // Same reasoning as the function it replaces: both the pipe id and the
    // category come from user data, and a JSON restore can carry "__proto__".
    const sessions = [{ id: 1, date: "2026-01-01", tobaccoId: "p", pipeId: "__proto__" }];
    const tobs = [{ id: "p", category: "__proto__" }];
    const idx = buildPipeCategoryIndex(sessions, tobs);
    const prof = computePipeUsageProfile("__proto__", sessions, tobs, idx);
    expect(prof.total).toBe(1);
    expect(prof.dominant).toBe("__proto__");
  });

  it("the view builds the index once, outside the per-pipe loop", () => {
    const src = blankComments(readFileSync("src/views/curator/PipesListView.tsx", "utf8"));
    const build = src.indexOf("buildPipeCategoryIndex(");
    const loop = src.indexOf("(data?.pipes || []).forEach");
    expect(build, "the view does not build an index at all").toBeGreaterThan(-1);
    expect(build, "the index is built INSIDE the loop").toBeLessThan(loop);
  });
});

describe("the journal sort does not put a linear lookup in the comparator", () => {
  // MEASURED at 5000 sessions x 300 tobaccos: sorting by date 6.2 ms, sorting
  // by tobacco 257 ms — 41x — and it doubled on EITHER axis. `sortBy` is local
  // state, but the view never unmounts, so once picked it re-paid on every
  // save from any screen.
  const src = blankComments(readFileSync("src/views/curator/JournalView.tsx", "utf8"));

  it("builds a label Map for the tobacco and pipe orders", () => {
    expect(src).toMatch(/const tobLabel = new Map<string, string>\(\)/);
    expect(src).toMatch(/const pipeLabel = new Map<string, string>\(\)/);
  });

  it("and neither comparator calls the linear finder any more", () => {
    // `tobOf` / `pipeOf` are `.find` over the whole collection. They stay for
    // the RENDER path, where they run once per visible row; what they must not
    // do is run twice per COMPARISON.
    const tobSort = src.slice(src.indexOf('sortBy === "tobacco"'), src.indexOf('sortBy === "pipe"'));
    const pipeSort = src.slice(src.indexOf('sortBy === "pipe"'), src.indexOf("return arr;"));
    expect(tobSort, "fixture is stale — the tobacco branch was not found").toContain("arr.sort");
    expect(pipeSort).toContain("arr.sort");
    expect(tobSort.slice(tobSort.indexOf("arr.sort"))).not.toMatch(/tobOf\(/);
    expect(pipeSort.slice(pipeSort.indexOf("arr.sort"))).not.toMatch(/pipeOf\(/);
  });
});

describe("the catalogue owned/wished sets do not re-resolve on every save", () => {
  const src = blankComments(readFileSync("src/views/curator/CatalogView.tsx", "utf8"));

  it("they key on the collection, not on the whole cellar", () => {
    // `data` changes identity on EVERY save, and `db` is set on the first
    // visit and never cleared (the view self-gates rather than unmounting), so
    // this re-resolved every tobacco against the catalogue on every star tap,
    // from any screen. Cost is per MISS, and a miss falls through the full
    // fuzzy ladder: MEASURED at 300 tobaccos against a 20 000-blend catalogue,
    // 1 309 ms — and 145 ms even against a 1 594-blend one.
    expect(src).toMatch(/\}, \[db, tobList\]\)/);
    expect(src).toMatch(/\}, \[db, wishList\]\)/);
    expect(src, "still keyed on the whole cellar").not.toMatch(/\}, \[db, data\]\)/);
  });
});

describe("an entry animation cannot be scheduled minutes out", () => {
  it("the cap is small enough to be invisible and large enough to stagger", () => {
    // Every list computes its delay from the row index (`100 + idx * 50`), so
    // the stagger was unbounded: MEASURED on a 5000-session journal, the last
    // card's timer fired at 250 SECONDS, each row its own setTimeout +
    // setState over a 165 000-node tree.
    expect(ENTER_MAX_DELAY_MS).toBeGreaterThanOrEqual(400);
    expect(ENTER_MAX_DELAY_MS).toBeLessThanOrEqual(1200);
  });

  it("the cap lives in the primitive, so every call site inherits it", () => {
    // Capping the index at each call site would cover the six current lists
    // and no future one. The rule belongs to the animation.
    const src = blankComments(readFileSync("src/components/curator/primitives.tsx", "utf8"));
    expect(src).toMatch(/const delay = Math\.min\(ENTER_MAX_DELAY_MS, Number\(rawDelay\) \|\| 0\)/);
  });

  it("the lists still stagger — the cap is not a flattening", () => {
    // Non-vacuity: a cap of 0 would pass the "not minutes out" case above and
    // silently delete the entry animation from the whole app.
    const src = blankComments(readFileSync("src/views/curator/InventoryListView.tsx", "utf8"));
    expect(src).toMatch(/useEnter\(100 \+ idx \* 50/);
    expect(ENTER_MAX_DELAY_MS / 50).toBeGreaterThan(8);   // at least ~8 staggered rows
  });
});
