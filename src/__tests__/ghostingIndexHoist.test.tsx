// THE HOME REBUILT THE WHOLE GHOSTING TALLY ONCE PER PIPE, ON EVERY RENDER.
//
// `HomeViewV2` computes two sets in its RENDER BODY — `ghostExclude` (pipes
// that would ghost tonight's tobacco) and `accordPrefer` (pipes whose history
// suits it) — each by filtering every pipe through an O(tobaccos + sessions)
// helper. Neither is a `useMemo`, and neither can be: both sit BELOW the
// view's `if (view !== "home") return null`, where a hook would break hook
// order.
//
// MEASURED by driving the real `App` over a 300-tobacco / 200-pipe /
// 3000-session cellar and counting calls: ONE render that changed no data at
// all (flipping the Settings tab) ran `computePipeGhostingRisk` **200 times**
// and `pipeAccordsWithFamily` **200 times**, ~1.3 M session rows walked, and
// took **53-63 ms**. On the Home that is paid again on every App render — the
// 1 s tasting tick, every save, every banner probe.
//
// The repair is the one this module already documents for
// `computePipeUsageProfile` and that `pipeSessionsSinceMaint` was given before
// it: an OPTIONAL precomputed `PipeCategoryIndex`, built once by the caller.
// `buildPipeCategoryIndex` already existed and already had the right shape;
// these two functions simply never took it.
//
// Two things are locked here, and the second is the one that rots:
//   (1) CORRECTNESS — the indexed answer equals the unindexed one, in both
//       directions (a pipe that accords and one that does not; a risky pairing
//       and a safe one). An index that quietly disagreed would be worse than
//       the cost it saves.
//   (2) WORK — asking about N pipes with an index must NOT walk the sessions
//       N times. Counted as ARRAY READS rather than milliseconds, so it is
//       stable on shared CI (the `pipeMaint` precedent).
//   (3) WIRING — the Home actually builds the index and passes it to BOTH
//       loops. A helper that accepts an index nobody hands it is the shape
//       this repo keeps paying for.

import { describe, it, expect } from "vitest";
import {
  buildPipeCategoryIndex,
  computePipeGhostingRisk,
  pipeAccordsWithFamily,
} from "../utils/ghosting.ts";
import { readFileSync } from "node:fs";

const TOBS = [
  { id: 1, category: "Latakia" },
  { id: 2, category: "Virginia" },
  { id: 3, category: "Aromatique" },
];

// Pipe 1: dedicated to Latakia (5 of 5). Pipe 2: mixed, no dominance.
// Pipe 3: dedicated to Virginia (4 of 4).
function sessions() {
  const out: any[] = [];
  for (let i = 0; i < 5; i++) out.push({ id: 100 + i, pipeId: 1, tobaccoId: 1 });
  out.push({ id: 200, pipeId: 2, tobaccoId: 1 });
  out.push({ id: 201, pipeId: 2, tobaccoId: 2 });
  out.push({ id: 202, pipeId: 2, tobaccoId: 3 });
  for (let i = 0; i < 4; i++) out.push({ id: 300 + i, pipeId: 3, tobaccoId: 2 });
  return out;
}

/** An array that tallies every element read, so WORK can be asserted. */
function counting(rows: any[]) {
  let reads = 0;
  // A real array whose ELEMENT access is instrumented — work, not milliseconds,
  // so the assertion is stable on shared CI.
  const proxy = new Proxy(rows.slice(), {
    get(target, prop) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) reads++;
      return (target as any)[prop];
    },
  });
  return { arr: proxy as any[], reads: () => reads };
}

