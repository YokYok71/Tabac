// A FLAT LIST OF THOUSANDS OF ROWS FROZE THE APP FOR THIRTEEN SECONDS.
//
// MEASURED in Chromium at 390x844 on a 300-tobacco / 200-pipe / 5000-session
// cellar with a 20 000-row catalogue loaded — the grouped defaults are fine,
// and it is the FLAT states that are catastrophic:
//
//   journal, grouped (default)      4 142 nodes    13 391 px     2.1 s
//   journal, FLAT                 185 654 nodes   670 455 px    13.3 s
//   inventory, grouped (default)      437 nodes     2 358 px     2.0 s
//   inventory, FLAT                21 757 nodes    70 298 px     2.5 s
//   catalogue, grouped (default)    2 935 nodes    19 801 px     4.6 s
//   catalogue, FLAT               200 613 nodes 1 220 601 px    13.2 s
//
// Both 13-second states are ONE TAP away: the « Grouper par mois » toggle in
// the journal's controls row and the grouping toggle in the catalogue's, plus
// « Listes groupées par défaut » in Réglages, which makes the inventory, pipe
// and accessory lists flat permanently.
//
// What is locked here is the RULE, not the numbers: a flat list renders a
// bounded prefix, the prefix grows, and the cap says so on screen. The
// measurement lives in the hook's own comment where it can be re-read.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useProgressiveList, PROGRESSIVE_STEP } from "../hooks/useProgressiveList.ts";
import { ProgressiveMore } from "../components/curator/ProgressiveMore.tsx";
import { LANGUAGES } from "../i18n/languages.ts";
import { translate } from "../i18n.ts";

function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("useProgressiveList — the window is bounded and it grows", () => {
  it("renders one step of a long list, and says how many are left", () => {
    const src = rows(5000);
    const { result } = renderHook(() => useProgressiveList(src));
    expect(result.current.visible).toHaveLength(PROGRESSIVE_STEP);
    expect(result.current.hidden).toBe(5000 - PROGRESSIVE_STEP);
  });

  it("leaves an ORDINARY collection completely alone", () => {
    // The reference cellar this app was built around holds 58 tobaccos, so the
    // cap must be invisible there — a control that appears for everyone would
    // be a worse trade than the freeze it prevents.
    const src = rows(58);
    const { result } = renderHook(() => useProgressiveList(src));
    expect(result.current.visible).toHaveLength(58);
    expect(result.current.hidden).toBe(0);
  });

  it("grows by a step, and stops exactly at the end", () => {
    const src = rows(PROGRESSIVE_STEP + 5);
    const { result } = renderHook(() => useProgressiveList(src));
    act(() => { result.current.revealMore(); });
    expect(result.current.visible).toHaveLength(PROGRESSIVE_STEP + 5);
    expect(result.current.hidden).toBe(0);
    // Revealing past the end must not overshoot into a sparse array.
    act(() => { result.current.revealMore(); });
    expect(result.current.visible).toHaveLength(PROGRESSIVE_STEP + 5);
  });

  it("does NOT reset when the source array changes identity", () => {
    // REVERSED, and the reversal is the finding. This case first asserted the
    // opposite — that a new array restarted the window — and writing it is what
    // exposed the trap: keying the count to the array's IDENTITY means a caller
    // that builds its list inline (a new array every render) never has its count
    // recognised, so `revealMore` is discarded on the next render and the list is
    // stuck at one step for ever, with a button that visibly does nothing. Not
    // resetting is safe: the count only grows by an explicit gesture, so a
    // narrowed list shows at most what the reader had already revealed and
    // already paid for — there is no path back to a 13-second frame.
    const a = rows(5000);
    const b = rows(5000);
    const { result, rerender } = renderHook(({ src }) => useProgressiveList(src), {
      initialProps: { src: a },
    });
    act(() => { result.current.revealMore(); });
    act(() => { result.current.revealMore(); });
    expect(result.current.visible).toHaveLength(PROGRESSIVE_STEP * 3);
    rerender({ src: b });
    expect(result.current.visible).toHaveLength(PROGRESSIVE_STEP * 3);
  });

  it("survives a caller that rebuilds its array on every render", () => {
    // The trap itself, as a case: this is what a view does whenever its list is
    // a `.filter()` in the render body rather than a `useMemo`, and it must not
    // silently freeze the window at one step.
    let renders = 0;
    const { result, rerender } = renderHook(() => {
      renders++;
      return useProgressiveList(rows(500), 10);
    });
    act(() => { result.current.revealMore(); });
    rerender();
    rerender();
    expect(renders).toBeGreaterThan(2);
    expect(result.current.visible).toHaveLength(20);
  });


  it("survives null, undefined and a non-array", () => {
    expect(renderHook(() => useProgressiveList(null)).result.current.visible).toEqual([]);
    expect(renderHook(() => useProgressiveList(undefined)).result.current.hidden).toBe(0);
    expect(renderHook(() => useProgressiveList("nope" as any)).result.current.visible).toEqual([]);
  });

  it("a caller can choose its own step, and a garbage step degrades", () => {
    expect(renderHook(() => useProgressiveList(rows(100), 10)).result.current.visible).toHaveLength(10);
    expect(renderHook(() => useProgressiveList(rows(100), 0)).result.current.visible)
      .toHaveLength(PROGRESSIVE_STEP);
    expect(renderHook(() => useProgressiveList(rows(100), -5 as any)).result.current.visible)
      .toHaveLength(PROGRESSIVE_STEP);
  });
});

