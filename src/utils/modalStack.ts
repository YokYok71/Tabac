// Global open-modal stack.
//
// Every mounted-open `Modal` (components/curator/Modal.tsx) registers its close
// handler here; goBack (App.tsx) closes the TOP-most open modal before any
// view routing, so a swipe-back / system-back always dismisses the front
// modal — including view-local ones the nav layer never knew about (the
// catalog QuickAdd / fiche, lot & maintenance modals, the cellar-confirm, the
// encryption prompt, …). Module-level + framework-free so it's unit-testable.
//
// LIFO by registration order = visual stacking order (a modal opened later
// renders on top), so closing the top entry matches what the user sees.

var _stack: Array<() => void> = [];

// Subscribers to "is any modal open". Module state does not re-render React,
// and the five `top: 0` banners have to STAND DOWN the moment a modal opens —
// they sit at z489-492 against the modal's z200, so one raised over a modal
// covers its header including the 44 px close X, outside its focus trap.
//
// `pickTopBanner` used to gate on four App-level states listed BY NAME
// (importModal / searchOpen / trashOpen / lightbox), which left every
// view-local modal invisible to it — the lot form, the maintenance form, the
// catalogue fiche, the comparison, the encryption prompt, the unsaved-changes
// confirm, the countdown dialog. Enumerating them is the same mistake as the
// pairwise banner yields `bannerStack.ts` was written to end, so the gate asks
// THIS registry instead: the one every `Modal` already reports to, and the one
// `goBack` already consults, so the two can never disagree.
var _subs: Array<(open: boolean) => void> = [];

function _notify(): void {
  var open = _stack.length > 0;
  // Copy: a subscriber may unsubscribe from inside its own callback.
  var list = _subs.slice();
  for (var i = 0; i < list.length; i++) {
    try { list[i]!(open); } catch (_e) { /* a bad subscriber must not wedge the stack */ }
  }
}

// Observe "is any modal open". Calls `fn` with the CURRENT state immediately,
// so a subscriber mounted while a modal is already up is not left behind, then
// on every change. Returns an unsubscribe function.
export function subscribeModalStack(fn: (open: boolean) => void): () => void {
  _subs.push(fn);
  try { fn(_stack.length > 0); } catch (_e) { /* ignore */ }
  return function () {
    var i = _subs.lastIndexOf(fn);
    if (i !== -1) _subs.splice(i, 1);
  };
}

// Register an open modal's close handler. Returns an unregister function
// (call on close / unmount). Idempotent-safe: unregister removes THIS entry
// even if others were pushed/popped meanwhile.
export function pushModalClose(close: () => void): () => void {
  _stack.push(close);
  _notify();
  return function () {
    var i = _stack.lastIndexOf(close);
    if (i !== -1) { _stack.splice(i, 1); _notify(); }
  };
}

export function hasOpenModal(): boolean {
  return _stack.length > 0;
}

// Is `fn` the TOP-most registered close handler? Used by the
// Modal Escape handler so only the front modal reacts to Escape — otherwise
// every stacked modal's window keydown listener fires and they ALL close at
// once (e.g. the encryption prompt over Settings → both close, dumping the user
// to Home). Mirrors the stack-aware system-back gesture (closeTopModal).
export function isTopModalClose(fn: (() => void) | null | undefined): boolean {
  return !!fn && _stack.length > 0 && _stack[_stack.length - 1] === fn;
}

// Close the top-most open modal; returns true if one was closed. Pops the
// entry immediately so hasOpenModal() reflects reality even before the modal's
// own effect-cleanup unregister runs (that cleanup then no-ops — its
// lastIndexOf can't find the already-removed handler).
export function closeTopModal(): boolean {
  var fn = _stack.pop();
  if (fn) { _notify(); fn(); return true; }
  return false;
}

// Test-only reset. Notifies too — a leftover `true` from a prior test would
// silence every banner in the next one.
export function _resetModalStack(): void {
  _stack = [];
  _notify();
}
