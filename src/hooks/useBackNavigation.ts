import React from "react";

var useRef = React.useRef,
  useEffect = React.useEffect;

// Back-navigation subsystem extracted from App.tsx — wires the
// two SYSTEM back inputs (browser / hardware back button via `popstate`, and
// the left-edge swipe gesture) to a single "go back" routine so they behave
// identically. In-app back arrows call nav() directly and don't go through
// here.
//
// The ROUTING moved to App.tsx (`onBack`) — it now pops a real
// navigation history STACK (utils/navHistory.ts) instead of the old fixed
// parent-mapping, so back returns to the actual previous screen. This hook
// keeps ONLY the transport: the mount-time history seeding, the 400 ms
// debounce, the edge-swipe detection, and the ref indirection (listeners are
// installed once and always call the LATEST `onBack` closure via `onBackRef`,
// so App's up-to-date state is used). See "Back navigation & gestures" in
// CLAUDE.md.
export function useBackNavigation(onBack: () => void): void {
  var onBackRef = useRef(onBack);
  var lastBackTs = useRef(0);

  // Refresh the ref every render so the listeners (installed once below)
  // always call the latest closure — otherwise it would capture stale state.
  useEffect(function () {
    onBackRef.current = onBack;
  });

  useEffect(function () {
    history.replaceState(null, "", "./");
    history.pushState(null, "", "./");
    function _doBack() {
      var _bt = Date.now();
      if (_bt - lastBackTs.current > 400) {
        lastBackTs.current = _bt;
        if (onBackRef.current) onBackRef.current();
      }
    }
    function _onPop() {
      history.pushState(null, "", "./");
      _doBack();
    }
    window.addEventListener("popstate", _onPop);
    var _swipeStart: { x: number; y: number } | null = null;
    function _onTS(e: any) {
      var t = e.touches[0];
      if (t.clientX < 30) {
        e.preventDefault();
        _swipeStart = { x: t.clientX, y: t.clientY };
      }
    }
    function _onTE(e: any) {
      if (!_swipeStart) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - _swipeStart.x,
        dy = t.clientY - _swipeStart.y;
      _swipeStart = null;
      if (dx > 60 && Math.abs(dy) < 60) _doBack();
    }
    document.addEventListener("touchstart", _onTS, { passive: false });
    document.addEventListener("touchend", _onTE);
    return function () {
      window.removeEventListener("popstate", _onPop);
      document.removeEventListener("touchstart", _onTS);
      document.removeEventListener("touchend", _onTE);
    };
  }, []);
}
