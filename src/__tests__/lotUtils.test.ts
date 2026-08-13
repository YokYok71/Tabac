import { describe, it, expect, vi } from "vitest";
import {
  pickJarLot, applyLotWeightDelta,
  locateLotIdx, stepApplyDelta, stepAutoFinish, stepAutoReactivate,
  applyLifecycleDates, makeLotDuplicate, roundWeightToUnit,
} from "../utils/lotUtils";

// ── roundWeightToUnit ───────────────────────────────────────────
describe("roundWeightToUnit", () => {
  it("rounds grams to 1 dp, ounces to 2 dp (matching stepApplyDelta's grid)", () => {
    expect(roundWeightToUnit("2.75", "g")).toBe(2.8);
    expect(roundWeightToUnit("2.75", "oz")).toBe(2.75);
    expect(roundWeightToUnit("0.056", "oz")).toBe(0.06);
    expect(roundWeightToUnit("3", "g")).toBe(3);
  });
  it("maps non-finite / garbage to 0 (mirrors safeW)", () => {
    expect(roundWeightToUnit("", "g")).toBe(0);
    expect(roundWeightToUnit("abc", "g")).toBe(0);
    expect(roundWeightToUnit("Infinity", "g")).toBe(0);
    expect(roundWeightToUnit(null, "g")).toBe(0);
  });
  it("defaults to the gram grid when unit is omitted", () => {
    expect(roundWeightToUnit("1.23")).toBe(1.2);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: String(Math.random()),
    status: "cellar",
    originalStatus: "cellar",
    weightG: "50",
    weightInitial: "50",
    dateOpened: "",
    dateFinished: "",
    disposed: false,
    ...overrides,
  };
}

function makeTob(lots: any[], id = 1) {
  return { id, lots };
}

function makeDat(tobaccos: any[]) {
  return { tobaccos };
}

// ── pickJarLot ────────────────────────────────────────────────────────────────

describe("pickJarLot", () => {
  it("returns null for tobacco with no lots", () => {
    expect(pickJarLot(makeTob([]), "g")).toBeNull();
  });

  it("returns null when no jar lots exist", () => {
    const tob = makeTob([makeLot({ status: "cellar" }), makeLot({ status: "finished" })]);
    expect(pickJarLot(tob, "g")).toBeNull();
  });

  it("returns the only jar lot", () => {
    const jar = makeLot({ status: "jar", weightG: "100" });
    const tob = makeTob([makeLot({ status: "cellar" }), jar]);
    const result = pickJarLot(tob, "g");
    expect(result).not.toBeNull();
    expect(result!.lot).toBe(jar);
    expect(result!.idx).toBe(1);
  });

  it("skips soft-deleted (trashed) jar lots (review fix)", () => {
    // Stores receive RAW data (trashed rows survive saves), so a trashed jar
    // lot still lives in tob.lots with deletedAt — it must never be picked to
    // absorb a session deduction.
    const trashed = makeLot({ status: "jar", weightG: "50", deletedAt: "2026-01-01T00:00:00Z" } as any);
    const live = makeLot({ status: "jar", weightG: "40" });
    expect(pickJarLot(makeTob([trashed]), "g")).toBeNull(); // only a trashed jar → none usable
    const r = pickJarLot(makeTob([trashed, live]), "g");
    expect(r!.lot).toBe(live);
    expect(r!.idx).toBe(1);
  });

  it("prefers non-round weight (g: not multiple of 50)", () => {
    const round = makeLot({ status: "jar", weightG: "100", dateOpened: "2024-01-01" });
    const nonRound = makeLot({ status: "jar", weightG: "73", dateOpened: "2024-06-01" });
    const tob = makeTob([round, nonRound]);
    const result = pickJarLot(tob, "g");
    expect(result!.lot).toBe(nonRound);
  });

  it("among non-round lots, picks oldest dateOpened", () => {
    const older = makeLot({ status: "jar", weightG: "73", dateOpened: "2024-01-01" });
    const newer = makeLot({ status: "jar", weightG: "42", dateOpened: "2024-06-01" });
    const tob = makeTob([newer, older]);
    const result = pickJarLot(tob, "g");
    expect(result!.lot).toBe(older);
  });

  it("when all are round (g), picks oldest dateOpened", () => {
    const older = makeLot({ status: "jar", weightG: "100", dateOpened: "2024-01-01" });
    const newer = makeLot({ status: "jar", weightG: "50", dateOpened: "2024-06-01" });
    const tob = makeTob([newer, older]);
    const result = pickJarLot(tob, "g");
    expect(result!.lot).toBe(older);
  });

  it("in oz mode, round means whole number", () => {
    const round = makeLot({ status: "jar", weightG: "2", dateOpened: "2024-01-01" });
    const nonRound = makeLot({ status: "jar", weightG: "1.5", dateOpened: "2024-06-01" });
    const tob = makeTob([round, nonRound]);
    const result = pickJarLot(tob, "oz");
    expect(result!.lot).toBe(nonRound);
  });

  it("in oz mode, when all round, picks oldest", () => {
    const older = makeLot({ status: "jar", weightG: "2", dateOpened: "2024-01-01" });
    const newer = makeLot({ status: "jar", weightG: "3", dateOpened: "2024-06-01" });
    const tob = makeTob([newer, older]);
    const result = pickJarLot(tob, "oz");
    expect(result!.lot).toBe(older);
  });
});

// ── applyLotWeightDelta ───────────────────────────────────────────────────────

describe("applyLotWeightDelta", () => {
  it("deducts weight from the named lot", () => {
    const lot = makeLot({ id: "10", status: "jar", weightG: "100" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", -30, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("70");
  });

  it("clamps weight to 0 (no negative)", () => {
    const lot = makeLot({ id: "10", status: "jar", weightG: "10" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", -50, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("0");
  });

  it("auto-finishes jar lot when weight hits 0", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "10", status: "jar", weightG: "10" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", -10, "g");
    const updated = result.tobaccos[0].lots[0];
    expect(updated.status).toBe("finished");
    expect(updated.dateFinished).toBe("2025-06-15");
    expect(updated.disposed).toBe(false);
    vi.useRealTimers();
  });

  it("auto-reactivates finished lot when delta > 0 and result > 0", () => {
    const lot = makeLot({ id: "10", status: "finished", weightG: "0", dateFinished: "2025-01-01" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", +20, "g");
    const updated = result.tobaccos[0].lots[0];
    expect(updated.status).toBe("jar");
    expect(updated.weightG).toBe("20");
    expect(updated.dateFinished).toBe("");
  });

  it("does NOT reactivate when delta > 0 but result stays 0", () => {
    const lot = makeLot({ id: "10", status: "finished", weightG: "0" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", 0, "g");
    expect(result.tobaccos[0].lots[0].status).toBe("finished");
  });

  it("falls back to pickJarLot when lotId is stale/missing", () => {
    const jar = makeLot({ id: "99", status: "jar", weightG: "80" });
    const dat = makeDat([makeTob([jar])]);
    const result = applyLotWeightDelta(dat, 1, "STALE_ID", -10, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("70");
  });

  it("falls back to most-recently-finished lot when delta > 0 and no jar lots", () => {
    const older = makeLot({ id: "1", status: "finished", weightG: "0", dateFinished: "2024-01-01" });
    const recent = makeLot({ id: "2", status: "finished", weightG: "0", dateFinished: "2025-06-01" });
    const dat = makeDat([makeTob([older, recent])]);
    const result = applyLotWeightDelta(dat, 1, "", +30, "g");
    expect(result.tobaccos[0].lots[1].weightG).toBe("30");
    expect(result.tobaccos[0].lots[0].weightG).toBe("0");
  });

  it("does nothing when tobacco not found", () => {
    const lot = makeLot({ id: "10", status: "jar", weightG: "100" });
    const dat = makeDat([makeTob([lot], 1)]);
    const result = applyLotWeightDelta(dat, 999, "10", -10, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("100");
  });

  it("does nothing when no lot found and delta is negative", () => {
    const lot = makeLot({ id: "10", status: "cellar", weightG: "100" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "MISSING", -10, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("100");
  });

  it("returns a new data object (immutability)", () => {
    const lot = makeLot({ id: "10", status: "jar", weightG: "100" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", -1, "g");
    expect(result).not.toBe(dat);
    expect(result.tobaccos).not.toBe(dat.tobaccos);
  });

  it("rounds weight to 1 decimal place", () => {
    const lot = makeLot({ id: "10", status: "jar", weightG: "10.1" });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "10", -0.2, "g");
    expect(result.tobaccos[0].lots[0].weightG).toBe("9.9");
  });
});

describe("applyLotWeightDelta — opened jar never auto-reverts to cellar", () => {
  it("jar lot whose restored weight matches weightInitial STAYS in jar", () => {
    const lot = makeLot({
      id: "L1", status: "jar", weightG: "30", weightInitial: "50",
      originalStatus: "cellar", dateOpened: "2024-01-15",
    });
    const dat = makeDat([makeTob([lot])]);
    // +20g brings the lot back to 50g (== weightInitial). Once,
    // this would auto-revert to cellar; the new contract is
    // that the pot stays open.
    const result = applyLotWeightDelta(dat, 1, "L1", +20, "g");
    const out = result.tobaccos[0].lots[0];
    expect(out.weightG).toBe("50");
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toBe("2024-01-15");
    expect(out.dateFinished).toBe("");
  });

  it("finished lot reactivates to jar (NOT cellar) even when restored weight matches weightInitial", () => {
    const lot = makeLot({
      id: "L2", status: "finished", weightG: "0", weightInitial: "50",
      originalStatus: "cellar",
      dateOpened: "2024-01-15", dateFinished: "2024-06-01",
    });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "L2", +50, "g");
    const out = result.tobaccos[0].lots[0];
    expect(out.weightG).toBe("50");
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toBe("2024-01-15");
    expect(out.dateFinished).toBe("");
  });

  it("originalStatus absent on a legacy jar lot does NOT trigger a revert", () => {
    const lot = makeLot({
      id: "L3", status: "jar", weightG: "30", weightInitial: "50",
      dateOpened: "2024-01-15",
    });
    delete (lot as any).originalStatus;
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "L3", +20, "g");
    const out = result.tobaccos[0].lots[0];
    expect(out.status).toBe("jar");
    expect(out.weightG).toBe("50");
  });

  it("deduction still works normally (delta < 0)", () => {
    const lot = makeLot({
      id: "L4", status: "jar", weightG: "60", weightInitial: "50",
      originalStatus: "cellar", dateOpened: "2024-01-15",
    });
    const dat = makeDat([makeTob([lot])]);
    const result = applyLotWeightDelta(dat, 1, "L4", -10, "g");
    const out = result.tobaccos[0].lots[0];
    expect(out.weightG).toBe("50");
    expect(out.status).toBe("jar");
  });
});

// ─── Pipeline step tests ──────────────────────────

describe("locateLotIdx", () => {
  it("returns the matching lot index when lotId resolves", () => {
    const tob = { lots: [
      { id: "A", status: "jar", weightG: "10" },
      { id: "B", status: "jar", weightG: "20" },
    ]};
    expect(locateLotIdx(tob, "B", -5, "g")).toBe(1);
  });
  it("falls back to pickJarLot when lotId is missing", () => {
    const tob = { lots: [
      { id: "A", status: "jar", weightG: "10", dateOpened: "2024-01-01" },
    ]};
    expect(locateLotIdx(tob, "", -5, "g")).toBe(0);
  });
  it("falls back to most-recently-finished lot when delta > 0 and no jar available", () => {
    const tob = { lots: [
      { id: "A", status: "finished", weightG: "0", dateFinished: "2024-01-01" },
      { id: "B", status: "finished", weightG: "0", dateFinished: "2024-06-01" },
    ]};
    expect(locateLotIdx(tob, "", +5, "g")).toBe(1);
  });
  it("returns -1 when nothing matches", () => {
    expect(locateLotIdx({ lots: [] }, "X", -5, "g")).toBe(-1);
  });
});

describe("stepApplyDelta", () => {
  it("adds the delta and rounds to 0.1", () => {
    const out = stepApplyDelta({ weightG: "10.05" }, -0.05);
    expect(out.weightG).toBe("10");
  });
  it("clamps at 0", () => {
    const out = stepApplyDelta({ weightG: "3" }, -10);
    expect(out.weightG).toBe("0");
  });
  it("is purely additive (does not touch other fields)", () => {
    const out = stepApplyDelta({ weightG: "30", status: "jar", dateOpened: "2024-01-01" }, -5);
    expect(out.weightG).toBe("25");
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toBe("2024-01-01");
  });

  // unit-aware rounding — oz keeps 2 dp so a ~0.08 oz bowl isn't
  // rounded to a whole 0.1 oz (which over-deducted).
  it("rounds to 0.01 in oz mode (a 0.08 bowl is not swallowed to 0.1)", () => {
    const out = stepApplyDelta({ weightG: "1" }, -0.08, "oz");
    expect(out.weightG).toBe("0.92");
  });
  it("keeps 0.1 rounding in grams mode (default)", () => {
    expect(stepApplyDelta({ weightG: "10.05" }, -0.05).weightG).toBe("10");
    expect(stepApplyDelta({ weightG: "1" }, -0.08, "g").weightG).toBe("0.9");
  });
  it("oz conservation over many bowls: 10 × 0.08 oz off a 1.0 oz tin leaves 0.2, not 0", () => {
    let lot: any = { weightG: "1", status: "jar", dateOpened: "2024-01-01" };
    for (let i = 0; i < 10; i++) lot = stepApplyDelta(lot, -0.08, "oz");
    // 1 - 0.8 = 0.2 (2 dp). The old 0.1-rounding would have hit 0 early.
    expect(parseFloat(lot.weightG)).toBeCloseTo(0.2, 5);
  });
});

describe("applyLotWeightDelta — unit-aware rounding", () => {
  it("threads weightUnit through so an oz deduction keeps 2 dp", () => {
    const dat = { tobaccos: [{ id: 1, lots: [{ id: "L1", status: "jar", weightG: "1", weightInitial: "1", dateOpened: "2024-01-01" }] }] };
    const out = applyLotWeightDelta(dat, 1, "L1", -0.08, "oz");
    expect(out.tobaccos[0].lots[0].weightG).toBe("0.92");
  });
});

describe("stepAutoFinish", () => {
  it("flips jar→finished when weight hits 0", () => {
    const out = stepAutoFinish({ status: "jar", weightG: "0", dateOpened: "2024-01-01" });
    expect(out.status).toBe("finished");
    expect(out.dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.disposed).toBe(false);
  });
  it("is a no-op for cellar at 0", () => {
    const out = stepAutoFinish({ status: "cellar", weightG: "0" });
    expect(out.status).toBe("cellar");
  });
  it("is a no-op for jar with weight > 0", () => {
    const out = stepAutoFinish({ status: "jar", weightG: "5" });
    expect(out.status).toBe("jar");
  });
});

describe("stepAutoReactivate", () => {
  it("flips finished→jar when weight is restored", () => {
    const out = stepAutoReactivate({ status: "finished", weightG: "5", dateFinished: "2024-01-01" }, +5);
    expect(out.status).toBe("jar");
    expect(out.dateFinished).toBe("");
  });
  it("does NOT reactivate on a deduction (delta < 0)", () => {
    const out = stepAutoReactivate({ status: "finished", weightG: "5", dateFinished: "2024-01-01" }, -5);
    expect(out.status).toBe("finished");
  });
  // This SUPERSEDES the earlier behaviour:
  // a DISPOSED lot must NOT auto-reactivate. `disposed` = the tobacco was
  // physically thrown/given away; deleting an old session that credits weight
  // back must not resurrect it as usable jar stock. It stays finished+disposed
  // (weight restored by stepApplyDelta, but shown only under "Éliminés", never
  // counted as held stock — which also resolves the double-count worry:
  // a finished lot is never held stock, so there's no incoherent dual state).
  it("does NOT reactivate a DISPOSED lot — stays finished+disposed", () => {
    const out = stepAutoReactivate(
      { status: "finished", weightG: "5", dateFinished: "2024-01-01", disposed: true }, +5,
    );
    expect(out.status).toBe("finished");
    expect(out.disposed).toBe(true);
  });
  it("still reactivates a finished-but-NOT-disposed lot", () => {
    const out = stepAutoReactivate(
      { status: "finished", weightG: "5", dateFinished: "2024-01-01", disposed: false }, +5,
    );
    expect(out.status).toBe("jar");
  });
});

describe("applyLifecycleDates", () => {
  it("filling jar: sets dateOpened when missing", () => {
    const out = applyLifecycleDates({ status: "cellar" }, "jar");
    expect(out.dateOpened).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.dateFinished).toBe("");
    expect(out.status).toBe("jar");
  });

  it("filling jar: preserves an existing dateOpened (legacy memory)", () => {
    const out = applyLifecycleDates({ status: "finished", dateOpened: "2020-01-15" }, "jar", "auto-recovery");
    expect(out.dateOpened).toBe("2020-01-15");
    expect(out.status).toBe("jar");
    expect(out.dateFinished).toBe("");
  });

  it("manual cellar: clears dateOpened (explicit reset)", () => {
    const out = applyLifecycleDates({ status: "jar", dateOpened: "2024-01-15" }, "cellar", "manual");
    expect(out.dateOpened).toBe("");
    expect(out.disposed).toBe(false);
  });

  // A manual reactivate to JAR must clear
  // `disposed` — a jar lot is active, it can't be "thrown away". Earlier only
  // the cellar branch cleared it, leaking an Éliminé-flagged active jar lot.
  it("manual jar: clears disposed (a jar lot can't be disposed)", () => {
    const out = applyLifecycleDates({ status: "finished", weightG: "30", disposed: true }, "jar", "manual");
    expect(out.status).toBe("jar");
    expect(out.disposed).toBe(false);
  });

  it("auto-recovery cellar: preserves dateOpened (fix #23)", () => {
    const out = applyLifecycleDates({ status: "jar", dateOpened: "2024-01-15", weightG: "50" }, "cellar", "auto-recovery");
    expect(out.dateOpened).toBe("2024-01-15");
    expect(out.dateFinished).toBe("");
  });

  it("finished: fills dateFinished when missing, preserves when present", () => {
    expect(applyLifecycleDates({ status: "jar" }, "finished").dateFinished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(applyLifecycleDates({ status: "jar", dateFinished: "2024-06-01" }, "finished").dateFinished)
      .toBe("2024-06-01");
  });
});

describe("stepAutoReactivate — dateOpened fill on legacy finished lot", () => {
  it("a finished lot without dateOpened gets one filled when reactivated", () => {
    // Note: stepAutoReactivate runs AFTER stepApplyDelta in the pipeline,
    // so weightG already reflects the post-delta state (30g here).
    const lot = { id: "L1", status: "finished", weightG: "30", weightInitial: "50",
                  originalStatus: "cellar", dateOpened: "", dateFinished: "2024-06-01" };
    const out = stepAutoReactivate(lot, +30);
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.dateFinished).toBe("");
  });

  it("a finished lot WITH dateOpened keeps it on reactivation", () => {
    const lot = { id: "L1", status: "finished", weightG: "30", weightInitial: "50",
                  originalStatus: "cellar", dateOpened: "2020-03-15", dateFinished: "2024-06-01" };
    const out = stepAutoReactivate(lot, +30);
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toBe("2020-03-15"); // preserved
    expect(out.dateFinished).toBe("");
  });

  it("end-to-end: legacy finished lot (no dateOpened) + delta restore → jar with dateOpened set", () => {
    // Drive the pipeline via applyLotWeightDelta so the integration is
    // covered (the audit's bug #1 reproducer).
    const lot = { id: "L1", status: "finished", weightG: "0", weightInitial: "50",
                  originalStatus: "cellar", dateOpened: "", dateFinished: "2024-06-01" };
    const dat = { tobaccos: [{ id: 1, lots: [lot] }] };
    const result = applyLotWeightDelta(dat, 1, "L1", +30, "g");
    const out = result.tobaccos[0].lots[0];
    expect(out.status).toBe("jar");
    expect(out.dateOpened).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("makeLotDuplicate", () => {
  it("strips id + deletedAt and resets to a full, unconsumed lot", () => {
    const src = { id: 42, deletedAt: "x", status: "jar", originalStatus: "jar",
      weightG: "30", weightInitial: "50", dateOpened: "2024-01-01",
      dateFinished: "", disposed: false, price: "12", seller: "SP", boxNumber: "5" };
    const dup = makeLotDuplicate(src, "8");
    expect("id" in dup).toBe(false);
    expect("deletedAt" in dup).toBe(false);
    // Full fresh: weightG reset to weightInitial.
    expect(dup.weightG).toBe("50");
    expect(dup.weightInitial).toBe("50");
    // Purchase identity preserved.
    expect(dup.price).toBe("12");
    expect(dup.seller).toBe("SP");
    // Next box number applied.
    expect(dup.boxNumber).toBe("8");
  });

  it("returns a finished lot to its origin status, cleared of end-state", () => {
    const src = { id: 1, status: "finished", originalStatus: "cellar",
      weightG: "0", weightInitial: "100", dateFinished: "2024-06-01", disposed: true, boxNumber: "3" };
    const dup = makeLotDuplicate(src, "");
    expect(dup.status).toBe("cellar");
    expect(dup.weightG).toBe("100");
    expect(dup.dateFinished).toBe("");
    expect(dup.disposed).toBe(false);
    // Cellar (sealed) duplicate carries no opening date.
    expect(dup.dateOpened).toBe("");
  });

  it("keeps the source box number when no next box is supplied", () => {
    const src = { id: 1, status: "cellar", originalStatus: "cellar", weightG: "50", weightInitial: "50", boxNumber: "B-2017" };
    const dup = makeLotDuplicate(src, "");
    expect(dup.boxNumber).toBe("B-2017");
  });

  it("a finished lot whose origin was jar returns to jar", () => {
    const src = { id: 1, status: "finished", originalStatus: "jar", weightG: "0", weightInitial: "40", dateFinished: "2024-01-01" };
    const dup = makeLotDuplicate(src, "");
    expect(dup.status).toBe("jar");
  });
});
