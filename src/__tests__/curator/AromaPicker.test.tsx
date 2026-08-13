/**
 * The aroma wheel had NO test at all.
 *
 * Found by mutation: stubbing the whole component to render `null` left
 * 3698 of 3698 tests green. So did breaking `groupLabelKey`, its only
 * exclusive consumer — the same hole seen twice. Its twin `aromaLabelKey`
 * IS killed by the view tests, which is what made the asymmetry visible.
 *
 * The component is not marginal: it is the multi-select wheel behind
 * `SessionFormView`, `TastingView` and the inventory aroma filter, and its
 * output feeds `Session.aromas`, the Stats taste profile and the per-tobacco
 * fingerprint. Its ordering contract in particular is load-bearing — the
 * emitted array is stored, so an unstable order would churn saved sessions.
 *
 * These cases pin what the component PROMISES rather than how it looks:
 * canonical order out, real buttons in, and the a11y state that had to be
 * retrofitted onto FilterChipSimple for exactly this reason.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AromaPicker } from "../../components/curator/AromaPicker";
import { AROMA_WHEEL, ALL_AROMAS, aromaLabelKey, groupLabelKey } from "../../utils/aromas";
import { LANG } from "../../i18n";

// The real dictionary, so a renamed or missing aroma key fails here too
// rather than rendering a raw key on screen.
const t = (k: string) => (LANG.fr as any)[k] ?? `«${k}»`;

const render = (value: string[], onChange = vi.fn()) => {
  const r = renderWithCtx(<AromaPicker value={value} onChange={onChange} />, { t });
  return { ...r, onChange };
};

describe("AromaPicker", () => {
  it("renders every group heading and every aroma of the wheel", () => {
    render([]);
    for (const g of AROMA_WHEEL) {
      expect(screen.getByText(t(groupLabelKey(g.key))), `group ${g.key}`).toBeTruthy();
    }
    // 6 groups × 5 descriptors — the whole wheel, not the first screenful.
    expect(screen.getAllByRole("button")).toHaveLength(ALL_AROMAS.length);
  });

  it("labels every chip through the dictionary, never with the raw key", () => {
    // The guillemet fallback above marks a key the dictionary lacks; a raw
    // key on screen is the visible symptom this catches.
    render([]);
    for (const key of ALL_AROMAS) {
      const label = t(aromaLabelKey(key));
      expect(label.startsWith("«"), `${key} has no aroma_ label`).toBe(false);
      expect(screen.getByRole("button", { name: label }), `chip ${key}`).toBeTruthy();
    }
  });

  it("emits in CANONICAL WHEEL ORDER, not tap order — the stored contract", () => {
    // `Session.aromas` is persisted, so the array must be stable whatever
    // order the user tapped in, or every re-save churns the record.
    const late = ALL_AROMAS[ALL_AROMAS.length - 1]!;
    const early = ALL_AROMAS[0]!;
    const { onChange } = render([late]);
    fireEvent.click(screen.getByRole("button", { name: t(aromaLabelKey(early)) }));
    expect(onChange).toHaveBeenCalledWith([early, late]);
  });

  it("toggles a selected aroma off", () => {
    const key = ALL_AROMAS[2]!;
    const { onChange } = render([key]);
    fireEvent.click(screen.getByRole("button", { name: t(aromaLabelKey(key)) }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("de-duplicates a value that arrives with the same key twice", () => {
    const [a, b] = [ALL_AROMAS[0]!, ALL_AROMAS[1]!];
    const { onChange } = render([a, a]);
    fireEvent.click(screen.getByRole("button", { name: t(aromaLabelKey(b)) }));
    expect(onChange).toHaveBeenCalledWith([a, b]);
  });

  it("survives a non-array value instead of crashing the session form", () => {
    // `value` comes from stored session data, which migrateData sanitises —
    // but the component guards anyway, and a guard nothing exercises is a
    // guard nobody knows is there.
    expect(() => render(null as any)).not.toThrow();
    expect(screen.getAllByRole("button")).toHaveLength(ALL_AROMAS.length);
  });

  it("reports selection with aria-pressed, not colour alone", () => {
    // This had to be retrofitted onto FilterChipSimple, and later onto
    // Segmented: a chip whose only selected-state signal is a background tint
    // is six identical buttons to a screen reader.
    const key = ALL_AROMAS[3]!;
    render([key]);
    expect(screen.getByRole("button", { name: t(aromaLabelKey(key)) })
      .getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: t(aromaLabelKey(ALL_AROMAS[4]!)) })
      .getAttribute("aria-pressed")).toBe("false");
  });

  it("uses real buttons, so keyboard and screen readers reach every chip", () => {
    render([]);
    for (const b of screen.getAllByRole("button")) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");   // never submits its form
    }
  });
});
