import React from "react";

// A LIST THAT IS FLAT AND LONG IS RENDERED A WINDOW AT A TIME.
//
// MEASURED in Chromium at 390x844, on a 300-tobacco / 200-pipe / 5000-session
// cellar with a 20 000-row catalogue loaded:
//
//   screen                        DOM nodes    heap    page height    to render
//   journal, grouped (default)        4 142   16 MB       13 391 px       2.1 s
//   journal, FLAT                   185 654  149 MB      670 455 px      13.3 s
//   inventory, grouped (default)        437   18 MB        2 358 px       2.0 s
//   inventory, FLAT                  21 757   35 MB       70 298 px       2.5 s
//   catalogue, grouped (default)      2 935   31 MB       19 801 px       4.6 s
//   catalogue, FLAT                 200 613   93 MB    1 220 601 px      13.2 s
//
// So the grouped defaults are fine and it is the FLAT states that freeze the
// main thread — for THIRTEEN SECONDS, on a single tap of a toggle that sits in
// the controls row of the journal and of the catalogue, or permanently once
// « Listes groupées par défaut » is turned off in Réglages. Nothing on screen
// says why the app has stopped responding.
//
// WHAT THIS IS AND IS NOT. It renders a growing PREFIX: the first `step` rows,
// extended when a sentinel below the last one comes into view, with a labelled
// button doing the same thing for anyone who does not get an observer (no
// IntersectionObserver, keyboard navigation, a reduced-motion scroll). It is
// NOT windowing — nothing is recycled, so a reader who genuinely scrolls to the
// end of 20 000 rows still ends up with all of them in the DOM.
//
// **RESIDUAL, DISCLOSED:** that ceiling is unchanged. What changes is that it
// is now reached gradually, by someone travelling 1.2 million pixels on
// purpose, instead of instantly on a tap. Real windowing needs measured row
// heights (the cards are variable-height: a photo, a wrapping name, an optional
// notes block) and the app scrolls the WINDOW with no inner container, so it
// would be a hand-rolled virtualiser — and jsdom reports every layout offset as
// 0, so nothing in this suite could exercise it. An unverifiable component is a
// worse trade than a bounded, testable one.
//
// THE CAP NAMES ITSELF. Same rule as the Home's maintenance section
// (`MAINT_HOME_ROWS` + « voir les N autres »): a cap is legitimate, a cap that
// hides its own existence is not. `ProgressiveMore` renders the count, and the
// two must move together.

/** Rows in the first window, and in each extension.
 *
 *  Chosen so an ORDINARY collection never meets the cap at all — the reference
 *  cellar this app was built around holds 58 tobaccos — while the pathological
 *  cases above are bounded. It is a row count rather than a node budget because
 *  the three lists differ by 7x per row (catalogue ~10 nodes, journal ~37,
 *  inventory ~72, from the table above), and the sentinel extends as needed:
 *  the number only has to be big enough that the first window fills a few
 *  screens, not tuned. */
export var PROGRESSIVE_STEP = 60;

