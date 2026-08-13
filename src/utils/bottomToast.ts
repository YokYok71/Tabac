// ONE bottom toast at a time, and none of them under the dock.
//
// The mirror of `bannerStack.ts` for the other end of the screen.
// Four overlays are `position: fixed` near the bottom at `zIndex: 500`:
//
//   CuratorUndoToast         bottom: calc(env(safe-area-inset-bottom,0) + 96px)
//   CuratorImportRecapToast  bottom: 40
//   CuratorJustUpdatedToast  bottom: 40
//   CuratorLangDetectedToast bottom: 40
//
// TWO defects, and the second is the one the top banners already taught us.
//
// (1) THE DOCK. The BottomDock pill is ~42 px tall and sits on a padding of
//     `max(env(safe-area-inset-bottom) - 20px, 6px)`, so on a phone with a home
//     indicator its top edge is around 56 px from the bottom — above `bottom:
//     40`. The toasts are z500 and the dock is z30, so the toast wins and
//     covers the dock labels. Only the undo toast was ever given
//     clearance, and it got it as a local literal rather than a shared value,
//     which is exactly how the other three drifted away from it.
//
// (2) THE SHARED SLOT. Three of them are at the SAME offset and the SAME
//     z-index, so any two visible together are stacked with DOM order silently
//     picking the winner — the top-banner finding, verbatim, at the bottom of
//     the screen. Reachable: a merge import run from Settings can raise the
//     recap while the just-updated toast is still on its timer.
//
// WHY THERE IS NO MODAL GATE HERE, unlike the top banners. `pickTopBanner`
// stands every banner down while a modal is open, because a top banner covers
// the modal header including its 44 px close X. These sit at the BOTTOM and do
// not cover it — and more importantly the import recap IS the feedback for an
// action taken inside Settings, so hiding it would break the same action-→-
// feedback adjacency rule that put the catalogue offer under the brand field
// and the cloud-save status under the save button. Different end of the
// screen, opposite answer, on purpose.

export type BottomToastId =
  | "undo"
  | "importRecap"
  | "justUpdated"
  | "langDetected"
  | null;

export interface BottomToastState {
  undoToast?: unknown;
  importRecap?: unknown;
  justUpdated?: unknown;
  langDetected?: unknown;
}

// Most urgent first. `undo` leads because it is the only one that expires: an
// 8-second window to reverse a deletion, against three toasts that merely
// inform. `langDetected` is last because it is a one-shot courtesy on first
// launch and the language is visible on every screen anyway.
export const BOTTOM_TOAST_ORDER: Exclude<BottomToastId, null>[] = [
  "undo",
  "importRecap",
  "justUpdated",
  "langDetected",
];

/**
 * THE bottom offset. Every toast in this family uses it, so the dock clearance
 * cannot drift the way it did between the undo toast and the other three.
 *
 * 96px = the dock pill (~42) + its safe-area padding + breathing room, which
 * is the value the undo toast has always carried and is the one
 * checked on a real device. Verify any change on the INSTALLED iOS PWA — the
 * safe-area inset is precisely what headless cannot reproduce.
 */
export const BOTTOM_TOAST_OFFSET = "calc(env(safe-area-inset-bottom, 0px) + 96px)";

export function pickBottomToast(s: BottomToastState | null | undefined): BottomToastId {
  if (!s) return null;
  if (s.undoToast) return "undo";
  if (s.importRecap) return "importRecap";
  if (s.justUpdated) return "justUpdated";
  if (s.langDetected) return "langDetected";
  return null;
}
