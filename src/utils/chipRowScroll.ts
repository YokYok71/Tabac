// Where a scrollable chip row must scroll so a given child is
// visible.
//
// Reported from the app: open Settings on Aide, tap Préférences, and the tab
// strip stays where Aide left it — so the ACTIVE tab renders clipped
// ("…férences") with its brass underline half off-screen. The DOM scroller
// persists its scrollLeft across re-renders; the same fact was met on the
// inventory chips and answered with `resetScrollSignal`, a jump to the far
// left. That is not the answer here: the strip must show whichever tab is
// active, which is a different target in each direction.
//
// Pure because jsdom lays nothing out — offsetLeft, offsetWidth and clientWidth
// are all 0 there, so the arithmetic cannot be exercised through a render. The
// component reads the four numbers and this function decides.

export interface ChipRowGeometry {
  /** Child's left edge, in the scroller's own layout coordinates. */
  x: number;
  /** Child's width. */
  w: number;
  /** The scroller's horizontal padding — the gutter that should stay visible. */
  padL: number;
  padR: number;
  /** Where the scroller currently sits, and how much of it is visible. */
  scrollLeft: number;
  clientWidth: number;
}

/**
 * Returns the scrollLeft that brings the child fully into view, or `null` when
 * it is already visible.
 *
 * `null` is the load-bearing case: a row that re-scrolls on every render fights
 * the user's own swipe, and a tab strip they have deliberately scrolled must
 * stay put while the active tab is still on screen. Only the minimum move is
 * made — the child is brought to whichever edge it fell off, never centred,
 * because centring moves the row when it did not need to move.
 */
export function chipRowScrollTarget(g: ChipRowGeometry): number | null {
  // Degenerate geometry (jsdom, a hidden row, a not-yet-laid-out mount): there
  // is nothing meaningful to compute, and guessing would scroll to 0.
  if (!(g.clientWidth > 0) || !(g.w > 0)) return null;

  // Include the gutter in the target so the first chip lands flush at 0 with
  // its padding showing, rather than 18px into the row.
  const wantLeft = g.x - g.padL;
  const wantRight = g.x + g.w + g.padR;

  if (wantLeft < g.scrollLeft) return Math.max(0, wantLeft);
  if (wantRight > g.scrollLeft + g.clientWidth) return Math.max(0, wantRight - g.clientWidth);
  return null;
}
