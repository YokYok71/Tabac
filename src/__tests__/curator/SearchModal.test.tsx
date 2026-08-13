// Curator SearchModal — searchAll() unit tests + render smoke.

import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppCtx, type AppCtxType } from "../../AppContext.tsx";
import { CuratorSearchModal, searchAll, searchCatalog } from "../../views/curator/SearchModal.tsx";

const sampleData = {
  tobaccos: [
    { id: 1, name: "Duskfall", brand: "Halvorsen", category: "Anglais", cut: "Ribbon" },
    { id: 2, name: "Adagio Green", brand: "Marlow & Finch", category: "VaPer", cut: "Ribbon" },
  ],
  pipes: [
    { id: 1, name: "Shell 4103", brand: "Halvorsen", shape: "Dublin", bowlMaterial: "Bruyère" },
  ],
  wishlist: [],
  accessories: [],
  sessions: [
    { id: 1, tobaccoId: 1, date: "2026-05-01", notes: "Lovely smoky night" },
  ],
};

describe("searchAll()", () => {
  it("returns no hits for empty or short queries", () => {
    expect(searchAll("", sampleData)).toEqual([]);
    expect(searchAll(" a", sampleData)).toEqual([]);
  });

  it("matches tobaccos by brand and name", () => {
    const hits = searchAll("halvorsen", sampleData);
    expect(hits.find(h => h.kind === "tobacco")).toBeTruthy();
    expect(hits.find(h => h.kind === "pipe")).toBeTruthy();
  });

  it("matches sessions by notes", () => {
    const hits = searchAll("smoky", sampleData);
    expect(hits.find(h => h.kind === "session")).toBeTruthy();
  });

  it("translates enum subtitles via the xl param (falls back to raw without it)", () => {
    // A stub xl that upper-cases the value so the translation is observable.
    const xl = (v: string) => (v ? v.toUpperCase() : v);
    const hits = searchAll("halvorsen", sampleData, undefined, xl);
    const tob = hits.find(h => h.kind === "tobacco");
    expect(tob?.subtitle).toBe("ANGLAIS · RIBBON");
    const pipe = hits.find(h => h.kind === "pipe");
    expect(pipe?.subtitle).toBe("DUBLIN · BRUYÈRE");
    // Without xl the raw canonical value is used (back-compat for tests).
    expect(searchAll("halvorsen", sampleData).find(h => h.kind === "tobacco")?.subtitle)
      .toBe("Anglais · Ribbon");
  });
});

describe("searchCatalog()", () => {
  const db = {
    version: 1, updatedAt: "2026-07-01",
    brands: { "halvorsen": { displayName: "Halvorsen", country: "UK", tier: 1, status: "active" } },
    blends: {
      "halvorsen|Duskfall": { name: "Duskfall", category: "Anglais", cut: "Ribbon", blend: "Latakia, Virginia, Orientals, Perique", force: 4, roomNote: 3, taste: 4, agingMax: "10-15", description: {} },
      "halvorsen|Regent Mixture": { name: "Regent Mixture", category: "Anglais", cut: "Ribbon", blend: "Virginia, Orientals, Latakia", force: 2, roomNote: 3, taste: 3, agingMax: "10", description: {} },
    },
  } as any;

  it("returns [] for short queries or a missing db", () => {
    expect(searchCatalog("n", db)).toEqual([]);
    expect(searchCatalog("duskfall", null)).toEqual([]);
  });

  it("matches catalog blends by brand/name and tags them kind=catalog", () => {
    const hits = searchCatalog("duskfall", db);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("catalog");
    expect(hits[0]!.id).toBe("halvorsen|Duskfall");
    expect(hits[0]!.title).toContain("Halvorsen");
    expect(hits[0]!.title).toContain("Duskfall");
  });

  it("caps the number of results", () => {
    expect(searchCatalog("halvorsen", db, undefined, 1)).toHaveLength(1);
  });
});

