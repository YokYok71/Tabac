import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CuratorCompareModal } from "../../views/curator/CompareModal";
import { BT, BW } from "../../constants";

// The comparison modal.
//
// The pure engine is covered in compareBlends.test.ts; what is checked here is
// what only the view can get wrong: that an unknown value RENDERS as "—" and
// not as 0, that a column the user does not own is explained rather than left
// as a wall of dashes, and that the rows which disagree are marked.

const tob = (over: any = {}) => Object.assign({}, BT, {
  id: 1, brand: "Halvorsen", name: "Duskfall",
  category: "Anglais", cut: "Ribbon", force: 4, roomNote: 3, taste: 4, rating: 5,
  lots: [{ id: 700, status: "cellar", weightG: "50", datePurchased: "2024-01-01" }],
}, over);

const DB: any = {
  brands: { halvorsen: { displayName: "Halvorsen" } },
  blends: {
    "halvorsen|duskfall": {
      name: "Duskfall", category: "Anglais", cut: "Ribbon",
      blend: "Virginia, Latakia", force: 4, roomNote: 3, taste: 4,
      agingMax: "6-10", description: { fr: "Prose." },
    },
    "halvorsen|early tide": {
      name: "Early Tide", category: "Virginia/Burley", cut: "Flake",
      blend: "Virginia, Burley", force: 3, roomNote: 2, taste: 3,
      agingMax: "10-15", description: { fr: "Autre prose." },
    },
  },
};

const data = (over: any = {}) => Object.assign({
  tobaccos: [tob()], wishlist: [], sessions: [], pipes: [], accessories: [],
}, over);

const renderModal = (props: any = {}) => render(
  <CuratorCompareModal
    open={true} onClose={vi.fn()} db={DB} lang="fr"
    data={data()} t={(k: string) => k} xl={(v: string) => v}
    weightUnit="g" currencySymbol="€"
    {...props} />,
);

describe("CompareModal — picking", () => {
  it("asks for a second blend rather than showing a one-column table", () => {
    const { container } = renderModal({ seedKey: "catalogue:halvorsen|duskfall" });
    expect(container.textContent).toContain("cmp_pick_two");
    expect(container.querySelectorAll("[data-compare-row]")).toHaveLength(0);
  });

  it("shows one column per pick, each removable by an accessible name", () => {
    const { container } = renderModal({ seedKey: "catalogue:halvorsen|duskfall" });
    const cols = container.querySelectorAll("[data-compare-col]");
    expect(cols).toHaveLength(1);
    const remove = Array.from(container.querySelectorAll("button"))
      .find((b) => /cmp_remove/.test(b.getAttribute("aria-label") || ""));
    expect(remove, "an icon-only remove needs a name").toBeTruthy();
    fireEvent.click(remove!);
    expect(container.querySelectorAll("[data-compare-col]")).toHaveLength(0);
  });

  it("does not offer the catalogue until the query is worth searching", () => {
    // ~1200 rows: an unfiltered list would be a wall, and typing one letter
    // matches most of it.
    const { container } = renderModal();
    fireEvent.click(container.querySelector("[role='button']")!);
    const input = container.querySelector("input")!;
    // "q" matches nothing in the seeded cellar, so the list is empty and the
    // hint explains WHY — the catalogue is not searched on one letter.
    fireEvent.change(input, { target: { value: "q" } });
    expect(container.textContent).toContain("cmp_search_hint");
    fireEvent.change(input, { target: { value: "early" } });
    expect(container.textContent).not.toContain("cmp_search_hint");
    expect(container.textContent).toContain("Early Tide");
  });
});

describe("CompareModal — what the columns say", () => {
  const twoPicks = () => {
    const { container } = renderModal({ seedKey: "catalogue:halvorsen|duskfall" });
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_add/.test(b.getAttribute("aria-label") || ""))!);
    fireEvent.change(container.querySelector("input")!, { target: { value: "early" } });
    const opt = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => (b.textContent || "").indexOf("Early Tide") >= 0);
    fireEvent.click(opt!);
    return container;
  };

  it("renders an unknown value as an em dash, never as 0", () => {
    // Two catalogue columns: nothing about the user's experience can be known.
    const container = twoPicks();
    const rows = Array.from(container.querySelectorAll("[data-compare-row]"));
    expect(rows.length).toBeGreaterThan(0);
    // No experience row survives at all when NO column can answer it…
    expect(rows.some((r) => r.getAttribute("data-compare-row") === "sessions")).toBe(false);
    // …and the modal explains the absence once, instead of a wall of dashes.
    expect(container.textContent).toContain("cmp_no_owned");
  });

  it("marks the rows that disagree and leaves the others alone", () => {
    const container = twoPicks();
    const row = (f: string) => container.querySelector(`[data-compare-row="${f}"]`);
    expect(row("category")!.getAttribute("data-differs"), "Anglais vs Virginia/Burley").toBe("1");
    expect(row("cut")!.getAttribute("data-differs"), "Ribbon vs Flake").toBe("1");
  });

  it("answers the experience rows when one pick IS yours", () => {
    const { container } = renderModal({ seedKey: "cellar:1" });
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_add/.test(b.getAttribute("aria-label") || ""))!);
    fireEvent.change(container.querySelector("input")!, { target: { value: "early" } });
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => (b.textContent || "").indexOf("Early Tide") >= 0)!);
    expect(container.textContent).not.toContain("cmp_no_owned");
    const sessions = container.querySelector('[data-compare-row="sessions"]');
    expect(sessions, "the row exists because one column can answer it").toBeTruthy();
    const cells = sessions!.querySelectorAll("td");
    expect(cells[0]!.textContent, "no sessions yet is a real answer: 0").toBe("0");
    expect(cells[1]!.textContent, "the catalogue column cannot answer").toBe("—");
  });

  it("shows a never-filled score as a dash, not as the lowest score", () => {
    // The defect this rule exists for: `BT` seeds force: 0, so a blank field and
    // "very mild" are the same byte in storage.
    const blank = Object.assign({}, BT, { id: 2, brand: "X", name: "Y", lots: [] });
    const { container } = render(
      <CuratorCompareModal
        open={true} onClose={vi.fn()} db={DB} lang="fr"
        data={data({ tobaccos: [tob(), blank] })}
        t={(k: string) => k} xl={(v: string) => v}
        weightUnit="g" currencySymbol="€" seedKey="cellar:2" />);
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_add/.test(b.getAttribute("aria-label") || ""))!);
    fireEvent.change(container.querySelector("input")!, { target: { value: "Duskfall" } });
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => (b.textContent || "").indexOf("Duskfall") >= 0)!);
    const force = container.querySelector('[data-compare-row="force"]');
    expect(force).toBeTruthy();
    expect(force!.querySelectorAll("td")[0]!.textContent).toBe("—");
  });

  it("compares a wishlist item too", () => {
    const { container } = render(
      <CuratorCompareModal
        open={true} onClose={vi.fn()} db={DB} lang="fr"
        data={data({ wishlist: [Object.assign({}, BW, { id: 3, brand: "W", name: "Wished", category: "Virginia", force: 2 })] })}
        t={(k: string) => k} xl={(v: string) => v}
        weightUnit="g" currencySymbol="€" seedKey="cellar:1" />);
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_add/.test(b.getAttribute("aria-label") || ""))!);
    fireEvent.change(container.querySelector("input")!, { target: { value: "Wished" } });
    fireEvent.click(Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => (b.textContent || "").indexOf("Wished") >= 0)!);
    expect(container.querySelectorAll("[data-compare-col]")).toHaveLength(2);
    expect(container.textContent).toContain("cmp_src_wish");
  });
});
