// Dynamic back-navigation history engine (pure).
//
// Replaces the old FIXED "go up one level" parent-mapping in
// useBackNavigation (every screen had ONE hard-coded parent, so system-back /
// edge-swipe from e.g. the session form or Stats always teleported to Home
// instead of the actual previous screen). This module models a real back
// STACK of the screens the user visited, so back returns to where they truly
// came from.
//
// Kept PURE + framework-free so it's exhaustively unit-testable; App.tsx owns
// the ref that holds the live stack and the setters that apply a popped
// location. See "Back navigation & gestures" in docs/integrations.md.

export interface NavLoc {
  view: string;
  // Which detail fiche (if any) was open on that screen — stored by id so the
  // location is stable + serialisable; App re-resolves the object on restore.
  detailId?: string | number | null;
  pipeDetId?: string | number | null;
  accDetId?: string | number | null;
  // The read-only session-detail modal (JournalView) open on that
  // screen — recorded by session id so cross-opening a fiche FROM it (tapping
  // the tabac / pipe block) can pop back and re-open the modal.
  sessionDetailId?: string | number | null;
  // The inventory status filter (drives the wishlist vs inventory split) so a
  // restored inv screen comes back to the right list.
  statusFilter?: string;
  // True when this entry was recorded as a DRILL
  // origin (pushDrillOrigin — crossOpenDetail / navTo* from a tile/chart), as
  // opposed to a normal nav() push of an open fiche (pushLoc, e.g. detail →
  // editT). applyLoc keys `drillOpened` on THIS flag, not on "an overlay id is
  // present" — otherwise restoring a fiche that reached the stack via a plain
  // detail→edit push wrongly kept popping the chain and skipped the drilled
  // list. METADATA only: excluded from locIdentity/sameLoc.
  drill?: boolean;
}

// Full-screen forms are LEAF screens the user drills INTO — back should LEAVE
// them, never land ON them, so they're never pushed as a restorable target.
export var NAV_FORM_VIEWS = ["addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"];
export function isFormView(v: string): boolean {
  return NAV_FORM_VIEWS.indexOf(v) !== -1;
}

// Two locations are "the same screen" when their view + open-detail ids match.
// statusFilter is in-screen state, NOT a distinct screen, so it is excluded
// from identity (changing a filter must not create a history entry) — but it
// IS carried in the snapshot so restore can re-apply it.
export function locIdentity(l: NavLoc): string {
  return (
    l.view +
    "|" + (l.detailId == null ? "" : String(l.detailId)) +
    "|" + (l.pipeDetId == null ? "" : String(l.pipeDetId)) +
    "|" + (l.accDetId == null ? "" : String(l.accDetId)) +
    "|" + (l.sessionDetailId == null ? "" : String(l.sessionDetailId))
  );
}
export function sameLoc(a: NavLoc, b: NavLoc): boolean {
  return locIdentity(a) === locIdentity(b);
}

// The bottom-dock tabs — the app's "main pages". They are siblings under Home
// (the root), not a linear stack, so navigating BETWEEN them must NOT create
// history: back from any main page goes straight to Home. A dock view WITH a
// fiche open is a DRILL state, not a bare root — that IS history-worthy (so
// detail → edit → back returns to the fiche).
export var NAV_ROOT_VIEWS = ["home", "inv", "pipes", "acc", "journal", "stats"];
export function isBareRoot(l: NavLoc): boolean {
  return (
    NAV_ROOT_VIEWS.indexOf(l.view) !== -1 &&
    l.detailId == null &&
    l.pipeDetId == null &&
    l.accDetId == null &&
    l.sessionDetailId == null
  );
}


// Whether a LEAVING location is worth pushing onto the back stack.
// Skips: forms + the live tasting view (transient/leaf — the tasting banner
// owns "resume"), AND bare dock/main pages (no history between
// main pages; back from a main page falls through to Home via fallbackParent).
export function isRestorable(l: NavLoc): boolean {
  return !isFormView(l.view) && l.view !== "tasting" && !isBareRoot(l);
}

// Push `leaving` onto `stack`, returning a NEW array (immutable — easy to
// test + reason about). Skips non-restorable locations and de-dups against the
// current top so rapid same-screen navs don't pile up. Caps the depth so the
// stack can never grow unbounded over a long session.
export function pushLoc(stack: NavLoc[], leaving: NavLoc, cap: number = 40): NavLoc[] {
  if (!isRestorable(leaving)) return stack;
  if (stack.length && sameLoc(stack[stack.length - 1]!, leaving)) return stack;
  var next = stack.concat([leaving]);
  if (next.length > cap) next = next.slice(next.length - cap);
  return next;
}

