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

describe("a11y smoke — Curator views", () => {
  it("HomeView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorHomeViewV2 />, {
      view: "home",
      stats: { activeRefs: 0, pipesActive: 0, avg: "—" },
      chartData: {},
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("InventoryListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorInventoryListView />, {
      view: "inv",
      filtered: [],
      statusFilter: "all",
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("PipesListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorPipesListView />, {
      view: "pipes",
      filteredPipes: [],
      stats: { pipeVal: 0 },
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("AccListView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorAccListView />, {
      view: "acc",
      data: { wishlist: [], tobaccos: [], pipes: [], accessories: [], sessions: [] },
    });
    const results = await axe(container, axeOpts);
    expect(results).toHaveNoViolations();
  });

  it("JournalView has no serious/critical a11y violations", async () => {
    const { container } = renderWithCtx(<CuratorJournalView />, {
      view: "journal",
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
