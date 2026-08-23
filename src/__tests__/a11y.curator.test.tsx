// Automated a11y smoke tests using axe-core. Runs the WCAG 2.1 A/AA
// ruleset on the rendered DOM of each top-level Curator view and fails
// on any "serious" or "critical" violation.
//
// Goal: catch regressions of the kind we hand-fixed
// (missing labels, removed focus rings, div onClick patterns, missing
// ARIA on modals). The static audit was done once; this keeps the
// guarantee live in CI.

import { describe, it, expect } from "vitest";
import { axe, toHaveNoViolations } from "jest-axe";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorHomeViewV2 } from "../views/curator/HomeViewV2";
import { CuratorInventoryListView } from "../views/curator/InventoryListView";
import { CuratorPipesListView } from "../views/curator/PipesListView";
import { CuratorAccListView } from "../views/curator/AccListView";
import { CuratorJournalView } from "../views/curator/JournalView";
import { CuratorTermsGate } from "../views/curator/TermsGate";

expect.extend(toHaveNoViolations);

// axe options:
//  - WCAG 2.1 A/AA only (we don't target AAA)
//  - Disable rules that don't make sense in jsdom or that apply at the
//    document level (page-has-heading-one fires per fragment).
const axeOpts = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
  rules: {
    // jsdom can't compute layered backgrounds reliably; we hand-audited
    // contrast for the palette in theme-curator.ts.
    "color-contrast": { enabled: false },
    // Fragment renders don't include a <main> landmark by design.
    "region": { enabled: false },
    // Single-h1-per-page is enforced at document level, not per view.
    "page-has-heading-one": { enabled: false },
    // The terms gate intentionally lives outside landmarks.
    "landmark-one-main": { enabled: false },
  },
};

