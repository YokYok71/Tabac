import { describe, it, expect } from "vitest";
import { computePipeGhostingRisk, computePipeUsageProfile, GHOSTING_FAMILIES } from "../utils/ghosting";

// tobaccos: id → category
const TOBS = [
  { id: "1", category: "Latakia" },
  { id: "2", category: "Virginia" },
  { id: "3", category: "Aromatique" },
  { id: "4", category: "Burley" },
  { id: "5", category: "" }, // no category
];

// Helper: N sessions of a given tobacco in a given pipe.
function sess(pipeId: string, tobaccoId: string, n: number) {
  return Array.from({ length: n }, () => ({ pipeId, tobaccoId }));
}

describe("computePipeGhostingRisk", () => {
  it("returns null on missing / invalid input (never throws)", () => {
    expect(computePipeGhostingRisk("", "2", [], TOBS)).toBeNull();
    expect(computePipeGhostingRisk("P1", "", [], TOBS)).toBeNull();
    expect(computePipeGhostingRisk("P1", "2", null, TOBS)).toBeNull();
    expect(computePipeGhostingRisk("P1", "2", [], null)).toBeNull();
    // @ts-expect-error garbage
    expect(computePipeGhostingRisk(null, undefined, "x", "y")).toBeNull();
  });

  it("warns when a Latakia-dedicated pipe is about to smoke a Virginia", () => {
    // 4 Latakia sessions in P1 → dominant Latakia (100%)
    const sessions = sess("P1", "1", 4);
    const r = computePipeGhostingRisk("P1", "2", sessions, TOBS);
    expect(r).toEqual({ dominant: "Latakia", count: 4, total: 4 });
  });

  it("warns when introducing a ghosting family into a mild-dedicated pipe", () => {
    // Pipe dedicated to Virginia (mild), incoming Aromatique (ghosting-prone)
    const sessions = sess("P1", "2", 4);
    const r = computePipeGhostingRisk("P1", "3", sessions, TOBS);
    expect(r).toEqual({ dominant: "Virginia", count: 4, total: 4 });
  });

  it("stays silent when both families are mild (no ghosting risk)", () => {
    // Virginia-dedicated pipe, incoming Burley — neither ghosts
    const sessions = sess("P1", "2", 5);
    expect(computePipeGhostingRisk("P1", "4", sessions, TOBS)).toBeNull();
  });

  it("stays silent when the incoming tobacco is the dominant family", () => {
    const sessions = sess("P1", "1", 4);
    // smoking Latakia again in a Latakia pipe — fine
    expect(computePipeGhostingRisk("P1", "1", sessions, TOBS)).toBeNull();
  });

  it("stays silent below the minimum session history", () => {
    // only 2 sessions → not enough to claim dedication
    const sessions = sess("P1", "1", 2);
    expect(computePipeGhostingRisk("P1", "2", sessions, TOBS)).toBeNull();
  });

  it("stays silent when no family dominates (below the share threshold)", () => {
    // 3 Latakia + 3 Virginia = 50/50 → no clear dedication
    const sessions = [...sess("P1", "1", 3), ...sess("P1", "2", 3)];
    expect(computePipeGhostingRisk("P1", "3", sessions, TOBS)).toBeNull();
  });

  it("only counts sessions smoked in the target pipe", () => {
    // 4 Latakia in P2 shouldn't inform P1
    const sessions = sess("P2", "1", 4);
    expect(computePipeGhostingRisk("P1", "2", sessions, TOBS)).toBeNull();
  });

  it("ignores sessions whose tobacco has no category", () => {
    // 4 category-less sessions → nothing to bucket
    const sessions = sess("P1", "5", 4);
    expect(computePipeGhostingRisk("P1", "1", sessions, TOBS)).toBeNull();
  });

  it("returns null when the incoming tobacco has no category", () => {
    const sessions = sess("P1", "1", 4);
    expect(computePipeGhostingRisk("P1", "5", sessions, TOBS)).toBeNull();
  });

  it("respects the 60% dominance threshold at the boundary", () => {
    // 6 Latakia + 4 Virginia = 60% Latakia → dedicated
    const sessions = [...sess("P1", "1", 6), ...sess("P1", "2", 4)];
    const r = computePipeGhostingRisk("P1", "2", sessions, TOBS);
    expect(r).toEqual({ dominant: "Latakia", count: 6, total: 10 });
  });

  it("GHOSTING_FAMILIES lists the canonical strong families", () => {
    expect(GHOSTING_FAMILIES).toContain("Latakia");
    expect(GHOSTING_FAMILIES).toContain("Aromatique");
    expect(GHOSTING_FAMILIES).not.toContain("Virginia");
    expect(GHOSTING_FAMILIES).not.toContain("Burley");
  });
});

describe("computePipeUsageProfile", () => {
  const TOBS = [
    { id: "1", category: "Latakia" },
    { id: "2", category: "Virginia" },
    { id: "3", category: "Burley" },
    { id: "9", category: "" }, // uncategorized
  ];
  function sess(pipeId: string, tobaccoId: string, n: number) {
    return Array.from({ length: n }, () => ({ pipeId, tobaccoId }));
  }

  it("returns an empty profile on missing / invalid input", () => {
    const empty = { families: [], total: 0, dominant: null, dominantShare: 0, ghosted: false };
    expect(computePipeUsageProfile("", [], TOBS)).toEqual(empty);
    expect(computePipeUsageProfile("P1", null, TOBS)).toEqual(empty);
    expect(computePipeUsageProfile("P1", [], null)).toEqual(empty);
    expect(computePipeUsageProfile("P1", [], TOBS)).toEqual(empty);
  });

  it("tallies families smoked in the pipe, most-used first", () => {
    const sessions = [...sess("P1", "1", 3), ...sess("P1", "2", 5), ...sess("P2", "3", 9)];
    const r = computePipeUsageProfile("P1", sessions, TOBS);
    expect(r.total).toBe(8);
    expect(r.families).toEqual([
      { category: "Virginia", count: 5 },
      { category: "Latakia", count: 3 },
    ]);
    expect(r.dominant).toBe("Virginia");
    expect(r.dominantShare).toBeCloseTo(5 / 8);
  });

  it("flags a ghosting dedication (>=3 sessions, >=60% a ghosting family)", () => {
    // 4 Latakia + 1 Virginia = 80% Latakia
    const sessions = [...sess("P1", "1", 4), ...sess("P1", "2", 1)];
    const r = computePipeUsageProfile("P1", sessions, TOBS);
    expect(r.dominant).toBe("Latakia");
    expect(r.ghosted).toBe(true);
  });

  it("does NOT flag ghosting for a mild dominant family", () => {
    // 5 Virginia — dominant but not ghosting-prone
    const r = computePipeUsageProfile("P1", sess("P1", "2", 5), TOBS);
    expect(r.dominant).toBe("Virginia");
    expect(r.ghosted).toBe(false);
  });

  it("does NOT flag ghosting below the dominance threshold", () => {
    // 3 Latakia + 3 Virginia = 50/50
    const sessions = [...sess("P1", "1", 3), ...sess("P1", "2", 3)];
    const r = computePipeUsageProfile("P1", sessions, TOBS);
    expect(r.ghosted).toBe(false);
  });

  it("ignores sessions whose tobacco has no category", () => {
    const r = computePipeUsageProfile("P1", sess("P1", "9", 5), TOBS);
    expect(r.total).toBe(0);
    expect(r.families).toEqual([]);
  });
});
