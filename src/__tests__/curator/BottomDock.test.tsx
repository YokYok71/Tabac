// Unit tests for src/components/curator/BottomDock.tsx.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BottomDock, DOCK_ITEMS } from "../../components/curator/BottomDock";
import { C } from "../../theme-curator";

describe("BottomDock", () => {
  it("renders one button per dock item", () => {
    const { container } = render(
      <BottomDock
        active="home"
        onNav={() => {}}
        accent={C.brass}
        items={DOCK_ITEMS}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(DOCK_ITEMS.length);
  });

  it("calls onNav with the item's id when tapped", () => {
    const onNav = vi.fn();
    const { container } = render(
      <BottomDock
        active="home"
        onNav={onNav}
        accent={C.brass}
        items={DOCK_ITEMS}
      />,
    );
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[1]!); // second item
    expect(onNav).toHaveBeenCalled();
    expect(typeof onNav.mock.calls[0]![0]).toBe("string");
  });

  it("can render a filtered subset of dock items (sections toggle)", () => {
    const filtered = DOCK_ITEMS.filter(it => it.id !== "stats");
    const { container } = render(
      <BottomDock
        active="home"
        onNav={() => {}}
        accent={C.brass}
        items={filtered}
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(filtered.length);
  });

  it("renders the label supplied on each item verbatim (labels are translated upstream)", () => {
    // Regression: es/de/it dock labels used to fall back to French because
    // BottomDock hard-coded a FR/EN-only map. It now renders it.label as-is,
    // so CuratorApp can feed it a resolved "dock_<id>" label in any language.
    const translated = DOCK_ITEMS.map(it => ({ ...it, label: "XX_" + it.id }));
    const { container } = render(
      <BottomDock active="home" onNav={() => {}} accent={C.brass} items={translated} />,
    );
    const txt = container.textContent || "";
    expect(txt).toContain("XX_home");
    expect(txt).toContain("XX_stats");
    // The old hard-coded French fallback must NOT leak through.
    expect(txt).not.toContain("Cave");
  });

  it("keeps the brass indicator inset from the pill edges (no corner overhang)", () => {
    // Regression: the indicator used to span the full cell width from
    // left:0% of the pill, so on the first/last tab it overhung the pill's
    // rounded corners and floated outside the glass on the installed PWA.
    // It is now centred on the active tab at 60% of the cell width, offset
    // past the 4px pill padding.
    const renderFor = (active: string) => {
      const { container, unmount } = render(
        <BottomDock active={active} onNav={() => {}} accent={C.brass} items={DOCK_ITEMS} />,
      );
      const pill = container.querySelector("button")!.parentElement!.parentElement!;
      const indicator = pill.firstElementChild as HTMLElement;
      const style = indicator.style;
      unmount();
      return style;
    };

    // Compare the VALUE, not the spelling. This used to compare the calc()
    // string, first allowing for jsdom reordering its factors — and jsdom 31
    // then SIMPLIFIED it outright: `calc(4px + (100% - 8px) * 1/12)` comes back
    // as `calc(8.33333% + 3.33333px)`, the same length written another way. So
    // the expression is evaluated for two pill widths and compared with the
    // formula the component means: `base + (W - 8) * factor`, in px.
    const evalCss = (expr: string, W: number): number => {
      const src = expr.trim().replace(/^calc/, "");
      let i = 0;
      const ws = () => { while (src[i] === " ") i++; };
      const atom = (): number => {
        ws();
        if (src[i] === "(") { i++; const v = sum(); ws(); i++; return v; }
        const m = /^-?\d*\.?\d+(?:e-?\d+)?(%|px)?/.exec(src.slice(i));
        if (!m) throw new Error("cannot parse " + JSON.stringify(expr) + " at " + i);
        i += m[0].length;
        const n = parseFloat(m[0]);
        return m[1] === "%" ? (n * W) / 100 : n;
      };
      const prod = (): number => {
        let v = atom();
        for (;;) { ws(); if (src[i] === "*") { i++; v *= atom(); } else if (src[i] === "/") { i++; v /= atom(); } else return v; }
      };
      const sum = (): number => {
        let v = prod();
        for (;;) { ws(); if (src[i] === "+") { i++; v += prod(); } else if (src[i] === "-") { i++; v -= prod(); } else return v; }
      };
      return sum();
    };
    const expectCalc = (actual: string, factor: number, base: string) => {
      const basePx = base ? parseFloat(base) : 0;
      for (const W of [320, 480]) {
        expect(evalCss(actual, W), `${actual} at a ${W}px pill`).toBeCloseTo(basePx + (W - 8) * factor, 2);
      }
    };

    const first = renderFor("home");
    // Centred via translate(-50%, -50%) so the left offset is the tab centre,
    // never the pill's raw left edge.
    expect(first.transform).toContain("translate(-50%, -50%)");
    expectCalc(first.left, 0.5 / DOCK_ITEMS.length, "4px+");
    expectCalc(first.width, 0.6 / DOCK_ITEMS.length, "");

    const last = renderFor("stats");
    expectCalc(last.left, (DOCK_ITEMS.length - 0.5) / DOCK_ITEMS.length, "4px+");
  });

  it("DOCK_ITEMS contains the expected 6 sections", () => {
    const ids = DOCK_ITEMS.map(it => it.id);
    expect(ids).toContain("home");
    expect(ids).toContain("inv");
    expect(ids).toContain("pipes");
    expect(ids).toContain("acc");
    expect(ids).toContain("journal");
    expect(ids).toContain("stats");
  });
});
