// Pure dock-visibility decision, extracted from CuratorApp so it can be
// unit-tested. The bottom dock is a floating pill that scrolls
// OVER the page content; on the long, scrollable READING pages it clutters
// and overlaps the text (users reported it as "the doc bug is on every
// page"). Those pages carry their own back button in the TopBar, so the dock
// is pure noise there — hide it.
//
// Hidden on:
//   • the live tasting + every full-screen form (they take over the screen);
//   • the reading / doc pages: help, changelog, privacy, licenses.
//     (This REVERSED an earlier decision to KEEP the dock on the doc pages —
//     the overlap was worse than the saved tap. Do NOT put them back.)
export const NO_DOCK_VIEWS: ReadonlySet<string> = new Set([
  "tasting",
  "addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ",
  "help", "changelog", "privacy", "licenses",
]);

export interface DockGate {
  showWishForm?: boolean | undefined;
  editWishId?: unknown;
}

// The dock shows unless the current view is a takeover/reading view OR the
// wishlist form is covering the screen (showWishForm / editWishId).
export function shouldShowDock(view: string, gate: DockGate = {}): boolean {
  return !NO_DOCK_VIEWS.has(view) && !gate.showWishForm && !gate.editWishId;
}
