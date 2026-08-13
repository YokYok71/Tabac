// Smoke tests for src/views/curator/AccListView.tsx.

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorAccListView } from "../../views/curator/AccListView";

const briquet = {
  id: "1", brand: "IM Corona", name: "Old Boy",
  type: "Briquet", fuel: "Gaz",
  rating: 4, status: "active", imageUrl: "",
  datePurchased: "", price: "", seller: "", notes: "",
};

const retired = {
  id: "2", brand: "Generic", name: "Old lighter",
  type: "Briquet", fuel: "Gaz",
  rating: 0, status: "retired", imageUrl: "",
  datePurchased: "", price: "", seller: "", notes: "",
};

describe("AccListView — visibility", () => {
  it("returns null when view !== 'acc'", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, { view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when accDet is set (detail view takes over)", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: briquet,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state when no accessories exist", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/Aucun accessoire|No accessories|no_accessories/);
  });

  it("renders the brand + name of active accessories", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toContain("IM Corona");
    expect(container.textContent).toContain("Old Boy");
  });
});

describe("AccListView — binary active/retired filter", () => {
  it("shows only ACTIVE accessories when showRetiredAcc=false", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet, retired], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      showRetiredAcc: false,
    });
    expect(container.textContent).toContain("IM Corona");
    expect(container.textContent).not.toContain("Old lighter");
  });

  it("shows only RETIRED accessories when showRetiredAcc=true (binary)", () => {
    // Previously this branch acted like "show all". An earlier release made it
    // strictly retired-only so the two chips become mutually exclusive.
    // assert on item NAMES, not brands — the new brand-filter
    // dropdown deliberately lists every brand in the collection as an
    // <option>, so brand strings appear in textContent even when the
    // matching card is filtered out.
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet, retired], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      showRetiredAcc: true,
    });
    expect(container.textContent).toContain("Old lighter");
    expect(container.textContent).not.toContain("Old Boy");
  });
});

// ── Brand filter ──────────────────────────────────────────────────
// Mirrors PipesListView's pBrandFilter: dropdown options derive from
// data.accessories (never shrink under the active filter), AND-composes
// with the active/retired toggle, and the active pill clears via ✕.

describe("AccListView — brand filter", () => {
  const tamper = {
    id: "3", brand: "", name: "Bourre-pipe maison",
    type: "Bourre-pipe", fuel: "",
    rating: 0, status: "active", imageUrl: "",
    datePurchased: "", price: "", seller: "", notes: "",
  };
  const pouch = {
    id: "4", brand: "Halvorsen", name: "Roll-up",
    type: "Blague à tabac", fuel: "",
    rating: 0, status: "active", imageUrl: "",
    datePurchased: "", price: "", seller: "", notes: "",
  };

  it("narrows the list to the selected brand", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet, pouch, tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "Halvorsen",
      setABrandFilter: vi.fn(),
    });
    expect(container.textContent).toContain("Roll-up");
    expect(container.textContent).not.toContain("Old Boy");
    expect(container.textContent).not.toContain("Bourre-pipe maison");
  });

  it("renders the dropdown with brands derived from the full collection (unbranded items excluded)", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet, pouch, tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "Halvorsen", // active filter must not shrink the options
      setABrandFilter: vi.fn(),
    });
    const select = container.querySelector('select[aria-label="aria_filter_by_brand"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const opts = Array.from(select.querySelectorAll("option")).map(o => o.getAttribute("value"));
    expect(opts).toContain("IM Corona");
    expect(opts).toContain("Halvorsen");
    // The unbranded tamper contributes no option — the only value=""
    // entry is the "Toutes marques" reset option.
    expect(opts.filter(v => v === "").length).toBe(1);
  });

  it("hides the dropdown entirely when no accessory has a brand", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "",
      setABrandFilter: vi.fn(),
    });
    const select = container.querySelector('select[aria-label="aria_filter_by_brand"]');
    expect(select).toBeNull();
  });

  it("shows an active-filter pill whose ✕ clears the filter", () => {
    const setABrandFilter = vi.fn();
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet, pouch], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "Halvorsen",
      setABrandFilter,
    });
    // The pill renders the label in a <span> with the clear <button>
    // (aria-label btn_clear via mockT) inside it.
    expect(container.textContent).toContain("Halvorsen");
    const clearBtn = container.querySelector('button[aria-label="btn_clear"]');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(setABrandFilter).toHaveBeenCalledWith("");
  });

  it("auto-clears a stale brand filter whose brand disappeared from the collection", () => {
    const setABrandFilter = vi.fn();
    renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [briquet], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "Savinelli", // no longer present
      setABrandFilter,
    });
    expect(setABrandFilter).toHaveBeenCalledWith("");
  });
});

