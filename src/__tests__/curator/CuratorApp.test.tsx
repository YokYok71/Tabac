// Unit tests for src/CuratorApp.tsx — the top-level shell.
//
// ── ALL FIVE CASES HERE GUARANTEED NOTHING, AND THE FIRST FOUR COULD NOT ───
// ── HAVE FAILED UNDER ANY CODE AT ALL ──────────────────────────────────────
//
// Three of them asserted `not.toMatch(/Accueil.*Catalogue.*Pipes.*Atelier.*
// Journal/)`. The harness's `t` returns the KEY, so a dock item renders as
// `dock_home`, never « Accueil » — those French words appear nowhere in the
// document under any condition, so the negative held whether the dock was
// hidden, shown, or deleted outright. (Two of them were stale as well: the
// dock has said « Tabacs », not « Catalogue », for a long time.)
//
// The fourth asserted `allButtons.length > 0` for "shows the dock" — any
// button anywhere in a mounted view satisfies that — and the fifth asserted
// `expect(text).toBeTruthy()`, i.e. that the page rendered something.
//
// WHY THEY WERE WRITTEN THAT WAY IS THE USEFUL PART: the dock is PORTALED to
// `document.body` (the iOS-PWA float guardrail), so it is NOT inside the
// render container these cases were searching. Rather than fail visibly, they
// were loosened until they passed — which is the failure mode to distrust.
// `dockPortal.test.tsx` shows the right shape: dock buttons carry `dock_*`
// labels and live under `document.body`.
//
// `dockVisibility.test.ts` owns the pure predicate. What belongs HERE is the
// WIRING — that the shell actually consults it, and actually filters the
// items by `visibleSections`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorApp } from "../../CuratorApp";

// The dock is portaled to <body>, so it survives the render container being
// discarded. Without this, one case's dock is still in the document for the
// next one and every assertion below is meaningless.
afterEach(cleanup);

function makeCtx(over: Record<string, any>) {
  return {
    loading: false,
    view: "home",
    detail: null,
    pipeDet: null,
    accDet: null,
    nav: vi.fn(),
    lang: "fr",
    visibleSections: {},
    showWishForm: false,
    editWishId: null,
    tasting: null,
    importModal: false,
    trashOpen: false,
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    stats: {},
    chartData: {},
    ...over,
  };
}

// Every dock button, wherever it was portaled to. mockT returns the key, so
// each label is `dock_<id>` — the stable contract, unlike a translated word.
function dockIds(): string[] {
  return [...document.body.querySelectorAll("button")]
    .map((b) => (b.textContent || "").trim())
    .filter((s) => s.startsWith("dock_"));
}

describe("CuratorApp — dock visibility", () => {
  it("shows the dock on the home view", () => {
    renderWithCtx(<CuratorApp />, makeCtx({ view: "home" }));
    const ids = dockIds();
    // The positive case has to name what it found, or "the dock is present"
    // degrades to "some button exists" — which is what it used to say.
    expect(ids.length, "no dock rendered on the home view").toBeGreaterThan(0);
    expect(ids).toContain("dock_home");
  });

  it("hides the dock on form views (e.g. addT)", () => {
    renderWithCtx(<CuratorApp />, makeCtx({ view: "addT", form: { name: "", brand: "" } }));
    expect(dockIds(), "the dock covers a full-screen form").toEqual([]);
  });

  it("hides the dock on the tasting view", () => {
    renderWithCtx(<CuratorApp />, makeCtx({
      view: "tasting",
      tasting: { stage: "setup", tobaccoId: "", pipeId: "", weightG: "", lotId: "" },
    }));
    expect(dockIds()).toEqual([]);
  });

  it("hides the dock while the wishlist form is open", () => {
    // The wishlist form is an OVERLAY, not a view — `view` stays "inv", so
    // this is the one visibility rule that cannot be read off `view` alone.
    renderWithCtx(<CuratorApp />, makeCtx({
      view: "inv", showWishForm: true, wishForm: { name: "", brand: "" },
    }));
    expect(dockIds()).toEqual([]);
  });

  it("hides the dock on a reading page (help)", () => {
    // The reversal recorded in CLAUDE.md: the doc pages KEEP the dock hidden,
    // because the floating pill scrolls over long text. Nothing covered it.
    renderWithCtx(<CuratorApp />, makeCtx({ view: "help" }));
    expect(dockIds()).toEqual([]);
  });
});

describe("CuratorApp — sections toggle", () => {
  it("filters dock items based on visibleSections (acc/journal/stats)", () => {
    renderWithCtx(<CuratorApp />, makeCtx({
      view: "home",
      visibleSections: { acc: false, journal: false, stats: false },
    }));
    const ids = dockIds();
    expect(ids, "a disabled section is still in the dock")
      .not.toContain("dock_acc");
    expect(ids).not.toContain("dock_journal");
    expect(ids).not.toContain("dock_stats");
    // Non-vacuity, and the half that matters: the three that are NOT optional
    // must survive. An empty dock would satisfy the three negatives above.
    expect(ids).toEqual(["dock_home", "dock_inv", "dock_pipes"]);
  });

  it("keeps every item when nothing is disabled", () => {
    renderWithCtx(<CuratorApp />, makeCtx({ view: "home", visibleSections: {} }));
    expect(dockIds()).toEqual([
      "dock_home", "dock_inv", "dock_pipes", "dock_acc", "dock_journal", "dock_stats",
    ]);
  });

  it("an absent visibleSections is not a disabled section", () => {
    // `visibleSections?.[id] !== false` — undefined means ON. Reading it as a
    // plain truthiness test would empty half the dock on a fresh install.
    renderWithCtx(<CuratorApp />, makeCtx({ view: "home", visibleSections: undefined }));
    expect(dockIds()).toContain("dock_stats");
  });
});
