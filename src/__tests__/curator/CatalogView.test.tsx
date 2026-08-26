// smoke tests for src/views/curator/CatalogView.tsx.
// Audit-deferred item — locks the search input →
// matcher → row count pipeline, the category-chip filter, and the
// per-row tap → detail modal interaction.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AppCtx } from "../../AppContext";
import { loadCatalogueFixture, resetCatalogueFixture, useCatalogueCsv, emptyCatalogueFixture } from "../catalogueFixture";

// The app ships no catalogue, so the view needs one supplied —
// the committed excerpt, through the real parser. See catalogueFixture.ts.
vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import { CuratorCatalogView } from "../../views/curator/CatalogView";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../../utils/tobaccoDb";
import { BT, BW } from "../../constants";
import { FAMILY_AGING_MAX, effectiveAgingMax } from "../../utils";

beforeEach(() => {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
});

async function primeDb() {
  _resetTobaccoDbForTests();
  await loadTobaccoDb();
}

describe("CatalogView — visibility", () => {
  it("returns null when view !== 'catalog'", () => {
    const { container } = renderWithCtx(<CuratorCatalogView />, { view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("renders the catalog shell when view === 'catalog'", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(),
      addWish: vi.fn(),
      nav: vi.fn(),
    });
    // catalog_title or "Catalogue" should render in the TopBar.
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/catalog_title|Catalogue/i);
    });
  });
});

describe("CatalogView — search filtering (matcher)", () => {
  it("a free-text query reduces the row count to matching blends", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(),
      addWish: vi.fn(),
      nav: vi.fn(),
    });
    // Wait for DB-loaded state — the "X/Y blends" count line should
    // appear with totalShown === totalCatalog (no filter active).
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    // Read the initial total.
    const initial = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
    expect(initial).toBeTruthy();
    const totalCatalog = Number(initial![2]);
    // Non-vacuity against the fixture excerpt (28 rows), not the 1594-row
    // catalogue the app used to ship.
    expect(totalCatalog).toBeGreaterThan(20);

    // Type a tokenised query. "Corvane blue" is the canonical
    // regression case (the DB stores "corvane|flake blue"; the
    // matcher tokenises so both words match the blob).
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    fireEvent.change(searchInput, { target: { value: "Corvane blue" } });

    await waitFor(() => {
      const after = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
      expect(after).toBeTruthy();
      const totalShown = Number(after![1]);
      // At least one hit, far less than the total.
      expect(totalShown).toBeGreaterThan(0);
      expect(totalShown).toBeLessThan(totalCatalog);
    });
  });

  it("an empty query restores the full row count", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(),
      addWish: vi.fn(),
      nav: vi.fn(),
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;
    // Type then clear.
    fireEvent.change(searchInput, { target: { value: "Corvane" } });
    await waitFor(() => {
      const m = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
      expect(m).toBeTruthy();
      expect(Number(m![1])).toBeLessThan(Number(m![2]));
    });
    fireEvent.change(searchInput, { target: { value: "" } });
    await waitFor(() => {
      const m = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
      expect(m).toBeTruthy();
      expect(m![1]).toBe(m![2]); // shown === catalog (no filter)
    });
  });
});

describe("CatalogView — group rendering", () => {
  it("renders brand group headers — Halvorsen is one of them in the default DB", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(),
      addWish: vi.fn(),
      nav: vi.fn(),
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/Halvorsen/);
    });
  });
});

