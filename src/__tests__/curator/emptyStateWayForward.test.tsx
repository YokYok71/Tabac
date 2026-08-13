// An empty screen must say WHICH kind of empty it is, and
// offer a way forward.
//
// An audit of all 25 empty states in the app found exactly ONE with an action
// (the journal's filter reset) and three list views that could not
// tell "you own nothing yet" from "your filters matched nothing" — they compute
// emptiness from the FILTERED array, so someone with 200 tobaccos and a
// forgotten chip saw the identical « Aucun tabac » as a first-run user.
//
// Two directions per view, deliberately. Asserting only the no-match case
// would pass on a build that said "no match" unconditionally, which is just as
// wrong in the other half.
//
// The tobacco/wishlist pair lives in InventoryListView.test.tsx next to the
// existing wish-filter cases (see the reversal recorded there).

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { AppCtx, AppCtxType } from "../../AppContext";
import { CuratorPipesListView } from "../../views/curator/PipesListView";
import { CuratorAccListView } from "../../views/curator/AccListView";
import { CuratorTastingView } from "../../views/curator/TastingView";
import { CuratorJournalView } from "../../views/curator/JournalView";

const mockT = (k: string) => k;

function base(extra: Record<string, any>) {
  return {
    t: mockT,
    xl: (v: string) => v,
    lang: "fr",
    nav: vi.fn(),
    weightUnit: "g",
    data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    ...extra,
  } as unknown as AppCtxType;
}

function draw(node: React.ReactElement, ctx: AppCtxType) {
  return render(<AppCtx.Provider value={ctx}>{node}</AppCtx.Provider>);
}

const PIPE = { id: 1, name: "Sherlock", brand: "Halvorsen", shape: "Billiard", status: "active" };
const ACC = { id: 1, name: "Zippo", brand: "Zippo", type: "Briquet", status: "active" };

describe("pipes list — which kind of empty", () => {
  const ctx = (extra: Record<string, any> = {}) => base({
    view: "pipes",
    data: { tobaccos: [], pipes: [PIPE], accessories: [], sessions: [], wishlist: [] },
    filteredPipes: [],
    ...extra,
  });

  it("a filter that matched nothing says so, and offers the way back", () => {
    const { container } = draw(<CuratorPipesListView />, ctx({ pShapeFilter: "Dublin" }));
    expect(container.textContent).toContain("list_no_match");
    expect(container.textContent).toContain("btn_reset_filters");
    expect(container.textContent).not.toContain("no_pipes");
  });

  it("an empty collection says so, and offers the way forward", () => {
    const { container } = draw(<CuratorPipesListView />,
      ctx({ data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] } }));
    expect(container.textContent).toContain("no_pipes");
    expect(container.textContent).toContain("btn_add_pipe");
    expect(container.textContent).not.toContain("list_no_match");
  });

  it("`showFinishedPipes` alone is NOT a filter", () => {
    // It SWITCHES which half is shown rather than narrowing it, so a reset
    // that turned it off would remove rows the user just asked to see.
    const { container } = draw(<CuratorPipesListView />, ctx({
      showFinishedPipes: true,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    }));
    expect(container.textContent).not.toContain("btn_reset_filters");
  });

  // ─────────────────────────────────────────────────────────────────────
  // An earlier release read the retired shelf as a first run. `showFinishedPipes` is
  // BINARY ("retired ONLY"), and excluding it from
  // `pipesFiltered` — right for the RESET — also picked the LABEL and the
  // ACTION, which are then both wrong: own twelve active pipes and none
  // retired, tap « Retirées », and the screen said « Aucune pipe » and
  // offered an add that creates an ACTIVE pipe, invisible in that view.
  //
  // NOTE the assertion above was WEAKENED on purpose in the same build: its
  // fixture has zero pipes TOTAL, so "no_pipes" is true there and it could
  // never distinguish the two cases. What it still guards — no reset offered
  // — is the part that was ever about `showFinishedPipes`.
  it("an empty RETIRED shelf is not 'you own no pipes'", () => {
    const { container } = draw(<CuratorPipesListView />, ctx({ showFinishedPipes: true }));
    expect(container.textContent).toContain("no_retired_pipes");
    expect(container.textContent, "12 pipes are owned; saying otherwise is false")
      .not.toContain("no_pipes");
    expect(container.textContent, "the add would create an ACTIVE pipe, invisible here")
      .not.toContain("btn_add_pipe");
  });

  it("its way forward is the Actives chip, not a form", () => {
    const setShowFinishedPipes = vi.fn();
    const { container } = draw(<CuratorPipesListView />,
      ctx({ showFinishedPipes: true, setShowFinishedPipes }));
    const btn = Array.from(container.querySelectorAll('[role="button"], button'))
      .find((b) => (b.textContent || "").includes("btn_see_active_pipes"))!;
    expect(btn, "the way back is missing").toBeTruthy();
    (btn as HTMLElement).focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    (btn as HTMLElement).click();
    expect(setShowFinishedPipes).toHaveBeenCalledWith(false);
  });
});

