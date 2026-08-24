// THE CATALOGUE FILTER RAN ON EVERY KEYSTROKE, OVER THE WHOLE CATALOGUE.
//
// MEASURED on this machine, running the real `tobaccoDbSearchMatch` over a
// synthetic catalogue: **6–13 ms per keystroke at 1 594 rows and 66–148 ms at
// 20 000** (`MAX_CATALOGUE_ROWS`), the cost rising with the query length
// because a longer token falls through to the Levenshtein fallback. A phone is
// several times slower again. Typing "capstan blue" is twelve of those, one per
// character, each one blocking the keystroke that follows.
//
// The fix is a debounce, and the two rules it has to respect are what this file
// locks — a debounce that gets either wrong is worse than the cost it saves:
//
//   (1) THE INPUT IS NEVER DEBOUNCED. `search` stays the controlled value of
//       the field and updates on every keystroke; only the QUERY the filter
//       reads lags behind. Debouncing the input itself is the prefill-race
//       trap CLAUDE.md records — the field snaps back under the user's fingers.
//
//   (2) AN EMPTY QUERY APPLIES AT ONCE. Clearing the field is a "show me
//       everything" gesture, and the empty branch does zero matching work
//       (`sq` empty short-circuits before `tobaccoDbSearchMatch`), so there is
//       nothing to save by delaying it — only a list that looks stuck.
//
// The seed handed over by the global SearchModal is applied immediately too:
// that page's contract is that it "opens pre-filtered on the query".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { loadCatalogueFixture, resetCatalogueFixture } from "../catalogueFixture";

vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));

// Count the QUERIES the filter actually runs, not the rows it walks: one
// distinct query per debounce window is the whole claim.
const QUERIES: string[] = [];
vi.mock("../../utils/tobaccoDb.ts", async () => {
  const real: any = await vi.importActual("../../utils/tobaccoDb.ts");
  return {
    ...real,
    tobaccoDbSearchMatch: (k: string, e: any, q: string) => {
      QUERIES.push(q);
      return real.tobaccoDbSearchMatch(k, e, q);
    },
  };
});

import { CuratorCatalogView } from "../../views/curator/CatalogView";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../../utils/tobaccoDb";
import { BT, BW } from "../../constants";
import { CATALOG_SEARCH_DEBOUNCE_MS } from "../../views/curator/CatalogView";

beforeEach(() => {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
  QUERIES.length = 0;
});

async function mount(extra: Record<string, any> = {}) {
  _resetTobaccoDbForTests();
  await loadTobaccoDb();
  const r = renderWithCtx(<CuratorCatalogView />, {
    view: "catalog",
    data: { tobaccos: [], wishlist: [] },
    BT,
    BW,
    addTobacco: vi.fn(),
    addWish: vi.fn(),
    nav: vi.fn(),
    ...extra,
  });
  await waitFor(() => {
    expect(r.container.textContent || "").toMatch(/\d+\/\d+\s+(catalog_results|blends)/i);
  });
  return r;
}

function counts(container: HTMLElement) {
  const m = (container.textContent || "").match(/(\d+)\/(\d+)\s+(catalog_results|blends)/i);
  expect(m, "the count line must be on screen").toBeTruthy();
  return { shown: Number(m![1]), total: Number(m![2]) };
}

function field(container: HTMLElement) {
  const el = container.querySelector('input[type="search"]') as HTMLInputElement;
  expect(el).toBeTruthy();
  return el;
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("the catalogue filter is debounced, and the field is not", () => {
  it("a burst of keystrokes runs the filter for ONE query, not one per character", async () => {
    const { container } = await mount();
    QUERIES.length = 0;

    // Type "Corvan" one character at a time, faster than the window.
    for (const v of ["C", "Co", "Cor", "Corv", "Corva", "Corvan"]) {
      fireEvent.change(field(container), { target: { value: v } });
    }
    // Nothing has run yet — the burst was shorter than the window.
    expect(QUERIES).toEqual([]);

    await wait(CATALOG_SEARCH_DEBOUNCE_MS + 60);

    // Non-vacuity: it DID run, and only for the final query. Asserting the
    // absence alone would pass on a build that stopped filtering entirely.
    expect(QUERIES.length).toBeGreaterThan(0);
    expect(new Set(QUERIES)).toEqual(new Set(["Corvan"]));
    const { shown, total } = counts(container);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
  });

  it("the field itself is never debounced — every keystroke is on screen at once", async () => {
    // Debouncing the INPUT is the prefill-race trap: the value the user typed
    // must be the value the field shows, immediately and always.
    const { container } = await mount();
    fireEvent.change(field(container), { target: { value: "Cor" } });
    expect(field(container).value).toBe("Cor");
    fireEvent.change(field(container), { target: { value: "Corva" } });
    expect(field(container).value).toBe("Corva");
    await wait(CATALOG_SEARCH_DEBOUNCE_MS + 60);
    expect(field(container).value).toBe("Corva");
  });

  it("clearing the field restores the full list immediately, with no wait", async () => {
    const { container } = await mount();
    fireEvent.change(field(container), { target: { value: "Corvane" } });
    await wait(CATALOG_SEARCH_DEBOUNCE_MS + 60);
    expect(counts(container).shown).toBeLessThan(counts(container).total);

    QUERIES.length = 0;
    await act(async () => {
      fireEvent.change(field(container), { target: { value: "" } });
    });
    // No timer advanced: the full list is back on the very next render.
    const c = counts(container);
    expect(c.shown).toBe(c.total);
    // …and it cost no matching work at all.
    expect(QUERIES).toEqual([]);
  });

  it("an intermediate query superseded inside the window never reaches the list", async () => {
    // The empty state must not flash for a half-typed query the user was
    // already past. "zzzz" matches nothing in the fixture; "Corvane" does.
    const { container } = await mount();
    fireEvent.change(field(container), { target: { value: "zzzz" } });
    fireEvent.change(field(container), { target: { value: "Corvane" } });
    await wait(CATALOG_SEARCH_DEBOUNCE_MS + 60);

    expect(new Set(QUERIES)).toEqual(new Set(["Corvane"]));
    expect(container.textContent || "").not.toMatch(/catalog_no_match/);
    expect(counts(container).shown).toBeGreaterThan(0);
  });

  it("a seed handed over by the global search applies without waiting", async () => {
    // SearchModal's contract is that tapping a catalogue hit "opens
    // CatalogView pre-filtered on the query" — a delay there would show the
    // unfiltered catalogue first, which is what the seed exists to avoid.
    const setCatalogSeed = vi.fn();
    const { container } = await mount({ catalogSeed: "Corvane", setCatalogSeed });
    const c = counts(container);
    expect(c.shown).toBeGreaterThan(0);
    expect(c.shown).toBeLessThan(c.total);
    expect(field(container).value).toBe("Corvane");
  });
});