// adding to the wishlist / inventory from the catalog.
// The user reported "je l'ai ajouté mais il n'est pas apparu" — the flow is
// correct (addWish gets a valid payload), but the list groups by brand with
// groups collapsed by default, so a fresh item hid inside its collapsed group.
// The list now expands the item's brand group, and the intermediate
// review form was removed so the fiche button adds DIRECTLY (one tap, no scroll-to-save).
// These tests drive the real fiche → direct-add flow and lock the payload,
// the group expand, and that there is NO review-modal save step.
describe("CatalogView — add to wishlist / inventory from catalog", () => {
  async function openDuskfallFiche(container: HTMLElement) {
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Halvorsen Duskfall" } });
    // The catalog defaults to grouped-collapsed, so the blend rows hide inside
    // their brand group. Expand the Halvorsen group header first.
    let header: HTMLElement | null = null;
    await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];
      header = btns.find((b) => /Halvorsen/.test(b.textContent || "")) || null;
      expect(header).toBeTruthy();
    });
    fireEvent.click(header!);
    // Now find the blend row whose text is "Duskfall" and tap it.
    let row: HTMLElement | null = null;
    await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];
      row = btns.find((b) => /^Duskfall/.test((b.textContent || "").trim())) || null;
      expect(row).toBeTruthy();
    });
    fireEvent.click(row!);
  }

  it("calls addWish with a {name, brand} payload and expands the brand group", async () => {
    await primeDb();
    const addWish = vi.fn();
    const setCollapsedWishGroups = vi.fn();
    const { container, findByText } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [], sessions: [] },
      BT, BW, addWish, addTobacco: vi.fn(), nav: vi.fn(),
      setStatusFilter: vi.fn(), setCollapsedWishGroups, setCollapsedTobGroups: vi.fn(),
      lang: "fr", t: (k: string) => k, xl: (v: any) => v,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    await openDuskfallFiche(container);
    // Fiche modal → "add to wishlist" action (label key catalog_add_wish_btn).
    // This adds DIRECTLY — there is no review modal / btn_save step.
    const wishBtn = await findByText(/catalog_add_wish_btn/);
    fireEvent.click(wishBtn);

    expect(addWish).toHaveBeenCalledTimes(1);
    const payload = addWish.mock.calls[0]![0];
    expect(payload.name).toBe("Duskfall");
    expect(payload.brand).toBe("Halvorsen");
    // The brand group is expanded so the item is visible in the wishlist.
    expect(setCollapsedWishGroups).toHaveBeenCalledTimes(1);
    const updater = setCollapsedWishGroups.mock.calls[0]![0];
    expect(updater({})).toEqual({ Halvorsen: false });
  });

  it("calls addTobacco with a {name, brand} payload and expands the brand group", async () => {
    await primeDb();
    const addTobacco = vi.fn();
    const setCollapsedTobGroups = vi.fn();
    const { container, findByText } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [], sessions: [] },
      BT, BW, addWish: vi.fn(), addTobacco, nav: vi.fn(),
      setStatusFilter: vi.fn(), setCollapsedWishGroups: vi.fn(), setCollapsedTobGroups,
      lang: "fr", t: (k: string) => k, xl: (v: any) => v,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    await openDuskfallFiche(container);
    // Fiche modal → "add to inventory" action (label key catalog_add_btn).
    // direct add — no review modal / btn_save step.
    const invBtn = await findByText(/catalog_add_btn/);
    fireEvent.click(invBtn);

    expect(addTobacco).toHaveBeenCalledTimes(1);
    const payload = addTobacco.mock.calls[0]![0];
    expect(payload.name).toBe("Duskfall");
    expect(payload.brand).toBe("Halvorsen");
    expect(setCollapsedTobGroups).toHaveBeenCalledTimes(1);
    const updater = setCollapsedTobGroups.mock.calls[0]![0];
    expect(updater({})).toEqual({ Halvorsen: false });
  });

  it("resets the catalog to a blank state (clears the search) after an add", async () => {
    await primeDb();
    const { container, findByText } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [], sessions: [] },
      BT, BW, addWish: vi.fn(), addTobacco: vi.fn(), nav: vi.fn(),
      setStatusFilter: vi.fn(), setCollapsedWishGroups: vi.fn(), setCollapsedTobGroups: vi.fn(),
      lang: "fr", t: (k: string) => k, xl: (v: any) => v,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    await openDuskfallFiche(container);
    // Search is active before the add.
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(searchInput.value).toBe("Halvorsen Duskfall");
    const wishBtn = await findByText(/catalog_add_wish_btn/);
    fireEvent.click(wishBtn);
    // After the add, the search field is cleared — the catalog is fresh again.
    await waitFor(() => {
      const si = container.querySelector('input[type="search"]') as HTMLInputElement;
      expect(si.value).toBe("");
    });
  });
});

