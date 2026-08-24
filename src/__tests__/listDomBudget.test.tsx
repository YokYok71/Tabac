// A LIST VIEW RENDERS O(1) ROWS, NOT O(N).
//
// This is the gate the repo did not have. `size:check` bounds the bundle,
// `theme:contrast` bounds contrast, `i18n:layout` bounds overflow, and
// Lighthouse runs against an EMPTY cellar — so nothing measured the DOM, and
// three screens sat THIRTEEN SECONDS from any user with all seven gates green:
//
//   journal, FLAT     185 654 nodes  149 MB    670 455 px   13.3 s
//   catalogue, FLAT   200 613 nodes   93 MB  1 220 601 px   13.2 s
//   inventory, FLAT    21 757 nodes   35 MB     70 298 px    2.5 s
//
// CLAUDE.md already carries the lesson twice — *the seed is a screen GATE, and
// a green run over an empty state is the most reassuring way to miss a screen*.
// This is the same thing one size up: **a green run over a SMALL cellar is the
// most reassuring way to miss a freeze.** The two browser checks share a
// 40-tobacco seed, so neither could ever have seen this.
//
// WHY jsdom AND NOT A THIRD OPT-IN BROWSER CHECK. jsdom does not lay out, but
// it DOES build the DOM, which is the thing that regressed — and it runs on
// every commit. An opt-in check goes unrun: `prune` was red for nine releases
// while this very file asserted a clean baseline. Cost is asymmetric in the
// right direction too: when the cap holds the render is ~60 rows and the case
// is fast; when it breaks the case renders thousands, is slow, AND fails.
//
// WHAT IS ASSERTED IS THE SHAPE, NOT A NUMBER. Each view is rendered twice, at
// a small N and a large one, and the DOM must not grow with N. A node BUDGET
// would be a magic number to re-tune every time a card gains a chip; "doubling
// the data must not double the DOM" is the property itself, and it cannot be
// satisfied by tuning. The companion assertion is the one that stops it passing
// vacuously: the small render must actually contain rows.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { renderWithCtx } from "./viewTestUtils";
// Aliased on import, and not suppressed with a disable comment:
// `useCatalogueCsv` is a plain fixture setter whose NAME makes
// `react-hooks/rules-of-hooks` read it as a hook called from a non-hook. The
// alias removes the false positive without switching a rule off, and the call
// site then says what it does — it installs a catalogue, it is not a hook.
import { loadCatalogueFixture, resetCatalogueFixture, useCatalogueCsv as installCatalogueCsv } from "./catalogueFixture";
import { PROGRESSIVE_STEP } from "../hooks/useProgressiveList";

vi.mock("../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

import { CuratorJournalView } from "../views/curator/JournalView";
import { CuratorInventoryListView } from "../views/curator/InventoryListView";
import { CuratorPipesListView } from "../views/curator/PipesListView";
import { CuratorAccListView } from "../views/curator/AccListView";
import { CuratorCatalogView } from "../views/curator/CatalogView";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../utils/tobaccoDb";
import { BT, BW } from "../constants";

// Small vs large. The GAP is what matters, not either figure: if the view is
// bounded the two renders are the same size, and if it is not the second is
// twenty times the first.
//
// BOTH MUST SIT ABOVE `PROGRESSIVE_STEP`, and the first version did not — with
// SMALL below the cap the small render showed 40 rows and the large one showed
// the full 60, so every case failed on a 743-node gap that was the guard
// WORKING. Asserted below rather than left as a comment, because a fixture that
// silently slips under the cap again turns this whole file into noise.
const SMALL = PROGRESSIVE_STEP + 40;
const LARGE = PROGRESSIVE_STEP * 20;

// How much chrome may legitimately differ between the two renders — a count in
// a header, the « Afficher la suite (N) » footer, a filter chip that only
// appears once a value is present. Generous on purpose: the defect it catches
// is a factor of twenty, not a handful of nodes.
const CHROME_SLACK = 60;

function nodes(container: HTMLElement): number {
  return container.getElementsByTagName("*").length;
}

function tobaccos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, uid: "t" + i, name: "Blend " + i, brand: "Brand " + (i % 7),
    category: "Virginia", cut: "Flake", force: 3, roomNote: 2, taste: 3, rating: 4,
    rebuy: null, tastingNotes: "", description: "", imageUrl: "", agingMax: "", lots: [],
  }));
}
function pipes(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, uid: "p" + i, name: "Pipe " + i, brand: "Maker " + (i % 7),
    shape: "Billiard", courbure: "Droite", filterType: "9mm", bowlMaterial: "Bruyère",
    stemMaterial: "Ébonite", finish: "Lisse", imageUrl: "", photos: [], rating: 4,
    status: "active", maintenance: [],
  }));
}
function accessories(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, uid: "a" + i, name: "Acc " + i, brand: "Maker " + (i % 7),
    type: "Briquet", fuel: "Gaz", imageUrl: "", rating: 4, status: "active", notes: "",
  }));
}
function sessions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, date: "2026-08-24", time: "18:00", tobaccoId: 1, pipeId: 1,
    duration: 45, rating: 4, notes: "n" + i, weightG: "0", lotId: "", aromas: [],
  }));
}

