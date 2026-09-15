// Unit tests for src/components/curator/AICard.tsx (AICard).

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AICard } from "../../components/curator/AICard";

describe("AICard", () => {
  it("renders with no apiKey (grey-out state)", () => {
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco"
        apiKey=""
        aiLoad={false}
        aiErr=""
        aiAutoFill={vi.fn()}
        t={(k: string) => k}
      />,
      {},
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the Auto-fill button when apiKey is present", () => {
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco"
        apiKey="sk-test"
        aiLoad={false}
        aiErr=""
        aiAutoFill={vi.fn()}
        t={(k: string) => k}
      />,
      {},
    );
    expect(container.querySelector("[role='button']")).toBeTruthy();
  });

  // THE ONLY THING THIS CASE USED TO ASSERT WAS THE WORD "loading".
  //
  // It clicked inside `if (btn) { … }` with NOTHING in the block — the comment
  // there literally said "even if it fires … we just verify the loading prop
  // reaches the DOM" — and `aiAutoFill` was a `vi.fn()` nobody ever
  // interrogated. So the case named "disables the button while aiLoad=true"
  // asserted neither the disabling nor the not-calling: a second tap during a
  // fill could have launched a second paid provider request and this stayed
  // green.
  //
  // The `if` could never run either. While loading, AICard passes
  // `onClick={undefined}`, and PressCard drops `role="button"` when it has
  // neither a handler nor `ariaDisabled` — so `[role='button']` matched
  // nothing and the block was dead code, not a guard.
  //
  // The busy card is found by the state it announces (`aria-busy`), tapped,
  // and the absence of a call is asserted.
  it("does not fire aiAutoFill while aiLoad=true, and says it is busy", () => {
    const aiAutoFill = vi.fn();
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco"
        apiKey="sk-test"
        aiLoad={true}
        aiErr=""
        aiAutoFill={aiAutoFill}
        t={(k: string) => k}
      />,
      {},
    );
    const busy = container.querySelector("[aria-busy='true']") as HTMLElement | null;
    expect(busy, "the in-flight search control announces no busy state").toBeTruthy();
    expect(busy!.textContent, "the busy control is not the search button")
      .toMatch(/Loading|Chargement|loading/i);
    fireEvent.click(busy!);
    expect(aiAutoFill, "a tap during a fill in flight launched a second provider request")
      .not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Loading|Chargement|loading/i);
  });

  it("displays aiErr text when set", () => {
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco"
        apiKey="sk-test"
        aiLoad={false}
        aiErr="API rate limit exceeded"
        aiAutoFill={vi.fn()}
        t={(k: string) => k}
      />,
      {},
    );
    expect(container.textContent).toContain("API rate limit exceeded");
  });
});

