// Smoke tests for src/components/curator/icons.tsx.
//
// Coverage focus:
//   - Every IcoName resolves to a valid SVG (no missing key in PATHS map)
//   - <svg> wrapper has the correct viewBox, stroke, stroke-width attrs
//   - sw / size / color / fill props propagate
//   - Orn decorative renders a minimal SVG

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Ico, Orn } from "../../components/curator/icons";

// Mirror the union type — must stay in sync with the IcoName definition.
const ALL_NAMES = [
  "home", "leaf", "pipe", "book", "chart", "search", "back",
  "plus", "settings", "flame", "play", "pause", "edit", "trash",
  "box", "chevron", "heart", "clock",
  "sliders", "more", "diamond", "close", "check",
] as const;

describe("Ico — every IcoName resolves to a valid SVG", () => {
  it("renders an <svg> wrapper for every IcoName", () => {
    for (const name of ALL_NAMES) {
      const { container } = render(<Ico name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, `${name} should render an svg`).toBeTruthy();
      // Body content (path/g/circle/rect) must exist — guards against
      // a missing PATHS entry.
      const bodyChildren = svg!.children.length;
      expect(bodyChildren, `${name} svg should have at least one child`).toBeGreaterThan(0);
    }
  });

  it("each icon's viewBox is 24x24", () => {
    for (const name of ALL_NAMES) {
      const { container } = render(<Ico name={name} />);
      expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });
});

describe("Ico — props", () => {
  it("defaults to size=20 and sw=1.6", () => {
    const { container } = render(<Ico name="leaf" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("stroke-width")).toBe("1.6");
  });

  it("propagates size", () => {
    const { container } = render(<Ico name="leaf" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("propagates sw (stroke-width)", () => {
    const { container } = render(<Ico name="leaf" sw={2.4} />);
    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("2.4");
  });

  it("defaults stroke to 'currentColor' so CSS color cascades in", () => {
    const { container } = render(<Ico name="leaf" />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
  });

  it("routes an explicit `color` through the CSS color property (so var() resolves; stroke stays currentColor)", () => {
    // colour is applied via style.color + stroke="currentColor"
    // (not the stroke attribute) so a themeable var() token resolves on WebKit.
    const { container } = render(<Ico name="leaf" color="#ff0000" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect((svg as SVGElement).style.color).toBe("rgb(255, 0, 0)");
  });

  it("defaults fill to 'none' (stroke-only icons)", () => {
    const { container } = render(<Ico name="leaf" />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("none");
  });

  it("allows overriding fill", () => {
    const { container } = render(<Ico name="diamond" fill="currentColor" />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("applies inline style", () => {
    const { container } = render(
      <Ico name="leaf" style={{ marginRight: 8 }} />,
    );
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect((svg.style as any).marginRight).toBe("8px");
  });
});

describe("Ico — specific icons", () => {
  it("'search' is composed of a circle + path (magnifier)", () => {
    const { container } = render(<Ico name="search" />);
    expect(container.querySelector("svg circle")).toBeTruthy();
    expect(container.querySelector("svg path")).toBeTruthy();
  });

  it("'sliders' contains three filled circles for the slider knobs", () => {
    const { container } = render(<Ico name="sliders" />);
    expect(container.querySelectorAll("svg circle").length).toBe(3);
  });

  it("'diamond' uses fill=currentColor (solid)", () => {
    const { container } = render(<Ico name="diamond" />);
    const path = container.querySelector("svg > path");
    expect(path?.getAttribute("fill")).toBe("currentColor");
  });
});

describe("Orn decorative", () => {
  it("Orn renders a 10x10 diamond SVG with the given color", () => {
    const { container } = render(<Orn color="#abcdef" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 10 10");
    // fill via style (so a var() token resolves on WebKit).
    expect((svg?.querySelector("path") as SVGElement).style.fill).toBe("rgb(171, 205, 239)");
  });

  it("Orn uses the requested size", () => {
    const { container } = render(<Orn size={12} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("12");
  });

  // REMOVED with the component: `OrnRule` had no view rendering it, and this
  // case was its only consumer — which is precisely what made it look alive to
  // knip. A test is not a use.
});
