// Smoke tests for src/views/curator/StatsView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorStatsView } from "../../views/curator/StatsView";

describe("StatsView — visibility", () => {
  it("returns null when view !== 'stats'", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, {
      view: "home",
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state when no chart data", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, {
      view: "stats",
      chartData: {},
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.firstChild).toBeTruthy();
    expect(container.textContent).toMatch(/no_data_chart|No data|Pas encore/);
  });

  it("renders chart sections when data is available", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, {
      view: "stats",
      chartData: {
        catW: [["Anglais", 200], ["Burley", 100]],
        brandW: [["Brackwater", 200]],
        ratings: [0, 1, 2, 3, 4],
        pShapes: [["Billiard", 1]],
        pBowl: [["Bruyère", 1]],
        pStem: [["Ébonite", 1]],
        monthlyDur: [],
        monthlyWeight: [],
        yearlyDur: [],
        yearlyWeight: [],
        topTobaccos: [],
        topPipes: [],
      },
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // Chart components render SVGs; we just confirm at least one svg is present.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });
});

// ── accounting OFF banner ──────────────────────────────────────
// Replaces a more complex earlier banner (which counted accountingOff
// sessions). With the simpler approach (weightG=0 in off-mode), there's
// nothing to "count" — the banner is purely contextual: shown when the
// global toggle is currently OFF, hidden otherwise.

describe("StatsView — accounting-off banner", () => {
  const baseCtx = {
    view: "stats",
    chartData: { catW: [["Anglais", 200]], brandW: [["Brackwater", 200]],
      ratings: [], pShapes: [], pBowl: [], pStem: [],
      monthlyDur: [], monthlyWeight: [], yearlyDur: [], yearlyWeight: [],
      topTobaccos: [], topPipes: [] },
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
  };

  it("renders the banner when accountingEnabled is false", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, {
      ...baseCtx,
      accountingEnabled: false,
    });
    expect(container.textContent || "").toMatch(/comptabilit[^]{0,80}d[ée]sactiv|accounting is currently off|stats_accounting_off_notice/i);
  });

  it("does NOT render the banner when accountingEnabled is true", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, {
      ...baseCtx,
      accountingEnabled: true,
    });
    expect(container.textContent || "").not.toMatch(/comptabilit[^]{0,80}d[ée]sactiv|accounting is currently off|stats_accounting_off_notice/i);
  });

  it("does NOT render the banner when accountingEnabled is undefined (default = true)", () => {
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx });
    expect(container.textContent || "").not.toMatch(/comptabilit[^]{0,80}d[ée]sactiv|accounting is currently off|stats_accounting_off_notice/i);
  });
});

// ── Stats drills record their origin so system-back returns to
// Stats (was bare nav()+setDetail/setRatingFilter, which lost Stats on back —
// And, later, the ratings drill's filter was wiped by nav()'s
// ratingFilter reset). ─────────────────────────────────────────────────────
describe("StatsView — click-thru records the Stats origin", () => {
  const tob = { id: "9", brand: "Brackwater", name: "Duskfall", category: "Anglais", lots: [] };
  const pipe = { id: "4", brand: "Halvorsen", name: "Aran", shape: "Billiard", status: "active" };
  const baseCtx = {
    view: "stats",
    chartData: {
      // catW non-empty so StatsView's `empty` guard is false (it gates the
      // whole chart area on catW/brandW/pShapes all being empty).
      catW: [["Anglais", 100]], brandW: [],
      ratings: [1, 2, 3, 4, 5],
      pShapes: [], pBowl: [], pStem: [],
      monthlyDur: [], monthlyWeight: [], yearlyDur: [], yearlyWeight: [],
      topTobaccos: [{ id: "9", name: "Duskfall", weight: 50, sessions: 3 }],
      topPipes: [{ id: "4", name: "Aran", sessions: 2, duration: 60 }],
    },
    data: { tobaccos: [tob], pipes: [pipe], accessories: [], sessions: [], wishlist: [] },
  };

  // hBars/vBars render clickable <div>/<g> with the label text inside (SVG or
  // div, NOT a <button>). Find the INNERMOST element whose text matches and
  // click it — the click bubbles up to the row/bar onClick handler.
  function barByText(container: HTMLElement, re: RegExp) {
    const all = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .filter((el) => re.test(el.textContent || ""));
    return all.find((el) =>
      !Array.from(el.querySelectorAll("*")).some((c) => re.test(c.textContent || "")));
  }

  it("the ratings histogram drills via navToInvByRating (not a bare nav)", () => {
    const navToInvByRating = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, navToInvByRating });
    const bar = barByText(container, /★5/);
    expect(bar, "expected a ★5 rating bar").toBeTruthy();
    fireEvent.click(bar!);
    expect(navToInvByRating).toHaveBeenCalledWith(5);
  });

  it("the top-tobacco bar cross-opens the fiche (back returns to Stats)", () => {
    const crossOpenDetail = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, crossOpenDetail });
    const bar = barByText(container, /Duskfall/);
    expect(bar, "expected a Duskfall bar").toBeTruthy();
    fireEvent.click(bar!);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "inv", kind: "tobacco", obj: tob });
  });

  it("the top-pipe bar cross-opens the fiche (back returns to Stats)", () => {
    const crossOpenDetail = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, crossOpenDetail });
    const bar = barByText(container, /Aran/);
    expect(bar, "expected an Aran bar").toBeTruthy();
    fireEvent.click(bar!);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "pipes", kind: "pipe", obj: pipe });
  });
});

