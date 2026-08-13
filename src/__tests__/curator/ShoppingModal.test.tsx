// The "Liste de courses" modal — restock (low-stock rebuys) +
// wishlist, with a persisted "got it" checkbox.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorShoppingModal } from "../../views/curator/ShoppingModal";

const lowStockTob = { id: 1, brand: "Brackwater", name: "Duskfall", lots: [{ status: "jar", weightG: "20" }] };
const wishItem = { id: 5, brand: "Halvorsen", name: "Irish Flake" };

const baseCtx = {
  shoppingOpen: true,
  setShoppingOpen: () => {},
  weightUnit: "g",
  watchLowWeight: "50",
  imgLocal: {},
  crossOpenDetail: () => {},
  setStatusFilter: () => {},
  nav: () => {},
  t: (k: string) => k,
  data: { tobaccos: [lowStockTob], pipes: [], accessories: [], sessions: [], wishlist: [wishItem] },
};

describe("CuratorShoppingModal", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it("renders both sections and the item names", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, baseCtx);
    expect(container.textContent).toContain("shopping_restock");
    expect(container.textContent).toContain("shopping_wishes");
    expect(container.textContent).toContain("Duskfall");
    expect(container.textContent).toContain("Irish Flake");
  });

  it("clicking a restock row cross-opens the tobacco fiche and closes the modal", () => {
    const crossOpenDetail = vi.fn();
    const setShoppingOpen = vi.fn();
    const { getByText } = renderWithCtx(<CuratorShoppingModal />, { ...baseCtx, crossOpenDetail, setShoppingOpen });
    fireEvent.click(getByText("Duskfall").closest("button")!);
    expect(setShoppingOpen).toHaveBeenCalledWith(false);
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "inv", kind: "tobacco", obj: lowStockTob });
  });

  it("clicking a wish row lands on the wishlist and closes the modal", () => {
    const setStatusFilter = vi.fn();
    const nav = vi.fn();
    const setShoppingOpen = vi.fn();
    const { getByText } = renderWithCtx(<CuratorShoppingModal />, { ...baseCtx, setStatusFilter, nav, setShoppingOpen });
    fireEvent.click(getByText("Irish Flake").closest("button")!);
    expect(setStatusFilter).toHaveBeenCalledWith("wish");
    expect(nav).toHaveBeenCalledWith("inv");
    expect(setShoppingOpen).toHaveBeenCalledWith(false);
  });

  it("the checkbox toggles and persists the checked key to localStorage", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, baseCtx);
    const checkbox = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").startsWith("shopping_check"));
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    const stored = JSON.parse(localStorage.getItem("cave-shopping-checked") || "[]");
    // The first item (sorted by brand) is Brackwater/Duskfall → restock:1.
    expect(stored).toContain("restock:1");
    expect(checkbox!.getAttribute("aria-pressed")).toBe("true");
  });

  // ── a11y fixes ────────────────────────────────────────────────────────────
  // This test previously located the checkbox by EXACT aria-label equality,
  // which only worked because every row carried the identical static label —
  // i.e. it was locking the defect in place. It now matches on the prefix, and
  // the properties below are asserted directly.

  it("each tick button names its own item, so rows are distinguishable", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, baseCtx);
    const labels = Array.from(container.querySelectorAll("button"))
      .map((b) => b.getAttribute("aria-label") || "")
      .filter((l) => l.startsWith("shopping_check"));
    expect(labels.length).toBeGreaterThan(1);
    // A screen-reader user heard "Coché, button" N times with nothing to tell
    // the rows apart; every label must now be unique and name its item.
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.some((l) => l.includes("Duskfall"))).toBe(true);
  });

  it("the tick target meets the 44px minimum (WCAG 2.5.5)", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, baseCtx);
    const btn = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").startsWith("shopping_check")) as HTMLElement;
    expect(btn).toBeTruthy();
    // Used one-handed while walking round a shop — the worst case for a small
    // hit area. The 30px visual box lives inside a 44px transparent target.
    expect(btn.style.width).toBe("44px");
    expect(btn.style.height).toBe("44px");
  });

  it("a ticked row de-emphasises without dimming the whole row", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, baseCtx);
    const btn = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").startsWith("shopping_check")) as HTMLElement;
    fireEvent.click(btn);
    const rows = Array.from(container.querySelectorAll("div"))
      .filter((d) => (d as HTMLElement).style.borderRadius === "8px" && (d as HTMLElement).style.opacity);
    // The old code set opacity 0.5 on the row, halving the contrast of text the
    // user still needs to read — and theme:contrast EXEMPTS opacity-dimmed
    // elements as inactive, so nothing would ever have measured it.
    expect(rows).toEqual([]);
  });

  it("shows the empty state when there is nothing to buy", () => {
    const { container } = renderWithCtx(<CuratorShoppingModal />, {
      ...baseCtx,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toContain("shopping_empty");
    expect(container.textContent).not.toContain("shopping_restock");
  });
});
