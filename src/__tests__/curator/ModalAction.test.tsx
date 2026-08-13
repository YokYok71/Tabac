// Unit tests for src/components/curator/ModalAction.tsx — locks the
// three variants (primary / secondary / danger) and the disabled
// behaviour so a future refactor of the variantStyle table can't
// silently regress.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { ModalAction } from "../../components/curator/ModalAction";

describe("ModalAction", () => {
  it("renders children as the button label", () => {
    const { container } = renderWithCtx(
      <ModalAction onClick={() => {}}>Save</ModalAction>,
      {},
    );
    expect(container.textContent).toContain("Save");
  });

  it("fires onClick on tap", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ModalAction onClick={fn}>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { pointerType: "mouse", clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(el, { pointerType: "mouse", clientX: 0, clientY: 0, button: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ModalAction onClick={fn} disabled>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { pointerType: "mouse", clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(el, { pointerType: "mouse", clientX: 0, clientY: 0, button: 0 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("disabled state visually dims the button (opacity ≤ 0.5)", () => {
    const { container } = renderWithCtx(
      <ModalAction disabled onClick={() => {}}>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    const op = parseFloat(el.style.opacity || "1");
    expect(op).toBeLessThanOrEqual(0.5);
    expect(el.style.cursor).toBe("not-allowed");
  });

  it("primary variant uses the brass gradient + bg color text", () => {
    const { container } = renderWithCtx(
      <ModalAction variant="primary" onClick={() => {}}>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    // C.bg = #0e1311 — primary text is dark on bright background
    expect(el.style.color.toLowerCase()).toMatch(/#0e1311|rgb\(14,\s*19,\s*17\)/);
    expect(el.style.background).toMatch(/linear-gradient/i);
    expect(el.style.borderStyle).toBe("none");
  });

  it("secondary variant uses transparent-ish background + rule border", () => {
    const { container } = renderWithCtx(
      <ModalAction variant="secondary" onClick={() => {}}>Cancel</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    // C.rule is a var() now, so jsdom keeps the raw border
    // shorthand but can't decompose it into `borderStyle` — assert on the
    // shorthand string instead.
    expect(el.style.border).toMatch(/1px solid/);
    // No linear gradient on secondary
    expect(el.style.background).not.toMatch(/linear-gradient/i);
  });

  it("danger variant uses oxbloodHi background + ivory text", () => {
    const { container } = renderWithCtx(
      <ModalAction variant="danger" onClick={() => {}}>Delete</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    // C.oxbloodHi = #d27b6f
    expect(el.style.background.toLowerCase()).toMatch(/#d27b6f|rgb\(210,\s*123,\s*111\)/);
    expect(el.style.borderStyle).toBe("none");
  });

  it("renders with role=button (inherited from PressCard)", () => {
    const { container } = renderWithCtx(
      <ModalAction onClick={() => {}}>Save</ModalAction>,
      {},
    );
    const btn = container.querySelector('[role="button"]');
    expect(btn).toBeTruthy();
  });

  it("activates on Enter key (keyboard accessibility)", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ModalAction onClick={fn}>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.keyDown(el, { key: "Enter" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("activates on Space key (keyboard accessibility)", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ModalAction onClick={fn}>Save</ModalAction>,
      {},
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.keyDown(el, { key: " " });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// The two things about this component that nothing asserted.
//
// 1. `ariaLabel` was forwarded to PressCard as `aria-label`, but PressCard's
//    prop is `ariaLabel`. TypeScript does not flag that: it deliberately skips
//    excess-property checking on HYPHENATED JSX attribute names, because they
//    cannot be TS identifiers. So the prop was declared, documented ("Optional
//    aria-label for icon-only buttons"), accepted by the compiler — and thrown
//    away. Latent (no caller passed it yet), but the next icon-only modal
//    action would have shipped with no accessible name at all.
//
// 2. `disabled` styled the button as unavailable and never announced it.
//
// Both are the kind of defect a rendering test catches instantly and a type
// system never will, which is the reason these exist.
// ─────────────────────────────────────────────────────────────
describe("ModalAction — a11y plumbing", () => {
  it("forwards ariaLabel all the way to the DOM", () => {
    const { container } = renderWithCtx(
      <ModalAction ariaLabel="Fermer" onClick={vi.fn()}>×</ModalAction>, {},
    );
    expect((container.firstChild as HTMLElement).getAttribute("aria-label")).toBe("Fermer");
  });

  it("announces the disabled state, and stays focusable so it can be found", () => {
    const { container } = renderWithCtx(
      <ModalAction disabled onClick={vi.fn()}>Enregistrer</ModalAction>, {},
    );
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("an ENABLED action never claims to be disabled", () => {
    const { container } = renderWithCtx(
      <ModalAction onClick={vi.fn()}>Enregistrer</ModalAction>, {},
    );
    expect((container.firstChild as HTMLElement).hasAttribute("aria-disabled")).toBe(false);
  });

  it("disabled still does not fire on click or keyboard", () => {
    const fn = vi.fn();
    const { container } = renderWithCtx(
      <ModalAction disabled onClick={fn}>Enregistrer</ModalAction>, {},
    );
    const el = container.firstChild as HTMLElement;
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.keyDown(el, { key: " " });
    expect(fn).not.toHaveBeenCalled();
  });
});
