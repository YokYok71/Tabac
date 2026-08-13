// Unit tests for the interactive primitives in
// src/components/curator/primitives.tsx.
//
// Coverage focus (a11y invariants):
//   - PressCard: tabIndex=0 + onKeyDown for Enter/Space + role=button +
//     focus ring when focused
//   - IconBtn: default size=44 (touch target floor), aria-label propagation
//   - Stars (read-only and interactive variants)
//   - Lbl: renders the label text

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PressCard, IconBtn, Stars, Lbl, TopBar } from "../../components/curator/primitives";

describe("PressCard", () => {
  it("renders without role/tabIndex when onClick is omitted", () => {
    const { container } = render(<PressCard>content</PressCard>);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBeNull();
  });

  it("sets role='button' and tabIndex=0 when onClick is provided", () => {
    const { container } = render(
      <PressCard onClick={() => {}}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("role")).toBe("button");
    expect(root.getAttribute("tabindex")).toBe("0");
  });

  it("propagates ariaLabel", () => {
    render(
      <PressCard onClick={() => {}} ariaLabel="Add tobacco">child</PressCard>,
    );
    expect(screen.getByRole("button", { name: "Add tobacco" })).toBeTruthy();
  });

  it("fires onClick on click", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClick).toHaveBeenCalled();
  });

  it("activates with Enter (keyboard accessibility)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: "Enter" });
    expect(onClick).toHaveBeenCalled();
  });

  it("activates with Space (keyboard accessibility)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: " " });
    expect(onClick).toHaveBeenCalled();
  });

  it("ignores Enter/Space when onClick is not provided", () => {
    const { container } = render(<PressCard>content</PressCard>);
    // No throw + no side effect — the keyDown handler should be wired only
    // when onClick is provided.
    expect(() =>
      fireEvent.keyDown(container.firstChild as HTMLElement, { key: "Enter" }),
    ).not.toThrow();
  });

  it("applies focus-ring boxShadow when focused", () => {
    const { container } = render(
      <PressCard onClick={() => {}}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.focus(root);
    expect(root.style.boxShadow).toMatch(/.+/);
  });

  it("clears focus-ring on blur", () => {
    const { container } = render(
      <PressCard onClick={() => {}}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.focus(root);
    fireEvent.blur(root);
    // boxShadow falls back to whatever the inline style provided (empty here).
    expect(root.style.boxShadow).toBe("");
  });

  // pointer-move slop guard — a tap that turns into a scroll
  // (finger drifts > 8 px while still inside the button) must NOT fire
  // onClick on pointerUp. This catches the common case where the user
  // starts scrolling Settings with their finger on a button.
  it("does NOT fire onClick when pointer drifts past the tap-slop before up", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(root, { clientX: 100, clientY: 130, pointerType: "touch" }); // 30 px drift
    fireEvent.pointerUp(root, { clientX: 100, clientY: 130, pointerType: "touch" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("DOES fire onClick when pointer barely moves before up (within tap-slop)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(root, { clientX: 102, clientY: 103, pointerType: "touch" }); // < 8 px
    fireEvent.pointerUp(root, { clientX: 102, clientY: 103, pointerType: "touch" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // A "press and roll" tap on a tall featured photo drifts ~10 px —
  // within the bumped 12 px slop, it must STILL fire (the old 8 px cancelled it,
  // making the hero / "du moment" photos feel un-tappable).
  it("fires onClick on a ~10 px press-and-roll (within the bumped slop)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PressCard onClick={onClick}>content</PressCard>,
    );
    const root = container.firstChild as HTMLElement;
    fireEvent.pointerDown(root, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(root, { clientX: 107, clientY: 107, pointerType: "touch" }); // ~9.9 px
    fireEvent.pointerUp(root, { clientX: 107, clientY: 107, pointerType: "touch" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IconBtn", () => {
  // These five pass an `onClick` now. They never MEANT to exercise
  // the handler-less shape — they omitted it because the assertion did not
  // need one — and a handler-less IconBtn is no longer a button at all (see
  // the decorative block at the end of this describe).
  const noop = () => { /* interactive, but the assertion is about the box */ };

  it("renders a <button type='button'>", () => {
    const { container } = render(<IconBtn icon="search" ariaLabel="Search" onClick={noop} />);
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("type")).toBe("button");
  });

  it("propagates ariaLabel", () => {
    render(<IconBtn icon="search" ariaLabel="Search" onClick={noop} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });

  it("falls back to icon name as the aria-label when ariaLabel is missing", () => {
    render(<IconBtn icon="plus" onClick={noop} />);
    expect(screen.getByRole("button", { name: "plus" })).toBeTruthy();
  });

  it("default touch-target size is 44x44 (WCAG 2.5.5)", () => {
    const { container } = render(<IconBtn icon="search" ariaLabel="X" onClick={noop} />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.style.width).toBe("44px");
    expect(btn.style.height).toBe("44px");
  });

  it("respects an explicit size override", () => {
    const { container } = render(
      <IconBtn icon="search" ariaLabel="X" size={48} onClick={noop} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.style.width).toBe("48px");
    expect(btn.style.height).toBe("48px");
  });

  // ─────────────────────────────────────────────────────────────────────
  // With no `onClick` this used to render a real `<button>` with an
  // `aria-label`, a pointer cursor and a border, and every handler
  // early-returned. Six sites use it that way as a masthead ornament beside
  // the page title, so a screen reader announced e.g. "Tabacs, button" — in
  // the tab order, inert — right before the `<h1>` saying the same thing.
  // The catalogue was the sharp case: its decorative `book` sits in a
  // `gap: 8` row directly right of the functional BACK button.
  describe("a handler-less IconBtn is decoration, not a control", () => {
    it("is not a button and not in the accessibility tree", () => {
      const { container } = render(<IconBtn icon="leaf" ariaLabel="Tabacs" />);
      expect(container.querySelector("button"), "inert, so not a button").toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    });

    it("keeps the box byte-identical — only the ROLE changes", () => {
      const el = render(<IconBtn icon="leaf" ariaLabel="Tabacs" />)
        .container.firstElementChild as HTMLElement;
      expect(el.style.width).toBe("44px");
      expect(el.style.height).toBe("44px");
      expect(el.style.borderRadius).toBe("8px");
      expect(el.style.border, "the masthead ornaments are bordered").toContain("1px solid");
      expect(el.style.cursor, "and must stop claiming a press").not.toBe("pointer");
    });

    it("still honours size, border and style overrides", () => {
      const el = render(<IconBtn icon="leaf" size={30} border={false} style={{ opacity: "0.5" }} />)
        .container.firstElementChild as HTMLElement;
      expect(el.style.width).toBe("30px");
      // jsdom serialises the `border` shorthand as "medium" once the style is
      // `none`, so the readable assertion is on borderStyle.
      expect(el.style.borderStyle).toBe("none");
      expect(el.style.opacity).toBe("0.5");
    });
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<IconBtn icon="search" ariaLabel="Search" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onClick).toHaveBeenCalled();
  });

  // useReliableTap now mirrors PressCard's ghost-click
  // defence — a pointerUp-driven onClick installs a one-shot capture-phase
  // document click listener so the trailing synthetic click can't land on an
  // element revealed underneath (e.g. after onClick closed a modal).
  it("pointerUp-driven onClick installs the ghost-click swallow listener", () => {
    const onClick = vi.fn();
    const addSpy = vi.spyOn(document, "addEventListener");
    const { container } = render(<IconBtn icon="search" ariaLabel="X" onClick={onClick} />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    fireEvent.pointerDown(btn, { clientX: 50, clientY: 60, pointerType: "touch" });
    fireEvent.pointerUp(btn, { clientX: 50, clientY: 60, pointerType: "touch" });
    expect(onClick).toHaveBeenCalledTimes(1);
    const installedCapture = addSpy.mock.calls.some((c) => c[0] === "click" && c[2] === true);
    expect(installedCapture).toBe(true);
    addSpy.mockRestore();
  });

  it("native onClick path does NOT install the swallow listener", () => {
    const onClick = vi.fn();
    const addSpy = vi.spyOn(document, "addEventListener");
    render(<IconBtn icon="search" ariaLabel="X" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "X" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    const installedCapture = addSpy.mock.calls.some((c) => c[0] === "click" && c[2] === true);
    expect(installedCapture).toBe(false);
    addSpy.mockRestore();
  });
});

describe("Stars", () => {
  it("renders a row of 5 by default", () => {
    const { container } = render(<Stars n={3} />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(5);
  });

  it("is read-only when onChange is not provided (no role=button)", () => {
    const { container } = render(<Stars n={3} />);
    // No role=button should be on the stars wrapper.
    expect(container.querySelector("[role='button']")).toBeNull();
  });

  it("calls onChange with the clicked star index (1-based) when interactive", () => {
    const onChange = vi.fn();
    const { container } = render(<Stars n={2} onChange={onChange} />);
    const stars = container.querySelectorAll("svg");
    // Click the 4th star
    fireEvent.click(stars[3]!);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  // ── accessibility (H1/H2) ──────────────────────────────────────
  it("interactive rating is a keyboard-operable radiogroup", () => {
    const onChange = vi.fn();
    const { container } = render(<Stars n={3} onChange={onChange} ariaLabel="Force" />);
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.getAttribute("aria-label")).toBe("Force");
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(5);
    // The checked star (3) is the single tab stop; the others are -1.
    expect(radios[2]!.getAttribute("aria-checked")).toBe("true");
    expect((radios[2] as HTMLElement).tabIndex).toBe(0);
    expect((radios[0] as HTMLElement).tabIndex).toBe(-1);
  });

  it("ArrowRight/ArrowLeft change the rating via keyboard", () => {
    const onChange = vi.fn();
    const { container } = render(<Stars n={3} onChange={onChange} />);
    const radios = container.querySelectorAll('[role="radio"]');
    fireEvent.keyDown(radios[2]!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(4);
    onChange.mockClear();
    fireEvent.keyDown(radios[2]!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(2);
    onChange.mockClear();
    fireEvent.keyDown(radios[0]!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("read-only rating exposes a labelled role=img", () => {
    const { container } = render(<Stars n={4} />);
    const img = container.querySelector('[role="img"]') as HTMLElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("aria-label")).toBe("4/5");
    // No interactive radios in display mode.
    expect(container.querySelector('[role="radio"]')).toBeNull();
  });
});

describe("Lbl", () => {
  it("renders the label text", () => {
    render(<Lbl>Cellar</Lbl>);
    expect(screen.getByText("Cellar")).toBeTruthy();
  });
});

describe("TopBar", () => {
  it("renders the title as plain text (not a button) with no onTitleClick", () => {
    render(<TopBar title="Catalogue" />);
    expect(screen.getByText("Catalogue")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the title as an accessible button and fires onTitleClick", () => {
    const onTitleClick = vi.fn();
    render(<TopBar title="Catalogue" onTitleClick={onTitleClick} titleAriaLabel="Parcourir le catalogue" />);
    const btn = screen.getByRole("button", { name: "Parcourir le catalogue" });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onTitleClick).toHaveBeenCalledTimes(1);
  });

  // The top bar is sticky so it stays visible while the page scrolls
  // under it (same recipe as FormScreen). Lock the invariant.
  it("is sticky-positioned at the top with a frosted background", () => {
    const { container } = render(<TopBar title="Catalogue" />);
    const bar = container.firstChild as HTMLElement;
    expect(bar.style.position).toBe("sticky");
    expect(bar.style.top).toBe("0px");
    // Has an opaque-ish background so scrolled content doesn't bleed through.
    expect(bar.style.background).toContain("linear-gradient");
  });
});

// SpecRow renders its value as a safe external link when an href is
// passed (the seller's website URL), and as plain text otherwise.
import { SpecRow } from "../../components/curator/primitives";
describe("SpecRow — seller link", () => {
  it("renders a link when href is set", () => {
    const { container } = render(<SpecRow label="Vendeur" value="SmokingPipes" href="https://smokingpipes.com/" />);
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("https://smokingpipes.com/");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toContain("noopener");
    expect(a!.textContent).toContain("SmokingPipes");
  });
  it("renders plain text (no link) without href", () => {
    const { container } = render(<SpecRow label="Vendeur" value="Local shop" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Local shop");
  });
});