describe("the sentinel extends the window when it comes into view", () => {
  let observed: Element[] = [];
  let fire: ((entries: any[]) => void) | null = null;
  beforeEach(() => {
    observed = [];
    fire = null;
    (globalThis as any).IntersectionObserver = class {
      constructor(cb: (e: any[]) => void) { fire = cb; }
      observe(el: Element) { observed.push(el); }
      disconnect() { /* noop */ }
    };
  });
  afterEach(() => { delete (globalThis as any).IntersectionObserver; });

  function Host({ n }: { n: number }) {
    const { visible, hidden, revealMore, sentinelRef } = useProgressiveList(rows(n), 10);
    return (
      <div>
        <span data-count>{visible.length}</span>
        <ProgressiveMore hidden={hidden} onMore={revealMore} sentinelRef={sentinelRef}
          t={(k) => translate("fr", k)} />
      </div>
    );
  }

  it("grows when the sentinel intersects", () => {
    render(<Host n={100} />);
    expect(document.querySelector("[data-count]")!.textContent).toBe("10");
    expect(observed.length, "the sentinel was never observed").toBeGreaterThan(0);
    act(() => { fire!([{ isIntersecting: true }]); });
    expect(document.querySelector("[data-count]")!.textContent).toBe("20");
  });

  it("does NOT grow when it merely leaves the viewport", () => {
    // Non-vacuity: an observer that revealed on every callback would pass the
    // case above and defeat the cap on the first scroll in either direction.
    render(<Host n={100} />);
    act(() => { fire!([{ isIntersecting: false }]); });
    expect(document.querySelector("[data-count]")!.textContent).toBe("10");
  });

  it("stops observing once everything is shown", () => {
    render(<Host n={8} />);
    expect(observed).toHaveLength(0);
    expect(document.querySelector("[data-count]")!.textContent).toBe("8");
  });

  it("works with NO IntersectionObserver — the button is the way through", () => {
    delete (globalThis as any).IntersectionObserver;
    render(<Host n={100} />);
    const btn = screen.getByRole("button", { name: /90/ });
    act(() => { btn.click(); });
    expect(document.querySelector("[data-count]")!.textContent).toBe("20");
  });
});

describe("the cap names itself", () => {
  it("renders the remaining count, and nothing at all when there is none", () => {
    const { container, rerender } = render(
      <ProgressiveMore hidden={1940} onMore={() => {}} sentinelRef={{ current: null }}
        t={(k) => translate("fr", k)} />,
    );
    expect(container.textContent).toContain("1940");
    rerender(<ProgressiveMore hidden={0} onMore={() => {}} sentinelRef={{ current: null }}
      t={(k) => translate("fr", k)} />);
    expect(container.textContent).toBe("");
  });

  it("the label interpolates in every language, and never renders its key", () => {
    // A key held in DATA is invisible to doc:check's literal `t("…")` scan, and
    // an unresolved one renders the raw key on screen. Resolved against the real
    // dictionaries, all six.
    for (const l of LANGUAGES) {
      const v = translate(l.code, "list_more");
      expect(v, l.code + " has no list_more").not.toBe("list_more");
      expect(v, l.code + " lost its {n} placeholder").toContain("{n}");
    }
  });

  it("is a real 44 px control with an accessible name", () => {
    render(<ProgressiveMore hidden={12} onMore={() => {}} sentinelRef={{ current: null }}
      t={(k) => translate("fr", k)} />);
    const btn = screen.getByRole("button", { name: /12/ });
    expect(String((btn as HTMLElement).style.minHeight)).toBe("44px");
  });
});

describe("the flat branches are wired to it", () => {
  // Source-level, and per FILE rather than per occurrence: what rots is a list
  // that stops going through the hook, and a rendered assertion would need each
  // view's whole ctx plus thousands of rows to tell a capped list from a short
  // one.
  const VIEWS: Array<[string, string]> = [
    ["src/views/curator/CatalogView.tsx", "catalogue"],
    ["src/views/curator/JournalView.tsx", "journal"],
    ["src/views/curator/InventoryListView.tsx", "inventory + wishlist"],
    ["src/views/curator/PipesListView.tsx", "pipes"],
    ["src/views/curator/AccListView.tsx", "accessories"],
  ];

  for (const [file, what] of VIEWS) {
    it(`${what} renders a bounded prefix`, () => {
      const src = blankComments(readFileSync(file, "utf8"));
      expect(src, `${file} does not call the hook`).toMatch(/useProgressiveList\(/);
      expect(src, `${file} caps without saying so`).toMatch(/<ProgressiveMore\b/);
    });
  }

  it("every ProgressiveMore is handed a sentinel and a reveal", () => {
    // A footer rendered without its sentinel is a button nobody scrolls to; one
    // without `onMore` is a cap with no way through.
    for (const [file] of VIEWS) {
      const src = blankComments(readFileSync(file, "utf8"));
      const uses = src.match(/<ProgressiveMore[\s\S]*?\/>/g) || [];
      expect(uses.length, `${file} renders no ProgressiveMore`).toBeGreaterThan(0);
      for (const u of uses) {
        expect(u, `${file}: a footer with no sentinel`).toMatch(/sentinelRef=/);
        expect(u, `${file}: a footer with no way through`).toMatch(/onMore=/);
      }
    }
  });
});
