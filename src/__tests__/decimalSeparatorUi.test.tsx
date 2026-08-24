// Two more surfaces that printed a DOT decimal in a comma-decimal UI,
// both by handing a `toFixed(1)` string straight to JSX instead of routing it
// through `fmtNum`.
//
//  - `computeStats().avg` — a `.toFixed(1)` STRING rendered verbatim on the
//    Home mini-strip ("Moyenne"). It is the one figure on the landing screen
//    with a decimal in it, sitting beside three integers.
//  - `StatsView`'s "Profil gustatif" — three `Number(val).toFixed(1)` values
//    on a page whose donut legend two cards up already prints a comma.
//
// `fmtNum` is the right tool for BOTH because it takes a STRING here and so
// preserves the typed precision: "5.0" stays "5,0" rather than collapsing to
// "5", and the "—" placeholder (parseFloat → NaN) is returned untouched.

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppCtx } from "../AppContext.tsx";
import { CuratorHomeViewV2 } from "../views/curator/HomeViewV2.tsx";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorStatsView } from "../views/curator/StatsView";

const homeCtx = (avg: any) => ({
  view: "home",
  lang: "fr",
  t: (k: string) => k,
  xl: (v: any) => v,
  nav: () => {},
  setStatusFilter: () => {},
  setSearchOpen: () => {},
  setImportModal: () => {},
  setSettingsTab: () => {},
  setDetail: () => {},
  setPipeDet: () => {},
  navToInvFiltered: () => {},
  pipeIsActive: (p: any) => p.status !== "finished",
  ageLabel: (d: number | null) => (d == null ? "—" : `${d}j`),
  weightUnit: "g",
  currencySymbol: "€",
  imgLocal: {},
  data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
  stats: {
    activeRefs: 1, cellar: 1, jars: 0, wt: 50, avg: avg,
    cats: [], brands: [],
    pipesActive: 1, pipeVal: 200, tobVal: 100,
    lotsFinished: 0, lotsOveraged: 0, lotsApproaching: 0, wish: 0,
  },
});

function renderHome(avg: any) {
  return render(
    <AppCtx.Provider value={homeCtx(avg) as any}>
      <CuratorHomeViewV2 />
    </AppCtx.Provider>,
  );
}

describe("Home mini-strip — the average rating uses the UI's decimal separator", () => {
  it("prints the comma form, never the dot form", () => {
    const { container } = renderHome("4.5");
    expect(container.textContent).toContain("4,5");
    expect(container.textContent).not.toContain("4.5");
  });

  it("keeps the trailing zero `computeStats` produced", () => {
    // `fmtNum` collapses a computed NUMBER to its shortest form but honours a
    // STRING's typed precision, and `avg` is a string — so "5.0" must stay a
    // one-decimal value rather than becoming a bare "5". Without this the fix
    // would silently change what the strip shows.
    const { container } = renderHome("5.0");
    expect(container.textContent).toContain("5,0");
  });

  it("leaves the em-dash placeholder alone (non-vacuity)", () => {
    // `computeStats` returns "—" when nothing is rated. A formatter that
    // mangled it would be worse than the defect being fixed.
    const { container } = renderHome("—");
    expect(container.textContent).toContain("—");
  });
});

describe("StatsView — the taste profile uses the UI's decimal separator", () => {
  const base = {
    view: "stats",
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    chartData: {
      catW: [["Anglais", 10]], brandW: [], ratings: [0, 0, 0, 0, 0],
      pShapes: [], pBowl: [], pStem: [],
      monthlyDur: [], monthlyWeight: [], yearlyDur: [], yearlyWeight: [],
      topTobaccos: [], topPipes: [],
      tasteProfile: { count: 5, force: 3.5, roomNote: 2, taste: 4 },
    },
  };

  it("prints the comma form, never the dot form", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, base);
    expect(container.textContent).toContain("3,5");
    expect(container.textContent).not.toContain("3.5");
  });

  it("still prints one decimal for a whole value (non-vacuity)", () => {
    // The row is `Stars` + a numeric readout; a whole 2 must read "2,0", not
    // "2", or the three rows stop lining up.
    const { container } = renderWithCtx(<CuratorStatsView />, base);
    expect(container.textContent).toContain("2,0");
    expect(container.textContent).toContain("4,0");
  });
});