// ── every meaningful Stats tile is clickable and records the Stats
// origin (hero year-consumption, avg session duration, aroma-profile bars,
// taste profile). ───────────────────────────────────────────────────────────
describe("StatsView — tiles are clickable", () => {
  const thisYear = new Date().getFullYear();
  const baseCtx = {
    view: "stats",
    chartData: {
      catW: [["Anglais", 100]], brandW: [],
      ratings: [], pShapes: [], pBowl: [], pStem: [],
      monthlyDur: [], monthlyWeight: [[`${thisYear}-07`, 86]],
      yearlyDur: [], yearlyWeight: [], topTobaccos: [], topPipes: [],
      avgSessionDuration: 30, totalSessions: 10,
      tasteProfile: { count: 5, force: 3, roomNote: 2, taste: 4 },
    },
    data: {
      tobaccos: [{ id: "1", brand: "D", name: "N", category: "Anglais", lots: [] }],
      pipes: [], accessories: [], wishlist: [],
      sessions: [
        { id: 1, tobaccoId: "1", aromas: ["leather"] },
        { id: 2, tobaccoId: "1", aromas: ["leather"] },
        { id: 3, tobaccoId: "1", aromas: ["leather"] },
      ],
    },
  };

  const btnByText = (c: HTMLElement, re: RegExp) =>
    Array.from(c.querySelectorAll("button")).find((b) => re.test(b.textContent || ""));

  it("the year-consumption hero opens the journal filtered on that year", () => {
    const navToJournalFiltered = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, navToJournalFiltered });
    const hero = btnByText(container, /lbl_consumption/);
    expect(hero, "expected the consumption hero").toBeTruthy();
    fireEvent.click(hero!);
    expect(navToJournalFiltered).toHaveBeenCalledWith(String(thisYear));
  });

  it("the avg-duration tile opens the journal (all sessions)", () => {
    const navToJournalFiltered = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, navToJournalFiltered });
    const tile = btnByText(container, /min_short/);
    expect(tile, "expected the avg-duration tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(navToJournalFiltered).toHaveBeenCalledWith("");
  });

  it("the taste-profile tile opens the (active) inventory", () => {
    const navToInvFiltered = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, navToInvFiltered });
    const tile = btnByText(container, /lbl_force/);
    expect(tile, "expected the taste-profile tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(navToInvFiltered).toHaveBeenCalledWith("", "");
  });

  it("an aroma-profile bar opens the inventory filtered on that aroma", () => {
    const navToInvByAroma = vi.fn();
    const { container } = renderWithCtx(<CuratorStatsView />, { ...baseCtx, navToInvByAroma });
    const bar = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .filter((el) => /aroma_leather/.test(el.textContent || ""))
      .find((el) => !Array.from(el.querySelectorAll("*")).some((c) => /aroma_leather/.test(c.textContent || "")));
    expect(bar, "expected a leather aroma bar").toBeTruthy();
    fireEvent.click(bar!);
    expect(navToInvByAroma).toHaveBeenCalledWith("leather");
  });
});