function cellar(over: Record<string, any>) {
  return Object.assign(
    { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    over,
  );
}

// Each entry renders its view in its FLAT state — the one that was unbounded.
// `sessGrouped` / `tobGrouped` / `pipesGrouped` / `accsGrouped` false is exactly
// what « Listes groupées par défaut » OFF gives, and what the two grouping
// toggles give on a tap.
const VIEWS: Array<{
  what: string;
  render: (n: number) => HTMLElement;
}> = [
  {
    what: "journal (flat)",
    render: (n) => renderWithCtx(<CuratorJournalView />, {
      view: "journal", sessGrouped: false,
      data: cellar({ sessions: sessions(n), tobaccos: tobaccos(1), pipes: pipes(1) }),
    }).container,
  },
  {
    what: "inventory (flat)",
    render: (n) => renderWithCtx(<CuratorInventoryListView />, {
      view: "inv", tobGrouped: false, statusFilter: "all",
      data: cellar({ tobaccos: tobaccos(n) }), filtered: tobaccos(n), BT, BW,
    }).container,
  },
  {
    what: "wishlist (flat)",
    render: (n) => renderWithCtx(<CuratorInventoryListView />, {
      view: "inv", wishGrouped: false, statusFilter: "wish",
      data: cellar({ wishlist: tobaccos(n) }), BT, BW,
    }).container,
  },
  {
    what: "pipes (flat)",
    render: (n) => renderWithCtx(<CuratorPipesListView />, {
      view: "pipes", pipesGrouped: false,
      data: cellar({ pipes: pipes(n) }), filteredPipes: pipes(n),
    }).container,
  },
  {
    what: "accessories (flat)",
    render: (n) => renderWithCtx(<CuratorAccListView />, {
      view: "acc", accsGrouped: false,
      data: cellar({ accessories: accessories(n) }),
    }).container,
  },
];

describe("a flat list view does not grow with the collection", () => {
  it("both fixture sizes sit above the cap, or the comparison is meaningless", () => {
    expect(SMALL).toBeGreaterThan(PROGRESSIVE_STEP);
    expect(LARGE).toBeGreaterThan(SMALL * 4);
  });

  for (const v of VIEWS) {
    it(`${v.what}`, () => {
      const small = nodes(v.render(SMALL));
      const large = nodes(v.render(LARGE));
      // Non-vacuity FIRST: a view that rendered nothing at all would satisfy
      // the growth assertion perfectly.
      expect(small, `${v.what} rendered no rows — the fixture is not reaching it`)
        .toBeGreaterThan(200);
      expect(large - small,
        `${v.what} grows with the collection: ${small} nodes at ${SMALL} rows, `
        + `${large} at ${LARGE}. A flat list must render a bounded prefix `
        + `(useProgressiveList), or a large cellar freezes the main thread.`)
        .toBeLessThanOrEqual(CHROME_SLACK);
    });
  }
});

describe("the catalogue, which was the worst of them", () => {
  beforeEach(() => { resetCatalogueFixture(); _resetTobaccoDbForTests(); });

  function catalogueCsv(rows: number): string {
    const out = ["brand_key,brand_name,blend_name,category,cut,composition,strength,room_note,taste,aging_max,description_fr,description_en"];
    for (let i = 1; i <= rows; i++) {
      out.push([`brand${i % 9}`, `Brand ${i % 9}`, `Blend ${i}`, "Virginia", "Flake",
        "Virginia", "3", "2", "3", "10", "fr " + i, "en " + i].join(","));
    }
    return out.join("\n");
  }

  async function renderCatalogue(rows: number): Promise<HTMLElement> {
    resetCatalogueFixture();
    _resetTobaccoDbForTests();
    installCatalogueCsv(catalogueCsv(rows));
    await loadTobaccoDb();
    // `grouped` is local state defaulting to true, so the FLAT branch is reached
    // by tapping the view's own toggle — the same gesture that produced the
    // 200 613-node measurement.
    let container!: HTMLElement;
    await act(async () => {
      container = renderWithCtx(<CuratorCatalogView />, {
        view: "catalog", data: cellar({}), BT, BW,
        addTobacco: vi.fn(), addWish: vi.fn(),
      }).container;
    });
    const toggle = container.querySelector('[aria-label="aria_group_by_brand"]');
    expect(toggle, "the grouping toggle moved — the flat branch is not being measured")
      .toBeTruthy();
    await act(async () => { (toggle as HTMLElement).click(); });
    return container;
  }

  it("renders a bounded prefix in its flat mode", async () => {
    const small = nodes(await renderCatalogue(SMALL));
    const large = nodes(await renderCatalogue(LARGE));
    expect(small, "the catalogue fixture is not reaching the list")
      .toBeGreaterThan(100);
    expect(large - small,
      `the catalogue grows with the file: ${small} nodes at ${SMALL} blends, `
      + `${large} at ${LARGE}. MEASURED unbounded at 20 000 blends: 200 613 `
      + `nodes and 13.2 s of frozen main thread.`)
      .toBeLessThanOrEqual(CHROME_SLACK);
  });
});

describe("the guard is not vacuous", () => {
  it("a deliberately unbounded list IS caught", () => {
    // The control for the whole file. If `CHROME_SLACK` were ever widened past
    // the point of usefulness, or the node count read the wrong container, this
    // is what would notice — it renders the same rows with no cap and asserts
    // the growth the assertions above forbid.
    function Unbounded({ n }: { n: number }) {
      return <div>{Array.from({ length: n }, (_, i) => <div key={i}><span>{i}</span></div>)}</div>;
    }
    const small = nodes(renderWithCtx(<Unbounded n={SMALL} />).container);
    const large = nodes(renderWithCtx(<Unbounded n={LARGE} />).container);
    expect(large - small).toBeGreaterThan(CHROME_SLACK);
  });
});
