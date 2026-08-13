// Unit tests for src/components/curator/CatalogOffer.tsx.
//
// Two things are locked here:
//   1. the offer's own behaviour (it carries an action, the action fills,
//      "Ignorer" folds it away without filling, and it stands down while a
//      fill is in flight or after an error) — moved from AICard.test.tsx,
//      where this offer used to live;
//   2. its POSITION in both forms: directly after the brand input. That is
//      the whole point of the component — in the AICard at the top of the form it
//      was scrolled off-screen behind the keyboard, so the app recognised a
//      blend somewhere the user could not see. Presence alone would pass
//      just as well from the old spot, so the assertion is on document order.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CatalogOffer } from "../../components/curator/CatalogOffer";
import { AppCtx } from "../../AppContext";

const t = (k: string) => k;
const find = (c: HTMLElement, re: RegExp) =>
  Array.from(c.querySelectorAll("[role='button']"))
    .find((b) => re.test(b.textContent || ""));

describe("CatalogOffer", () => {
  it("offers a fill button when the blend is in the catalogue", () => {
    const { container } = renderWithCtx(
      <CatalogOffer show onApply={vi.fn()} t={t} />, {},
    );
    expect(container.textContent).toContain("ai_db_hint");
    expect(find(container, /ai_db_apply/)).toBeTruthy();
    expect(find(container, /ai_db_ignore/)).toBeTruthy();
  });

  it("the fill button runs the caller's apply", () => {
    const onApply = vi.fn();
    const { container } = renderWithCtx(
      <CatalogOffer show onApply={onApply} t={t} />, {},
    );
    fireEvent.click(find(container, /ai_db_apply/)!);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("'Ignorer' folds the offer away without filling anything", () => {
    const onApply = vi.fn();
    const { container } = renderWithCtx(
      <CatalogOffer show onApply={onApply} t={t} />, {},
    );
    fireEvent.click(find(container, /ai_db_ignore/)!);
    expect(container.textContent).not.toContain("ai_db_hint");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("renders nothing when the blend is not in the catalogue", () => {
    const { container } = renderWithCtx(
      <CatalogOffer onApply={vi.fn()} t={t} />, {},
    );
    expect(container.textContent).not.toContain("ai_db_hint");
  });

  it("stands down while a fill is in flight, and on error", () => {
    const { container: busy } = renderWithCtx(
      <CatalogOffer show busy onApply={vi.fn()} t={t} />, {},
    );
    expect(busy.textContent).not.toContain("ai_db_hint");
    const { container: failed } = renderWithCtx(
      <CatalogOffer show error="boom" onApply={vi.fn()} t={t} />, {},
    );
    expect(failed.textContent).not.toContain("ai_db_hint");
  });
});

// ── placement: the offer must sit under the BRAND field, in both forms ────
// Read off the SOURCE rather than the DOM: making `dbHinted` true in a
// rendered form needs the bundled catalogue loaded (a dynamic import) plus
// the "local" autofill source, which would make this a slow, fragile
// integration test for what is really a layout guarantee. The source order
// is exactly what regressed and exactly what a future refactor would move.
import { readFileSync } from "node:fs";

describe("CatalogOffer placement", () => {
  for (const file of [
    "src/views/curator/TobaccoFormView.tsx",
    "src/views/curator/WishFormView.tsx",
  ]) {
    it(`sits after BOTH identity fields in ${file.split("/").pop()}`, () => {
      const src = readFileSync(file, "utf8");
      const brand = src.indexOf('t("lbl_brand_lbl")');
      const offer = src.indexOf("<CatalogOffer");
      const name = src.indexOf('t("lbl_name_req")');
      const type = src.indexOf('t("lbl_type")');
      expect(brand).toBeGreaterThan(-1);
      expect(offer).toBeGreaterThan(-1);
      // BRAND comes first, then NAME — matching the pipe and
      // accessory forms. The catalogue match needs BOTH, so the offer must
      // follow the second of the two, not merely "after the brand".
      expect(brand).toBeLessThan(name);
      expect(offer).toBeGreaterThan(name);
      // …and before the next field, so nothing pushes it further down.
      expect(offer).toBeLessThan(type);
      // And it is NOT passed to the AICard any more.
      expect(src).not.toContain("dbHinted={dbHinted}");
    });
  }

  // The placeholder names a REAL, recognisable blend — Peterson Nightcap.
  //
  // REVERSED: this case used to also assert `peterson|nightcap` resolves in the
  // catalogue fixture, on the reasoning that typing the placeholders must
  // DEMONSTRATE the catalogue offer. That reasoning died when the app stopped
  // shipping a catalogue: a fresh install has NONE, so the placeholder cannot
  // demonstrate the offer for anybody until they load a file that happens to
  // contain that blend. The assertion was outliving its premise, and the
  // fixture is synthetic now, so it could only have been satisfied by putting
  // a real catalogue row back.
  //
  // What is still worth pinning is that the pair is a real blend a reader
  // recognises, rather than an invented one that teaches them nothing — and
  // that it is not Dunhill, which is what the placeholders used to be and
  // which no catalogue this app ever shipped contained.
  it("the brand placeholder names a real, recognisable blend", () => {
    for (const file of [
      "src/views/curator/TobaccoFormView.tsx",
      "src/views/curator/WishFormView.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain('placeholder="Peterson"');
      expect(src, file).toContain('placeholder="Nightcap"');
      expect(src, file).not.toContain('placeholder="Dunhill"');
    }
  });

  // The four entry forms must agree on the identity order.
  // Tobacco and wishlist used to ask for the name first while pipes and
  // accessories asked for the brand — the same two fields in opposite orders
  // depending on the screen.
  it("every entry form asks for the brand before the name", () => {
    for (const file of [
      "src/views/curator/TobaccoFormView.tsx",
      "src/views/curator/WishFormView.tsx",
      "src/views/curator/PipeFormView.tsx",
      "src/views/curator/AccessoryFormView.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      const brand = src.indexOf('t("lbl_brand_lbl")');
      const name = src.indexOf('t("lbl_name_req")');
      expect(brand, file).toBeGreaterThan(-1);
      expect(name, file).toBeGreaterThan(-1);
      expect(brand, `${file}: brand must come first`).toBeLessThan(name);
    }
  });

  it("AICard no longer accepts a dbHinted prop", () => {
    const src = readFileSync("src/components/curator/AICard.tsx", "utf8");
    expect(src).not.toContain("dbHinted?:");
    expect(src).not.toContain("ai_db_hint");
  });
});

// ── applying dismisses the offer ────────────────────────────
// Reported from the app: "j'appuie sur remplir la fiche mais le message ne
// disparaît pas". Only "Ignorer" set `dismissed`, and `show` is just
// "brand+name match a catalogue entry" — which the fill does not change, since
// it writes the OTHER fields. So the banner offering to fill a form that had
// just been filled stayed on screen for ever.
//
// Present since the offer shipped in BOTH forms, and the ten cases
// above did not catch it: every one of them checks what renders BEFORE the tap,
// or that onApply fires. None looked at the offer afterwards — the state the
// user is actually left in.
describe("CatalogOffer — applying dismisses it", () => {
  it("hides after the fill button is tapped", () => {
    const onApply = vi.fn();
    const { container } = renderWithCtx(<CatalogOffer show onApply={onApply} t={t} />, {});
    const btn = find(container, /ai_db_apply/);
    expect(btn, "the fill button should be offered").toBeTruthy();
    fireEvent.click(btn!);
    expect(onApply, "the fill must still run").toHaveBeenCalled();
    expect(container.textContent, "the offer must not survive its own action")
      .not.toContain("ai_db_hint");
    expect(find(container, /ai_db_apply/)).toBeFalsy();
  });

  it("stays hidden even though `show` is still true", () => {
    // The load-bearing detail: the parent keeps passing show=true because the
    // brand+name still match. Dismissal has to be local state, not a change in
    // the condition — a fix that relied on the parent would not hold.
    // Re-render through a PARENT so the offer keeps its mount. Re-rendering the
    // bare component would swap the tree root (renderWithCtx wraps it in a
    // provider), React would remount it, and the local `dismissed` state would
    // reset — the test would fail against correct code, which is what happened
    // on the first attempt.
    function Host({ n }: { n: number }) {
      return <div data-n={n}><CatalogOffer show onApply={vi.fn()} t={t} /></div>;
    }
    const { container, rerender } = renderWithCtx(<Host n={1} />, {});
    fireEvent.click(find(container, /ai_db_apply/)!);
    rerender(
      <AppCtx.Provider value={{ t } as any}><Host n={2} /></AppCtx.Provider>,
    );
    expect(container.textContent).not.toContain("ai_db_hint");
  });

  it("still hides on Ignorer, and the fill is NOT run", () => {
    const onApply = vi.fn();
    const { container } = renderWithCtx(<CatalogOffer show onApply={onApply} t={t} />, {});
    fireEvent.click(find(container, /ai_db_ignore/)!);
    expect(container.textContent).not.toContain("ai_db_hint");
    expect(onApply, "Ignorer must not fill the form").not.toHaveBeenCalled();
  });
});
