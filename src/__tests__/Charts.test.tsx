import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { hBars, vBars, donutChart, calendarHeatmap } from "../components/Charts.jsx";
import { C } from "../theme-curator.ts";

// ── hBars ─────────────────────────────────────────────────────────────────────

describe("hBars(items, w)", () => {
  it("returns null for empty input", () => {
    const { container } = render(<>{hBars([], 200)}</>);
    expect(container.firstChild).toBeNull();
  });

  it("returns null for null input", () => {
    const { container } = render(<>{hBars(null as any, 200)}</>);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when all values are 0", () => {
    const { container } = render(
      <>{hBars([{ label: "a", value: 0 }], 200)}</>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per item", () => {
    const items = [
      { label: "Virginia", value: 10 },
      { label: "Latakia", value: 5 },
      { label: "Burley", value: 3 },
    ];
    const { container } = render(<>{hBars(items, 300)}</>);
    // Each item has a label text node
    items.forEach((it) => {
      expect(container).toHaveTextContent(it.label);
    });
  });

  it("shows value text for each item", () => {
    const items = [
      { label: "A", value: 42, unit: "g" },
      { label: "B", value: 7, unit: "g" },
    ];
    const { container } = render(<>{hBars(items, 200)}</>);
    expect(container).toHaveTextContent("42g");
    expect(container).toHaveTextContent("7g");
  });

  it("renders the max-value bar at 100% width", () => {
    const items = [
      { label: "Top", value: 100 },
      { label: "Half", value: 50 },
    ];
    const { container } = render(<>{hBars(items, 200)}</>);
    const bars = container.querySelectorAll<HTMLElement>(
      "[style*='height: 12px'] > div"
    );
    // First bar (max) should be 100%
    expect(bars[0]!.style.width).toBe("100%");
    // Second bar should be 50%
    expect(bars[1]!.style.width).toBe("50%");
  });

  it("uses custom color when provided", () => {
    const items = [{ label: "x", value: 5, color: "#ff0000" }];
    const { container } = render(<>{hBars(items, 200)}</>);
    const bar = container.querySelector<HTMLElement>("[style*='height: 100%']");
    expect(bar?.style.background).toBe("rgb(255, 0, 0)");
  });

  it("calls onClick when item is clickable", () => {
    const handler = vi.fn();
    const items = [{ label: "Click me", value: 5, onClick: handler }];
    const { container } = render(<>{hBars(items, 200)}</>);
    // The outer div for the row has the onClick
    const row = container.querySelector<HTMLElement>("[style*='pointer']");
    if (row) fireEvent.click(row);
    expect(handler).toHaveBeenCalled();
  });
});

// ── vBars ─────────────────────────────────────────────────────────────────────

describe("vBars(items, w, hh)", () => {
  it("returns null for empty input", () => {
    const { container } = render(<>{vBars([], 200)}</>);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when all values are 0", () => {
    const { container } = render(
      <>{vBars([{ label: "x", value: 0 }], 200)}</>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an SVG element", () => {
    const items = [
      { label: "Jan", value: 10 },
      { label: "Feb", value: 20 },
    ];
    const { container } = render(<>{vBars(items, 200)}</>);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders one <g> group per item", () => {
    const items = [
      { label: "Jan", value: 10 },
      { label: "Feb", value: 20 },
      { label: "Mar", value: 15 },
    ];
    const { container } = render(<>{vBars(items, 300)}</>);
    const groups = container.querySelectorAll("g");
    expect(groups).toHaveLength(3);
  });

  it("renders label text for each bar", () => {
    const items = [
      { label: "Jan", value: 5 },
      { label: "Feb", value: 8 },
    ];
    const { container } = render(<>{vBars(items, 200)}</>);
    expect(container).toHaveTextContent("Jan");
    expect(container).toHaveTextContent("Feb");
  });

  it("renders value text above non-zero bars", () => {
    const items = [{ label: "Jan", value: 42 }];
    const { container } = render(<>{vBars(items, 200)}</>);
    expect(container).toHaveTextContent("42");
  });

  it("respects custom height hh", () => {
    const items = [{ label: "x", value: 10 }];
    const { container } = render(<>{vBars(items, 200, 150)}</>);
    const svg = container.querySelector("svg") as SVGElement;
    // height = hh + 28 + pad(14)
    expect(svg.getAttribute("height")).toBe("192");
  });

  it("calls onClick when bar is clicked", () => {
    const handler = vi.fn();
    const items = [{ label: "click", value: 5, onClick: handler }];
    const { container } = render(<>{vBars(items, 200)}</>);
    const group = container.querySelector("g") as SVGGElement;
    fireEvent.click(group);
    expect(handler).toHaveBeenCalled();
  });
});

// ── donutChart ────────────────────────────────────────────────────────────────

describe("donutChart(items, size, weightUnit)", () => {
  it("returns null for empty input", () => {
    const { container } = render(<>{donutChart([], 200, "g")}</>);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when total is 0", () => {
    const { container } = render(
      <>{donutChart([{ label: "x", value: 0, color: "#fff" }], 200, "g")}</>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an SVG for a single item", () => {
    const { container } = render(
      <>{donutChart([{ label: "Virginia", value: 100, color: "#5a7a5a" }], 200, "g")}</>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("renders the total + unit in the center for single item", () => {
    const { container } = render(
      <>{donutChart([{ label: "Virginia", value: 150, color: "#5a7a5a" }], 200, "g")}</>
    );
    expect(container).toHaveTextContent("150g");
  });

  it("renders the total in the center for multiple items", () => {
    const items = [
      { label: "Virginia", value: 100, color: "#5a7a5a" },
      { label: "Latakia", value: 50, color: "#7b8fa6" },
    ];
    const { container } = render(<>{donutChart(items, 200, "g")}</>);
    expect(container).toHaveTextContent("150g");
  });

  it("renders one <path> per item for multi-item chart", () => {
    const items = [
      { label: "A", value: 60, color: "#aaa" },
      { label: "B", value: 30, color: "#bbb" },
      { label: "C", value: 10, color: "#ccc" },
    ];
    const { container } = render(<>{donutChart(items, 200, "g")}</>);
    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(3);
  });

  it("sets SVG width and height to size", () => {
    const items = [{ label: "x", value: 50, color: "#aaa" }];
    const { container } = render(<>{donutChart(items, 180, "g")}</>);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("180");
    expect(svg.getAttribute("height")).toBe("180");
  });

  it("appends weightUnit to the total label", () => {
    const items = [{ label: "x", value: 25, color: "#aaa" }];
    const { container } = render(<>{donutChart(items, 200, "oz")}</>);
    expect(container).toHaveTextContent("25oz");
  });

  it("calls onClick on path click", () => {
    const handler = vi.fn();
    const items = [
      { label: "A", value: 50, color: "#aaa", onClick: handler },
      { label: "B", value: 50, color: "#bbb" },
    ];
    const { container } = render(<>{donutChart(items, 200, "g")}</>);
    const firstPath = container.querySelector("path") as SVGPathElement;
    fireEvent.click(firstPath);
    expect(handler).toHaveBeenCalled();
  });
});

// ── calendarHeatmap ───────────────────────────────────────────────────────────

describe("calendarHeatmap(byDay)", () => {
  // Helper: local YYYY-MM-DD string `n` days before today (no UTC shift).
  function dayKey(daysAgo: number) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  it("renders an SVG with cells", () => {
    const { container } = render(<>{calendarHeatmap({}, null)}</>);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("includes a cell whose tooltip carries today's LOCAL date — regression for the UTC off-by-one bug", () => {
    // Before the fix: cells were keyed via toISOString().slice(0,10), which
    // shifts to the previous day in any non-UTC timezone. byDay lookups
    // therefore never matched and the heatmap rendered entirely empty.
    const todayKey = dayKey(0);
    const byDay: Record<string, number> = {};
    byDay[todayKey] = 3;
    const { container } = render(<>{calendarHeatmap(byDay, null)}</>);
    const tooltips = Array.from(container.querySelectorAll("title")).map(
      function (n) {
        return (n as Element).textContent || "";
      },
    );
    const todayTooltip = tooltips.find(function (t) {
      return t.indexOf(todayKey) === 0;
    });
    expect(todayTooltip).toBeDefined();
    expect(todayTooltip).toContain("· 3");
  });

  it("renders all cells with count=0 when byDay is empty", () => {
    const { container } = render(<>{calendarHeatmap({}, null)}</>);
    const tooltips = Array.from(container.querySelectorAll("title")).map(
      function (n) {
        return (n as Element).textContent || "";
      },
    );
    const zeros = tooltips.filter(function (t) {
      return t.endsWith("· 0");
    });
    expect(zeros.length).toBe(tooltips.length);
    // 53 cols × 7 rows = 371 cells; some future ones are skipped, so 300+
    expect(tooltips.length).toBeGreaterThan(300);
  });

  it("respects a non-null `today` argument", () => {
    // Anchor on a specific past date so the heatmap is deterministic.
    const byDay: Record<string, number> = { "2025-06-15": 2 };
    const { container } = render(
      <>{calendarHeatmap(byDay, new Date("2025-06-20T12:00:00"))}</>,
    );
    const tooltips = Array.from(container.querySelectorAll("title")).map(
      function (n) {
        return (n as Element).textContent || "";
      },
    );
    const match = tooltips.find(function (t) {
      return t.indexOf("2025-06-15") === 0;
    });
    expect(match).toBeDefined();
    expect(match).toContain("· 2");
  });

  it("regression: each cell's onClick fires with its OWN iso/count (not last loop iteration)", () => {
    // Closure-in-loop bug fix: when var-scoped iso/count are captured by
    // an inline closure inside a for-loop, every handler ends up pointing
    // at the same variable and fires with the final iteration's values.
    // The cell factory captures by value via function parameters.
    const seen: Array<[string, number]> = [];
    const byDay: Record<string, number> = {
      "2025-06-10": 1,
      "2025-06-15": 4,
    };
    const { container } = render(
      <>{calendarHeatmap(byDay, new Date("2025-06-20T12:00:00"), undefined, function (date: string, count: number) {
        seen.push([date, count]);
      })}</>,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    function rectFor(date: string) {
      return rects.find(function (r) {
        const title = r.querySelector("title");
        return title && (title.textContent || "").indexOf(date) === 0;
      }) as SVGRectElement | undefined;
    }
    const r1 = rectFor("2025-06-10");
    const r2 = rectFor("2025-06-15");
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    fireEvent.click(r1!);
    fireEvent.click(r2!);
    expect(seen).toEqual([
      ["2025-06-10", 1],
      ["2025-06-15", 4],
    ]);
  });

  it("uses absolute thresholds for colors: 1 = green, 2-3 = amber, 4+ = red", () => {
    // Anchor on a fixed past date so all data cells are present in the grid.
    const byDay: Record<string, number> = {
      "2025-06-10": 1, // green
      "2025-06-11": 2, // amber
      "2025-06-12": 3, // amber
      "2025-06-13": 4, // red
      "2025-06-14": 9, // red (high count stays red, not normalized)
    };
    const { container } = render(
      <>{calendarHeatmap(byDay, new Date("2025-06-20T12:00:00"))}</>,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    function fillFor(date: string) {
      const tooltip = container.querySelector(`title`);
      void tooltip;
      const found = rects.find(function (r) {
        const title = r.querySelector("title");
        return (
          title && (title.textContent || "").indexOf(date) === 0
        );
      });
      // heatmap cells fill via style (not the attribute) so a
      // themeable var() token would resolve on WebKit.
      return found ? ((found as SVGElement).style.fill || "") : "";
    }
    // Curator ramp: low=sage, mid=amber, high=oxbloodHi. Those
    // tokens are themeable var() strings now, applied via style.fill.
    expect(fillFor("2025-06-10")).toBe(C.sage);
    expect(fillFor("2025-06-11")).toBe(C.amber);
    expect(fillFor("2025-06-12")).toBe(C.amber);
    expect(fillFor("2025-06-13")).toBe(C.oxbloodHi);
    expect(fillFor("2025-06-14")).toBe(C.oxbloodHi);
  });
});