describe("CuratorSearchModal", () => {
  it("renders nothing when not open", () => {
    const { container } = render(
      <AppCtx.Provider value={{ searchOpen: false, setSearchOpen: () => {}, data: sampleData, lang: "fr", t: (k: string) => k, xl: (v: string) => v, nav: () => {}, weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€" } as unknown as AppCtxType}>
        <CuratorSearchModal />
      </AppCtx.Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the input when open", () => {
    render(
      <AppCtx.Provider value={{ searchOpen: true, setSearchOpen: () => {}, data: sampleData, lang: "fr", t: (k: string) => k, xl: (v: string) => v, nav: () => {}, weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€" } as unknown as AppCtxType}>
        <CuratorSearchModal />
      </AppCtx.Provider>
    );
    expect(screen.getByPlaceholderText("search_modal_input_ph")).toBeInTheDocument();
  });
});

// A wishlist hit takes you to the CARD.
//
// Reported with two screenshots: searching "Ravensmoor" listed « Ravensmoor — Blood Red
// Moon » under WISHLIST, and tapping it landed on the wishlist scrolled to the
// top, on a different item. The handler navigated and dropped `h.id` — every
// other kind here resolves to its specific row; this was the one that did not.
describe("SearchModal — a wishlist hit resolves to its item", () => {
  const DATA = {
    tobaccos: [], pipes: [], accessories: [], sessions: [],
    wishlist: [
      { id: 11, brand: "Ravensmoor", name: "Hedgerow", category: "Aromatique", cut: "Loose Cut" },
      { id: 12, brand: "Cranmere", name: "Salt Marsh", category: "Balkan", cut: "Flake" },
    ],
  };

  const mount = (over: any) => render(
    <AppCtx.Provider value={{
      searchOpen: true, data: DATA, lang: "fr", t: (k: string) => k, xl: (v: string) => v,
      weightUnit: "g", lengthUnit: "mm", dateFormat: "fr", currencySymbol: "€",
      setSearchOpen: () => {}, setDetail: vi.fn(), setPipeDet: vi.fn(), setAccDet: vi.fn(),
      setCatalogSeed: vi.fn(), ...over,
    } as unknown as AppCtxType}>
      <CuratorSearchModal />
    </AppCtx.Provider>);

  const openAndClick = () => {
    const setStatusFilter = vi.fn();
    const setWishFocusId = vi.fn();
    const nav = vi.fn();
    const { container } = mount({ nav, setStatusFilter, setWishFocusId });
    fireEvent.change(container.querySelector("input")!, { target: { value: "Ravensmoor" } });
    const row = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /Hedgerow/.test(b.textContent || ""));
    return { row, setStatusFilter, setWishFocusId, nav, container };
  };

  it("names the item it is sending you to, not just the list", () => {
    const { row, setWishFocusId, setStatusFilter, nav } = openAndClick();
    expect(row, "the wishlist hit must render").toBeTruthy();
    fireEvent.click(row!);
    expect(nav).toHaveBeenCalledWith("inv");
    expect(setStatusFilter).toHaveBeenCalledWith("wish");
    // THE ASSERTION THAT WAS MISSING: the id has to travel.
    expect(setWishFocusId, "the tapped wish's id must be passed on").toHaveBeenCalledWith(11);
  });

  it("passes the id of the row actually tapped", () => {
    const setWishFocusId = vi.fn();
    const { container } = mount({ nav: vi.fn(), setStatusFilter: vi.fn(), setWishFocusId });
    fireEvent.change(container.querySelector("input")!, { target: { value: "Salt Marsh" } });
    const row = Array.from(container.querySelectorAll("[role='button']"))
      .find((b) => /Salt Marsh/.test(b.textContent || ""))!;
    fireEvent.click(row);
    expect(setWishFocusId).toHaveBeenCalledWith(12);
  });
});

// The result SUBTITLE wraps, the TITLE does not.
//
// `Virginia/Burley · Crumble Cake` clipped at 360 px in German at the "L" text
// size (235 px needed, 216 px box), hiding the CUT entirely on a row whose job
// is saying which blend this is. It was the last standing failure of
// `npm run i18n:layout`, and a permanently-red opt-in check stops being read.
//
// Wrapping is safe here and only here because both halves are ENUM values, so
// the set is closed and the maximum is computable: 34 characters. The title is
// a user-supplied blend name with no bound, so it keeps its ellipsis — the two
// lines must not be "fixed" to match each other.
describe("SearchModal — subtitle wraps, title clips", () => {
  const src = readFileSync("src/views/curator/SearchModal.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("lets the subtitle wrap instead of ellipsing the cut away", () => {
    const i = src.indexOf("hit.subtitle &&");
    expect(i, "the subtitle render site moved — re-check this test").toBeGreaterThan(0);
    const block = src.slice(i, i + 400);
    expect(block, "the subtitle must not be nowrap").not.toMatch(/whiteSpace:\s*"nowrap"/);
    expect(block).toMatch(/overflowWrap:\s*"anywhere"/);
  });

  it("keeps the title clipped, because a blend name has no bound", () => {
    const i = src.indexOf("hit.title");
    const block = src.slice(Math.max(0, i - 400), i);
    expect(block).toMatch(/whiteSpace:\s*"nowrap"/);
    expect(block).toMatch(/textOverflow:\s*"ellipsis"/);
  });

  it("the widest possible subtitle is still a bounded, two-line string", () => {
    // The premise the wrap rests on. If a future enum value blows past this,
    // the row grows a third line and someone should look again.
    const cts = readFileSync("src/constants.ts", "utf8");
    const en = (n: string) => [...new RegExp(`export var ${n} = \\[([^\\]]*)\\]`)
      .exec(cts)![1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]!);
    const mp = (n: string) => {
      const m = new RegExp(`export var ${n}: Record<string, string> = \\{([^}]*)\\}`).exec(cts);
      const o: Record<string, string> = {};
      if (m) for (const p of m[1]!.matchAll(/"?([^",:{]+)"?\s*:\s*"((?:[^"\\]|\\.)*)"/g)) o[p[1]!.trim()] = p[2]!;
      return o;
    };
    let worst = 0;
    for (const c of ["fr", "en", "es", "de", "it", "pt"]) {
      const cm = c === "fr" ? {} : mp(`CATS_${c.toUpperCase()}`);
      const um = c === "fr" ? {} : mp(`CUTS_${c.toUpperCase()}`);
      for (const a of en("CATS")) for (const b of en("CUTS")) {
        worst = Math.max(worst, ((cm as any)[a] || a).length + 3 + ((um as any)[b] || b).length);
      }
    }
    expect(worst, "the enums must be readable or this guard is vacuous").toBeGreaterThan(20);
    expect(worst, "a subtitle this long would need a third line at 360px/L").toBeLessThanOrEqual(40);
  });
});