// ── the second metric must survive a narrow row ──────────────
// "Top pipes" shows the session COUNT as the bar's value and the total HOURS
// beside the name; "Top tabacs" shows the weight and the session count. Those
// parentheticals used to be concatenated into the label, which is a single
// ellipsized line — so at 360px in German at the "L" text size the row needed
// 349px of 306 and the ellipsis ate the figure rather than the name. A name is
// still identifiable from its first half; a truncated number is not.
describe("StatsView — top rows keep their second metric", () => {
  it("passes the parenthetical as `note`, never concatenated into the label", async () => {
    const { hBars } = await import("../../components/Charts.jsx");
    // Render through the real helper with a note, and assert the two live in
    // separate elements — the note's own element is what makes it unclippable.
    const { render } = await import("@testing-library/react");
    const { container } = render(
      <div>{hBars([{ label: "Savinelli Marte Rusticated 320 KS", note: "(1.7h)", value: 3, unit: " séances" }], 300, "")}</div>,
    );
    const spans = Array.from(container.querySelectorAll("span"));
    const name = spans.find((s) => (s.textContent || "").startsWith("Savinelli"))!;
    const note = spans.find((s) => (s.textContent || "") === "(1.7h)")!;
    expect(name, "the name should render in its own element").toBeTruthy();
    expect(note, "the note must not be merged into the label text").toBeTruthy();
    // Neither is lost: the name WRAPS (moving the note out alone had merely
    // reallocated the clipping onto the name — measured at 277px of a 268px box
    // in French at the default size), and the note never shrinks.
    expect(name.style.textOverflow).not.toBe("ellipsis");
    expect(name.style.whiteSpace).not.toBe("nowrap");
    expect(note.style.flexShrink).toBe("0");
    expect(note.style.textOverflow).not.toBe("ellipsis");
  });

  it("a row with no note is unchanged", async () => {
    const { hBars } = await import("../../components/Charts.jsx");
    const { render } = await import("@testing-library/react");
    const { container } = render(<div>{hBars([{ label: "Anglais", value: 5 }], 300, "")}</div>);
    expect(container.textContent).toContain("Anglais");
    // No stray empty element where the note would be.
    expect(Array.from(container.querySelectorAll("span"))
      .filter((s) => (s.textContent || "").trim() === "").length).toBe(0);
  });
});

// ── the Stats calendar cells are real tap targets ────────────
// They carry onCellClick (→ the journal filtered on that day), so 14x14 with a
// 2px gap was under WCAG 2.5.8's 24px AA floor with no spacing exception
// available (a 24px circle on each would intersect its neighbour's). At 24 the
// target meets the minimum outright. The HOME calendar is deliberately left at
// 27x11 under the "essential" exception — see the note in HomeViewV2 — so this
// asserts the two are allowed to differ, and why.
describe("Stats calendar tap target", () => {
  it("renders 24px cells", async () => {
    const { calendarHeatmap } = await import("../../components/Charts.jsx");
    const { render } = await import("@testing-library/react");
    const today = "2026-07-26";
    const { container } = render(
      <div>{calendarHeatmap({ [today]: 2 }, today, [], () => {}, undefined)}</div>,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects.length, "the heatmap should render its grid").toBeGreaterThan(300);
    for (const r of rects.slice(0, 20)) {
      expect(r.getAttribute("width")).toBe("24");
      expect(r.getAttribute("height")).toBe("24");
    }
  });

  it("the cells are clickable, which is why the size matters", async () => {
    const { calendarHeatmap } = await import("../../components/Charts.jsx");
    const { render, fireEvent } = await import("@testing-library/react");
    const onCell = vi.fn();
    const today = "2026-07-26";
    const { container } = render(
      <div>{calendarHeatmap({ [today]: 2 }, today, [], onCell, undefined)}</div>,
    );
    fireEvent.click(container.querySelector("rect")!);
    expect(onCell).toHaveBeenCalled();
  });
});