// REVERSAL, recorded here rather than by deleting the block.
// An earlier release added a "Vous pourriez aimer" section scoring the catalogue
// against the taste profile, and these two cases pinned it: one asserted it
// APPEARED for a user with a favourite family, the other that it stayed away
// otherwise. The user asked for the feature to be removed, so the first case
// was pinning behaviour that must no longer exist and the second passes now
// for a stronger reason than it used to. One case replaces both: the section
// must be absent whatever the cellar contains, which is exactly the fixture
// the OLD first case used to make it appear.
//
// THE TWO ASSERTIONS THIS CASE USED TO CARRY COULD NOT FAIL. `catalog_reco_title`
// exists in NO dictionary and "Vous pourriez aimer" survives only inside a
// comment in CatalogView.tsx — so the case pinned the SPELLING of a deleted
// feature, and a recommendations section re-introduced under any other key
// would have passed. They are kept below as documentation of the old name,
// explicitly as the weak half; what carries the guarantee now is STRUCTURAL.
//
// The removed section printed six blend rows ABOVE the list. Two shapes lock
// that out whatever it is called:
//   · grouped-collapsed (the page's default state) renders NOT ONE blend row —
//     every blend is behind its brand group header;
//   · ungrouped, the page renders EXACTLY `totalShown` blend rows — the number
//     the count line advertises — so extra rows cannot hide in the flat branch
//     either.
describe("CatalogView — the recommendations section is gone", () => {
  it("never renders a 'Vous pourriez aimer' section, even for a cellar that used to trigger it", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      // A highly-rated Virginia — the exact shape that produced a favourite
      // family and six recommendation rows.
      data: {
        tobaccos: [{ id: 1, brand: "Zzz", name: "NotInCatalogueXYZ", category: "Virginia", rating: 5, force: 2, taste: 3, lots: [] }],
        wishlist: [], sessions: [],
      },
      BT, BW, addTobacco: vi.fn(), addWish: vi.fn(), nav: vi.fn(),
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });

    // Every blend NAME the loaded catalogue can print. A row is a
    // `[role=button]` carrying one of them; a brand group HEADER carries the
    // brand's display name and, being a sibling of the rows rather than their
    // ancestor, never one of these.
    const blendNames = Object.values(loadCatalogueFixture().blends)
      .map((b: any) => String(b.name)).filter(Boolean);
    expect(blendNames.length, "the fixture catalogue is empty").toBeGreaterThan(20);
    const blendRows = () => Array.from(container.querySelectorAll('[role="button"]'))
      .filter((el) => blendNames.some((n) => (el.textContent || "").includes(n)));

    // (1) Default state — grouped, every group collapsed. Nothing may print a
    // blend row here; the recommendations section did exactly that.
    expect(blendRows().length,
      "a blend row is rendered outside the collapsed brand groups").toBe(0);

    // (2) Flat state — the rows are exactly the results the count line claims.
    const ungroup = Array.from(container.querySelectorAll('[role="button"], button'))
      .find((b) => /aria_group_by_brand/.test(b.getAttribute("aria-label") || ""));
    expect(ungroup, "no group-by-brand toggle on the catalogue page").toBeTruthy();
    fireEvent.click(ungroup!);
    await waitFor(() => expect(blendRows().length).toBeGreaterThan(0));
    const m = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
    expect(m).toBeTruthy();
    expect(blendRows().length,
      "the page renders more blend rows than the count line advertises")
      .toBe(Number(m![1]));

    // The weak half, kept only as a record of what the section used to be
    // called. Neither string exists anywhere in production, so on its own this
    // pair asserts nothing — see the note above.
    expect(container.textContent || "").not.toContain("catalog_reco_title");
    expect(container.textContent || "").not.toContain("Vous pourriez aimer");
  });
});

/**
 * agingMax is DISPLAYED from the family, never COPIED into the cellar
 *.
 *
 * 1205 of the 1222 catalogue rows carried an agingMax exactly equal to their
 * family's constant — so a column presented as per-blend knowledge was, 98% of
 * the time, `FAMILY_AGING_MAX` restated. That alone would be cosmetic. What
 * made it worth changing is that QuickAdd COPIED it into the user's tobacco,
 * turning a constant the app re-derives (`effectiveAgingMax`) into a frozen
 * per-blend value — and that table was last revised, which is
 * exactly the event a frozen copy stops tracking.
 *
 * Both halves are pinned here because fixing one and dropping the other is the
 * plausible regression: the fiche must still SHOW the age (nothing changed on
 * screen), and the cellar must NOT receive it.
 */
/**
 * The alias line is WIRED, and it sits under the title.
 *
 * `displayAliases` decides WHICH aliases show (its own suite covers that); what
 * can only be asserted here is that the fiche calls it at all, renders through
 * `t()` rather than a hardcoded French label, and places the line where the
 * question arises — directly under the name, because it is identity, not a
 * spec. Position is asserted on source order for the same reason the
 * CatalogOffer placement is: presence alone would pass from anywhere on the
 * fiche, including below the description where nobody scrolls.
 */
