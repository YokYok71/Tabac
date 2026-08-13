// Curator InventoryListView — sanity tests.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppCtx, type AppCtxType } from "../../AppContext.tsx";
import { CuratorInventoryListView } from "../../views/curator/InventoryListView.tsx";

const yearsAgoISO = (y: number) =>
  new Date(Date.now() - Math.round(y * 365.25 * 86400000)).toISOString().slice(0, 10);

const mkTob = (id: number, over: any = {}) => ({
  id, name: `Tobacco ${id}`, brand: "Brand", category: "Virginia", cut: "Flake",
  rating: 4, force: 3, taste: 4, roomNote: 3, blend: "",
  rebuy: null, tastingNotes: "", description: "", imageUrl: "", agingMax: "",
  lots: [{ status: "cellar", weightG: "50", datePurchased: "", dateProduction: "",
    dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
  ...over,
});

const mkWish = (id: number) => ({
  id, name: `Wish ${id}`, brand: "Brand", category: "Virginia", cut: "Flake",
  force: 0, roomNote: 0, taste: 0, blend: "", description: "", agingMax: "",
  tastingNotes: "", imageUrl: "", notes: "", priority: "high",
});

const baseCtx = {
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
  filtered: [mkTob(1), mkTob(2)],
  statusFilter: "all",
  setStatusFilter: () => {},
  setDetail: () => {},
  setSearchOpen: () => {},
  data: {
    tobaccos: [mkTob(1), mkTob(2)],
    wishlist: [mkWish(1)],
    pipes: [],
    accessories: [],
    sessions: [],
  },
};

function renderWith(ctx: any) {
  return render(
    <AppCtx.Provider value={ctx}>
      <CuratorInventoryListView />
    </AppCtx.Provider>
  );
}

// The Type/Coupe/Note dropdowns + tag chips are collapsed behind a
// disclosure by default. Tests that assert those secondary filters render must
// expand it first. The disclosure became an ICON in the existing
// controls row (it was a labelled button on its own row, which cost a row on
// the busiest page), so it is found by aria-label, not by text.
function moreFiltersToggle(container: HTMLElement) {
  return container.querySelector('[aria-label="filters_more"]') as HTMLElement | null;
}
function renderExpanded(ctx: any) {
  const res = renderWith(ctx);
  const toggle = moreFiltersToggle(res.container);
  if (toggle) fireEvent.click(toggle);
  return res;
}

describe("CuratorInventoryListView", () => {
  it("renders nothing when not on inv view", () => {
    const { container } = renderWith({ ...baseCtx, view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when a tobacco detail is set", () => {
    const { container } = renderWith({ ...baseCtx, detail: baseCtx.data.tobaccos[0] });
    expect(container.firstChild).toBeNull();
  });

  it("renders tobacco cards from filtered list", () => {
    renderWith(baseCtx);
    expect(screen.getByText(/Tobacco 1/)).toBeInTheDocument();
    expect(screen.getByText(/Tobacco 2/)).toBeInTheDocument();
  });

  it("shows wishlist chip with heart icon", () => {
    renderWith(baseCtx);
    expect(screen.getByText(/wishlist/i)).toBeInTheDocument();
  });

  it("switches to wishlist content when statusFilter === wish", () => {
    renderWith({ ...baseCtx, statusFilter: "wish" });
    expect(screen.getByText(/Wish 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Tobacco 1/)).not.toBeInTheDocument();
  });

  // The wishlist has its own display order — by product name
  // (default) or by brand.
  it("orders the wishlist by product name by default, and by brand when selected", () => {
    const wishes = [
      { ...mkWish(1), name: "Zeta blend", brand: "Alpha House" },
      { ...mkWish(2), name: "Alpha blend", brand: "Zeta House" },
    ];
    const { container } = renderWith({
      ...baseCtx, statusFilter: "wish",
      data: { ...baseCtx.data, wishlist: wishes },
    });
    // Default = name: "Alpha blend" comes before "Zeta blend".
    const txt = container.textContent || "";
    expect(txt.indexOf("Alpha blend")).toBeGreaterThan(-1);
    expect(txt.indexOf("Alpha blend")).toBeLessThan(txt.indexOf("Zeta blend"));
    // Switch to brand: "Alpha House" (→ Zeta blend) now sorts first.
    const sortSelect = screen.getByLabelText("lbl_sort_by");
    fireEvent.change(sortSelect, { target: { value: "brand" } });
    const txt2 = container.textContent || "";
    expect(txt2.indexOf("Zeta blend")).toBeLessThan(txt2.indexOf("Alpha blend"));
  });

  it("opens detail when a tobacco card is clicked", () => {
    const setDetail = vi.fn();
    renderWith({ ...baseCtx, setDetail });
    fireEvent.click(screen.getByText(/Tobacco 1/));
    expect(setDetail).toHaveBeenCalledWith(baseCtx.data.tobaccos[0]);
  });

  // The ✕ "no-rebuy" badge moved from the italic title row
  // (where it sat awkwardly next to the blend name) into the right-hand
  // status badges column, after POT / CAVE / FIN. Regression locks the
  // placement: assert the badge lives in the same row as POT / CAVE.
  it("renders the no-rebuy ✕ badge in the status badges row, not the title row", () => {
    const tobNoRebuy = { ...mkTob(1), rebuy: false };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobNoRebuy],
      data: { tobaccos: [tobNoRebuy], wishlist: [] },
    });
    // Find the ✕ span.
    const xSpan = Array.from(container.querySelectorAll("span")).find(
      (s) => (s.textContent || "").trim() === "✕"
    );
    expect(xSpan, "✕ rebuy_no badge should be rendered").toBeTruthy();
    // Verify ✕ is NOT inside the title element itself (the badge
    // moved out of the italic title row into the status
    // chips row). The chips row is now a flex sibling of
    // the title under a shared content container, so the
    // "parentElement.contains" check would be a false positive —
    // the downstream "✕ shares ancestor with POT/CAVE within 6 hops"
    // check below still locks the real placement invariant.
    const titleEl = screen.getByText(/Tobacco 1/);
    expect(titleEl.contains(xSpan!)).toBe(false);
    // And verify ✕ sits alongside the POT / CAVE badges — the closest
    // ancestor that ALSO contains a "POT" or "CAVE" text node is the
    // shared badges row.
    const potOrCave = Array.from(container.querySelectorAll("span")).find(
      (s) => /^(lbl_jar_upper|lbl_cellar_upper|POT|CAVE|JAR|CELLAR)$/i.test((s.textContent || "").trim())
    );
    expect(potOrCave, "POT/CAVE chip should render for cellar lots").toBeTruthy();
    // Walk up from ✕ until we find the ancestor that also contains the
    // POT/CAVE chip — must exist within a few hops (the badges row).
    let anc: HTMLElement | null = xSpan!.parentElement;
    let foundShared = false;
    for (let i = 0; i < 6 && anc; i++) {
      if (anc.contains(potOrCave!)) { foundShared = true; break; }
      anc = anc.parentElement;
    }
    expect(foundShared, "✕ should be in the same row as POT/CAVE badges").toBe(true);
  });

  // new "À ne pas reprendre" / "Don't rebuy" filter chip.
  it("renders the 'À ne pas reprendre' chip when at least one tabac is flagged rebuy=false", () => {
    const tobNoRebuy = { ...mkTob(1), rebuy: false };
    const tobOther   = { ...mkTob(2) };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobNoRebuy, tobOther],
      data: { tobaccos: [tobNoRebuy, tobOther], wishlist: [] },
    });
    const chip = Array.from(container.querySelectorAll("button"))
      .find(b => /À ne pas reprendre|Don't rebuy|f_norebuy/i.test(b.textContent || ""));
    expect(chip, "Expected the 'À ne pas reprendre' chip to be rendered when at least one tabac is rebuy=false").toBeTruthy();
    // Badge count should read "01" (single padded width).
    expect(chip!.textContent || "").toMatch(/01/);
  });

  it("hides the 'À ne pas reprendre' chip when no tabac is flagged rebuy=false", () => {
    const tobNull = { ...mkTob(1), rebuy: null };
    const tobYes  = { ...mkTob(2), rebuy: true };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobNull, tobYes],
      data: { tobaccos: [tobNull, tobYes], wishlist: [] },
    });
    const chip = Array.from(container.querySelectorAll("button"))
      .find(b => /À ne pas reprendre|Don't rebuy|f_norebuy/i.test(b.textContent || ""));
    expect(chip, "Expected the chip to stay hidden when count is 0").toBeFalsy();
  });

  it("clicking the 'À ne pas reprendre' chip fires setStatusFilter('norebuy')", () => {
    const tobNoRebuy = { ...mkTob(1), rebuy: false };
    const setStatusFilter = vi.fn();
    const { container } = renderWith({
      ...baseCtx,
      setStatusFilter,
      filtered: [tobNoRebuy],
      data: { tobaccos: [tobNoRebuy], wishlist: [] },
    });
    const chip = Array.from(container.querySelectorAll("button"))
      .find(b => /À ne pas reprendre|Don't rebuy|f_norebuy/i.test(b.textContent || ""));
    expect(chip).toBeTruthy();
    fireEvent.click(chip!);
    expect(setStatusFilter).toHaveBeenCalledWith("norebuy");
  });

  // The "Stock bas" chip appears when a tobacco is running low and
  // fires setStatusFilter("lowstock").
  it("shows the 'Stock bas' chip for a low-stock tobacco and fires setStatusFilter('lowstock')", () => {
    const lowTob = { ...mkTob(1), lots: [{ ...mkTob(1).lots[0], weightG: "20" }] };
    const setStatusFilter = vi.fn();
    const { container } = renderWith({
      ...baseCtx, setStatusFilter, watchLowWeight: "25",
      filtered: [lowTob], data: { tobaccos: [lowTob], wishlist: [] },
    });
    const chip = Array.from(container.querySelectorAll("button"))
      .find(b => /Stock bas|Low stock|f_lowstock/i.test(b.textContent || ""));
    expect(chip, "expected a Stock bas chip").toBeTruthy();
    fireEvent.click(chip!);
    expect(setStatusFilter).toHaveBeenCalledWith("lowstock");
  });

  it("hides the 'Stock bas' chip when no tobacco is low", () => {
    const fullTob = { ...mkTob(1), lots: [{ ...mkTob(1).lots[0], weightG: "200" }] };
    const { container } = renderWith({
      ...baseCtx, watchLowWeight: "25",
      filtered: [fullTob], data: { tobaccos: [fullTob], wishlist: [] },
    });
    const chip = Array.from(container.querySelectorAll("button"))
      .find(b => /Stock bas|Low stock|f_lowstock/i.test(b.textContent || ""));
    expect(chip).toBeFalsy();
  });

  it("does NOT render the ✕ badge when rebuy is null or true", () => {
    const tobUnknown = { ...mkTob(1), rebuy: null };
    const { container, rerender } = renderWith({
      ...baseCtx,
      filtered: [tobUnknown],
      data: { tobaccos: [tobUnknown], wishlist: [] },
    });
    let xSpan = Array.from(container.querySelectorAll("span")).find(
      (s) => (s.textContent || "").trim() === "✕"
    );
    expect(xSpan).toBeFalsy();
    const tobYes = { ...mkTob(1), rebuy: true };
    rerender(
      <AppCtx.Provider value={{ ...baseCtx, filtered: [tobYes], data: { tobaccos: [tobYes], wishlist: [] } } as unknown as AppCtxType}>
        <CuratorInventoryListView />
      </AppCtx.Provider>
    );
    xSpan = Array.from(container.querySelectorAll("span")).find(
      (s) => (s.textContent || "").trim() === "✕"
    );
    expect(xSpan).toBeFalsy();
  });

  // "FINI" / "DONE" badge — the count is dropped when every
  // lot of the tabac is finished (no jar / cellar remaining). Mixed
  // tabacs keep the "N FINI" shape so the user still sees the count.
  it("renders the 'FINI' badge without count when every lot is finished", () => {
    const tobAllDone = {
      ...mkTob(1),
      lots: [
        { status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
          dateOpened: "", dateFinished: "2024-01-01", boxNumber: "", price: "", seller: "", disposed: false },
        { status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
          dateOpened: "", dateFinished: "2024-02-01", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobAllDone],
      data: { tobaccos: [tobAllDone], wishlist: [] },
    });
    // Find the FINI/DONE pill. It's a span with textContent === "FINI" or "DONE".
    const pill = Array.from(container.querySelectorAll("span")).find(
      (s) => /^(lbl_done_upper|FINI|DONE)$/.test((s.textContent || "").trim())
    );
    expect(pill, "Expected a FINI/DONE pill to be rendered when every lot is finished").toBeTruthy();
    // The pill must NOT carry a leading numeric count.
    const wrapper = pill!.parentElement;
    expect(wrapper, "FINI pill should have a wrapper span").toBeTruthy();
    const text = (wrapper!.textContent || "").trim();
    // Pure label, no "2 DONE" or "2 FINI".
    expect(text).toMatch(/^(lbl_done_upper|FINI|DONE)$/);
    expect(text).not.toMatch(/\d/);
  });

  it("hides the FINI badge entirely when at least one lot is still active (jar or cellar)", () => {
    // while any active lot remains, the list card focuses on
    // what's in stock — the historical finished-lot count belongs to
    // the detail view. So the FINI/DONE pill must NOT appear here.
    const tobMixed = {
      ...mkTob(1),
      lots: [
        { status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
          dateOpened: "2024-05-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
        { status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
          dateOpened: "", dateFinished: "2024-01-01", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobMixed],
      data: { tobaccos: [tobMixed], wishlist: [] },
    });
    const pill = Array.from(container.querySelectorAll("span")).find(
      (s) => /^(lbl_done_upper|FINI|DONE)$/.test((s.textContent || "").trim())
    );
    expect(pill, "FINI/DONE pill should be hidden while any jar or cellar lot is active").toBeFalsy();
  });

  it("does NOT render the FINI badge when the tobacco has no finished lots", () => {
    const tobNoFinished = {
      ...mkTob(1),
      lots: [
        { status: "cellar", weightG: "50", datePurchased: "", dateProduction: "",
          dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobNoFinished],
      data: { tobaccos: [tobNoFinished], wishlist: [] },
    });
    const pill = Array.from(container.querySelectorAll("span")).find(
      (s) => /^(lbl_done_upper|FINI|DONE)$/.test((s.textContent || "").trim())
    );
    expect(pill).toBeFalsy();
  });

  // A disposed lot is status:"finished", so the shared FINI pill
  // covers it — there is NO separate ÉLIMINÉ badge (the pill was
  // reverted per user preference; only the auto "à ne pas reprendre" on
  // disposal stays, in useTobaccoStore).
  it("shows FINI (not a separate badge) for a disposed-only tabac", () => {
    const tobDisposed = {
      ...mkTob(1),
      lots: [
        { status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
          dateOpened: "", dateFinished: "2024-01-01", boxNumber: "", price: "", seller: "", disposed: true },
      ],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobDisposed],
      data: { tobaccos: [tobDisposed], wishlist: [] },
    });
    const finiPill = Array.from(container.querySelectorAll("span")).find(
      (s) => /^(lbl_done_upper|FINI|DONE)$/.test((s.textContent || "").trim())
    );
    expect(finiPill, "A disposed-only tabac should show the shared FINI pill").toBeTruthy();
  });
});

