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

// Register an open modal's close handler. Returns an unregister function
// (call on close / unmount). Idempotent-safe: unregister removes THIS entry
// even if others were pushed/popped meanwhile.
export function pushModalClose(close: () => void): () => void {
  _stack.push(close);
  return function () {
    var i = _stack.lastIndexOf(close);
    if (i !== -1) _stack.splice(i, 1);
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
  if (fn) { fn(); return true; }
  return false;
}

// Test-only reset.
export function _resetModalStack(): void {
  _stack = [];
}
