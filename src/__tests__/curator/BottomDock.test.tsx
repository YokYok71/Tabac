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

    // jsdom may reorder the factors inside calc(), so compare on a
    // whitespace-stripped form that tolerates either multiplication order.
    const norm = (s: string) => s.replace(/\s+/g, "");
    const expectCalc = (actual: string, factor: number, base: string) => {
      const a = norm(actual);
      const mulAB = `(100%-8px)*${factor}`;
      const mulBA = `${factor}*(100%-8px)`;
      expect(a === norm(`calc(${base}${mulAB})`) || a === norm(`calc(${base}${mulBA})`)).toBe(true);
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