describe("catalogue fiche — the alias line", () => {
  const rd = (f: string) => require("node:fs").readFileSync(f, "utf8");
  const src = rd("src/views/curator/CatalogView.tsx")
    // Comments explain the feature and would satisfy every assertion below —
    // the trap this repo has been caught by three times.
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("calls displayAliases rather than printing entry.aliases raw", () => {
    expect(src).toContain("displayAliases(entry, brandDisplay)");
    expect(src, "the raw list must never reach the fiche").not.toMatch(/entry\.aliases\.join/);
  });

  it("labels the line through t(), so it exists in every language", () => {
    expect(src).toContain('t("catalog_aliases")');
    for (const lang of ["fr", "en", "es", "de", "it", "pt"]) {
      const dict = rd(`src/i18n/${lang}.ts`);
      expect(dict, `${lang} must carry catalog_aliases`).toMatch(/catalog_aliases:"[^"]+"/);
    }
  });

  it("renders the line BETWEEN the blend name and the category row", () => {
    // Scoped to CatalogDetailContent: `catColor(entry.category)` also appears
    // in BlendRow further up the file, and an unscoped indexOf compared the
    // fiche's alias line against the LIST's category chip — which passes or
    // fails on where the two components happen to sit, not on the layout.
    const fiche = src.slice(src.indexOf("function CatalogDetailContent"));
    expect(fiche.length, "CatalogDetailContent must be findable").toBeGreaterThan(500);
    const name = fiche.indexOf("{entry.name}");
    const alias = fiche.indexOf("aliasNames.length > 0");
    const cat = fiche.indexOf("catColor(entry.category)");
    expect(name, "the title must be findable").toBeGreaterThan(-1);
    expect(cat, "the category row must be findable").toBeGreaterThan(-1);
    expect(alias).toBeGreaterThan(name);
    expect(alias).toBeLessThan(cat);
  });

  it("scrolls INSIDE the modal — capHeight + a contained scroll region", () => {
    // Reported from the installed iOS PWA: swiping on the fiche
    // moved the catalogue page underneath instead of the fiche.
    //
    // MEASURED at 390x844 with the full catalogue behind: the fiche's own
    // scroll range was 125 px against a 5261 px page, and `overscroll-behavior`
    // was `auto` on the actual scroll port — so a swipe that outran 125 px
    // chained straight out. The backdrop does carry `contain`, but it is not a
    // scroll port in this layout, and containment applies to scroll ports.
    //
    // The three other tall modals were moved to this shape for the
    // same report; this was the last one left on `maxHeight: "85vh"`, which is
    // additionally a guess that ignores the backdrop's own padding.
    // Sliced, not regexed across the tag: the opening tag contains an arrow
    // function, so a `[^>]*` pattern stops at the `=>` and never reaches the
    // props after it — which is how the first version of this assertion failed
    // against correct code.
    const ficheModal = src.slice(0, src.indexOf('t("catalog_fiche_aria")'));
    const openTag = ficheModal.slice(ficheModal.lastIndexOf("<Modal"));
    expect(openTag, "the fiche Modal must cap its own height").toContain("capHeight");
    const fiche = src.slice(src.indexOf("function CatalogDetailContent"));
    expect(fiche).toContain('overscrollBehavior: "contain"');
    expect(fiche, "flex:1 + minHeight:0 give the region the leftover height").toMatch(/flex:\s*1,\s*minHeight:\s*0/);
    expect(fiche, "a vh guess cannot know the backdrop's padding").not.toMatch(/maxHeight:\s*"\d+vh"/);
  });

  it("renders nothing at all when there is no alias worth showing", () => {
    // Guarded by length, not by a truthy array: an empty array is truthy, and
    // the label alone would be worse than no line.
    expect(src).toMatch(/aliasNames\.length\s*>\s*0\s*&&/);
  });
});