describe("the ghosting helpers take a precomputed index", () => {
  it("the indexed answer equals the unindexed one — accord, both directions", () => {
    const ss = sessions();
    const idx = buildPipeCategoryIndex(ss, TOBS);

    // Pipe 1 IS dedicated to Latakia.
    expect(pipeAccordsWithFamily(1, "Latakia", ss, TOBS)).toBe(true);
    expect(pipeAccordsWithFamily(1, "Latakia", ss, TOBS, idx)).toBe(true);
    // …and NOT to Virginia.
    expect(pipeAccordsWithFamily(1, "Virginia", ss, TOBS)).toBe(false);
    expect(pipeAccordsWithFamily(1, "Virginia", ss, TOBS, idx)).toBe(false);
    // Pipe 2 is mixed — no dominance either way.
    expect(pipeAccordsWithFamily(2, "Latakia", ss, TOBS)).toBe(false);
    expect(pipeAccordsWithFamily(2, "Latakia", ss, TOBS, idx)).toBe(false);
    // A pipe with no history at all.
    expect(pipeAccordsWithFamily(9, "Latakia", ss, TOBS)).toBe(false);
    expect(pipeAccordsWithFamily(9, "Latakia", ss, TOBS, idx)).toBe(false);
  });

  it("the indexed answer equals the unindexed one — ghosting risk, both directions", () => {
    const ss = sessions();
    const idx = buildPipeCategoryIndex(ss, TOBS);

    // Latakia pipe + an incoming Virginia = a real risk, same object either way.
    const bare = computePipeGhostingRisk(1, 2, ss, TOBS);
    const withIdx = computePipeGhostingRisk(1, 2, ss, TOBS, idx);
    expect(bare).not.toBeNull();
    expect(withIdx).toEqual(bare);

    // Same family on both sides — no risk.
    expect(computePipeGhostingRisk(1, 1, ss, TOBS)).toBeNull();
    expect(computePipeGhostingRisk(1, 1, ss, TOBS, idx)).toBeNull();
    // Not dedicated — no risk.
    expect(computePipeGhostingRisk(2, 2, ss, TOBS)).toBeNull();
    expect(computePipeGhostingRisk(2, 2, ss, TOBS, idx)).toBeNull();
    // Unknown pipe.
    expect(computePipeGhostingRisk(9, 2, ss, TOBS, idx)).toBeNull();
  });

  it("asking about N pipes with an index does NOT walk the sessions N times", () => {
    const rows: any[] = [];
    for (let i = 0; i < 200; i++) rows.push({ id: i, pipeId: 1 + (i % 20), tobaccoId: 1 + (i % 3) });

    // WITHOUT an index: every one of the 20 pipes rescans all 200 rows, twice
    // over (one accord call + one risk call).
    const bare = counting(rows);
    for (let p = 1; p <= 20; p++) {
      pipeAccordsWithFamily(p, "Latakia", bare.arr, TOBS);
      computePipeGhostingRisk(p, 2, bare.arr, TOBS);
    }
    const bareReads = bare.reads();
    expect(bareReads).toBeGreaterThan(200 * 20);

    // WITH an index: one pass to build it, then the 40 questions are lookups.
    const fast = counting(rows);
    const idx = buildPipeCategoryIndex(fast.arr, TOBS);
    for (let p = 1; p <= 20; p++) {
      pipeAccordsWithFamily(p, "Latakia", fast.arr, TOBS, idx);
      computePipeGhostingRisk(p, 2, fast.arr, TOBS, idx);
    }
    const fastReads = fast.reads();
    // One pass over the rows, and nothing per question.
    expect(fastReads).toBeLessThanOrEqual(rows.length * 2);
    expect(fastReads).toBeLessThan(bareReads / 4);
  });

  it("HomeViewV2 builds the index once and hands it to BOTH loops", () => {
    // Source-level: the two sets are computed in the render body BELOW the
    // view's early return, so no runtime hook can observe them in isolation —
    // and a helper that accepts an index nobody passes is exactly the wiring
    // rot this asserts against. Comments are blanked first (the documented
    // trap: this file's own prose names both helpers).
    let src = readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
             .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

    expect(src).toMatch(/buildPipeCategoryIndex\s*\(/);
    // Exactly one build — a second would undo the point.
    expect((src.match(/buildPipeCategoryIndex\s*\(/g) || []).length).toBe(1);
    // Both loops receive it.
    expect(src).toMatch(/computePipeGhostingRisk\([^)]*ghostIndex[^)]*\)/);
    expect(src).toMatch(/pipeAccordsWithFamily\([^)]*ghostIndex[^)]*\)/);
  });
});
