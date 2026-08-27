// InventoryListView — four rules of the app's biggest view that a mutation
// pass found guarded by NOTHING. Each was probed against the whole suite
// (5818 cases) before this file existed; each mutation stayed fully green.
//
//  1. the wishlist-search REVEAL   — a hit inside a collapsed brand group
//                                     silently did nothing
//  2. counts.smokesoon             — the chip's number is a UNION, not a sum
//  3. the chip-strip re-home       — the component was tested, the WIRING was not
//  4. the tobacco EMPTY STATE      — "you own nothing" vs "your filters matched
//                                     nothing", and the exclusion that separates them
//
// The harness `t` returns the KEY, so every assertion here is on a key, never
// on a translated string.

import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorInventoryListView } from "../../views/curator/InventoryListView.tsx";
import { lotAgingStatus } from "../../utils.ts";

const yearsAgoISO = (y: number) =>
  new Date(Date.now() - Math.round(y * 365.25 * 86400000)).toISOString().slice(0, 10);

// A CELLAR lot aged `y` years. Cellar, because aging is a cellar-only concept
// — a jar lot returns null from `lotAgingStatus` at any age, so a jar fixture
// would make every case below vacuous.
const cellarLot = (y: number) => ({
  status: "cellar", weightG: "50", dateProduction: yearsAgoISO(y),
  datePurchased: "", dateOpened: "", dateFinished: "",
  boxNumber: "", price: "", seller: "", disposed: false,
});

const mkTob = (id: number, over: any = {}) => ({
  id, name: `Blend ${id}`, brand: "Halvorsen", category: "Virginia", cut: "Flake",
  rating: 4, force: 3, taste: 4, roomNote: 3, blend: "",
  rebuy: null, tastingNotes: "", description: "", imageUrl: "", agingMax: "",
  lots: [cellarLot(0)],
  ...over,
});

const mkWish = (id: number, over: any = {}) => ({
  id, name: `Wish ${id}`, brand: "Halvorsen", category: "Virginia", cut: "Flake",
  force: 0, roomNote: 0, taste: 0, blend: "", description: "", agingMax: "",
  tastingNotes: "", imageUrl: "", notes: "", priority: "high",
  ...over,
});

const baseCtx: any = {
  view: "inv",
  detail: null,
  lang: "fr",
  t: (k: string) => k,
  xl: (v: string) => v,
  nav: () => {},
  weightUnit: "g",
  lengthUnit: "mm",
  dateFormat: "fr",
  currencySymbol: "€",
  filtered: [],
  statusFilter: "all",
  setStatusFilter: () => {},
  setDetail: () => {},
  setSearchOpen: () => {},
  data: { tobaccos: [], wishlist: [], pipes: [], accessories: [], sessions: [] },
};

function renderWith(ctx: any) {
  const res = render(
    <AppCtx.Provider value={ctx}>
      <CuratorInventoryListView />
    </AppCtx.Provider>
  );
  return {
    ...res,
    // Re-render the SAME tree with a new ctx value. A provider→bare swap would
    // remount the view and fire its mount effects again, which is precisely
    // what the transition rules below must not be satisfied by.
    swap: (next: any) => res.rerender(
      <AppCtx.Provider value={next}>
        <CuratorInventoryListView />
      </AppCtx.Provider>
    ),
  };
}

// A filter chip's whole text is `label + String(n).padStart(2, "0")` — no
// AnimNum, so it can be read synchronously. Keyed on the WHOLE string rather
// than a substring: `mat_peak` and `mat_old` are also rendered by the
// MaturityChip on every card, so a loose match would read a card, not a chip.
function chipCount(container: HTMLElement, labelKey: string): number | null {
  const hits = Array.from(container.querySelectorAll("button")).filter((b) => {
    const m = /^(.*?)(\d{2})$/.exec((b.textContent || "").trim());
    return !!m && m[1] === labelKey;
  });
  expect(hits.length, `expected exactly one "${labelKey}" chip, found ${hits.length}`)
    .toBe(1);
  return parseInt((hits[0]!.textContent || "").slice(-2), 10);
}