// Like pushLoc, but ALSO records a bare-root origin (Home, or a
// bare dock page). Used by crossOpenDetail when DRILLING from a tile into a
// fiche / the wishlist, so system-back can return to that origin (e.g. Home)
// instead of closing the overlay to its underlying list. Still skips forms +
// the live tasting view (never a back TARGET) and de-dups the current top.
// A running TASTING is a valid drill ORIGIN — its
// tobacco/pipe rows open their fiche, and back must return to the session
// (reported: « le swipe back ne me ramène pas dans la session »). It stays
// non-restorable for `pushLoc`, i.e. it never becomes an ordinary history entry;
// only an explicit drill records it. The blank-screen risk that argued against
// this — the 95-minute auto-end clearing the session while the user reads the
// fiche — is handled where it belongs, in `decideBack`, which drops a dead
// tasting origin instead of navigating to it. See `usableStack`.
export function pushDrillOrigin(stack: NavLoc[], leaving: NavLoc, cap: number = 40): NavLoc[] {
  if (isFormView(leaving.view)) return stack;
  if (stack.length && sameLoc(stack[stack.length - 1]!, leaving)) return stack;
  // Stamp `drill:true` so applyLoc can tell a genuine
  // drill origin from a normal nav() push of the same screen shape.
  var next = stack.concat([Object.assign({}, leaving, { drill: true })]);
  if (next.length > cap) next = next.slice(next.length - cap);
  return next;
}

// The new back stack after a forward nav() to `targetView`, leaving `leaving`.
// Landing on a MAIN page (dock tab / root) RESETS the stack — a
// main page is a root, not a history cran, so back from it goes to Home. Only
// a drill into a SUB-screen (form / catalog / doc / fiche-via-nav) records the
// screen we're leaving. Fixes the "back returns to the last-open fiche"
// regression: navigating away from an open fiche via a dock tab used to push
// that fiche (a drill state) onto the stack.
export function nextStackOnNav(stack: NavLoc[], targetView: string, leaving: NavLoc): NavLoc[] {
  if (NAV_ROOT_VIEWS.indexOf(targetView) !== -1) return [];
  return pushLoc(stack, leaving);
}

// The minimal parent-mapping used when the history stack is empty (the very
// first taps of a fresh session, or after the stack drains). Mirrors the old
// fixed routing this replaced, so behaviour degrades gracefully. Returns the target
// view, or null to mean "no-op" (already at the root).
export function fallbackParent(view: string): string | null {
  if (view === "editT" || view === "addT" || view === "catalog") return "inv";
  if (view === "editP" || view === "addP") return "pipes";
  if (view === "editA" || view === "addA") return "acc";
  if (view === "editJ" || view === "addJ") return "journal";
  if (view !== "home") return "home";
  return null;
}

// The App-level modals (lightbox, search, trash, Settings) are the
// TOP-most overlays — a swipe-back / system-back closes the front one first,
// before any fiche / view routing. Pure + priority-ordered so it's testable.
export interface OpenModals {
  lightbox?: boolean;
  search?: boolean;
  trash?: boolean;
  settings?: boolean;
}
export function firstOpenModal(m: OpenModals): "lightbox" | "search" | "trash" | "settings" | null {
  if (m.lightbox) return "lightbox";
  if (m.search) return "search";
  if (m.trash) return "trash";
  if (m.settings) return "settings";
  return null;
}

export interface BackState {
  view: string;
  hasDetail: boolean;
  hasPipeDet: boolean;
  hasAccDet: boolean;
  hasWishForm: boolean;
  // The read-only session-detail modal (JournalView), lifted to ctx
  // so system-back / edge-swipe closes it in place instead of navigating away.
  hasSessionDetail?: boolean;
  // The wishlist is a SUB-STATE of the tobacco inventory
  // (view "inv" + statusFilter "wish"), not a separate page — so back from it
  // returns to the tobacco LIST (reset the filter), not Home.
  isWishlist?: boolean;
  // True only when the CURRENTLY-open overlay was reached by a
  // recorded DRILL (crossOpenDetail). Then back POPS to the recorded origin
  // instead of closing the overlay to its list. A fiche opened normally from a
  // list leaves this false → close-in-place, even if a filtered-list origin
  // (Stats/Home) sits on the stack. App owns the flag (drillOverlayRef).
  drillOpened?: boolean;
  // Is a tasting still in progress? A `tasting` origin on the
  // stack is only worth returning to while the session exists — the auto-end at
  // 95 min can clear it while the user is reading a fiche, and navigating to a
  // tasting that is gone renders an empty screen. App owns this (`!!tasting`).
  tastingLive?: boolean;
  stack: NavLoc[];
}
export type BackAction =
  | { kind: "close-detail" }
  | { kind: "close-pipe" }
  | { kind: "close-acc" }
  | { kind: "close-wish" }
  | { kind: "close-session" }
  | { kind: "close-wishlist" }
  | { kind: "pop"; loc: NavLoc; rest: NavLoc[] }
  | { kind: "nav"; target: string }
  | { kind: "none" };

