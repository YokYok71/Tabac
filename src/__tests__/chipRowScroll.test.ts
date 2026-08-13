import { describe, it, expect } from "vitest";
import { chipRowScrollTarget } from "../utils/chipRowScroll";

// The Settings tab strip kept the scroll position of the tab
// you came FROM, so arriving at Préférences from Aide rendered the active tab
// clipped ("…férences") with its brass underline half off-screen. Reported from
// the app with a screenshot.
//
// The row is a `ScrollableChipRow`, and the DOM scroller persists its
// scrollLeft across re-renders — the same fact met earlier on the inventory
// chips. Its answer there was `resetScrollSignal`, a jump to the far left; that
// is the wrong answer for a tab strip, where the target differs per direction.
//
// Pure because jsdom lays nothing out: offsetLeft / offsetWidth / clientWidth
// are all 0 there, so the arithmetic is unreachable through a render.
//
// A HEADLESS CLICK MASKS THIS DEFECT, and the masking is worth more than the
// fix. A Playwright `.click()` dispatches real mouse events, which FOCUS the
// button, and the browser then scrolls the focused element into view — so the
// same sequence measured 18px (flush, nothing clipped) instead of the reported
// clipping. Activating with an in-page `element.click()`, which fires the
// handler without moving focus, reproduces it exactly: the strip stays at 53
// and the active tab is cut by 35px. That no-focus path is what an iOS tap on a
// <button> does — the very fact that made `preventScroll` necessary.
// MEASURED both ways before and after the fix. **When checking whether a
// scroller lands where it should, activate without focus, or you are measuring
// the browser's focus-scroll rather than the app.**
//
// Geometry used below is the real one, measured at 402px CSS in French:
// scroller clientWidth 376, padding 18, tabs at x = 18 / 158 / 275 / 402 with
// widths 140 / 117 / 127 / 73.
const ROW = { padL: 18, padR: 18, clientWidth: 376 };
const TAB = [
  { x: 18, w: 140 },   // Préférences
  { x: 158, w: 117 },  // Données
  { x: 275, w: 127 },  // Application
  { x: 402, w: 73 },   // Aide
];

describe("chipRowScrollTarget", () => {
  it("scrolls LEFT to reveal a child that fell off the left edge", () => {
    // The reported case: strip parked to show Aide, user taps Préférences.
    const scrolled = 99;                              // fully right
    const t = chipRowScrollTarget({ ...ROW, ...TAB[0]!, scrollLeft: scrolled });
    expect(t).toBe(0);                                // flush, gutter showing
  });

  it("scrolls RIGHT to reveal a child that fell off the right edge", () => {
    // Fresh open on the persisted "Aide" tab: the row starts at 0 and Aide is
    // off-screen to the right. That case was broken too, in silence.
    const t = chipRowScrollTarget({ ...ROW, ...TAB[3]!, scrollLeft: 0 });
    expect(t).toBe(402 + 73 + 18 - 376);              // 117
  });

  it("does NOT move when the child is already fully visible", () => {
    // Load-bearing: a row that re-scrolls on every render fights the user's own
    // swipe. Données at scrollLeft 0 is entirely within the window.
    expect(chipRowScrollTarget({ ...ROW, ...TAB[1]!, scrollLeft: 0 })).toBeNull();
  });

  it("moves the MINIMUM, never centring", () => {
    // Application at scrollLeft 0 overflows the right edge by a little; the
    // target must be exactly enough, not a recentring jump.
    const t = chipRowScrollTarget({ ...ROW, ...TAB[2]!, scrollLeft: 0 });
    expect(t).toBe(275 + 127 + 18 - 376);             // 44
    // Centring would put it near (275 + 127/2) - 376/2 = 150.5 — far more
    // movement than the row needs, and visibly jarring on a 4-tab strip.
    expect(t).toBeLessThan(60);
  });

  it("never returns a negative scrollLeft", () => {
    // A child at x smaller than the padding (or a padding wider than the child
    // offset) would compute below zero; the browser clamps, but a negative is
    // a lie the next comparison would act on.
    expect(chipRowScrollTarget({ padL: 40, padR: 18, clientWidth: 376, x: 5, w: 60, scrollLeft: 90 })).toBe(0);
  });

  it("stays silent on degenerate geometry", () => {
    // jsdom, a hidden row, a mount before layout — all report zeros. Guessing
    // there would scroll a visible row to 0 for no reason.
    expect(chipRowScrollTarget({ ...ROW, x: 0, w: 0, scrollLeft: 0 })).toBeNull();
    expect(chipRowScrollTarget({ ...ROW, clientWidth: 0, x: 18, w: 140, scrollLeft: 0 })).toBeNull();
  });

  it("is idempotent — applying the target leaves nothing to do", () => {
    // Otherwise the effect could oscillate between two positions on re-render.
    for (const tab of TAB) {
      for (const from of [0, 44, 99, 117]) {
        const first = chipRowScrollTarget({ ...ROW, ...tab, scrollLeft: from });
        if (first == null) continue;
        expect(chipRowScrollTarget({ ...ROW, ...tab, scrollLeft: first })).toBeNull();
      }
    }
  });
});