// `[role="button"]` as well as `<button>`: the EmptyState's way-forward
// actions are `PressCard`s, which render a div carrying the role — a
// `<button>`-only query finds nothing and reads as "the action is missing".
function buttonByText(container: HTMLElement, text: string): HTMLElement | null {
  return Array.from(container.querySelectorAll('button, [role="button"]'))
    .find((b) => (b.textContent || "").trim() === text) as HTMLElement || null;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. The wishlist-search reveal.
//
// SearchModal resolves a wishlist hit to its CARD by setting `wishFocusId`.
// If the list is grouped and the item's brand group is COLLAPSED, the card is
// not in the DOM at all — so the view has to ASK the store to expand it first.
// That ask is the whole of what this view owns, and nothing exercised it: the
// probe replaced the `toggleWishGroup(key)` call with a no-op and all 5818
// cases stayed green. The user-visible result is a search hit that does
// nothing: the list opens on a different item with no sign of where the match
// went — the exact report the reveal was written for.
// ─────────────────────────────────────────────────────────────────────────
describe("InventoryListView — a search hit reveals its wish card", () => {
  const wishCtx = (over: any = {}) => ({
    ...baseCtx,
    statusFilter: "wish",
    wishGrouped: true,
    collapsedWishGroups: {},          // absent === collapsed (inverted logic)
    data: { ...baseCtx.data, wishlist: [mkWish(7, { brand: "Vondel" })] },
    ...over,
  });

  it("expands the COLLAPSED brand group holding the hit", () => {
    const toggleWishGroup = vi.fn();
    renderWith(wishCtx({ wishFocusId: 7, toggleWishGroup, setWishFocusId: vi.fn() }));
    expect(toggleWishGroup).toHaveBeenCalledTimes(1);
    // The key is the STABLE brand, never the localized "Sans marque" label the
    // group header shows — the store's own collapse map is keyed that way.
    expect(toggleWishGroup).toHaveBeenCalledWith("Vondel");
  });

  it("a brand-LESS wish is keyed on \"\", not on the localized header label", () => {
    const toggleWishGroup = vi.fn();
    renderWith(wishCtx({
      wishFocusId: 7,
      toggleWishGroup,
      setWishFocusId: vi.fn(),
      data: { ...baseCtx.data, wishlist: [mkWish(7, { brand: "" })] },
    }));
    expect(toggleWishGroup).toHaveBeenCalledWith("");
  });

  it("does NOT toggle a group that is already open", () => {
    // The mirror defect, and the reason this needs a counter-case: a reveal
    // that toggles unconditionally CLOSES the group the card is sitting in,
    // which hides the very card the search asked for.
    const toggleWishGroup = vi.fn();
    renderWith(wishCtx({
      wishFocusId: 7,
      toggleWishGroup,
      setWishFocusId: vi.fn(),
      collapsedWishGroups: { Vondel: false },   // false === expanded
    }));
    expect(toggleWishGroup).not.toHaveBeenCalled();
  });

  it("consumes the id, so the reveal cannot re-fire on every later render", () => {
    const setWishFocusId = vi.fn();
    renderWith(wishCtx({ wishFocusId: 7, toggleWishGroup: vi.fn(), setWishFocusId }));
    expect(setWishFocusId).toHaveBeenCalledWith(null);
  });

  it("clears an id whose wish no longer exists, and expands nothing", () => {
    // A stale id (the wish was deleted between the search and the render) must
    // not leave the pointer set for ever, and must not toggle an unrelated group.
    const toggleWishGroup = vi.fn();
    const setWishFocusId = vi.fn();
    renderWith(wishCtx({ wishFocusId: 999, toggleWishGroup, setWishFocusId }));
    expect(toggleWishGroup).not.toHaveBeenCalled();
    expect(setWishFocusId).toHaveBeenCalledWith(null);
  });

  it("stands down entirely while the wishlist is not the visible list", () => {
    // The scoping guard: the tobacco list shares this component, and expanding
    // a WISH group while the user is looking at tobaccos is a state change they
    // never asked for and cannot see.
    const toggleWishGroup = vi.fn();
    const setWishFocusId = vi.fn();
    renderWith(wishCtx({
      statusFilter: "active",
      wishFocusId: 7,
      toggleWishGroup,
      setWishFocusId,
    }));
    expect(toggleWishGroup).not.toHaveBeenCalled();
    expect(setWishFocusId).not.toHaveBeenCalled();
  });

  it("the card carries the `data-wish-id` hook the scroll then looks for", () => {
    // Two halves of one mechanism: the reveal asks for the group, and the
    // scroll finds the card by this attribute. Renaming it would leave the
    // expand working and the scroll silently finding nothing.
    const { container } = renderWith(wishCtx({
      collapsedWishGroups: { Vondel: false },
    }));
    expect(container.querySelector('[data-wish-id="7"]'),
      "the wish card lost the attribute the reveal's scroll queries").toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. counts.smokesoon is a UNION.
//
// "À fumer rapidement" is the destination of the Home tile and overlaps the two
// chips beside it ON PURPOSE — it is their union. A tobacco holding one
// `approaching` lot AND one `overaged` lot must be counted ONCE: these counts
// are TABACS, and the list this chip opens shows one row per tobacco. Summing
// the two bands makes the chip claim more rows than the list can ever hold,
// which is the "a control names a set and selects a subset" defect this repo
// has already paid for three times.
//
// `smokeSoonDrill.test.ts` guards the tile, the App.tsx filter and the scope
// helpers — and reads this file only as SOURCE (`id: "smokesoon"` is present).
// The arithmetic was guarded by nothing: the probe split the union into two
// increments and all 5818 cases stayed green.
// ─────────────────────────────────────────────────────────────────────────
describe("InventoryListView — the 'À fumer rapidement' chip counts tabacs, not bands", () => {
  // agingMax 5 ⇒ approaching above 4 years, overaged above 5.
  const mixed = mkTob(1, { agingMax: "5", lots: [cellarLot(4.5), cellarLot(8)] });

  const ctx = (tobs: any[]) => ({
    ...baseCtx,
    statusFilter: "all",
    lotAgingStatus,
    filtered: tobs,
    data: { ...baseCtx.data, tobaccos: tobs },
  });

  it("the fixture really does straddle both bands", () => {
    // Non-vacuity, and it is load-bearing rather than tidy: on a single-band
    // tobacco a union and a sum give the SAME number, so without this the case
    // below could pass against a fixture that cannot tell them apart.
    const { container } = renderWith(ctx([mixed]));
    expect(chipCount(container, "mat_peak"), "no approaching lot in the fixture").toBe(1);
    expect(chipCount(container, "mat_old"), "no overaged lot in the fixture").toBe(1);
  });

  it("counts a tobacco holding BOTH bands exactly once", () => {
    const { container } = renderWith(ctx([mixed]));
    expect(chipCount(container, "stat_smoke_soon")).toBe(1);
  });

  it("still counts a tobacco that is in only one of the two bands", () => {
    // The other direction: a union that dropped one of its terms would satisfy
    // the case above and quietly stop offering half the slice.
    const onlyPeak = mkTob(2, { agingMax: "5", lots: [cellarLot(4.5)] });
    const onlyOld = mkTob(3, { agingMax: "5", lots: [cellarLot(8)] });
    const { container } = renderWith(ctx([onlyPeak, onlyOld]));
    expect(chipCount(container, "stat_smoke_soon")).toBe(2);
  });

  it("ignores a tobacco in neither band", () => {
    const young = mkTob(4, { agingMax: "5", lots: [cellarLot(1)] });
    const { container } = renderWith(ctx([mixed, young]));
    expect(chipCount(container, "stat_smoke_soon")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Leaving the wishlist re-homes the chip strip.
//
// The strip's `scrollLeft` survives a re-render, and the Wishlist chip sits at
// the far right — so coming back to the tobacco list left the row parked there
// with "Actifs" off screen. `ScrollableChipRow` is tested as a COMPONENT
// (signal → scrollTo); the WIRING that decides WHEN to bump it was tested by
// nothing, and the probe (`if (false)`) left all 5818 cases green.
// ─────────────────────────────────────────────────────────────────────────
describe("InventoryListView — the status-chip strip re-homes on leaving the wishlist", () => {
  const origScrollTo = (HTMLElement.prototype as any).scrollTo;
  afterEach(() => {
    // Restore rather than leak a stub onto every later test's elements.
    if (origScrollTo === undefined) delete (HTMLElement.prototype as any).scrollTo;
    else (HTMLElement.prototype as any).scrollTo = origScrollTo;
  });

  const withWishes = { ...baseCtx.data, wishlist: [mkWish(1)], tobaccos: [mkTob(1)] };
  const at = (statusFilter: string) => ({ ...baseCtx, statusFilter, data: withWishes });

  function install() {
    const scrollTo = vi.fn();
    (HTMLElement.prototype as any).scrollTo = scrollTo;
    return scrollTo;
  }

  it("scrolls the strip back to the left when the user leaves the wishlist", () => {
    const scrollTo = install();
    const { swap } = renderWith(at("wish"));
    scrollTo.mockClear();             // ignore the row's own mount call
    swap(at("active"));
    expect(scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it("does NOT re-home on ENTERING the wishlist", () => {
    // The transition is one-directional. Bumping on the way in would fight the
    // scroll that brings the Wishlist chip — which is at the far right — into view.
    const scrollTo = install();
    const { swap } = renderWith(at("active"));
    scrollTo.mockClear();
    swap(at("wish"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does NOT re-home on an ordinary chip change", () => {
    // The counter-case that makes the rule a rule: a bump on every status
    // change would jerk the row left under the finger of someone who had just
    // scrolled right to reach a chip.
    //
    // WHICH LAYER HOLDS THIS ONE, measured rather than assumed: breaking the
    // CONDITION alone leaves it green, because the effect's dep is
    // `[wishVisible]` and neither of these two renders is the wishlist — so
    // the effect never re-runs at all. It reddens once the deps are widened to
    // `[statusFilter]` as well. Both layers are real and this case pins the
    // second; the case above pins the first.
    const scrollTo = install();
    const { swap } = renderWith(at("active"));
    scrollTo.mockClear();
    swap(at("cellar"));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. "You own nothing" and "your filters matched nothing" are DIFFERENT screens.
//
// `emptyStateWayForward.test.tsx` covers the pipes list, the accessories list,
// the journal and the tasting screen. The tobacco inventory — the busiest list
// in the app — was covered by neither it nor this view's own suite, whose two
// empty-state cases are both in WISH mode.
//
// The load-bearing part is the EXCLUSION: the status chip always carries a
// value ("active" by default), so counting it as "a filter is on" would call
// every first-run screen filtered and offer a reset that changes nothing. The
// probe removed that one clause and all 5818 cases stayed green.
// ─────────────────────────────────────────────────────────────────────────
describe("InventoryListView — which kind of empty the tobacco list is", () => {
  const two = [mkTob(1), mkTob(2)];

  it("an empty collection says so, and offers the way forward", () => {
    const { container } = renderWith({ ...baseCtx, statusFilter: "active", filtered: [] });
    const text = container.textContent || "";
    expect(text).toContain("no_tobacco");
    expect(text).not.toContain("list_no_match");
    // The "+" is an unlabelled top-bar icon at the far end of the screen from
    // the sentence saying there is nothing here.
    expect(text).toContain("btn_add_tobacco");
    expect(text).not.toContain("btn_reset_filters");
  });

  it("a filter that matched nothing says so, and offers the way back", () => {
    const { container } = renderWith({
      ...baseCtx, statusFilter: "overaged", filtered: [],
      data: { ...baseCtx.data, tobaccos: two },
    });
    const text = container.textContent || "";
    expect(text).toContain("list_no_match");
    expect(text).not.toContain("no_tobacco");
    expect(text).toContain("btn_reset_filters");
    expect(text).not.toContain("btn_add_tobacco");
  });

  it("the DEFAULT status chip is not a filter", () => {
    // The exclusion, stated on its own. Someone whose every tobacco is
    // finished-only sees an empty "Actifs" list — and a "reset filters" button
    // there would clear nothing, so the screen offers the add instead.
    const { container } = renderWith({
      ...baseCtx, statusFilter: "active", filtered: [],
      data: { ...baseCtx.data, tobaccos: two },
    });
    const text = container.textContent || "";
    expect(text).toContain("no_tobacco");
    expect(text).not.toContain("list_no_match");
  });

  it("a secondary filter alone is enough to be 'filtered'", () => {
    // The other side of the same exclusion: dropping the status chip from the
    // predicate must not drop the rest of it.
    const { container } = renderWith({
      ...baseCtx, statusFilter: "active", filtered: [], catFilter: "Latakia",
      data: { ...baseCtx.data, tobaccos: two },
    });
    expect(container.textContent || "").toContain("list_no_match");
  });

  it("resetting from the empty state clears every filter and returns to 'active'", () => {
    const spies = {
      setStatusFilter: vi.fn(), setCatFilter: vi.fn(), setCutFilter: vi.fn(),
      setBrandFilter: vi.fn(), setTagFilter: vi.fn(), setRatingFilter: vi.fn(),
      setAromaFilter: vi.fn(),
    };
    const { container } = renderWith({
      ...baseCtx, statusFilter: "overaged", filtered: [], catFilter: "Latakia",
      data: { ...baseCtx.data, tobaccos: two }, ...spies,
    });
    const btn = buttonByText(container, "btn_reset_filters");
    expect(btn, "no reset button on a filtered-to-zero tobacco list").toBeTruthy();
    fireEvent.click(btn!);
    expect(spies.setStatusFilter).toHaveBeenCalledWith("active");
    expect(spies.setCatFilter).toHaveBeenCalledWith("");
    expect(spies.setCutFilter).toHaveBeenCalledWith("");
    expect(spies.setBrandFilter).toHaveBeenCalledWith("");
    expect(spies.setTagFilter).toHaveBeenCalledWith("");
    expect(spies.setRatingFilter).toHaveBeenCalledWith(0);
    expect(spies.setAromaFilter).toHaveBeenCalledWith([]);
  });

  it("resetting from INSIDE the wishlist keeps you in the wishlist", () => {
    // The reset target is the current list's default, not a global one — a
    // reset that returned "active" would eject the user from the wishlist they
    // are looking at, which is a navigation they did not ask for.
    const setStatusFilter = vi.fn();
    const { container } = renderWith({
      ...baseCtx, statusFilter: "wish", filtered: [], catFilter: "Latakia",
      setStatusFilter,
      data: { ...baseCtx.data, wishlist: [mkWish(1)] },
    });
    const btn = buttonByText(container, "btn_reset_filters");
    expect(btn, "no reset button on a filtered-to-zero wishlist").toBeTruthy();
    fireEvent.click(btn!);
    expect(setStatusFilter).toHaveBeenCalledWith("wish");
  });
});