describe("AccListView — '+' button", () => {
  it("calls nav('addA')", () => {
    const nav = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      accDet: null,
      data: { accessories: [], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      nav,
    });
    // This test used to LOCK THE DEFECT. Its previous comment read
    // "the + button has no custom ariaLabel — IconBtn falls back to the icon
    // name 'plus' by default", and it located the button by `aria-label ===
    // "plus"` — i.e. it asserted that the Atelier's only add affordance
    // announced itself to a screen reader as the raw glyph id, untranslated, in
    // all five languages, while the three sibling lists all named theirs.
    // A test that pins the wrong behaviour is worse than no test: it makes the
    // fix look like the regression. It now asserts the translated label.
    const btn = getAllByRole("button").find(b =>
      (b.getAttribute("aria-label") || "") === "btn_add",
    );
    expect(getAllByRole("button").some(b =>
      (b.getAttribute("aria-label") || "") === "plus"), "the raw glyph id must never be the accessible name").toBe(false);
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(nav).toHaveBeenCalledWith("addA");
  });
});

describe("AccListView — notes show/hide toggle", () => {
  const withNotes = {
    id: "9", brand: "Czech", name: "Tool", type: "Bourre-pipe", fuel: "",
    rating: 3, status: "active", imageUrl: "",
    datePurchased: "", price: "", seller: "", notes: "Trois-en-un pratique",
  };
  const dataOf = (a: any) => ({ accessories: [a], tobaccos: [], pipes: [], sessions: [], wishlist: [] });

  it("hides notes by default (expandCards off)", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc", accDet: null, data: dataOf(withNotes),
    });
    expect(container.textContent).not.toContain("Trois-en-un pratique");
  });

  it("reveals notes when expandCards is on", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc", accDet: null, expandCards: true, data: dataOf(withNotes),
    });
    expect(container.textContent).toContain("Trois-en-un pratique");
  });
});

// ── Type (genre) filter ──────────────────────────────────────────
// New alongside the brand filter: narrows by ACC_TYPES, options in enum order,
// AND-composes with the brand filter.
describe("AccListView — type filter", () => {
  const pouch = {
    id: "3", brand: "Halvorsen", name: "Roll-up", type: "Blague à tabac", fuel: "",
    rating: 0, status: "active", imageUrl: "",
    datePurchased: "", price: "", seller: "", notes: "",
  };
  const tamper = {
    id: "4", brand: "", name: "Bourre-pipe maison", type: "Bourre-pipe", fuel: "",
    rating: 0, status: "active", imageUrl: "",
    datePurchased: "", price: "", seller: "", notes: "",
  };

  it("narrows the list to the selected type", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc", accDet: null,
      data: { accessories: [briquet, pouch, tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aTypeFilter: "Blague à tabac",
      setATypeFilter: vi.fn(),
    });
    expect(container.textContent).toContain("Roll-up");            // Blague à tabac
    expect(container.textContent).not.toContain("Old Boy");        // Briquet
    expect(container.textContent).not.toContain("Bourre-pipe maison");
  });

  it("lists the ACC_TYPES present, in enum order (never shrinks under the active filter)", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc", accDet: null,
      data: { accessories: [briquet, pouch, tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aTypeFilter: "Blague à tabac",
      setATypeFilter: vi.fn(),
    });
    const select = container.querySelector('select[aria-label="aria_filter_by_type"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const vals = Array.from(select.querySelectorAll("option")).map(o => o.getAttribute("value"));
    // Only the value="" reset ("Type") entry is empty.
    expect(vals.filter(v => v === "").length).toBe(1);
    // Present types kept in ACC_TYPES order: Briquet < Blague à tabac < Bourre-pipe.
    expect(vals.filter(Boolean)).toEqual(["Briquet", "Blague à tabac", "Bourre-pipe"]);
  });

  it("composes AND with the brand filter", () => {
    const halvorsenLighter = {
      id: "5", brand: "Halvorsen", name: "Halvorsen Lighter", type: "Briquet", fuel: "Gaz",
      rating: 0, status: "active", imageUrl: "",
      datePurchased: "", price: "", seller: "", notes: "",
    };
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc", accDet: null,
      data: { accessories: [pouch, halvorsenLighter, tamper], tobaccos: [], pipes: [], sessions: [], wishlist: [] },
      aBrandFilter: "Halvorsen", aTypeFilter: "Briquet",
      setABrandFilter: vi.fn(), setATypeFilter: vi.fn(),
    });
    expect(container.textContent).toContain("Halvorsen Lighter");   // Halvorsen + Briquet
    expect(container.textContent).not.toContain("Roll-up");        // Halvorsen but Blague à tabac
  });
});