// ── EVERY VIEW WAS AUDITED WITH AN EMPTY CELLAR ────────────────────────────
//
// All six cases passed `[]` for every collection, so each list rendered its
// EMPTY STATE and axe examined a sentence and a button. Not one card, chip,
// status badge, star row, photo column, rating control or filter dropdown —
// i.e. none of the controls a11y defects actually live in — had ever been
// looked at. The suite's own header says it exists to catch "missing labels,
// div onClick patterns, missing ARIA", and an empty list contains none of
// those to get wrong.
//
// It is the same finding the browser checks hit twice: a green run over an
// empty state is the most reassuring way to miss a screen. The seed is a
// GATE, not decoration.
//
// The fixture below deliberately exercises the branches that carry ARIA: a
// lot in each status (so every maturity/status badge renders), a no-rebuy
// tobacco (the third badge), a retired accessory and a finished pipe (the
// whole-card variants), a rated session with aromas, and a wishlist row.
const A11Y_TOB = {
  id: 1, uid: "u-t1", brand: "Brackwater", name: "Duskfall",
  category: "Virginia", cut: "Flake", blend: "Virginia, Perique",
  force: 3, roomNote: 2, taste: 4, rating: 4, rebuy: true,
  agingMax: "10", tags: ["voyage"], tastingNotes: "", description: "",
  lots: [
    { id: 101, uid: "u-l1", status: "cellar", originalStatus: "cellar",
      weightG: "50", weightInitial: "50", datePurchased: "2020-02-01",
      boxNumber: "1", price: "12", seller: "", disposed: false },
    { id: 102, uid: "u-l2", status: "jar", originalStatus: "jar",
      weightG: "20", weightInitial: "50", datePurchased: "2024-01-01",
      dateOpened: "2024-06-01", boxNumber: "2", price: "12", seller: "", disposed: false },
    { id: 103, uid: "u-l3", status: "finished", originalStatus: "cellar",
      weightG: "0", weightInitial: "50", datePurchased: "2019-01-01",
      dateOpened: "2019-06-01", dateFinished: "2021-01-01",
      boxNumber: "3", price: "12", seller: "", disposed: false },
  ],
};
const A11Y_TOB2 = {
  id: 2, uid: "u-t2", brand: "Vondel", name: "Kade 12",
  category: "Anglais", cut: "Ribbon", blend: "Latakia, Virginia",
  force: 4, roomNote: 4, taste: 3, rating: 2, rebuy: false, // the ✕ badge
  agingMax: "", tags: [], tastingNotes: "", description: "",
  lots: [{ id: 201, uid: "u-l4", status: "jar", originalStatus: "jar",
    weightG: "5", weightInitial: "50", datePurchased: "2025-01-01",
    dateOpened: "2025-02-01", boxNumber: "", price: "9", seller: "", disposed: false }],
};
const A11Y_PIPES = [
  { id: 1, uid: "u-p1", brand: "Halvorsen", name: "Early Tide", shape: "Billiard",
    courbure: "Droite", bowlMaterial: "Bruyère", stemMaterial: "Ébonite",
    finish: "Lisse", rating: 5, status: "active", maintenance: [], photos: [], tags: [] },
  { id: 2, uid: "u-p2", brand: "Østergaard", name: "Rivière", shape: "Bulldog",
    courbure: "Courbée", bowlMaterial: "Bruyère", stemMaterial: "Cumberland",
    finish: "Sablée", rating: 3, status: "finished", maintenance: [], photos: [], tags: [] },
];
const A11Y_ACC = [
  { id: 1, uid: "u-a1", brand: "Corvane", name: "Tempête", type: "Briquet",
    fuel: "Gaz", rating: 4, status: "active", notes: "", tags: [] },
  { id: 2, uid: "u-a2", brand: "Marlow", name: "Sac", type: "Blague à tabac",
    rating: 2, status: "retired", notes: "", tags: [] },
];
const A11Y_SESSIONS = [
  { id: 1, uid: "u-s1", date: "2026-05-10", time: "18:30", tobaccoId: 1, pipeId: 1,
    lotId: "102", duration: "45", rating: 5, notes: "calme", weightG: "2.5",
    aromas: ["vanilla", "leather"] },
  { id: 2, uid: "u-s2", date: "2026-05-02", tobaccoId: 2, pipeId: 2,
    lotId: "", duration: "30", rating: 3, notes: "", weightG: "2" },
];
const A11Y_WISH = [
  { id: 1, uid: "u-w1", brand: "Aldwych", name: "Coin de rue",
    category: "Balkan", cut: "Plug", priority: "medium", notes: "" },
];
const A11Y_DATA = {
  tobaccos: [A11Y_TOB, A11Y_TOB2],
  pipes: A11Y_PIPES,
  accessories: A11Y_ACC,
  sessions: A11Y_SESSIONS,
  wishlist: A11Y_WISH,
  nxT: 3, nxP: 3, nxA: 3, nxJ: 3, nxW: 2,
};

describe("a11y smoke — Curator views", () => {
  it("HomeView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorHomeViewV2 />, {
      view: "home",
      stats: { activeRefs: 2, pipesActive: 1, avg: "4.0" },
      chartData: {},
      data: A11Y_DATA,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("InventoryListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorInventoryListView />, {
      view: "inv",
      data: A11Y_DATA,
      filtered: A11Y_DATA.tobaccos,
      statusFilter: "all",
      tobGrouped: false,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("the WISHLIST mode of the inventory list is clean too", async () => {
    // A different card component (`WishCard`) on the same view — reachable
    // only through `statusFilter`, so the tobacco case above never renders it.
    const { container } = renderWithCtx(<CuratorInventoryListView />, {
      view: "inv",
      data: A11Y_DATA,
      filtered: [],
      statusFilter: "wish",
      wishGrouped: false,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("PipesListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      data: A11Y_DATA,
      filteredPipes: A11Y_PIPES,
      stats: { pipeVal: 0 },
      pipesGrouped: false,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("AccListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      data: A11Y_DATA,
      accsGrouped: false,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("JournalView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
      data: A11Y_DATA,
      sessGrouped: false,
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("TermsGate has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorTermsGate />, {
      acceptTerms: () => {},
      saveLang: () => {},
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });
});
