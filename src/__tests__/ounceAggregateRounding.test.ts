import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeYearConsumption } from "../utils/cellarInsights";
import { roundAggregateWeight } from "../utils/lotUtils";

function src(rel: string): string {
  // Comments are BLANKED before any source assertion — the comments at both
  // call sites explain the fix by naming what they replaced, and a check that
  // reads its own prose as data is the trap this repo has been caught by
  // several times. Length-preserving so an offset still points at the real file.
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

// A weight is stored in whatever unit the user typed (the unit setting is
// display-only), so an aggregate that rounds to a WHOLE unit means one thing in
// grams and something 28× coarser in ounces: 1 oz is 28.35 g, so a year of
// light smoking — 3 bowls at 0.09 oz — reported "0 oz", and 8 bowls reported
// "1 oz". `roundWeightToUnit` and `estimateSessionWeight` are already
// unit-aware for exactly this reason; the yearly consumption figures were not.
//
// Grams keep INTEGER precision (1 g), which is what they always had; ounces get
// one decimal (0.1 oz = 2.8 g), the closest match on a tile that has to fit a
// four-digit total. Two decimals would be finer than the gram branch's own
// resolution and noisier on screen.

describe("roundAggregateWeight — the unit decides the precision", () => {
  it("keeps grams at whole units, exactly as before", () => {
    expect(roundAggregateWeight(1234.7, "g")).toBe(1235);
    expect(roundAggregateWeight(0.4, "g")).toBe(0);
    expect(roundAggregateWeight(2.5, "g")).toBe(3);
  });

  it("keeps one decimal in ounces, so a light year is not erased", () => {
    // 3 bowls of 0.09 oz — the reproduction.
    expect(roundAggregateWeight(0.27, "oz")).toBe(0.3);
    // 8 bowls — used to read "1 oz", i.e. 28 g for 20 g smoked.
    expect(roundAggregateWeight(0.72, "oz")).toBe(0.7);
    expect(roundAggregateWeight(12.34, "oz")).toBe(12.3);
  });

  it("defaults to the gram grid when no unit is supplied", () => {
    // The parameter is optional so existing gram-only callers are unchanged.
    expect(roundAggregateWeight(1234.7)).toBe(1235);
  });

  it("degrades to 0 on garbage rather than propagating NaN", () => {
    expect(roundAggregateWeight(NaN, "oz")).toBe(0);
    expect(roundAggregateWeight(Infinity, "g")).toBe(0);
  });
});

describe("computeYearConsumption — ounce mode keeps the decimal", () => {
  const light = [
    { date: "2026-03-01", weightG: "0.09" },
    { date: "2026-04-01", weightG: "0.09" },
    { date: "2026-05-01", weightG: "0.09" },
  ];

  it("does not report a light ounce year as zero", () => {
    const r = computeYearConsumption(light, 2026, "oz");
    expect(r.thisYear).toBe(0.3);
    // The defect as the user met it: the tile said they had smoked nothing.
    expect(r.thisYear).not.toBe(0);
  });

  it("rounds last year on the same grid", () => {
    const r = computeYearConsumption(
      [{ date: "2025-06-01", weightG: "0.09" }, { date: "2025-07-01", weightG: "0.09" }],
      2026, "oz",
    );
    expect(r.lastYear).toBe(0.2);
  });

  // NON-VACUITY: the gram path must be byte-identical to what it always was —
  // a fix that gave every unit a decimal would change the figure on every
  // existing user's Home screen for no reason.
  it("leaves the gram path on whole grams", () => {
    const r = computeYearConsumption(
      [{ date: "2026-01-01", weightG: "2.5" }, { date: "2026-02-01", weightG: "2.7" }],
      2026, "g",
    );
    expect(r.thisYear).toBe(5);
  });

  it("is unchanged when no unit is passed (the historical signature)", () => {
    const r = computeYearConsumption([{ date: "2026-01-01", weightG: "5.4" }], 2026);
    expect(r.thisYear).toBe(5);
  });

  // The trend is a RATIO, so it is computed from the raw sums and is not
  // affected by the display rounding — asserted so a future pass cannot
  // "simplify" it into using the rounded fields.
  it("computes the trend from the raw sums, not the rounded ones", () => {
    const r = computeYearConsumption(
      [{ date: "2026-01-01", weightG: "0.2" }, { date: "2025-01-01", weightG: "0.1" }],
      2026, "oz",
    );
    expect(r.trendPct).toBe(100);
  });
});

// THE WIRING IS WHAT ROTS: the engine can be perfectly unit-aware while a view
// keeps calling it without the unit, and every unit test stays green. Both
// consumers are asserted at source level — the Home tile animates its value
// through `AnimNum` and the Stats hero needs the whole ctx, so neither figure is
// reachable from a plain render assertion.
describe("both consumption surfaces pass the unit through", () => {
  it("HomeViewV2 hands the weight unit to computeYearConsumption", () => {
    const s = src("views/curator/HomeViewV2.tsx");
    // Line-based, NOT a `[^)]*` window: the call itself contains
    // `new Date().getFullYear()`, so a paren-excluding pattern can never reach
    // the third argument and would report a false miss.
    const call = s.split("\n").find((l) => l.includes("computeYearConsumption("));
    expect(call).toBeTruthy();
    expect(call).toMatch(/weightUnit\s*\)/);
    // …and recomputes when the setting changes, or the tile keeps the old grid.
    const memo = s.slice(s.indexOf("computeYearConsumption("));
    expect(memo.slice(0, 200)).toMatch(/\[[^\]]*weightUnit[^\]]*\]/);
  });

  it("StatsView rounds its year hero on the unit's grid", () => {
    const s = src("views/curator/StatsView.tsx");
    expect(s).toMatch(/roundAggregateWeight\(\s*yearTotal\s*,\s*weightUnit\s*\)/);
    // The bare Math.round it replaced must not come back.
    expect(s).not.toMatch(/Math\.round\(\s*yearTotal\s*\)/);
  });

  it("the Home STOCK tile is deliberately NOT changed here", () => {
    // MEASURED, and it is why the third site named in the report was left
    // alone: the "Poids" tile shows kg to 1 dp in gram mode (100 g resolution)
    // and whole ounces in ounce mode (28.35 g). The ounce branch is the FINER
    // of the two, so the described defect — "ounces are coarser" — is backwards
    // there. Pinned so the asymmetry is a recorded decision, not an oversight.
    const s = src("views/curator/HomeViewV2.tsx");
    expect(s).toMatch(/toFixed\(0\)/);          // oz stock, whole units
    expect(s).toMatch(/1000\)\.toFixed\(1\)/);  // g stock → kg, one decimal
  });
});