describe("AICard — label scan button", () => {
  it("renders the scan button only when onScanFile is provided", () => {
    const { container, rerender } = renderWithCtx(
      <AICard kind="tobacco" apiKey="k" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k} onScanFile={vi.fn()} />,
      {},
    );
    expect(container.textContent).toContain("ai_scan_btn");
    rerender(
      <AICard kind="tobacco" apiKey="k" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k} />,
    );
    expect(container.textContent).not.toContain("ai_scan_btn");
  });

  it("hands the picked file to onScanFile and resets the input", () => {
    const onScanFile = vi.fn();
    const { container } = renderWithCtx(
      <AICard kind="tobacco" apiKey="k" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k} onScanFile={onScanFile} />,
      {},
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe("image/*");
    const file = new File(["x"], "tin.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onScanFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("scan button is inert without an API key", () => {
    const onScanFile = vi.fn();
    const { container } = renderWithCtx(
      <AICard kind="tobacco" apiKey="" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k} onScanFile={onScanFile} />,
      {},
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    const scanBtn = Array.from(container.querySelectorAll("*")).find(
      el => el.textContent === "ai_scan_btn" && (el as HTMLElement).onclick !== undefined,
    );
    // Tap the visible scan PressCard — find by text.
    const pressTargets = Array.from(container.querySelectorAll("[tabindex]"))
      .filter(el => (el.textContent || "").includes("ai_scan_btn"));
    if (pressTargets[0]) fireEvent.click(pressTargets[0]);
    else if (scanBtn) fireEvent.click(scanBtn);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// The catalogue offer left this card.
//
// It now lives in <CatalogOffer>, rendered by the forms directly under the
// BRAND field (this card sits above the whole form, so with the keyboard up
// the offer was scrolled off-screen and a recognised blend went unnoticed).
// This test keeps the card from quietly growing one back.
// ─────────────────────────────────────────────────────────────
describe("AICard — no catalogue hint", () => {
  it("never renders a catalogue hint, whatever it is passed", () => {
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco" apiKey="sk-test" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k}
        {...({ dbHinted: true } as any)}
      />, {},
    );
    expect(container.textContent).not.toContain("ai_db_hint");
    expect(container.textContent).not.toContain("ai_db_apply");
  });
});

// ─────────────────────────────────────────────────────────────
// A visually-disabled trigger must SAY it is disabled.
//
// The convention for disabling a PressCard is `onClick={cond ? undefined : cb}`,
// which drops role and tabIndex — so with no API key these buttons rendered as
// plain text: a screen-reader user was never told a search button was there at
// all, only that some greyed words existed. The reason sits right above them
// (ai_no_key_hint), which is only useful if the control is discoverable.
// FormFields.tsx's submit has always carried aria-disabled; this matches it.
//
// Asserted on ROLE + aria-disabled rather than on styling: the greying is what
// a sighted user sees, and it was already correct — the gap was semantic.
// ─────────────────────────────────────────────────────────────
describe("AICard — disabled buttons are announced", () => {
  function render(apiKey: string) {
    return renderWithCtx(
      <AICard
        kind="tobacco" apiKey={apiKey} aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} onScanFile={vi.fn()} t={(k: string) => k}
      />, {},
    );
  }

  it("with no key: both triggers are buttons marked aria-disabled and focusable", () => {
    const { container } = render("");
    const btns = Array.from(container.querySelectorAll('[role="button"]'));
    const disabled = btns.filter((b) => b.getAttribute("aria-disabled") === "true");
    // The search button + the label-scan button.
    expect(disabled.length).toBe(2);
    // Focusable: a user must be able to reach it to learn it is unavailable.
    // (Never the native `disabled`, which removes it from the tree entirely.)
    disabled.forEach((b) => expect(b.getAttribute("tabindex")).toBe("0"));
  });

  // Guards the OPPOSITE direction — an enabled button wrongly announced as
  // disabled. It cannot fail from the attribute merely being absent (verified:
  // it is the one case of the three that still passes with the fix reverted),
  // so its role assertion is what keeps it non-vacuous.
  it("with a key: neither trigger claims to be disabled", () => {
    const { container } = render("sk-test");
    const flagged = container.querySelectorAll('[aria-disabled="true"]');
    expect(flagged.length).toBe(0);
    // …and they are still real buttons.
    expect(container.querySelectorAll('[role="button"]').length).toBeGreaterThanOrEqual(2);
  });

  it("a disabled trigger still does not fire when activated", () => {
    const spy = vi.fn();
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco" apiKey="" aiLoad={false} aiErr=""
        aiAutoFill={spy} t={(k: string) => k}
      />, {},
    );
    const btn = container.querySelector('[aria-disabled="true"]')!;
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// The provider tag must not split at its separator.
//
// `· {aiProvider}` put a normal space after the middle dot, which is a legal
// break point. At 390 px in FR the header rendered as "AUTO-" plus a lone "·" on
// line 1, and "COMPLÉTER" plus "ANTHROPIC" on line 2 — the dot divorced from the
// word it qualifies. Nothing could catch it but looking at the card: the ratio
// was fine, the text was all present, no box overflowed.
//
// jsdom does not lay text out, so the ONLY thing assertable here is the
// declared intent (whiteSpace) — the actual one-line result was verified in a
// real browser at 390 px in fr AND de (getClientRects().length === 1).
// ─────────────────────────────────────────────────────────────
describe("AICard — provider tag stays on one line", () => {
  it("declares nowrap on the '· provider' tag", () => {
    const { container } = renderWithCtx(
      <AICard
        kind="tobacco" apiKey="sk-test" aiLoad={false} aiErr=""
        aiAutoFill={vi.fn()} t={(k: string) => k} aiProvider="anthropic"
      />, {},
    );
    const tag = Array.from(container.querySelectorAll("span"))
      .find((s) => /^·\s*anthropic$/i.test((s.textContent || "").trim()));
    expect(tag, "the '· provider' tag should render").toBeTruthy();
    expect((tag as HTMLElement).style.whiteSpace).toBe("nowrap");
  });

  /**
   * LA NOTICE QUI DIT COMMENT SORTIR DE L'ÉTAT DÉSACTIVÉ N'EST PAS DÉSACTIVÉE.
   *
   * Le conteneur de la carte portait `opacity: hasKey ? 1 : 0.7`, qui éteignait
   * TOUT son contenu — y compris `ai_no_key_hint`, « Ajoute une clé API dans
   * Paramètres → IA », la seule phrase expliquant comment réactiver la
   * fonction. MESURÉ par `theme:contrast` une fois les dégradés encadrés (ils
   * étaient SAUTÉS, donc cette carte n'avait jamais été mesurée) : **3,15:1
   * pour 4,5 requis** en sombre sur les six palettes et cinq écrans, et
   * « Auto-compléter » à 3,31–3,34:1 en clair.
   *
   * Le signal « inactif » n'a jamais été porté par cette ligne : les DEUX
   * commandes déclarent `aria-disabled`, portent leur propre `opacity` réduite
   * et un curseur `not-allowed`. WCAG 1.4.3 exempte les composants INACTIFS —
   * elles seules le sont. La garde tient les deux moitiés, car ne tenir que la
   * première rendrait acceptable une carte qui ne signale plus rien du tout.
   */
  describe("sans clé API", () => {
    const render = () => renderWithCtx(
      <AICard kind="tobacco" apiKey="" aiLoad={false} aiErr="" aiAutoFill={vi.fn()} t={(k: string) => k} />,
    );

    it("le conteneur n'éteint pas son propre texte d'aide", () => {
      const { container } = render();
      const card = container.querySelector("div[style*='border-radius: 10px'], div[style*='borderRadius']")
        || container.firstElementChild;
      expect(card, "la carte doit se rendre").toBeTruthy();
      const op = (card as HTMLElement).style.opacity;
      expect(op === "" || Number(op) >= 0.99,
        `le conteneur de la carte porte opacity: ${op} — il assombrit la notice qui explique comment activer l'IA`).toBe(true);
    });

    it("mais les COMMANDES, elles, se déclarent bien inactives", () => {
      const { container } = render();
      const off = container.querySelectorAll('[aria-disabled="true"]');
      expect(off.length, "aucune commande ne se déclare inactive — le signal a disparu au lieu de se déplacer")
        .toBeGreaterThanOrEqual(1);
      // et chacune le dit AUSSI visuellement, ce qui est ce que l'exemption
      // WCAG suppose : un composant inactif, pas un texte simplement pâle.
      for (const el of Array.from(off) as HTMLElement[]) {
        expect(el.style.cursor, "une commande inactive garde son curseur not-allowed").toBe("not-allowed");
      }
    });
  });
});
