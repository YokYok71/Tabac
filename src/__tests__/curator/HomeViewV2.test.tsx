// Smoke tests for the alternative Home layout (HomeViewV2).
// Uses the mock t() that returns the key, so we assert on zone-title keys.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorHomeViewV2 } from "../../views/curator/HomeViewV2.tsx";
import { monthsShort } from "../../constants.ts";

const recentDate = () => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

const baseCtx = {
  view: "home",
  lang: "fr",
  t: (k: string) => k,
  xl: (v: any) => v,
  nav: () => {},
  setStatusFilter: () => {},
  setSearchOpen: () => {},
  setImportModal: () => {},
  setSettingsTab: () => {},
  setDetail: () => {},
  setPipeDet: () => {},
  navToInvFiltered: () => {},
  pipeIsActive: (p: any) => p.status !== "finished",
  ageLabel: (d: number | null) => (d == null ? "—" : `${d}j`),
  weightUnit: "g",
  currencySymbol: "€",
  imgLocal: {},
  data: {
    tobaccos: [
      { id: 1, brand: "Halvorsen", name: "Duskfall", category: "Anglais", rating: 5,
        lots: [{ status: "cellar", weightG: "50", dateProduction: "2020-01-01" }], aromas: [] },
    ],
    pipes: [{ id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active" }],
    accessories: [],
    sessions: [{ id: 1, tobaccoId: 1, pipeId: 1, date: recentDate(), duration: "30", rating: 5, weightG: "3", aromas: ["leather", "smoky"] }],
    wishlist: [],
  },
  stats: {
    activeRefs: 1, cellar: 1, jars: 0, wt: 50, avg: "5.0",
    cats: [["Anglais", 1]], brands: [["Halvorsen", 1]],
    pipesActive: 1, pipeVal: 200, tobVal: 100,
    lotsFinished: 0, lotsOveraged: 0, lotsApproaching: 0, wish: 0,
  },
};

function renderWith(ctx: any) {
  return render(
    <AppCtx.Provider value={ctx}>
      <CuratorHomeViewV2 />
    </AppCtx.Provider>
  );
}

describe("CuratorHomeViewV2", () => {
  it("returns null when view !== home", () => {
    const { container } = renderWith({ ...baseCtx, view: "inv" });
    expect(container.firstChild).toBeNull();
  });

  it("renders the three zone headers + library title", () => {
    renderWith(baseCtx);
    expect(screen.getByText("sec_library")).toBeInTheDocument();
    expect(screen.getByText("home_zone_act")).toBeInTheDocument();
    expect(screen.getByText("home_zone_dash")).toBeInTheDocument();
    expect(screen.getByText("home_zone_moments")).toBeInTheDocument();
  });

  // The privacy link must stay on the Home page — Google OAuth
  // verification requires the privacy policy to be reachable from the app, and
  // it was dropped when HomeViewV2 replaced the classic home. This test fails
  // if the footer link is removed again.
  it("renders a privacy link on the Home that navigates to the privacy page", () => {
    const nav = vi.fn();
    renderWith({ ...baseCtx, nav });
    const link = screen.getByText("btn_privacy");
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(nav).toHaveBeenCalledWith("privacy");
  });

  it("labels the activity heatmap with month ticks", () => {
    renderWith(baseCtx);
    // The last heatmap column is the current month → its short label must show.
    const currentMonth = monthsShort("fr")[new Date().getMonth()]!;
    expect(screen.getAllByText(currentMonth).length).toBeGreaterThan(0);
  });

  it("tapping a day cell selects it and links into the journal", () => {
    const navToJournalFilteredByDate = vi.fn();
    const { container } = renderWith({ ...baseCtx, navToJournalFilteredByDate });
    // The only day carrying a session is recentDate() → its cell's aria-label
    // ends with "· 1" (all other cells read "· 0").
    const cell = Array.from(container.querySelectorAll("button"))
      .find((b) => /· 1$/.test(b.getAttribute("aria-label") || ""));
    expect(cell, "expected a day cell with one session").toBeTruthy();
    fireEvent.click(cell!);
    // The selection line now renders a journal link (contains "→").
    const link = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.textContent || "").includes("→"));
    expect(link, "expected a journal link on the selection line").toBeTruthy();
    fireEvent.click(link!);
    expect(navToJournalFilteredByDate).toHaveBeenCalledWith(recentDate());
  });

  it("shows the maintenance reminder at page end when a pipe is overdue", () => {
    // The reminder opens the pipe fiche via crossOpenDetail (so
    // back returns to Home), not a bare setPipeDet.
    const crossOpenDetail = vi.fn();
    const duePipe = { id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active", maintenance: [] };
    const sessions = Array.from({ length: 12 }, (_, i) => ({ id: i, tobaccoId: 1, pipeId: 1, date: "2026-06-01", duration: "30", rating: 4, weightG: "3", aromas: [] }));
    const { container, getByText } = renderWith({
      ...baseCtx, crossOpenDetail,
      data: { ...baseCtx.data, pipes: [duePipe], sessions },
    });
    expect(container.textContent).toContain("maint_due"); // section title
    expect(container.textContent).toContain("maint_never"); // 12 sessions, never cleaned
    fireEvent.click(getByText("maint_never"));
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "pipes", kind: "pipe", obj: duePipe });
  });

  // REVERSED, on the user's request, and the reversal is recorded here
  // rather than by deleting the case. The section briefly listed EVERY overdue
  // pipe: that fixed the real defect (five of twelve, with nothing admitting
  // the truncation — « je ne vois toujours que 5 pipes à nettoyer ») but it
  // also let the Home's last block grow without bound. The settled answer
  // keeps the cap AND the honesty: five rows, then a button that names the
  // TOTAL still to clean and opens all of them in a modal.
  //
  // What must never come back is a cap that hides its own existence. So the
  // two halves are asserted together, and a probe that removes either one
  // reddens: the cap without the button is the reported defect, the button
  // without the cap is a control with nothing to reveal.
  //
  // Each pipe carries a DISTINCT name, so these count ROWS rather than
  // occurrences of a shared label — with seven identical pipes a cap of five
  // still satisfies a "contains maint_never" assertion.
  const MAINT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];

  /**
   * The maintenance section's text, NOT the whole page's.
   *
   * WHY THIS EXISTS, measured rather than assumed. The cap assertion below used
   * to read the whole container, and it FAILED FOR HALF OF EVERY DAY: the
   * « Ce soir ? » hero names a paired pipe («  home_pair_with Halvorsen
   * Foxtrot »), that pipe is chosen by `suggestRestedPipe` on a 12-hour
   * rotation bucket, and all seven fixtures are equally rested — so which one
   * it names depends on the clock. Pinned with `vi.setSystemTime` on identical
   * code: PASSES at 11:30 UTC, FAILS at 23:30 UTC.
   *
   * The lesson is not about the clock, it is the one this repo keeps paying
   * for one screen over: a negative assertion on the WHOLE page is answered by
   * every sibling feature, so it stops testing what it names. The positive
   * direction has the mirror flaw — `toContain("Alpha")` would pass on a broken
   * section the moment the hero happened to pair Alpha — so both are scoped.
   *
   * Scoped by SLICING at the section heading rather than by a `data-` hook:
   * `MaintRow` renders a `PressCard`, which destructures a fixed prop list and
   * would not forward one, and wrapping it in a marked `<div>` would change a
   * flex item on a screen the layout matrix has just certified.
   */
  const maintText = (container: HTMLElement) => {
    const all = container.textContent || "";
    const i = all.indexOf("maint_due");
    expect(i, "the « À entretenir » section is not on the page at all").toBeGreaterThan(-1);
    return all.slice(i);
  };
  const overduePipes = () => MAINT_NAMES.map((n, i) => ({
    id: i + 1, brand: "Halvorsen", name: n, shape: "Calabash",
    rating: 4, status: "active", maintenance: [],
  }));
  const overdueSessions = (pipes: any[]) => pipes.flatMap((p) =>
    Array.from({ length: 12 }, (_, i) => ({
      id: p.id * 100 + i, tobaccoId: 1, pipeId: p.id,
      date: "2026-06-01", duration: "30", rating: 4, weightG: "3", aromas: [],
    })),
  );

  it("caps the section at five rows and says how many it holds back", () => {
    const pipes = overduePipes();
    const { container } = renderWith({
      ...baseCtx, data: { ...baseCtx.data, pipes, sessions: overdueSessions(pipes) },
    });
    const section = maintText(container);
    MAINT_NAMES.slice(0, 5).forEach((n) => {
      expect(section, `« ${n} » is within the cap`).toContain(n);
    });
    MAINT_NAMES.slice(5).forEach((n) => {
      expect(section, `« ${n} » is beyond the cap and must not be in the section`).not.toContain(n);
    });
    expect(container.textContent, "the cap must announce what it hides").toContain("maint_see_all_n");
    const btn = Array.from(container.querySelectorAll("[role=button]"))
      .find((b) => (b.textContent || "").includes("maint_see_all_n"));
    expect(btn, "expected a way through to the rest").toBeTruthy();
  });

  it("the button names the TOTAL still to clean, not the remainder", () => {
    // REVERSED on the user's instruction, and the reversal is recorded here
    // rather than by rewriting the case as if it had always said this. The
    // first version asserted the REMAINDER ("voir les 2 autres") on the
    // argument that it tells the reader what a tap buys. That argument answers
    // a question about the SCREEN; this block is a CHORE, so the fact worth
    // carrying is how much work is waiting — seven pipes need cleaning, five
    // of them merely happen to fit above.
    //
    // Asserted with a `t` that carries the real placeholder, because the
    // shared harness's mockT returns the KEY: under it `{n}` never
    // interpolates, so a label built from the wrong number would read
    // identically and this arithmetic would be pinned by nothing.
    const pipes = overduePipes();
    const { container } = renderWith({
      ...baseCtx,
      t: (k: string) => (k === "maint_see_all_n" ? "Voir les {n} pipes à nettoyer" : k),
      data: { ...baseCtx.data, pipes, sessions: overdueSessions(pipes) },
    });
    expect(container.textContent).toContain("Voir les 7 pipes à nettoyer");
    expect(container.textContent, "2 is what the button reveals, not the size of the job").not.toContain("Voir les 2 pipes");
  });

  it("the button opens a modal holding EVERY overdue pipe", () => {
    const pipes = overduePipes();
    const { container } = renderWith({
      ...baseCtx, data: { ...baseCtx.data, pipes, sessions: overdueSessions(pipes) },
    });
    const btn = Array.from(container.querySelectorAll("[role=button]"))
      .find((b) => (b.textContent || "").includes("maint_see_all_n"))!;
    fireEvent.click(btn);
    const dialog = container.ownerDocument.querySelector("[role=dialog]");
    expect(dialog, "the button must open a dialog").toBeTruthy();
    MAINT_NAMES.forEach((n) => {
      expect(dialog!.textContent, `« ${n} » is overdue and must be in the modal`).toContain(n);
    });
  });

  it("shows no button when the whole set fits", () => {
    // A control that reveals nothing is worse than no control: it invites a
    // tap that changes the screen not at all.
    const pipes = overduePipes().slice(0, 3);
    const { container } = renderWith({
      ...baseCtx, data: { ...baseCtx.data, pipes, sessions: overdueSessions(pipes) },
    });
    // Scoped for the mirror reason: on the whole page this would pass the
    // moment the hero happened to pair Alpha, whether or not the section works.
    expect(maintText(container)).toContain("Alpha");
    expect(container.textContent, "three of three — nothing is held back").not.toContain("maint_see_all_n");
  });

  it("respects a custom maintenance threshold from ctx", () => {
    const duePipe = { id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active", maintenance: [] };
    const sessions = Array.from({ length: 3 }, (_, i) => ({ id: i, tobaccoId: 1, pipeId: 1, date: "2026-06-01", duration: "30", rating: 4, weightG: "3", aromas: [] }));
    // 3 sessions is below the default (10) but at a custom threshold of 3 → due.
    const { container } = renderWith({
      ...baseCtx, maintReminderThreshold: 3,
      data: { ...baseCtx.data, pipes: [duePipe], sessions },
    });
    expect(container.textContent).toContain("maint_due");
  });

  it("hides the maintenance reminder when no pipe is overdue", () => {
    const okPipe = { id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active", maintenance: [] };
    const { container } = renderWith({
      ...baseCtx,
      data: { ...baseCtx.data, pipes: [okPipe], sessions: [{ id: 1, tobaccoId: 1, pipeId: 1, date: "2026-06-01", duration: "30", rating: 4, weightG: "3", aromas: [] }] },
    });
    expect(container.textContent).not.toContain("maint_never");
    expect(container.textContent).not.toContain("maint_due");
  });

  it("hides the maintenance reminder when the master switch is off", () => {
    const duePipe = { id: 1, brand: "Halvorsen", name: "SH", shape: "Calabash", rating: 4, status: "active", maintenance: [] };
    const sessions = Array.from({ length: 12 }, (_, i) => ({ id: i, tobaccoId: 1, pipeId: 1, date: "2026-06-01", duration: "30", rating: 4, weightG: "3", aromas: [] }));
    // Same overdue pipe as the test, but maintRemindersEnabled=false
    // must suppress the whole "À entretenir" section.
    const { container } = renderWith({
      ...baseCtx, maintRemindersEnabled: false,
      data: { ...baseCtx.data, pipes: [duePipe], sessions },
    });
    expect(container.textContent).not.toContain("maint_due");
    expect(container.textContent).not.toContain("maint_never");
  });

  it("makes the 'Votre profil' families and aromas clickable", () => {
    const navToInvFiltered = vi.fn();
    const navToInvByAroma = vi.fn();
    // baseCtx has an Anglais 5★ tobacco + a 5★ session with leather/smoky
    // aromas → computeTasteProfile yields a family + signature aromas.
    const { container } = renderWith({ ...baseCtx, navToInvFiltered, navToInvByAroma });
    const buttons = Array.from(container.querySelectorAll("button"));
    const famBtn = buttons.find((b) => (b.textContent || "").trim() === "Anglais");
    expect(famBtn, "family should be a clickable button").toBeTruthy();
    fireEvent.click(famBtn!);
    expect(navToInvFiltered).toHaveBeenCalledWith("Anglais", "");
    const aromaBtn = buttons.find((b) => /^aroma_(leather|smoky)$/.test((b.textContent || "").trim()));
    expect(aromaBtn, "aroma should be a clickable button").toBeTruthy();
    fireEvent.click(aromaBtn!);
    expect(navToInvByAroma).toHaveBeenCalledTimes(1);
    expect(String(navToInvByAroma.mock.calls[0]![0])).toMatch(/leather|smoky/);
  });

  // The "Tabacs" top-bar tile shows the OWNED count (activeRefs),
  // so its drill must land on the "active" list — not "all" (which adds
  // fully-finished tabacs). Previously it set "all".
  it("the 'Tabacs' top-bar tile drills to the OWNED (active) inventory", () => {
    const nav = vi.fn();
    const setStatusFilter = vi.fn();
    renderWith({ ...baseCtx, nav, setStatusFilter });
    // PressCard renders <div role="button"> — click the tile via its label.
    const tile = screen.getByText("nav_tobaccos").closest('[role="button"]');
    expect(tile, "expected a Tabacs tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(nav).toHaveBeenCalledWith("inv");
    expect(setStatusFilter).toHaveBeenCalledWith("active");
    expect(setStatusFilter).not.toHaveBeenCalledWith("all");
  });

  // The average-rating tile used to be inert (no onClick); it now
  // drills to the Statistics page.
  it("the 'Moyenne' top-bar tile navigates to the Statistics page", () => {
    const nav = vi.fn();
    renderWith({ ...baseCtx, nav });
    const tile = screen.getByText("stat_avg").closest('[role="button"]');
    expect(tile, "expected a Moyenne tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(nav).toHaveBeenCalledWith("stats");
  });

  // The "À point" positive-maturity section lists tobaccos matured
  // into their optimal window and cross-opens the fiche (back → Home).
  it("shows the 'À point' section for a tobacco in its optimal window", () => {
    const crossOpenDetail = vi.fn();
    // A separate open-jar tin becomes the "Ce soir ?" hero; the optimal tin must
    // therefore NOT be the hero to land in "À point".
    const heroTin = {
      id: 1, brand: "Pellworm", name: "HeroJar", category: "Aromatique", agingMax: "3",
      lots: [{ status: "jar", weightG: "30", dateProduction: new Date().toISOString().slice(0, 10) }],
      aromas: [],
    };
    // agingMax "10" → optimal window starts at 4y; a 6y lot is optimal, no
    // peak/tooOld lot. weightG 100 (> 50) so it isn't flagged "low stock".
    const optimalTob = {
      id: 7, brand: "Halvorsen", name: "Harbour Mixture", category: "Virginia", rating: 5, agingMax: "10",
      lots: [{ status: "cellar", weightG: "100", dateProduction: new Date(Date.now() - 6 * 365.25 * 86400000).toISOString().slice(0, 10) }],
      aromas: [],
    };
    const { container } = renderWith({
      ...baseCtx, crossOpenDetail,
      data: { tobaccos: [heroTin, optimalTob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).toContain("home_peak_title");
    // The "à point" row is the one carrying the home_peak_chip chip.
    const peakRow = Array.from(container.querySelectorAll('[role="button"]'))
      .find((b) => (b.textContent || "").includes("home_peak_chip"));
    expect(peakRow, "expected an À-point row").toBeTruthy();
    fireEvent.click(peakRow!);
    // CHANGED: the payload now carries `scope: "optimal"`. Reported from the
    // app — the row named a tobacco, the fiche opened on ALL its lots, and the
    // four that earned the "à point" chip had to be found among them. The row
    // is built from `computeCellarPeaks`, which selects on that band, so the
    // band is what the fiche must open on; the fiche names the slice and offers
    // "Tout afficher". Asserting the full object rather than a partial match is
    // deliberate: it is how this case noticed the change at all.
    expect(crossOpenDetail).toHaveBeenCalledWith({ view: "inv", kind: "tobacco", obj: optimalTob, scope: "optimal" });
  });

  it("hides the 'À point' section when no tobacco is in its optimal window", () => {
    // A young tin only (0.5y with agingMax 10 → young, not optimal).
    const youngTob = {
      id: 1, brand: "X", name: "Young", category: "Virginia", agingMax: "10",
      lots: [{ status: "cellar", weightG: "50", dateProduction: new Date().toISOString().slice(0, 10) }],
      aromas: [],
    };
    const { container } = renderWith({
      ...baseCtx,
      data: { tobaccos: [youngTob], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    expect(container.textContent).not.toContain("home_peak_title");
  });

  // The shopping-list cart was REMOVED from the Home top bar (it
  // lives only on the tobacco inventory top bar now). Even with something to
  // buy, the Home must not render a cart icon.
  it("never renders the shopping-list cart on the Home top bar", () => {
    const lowTob = { id: 1, brand: "D", name: "N", category: "Virginia", rating: 4, agingMax: "",
      lots: [{ status: "jar", weightG: "10" }], aromas: [] };
    const { container } = renderWith({
      ...baseCtx, watchLowWeight: "25",
      data: { tobaccos: [lowTob], pipes: [], accessories: [], sessions: [], wishlist: [{ id: 9, brand: "W", name: "Want" }] },
    });
    const cart = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").includes("shopping_title"));
    expect(cart).toBeFalsy();
  });

  it("renders without crashing on completely empty data", () => {
    const empty = {
      ...baseCtx,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      stats: {},
    };
    const { container } = renderWith(empty);
    expect(container.firstChild).not.toBeNull();
    // zones still render (they don't depend on data presence)
    expect(screen.getByText("home_zone_dash")).toBeInTheDocument();
  });
});

// ── THE ACCORD CHIP WAS A BUTTON INSIDE A BUTTON ──────────────────────────
//
// The « Ce soir ? » hero is a `PressCard`, i.e. `role="button"`, and the
// paired-pipe chip was rendered INSIDE it as a real `<button>`. axe calls that
// `nested-interactive` (WCAG 4.1.2) and the cost is concrete: VoiceOver
// flattens a button's subtree into its accessible name, so the chip was not
// separately focusable and the whole accord shortcut was unreachable to that
// user — on the app's landing screen.
//
// It was also fighting the platform, and its own comment said so: the chip
// carried `stopPropagation` on pointerdown, pointerup AND click because "a
// click-only stopPropagation leaked and opened the tobacco". Outside the card
// there is nothing to leak into.
//
// FOUND BY THE a11y SUITE ONLY AFTER ITS FIXTURE STOPPED BEING AN EMPTY
// CELLAR — with no suggestion there is no hero, and with no rested pipe there
// is no chip to nest.
describe("HomeViewV2 — the accord chip is not nested in the hero card", () => {
  it("the pipe chip is OUTSIDE every role=button ancestor", () => {
    const crossOpenDetail = vi.fn();
    const { container } = renderWith({ ...baseCtx, crossOpenDetail });
    const chip = [...container.querySelectorAll("button")]
      .find((b) => /Halvorsen SH/.test(b.textContent || ""));
    expect(chip, "the paired-pipe chip is not rendered — check the fixture").toBeTruthy();
    expect(chip!.closest('[role="button"]'),
      "the chip is nested inside a role=button: VoiceOver cannot reach it").toBeNull();
  });

  it("…and the hero card is still a control in its own right", () => {
    // Non-vacuity, and the half a careless fix would break: moving the chip out
    // must not cost the card its own tap target.
    const { container } = renderWith(baseCtx);
    const cards = [...container.querySelectorAll('[role="button"]')]
      .filter((el) => /Duskfall/.test(el.textContent || ""));
    expect(cards.length, "the hero stopped being tappable").toBeGreaterThan(0);
  });

  it("tapping the chip opens the PIPE, and nothing else fires", () => {
    // The propagation dance is gone, so this is the assertion that replaces
    // it: one tap, one destination.
    const crossOpenDetail = vi.fn();
    const { container } = renderWith({ ...baseCtx, crossOpenDetail });
    const chip = [...container.querySelectorAll("button")]
      .find((b) => /Halvorsen SH/.test(b.textContent || ""));
    fireEvent.click(chip!);
    expect(crossOpenDetail).toHaveBeenCalledTimes(1);
    expect(crossOpenDetail.mock.calls[0]![0]).toMatchObject({ view: "pipes", kind: "pipe" });
  });
});
