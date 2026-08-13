// Smoke tests for src/views/curator/PipesListView.tsx.

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorPipesListView } from "../../views/curator/PipesListView";

describe("PipesListView — visibility", () => {
  it("returns null when view !== 'pipes'", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, { view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("returns null when pipeDet is set (detail view takes over)", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: { id: "1", brand: "X", name: "Y" },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state when no pipes exist", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [],
      data: { pipes: [], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toMatch(/Aucune pipe|No pipes|no_pipes/);
  });

  it("renders the pipe brand + name on the card", () => {
    // AnimNum is async so we don't assert on the numeric sub-header value
    // here; static text (brand + name) is enough proof the list rendered.
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", price: "150", status: "active", rating: 4 } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
      stats: { pipeVal: 150 },
    });
    expect(container.textContent).toContain("Halvorsen");
    expect(container.textContent).toContain("Sherlock");
  });
});

describe("PipesListView — rest chip", () => {
  function dateNDaysAgo(n: number): string {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  }
  // The harness `t` echoes keys; give rest_chip its real template so
  // the {n} interpolation is exercised.
  const tRest = (k: string) => (k === "rest_chip" ? "repos {n} j" : k);

  it("shows the rest chip with the day count for a smoked pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "active" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: {
        pipes: [pipe], tobaccos: [], accessories: [], wishlist: [],
        sessions: [{ pipeId: "1", date: dateNDaysAgo(3) }],
      },
    });
    expect(container.textContent).toMatch(/repos 3 j/);
  });

  it("shows NO rest chip for a never-smoked pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "active" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).not.toMatch(/repos/);
  });

  it("shows NO rest chip on a retired pipe", () => {
    const pipe = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "finished" } as any;
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [pipe],
      t: tRest,
      data: {
        pipes: [pipe], tobaccos: [], accessories: [], wishlist: [],
        sessions: [{ pipeId: "1", date: dateNDaysAgo(3) }],
      },
      showFinishedPipes: true,
    });
    expect(container.textContent).not.toMatch(/repos 3 j/);
  });
});

describe("PipesListView — '+' button", () => {
  it("nav('addP') on tap", () => {
    const nav = vi.fn();
    const { getAllByRole } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      pipeDet: null,
      filteredPipes: [],
      data: { pipes: [], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
      nav,
    });
    const btn = getAllByRole("button").find(b =>
      /Add a pipe|Ajouter une pipe|btn_add_pipe/i.test(b.getAttribute("aria-label") || ""),
    );
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(nav).toHaveBeenCalledWith("addP");
  });
});

describe("PipesListView — description show/hide toggle", () => {
  const pipe = {
    id: "7", brand: "Brackwater", name: "Shell", status: "active", rating: 5,
    description: "Bruyère sablée profonde", notes: "Ma préférée du dimanche",
  } as any;
  const base = {
    view: "pipes", pipeDet: null,
    filteredPipes: [pipe],
    data: { pipes: [pipe], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    stats: { pipeVal: 0 },
  };

  it("hides the description by default (expandCards off)", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    expect(container.textContent).not.toContain("Bruyère sablée profonde");
    expect(container.textContent).not.toContain("Ma préférée du dimanche");
  });

  it("reveals description + notes when expandCards is on", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, expandCards: true });
    expect(container.textContent).toContain("Bruyère sablée profonde");
    expect(container.textContent).toContain("Ma préférée du dimanche");
  });
});

// ── Tag / collection chips folded behind a disclosure ────────
// Reported from the app: the tag filter row spent a whole row above the first
// card ("ça prend trop de place"). It now hides behind a `#` icon placed IN the
// existing controls row — NOT its own labelled row, which would have cost a row
// to hide a row and saved nothing. Two things must hold: the chips are gone by
// default, and an ACTIVE tag filter is still visible while they are hidden
// (otherwise folding them away would conceal that the list is narrowed).
describe("PipesListView — tag chips behind the # disclosure", () => {
  const tagged = (id: string, tags: string[]) => ({
    id, brand: "Halvorsen", name: "Sherlock " + id, status: "active", rating: 4, tags,
  }) as any;
  const pipes = [tagged("1", ["Boa", "week-end"]), tagged("2", ["Boa"])];
  const base = {
    view: "pipes", pipeDet: null,
    filteredPipes: pipes,
    data: { pipes, tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    stats: { pipeVal: 0 },
  };

  it("hides the tag chips by default", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    expect(container.textContent).not.toContain("# Boa");
    expect(container.textContent).not.toContain("# week-end");
  });

  it("offers the disclosure only when a pipe actually carries a tag", () => {
    const withTags = renderWithCtx(<CuratorPipesListView />, base);
    expect(withTags.container.querySelectorAll('[aria-label*="tag_filter_label"]').length)
      .toBeGreaterThan(0);
    const bare = [{ id: "9", brand: "X", name: "Y", status: "active" }] as any[];
    const without = renderWithCtx(<CuratorPipesListView />, {
      ...base, filteredPipes: bare,
      data: { pipes: bare, tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(without.container.querySelectorAll('[aria-label*="tag_filter_label"]').length).toBe(0);
  });

  it("reveals every distinct tag when the disclosure is tapped", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, base);
    const btn = container.querySelector('[aria-label*="tag_filter_label"]') as HTMLElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(container.textContent).toContain("# Boa");
    expect(container.textContent).toContain("# week-end");
  });

  it("still shows an ACTIVE tag filter while the chips are folded away", () => {
    // The active-filter pill row is outside the disclosure on purpose.
    const { container } = renderWithCtx(<CuratorPipesListView />, { ...base, pTagFilter: "Boa" });
    expect(container.textContent).toContain("Boa");
  });
});

// ── the retired-pipe card is legible ─────────────────────────
// An earlier release removed `opacity: active ? 1: 0.55` from the whole PipeCard and
// shipped that fix with NO test, so it was freely reinstatable — found while
// correcting its comment, which claimed a measured ~2.3:1 across all six
// theme×mode combos. That claim was wrong: `...e` (useEnter) is spread last in
// the same style object and always carries an opacity, so the fade never
// rendered. It was a landmine rather than a live defect, and the distinction
// only matters for the comment — removing it was right either way.
// This asserts the SETTLED opacity, so it fails on the form that WOULD render
// (a fade placed after the spread) rather than merely on the declaration.
describe("PipesListView — retired pipes stay readable", () => {
  const retired = { id: "1", brand: "Halvorsen", name: "Sherlock", status: "finished", rating: 3 } as any;
  const ctx51 = {
    view: "pipes",
    pipeDet: null,
    filteredPipes: [retired],
    data: { pipes: [retired], tobaccos: [], accessories: [], sessions: [], wishlist: [] },
    showFinishedPipes: true,
  };
  const card = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[role='button']"))
      .find((el) => /Sherlock/.test(el.textContent || "")) as HTMLElement | undefined;

  it("settles at full opacity — the card is an active control, not a disabled one", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithCtx(<CuratorPipesListView />, ctx51);
      const el = card(container);
      expect(el, "the retired pipe card must render").toBeTruthy();
      act(() => { vi.advanceTimersByTime(2000); });
      expect(card(container)!.style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the retired state is still signalled — by a pill, not by fading", () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, ctx51);
    expect(container.textContent).toMatch(/pipe_retired|RETIR/i);
  });
});