// ── Tag / collection chips folded behind a disclosure ────────
// Same change as the pipes list — see that test file for the rationale (the
// disclosure lives in the existing controls row so it costs no height).
describe("AccListView — tag chips behind the # disclosure", () => {
  const accs = [
    { id: "1", brand: "IM Corona", name: "Old Boy", type: "Briquet", status: "active", tags: ["quotidien"] },
    { id: "2", brand: "Savinelli", name: "Bourre-pipe", type: "Bourre-pipe", status: "active", tags: ["voyage"] },
  ] as any[];
  const base = {
    view: "acc", accDet: null,
    data: { accessories: accs, pipes: [], tobaccos: [], sessions: [], wishlist: [] },
    accIsActive: (a: any) => a.status === "active",
  };

  it("hides the tag chips by default", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, base);
    expect(container.textContent).not.toContain("# quotidien");
    expect(container.textContent).not.toContain("# voyage");
  });

  it("reveals them when the disclosure is tapped", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, base);
    const btn = container.querySelector('[aria-label*="tag_filter_label"]') as HTMLElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(container.textContent).toContain("# quotidien");
    expect(container.textContent).toContain("# voyage");
  });

  it("offers no disclosure when nothing is tagged", () => {
    const bare = [{ id: "3", brand: "X", name: "Y", type: "Autre", status: "active" }] as any[];
    const { container } = renderWithCtx(<CuratorAccListView />, {
      ...base,
      data: { accessories: bare, pipes: [], tobaccos: [], sessions: [], wishlist: [] },
    });
    expect(container.querySelectorAll('[aria-label*="tag_filter_label"]').length).toBe(0);
  });
});

// The collection filter had NEVER been applied to this list.
//
// The chip lit up and the "# tag" pill appeared, so the control looked alive;
// the rows never moved. The clause existed all along in App.tsx's
// `filteredAccessories` memo, which NOTHING rendered — this view is the one
// list that filters locally, while `PipesListView` reads `ctx.filteredPipes`.
// That is exactly why pipes filtered and accessories did not, and why reading
// either file alone made the wiring look complete. An earlier release deleted the unread
// memo, so the clause this block guards is now the only copy.
//
// Found by driving all three lists in a browser after routing them through the
// shared `tobaccoHasTag`: tobaccos 2→1, pipes 2→1, accessories 2→2. Nothing in
// the suite covered any of the three (probed: neutering the helper reddened one
// unit test and no view test), which is why this case exists.
describe("AccListView — collection filter", () => {
  const tagged = [
    { id: "1", brand: "IM Corona", name: "Old Boy", type: "Briquet", status: "active", tags: ["voyage"] },
    { id: "2", brand: "Brackwater", name: "Tamper", type: "Bourre-pipe", status: "active", tags: ["maison"] },
  ];
  const base = {
    view: "acc", accDet: null,
    data: { accessories: tagged, pipes: [], tobaccos: [], sessions: [], wishlist: [] },
  };

  it("shows every accessory when no tag is selected", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, base);
    expect(container.textContent).toContain("Old Boy");
    expect(container.textContent).toContain("Tamper");
  });

  it("keeps ONLY the accessories carrying the selected tag", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, { ...base, aTagFilter: "voyage" });
    expect(container.textContent).toContain("Old Boy");
    expect(container.textContent, "an untagged row must be filtered OUT — the bug was that it was not")
      .not.toContain("Tamper");
  });

  it("matches the tag case-insensitively, like the tobacco and pipe lists", () => {
    const { container } = renderWithCtx(<CuratorAccListView />, { ...base, aTagFilter: "VOYAGE" });
    expect(container.textContent).toContain("Old Boy");
    expect(container.textContent).not.toContain("Tamper");
  });

  it("AND-composes with the type filter instead of replacing it", () => {
    // Both clauses must survive together: `voyage` alone keeps Old Boy, and the
    // Bourre-pipe type alone keeps Tamper, so the pair must keep neither.
    const { container } = renderWithCtx(<CuratorAccListView />,
      { ...base, aTagFilter: "voyage", aTypeFilter: "Bourre-pipe" });
    expect(container.textContent).not.toContain("Old Boy");
    expect(container.textContent).not.toContain("Tamper");
  });
});