// THE back decision — pure, so the whole routing is exhaustively testable
// without mounting App. Priority: close any open overlay in place first
// (detail / pipe / accessory fiche, wishlist form, session-detail modal), then
// pop the real history stack, then the empty-stack fallback parent-mapping,
// else no-op.
/**
 * The stack minus any `tasting` origin that can no longer be
 * returned to.
 *
 * A tasting is the one origin that can VANISH on its own while the user is away
 * from it: `useTastingSession` auto-ends at 95 minutes, and the user can also
 * end it from the banner. Popping to a `tasting` loc after that would call
 * `nav("tasting")` on a view whose only render gate is `view !== "tasting"` — so
 * it would paint an empty screen with no way to explain itself.
 *
 * Dropping the entry rather than blocking the pop is what keeps the rest of the
 * chain intact: back then continues to whatever origin sits underneath, or falls
 * through to `fallbackParent`, exactly as if the tasting had never been there.
 */
function usableStack(s: BackState): NavLoc[] {
  if (s.tastingLive) return s.stack;
  var st = s.stack;
  while (st.length && st[st.length - 1]!.view === "tasting") st = st.slice(0, -1);
  return st;
}

export function decideBack(s: BackState): BackAction {
  // An overlay reached by a recorded
  // DRILL returns to its ORIGIN on back, instead of closing in place to the
  // overlay's underlying list. crossOpenDetail records that origin on the back
  // stack for every drill INTO an overlay — fiche→fiche ("Top pipes"/"Top
  // tabacs" rows), session-modal→fiche, AND Home-tile→(fiche | wishlist),
  // including bare-root Home (via pushDrillOrigin) — and marks the overlay
  // `drillOpened`. So: when a DRILL-opened overlay is up AND the stack is
  // non-empty, pop to that origin.
  //
  // The gate: the earlier check was "overlay open + non-empty stack",
  // which relied on a fiche opened normally from a list ALWAYS having an empty
  // stack. That stopped being true once the Stats/Home filtered-list drills
  // started recording their origin on the stack (so back returns to Stats, not
  // Home): a fiche then opened from that filtered list had an overlay AND a
  // non-empty stack, and would wrongly skip the list. `drillOpened` restores
  // the precise scope — only a crossOpenDetail overlay pops; a normal
  // list→fiche (drillOpened false) still closes in place below. Do NOT reorder
  // the close-in-place branches before this pop check.
  // `!s.hasWishForm` on the isWishlist term. The wishlist
  // FORM is a full-screen overlay layered ON TOP of the (possibly drilled)
  // wishlist — opened via a plain setShowWishForm/setEditWishId toggle that
  // never clears the drill latch. Without this guard, a Home→Envies drill
  // (drillOpened + isWishlist) with the form open would POP to Home on back,
  // abandoning the form, instead of closing the form first. Closing the form
  // (close-wish, below) leaves the drilled wishlist; the NEXT back then pops to
  // the drill origin. The fiche overlays don't need this — they can't coexist
  // with the wish form.
  var st = usableStack(s);
  if (s.drillOpened && (s.hasDetail || s.hasPipeDet || s.hasAccDet || (s.isWishlist && !s.hasWishForm)) && st.length) {
    return { kind: "pop", loc: st[st.length - 1]!, rest: st.slice(0, -1) };
  }
  if (s.hasDetail) return { kind: "close-detail" };
  if (s.hasPipeDet) return { kind: "close-pipe" };
  if (s.hasAccDet) return { kind: "close-acc" };
  if (s.hasWishForm) return { kind: "close-wish" };
  if (s.hasSessionDetail) return { kind: "close-session" };
  // The wishlist sub-state returns to the tobacco list, not Home.
  if (s.isWishlist) return { kind: "close-wishlist" };
  if (st.length) {
    return { kind: "pop", loc: st[st.length - 1]!, rest: st.slice(0, -1) };
  }
  var target = fallbackParent(s.view);
  return target ? { kind: "nav", target: target } : { kind: "none" };
}