describe("accessories list — which kind of empty", () => {
  const ctx = (extra: Record<string, any> = {}) => base({
    view: "acc",
    data: { tobaccos: [], pipes: [], accessories: [ACC], sessions: [], wishlist: [] },
    accIsActive: (a: any) => a.status === "active",
    ...extra,
  });

  it("a filter that matched nothing says so, and offers the way back", () => {
    const { container } = draw(<CuratorAccListView />, ctx({ aTypeFilter: "Porte-pipe" }));
    expect(container.textContent).toContain("list_no_match");
    expect(container.textContent).toContain("btn_reset_filters");
    expect(container.textContent).not.toContain("no_accessories");
  });

  it("an empty collection says so, and offers the way forward", () => {
    const { container } = draw(<CuratorAccListView />,
      ctx({ data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] } }));
    expect(container.textContent).toContain("no_accessories");
    expect(container.textContent).toContain("btn_add_accessory");
    expect(container.textContent).not.toContain("list_no_match");
  });

  // The same third state as pipes. The sub-header two rows above
  // this block already read « 0 retirés » while the body said « Aucun
  // accessoire », which is the contradiction on one screen.
  it("an empty RETIRED shelf is not 'you own no accessories'", () => {
    const setShowRetiredAcc = vi.fn();
    const { container } = draw(<CuratorAccListView />, ctx({ showRetiredAcc: true, setShowRetiredAcc }));
    expect(container.textContent).toContain("no_retired_acc");
    expect(container.textContent).not.toContain("no_accessories");
    expect(container.textContent).not.toContain("btn_add_accessory");
    const btn = Array.from(container.querySelectorAll('[role="button"], button'))
      .find((b) => (b.textContent || "").includes("btn_see_active_acc"))!;
    expect(btn).toBeTruthy();
    (btn as HTMLElement).focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    (btn as HTMLElement).click();
    expect(setShowRetiredAcc).toHaveBeenCalledWith(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// The journal's empty state offered « Nouvelle séance » with a bare
// nav("addJ"), which lands on BJ (date: "") — and SessionFormView's canSave
// requires a date, so the only CTA on that screen opened a form with a
// permanently greyed Save and nothing saying why. The `+` button two hundred
// lines up had always seeded date/time/weight. That is the drift the tasting
// case above was written to prevent, missed one component over in the SAME
// build; the two doors now share `openNewSession`.
describe("the journal's way forward opens a SAVEABLE form", () => {
  it("seeds the date, like the + button", () => {
    const setSessForm = vi.fn();
    const nav = vi.fn();
    const { container } = draw(<CuratorJournalView />, base({
      view: "journal",
      allSessions: [], sessions: [],
      setSessForm, setEditSessId: vi.fn(), nav,
      BJ: { tobaccoId: "", pipeId: "", date: "", duration: "", rating: 0, notes: "", weightG: "", lotId: "", aromas: [] },
      sessDefaultWeight: "3",
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    }));
    const btn = Array.from(container.querySelectorAll('[role="button"], button'))
      .find((b) => (b.textContent || "").includes("btn_new_session")
        && !(b.getAttribute("aria-label") || "").includes("btn_new_session"))!;
    expect(btn, "the empty-state CTA is missing").toBeTruthy();
    (btn as HTMLElement).click();
    expect(setSessForm, "a bare nav() lands on BJ, whose date is '' — Save stays greyed")
      .toHaveBeenCalledWith(expect.objectContaining({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        time: expect.stringMatching(/^\d{2}:\d{2}$/),
        weightG: "3",
      }));
    expect(nav).toHaveBeenCalledWith("addJ");
  });
});

describe("the tasting screen is no longer a dead end", () => {
  // The harshest one in the app: a single centred sentence, no top bar, and the
  // dock is HIDDEN on `tasting` (NO_DOCK_VIEWS) — so there was literally
  // nothing to tap. The only way out was a system-back gesture, which is not
  // an affordance.
  const ctx = (extra: Record<string, any> = {}) => base({
    view: "tasting", tasting: null, ...extra,
  });

  it("offers BOTH a way on and a way out", () => {
    const { container } = draw(<CuratorTastingView />, ctx());
    expect(container.textContent).toContain("tasting_none");
    expect(container.textContent).toContain("tasting_title");   // start one
    expect(container.textContent).toContain("btn_back_home");   // or leave
  });

  it("starting seeds the same blank setup the Home CTA does", () => {
    // Two entry points into one flow; if they seed differently they drift.
    const tastingStart = vi.fn();
    const { container } = draw(<CuratorTastingView />, ctx({ tastingStart, sessDefaultWeight: "3" }));
    const btn = Array.from(container.querySelectorAll('[role="button"]'))
      .find((b) => (b.textContent || "").includes("tasting_title"))!;
    expect(btn, "the start action is missing").toBeTruthy();
    (btn as HTMLElement).focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tastingStart).toHaveBeenCalledWith(
      expect.objectContaining({ tobaccoId: "", pipeId: "", lotId: "", weightG: "3" }),
    );
  });

  it("leaving goes home", () => {
    const nav = vi.fn();
    const { container } = draw(<CuratorTastingView />, ctx({ nav }));
    const btn = Array.from(container.querySelectorAll('[role="button"]'))
      .find((b) => (b.textContent || "").includes("btn_back_home"))!;
    (btn as HTMLElement).focus();
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(nav).toHaveBeenCalledWith("home");
  });
});
