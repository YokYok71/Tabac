// Curator primitives — all motion is state-driven CSS transitions (no @keyframes),
// 100% inline styles. Looping animations use the Web Animations API.

import React, { useState, useEffect, useRef } from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Ico, IcoName } from "./icons.tsx";
import { useAppCtx } from "../../AppContext.tsx";
import { langAssets } from "../../i18n/languages.ts";

// ─────────────────────────────────────────────────────────────
// useEnter — mount transition. Initial state is hidden + offset,
// after first frame (or `delay` ms) we switch to entered.
// ─────────────────────────────────────────────────────────────
export interface EnterOpts {
  fromY?: number;
  duration?: number;
  easing?: string;
}
// No entry animation may BEGIN later than this. Every list computes its delay
// from the row index (`100 + idx * 50`), so the stagger was unbounded: MEASURED
// on a 5000-session journal, the last card's timer fired at **250 seconds**,
// and each row is its own `setTimeout` + `setState` — i.e. thousands of
// separate React commits over a 165 000-node tree, long after the user has
// moved on. At 4x CPU throttle that was 288 further long tasks averaging
// 122 ms, still going when observation stopped.
//
// Capping the DELAY here rather than the index at each call site is the point:
// the rule belongs to the animation, not to any one list, so it covers the six
// current sites and every future one. Nothing visible changes — past ~12 rows
// the stagger is already off screen — while beyond the cap the timers coalesce
// into the same tick instead of trailing for minutes.
//
// It does NOT window the lists: every row is still in the DOM (165 118 nodes
// for that journal), which is the other half of the freeze and a far larger
// change. Disclosed rather than implied.
export var ENTER_MAX_DELAY_MS = 700;

export function useEnter(rawDelay = 0, opts: EnterOpts = {}): React.CSSProperties {
  const { fromY = 12, duration = 460, easing = "cubic-bezier(.2,.7,.3,1)" } = opts;
  const delay = Math.min(ENTER_MAX_DELAY_MS, Number(rawDelay) || 0);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let raf = 0;
    let id: ReturnType<typeof setTimeout> | undefined;
    if (delay <= 0) {
      raf = requestAnimationFrame(() => setEntered(true));
    } else {
      id = setTimeout(() => setEntered(true), delay);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (id) clearTimeout(id);
    };
  }, [delay]);
  return {
    opacity: entered ? 1 : 0,
    transform: entered ? "translateY(0)" : `translateY(${fromY}px)`,
    transition: `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`,
  };
}

// ─────────────────────────────────────────────────────────────
// GrowBar — horizontal/vertical bar that animates from 0 → pct%
// ─────────────────────────────────────────────────────────────
export function GrowBarH({
  pct, color = C.brass, delay = 0, duration = 700, style,
}: {
  pct: number; color?: string; delay?: number; duration?: number;
  style?: React.CSSProperties;
}) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setW(pct), Math.max(16, delay));
    return () => clearTimeout(id);
  }, [pct, delay]);
  return (
    <div style={{
      height: "100%", width: `${w}%`, background: color, borderRadius: 3,
      transition: `width ${duration}ms cubic-bezier(.2,.7,.3,1)`,
      ...style,
    }} />
  );
}

// GrowBarV was removed — never referenced. The horizontal
// counterpart GrowBarH is still used by the stats charts.