describe("catalogue agingMax — shown, not stored", () => {
  it("keeps only genuinely per-blend values in the data", async () => {
    const db = await loadTobaccoDb();
    const all = Object.values(db!.blends);
    const stored = all.filter((e: any) => String(e.agingMax || "").trim());

    // THE RULE: a stored value is allowed ONLY on a category that has no family
    // constant, because `effectiveAgingMax` derives the rest and QuickAdd copies
    // a stored value into the user's cellar, where it freezes a number the
    // constant goes on revising.
    for (const e of stored as any[]) {
      expect(FAMILY_AGING_MAX[e.category], `${e.name} [${e.category}] duplicates its family constant`).toBeUndefined();
    }

    // REVERSED: this used to be `expect(stored.length)
    // .toBeGreaterThan(0)`, a non-vacuity guard that quietly asserted the
    // catalogue still held an UNCLASSIFIABLE row. `Autre` is the only category
    // without a family constant, and the day it reached zero rows — the goal
    // the whole `unclassified-mono-leaf` check was written to reach — this went
    // red on the catalogue being CORRECT. Zero stored values is the ideal
    // outcome of the rule above, not a failure of it.
    //
    // Vacuity is still guarded, by the two things that would actually make the
    // loop meaningless: an empty dataset, and a category the family table does
    // not cover (which is what would let a real duplicate slip past
    // `toBeUndefined()` for the wrong reason).
    expect(all.length, "a failed catalogue load would make the loop vacuous").toBeGreaterThan(20);
    const uncovered = [...new Set(all.map((e: any) => String(e.category)))]
      .filter((c) => FAMILY_AGING_MAX[c] === undefined);
    expect(uncovered, "every category present must have a family constant, or `Autre` is back").toEqual([]);
  });

  it("still resolves an age for a family-default blend, so the fiche is unchanged", async () => {
    const db = await loadTobaccoDb();
    // The row moved from `clan|aromatic (original)` to a blend in
    // the fixture excerpt. Same shape and same point: an Aromatique with NO
    // stored age, so the family default is what resolves it.
    const clan: any = db!.blends["ravensmoor|hedgerow"];
    expect(clan.agingMax).toBe("");                       // nothing stored…
    expect(FAMILY_AGING_MAX[clan.category]).toBe("3");    // …but the fiche shows 3
  });

  it("hands the cellar an EMPTY agingMax, so effectiveAgingMax stays dynamic", async () => {
    // The QuickAdd copy is `agingMax: e.agingMax || ""`. With the constant no
    // longer stored, the user's tobacco carries "" and the family default is
    // re-derived at read time — including after a future revision of the table.
    const db = await loadTobaccoDb();
    const clan: any = db!.blends["ravensmoor|hedgerow"];
    const copied = clan.agingMax || "";
    expect(copied).toBe("");
    expect(effectiveAgingMax({ agingMax: copied, category: clan.category })).toBe("3");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The bulk catalogue pass moved OUT of Settings → Données and into this page's
// TopBar. Two things are worth locking: that the trigger is here and reaches
// `startCatalogueApply`, and — the part a source grep would miss — that it is
// NOT on the loading / failed TopBar, since you cannot apply a catalogue that
// never loaded.
describe("CatalogView — the catalogue-apply action lives in the header", () => {
  const findApply = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => /cat_apply_btn|Appliquer les données du catalogue/.test(b.getAttribute("aria-label") || ""));

  it("offers the action in the TopBar and calls startCatalogueApply", async () => {
    await primeDb();
    const startCatalogueApply = vi.fn();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(), addWish: vi.fn(), nav: vi.fn(),
      startCatalogueApply,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+/);
    });
    const btn = findApply(container);
    expect(btn, "the apply action must be reachable from the catalogue header").toBeTruthy();
    fireEvent.click(btn!);
    expect(startCatalogueApply).toHaveBeenCalledTimes(1);
  });

  it("is an icon button with an accessible NAME, not a bare glyph", () => {
    // Icon-only is acceptable here only because the confirm modal explains
    // everything before a field is written — but a screen reader still has to
    // be told what the control does.
    const src = require("node:fs")
      .readFileSync(require("node:path").resolve(__dirname, "../../views/curator/CatalogView.tsx"), "utf8");
    expect(src).toMatch(/ariaLabel=\{t \? t\("cat_apply_btn"\)/);
  });

  it("is absent before the catalogue is in memory", async () => {
    // The pre-load branch renders its OWN TopBar — the same one the load-FAILURE
    // state uses — and the action is deliberately not on it: applying a
    // catalogue that is not in memory would plan against nothing. This case
    // exercises the loading state, which is that shared TopBar.
    _resetTobaccoDbForTests();
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW,
      addTobacco: vi.fn(), addWish: vi.fn(), nav: vi.fn(),
      startCatalogueApply: vi.fn(),
    });
    // Before the db resolves, the shell is the loading TopBar — no action.
    expect(findApply(container)).toBeFalsy();
  });

  it("no longer sits in the Settings data actions", () => {
    // Two entry points for one whole-cellar action is how it ended up in the
    // row above "Effacer toutes les données".
    const src = require("node:fs")
      .readFileSync(require("node:path").resolve(__dirname, "../../views/curator/SettingsModal.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toContain("startCatalogueApply");
    expect(src).not.toContain("cat_apply_btn");
  });
});

// The comparison needs a LABELLED way in.
//
// Reported twice by someone looking straight at it: « la comparaison entre deux
// blends du catalogue pas en stock c'est pas possible », then « comment
// comparer… ? ». Measured cause: the catalogue TopBar carries FOUR unlabelled
// 44 px buttons, two of them side by side on the right, and a bar-chart glyph
// does not say "compare". The argument for an icon-only trigger is
// about SAFETY (the tap opens a confirm, it writes nothing) — a different
// question from findability.
describe("CatalogView — the comparison is reachable by name", () => {
  const open = async () => {
    await primeDb();
    const r = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [] },
      BT, BW, addTobacco: vi.fn(), addWish: vi.fn(), nav: vi.fn(),
    });
    // The view paints a loading shell first; wait for the real page.
    await waitFor(() => {
      expect(r.container.innerHTML).toMatch(/catalog_search_ph|Marque, blend/);
    });
    return r;
  };

  it("offers a named control in the page body, not only an icon", async () => {
    const { container } = await open();
    const named = Array.from(container.querySelectorAll("[role='button']"))
      .filter((b) => /cmp_title|Comparer des blends/.test(b.textContent || ""));
    expect(named.length, "a control whose VISIBLE text names the feature").toBeGreaterThan(0);
  });

  it("sits above the search field, so it is seen without scrolling a 1220-row list", async () => {
    // Position is the whole point — at the bottom of the list it would be
    // unreachable in practice.
    // Compare the NODES, not the raw HTML: an indexOf on the markup is also
    // satisfied by the TopBar icon's aria-label, which sits before the search
    // either way — PROBED, and removing the button left that version green.
    const { container } = await open();
    const named = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_title|Comparer des blends/.test(b.textContent || ""))!;
    const search = container.querySelector("input[type='search']")!;
    expect(named).toBeTruthy();
    expect(search).toBeTruthy();
    const precedes = !!(named.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes, "the compare row must precede the search input").toBe(true);
  });

  it("opens the comparison with an EMPTY picker, seeding nothing", async () => {
    // Reached from the page rather than from a blend, so no column is implied.
    const { container } = await open();
    const btn = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /cmp_title|Comparer des blends/.test(b.textContent || ""))!;
    fireEvent.click(btn);
    expect(container.textContent).toMatch(/cmp_pick_two|Choisissez au moins deux/);
  });

  it("keeps the TopBar icon as well — two ways in, and it is read-only", async () => {
    // Unlike the catalogue-APPLY action (one entry point, because it
    // rewrites the whole cellar), a comparison writes nothing, so a second door
    // costs nothing.
    const { container } = await open();
    const icon = Array.from(container.querySelectorAll("[role='button'],button"))
      .find((b) => /cmp_title|Comparer des blends/.test(b.getAttribute("aria-label") || ""));
    expect(icon, "the TopBar chart icon must survive").toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe("addFromCatalog is a writer too", () => {
  // An earlier release stopped THREE writers copying a catalogue value the cellar
  // cannot represent (`planCatalogueApply`, `useDbSync`, `applyDbHit`). This
  // button was the fourth, and it is the most direct of the four: one tap and
  // the row is in the cellar, where an unrepresentable cut has no
  // `CUT_DENSITY` for the bowl-weight estimate, no `xl()` translation, no
  // `FAMILY_AGING_MAX`, and no matching option in the form's fixed dropdown —
  // so the first save silently rewrites it.
  const HEAD = "brand_key,brand_name,blend_name,category,cut,force,roomNote,taste,blend";
  const BAD = [HEAD,
    "Weird,Weird,Thing,Pipeweed,Zigzag Cut,3,2,3,Virginia and Perique",
  ].join("\n") + "\n";
  const GOOD = [HEAD,
    "Weird,Weird,Thing,Anglais,Ribbon,3,2,3,Virginia and Perique",
  ].join("\n") + "\n";

  async function addFirstBlend(csvText: string, addTobacco: any) {
    useCatalogueCsv(csvText);
    await primeDb();
    const { container, findByText } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog",
      data: { tobaccos: [], wishlist: [], sessions: [] },
      BT, BW, addWish: vi.fn(), addTobacco, nav: vi.fn(),
      setStatusFilter: vi.fn(), setCollapsedWishGroups: vi.fn(), setCollapsedTobGroups: vi.fn(),
      lang: "fr", t: (k: string) => k, xl: (v: any) => v,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });
    let header: HTMLElement | null = null;
    await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];
      header = btns.find((b) => /Weird/.test(b.textContent || "")) || null;
      expect(header).toBeTruthy();
    });
    fireEvent.click(header!);
    let rowEl: HTMLElement | null = null;
    await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];
      rowEl = btns.find((b) => /Thing/.test(b.textContent || "")) || null;
      expect(rowEl).toBeTruthy();
    });
    fireEvent.click(rowEl!);
    fireEvent.click(await findByText(/catalog_add_btn/));
    expect(addTobacco).toHaveBeenCalledTimes(1);
    return addTobacco.mock.calls[0]![0];
  }

  it("THE POINT: an unrepresentable category/cut is NOT written to the cellar", async () => {
    const payload = await addFirstBlend(BAD, vi.fn());
    // Empty, not "Autre": this is a CREATION, so there is no personal value to
    // protect and the catch-all on a blank field adds nothing (the
    // reasoning, applied to a fresh row).
    expect(payload.category, "category").toBe("");
    expect(payload.cut, "cut").toBe("");
    // …and the fields the catalogue CAN answer still come across, or the fix
    // would have thrown the baby out.
    expect(payload.name).toBe("Thing");
    expect(payload.blend).toBe("Virginia and Perique");
    expect(payload.force).toBe(3);
  });

  it("a representable one is still copied — the guard is not a blanket refusal", async () => {
    const payload = await addFirstBlend(GOOD, vi.fn());
    expect(payload.category).toBe("Anglais");
    expect(payload.cut).toBe("Ribbon");
  });

  it("a mapped trade label is canonicalised, not dropped", async () => {
    // `Navy Cut` is in CUT_MAP → Flake. The import contract must survive the
    // guard, or a legitimate catalogue would start losing its cuts.
    const csvText = [HEAD, "Weird,Weird,Thing,Anglais,Navy Cut,3,2,3,Virginia"].join("\n") + "\n";
    const payload = await addFirstBlend(csvText, vi.fn());
    expect(payload.cut).toBe("Flake");
  });
});

