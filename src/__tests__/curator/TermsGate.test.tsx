// Smoke tests for src/views/curator/TermsGate.tsx.
//
// Coverage focus:
//   - Three privacy points rendered (local-only, best-effort, backup reminder)
//   - "I accept" toggle gates the continue button
//   - acceptTerms is called when continue is tapped and agreed=true
//   - acceptTerms is NOT called when agreed=false

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorTermsGate } from "../../views/curator/TermsGate";

describe("TermsGate", () => {
  it("renders the privacy summary card with all three points", () => {
    const { container } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms: vi.fn(),
      saveLang: vi.fn(),
      t: (k: string) => k,
    });
    // The keys we expect to be in the rendered output (via t() pass-through).
    expect(container.textContent).toMatch(/locally|localement|local/i);
    expect(container.textContent).toMatch(/terms_point_warranty|best-effort/i);
    expect(container.textContent).toMatch(/terms_point_backup|export|Drive/i);
  });

  it("agree checkbox toggles", () => {
    const { container } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms: vi.fn(),
      saveLang: vi.fn(),
    });
    const card = Array.from(container.querySelectorAll("[role='button']"))
      .find(el => /accept|accepte|terms_agree/i.test(el.textContent || ""));
    expect(card).toBeTruthy();
    // Click to agree
    fireEvent.click(card!);
    // After click, the card visually changes; we don't snapshot, just confirm
    // the click handler is wired.
  });

  it("Continue button calls acceptTerms after the user agrees", () => {
    const acceptTerms = vi.fn();
    const { container } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms,
      saveLang: vi.fn(),
    });
    const accept = Array.from(container.querySelectorAll("[role='button']"))
      .find(el => /accept|accepte|terms_agree/i.test(el.textContent || ""));
    fireEvent.click(accept!);
    const continueBtn = Array.from(container.querySelectorAll("[role='button']"))
      .find(el => /Enter the cellar|Entrer dans la cave|terms_enter/i.test(el.textContent || ""));
    expect(continueBtn).toBeTruthy();
    fireEvent.click(continueBtn!);
    expect(acceptTerms).toHaveBeenCalled();
  });

  it("Continue is present but INERT and announced unavailable when not agreed", () => {
    // This test used to assert the OPPOSITE: that no
    // role=button existed yet, on the reasoning that PressCard only sets a role
    // when it has an onClick. That is a faithful description of the mechanism
    // and the wrong expectation: it pinned an accessibility defect as the
    // desired behaviour, on the app's first screen and its only entry point. A
    // keyboard-only or screen-reader user who ticked the box had no focusable,
    // announced control to reach. The control must EXIST and report itself
    // unavailable (aria-disabled), not vanish from the accessibility tree.
    const acceptTerms = vi.fn();
    const { container } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms,
      saveLang: vi.fn(),
    });
    const continueBtn = Array.from(container.querySelectorAll("[role='button']"))
      .find(el => /Enter the cellar|Entrer dans la cave|terms_enter/i.test(el.textContent || ""));
    expect(continueBtn, "the entry control must stay in the a11y tree").toBeTruthy();
    expect(continueBtn!.getAttribute("aria-disabled")).toBe("true");
    expect(continueBtn!.getAttribute("tabindex")).toBe("0");
    // Inert all the same: clicking it must not accept the terms.
    fireEvent.click(continueBtn!);
    expect(acceptTerms).not.toHaveBeenCalled();
  });
});

describe("TermsGate — language toggle", () => {
  it("FR/EN toggle calls saveLang with the picked code", () => {
    const saveLang = vi.fn();
    const { getByText } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms: vi.fn(),
      saveLang,
      lang: "fr",
    });
    fireEvent.click(getByText("EN"));
    expect(saveLang).toHaveBeenCalledWith("en");
  });
});

// ── the entry control must be reachable ──────────────────────
// PressCard computes role/tabIndex from `onClick || ariaDisabled`, and the
// disable idiom here is `onClick={agreed ? acceptTerms : undefined}`. Without
// ariaDisabled the button renders as a bare <div> while the box is unticked —
// no role, not focusable, silent to a screen reader — on the FIRST screen and
// The only way into the app. It escaped the sweep twice: no
// `cursor: "not-allowed"` and a REVERSED ternary. jest-axe has no rule for a
// role-less pseudo-button, so only an explicit assertion catches it.
describe("TermsGate entry button a11y", () => {
  const findEntry = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("*")).find(
      (el) => (el.textContent || "").trim() === "terms_enter"
        || /Entrer dans la cave/.test((el.textContent || "").trim()),
    ) as HTMLElement | undefined;

  it("announces itself as an unavailable button before the box is ticked", () => {
    const { container } = renderWithCtx(<CuratorTermsGate />, { t: (k: string) => k } as any);
    const el = findEntry(container);
    expect(el, "entry control not found").toBeTruthy();
    // Walk up to the element carrying the role — PressCard puts it on its root.
    let node: HTMLElement | null = el!;
    while (node && node.getAttribute("role") !== "button") node = node.parentElement;
    expect(node, "entry control has no role=button while disabled").toBeTruthy();
    expect(node!.getAttribute("aria-disabled")).toBe("true");
    expect(node!.getAttribute("tabindex")).toBe("0");
  });
});