// ── Aging info on expanded card ──────────────────────────────
// When expandCards is on and the tabac has agingMax set, the recommended
// max cellar age must render at the end of the expanded body. Locks the
// An earlier release addition: the field used to live in the detail view only.

// ── Wishlist type / cut filters ───────────────────────────────────
// The cat / cut dropdowns now drive the wishlist too. ratingFilter does
// NOT apply (WishlistItem has no personal rating field) and its select
// is hidden in wish mode.

describe("CuratorInventoryListView — wishlist filters", () => {
  const wVirginia = { ...mkWish(1), name: "Wish Virginia", category: "Virginia", cut: "Flake" };
  const wAro = { ...mkWish(2), name: "Wish Aro", category: "Aromatique", cut: "Ribbon" };
  const wishCtx = {
    ...baseCtx,
    statusFilter: "wish",
    data: { tobaccos: [], wishlist: [wVirginia, wAro], pipes: [], accessories: [], sessions: [] },
    filtered: [],
  };

  it("applies catFilter to the wishlist", () => {
    const { container } = renderWith({ ...wishCtx, catFilter: "Virginia" });
    expect(container.textContent).toContain("Wish Virginia");
    expect(container.textContent).not.toContain("Wish Aro");
  });

  it("applies cutFilter to the wishlist", () => {
    const { container } = renderWith({ ...wishCtx, cutFilter: "Ribbon" });
    expect(container.textContent).toContain("Wish Aro");
    expect(container.textContent).not.toContain("Wish Virginia");
  });

  it("renders the type/cut dropdowns in wish mode with wishlist-derived options", () => {
    const { container } = renderExpanded(wishCtx);
    const typeSel = container.querySelector('select[aria-label="aria_filter_by_type"]') as HTMLSelectElement;
    expect(typeSel).toBeTruthy();
    const opts = Array.from(typeSel.querySelectorAll("option")).map(o => o.getAttribute("value"));
    expect(opts).toContain("Virginia");
    expect(opts).toContain("Aromatique");
  });

  it("hides the rating select in wish mode (wishes have no personal rating)", () => {
    const { container } = renderExpanded(wishCtx);
    expect(container.querySelector('select[aria-label="aria_filter_by_rating"]')).toBeNull();
  });

  it("shows the filtered / total counter when a filter narrows the list", () => {
    const { container } = renderWith({ ...wishCtx, catFilter: "Virginia" });
    // 1 shown / 2 total — the "/ 2" denominator appears only while filtered.
    expect(container.textContent).toMatch(/\/\s*2/);
  });

  // REVERSAL, recorded here rather than in a commit message.
  //
  // This case asserted « Aucune envie » for a wishlist holding TWO items that
  // the active filters had narrowed to zero — its own name says "when filters
  // narrow to zero". That is the defect, not the contract: the empty state was
  // computed from the FILTERED array, so someone who owns plenty and left a
  // chip on was told they own nothing, with no hint a filter was even active
  // And no way back. The journal has distinguished the two.
  it("says NO MATCH — not « aucune envie » — when filters narrow a non-empty wishlist to zero", () => {
    const { container } = renderWith({ ...wishCtx, catFilter: "Virginia", cutFilter: "Ribbon" });
    expect(container.textContent).toContain("list_no_match");
    expect(container.textContent).not.toContain("no_wishes");
    // and a way back out of the filter
    expect(container.textContent).toContain("btn_reset_filters");
  });

  it("still says « aucune envie » when the wishlist is genuinely empty", () => {
    // The other half of the distinction: without it, "no match" everywhere
    // would pass the case above while being just as wrong.
    const { container } = renderWith({
      ...wishCtx,
      data: { tobaccos: [], wishlist: [], pipes: [], accessories: [], sessions: [] },
    });
    expect(container.textContent).toContain("no_wishes");
    expect(container.textContent).not.toContain("list_no_match");
    // ...and the way FORWARD, since the "+" is an unlabelled top-bar icon.
    expect(container.textContent).toContain("btn_add_wish");
  });
});