export interface ProgressiveList<T> {
  /** The prefix to render. */
  visible: T[];
  /** How many rows are NOT rendered. 0 when everything is shown. */
  hidden: number;
  /** Reveal one more step. */
  revealMore: () => void;
  /** Attach below the last row; entering the viewport extends the window. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useProgressiveList<T>(
  items: T[] | null | undefined,
  step?: number,
): ProgressiveList<T> {
  // A step that is not a positive finite number is GARBAGE and falls back to
  // the default. Clamping it to 1 instead — which is what `Math.max(1, …)`
  // alone does with a negative — would put the footer under every single row,
  // a UI nobody could use, in answer to a caller's typo.
  var n = Number(step);
  var size = Number.isFinite(n) && n >= 1 ? Math.floor(n) : PROGRESSIVE_STEP;
  var list: T[] = Array.isArray(items) ? items : [];

  // THE COUNT IS PLAIN STATE, DELIBERATELY NOT RESET WHEN THE SOURCE CHANGES.
  //
  // The first version keyed it to the array's IDENTITY so a new filter started
  // a fresh window. That is a trap, and its own test caught it: a caller that
  // builds its list inline rather than in a `useMemo` gets a NEW array every
  // render, so the stored count is never recognised, `revealMore` is discarded
  // on the very next render, and the list is stuck at one step for ever — a
  // silent, permanent dead end whose only symptom is a button that does
  // nothing. A hook whose correctness depends on how its caller happens to
  // build an argument is the wrong shape.
  //
  // Not resetting is also SAFE, which is what settles it: the count only ever
  // grows by an explicit gesture, so after a search the reader gets at most as
  // many rows as they had already revealed and already paid for. There is no
  // path back to a 13-second frame. What it costs is that a narrowed list can
  // render more rows than the reader will scroll — waste they had already
  // accepted a moment earlier, and bounded by their own thumb.
  // Array-destructured rather than this file's usual `var _c = useState(...)`
  // idiom: `react-hooks/exhaustive-deps` recognises a setter only in that
  // shape, and behind the index form it asks for `setCount` in the deps of
  // `revealMore` — a warning for a value React guarantees is stable. The
  // budget is exactly seven deliberate warnings, and none of them should be a
  // linter failing to see through a spelling.
  const [count, setCount] = React.useState(size);

  var visible = count >= list.length ? list : list.slice(0, count);
  var hidden = list.length - visible.length;

  var revealMore = React.useCallback(function () {
    setCount(function (c) { return c + size; });
  }, [size]);

  var sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(function () {
    if (hidden <= 0) return;
    var el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // `visible.length` is in the deps so the observer is rebuilt after every
    // extension: an IntersectionObserver only reports a CHANGE, and a short
    // step can leave the sentinel still inside the root margin, where it would
    // otherwise sit un-fired for ever.
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i]!.isIntersecting) { revealMore(); return; }
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return function () { io.disconnect(); };
  }, [hidden, visible.length, revealMore]);

  return { visible: visible, hidden: hidden, revealMore: revealMore, sentinelRef: sentinelRef };
}

// ── THE OTHER DOOR: A GROUP THAT IS EXPANDED ────────────────────────────────
//
// `useProgressiveList` bounded the FLAT branch of every long list, and the note
// written with it said the grouped branch was "naturally bounded (one collapsed
// row per brand)". MEASURED, that was wrong — it had been measured on a fixture
// with NINE groups, so it measured nine headers and nothing else. With one
// group EXPANDED, in jsdom:
//
//   screen                       collapsed        one group expanded
//   journal (one month)                 86               185 093 nodes
//   inventory (one brand)               92               140 093 nodes
//   catalogue (one brand)              128               200 073 nodes
//   catalogue, 20 000 BRANDS       140 065                          —
//
// Which is the same order as the flat states the whole progressive-rendering
// pass was written for, one tap away, on lists whose group headers invite
// exactly that tap. A cap on the flat branch alone is half a fix.
//
// WHY THIS IS A SECOND HOOK RATHER THAN THE FIRST ONE REUSED. `useProgressiveList`
// keeps ONE count, and a view has as many expanded groups as the reader opens —
// so it would need one hook per group, called from inside a `.map()`, which the
// rules of hooks forbid outright. This keeps one `Record<key, number>` for the
// whole view instead, the same shape the `collapsed` maps already have.
//
// THE MAP IS NULL-PROTOTYPE, and here that is correctness rather than house
// style: the key is a BRAND from the user's own CSV (or a month key), so a row
// keyed `__proto__` resolves to a member of `Object.prototype` on a plain
// object — truthy, not a number — and the count comparison then reads as
// nonsense. `CatalogView`'s `collapsed` is null-prototype for this exact
// reason, and `Object.assign({}, prev)` in the updater would hand the prototype
// straight back, so the copy is null-prototype too.
//
// **RESIDUAL, DISCLOSED: no IntersectionObserver inside a group.** The flat
// hook's sentinel makes browsing continuous; giving each group its own would
// mean a callback ref per key feeding a shared observer, i.e. real machinery
// for the accelerator rather than the guarantee. The BUTTON is the way through,
// and it is the same trade the Home's maintenance section already makes. What
// must never be true is a cap that hides its own existence — `ProgressiveMore`
// prints the remaining count either way.
export interface ProgressiveGroups {
  /** How many rows of this group may render. */
  shownFor: (key: string) => number;
  /** Reveal one more step inside this group. */
  revealMoreIn: (key: string) => void;
}

export function useProgressiveGroups(step?: number): ProgressiveGroups {
  var n = Number(step);
  var size = Number.isFinite(n) && n >= 1 ? Math.floor(n) : PROGRESSIVE_STEP;

  const [shown, setShown] = React.useState<Record<string, number>>(
    function () { return Object.create(null) as Record<string, number>; },
  );

  var shownFor = React.useCallback(function (key: string) {
    var v = shown[String(key)];
    return typeof v === "number" && v > 0 ? v : size;
  }, [shown, size]);

  var revealMoreIn = React.useCallback(function (key: string) {
    setShown(function (prev) {
      var next = Object.assign(Object.create(null), prev) as Record<string, number>;
      var k = String(key);
      var cur = typeof next[k] === "number" && next[k]! > 0 ? next[k]! : size;
      next[k] = cur + size;
      return next;
    });
  }, [size]);

  return { shownFor: shownFor, revealMoreIn: revealMoreIn };
}