// ─────────────────────────────────────────────────────────────
// useWAAPILoop — looping animation via Web Animations API.
// Used for the ember pulse in tasting.
// ─────────────────────────────────────────────────────────────
export function useWAAPILoop<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const a = el.animate(keyframes, {
      iterations: Infinity, easing: "ease-in-out", ...options,
    });
    return () => { try { a.cancel(); } catch (_e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─────────────────────────────────────────────────────────────
// Spinner — small WAAPI-driven rotating ring.
// In-line busy indicator for buttons whose action runs async.
// Uses WAAPI (no @keyframes — see docs/ui.md "No @keyframes…").
// `color` defaults to "currentColor" so it inherits from the host
// button; pass an explicit color to override.
// ─────────────────────────────────────────────────────────────
export interface SpinnerProps {
  size?: number;
  thickness?: number;
  color?: string;
}
export function Spinner({ size = 12, thickness = 2, color = "currentColor" }: SpinnerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useWAAPILoop(ref, [
    { transform: "rotate(0deg)" },
    { transform: "rotate(360deg)" },
  ], { duration: 800, easing: "linear" });
  return (
    <span
      ref={ref}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size, height: size, borderRadius: "50%",
        border: `${thickness}px solid ${color}`,
        borderTopColor: "transparent",
        flexShrink: 0,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// AnimNum — counter that ticks from 0 → value on mount
// ─────────────────────────────────────────────────────────────
export interface AnimNumProps {
  value: number | string;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  delay?: number;
  lang?: string;
}
export function AnimNum({
  value, duration = 800, decimals, prefix = "", suffix = "", delay = 0, lang,
}: AnimNumProps) {
  const ctx = useAppCtx();
  const activeLang = lang || (ctx && ctx.lang);
  const target = typeof value === "number" ? value : parseFloat(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!isFinite(target)) { setN(target); return; }
    let raf = 0;
    let start: number | null = null;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const startAt = performance.now() + delay;
    const step = (ts: number) => {
      if (ts < startAt) { raf = requestAnimationFrame(step); return; }
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setN(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  const d = decimals != null ? decimals : (Number.isInteger(target) ? 0 : 1);
  // Locale picks comma vs dot decimal + thousands separator.
  // Was the two-way `activeLang === "en" ? "en-US" : "fr-FR"`, so
  // es/de/it got the FRENCH narrow-no-break-space thousands separator — a German
  // user saw `2 400` where de writes `2.400`. `fmtNum` fixes the DECIMAL
  // separator app-wide but does no grouping at all, so routing through it would
  // have DROPPED the separator rather than corrected it; a five-entry locale map
  // is the actual fix. Affects every stat tile and every fiche hero number.
  // One row per language in i18n/languages.ts, not a local map —
  // this one silently served fr-FR to any language not listed.
  const formatted = n.toLocaleString(langAssets(String(activeLang)).numberLocale, {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
  return <>{prefix}{formatted}{suffix}</>;
}

// ─────────────────────────────────────────────────────────────
// Stars — rating display. `sequenced` fills 1-by-1 on mount.
// `onChange` makes it editable.
// ─────────────────────────────────────────────────────────────
export interface StarsProps {
  n: number;
  size?: number;
  color?: string;
  sequenced?: boolean;
  onChange?: (v: number) => void;
  /** Accessible name. Interactive → the radiogroup label ("Force", "Note"…);
   *  display → the image label. Falls back to a language-neutral "n/5". */
  ariaLabel?: string | undefined;
}
// a11y audit: the interactive rating is a real keyboard-
// operable radiogroup (roving tabindex, arrow keys, Enter/Space) and the
// read-only rating is a labelled role="img" — previously bare <svg onClick>
// with no tabIndex/role/aria, so it was unreachable by keyboard AND silent to
// screen readers on every form + card in the app.
export function Stars({ n, size = 12, color = C.brassHi, sequenced = false, onChange, ariaLabel }: StarsProps) {
  const [shown, setShown] = useState(sequenced ? 0 : n);
  const groupRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!sequenced) { setShown(n); return; }
    setShown(0);
    const ids: ReturnType<typeof setTimeout>[] = [];
    // CLAMPED. `n` is a prop, and a rating of `Infinity` — which `JSON.parse`
    // produces from a backup carrying `1e999` — made this loop register one
    // timer per unit and locked the main thread outright: the tab had to be
    // force-killed, and every later attempt to open that fiche did it again.
    // `migrateData` clamps the stored value now; this is the second line,
    // because `n` can reach the component by routes the migration never sees
    // (a computed average, a future field). Only five stars are ever drawn, so
    // more than five timers is waste on any input, hostile or not.
    const steps = Math.min(5, Math.max(0, Math.floor(Number(n) || 0)));
    for (let i = 1; i <= steps; i++) {
      ids.push(setTimeout(() => setShown(v => Math.max(v, i)), 80 * i + 200));
    }
    return () => ids.forEach(clearTimeout);
  }, [n, sequenced]);
  const interactive = !!onChange;
  // The single tab stop of the radiogroup is the checked star (or the first
  // when nothing is set yet). Arrow keys move + commit; Enter/Space commits the
  // focused star.
  const current = n > 0 ? n : 0;
  function focusStar(v: number) {
    requestAnimationFrame(() => {
      const btns = groupRef.current ? groupRef.current.querySelectorAll('[role="radio"]') : null;
      const el = btns && btns[v - 1] ? (btns[v - 1] as HTMLElement) : null;
      // preventScroll. Arrow-keying between the five stars moves
      // focus a few dozen pixels inside a group the user is already looking
      // at — there is nothing to scroll TO, only a page to jerk.
      if (el) el.focus({ preventScroll: true });
    });
  }
  function onKey(e: React.KeyboardEvent, i: number) {
    if (!onChange) return;
    let next: number;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") next = Math.min(5, (current || i) + 1);
    else if (k === "ArrowLeft" || k === "ArrowDown") next = Math.max(1, (current || i) - 1);
    else if (k === "Home") next = 1;
    else if (k === "End") next = 5;
    else if (k === " " || k === "Enter") { e.preventDefault(); onChange(i); return; }
    else return;
    e.preventDefault();
    onChange(next);
    focusStar(next);
  }
  const starPaths = [1, 2, 3, 4, 5].map(i => {
    const filled = i <= shown;
    const glyph = (
      <svg
        key={i}
        width={size} height={size} viewBox="0 0 24 24"
        aria-hidden="true" focusable="false"
        style={{
          transition: "fill 240ms ease, stroke 240ms ease, transform 240ms ease",
          transform: filled ? "scale(1)" : "scale(0.85)",
          // Fill/stroke via style so a themeable var() colour
          // (the default star colour is brass) resolves on WebKit — SVG
          // presentation attributes don't evaluate var().
          fill: filled ? color : "none",
          stroke: filled ? color : C.tx3,
          display: "block",
        }}
        strokeWidth={1.6}
      >
        <path d="m12 2 3 7 7 .8-5.3 4.7L18 22l-6-3.5L6 22l1.3-7.5L2 9.8 9 9z" />
      </svg>
    );
    if (!interactive) return glyph;
    // The one tab stop: the checked star, or the first when nothing is set.
    const isTabStop = current === i || (current === 0 && i === 1);
    return (
      <button
        key={i}
        type="button"
        role="radio"
        aria-checked={current === i}
        aria-label={String(i)}
        tabIndex={isTabStop ? 0 : -1}
        onClick={() => { if (onChange) onChange(i); }}
        onKeyDown={e => onKey(e, i)}
        style={{
          background: "none", border: "none", padding: 2, margin: 0,
          cursor: "pointer", lineHeight: 0, borderRadius: 4,
        }}
      >
        {glyph}
      </button>
    );
  });
  if (!interactive) {
    return (
      <span role="img" aria-label={ariaLabel || (n + "/5")} style={{ display: "inline-flex", gap: 1.5 }}>
        {starPaths}
      </span>
    );
  }
  return (
    <span
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel || (n + "/5")}
      style={{ display: "inline-flex", gap: 1.5 }}
    >
      {starPaths}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Lbl — small caps label with tracked monospace
// ─────────────────────────────────────────────────────────────
export function Lbl({
  children, color = C.tx2, size = 12.5, weight = 600, style,
}: {
  children: React.ReactNode; color?: string; size?: number; weight?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{
      fontFamily: F.mono, fontSize: fs(size), letterSpacing: 1.6,
      textTransform: "uppercase", color, fontWeight: weight, ...style,
    }}>{children}</span>
  );
}

// ─────────────────────────────────────────────────────────────
// useReliableTap — shared tap-handling hook.
//
// Why: iOS Safari occasionally drops the synthesised `click` event
// when a tap is momentarily reinterpreted as the start of a scroll
// gesture. The press animation (driven by pointerDown/Up) runs, but
// `onClick` never fires — visual feedback without action. Our fix
// (originally on PressCard, then extended to BottomDock) is to
// ALSO fire from `onPointerUp`, with a per-instance 300 ms
// guard preventing double-fire on devices where both paths arrive.
//
// Hook contract:
//   const { pressed, handlers } = useReliableTap(onClick);
//   <button {...handlers} style={{ ... pressed ? "scale(0.92)" : "" }}>
//
// `pressed` flips true on pointerDown, false on up/leave/cancel. A
// cancellation flag inside the hook stops pointerUp from firing if
// the user slid off the button (slide-off, not a tap).
// ─────────────────────────────────────────────────────────────
export function useReliableTap(onClick?: () => void) {
  const [pressed, setP] = useState(false);
  const fireGuard = useRef<number>(0);
  const cancelledRef = useRef(false);
  // Track the pointer's start coords so a scroll started AT
  // the button (finger barely moves outside the hit area, so no
  // `pointerleave`) still cancels the tap. iOS Safari is inconsistent
  // about firing `pointercancel` when a scroll begins on a touch
  // target; the move-distance guard catches the cases it misses.
  // Bumped 8 → 12 px. On tall featured surfaces (the Home
  // "Ce soir ?" 160 px hero photo, the 100 px "du moment" tiles) a deliberate
  // tap often "presses and rolls" a few px, and an 8 px slop cancelled it —
  // the card felt un-tappable even though the whole thing is the click target.
  // 12 px is still comfortably below a real scroll gesture (iOS's own tap
  // recognizer allows ~10 px) so scroll-started-on-a-button is still caught.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const TAP_SLOP_PX = 12;
  function maybeFire(viaPointer: boolean, x: number, y: number) {
    if (!onClick) return;
    const now = Date.now();
    if (now - fireGuard.current < 300) return;
    fireGuard.current = now;
    onClick();
    // Audit: parity with PressCard.maybeFire — when the fire
    // path was pointerUp and onClick unmounted the press target (e.g.
    // closing a modal / navigating away), install the one-shot document
    // capture listener so the trailing synthetic click at the same
    // coordinates can't sneak into whatever now sits underneath. The
    // native onClick path skips it (we're already inside that click).
    if (viaPointer) swallowNextTrustedClick(x, y);
  }
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!onClick) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      setP(true);
      cancelledRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!onClick || cancelledRef.current || !startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
        cancelledRef.current = true;
        setP(false);
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!onClick) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      setP(false);
      if (!cancelledRef.current) maybeFire(true, e.clientX, e.clientY);
      startRef.current = null;
    },
    onPointerLeave: () => { setP(false); cancelledRef.current = true; startRef.current = null; },
    onPointerCancel: () => { setP(false); cancelledRef.current = true; startRef.current = null; },
    onClick: onClick ? () => maybeFire(false, 0, 0) : undefined,
  };
  return { pressed, handlers };
}

// ─────────────────────────────────────────────────────────────
// IconBtn — pressable icon button with scale transition
// ─────────────────────────────────────────────────────────────
export interface IconBtnProps {
  icon: IcoName;
  onClick?: () => void;
  color?: string;
  bg?: string;
  border?: boolean;
  size?: number;
  iconSize?: number;
  iconSw?: number;
  glow?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}
export function IconBtn({
  icon, onClick, color = C.tx, bg = "transparent", border = true,
  size = 44, iconSize = 17, iconSw, glow, ariaLabel, style,
}: IconBtnProps) {
  // Reliable-tap pattern. Same root cause as PressCard /
  // DockBtn — iOS Safari occasionally drops the synthesised click for
  // taps near scroll-prone surfaces, so the visual press fired but
  // onClick didn't. The hook handles pointerUp + click with a guard.
  const { pressed, handlers } = useReliableTap(onClick);
  // With NO `onClick` this used to render a real `<button>` with an
  // `aria-label`, a pointer cursor and a 1 px border, and every handler
  // early-returned. Six sites use it that way as a MASTHEAD ORNAMENT beside
  // the page title, so a screen reader announced "Tabacs, button" — in the tab
  // order, inert — immediately before the `<h1>` that says the same thing.
  // The catalogue was the sharp case: its decorative `book` sat in a `gap: 8`
  // row directly right of the functional BACK button, two identical 44 px
  // bordered buttons of which only one does anything.
  //
  // `HomeViewV2`'s masthead already shows the right treatment (`Orn` + a
  // `span`, no button). Handled HERE rather than at the six call sites so a
  // future decorative use cannot reintroduce it. The box is byte-identical —
  // only the ROLE changes — and the cursor stops claiming a press.
  //
  // NOTE this is not the "disabled" case: a control that exists but is
  // currently unavailable must stay announced, which is what the
  // `ariaDisabled` does on `PressCard`. `IconBtn` has no such state today; if
  // one is ever added it must NOT come through this branch.
  if (!onClick) {
    return (
      <div aria-hidden="true" style={{
        width: size, height: size, borderRadius: 8,
        border: border ? `1px solid ${C.rule}` : "none",
        background: bg, color, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: glow ? `0 6px 16px ${alpha(glow, "66")}` : "none",
        ...style,
      }}>
        <Ico name={icon} size={iconSize} sw={iconSw} />
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel || icon}
      {...handlers}
      style={{
        width: size, height: size, borderRadius: 8,
        border: border ? `1px solid ${C.rule}` : "none",
        background: bg, color, cursor: "pointer", padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        transform: pressed ? "scale(0.92)" : "scale(1)",
        transition: "transform 140ms cubic-bezier(.34,1.56,.64,1), background 200ms",
        boxShadow: glow ? `0 6px 16px ${alpha(glow, "66")}` : "none",
        ...style,
      }}>
      <Ico name={icon} size={iconSize} sw={iconSw} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// PressCard — generic pressable wrapper with scale animation
// ─────────────────────────────────────────────────────────────
export interface PressCardProps {
  children: React.ReactNode;
  // Explicit `| undefined` so callers passing
  // `onClick={cb || undefined}` satisfy exactOptionalPropertyTypes.
  onClick?: (() => void) | undefined;
  style?: React.CSSProperties | undefined;
  ariaLabel?: string | undefined;
  /** Mark an async action in flight (a11y) (aria-busy) so a
   *  screen reader announces the busy state on the trigger. */
  ariaBusy?: boolean | undefined;
  /** Announce a VISUALLY-disabled trigger. The convention for
   *  disabling a PressCard is `onClick={cond ? undefined : cb}` — which drops
   *  role and tabIndex, so the control degrades to plain text and a screen
   *  reader gives no hint that a button is there but unavailable. Its sibling
   *  pattern, the FormScreen submit in FormFields.tsx, has always carried
   *  `aria-disabled`; this brings PressCard in line. Set it alongside the
   *  greyed-out styling and the control stays focusable and announced as a
   *  disabled button (never the native `disabled`, which hides it entirely). */
  ariaDisabled?: boolean | undefined;
}
// Swallow ONLY the leaked synthetic
// click that fires AFTER our `onPointerUp` handler ran `onClick()`.
// When `onClick` closes a modal the original press target is unmounted;
// the browser then dispatches the synthesized click at the touch
// coordinates, which now hit whatever element sits behind the modal.
//
// The first version swallowed any next trusted click — but if the user
// instantly tapped a dock button (a different screen position), the
// swallower ate that tap too, producing inconsistent button
// sensitivity. We now filter by screen coordinates: only clicks within
// ~8 px of the pointerUp position get swallowed (the leak always
// fires at the exact same coordinates as the original touch).
function swallowNextTrustedClick(x: number, y: number) {
  // Track the fallback timer so the listener is removed
  // exactly once. `removeEventListener` is idempotent and the existing
  // code was safe by accident, but clearing the timeout when the
  // listener fires keeps the contract explicit and stops a no-op
  // timer from running.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const swallow = (e: Event) => {
    if (!(e instanceof MouseEvent) || !e.isTrusted) return;
    const dx = Math.abs(e.clientX - x);
    const dy = Math.abs(e.clientY - y);
    if (dx > 8 || dy > 8) return;     // not the leaked click — pass through
    e.stopPropagation();
    e.preventDefault();
    document.removeEventListener("click", swallow, true);
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  document.addEventListener("click", swallow, true);
  timer = setTimeout(() => {
    // Guard `document`. This fire-and-forget 250 ms timer is not
    // tied to any component lifecycle, so in tests it can fire AFTER jsdom has
    // torn down the global `document` — throwing "document is not defined",
    // which failed the whole CI run and intermittently BLOCKED deploys (a
    // flaky red build). In the browser `document` always exists, so this is a
    // no-op there; in a torn-down test env it just skips the cleanup.
    if (typeof document !== "undefined") {
      document.removeEventListener("click", swallow, true);
    }
    timer = null;
  }, 250);
}

export function PressCard({ children, onClick, style, ariaLabel, ariaBusy, ariaDisabled }: PressCardProps) {
  const [pressed, setP] = useState(false);
  const [focused, setF] = useState(false);
  // Per-instance guard de-duplicates pointerUp + onClick on devices
  // where both fire for the same gesture (most desktops, some Android
  // browsers). Reset to 0 on every fresh PressCard mount — the cross-
  // instance leak is handled separately via swallowNextTrustedClick.
  const fireGuard = useRef<number>(0);
  // Pointer-move slop guard. When the user starts scrolling
  // with their finger on a card (very common in Settings), iOS Safari
  // doesn't always fire `pointercancel` before `pointerup`, so the tap
  // would fire. Tracking the start coordinates and comparing on each
  // move lets us cancel a tap as soon as the finger drifts past the slop.
  // 8 → 12 px (kept in lock-step with useReliableTap). On the
  // Home's tall featured photos (160 px "Ce soir ?" hero, 100 px "du moment"
  // tiles) a deliberate tap often presses-and-rolls a few px, and an 8 px slop
  // cancelled it — the photo felt un-tappable. 12 px is still well below a real
  // scroll gesture (iOS's own tap recognizer allows ~10 px).
  const cancelledRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const TAP_SLOP_PX = 12;
  function maybeFire(viaPointer: boolean, x: number, y: number) {
    if (!onClick) return;
    const now = Date.now();
    if (now - fireGuard.current < 300) return;
    fireGuard.current = now;
    onClick();
    // When the fire path was pointerUp, install a one-shot document
    // capture-phase listener so the upcoming synthetic click can't
    // sneak into a now-unmounted modal's underlying card. Skipped for
    // the native onClick path (we're already inside the synthetic
    // click — installing here would only catch some LATER click).
    if (viaPointer) swallowNextTrustedClick(x, y);
  }
  return (
    <div
      // A card marked ariaDisabled keeps button semantics + focusability even
      // though onClick is undefined — that is the whole point: the user must be
      // able to find the control and be told it is unavailable.
      //
      // `ariaBusy` EARNS THE SAME, and its absence was a live defect. The
      // convention for standing a trigger down mid-flight is the same
      // `onClick={cond ? undefined : cb}`, so a BUSY card had neither `onClick`
      // nor `ariaDisabled` — it announced `aria-busy` on something that was no
      // longer a control at all, dropping out of the accessibility tree exactly
      // while it had something to say. AICard's search and scan buttons both do
      // this during a fill (`aiLoad`), as do the four geolocation triggers.
      // A busy control IS a control: findable, focusable, announced busy, and
      // inert — which is what ARIA prescribes, and what `aria-busy` is FOR.
      // Fixed in the primitive rather than at the six call sites: the choke
      // point is one line and it covers every future consumer (the `safeBgUrl`
      // argument — many sources, one sink).
      role={onClick || ariaDisabled || ariaBusy ? "button" : undefined}
      tabIndex={onClick || ariaDisabled || ariaBusy ? 0 : undefined}
      aria-label={ariaLabel}
      aria-busy={ariaBusy}
      aria-disabled={ariaDisabled}
      onPointerDown={(e) => {
        if (!onClick) return;
        // Ignore right / middle mouse buttons. Touch and pen always
        // report button=0 so this only filters mouse.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        setP(true);
        cancelledRef.current = false;
        startRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!onClick || cancelledRef.current || !startRef.current) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
          cancelledRef.current = true;
          setP(false);
        }
      }}
      onPointerUp={(e) => {
        if (!onClick) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        setP(false);
        startRef.current = null;
        if (cancelledRef.current) return;
        // viaPointer=true → installs the one-shot click swallower
        // targeting (clientX, clientY). The synthetic click that fires
        // right after this pointerUp lands at the same coordinates so
        // it gets swallowed; an immediate intentional tap elsewhere
        // (dock button, search, …) is at different coordinates and
        // passes through normally.
        maybeFire(true, e.clientX, e.clientY);
      }}
      onPointerLeave={() => { setP(false); cancelledRef.current = true; startRef.current = null; }}
      onPointerCancel={() => { setP(false); cancelledRef.current = true; startRef.current = null; }}
      onFocus={onClick ? () => setF(true) : undefined}
      onBlur={onClick ? () => setF(false) : undefined}
      onKeyDown={onClick ? (e) => {
        // Activate with Enter or Space, matching native button behaviour.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          maybeFire(false, 0, 0);
        }
      } : undefined}
      onClick={onClick ? () => maybeFire(false, 0, 0) : undefined}
      style={{
        cursor: onClick ? "pointer" : "default",
        // touch-action: manipulation tells the browser this element only
        // wants taps (no double-tap zoom, no pinch). Without it, iOS
        // Safari adds a ~300 ms delay deciding between tap-vs-double-
        // tap-zoom; during heavy scrolling it can also reinterpret the
        // first tap as a continued scroll and drop the click.
        touchAction: onClick ? "manipulation" : undefined,
        transform: pressed && onClick ? "scale(0.98)" : "scale(1)",
        transition: "transform 200ms cubic-bezier(.34,1.56,.64,1), box-shadow 200ms",
        outline: "none",
        ...style,
        ...(focused && onClick ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
      }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ScreenWash — radial colored hint on a screen
// ─────────────────────────────────────────────────────────────
// NEUTRAL vignette (option E) — a faint lighter-centre glow with
// NO colour halo, so every page gets a touch of depth without a gold cast.
// The `color` / `opacity` props are still accepted (every caller passes
// them) but intentionally unused — the wash is now a fixed neutral so it
// stays uniform across the app. Running tasting still renders none.
//
// IMPORTANT: this div is `position:absolute` and therefore paints ON TOP
// of the (non-positioned) page content, so its background MUST stay
// semi-transparent — a fully-opaque fill here covers the text (an earlier
// opaque C.bg3 made pages illegible). A faint white radial just
// lightens the top-centre a hair (depth, no colour) without hiding anything.
export function ScreenWash(_props: { color?: string; opacity?: number } = {}) {
  // The wash colour is a themeable token — a faint white top-light
  // on the dark vault, a warm amber glow on the light parchment (so the head
  // of the page isn't flat). See C.washTop / MODE_LIGHT["--c-wash-top"].
  // A LINEAR top-to-bottom fade with a viewport-relative extent —
  // strongest at the very top, gone by ~46vh — instead of a radial whose %
  // geometry put the peak mid-page on a long screen. Clean top glow, no
  // middle hotspot.
  return (
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      background: `linear-gradient(to bottom, ${C.washTop} 0, transparent 46vh)`,
    }} />
  );
}

// ─────────────────────────────────────────────────────────────
// TopBar — common top bar (status-bar safe-area-aware)
// ─────────────────────────────────────────────────────────────
export function TopBar({
  leading, trailing, title, onTitleClick, titleAriaLabel,
}: {
  leading?: React.ReactNode; trailing?: React.ReactNode; title?: string;
  // When provided, the title label becomes a real tappable
  // button (keyboard-activable) — used by the inventory TopBar so the
  // "Catalogue" label opens the reference catalog, mirroring the book
  // icon. Absent everywhere else, so the label stays plain text.
  onTitleClick?: (() => void) | undefined;
  titleAriaLabel?: string | undefined;
}) {
  // Route the tappable title through the shared reliable-tap
  // hook (pointer-based, like the dock / IconBtn / cards) — a plain onClick
  // missed taps on iOS, so the label "needed several tries". The hook is
  // always called (rule-of-hooks); its handlers no-op when onTitleClick is
  // absent (non-inventory TopBars keep a plain text title).
  const { pressed, handlers } = useReliableTap(onTitleClick);
  return (
    // `data-topbar` is a MEASUREMENT hook, not styling. This bar
    // is sticky at the viewport top and OVERLAYS scrolled content, so anything
    // scrolling a row into view has to subtract its height — which varies with
    // the safe-area inset AND the user's text-size setting, so a hardcoded
    // number would be wrong on most devices. See InventoryListView's wish
    // reveal.
    <div data-topbar="" style={{
      paddingTop: `max(env(safe-area-inset-top, 0), 14px)`,
      paddingLeft: 12, paddingRight: 12, paddingBottom: 8,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      // Sticky so the top bar stays visible on every page while the
      // content scrolls under it — the SAME recipe FormScreen already uses (a
      // frosted bg gradient + blur so scrolled content doesn't bleed through).
      // sticky (not fixed) is immune to the ancestor containing-block trap that
      // plagues the dock, and the form top bar proves it works on the iOS PWA.
      position: "sticky", top: 0, zIndex: 20,
      background: `linear-gradient(180deg, ${C.bg}, ${alpha(C.bg, "cc")})`,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      // Escamotage au défilement. La barre n'en décide RIEN : elle honore une
      // propriété personnalisée que la coquille pose (`--chrome-shift`), et
      // qui vaut `none` partout où l'escamotage ne s'applique pas — donc ce
      // primitif reste identique sur les formulaires et les fiches.
      //
      // UNE TRANSLATION, ET C'EST CE QUI REND L'OPÉRATION SÛRE : l'élément
      // garde sa place dans le flux, donc le contenu ne saute pas d'un pixel
      // sous le doigt, et sa HAUTEUR est inchangée — ce dont dépend la seule
      // mesure qui la lit (`data-topbar`, la révélation d'une envie).
      transform: "var(--chrome-shift, none)",
      // PAS de `will-change` : c'est une promotion de couche PERMANENTE, et
      // cette barre est déjà floutée et collante — exactement le type de chrome
      // sur lequel ce dépôt a documenté une dérive de rendu iOS. Une
      // translation de 220 ms sur un élément simple n'a besoin d'aucun indice.
      // (`will-change` figure aussi dans la liste des propriétés créant un bloc
      // conteneur : en poser un de plus dans la colonne ne se justifie que par
      // un gain, et il n'y en a pas.)
      transition: "transform var(--chrome-ms, 220ms) cubic-bezier(0.22, 1, 0.36, 1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        {leading}
        {title && (onTitleClick
          ? (
            <button
              type="button"
              {...handlers}
              aria-label={titleAriaLabel || title}
              style={{
                // Grow to fill the whole gap between the leading
                // icon and the trailing controls — a big, forgiving target —
                // and route taps through useReliableTap for iOS reliability.
                flex: 1, minWidth: 0,
                background: pressed ? `${alpha(C.brass, "1f")}` : "none",
                border: "none", cursor: "pointer", borderRadius: 8,
                padding: "14px 12px", margin: "-10px -8px",
                minHeight: 44, textAlign: "left",
                display: "inline-flex", alignItems: "center",
                transition: "background 120ms",
              }}
            >
              <Lbl color={C.tx2} size={11}>{title}</Lbl>
            </button>
          )
          : <Lbl color={C.tx2} size={11}>{title}</Lbl>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>{trailing}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PageTitle — big editorial title with overline
// ─────────────────────────────────────────────────────────────
export function PageTitle({
  overline, children,
}: { overline?: string; children: React.ReactNode }) {
  const e = useEnter(0, { duration: 500, fromY: 14 });
  return (
    <div style={{ padding: "6px 12px 18px" }}>
      {overline && <Lbl color={C.tx2}>{overline}</Lbl>}
      <h1 style={{
        margin: 0, padding: 0,
        fontFamily: F.display, color: C.ivory,
        fontSize: fs(44), lineHeight: 0.98, letterSpacing: -0.8,
        marginTop: 8, fontWeight: 400, ...e,
      }}>
        {children}
      </h1>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SectionHead — italic-serif section title with brass tab
// ─────────────────────────────────────────────────────────────
export function SectionHead({
  title, sub, accent = C.brass,
}: { title: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{ padding: "10px 12px 8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{
            width: 4, height: 16, background: accent, borderRadius: 1,
            boxShadow: `0 0 8px ${alpha(accent, "66")}`, display: "inline-block",
          }} />
          <h2 style={{
            margin: 0, padding: 0, fontWeight: 400,
            fontFamily: F.display, fontSize: fs(24), color: C.ivory,
            fontStyle: "italic", letterSpacing: -0.2, lineHeight: 1,
          }}>{title}</h2>
        </div>
        {sub && <Lbl size={9.5}>{sub}</Lbl>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StatTile — compact key/value tile (label above, big value below).
// Used in InventoryDetailView lot recap and JournalView detail recap.
// Hoisted from two near-identical local copies.
// ─────────────────────────────────────────────────────────────
export function StatTile({
  label, value, accent, customValue,
}: {
  label: string;
  value: string;
  accent: string;
  customValue?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 6,
      background: C.bg2, border: `1px solid ${C.rule}`,
      textAlign: "center",
    }}>
      <Lbl size={9.5} color={C.tx3}>{label}</Lbl>
      <div style={{
        marginTop: 4, fontFamily: F.display, fontSize: fs(17), color: accent,
        display: "flex", alignItems: "center", justifyContent: "center", minHeight: 24,
      }}>
        {customValue !== undefined && customValue !== null ? customValue : value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EmptyState — icon + sentence + optional ways forward.
//
// Hoisted from FOUR copies of the same block — a local
// `EmptyState` in InventoryListView and three verbatim inlinings (PipesListView,
// AccListView, JournalView). Same shape as the StatTile/SpecRow lift.
//
// The `actions` slot is the point, not the deduplication. An audit of all 25
// empty states in the app found exactly ONE offering a way forward (the
// journal's filter reset), and the three list views could not even tell "you
// own nothing yet" from "your filter matched nothing" — they compute emptiness
// from the FILTERED array, so someone with 200 tobaccos and a forgotten chip
// saw the identical « Aucun tabac » as a first-run user, with no way back.
//
// Actions WRAP: at 360px in German two uppercase mono buttons do not fit on one
// line, and the row is the last thing on an otherwise empty screen, so a line
// costs nothing and clipping would cost the way out (the flex-wrap remedy).
// ─────────────────────────────────────────────────────────────
export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** Tint. Defaults to the caller's section accent. */
  accent?: string;
}

export function EmptyState({
  icon, label, hint, actions, accent,
}: {
  icon: IcoName;
  label: string;
  hint?: string;
  actions?: EmptyStateAction[];
  accent?: string;
}) {
  const live = (actions || []).filter(Boolean);
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: C.tx3 }}>
      <Ico name={icon} size={40} sw={1.2} />
      <div style={{ marginTop: 12, fontFamily: F.display, fontStyle: "italic", fontSize: fs(20) }}>
        {label}
      </div>
      {hint ? (
        <div style={{
          marginTop: 6, fontFamily: F.body, fontSize: fs(13.5),
          color: C.tx3, maxWidth: 34 * 8, marginLeft: "auto", marginRight: "auto",
        }}>{hint}</div>
      ) : null}
      {live.length > 0 && (
        <div style={{
          marginTop: 14, display: "flex", flexWrap: "wrap",
          gap: 8, justifyContent: "center",
        }}>
          {live.map((a, i) => {
            const c = a.accent || accent || C.brass;
            return (
              <PressCard key={i} onClick={a.onClick} style={{
                padding: "8px 14px",
                background: alpha(c, "22"), border: `1px solid ${alpha(c, "66")}`,
                borderRadius: 8, color: c,
                fontFamily: F.mono, fontSize: fs(13.5), letterSpacing: 1.1,
                textTransform: "uppercase", fontWeight: 700,
              }}>{a.label}</PressCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SpecRow — label/value row separated by a dotted bottom rule,
// used in every detail view's specs section.
// Hoisted from two identical local copies (PipesDetailView,
// AccessoryDetailView).
// ─────────────────────────────────────────────────────────────
export function SpecRow({
  label, value, last, href,
}: { label: string; value?: string; last?: boolean; href?: string }) {
  const hasValue = !!value;
  // When a safe href is passed (e.g. a seller's site URL), render
  // the value as a brass external link. The caller is responsible for passing
  // an already-sanitised href (safeSellerHref).
  const valStyle: React.CSSProperties = {
    fontFamily: F.display, fontSize: fs(16),
    textAlign: "right", maxWidth: "60%",
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "9px 0",
      borderBottom: last ? "none" : `1px dotted ${C.rule}`,
      gap: 12,
    }}>
      <Lbl color={C.tx2}>{label}</Lbl>
      {href && hasValue ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          style={{ ...valStyle, color: C.brassHi, textDecoration: "underline" }}>
          {value} ↗
        </a>
      ) : (
        <span style={{ ...valStyle, color: hasValue ? C.ivory : C.tx3 }}>{hasValue ? value : "—"}</span>
      )}
    </div>
  );
}

