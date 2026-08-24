// Two defects that meet on the same pixels: a chart series carrying IEEE-754
// accumulation noise, and a chart renderer that stringifies a number instead
// of formatting it.
//
// (1) `computeChartStats` rounds `monthlyWeight` / `yearlyWeight` to 1 dp and
//     left `catW` / `brandW` raw — the ONLY two series fed to a chart
//     unrounded. Summing grid-aligned decimals is not grid-aligned:
//     `20.1 + 20.3` is `40.400000000000006`.
// (2) `hBars` renders `String(item.value)` and `donutChart` renders
//     `total + weightUnit`, so BOTH bypass `fmtNum` — which is what rounds
//     residual noise away AND what puts the comma in a comma-decimal UI. The
//     donut LEGEND beside them goes through `fmtNum` and is correct, so the
//     same screen showed `56,6g` in the legend and `148.89999999999998g` in
//     the bar chart below it.
//
// BOTH halves are needed and neither subsumes the other: rounding the series
// does not help the donut CENTRE (which re-sums the rounded values, and
// `0.1 + 0.2` is 0.30000000000000004), while formatting at the render leaves
// the engine emitting a number no consumer should have to clean up.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { hBars, donutChart } from "../components/Charts.jsx";
import { computeChartStats } from "../utils/stats";
import { fmtNum } from "../utils";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorStatsView } from "../views/curator/StatsView";

// MEASURED, not assumed. The first pair written here — 62.3 + 153.4 — sums
// EXACTLY to 215.7, so the case that was meant to reproduce the defect passed
// on the unfixed code and proved nothing. 20.1 + 20.3 is a real one, and the
// case below asserts that it still is, so this fixture cannot quietly stop
// being a reproduction.
const NOISY_A = 20.1;
const NOISY_B = 20.3;
const NOISY_SUM = "40.400000000000006";

function tob(brand: string, category: string, weights: number[]) {
  return {
    id: 1, brand: brand, name: "N", category: category, rating: 0,
    lots: weights.map((w, i) => ({ id: i + 1, status: "cellar", weightG: String(w) })),
  };
}

describe("computeChartStats — catW / brandW carry no accumulation noise", () => {
  it("the fixture really is a float-noise reproduction", () => {
    expect(NOISY_A + NOISY_B).not.toBe(40.4);
    expect(String(NOISY_A + NOISY_B)).toBe(NOISY_SUM);
  });

  it("rounds the category series like its monthly/yearly siblings", () => {
    const s = computeChartStats(
      [tob("Halvorsen", "Anglais", [NOISY_A, NOISY_B])], [], [], [], [],
    );
    expect(s.catW[0]![1]).toBe(40.4);
    expect(String(s.catW[0]![1])).toBe("40.4");
  });

  it("rounds the brand series too", () => {
    const s = computeChartStats(
      [tob("Halvorsen", "Anglais", [NOISY_A, NOISY_B])], [], [], [], [],
    );
    expect(s.brandW[0]![1]).toBe(40.4);
  });

  // NON-VACUITY — the rounding must not flatten a legitimate decimal. Weights
  // are stored on a 1-dp gram grid, so 1 dp is exactly what has to survive.
  it("keeps a legitimate one-decimal weight intact", () => {
    const s = computeChartStats([tob("Halvorsen", "Anglais", [2.5])], [], [], [], []);
    expect(s.catW[0]![1]).toBe(2.5);
    expect(s.brandW[0]![1]).toBe(2.5);
  });
});

describe("Charts — the value a chart prints goes through the caller's formatter", () => {
  it("hBars uses the formatter it is given", () => {
    const fmt = (n: number) => String(n).replace(".", ",");
    const { container } = render(
      <>{hBars([{ label: "Halvorsen", value: 215.7, unit: "g" }], 300, "", fmt)}</>,
    );
    expect(container.textContent).toContain("215,7g");
    expect(container.textContent).not.toContain("215.7");
  });

  it("hBars is unchanged when no formatter is passed", () => {
    // The parameter is OPTIONAL: Charts.jsx is untyped and has many test
    // callers, so a missing formatter must degrade to the old rendering rather
    // than print "undefined".
    const { container } = render(<>{hBars([{ label: "a", value: 5, unit: "g" }], 300)}</>);
    expect(container.textContent).toContain("5g");
  });

  it("donutChart formats the centre total (single-slice path)", () => {
    const fmt = (n: number) => String(n).replace(".", ",");
    const { container } = render(
      <>{donutChart([{ label: "x", value: 215.7, color: "#fff" }], 200, "g", "total", fmt)}</>,
    );
    expect(container.textContent).toContain("215,7g");
  });

  it("donutChart formats the centre total (multi-slice path)", () => {
    // TWO render paths print that caption, and a fix applied to one of them is
    // the shape this file has already had to correct once (the hardcoded
    // "total actif" lived in both).
    // The REAL formatter, not a toy one: `fmtNum` both localises the separator
    // AND rounds a computed number to 4 dp, and it is the rounding half that
    // this case needs. (Written first with a naive `String(n).replace(".",",")`
    // — which passes the value through unrounded — so the case failed on the
    // FIXED code and was measuring the fixture, not the fix.)
    const items = [
      { label: "a", value: 0.1, color: "#111" },
      { label: "b", value: 0.2, color: "#222" },
    ];
    const { container } = render(
      <>{donutChart(items, 200, "g", "total", (n: number) => fmtNum(n, "fr"))}</>,
    );
    // 0.1 + 0.2 === 0.30000000000000004 — the sum is noisy even when every
    // input is clean, which is why rounding the SERIES cannot cover this.
    expect(container.textContent).not.toContain("0.30000000000000004");
    expect(container.textContent).toContain("0,3g");
  });
});

describe("StatsView — the wiring", () => {
  // THE WIRING IS WHAT ROTS: Charts.jsx can accept a formatter and StatsView
  // can go on not passing one, with every unit test above still green. The
  // harness runs in French, so a dot in the output IS the defect.
  const base = {
    view: "stats",
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    chartData: {
      catW: [["Anglais", 215.7]],
      brandW: [["Halvorsen", 215.7]],
      ratings: [0, 0, 0, 0, 0],
      pShapes: [], pBowl: [], pStem: [],
      monthlyDur: [], monthlyWeight: [], yearlyDur: [], yearlyWeight: [],
      topTobaccos: [], topPipes: [],
    },
  };

  it("prints no dot decimal anywhere on the page", () => {
    // Written first as `toContain("215,7")` and it passed on the UNFIXED code:
    // the donut LEGEND already went through `fmtNum`, so the comma was on the
    // page while the bar beside it still read `215.7`. The absence of the DOT
    // form is what separates the three renderings — only the bar value and the
    // donut centre can produce it.
    const { container } = renderWithCtx(<CuratorStatsView />, base);
    expect(container.textContent).not.toContain("215.7");
  });

  it("prints the comma form in all three places (non-vacuity)", () => {
    // Donut centre + donut legend + brand bar. Asserting only the absence
    // above would also pass on a page that rendered no number at all.
    const { container } = renderWithCtx(<CuratorStatsView />, base);
    const n = String(container.textContent).split("215,7").length - 1;
    expect(n).toBeGreaterThanOrEqual(3);
  });
});