describe("CuratorInventoryListView — aging info on expanded card", () => {
  it("renders the agingMax label when expandCards is on and agingMax is set", () => {
    const tob = mkTob(1, { agingMax: "10", blend: "VA + Burley" });
    const { container } = renderWith({
      ...baseCtx,
      expandCards: true,
      filtered: [tob],
      data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    // Label key resolved by the test's t() identity stub.
    expect(text).toContain("lbl_aging_label");
    expect(text).toContain("10");
    expect(text).toContain("lbl_yrs_with_space");
  });

  it("does not render the agingMax line when agingMax is empty", () => {
    const tob = mkTob(1, { agingMax: "", blend: "VA + Burley" });
    const { container } = renderWith({
      ...baseCtx,
      expandCards: true,
      filtered: [tob],
      data: { tobaccos: [tob], wishlist: [] },
    });
    expect((container.textContent || "")).not.toContain("lbl_aging_label");
  });

  it("does not render the agingMax line when expandCards is off", () => {
    const tob = mkTob(1, { agingMax: "10" });
    const { container } = renderWith({
      ...baseCtx,
      expandCards: false,
      filtered: [tob],
      data: { tobaccos: [tob], wishlist: [] },
    });
    expect((container.textContent || "")).not.toContain("lbl_aging_label");
  });
});

// ── Card maturity distribution with counts ────────────────────────
// The card shows the FULL maturity distribution — one chip per present band
// (young → optimal → peak → tooOld), each WITH its lot count (alwaysCount) —
// so the list gives a transparent per-blend breakdown, not just the worst
// alert. MaturityChip renders "mat_young · N" / "⚠ mat_old · N" (identity t).
const lot = (yearsAgo: number) => ({
  status: "cellar", weightG: "50", dateProduction: yearsAgoISO(yearsAgo),
  datePurchased: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false,
});
describe("CuratorInventoryListView — card maturity distribution", () => {
  const mkFull = () => mkTob(1, {
    agingMax: "5", // optimalStart = 2y ; peak at age > 4 ; overaged > 5
    lots: [lot(1), lot(3), lot(4.5), lot(8)], // young, optimal, peak, tooOld
  });

  it("shows a counted chip for every present band", () => {
    const tob = mkFull();
    const { container } = renderWith({
      ...baseCtx, statusFilter: "all",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).toContain("mat_young · 1");
    expect(text).toContain("mat_optimal · 1");
    expect(text).toContain("⚠ mat_peak · 1");
    expect(text).toContain("⚠ mat_old · 1");
  });

  it("sums lots that share a band into the count", () => {
    const tob = mkTob(1, { agingMax: "5", lots: [lot(8), lot(9), lot(1)] });
    const { container } = renderWith({
      ...baseCtx, statusFilter: "all",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).toContain("⚠ mat_old · 2");
    expect(text).toContain("mat_young · 1");
  });

  // The CELLAR-ONLY rule, pinned where a future "fix" would
  // land. The two pure helpers already lock it (lotMaturityBucket +
  // lotAgingStatus both return null for a jar), but nothing asserted the
  // user-visible consequence: an opened jar carries NO maturity band on the
  // card, however old it is. It reads as a bug — an 8-year-old tin showing no
  // "trop vieux" chip — and it was questioned and UPHELD: an
  // opened jar is being smoked, so its age no longer qualifies it; it carries
  // the separate "ouvert depuis N" signal instead. Reverting that decision
  // must be a deliberate act, not a plausible-looking patch to the view.
  it("shows NO maturity chip for a jar lot, at any age (cellar-only)", () => {
    const jar = (yearsAgo: number) => ({ ...lot(yearsAgo), status: "jar", dateOpened: "2024-01-01" });
    const tob = mkTob(1, { agingMax: "5", lots: [jar(1), jar(8)] });
    const { container } = renderWith({
      ...baseCtx, statusFilter: "all",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).not.toContain("mat_young");
    expect(text).not.toContain("mat_optimal");
    expect(text).not.toContain("mat_peak");
    expect(text).not.toContain("mat_old");
    // Control: the same two ages in the CELLAR do chip, so the assertion above
    // can't pass merely because the chips stopped rendering altogether.
    const cellarTob = mkTob(2, { agingMax: "5", lots: [lot(1), lot(8)] });
    const ctl = renderWith({
      ...baseCtx, statusFilter: "all",
      filtered: [cellarTob], data: { tobaccos: [cellarTob], wishlist: [] },
    });
    expect(ctl.container.textContent || "").toContain("mat_young · 1");
    expect(ctl.container.textContent || "").toContain("⚠ mat_old · 1");
  });

  // This REVERSES the rule the test used to lock ("show the
  // full distribution regardless of the active filter — the distribution is
  // transparent, not filtered"). Reported from the app: filtered to a band,
  // the card still showed every OTHER band, so the user could not tell which
  // lots the chips described. While a filter is active the card must describe
  // the filtered lots and nothing else; unfiltered, the full distribution is
  // unchanged (the test above).
  it("narrows the distribution to the active filter's band", () => {
    const tob = mkFull();
    const { container } = renderWith({
      ...baseCtx, statusFilter: "approaching",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).toContain("⚠ mat_peak · 1");
    expect(text).not.toContain("mat_young · 1");
    expect(text).not.toContain("⚠ mat_old · 1");
  });

  it("shows NO maturity chip under a jar filter (maturity is cellar-only)", () => {
    // The reported case: "En pot" showed "PIC PROCHE · 3 / TROP VIEUX · 1"
    // beside a jar weight — bands that by construction can only describe
    // cellar lots, so they appeared to qualify a lot they cannot describe.
    const tob = mkFull();
    const { container } = renderWith({
      ...baseCtx, statusFilter: "jar",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).not.toContain("mat_young");
    expect(text).not.toContain("mat_peak");
    expect(text).not.toContain("mat_old");
  });

  it("shows no maturity chip when the tobacco has no active lot", () => {
    const tob = mkTob(1, {
      lots: [{ status: "finished", weightG: "0", dateProduction: yearsAgoISO(8),
        datePurchased: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    });
    const { container } = renderWith({
      ...baseCtx, statusFilter: "all",
      filtered: [tob], data: { tobaccos: [tob], wishlist: [] },
    });
    const text = container.textContent || "";
    expect(text).not.toContain("mat_young");
    expect(text).not.toContain("mat_old");
  });
});

// ── "Actifs" filter chip ─────────────────────────────────────────
// New discrete filter between "Tous" and "Cave" — counts tabacs with at
// least one cellar or jar lot. Also surfaces the active-lot count next
// to the chip badge.

describe("CuratorInventoryListView — 'Actifs' chip", () => {
  it("renders the chip between 'Tous' and 'Cave'", () => {
    const tobActive = { ...mkTob(1) };  // cellar lot
    const tobFinishedOnly = {
      ...mkTob(2),
      lots: [{ status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
        dateOpened: "", dateFinished: "2023-12-01", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobActive, tobFinishedOnly],
      data: { tobaccos: [tobActive, tobFinishedOnly], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const labels = buttons.map(b => (b.textContent || "").trim());
    // Locate the three chips' indices to assert ordering.
    const allIdx = labels.findIndex(l => /^f_all|^Tous|^All/i.test(l));
    const activeIdx = labels.findIndex(l => /Actifs|Active/i.test(l));
    const cellarIdx = labels.findIndex(l => /f_cellar|Cave|Cellar/i.test(l));
    expect(allIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThan(allIdx);
    expect(cellarIdx).toBeGreaterThan(activeIdx);
  });

  it("the 'Actifs' badge counts tabacs with cellar or jar lots (not finished-only)", () => {
    const tobCellar = { ...mkTob(1) };  // cellar lot
    const tobJar = {
      ...mkTob(2),
      lots: [{ status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
        dateOpened: "2024-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const tobFinishedOnly = {
      ...mkTob(3),
      lots: [{ status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
        dateOpened: "", dateFinished: "2023-12-01", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobCellar, tobJar, tobFinishedOnly],
      data: { tobaccos: [tobCellar, tobJar, tobFinishedOnly], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const activeBtn = buttons.find(b => /Actifs|Active/i.test(b.textContent || ""));
    expect(activeBtn).toBeTruthy();
    // The badge shows the count right-padded to "02" — `String(2).padStart(2,"0")`.
    expect(activeBtn?.textContent || "").toMatch(/02/);
  });

  it("clicking 'Actifs' fires setStatusFilter('active')", () => {
    const setStatusFilter = vi.fn();
    const { container } = renderWith({
      ...baseCtx,
      setStatusFilter,
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const activeBtn = buttons.find(b => /Actifs|Active/i.test(b.textContent || ""));
    fireEvent.click(activeBtn!);
    expect(setStatusFilter).toHaveBeenCalledWith("active");
  });

  // The badge count MUST match App.tsx's "active" filter
  // predicate (`countActive(t) > 0`). An earlier release dropped the lot-less clause —
  // a lot-less tabac is now INACTIVE, so it is neither filtered-in nor counted.
  it("the 'Actifs' badge excludes a no-lot tabac (lot-less is inactive)", () => {
    const tobJar = {
      ...mkTob(1),
      lots: [{ status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
        dateOpened: "2024-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const tobNoLots = { ...mkTob(2), lots: [] };
    const tobFinishedOnly = {
      ...mkTob(3),
      lots: [{ status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
        dateOpened: "", dateFinished: "2023-12-01", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobJar],
      data: { tobaccos: [tobJar, tobNoLots, tobFinishedOnly], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const activeBtn = buttons.find(b => /Actifs|Active/i.test(b.textContent || ""));
    // jar (active) = 1; no-lot AND finished-only both excluded.
    expect(activeBtn?.textContent || "").toMatch(/01/);
  });

  // The old "Inactifs" (countActive===0) is split into "Épuisé"
  // (has lots, all done — rebuy candidate) and "Sans lot" (no lot at all —
  // incomplete). Two distinct chips, each auto-hidden at 0.
  it("the 'Épuisé' badge counts finished-only / disposed-only tabacs, NOT the lot-less", () => {
    const tobJar = {
      ...mkTob(1),
      lots: [{ status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
        dateOpened: "2024-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const tobNoLots = { ...mkTob(2), lots: [] };
    const tobFinishedOnly = {
      ...mkTob(3),
      lots: [{ status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
        dateOpened: "", dateFinished: "2023-12-01", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobFinishedOnly],
      data: { tobaccos: [tobJar, tobNoLots, tobFinishedOnly], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const usedUpBtn = buttons.find(b => /f_used_up|Épuisé|Used up/i.test(b.textContent || ""));
    expect(usedUpBtn, "the Épuisé chip should render when a finished-only tabac exists").toBeTruthy();
    // Only the finished-only tabac (has lots, none active) = 1; the lot-less is NOT counted here.
    expect(usedUpBtn?.textContent || "").toMatch(/01/);
  });

  it("the 'Sans lot' badge counts ONLY lot-less tabacs", () => {
    const tobJar = {
      ...mkTob(1),
      lots: [{ status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
        dateOpened: "2024-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const tobNoLots = { ...mkTob(2), lots: [] };
    const tobFinishedOnly = {
      ...mkTob(3),
      lots: [{ status: "finished", weightG: "0", datePurchased: "", dateProduction: "",
        dateOpened: "", dateFinished: "2023-12-01", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobNoLots],
      data: { tobaccos: [tobJar, tobNoLots, tobFinishedOnly], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const nolotBtn = buttons.find(b => /f_nolot|Sans lot|No lot/i.test(b.textContent || ""));
    expect(nolotBtn, "the Sans lot chip should render when a lot-less tabac exists").toBeTruthy();
    expect(nolotBtn?.textContent || "").toMatch(/01/);
  });

  it("both 'Épuisé' and 'Sans lot' auto-hide when every tabac is active", () => {
    const tobJar = {
      ...mkTob(1),
      lots: [{ status: "jar", weightG: "30", datePurchased: "", dateProduction: "",
        dateOpened: "2024-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobJar],
      data: { tobaccos: [tobJar], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.find(b => /f_used_up|Épuisé|Used up/i.test(b.textContent || ""))).toBeFalsy();
    expect(buttons.find(b => /f_nolot|Sans lot|No lot/i.test(b.textContent || ""))).toBeFalsy();
  });

  it("clicking 'Sans lot' fires setStatusFilter('nolot')", () => {
    const setStatusFilter = vi.fn();
    const tobNoLots = { ...mkTob(2), lots: [] };
    const { container } = renderWith({
      ...baseCtx,
      setStatusFilter,
      filtered: [tobNoLots],
      data: { tobaccos: [tobNoLots], wishlist: [] },
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const nolotBtn = buttons.find(b => /f_nolot|Sans lot|No lot/i.test(b.textContent || ""));
    fireEvent.click(nolotBtn!);
    expect(setStatusFilter).toHaveBeenCalledWith("nolot");
  });

  // The chips are back to ONE scrollable row (the
  // Statut/Maturité split was reverted — too much vertical space). Both a
  // status chip and a maturity chip render in the same strip, with no group
  // labels.
  it("renders status + maturity chips in a single row without group labels", () => {
    const tobYoung = {
      ...mkTob(1),
      agingMax: "10",
      lots: [{ status: "cellar", weightG: "50", datePurchased: "2024-01-01", dateProduction: "2024-01-01",
        dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    };
    const { container } = renderWith({
      ...baseCtx,
      filtered: [tobYoung],
      data: { tobaccos: [tobYoung], wishlist: [] },
    });
    // A status chip (Actifs) and a maturity chip (Jeunes) both render...
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some(b => /f_active|Actifs|Active/i.test(b.textContent || ""))).toBe(true);
    expect(buttons.some(b => /f_young|Jeunes|Young/i.test(b.textContent || ""))).toBe(true);
    // ...and the group labels are gone.
    expect(container.textContent).not.toMatch(/flt_status|flt_maturity/);
  });

  // The Type/Coupe/Note dropdowns are collapsed behind a
  // "Plus de filtres" toggle, hidden by default, to save vertical space.
  it("collapses the Type/Coupe/Note dropdowns behind the filter disclosure", () => {
    const { container } = renderWith(baseCtx);
    // Collapsed by default: the type dropdown is not rendered.
    expect(container.querySelector('[aria-label="aria_filter_by_type"]')).toBeNull();
    // The disclosure is an icon in the controls row, NOT a labelled
    // button on a row of its own — that row was the thing being saved.
    const toggle = moreFiltersToggle(container);
    expect(toggle, "expected the filter disclosure icon").toBeTruthy();
    expect(toggle!.textContent || "").not.toMatch(/filters_more/);
    // Expand → the dropdowns appear.
    fireEvent.click(toggle!);
    expect(container.querySelector('[aria-label="aria_filter_by_type"]')).toBeTruthy();
  });

  it("keeps the disclosure lit while a hidden filter is applied", () => {
    // Folding filters away must never let a narrowed list look unfiltered.
    // The `on` state carries what the removed labelled button showed as a dot.
    const off = renderWith(baseCtx);
    const a = moreFiltersToggle(off.container)!.getAttribute("aria-pressed");
    const on = renderWith({ ...baseCtx, catFilter: "Anglais" });
    const b = moreFiltersToggle(on.container)!.getAttribute("aria-pressed");
    expect(a).toBe("false");
    expect(b).toBe("true");
  });
});

// ── WishCard action row — 3 explicit buttons ──────────────────
// Reverts the model. An earlier release made the entire card tappable to
// open the edit form (no separate detail view exists for wishlist items).
// User feedback: that diverges from TobaccoCard / PipeCard /
// AccCard where a tap opens a read-only detail and edit is a distinct
// action, and there's no Modifier button visible on the wishlist. Fix:
// strip the whole-card tap and add an explicit Modifier (pencil) button
// next to Acquérir + Trash. The card is now static; every action requires
// hitting its dedicated button.

describe("CuratorInventoryListView — WishCard 3-button action row", () => {
  const wishlistOnly = {
    ...baseCtx,
    statusFilter: "wish",
    filtered: [],
    data: { tobaccos: [], wishlist: [mkWish(1)] },
  };

  it("tapping the wish card body does NOT open the edit form", () => {
    const setWishForm = vi.fn();
    const setEditWishId = vi.fn();
    const setShowWishForm = vi.fn();
    const { container } = renderWith({
      ...wishlistOnly,
      setWishForm, setEditWishId, setShowWishForm,
      BW: { id: 0 },
    });
    // Tap the name — the body of the card. An earlier release would have opened
    // the edit form via the PressCard wrapper; the wish card must NOT.
    const nameSpan = Array.from(container.querySelectorAll("span"))
      .find(s => (s.textContent || "").trim() === "Wish 1");
    expect(nameSpan).toBeTruthy();
    fireEvent.click(nameSpan!);
    expect(setShowWishForm).not.toHaveBeenCalled();
    expect(setEditWishId).not.toHaveBeenCalled();
  });

  it("tapping the Modifier (pencil) button opens the edit form", () => {
    const setWishForm = vi.fn();
    const setEditWishId = vi.fn();
    const setShowWishForm = vi.fn();
    const { container } = renderWith({
      ...wishlistOnly,
      setWishForm, setEditWishId, setShowWishForm,
      BW: { id: 0 },
    });
    const editBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_edit|Modifier|Edit/i.test(b.getAttribute("aria-label") || ""));
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn!);
    expect(setShowWishForm).toHaveBeenCalledWith(true);
    expect(setEditWishId).toHaveBeenCalled();
  });

  it("Acquire button still works without side effects on the edit path", () => {
    const setShowWishForm = vi.fn();
    const wishToInv = vi.fn();
    const { container } = renderWith({
      ...wishlistOnly,
      setShowWishForm,
      wishToInv,
      BW: { id: 0 },
    });
    const acquireBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_acquire|Acquérir|Acquire/.test(b.textContent || ""));
    expect(acquireBtn).toBeTruthy();
    fireEvent.click(acquireBtn!);
    expect(wishToInv).toHaveBeenCalled();
    expect(setShowWishForm).not.toHaveBeenCalled();
  });

  it("Trash button still works without side effects on the edit path", () => {
    const setShowWishForm = vi.fn();
    const delWish = vi.fn();
    const { container } = renderWith({
      ...wishlistOnly,
      setShowWishForm,
      delWish,
    });
    const trashBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_delete|Supprimer|Delete/i.test(b.getAttribute("aria-label") || ""));
    expect(trashBtn).toBeTruthy();
    fireEvent.click(trashBtn!);
    expect(delWish).toHaveBeenCalledWith(1);
    expect(setShowWishForm).not.toHaveBeenCalled();
  });
});

// ── Arrow-key navigation across filter chips ─────────────────────
// Arrow Right / Left moves focus to the next / previous chip. Home / End
// jump to the first / last chip. The loop does NOT wrap — past the last
// or before the first chip, focus stays put. Matches WAI-ARIA toolbar.

describe("CuratorInventoryListView — chip arrow-key nav", () => {
  function chipButtons(container: HTMLElement): HTMLButtonElement[] {
    // The status filter chips share a wrapper with no aria — find them by
    // their visible labels. Restrict to the inventory filter row.
    const all = Array.from(container.querySelectorAll("button"));
    const wantedLabels = /^(f_all|f_active|f_cellar|f_jars|f_finished|f_disposed|f_norebuy|f_lowstock|aging_warn|aging_soon|lbl_wishlist|Tous|All|Actifs|Active|Cave|Cellar|Pot|Jar|Termin|Finished|Mûrissent|Aging|Trop âgé|Overaged|Stock bas|Low stock|Wishlist|Envies)/i;
    return all.filter(b => wantedLabels.test((b.textContent || "").trim())) as HTMLButtonElement[];
  }

  it("ArrowRight moves focus to the next chip", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    chips[0]!.focus();
    fireEvent.keyDown(chips[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(chips[1]);
  });

  it("ArrowLeft moves focus to the previous chip", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    chips[1]!.focus();
    fireEvent.keyDown(chips[1]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(chips[0]);
  });

  it("Home jumps to the first chip", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    const last = chips[chips.length - 1];
    last!.focus();
    fireEvent.keyDown(last!, { key: "Home" });
    expect(document.activeElement).toBe(chips[0]);
  });

  it("End jumps to the last chip", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    chips[0]!.focus();
    fireEvent.keyDown(chips[0]!, { key: "End" });
    expect(document.activeElement).toBe(chips[chips.length - 1]);
  });

  it("ArrowRight on the last chip keeps focus put (no wrap)", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    const last = chips[chips.length - 1];
    last!.focus();
    fireEvent.keyDown(last!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(last);
  });

  it("ArrowLeft on the first chip keeps focus put (no wrap)", () => {
    const { container } = renderWith(baseCtx);
    const chips = chipButtons(container);
    chips[0]!.focus();
    fireEvent.keyDown(chips[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(chips[0]);
  });
});

// ── type / cut filter dropdowns ────────────────────────────
// The two select dropdowns are derived from the user's inventory (NOT
// the full CATS/CUTS enums). The active-pill row already wired
// catFilter; cutFilter is new — these specs lock the dropdown
// rendering, the setter wiring, and the stale-filter reset.
describe("CuratorInventoryListView — type / cut filter dropdowns", () => {
  const tobs = [
    { ...mkTob(1), category: "Virginia", cut: "Flake" },
    { ...mkTob(2), category: "Anglais",  cut: "Ribbon" },
    { ...mkTob(3), category: "Virginia", cut: "Coins" },
  ];
  const ctx = {
    ...baseCtx,
    filtered: tobs,
    data: { ...baseCtx.data, tobaccos: tobs },
  };

  const typeSel = (container: HTMLElement): HTMLSelectElement | null =>
    container.querySelector("select[aria-label*='type'], select[aria-label*='Type']");
  const cutSel = (container: HTMLElement): HTMLSelectElement | null =>
    container.querySelector("select[aria-label*='coupe'], select[aria-label*='cut']");

  it("renders both dropdowns when the inventory has tobaccos", () => {
    const { container } = renderExpanded(ctx);
    expect(typeSel(container)).toBeTruthy();
    expect(cutSel(container)).toBeTruthy();
  });

  it("type dropdown options are derived from the inventory only (no phantom enum entries)", () => {
    const { container } = renderExpanded(ctx);
    const opts = Array.from(typeSel(container)!.options).map(o => o.value);
    // Includes the empty (All) option + the 2 distinct categories.
    expect(opts).toEqual(["", "Anglais", "Virginia"]);
    // The full enum has Burley, Latakia, etc. — they must NOT appear.
    expect(opts).not.toContain("Burley");
  });

  it("cut dropdown options are derived from the inventory only", () => {
    const { container } = renderExpanded(ctx);
    const opts = Array.from(cutSel(container)!.options).map(o => o.value);
    expect(opts).toEqual(["", "Coins", "Flake", "Ribbon"]);
    expect(opts).not.toContain("Shag");
  });

  it("picking a type calls setCatFilter with the chosen value", () => {
    const setCatFilter = vi.fn();
    const { container } = renderExpanded({ ...ctx, setCatFilter });
    fireEvent.change(typeSel(container)!, { target: { value: "Anglais" } });
    expect(setCatFilter).toHaveBeenCalledWith("Anglais");
  });

  it("picking a cut calls setCutFilter with the chosen value", () => {
    const setCutFilter = vi.fn();
    const { container } = renderExpanded({ ...ctx, setCutFilter });
    fireEvent.change(cutSel(container)!, { target: { value: "Flake" } });
    expect(setCutFilter).toHaveBeenCalledWith("Flake");
  });

  // UPDATE: dropdowns are no longer hidden in wish mode —
  // they now drive the wishlist (options derived from wish items).
  // The old "hidden in wish mode" assertion guarded earlier behaviour
  // that this deliberately replaced.
  it("dropdowns render in wishlist mode with wishlist-derived options", () => {
    const { container } = renderExpanded({ ...ctx, statusFilter: "wish" });
    const sel = typeSel(container);
    expect(sel).not.toBeNull();
    const opts = Array.from(sel!.options).map(o => o.value);
    // baseCtx wishlist = [mkWish(1)] → category "Virginia" only; the
    // ctx tobaccos' "Anglais" must NOT leak into wish-mode options.
    expect(opts).toContain("Virginia");
    expect(opts).not.toContain("Anglais");
  });

  it("dropdowns are hidden in wish mode when the wishlist is empty", () => {
    const { container } = renderWith({
      ...ctx,
      statusFilter: "wish",
      data: { ...ctx.data, wishlist: [] },
    });
    expect(typeSel(container)).toBeNull();
    expect(cutSel(container)).toBeNull();
  });

  it("dropdowns are hidden when the inventory is empty", () => {
    const { container } = renderWith({
      ...baseCtx,
      filtered: [],
      data: { ...baseCtx.data, tobaccos: [] },
    });
    expect(typeSel(container)).toBeNull();
    expect(cutSel(container)).toBeNull();
  });

  it("active cutFilter renders an ActiveFilterPill above the chips", () => {
    const { container } = renderWith({ ...ctx, cutFilter: "Flake" });
    // The pill row is the only place with the 'filter_lbl' label.
    expect(container.textContent || "").toContain("Flake");
  });

  it("stale cutFilter is auto-cleared when the value disappears from the inventory", () => {
    const setCutFilter = vi.fn();
    renderWith({
      ...ctx,
      cutFilter: "Shag", // not present in the 3 tobaccos
      setCutFilter,
    });
    expect(setCutFilter).toHaveBeenCalledWith("");
  });

  it("stale catFilter is auto-cleared too (symmetric guard)", () => {
    const setCatFilter = vi.fn();
    renderWith({
      ...ctx,
      catFilter: "Burley", // not present in the 3 tobaccos
      setCatFilter,
    });
    expect(setCatFilter).toHaveBeenCalledWith("");
  });

  it("rating dropdown is rendered alongside type / cut", () => {
    const { container } = renderExpanded(ctx);
    const sel = container.querySelector("select[aria-label*='note'], select[aria-label*='rating']") as HTMLSelectElement;
    expect(sel).toBeTruthy();
    // 1 'Any' option + 5 star tiers (5→1).
    expect(sel.options.length).toBe(6);
  });

  it("picking a rating calls setRatingFilter with a parsed integer", () => {
    const setRatingFilter = vi.fn();
    const { container } = renderExpanded({ ...ctx, setRatingFilter });
    const sel = container.querySelector("select[aria-label*='note'], select[aria-label*='rating']") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "4" } });
    expect(setRatingFilter).toHaveBeenCalledWith(4);
  });

  it("picking the 'Any' rating clears the filter (0)", () => {
    const setRatingFilter = vi.fn();
    const { container } = renderExpanded({ ...ctx, ratingFilter: 4, setRatingFilter });
    const sel = container.querySelector("select[aria-label*='note'], select[aria-label*='rating']") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "0" } });
    expect(setRatingFilter).toHaveBeenCalledWith(0);
  });
});

// ── a filtered card's weight is about the filtered lots ─────
// Reported from the app: with "En pot" active, a blend holding 1 jar lot and
// 18 cellar lots showed the whole active stock. The pure resolver is covered
// in cellarInsights.test.ts; this locks the WIRING — the card must actually
// pass the active statusFilter through it.
describe("InventoryListView — weight scoped to the active filter", () => {
  const mixed = mkTob(9, {
    name: "Mixed", agingMax: "10",
    lots: [
      { status: "jar", weightG: "45", datePurchased: "", dateProduction: "", dateOpened: "2026-01-01", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      { status: "cellar", weightG: "100", datePurchased: yearsAgoISO(0.5), dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      { status: "cellar", weightG: "200", datePurchased: yearsAgoISO(20), dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
    ],
  });
  const ctxFor = (statusFilter: string) =>
    ({ ...baseCtx, filtered: [mixed], statusFilter } as unknown as AppCtxType);

  it("unfiltered shows the full active total, with no scope label", () => {
    const { container } = renderWith(ctxFor("all"));
    expect(container.textContent).toContain("345");
    // The page's own filter chips carry these labels too, so assert on the
    // qualifier ELEMENT rather than on page text.
    expect(container.querySelector("[data-scope]")).toBeNull();
  });

  it("'En pot' shows the jar weight only, and names the scope", () => {
    const { container } = renderWith(ctxFor("jar"));
    expect(container.textContent).toContain("45");
    expect(container.textContent).not.toContain("345");
    expect(container.querySelector('[data-scope="jar"]')).toBeTruthy();
  });

  it("'En cave' shows the cellar weight only", () => {
    const { container } = renderWith(ctxFor("cellar"));
    expect(container.textContent).toContain("300");
    expect(container.textContent).not.toContain("345");
    expect(container.querySelector('[data-scope="cellar"]')).toBeTruthy();
  });

  it("a maturity filter shows that band's weight only", () => {
    const old = renderWith(ctxFor("overaged"));
    expect(old.container.textContent).toContain("200");
    expect(old.container.textContent).not.toContain("345");
    expect(old.container.textContent).toContain("mat_old");
    old.unmount();
    const young = renderWith(ctxFor("young"));
    expect(young.container.textContent).toContain("100");
    expect(young.container.textContent).toContain("mat_young");
  });

  it("under 'En pot' the card shows no cellar count and no cellar-band chip", () => {
    const { container } = renderWith(ctxFor("jar"));
    const text = container.textContent || "";
    // "1 POT" stays; the cellar badge and its bands go.
    expect(text).toContain("lbl_jar_upper");
    expect(text).not.toContain("lbl_cellar_upper");
    expect(text).not.toContain("mat_");
  });

  it("the lot counter follows the filter too", () => {
    // 3 lots total, 1 of them in a jar.
    expect((renderWith(ctxFor("all")).container.textContent || "")).toContain("3 unit_lots");
    expect((renderWith(ctxFor("jar")).container.textContent || "")).toContain("1 unit_lot");
  });

  it("'Achats récents' scopes to the lots bought in the window", () => {
    const daysAgoISO = (d: number) =>
      new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const tob = mkTob(11, {
      lots: [
        { status: "cellar", weightG: "60", datePurchased: daysAgoISO(10), dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
        { status: "cellar", weightG: "400", datePurchased: daysAgoISO(500), dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    });
    const { container } = renderWith({ ...baseCtx, filtered: [tob], statusFilter: "recent" } as unknown as AppCtxType);
    expect(container.textContent).toContain("60");
    expect(container.textContent).not.toContain("460");
    expect(container.querySelector('[data-scope="recent"]')).toBeTruthy();
  });

  it("under 'En pot', the card says how long the OLDEST jar has been open", () => {
    // Requested so the list answers it without opening the fiche.
    const daysAgoISO = (d: number) =>
      new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const twoJars = mkTob(12, {
      lots: [
        { status: "jar", weightG: "20", dateOpened: daysAgoISO(40), datePurchased: "", dateProduction: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
        { status: "jar", weightG: "25", dateOpened: daysAgoISO(400), datePurchased: "", dateProduction: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    });
    const jar = renderWith({ ...baseCtx, filtered: [twoJars], statusFilter: "jar" } as unknown as AppCtxType);
    const el = jar.container.querySelector("[data-open-since]");
    expect(el, "the open-since line must be on the card").toBeTruthy();
    // The OLDEST opening (400 d → "1age_y 1age_m"), not the 40-day one.
    expect(el!.textContent).toContain("lot_open_since");
    expect(el!.textContent).toContain("age_y");
    expect(el!.textContent).not.toContain("1age_mo");
    jar.unmount();

    // Not shown outside the jar filter — it would be noise on every row.
    const all = renderWith({ ...baseCtx, filtered: [twoJars], statusFilter: "all" } as unknown as AppCtxType);
    expect(all.container.querySelector("[data-open-since]")).toBeNull();
  });

  it("the expanded card's age is the oldest IN-SCOPE lot, not the oldest overall", () => {
    // Explicitly requested: under "En pot" the age must be the oldest JAR's,
    // never a 20-year cellar lot's.
    const daysAgoISO = (d: number) =>
      new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const mix = mkTob(14, {
      lots: [
        { status: "jar", weightG: "20", datePurchased: daysAgoISO(200), dateOpened: daysAgoISO(30), dateProduction: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
        { status: "cellar", weightG: "300", datePurchased: daysAgoISO(7300), dateProduction: "", dateOpened: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false },
      ],
    });
    // ageLabel is what renders the clock line; make its output unambiguous.
    const ctxWith = (statusFilter: string) => ({
      ...baseCtx, filtered: [mix], statusFilter, expandCards: true,
      ageLabel: (d: number) => `AGE${d}`,
    } as unknown as AppCtxType);

    const jar = renderWith(ctxWith("jar"));
    expect(jar.container.textContent).toMatch(/AGE(19|20|21)\d\b/);   // ~200 d
    expect(jar.container.textContent).not.toMatch(/AGE7[23]\d\d/);     // not the 20-year lot
    jar.unmount();

    const cellar = renderWith(ctxWith("cellar"));
    expect(cellar.container.textContent).toMatch(/AGE7[23]\d\d/);
    cellar.unmount();

    // Unfiltered, the oldest across everything.
    const all = renderWith(ctxWith("all"));
    expect(all.container.textContent).toMatch(/AGE7[23]\d\d/);
  });

  it("no open-since when the jar lots carry no opening date", () => {
    const noDate = mkTob(13, {
      lots: [{ status: "jar", weightG: "20", dateOpened: "", datePurchased: "", dateProduction: "", dateFinished: "", boxNumber: "", price: "", seller: "", disposed: false }],
    });
    const { container } = renderWith({ ...baseCtx, filtered: [noDate], statusFilter: "jar" } as unknown as AppCtxType);
    expect(container.querySelector("[data-open-since]")).toBeNull();
  });

  it("a tobacco-level filter is NOT scoped (its card keeps the total)", () => {
    // "Actifs" selects tobaccos, not lots — scoping there would be arbitrary.
    const { container } = renderWith(ctxFor("active"));
    expect(container.textContent).toContain("345");
    expect(container.querySelector("[data-scope]")).toBeNull();
  });
});