describe("the page must not outlive the catalogue", () => {
  it("a catalogue that has been removed stops being browsable", async () => {
    // The missing-catalogue screen is gated on `!db`, so leaving the stale
    // object there meant that after « Retirer le catalogue » the page went on
    // rendering — and still ADDING from — a catalogue the user had deleted.
    await primeDb();
    const props: any = {
      view: "catalog",
      data: { tobaccos: [], wishlist: [], sessions: [] },
      BT, BW, addWish: vi.fn(), addTobacco: vi.fn(), nav: vi.fn(),
      setStatusFilter: vi.fn(), setCollapsedWishGroups: vi.fn(), setCollapsedTobGroups: vi.fn(),
      lang: "fr", t: (k: string) => k, xl: (v: any) => v,
      catalogueMeta: { name: "c.csv", loadedAt: 1, blends: 28 },
    };
    const { container, rerender } = renderWithCtx(<CuratorCatalogView />, props);
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
    });

    // The user removes it from Settings: the store empties and `catalogueMeta`
    // becomes null. Settings is a MODAL over this view, so without that dep
    // nothing here would re-run.
    emptyCatalogueFixture();
    _resetTobaccoDbForTests();
    // Re-render through the Provider by hand: RTL's `rerender` replaces the
    // whole tree, so passing a bare view would drop the ctx and the component
    // would return null for the wrong reason.
    rerender(
      <AppCtx.Provider value={{ ...props, catalogueMeta: null } as any}>
        <CuratorCatalogView />
      </AppCtx.Provider>,
    );

    await waitFor(() => {
      expect(container.textContent || "", "the missing-catalogue screen").toMatch(/cat_missing/i);
    });
    expect(container.textContent || "", "no results line").not.toMatch(/\d+\/\d+\s+catalog_results/i);
  });
});
