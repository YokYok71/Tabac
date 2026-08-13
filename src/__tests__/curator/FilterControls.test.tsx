// Unit tests for src/components/curator/FilterControls.tsx.
// Locks the a11y attributes (aria-pressed on toggle states,
// aria-label on icon-only buttons) so a future refactor can't
// silently drop them.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import {
  ToggleBtn,
  ActiveFilterPill,
  FilterChipSimple,
  ScrollableChipRow,
} from "../../components/curator/FilterControls";

describe("ToggleBtn", () => {
  it("renders with aria-label and aria-pressed reflecting the on prop", () => {
    const { container } = renderWithCtx(
      <ToggleBtn on={true} icon="more" onClick={() => {}} ariaLabel="Group by brand" />,
      {},
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-label")).toBe("Group by brand");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("aria-pressed is 'false' when off", () => {
    const { container } = renderWithCtx(
      <ToggleBtn on={false} icon="more" onClick={() => {}} ariaLabel="Group by brand" />,
      {},
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
  });

  it("respects WCAG 2.5.5 touch target (≥ 44×44)", () => {
    const { container } = renderWithCtx(
      <ToggleBtn on={false} icon="more" onClick={() => {}} ariaLabel="X" />,
      {},
    );
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.style.width).toBe("44px");
    expect(btn.style.height).toBe("44px");
  });

  it("fires onClick on tap", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ToggleBtn on={false} icon="more" onClick={fn} ariaLabel="X" />,
      {},
    );
    const btn = container.querySelector("button") as HTMLElement;
    fireEvent.pointerDown(btn, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(btn, { pointerType: "mouse", button: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("ActiveFilterPill", () => {
  it("renders the label", () => {
    const { container } = renderWithCtx(
      <ActiveFilterPill label="Virginia" onClear={() => {}} />,
      {},
    );
    expect(container.textContent).toContain("Virginia");
  });

  it("the clear × button has an aria-label", () => {
    const { container } = renderWithCtx(
      <ActiveFilterPill label="Virginia" onClear={() => {}} />,
      { t: (k: string) => k === "btn_clear" ? "Clear filter" : k },
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-label")).toBe("Clear filter");
  });

  it("fires onClear when × is clicked", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ActiveFilterPill label="Virginia" onClear={fn} />,
      {},
    );
    const btn = container.querySelector("button") as HTMLElement;
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("FilterChipSimple", () => {
  it("renders the label", () => {
    const { container } = renderWithCtx(
      <FilterChipSimple on={false} label="Active only" onClick={() => {}} />,
      {},
    );
    expect(container.textContent).toContain("Active only");
  });

  // An earlier release a11y fix — locks the aria-pressed attribute so a future
  // refactor can't silently drop it (a screen reader user would no
  // longer be told which chip is the active filter).
  it("aria-pressed is 'true' when on", () => {
    const { container } = renderWithCtx(
      <FilterChipSimple on={true} label="Active only" onClick={() => {}} />,
      {},
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("aria-pressed is 'false' when off", () => {
    const { container } = renderWithCtx(
      <FilterChipSimple on={false} label="Active only" onClick={() => {}} />,
      {},
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onClick when tapped", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <FilterChipSimple on={false} label="Active only" onClick={fn} />,
      {},
    );
    const btn = container.querySelector("button") as HTMLElement;
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// leaving the wishlist re-homes the status-chip strip. The row's
// scrollLeft persists across re-renders, so a programmatic selection change
// (wish → tobacco list) left it stuck on the right-hand Wishlist chip;
// bumping `resetScrollSignal` scrolls it back to the far left.
describe("ScrollableChipRow — resetScrollSignal", () => {
  // Plain render (not renderWithCtx) so rerender keeps the SAME root type — a
  // provider→bare swap would remount and fire the effect spuriously.
  // ScrollableChipRow needs no ctx.
  it("scrolls back to the left when resetScrollSignal changes", () => {
    const scrollTo = vi.fn();
    // jsdom doesn't implement Element.scrollTo — install it so the effect runs.
    (HTMLElement.prototype as any).scrollTo = scrollTo;
    const { rerender } = render(
      <ScrollableChipRow resetScrollSignal={0}><span>chip</span></ScrollableChipRow>,
    );
    scrollTo.mockClear(); // ignore the mount call
    rerender(<ScrollableChipRow resetScrollSignal={1}><span>chip</span></ScrollableChipRow>);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it("does NOT scroll when resetScrollSignal is unchanged", () => {
    const scrollTo = vi.fn();
    (HTMLElement.prototype as any).scrollTo = scrollTo;
    const { rerender } = render(
      <ScrollableChipRow resetScrollSignal={5}><span>a</span></ScrollableChipRow>,
    );
    scrollTo.mockClear();
    rerender(<ScrollableChipRow resetScrollSignal={5}><span>b</span></ScrollableChipRow>);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
