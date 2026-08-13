// Shared list-view filter / toggle controls — extracted
// from four list views (InventoryListView, PipesListView, AccListView,
// JournalView) that each rolled their own ToggleBtn / ActiveFilterPill
// / simple FilterChip with a different per-section accent colour.
//
// The "rich" FilterChip used in InventoryListView (with count badge,
// focus ring and arrow-key navigation between siblings) stays local
// to that view — its behaviour is specific enough that promoting it
// would require either prop-bloat or a less-readable composition.
//
// What's shared here:
//   - ToggleBtn — 44×44 icon-only button, on/off state, custom accent
//   - ActiveFilterPill — pill chip showing an active filter + clear ×
//   - FilterChipSimple — 2-state on/off chip with text label and accent

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { Ico, IcoName } from "./icons.tsx";
import { useReliableTap } from "./primitives.tsx";
import { chipRowScrollTarget } from "../../utils/chipRowScroll.ts";

// ────────────────────────────────────────────────────────────────
// ToggleBtn — 44×44 icon-only button with on/off state. `accent` is the
// highlighted text/border colour; `accentBase` overrides the colour the
// 22-alpha background tint is derived from. Most callers pass `accent` alone
// and it serves both.
// ────────────────────────────────────────────────────────────────
export interface ToggleBtnProps {
  on: boolean;
  icon: IcoName;
  onClick: () => void;
  ariaLabel: string;
  accent?: string;
  accentBase?: string;
}

export function ToggleBtn({
  on, icon, onClick, ariaLabel,
  accent = C.brass, accentBase,
}: ToggleBtnProps) {
  const { pressed, handlers } = useReliableTap(onClick);
  const bgBase = accentBase || accent;
  return (
    <button type="button" {...handlers} aria-label={ariaLabel} aria-pressed={on}
      style={{
        // `flex: "0 0 44px"`, NOT a bare width. These sit in a flex controls
        // row and flex-shrink defaults to 1 — so on the busiest of them (the
        // tobacco list, four toggles plus the rest) they get squeezed to 42 px.
        // A declared 44 that the layout quietly overrules is worse than no
        // declaration: it reads as compliant in the source.
        flex: "0 0 44px", width: 44, height: 44, borderRadius: 8,
        border: `1px solid ${on ? accent : C.rule}`,
        background: on ? alpha(bgBase, "22") : CARD_BG,
        color: on ? accent : C.tx2,
        cursor: "pointer", padding: 0,
        transform: pressed ? "scale(0.94)" : "scale(1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 200ms, color 200ms, border-color 200ms, transform 140ms",
      }}>
      <Ico name={icon} size={16} sw={1.7} />
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// ActiveFilterPill — small rounded chip that shows an active filter
// label with a × button to clear it. `accent` is the highlighted
// tone (brass for inventory, oxblood for pipes, etc.).
// ────────────────────────────────────────────────────────────────
export interface ActiveFilterPillProps {
  label: string;
  onClear: () => void;
  accent?: string;
  accentBase?: string;
}

export function ActiveFilterPill({
  label, onClear, accent = C.brassHi, accentBase = C.brass,
}: ActiveFilterPillProps) {
  const { t } = useAppCtx();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 4px 3px 8px",
      background: alpha(accentBase, "1f"), border: `1px solid ${alpha(accentBase, "55")}`,
      color: accent, borderRadius: 999,
      fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
    }}>
      {label}
      <button onClick={onClear} aria-label={t ? t("btn_clear") : "Effacer"}
        style={{
          width: 28, height: 28, borderRadius: 14, padding: 0,
          background: "transparent", border: "none",
          cursor: "pointer", color: accent,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
        <Ico name="close" size={12} sw={2.2} />
      </button>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// FilterChipSimple — 2-state on/off chip with a text label.
// Used by PipesListView (Active / Finished toggles) and AccListView
// (Active / Retired toggles). The richer FilterChip with count badge
// + focus ring + arrow-key nav stays local to InventoryListView
// because its behaviour is specific to a multi-chip filter row.
// ────────────────────────────────────────────────────────────────
export interface FilterChipSimpleProps {
  on: boolean;
  label: string;
  onClick: () => void;
  accent?: string;
}

export function FilterChipSimple({
  on, label, onClick, accent = C.brass,
}: FilterChipSimpleProps) {
  // aria-pressed surfaces the on/off state to screen readers. Without
  // it the chip reads as a plain button and the user can't tell which
  // filter is active (a11y review fix).
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      padding: "8px 13px",
      border: `1px solid ${on ? accent : C.rule}`,
      background: on ? alpha(accent, "22") : "transparent",
      color: on ? accent : C.tx,
      borderRadius: 8, fontSize: fs(15), fontWeight: 500,
      whiteSpace: "nowrap", cursor: "pointer",
      transition: "background 200ms, color 200ms, border-color 200ms",
    }}>{label}</button>
  );
}

// Shared horizontally-scrollable row with a scroll affordance —
// a right-edge fade + a chevron pill that hint "swipe for more", both hiding
// once the row is scrolled to the end (or when nothing overflows). Extracted
// from InventoryListView's local ScrollableChipRow so every
// scrollable "slider" row uses the SAME cue: the inventory status chips, the
// Journal filter row, and the Settings tab bar. Parameterised for the ground
// colour the fade blends into (fadeColor), padding, gap, and an optional ARIA
// role (e.g. "tablist" for the Settings tabs).
export function ScrollableChipRow({
  children, fadeColor = C.bg, pad = "0 12px 14px", gap = 6, role, ariaLabel, innerStyle,
  resetScrollSignal, revealChildIndex,
}: {
  children: React.ReactNode;
  fadeColor?: string;
  pad?: string;
  gap?: number;
  role?: string;
  ariaLabel?: string;
  innerStyle?: React.CSSProperties;
  // Bump this number to scroll the row back to the far left. The
  // DOM scroller persists its scrollLeft across re-renders, so a programmatic
  // selection change (e.g. leaving the wishlist → back to the tobacco list)
  // otherwise leaves the strip stuck at the right-hand chip. Consumers change
  // the value only on the transitions where a reset is wanted.
  resetScrollSignal?: number;
  // Index of the child that must be VISIBLE — the row scrolls the
  // minimum needed to reveal it, in either direction, and stays put when it
  // already is. `resetScrollSignal` above answers "go back to the start"; this
  // answers "keep the selection on screen", which is a different target each
  // way. Used by the Settings tab strip, where the active tab rendered clipped
  // after switching back from a tab further right.
  revealChildIndex?: number;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const el = scrollerRef.current;
    // Guard scrollTo existence — jsdom (tests) doesn't implement it, and older
    // engines may lack the options form.
    if (el && typeof el.scrollTo === "function") el.scrollTo({ left: 0 });
  }, [resetScrollSignal]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || revealChildIndex == null || typeof el.scrollTo !== "function") return;
    const kid = el.children[revealChildIndex] as HTMLElement | undefined;
    if (!kid) return;
    const cs = getComputedStyle(el);
    // offsetLeft, NOT getBoundingClientRect: the modal opens under a transform
    // transition, and a scaled rect would give a scaled delta against an
    // unscaled scrollLeft. Layout offsets are immune to that.
    const target = chipRowScrollTarget({
      x: kid.offsetLeft - el.offsetLeft,
      w: kid.offsetWidth,
      padL: parseFloat(cs.paddingLeft) || 0,
      padR: parseFloat(cs.paddingRight) || 0,
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
    });
    // No `behavior: "smooth"` — this is a scroll the user did not ask for, and
    // the design system has no motion the reduced-motion preference can't turn
    // off. Instant also matches `resetScrollSignal` above.
    if (target != null) el.scrollTo({ left: target });
  }, [revealChildIndex]);
  const recompute = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ended = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const noOverflow = el.scrollWidth <= el.clientWidth + 1;
    setAtEnd(ended || noOverflow);
  }, []);
  useEffect(() => {
    recompute();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", recompute, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      el.removeEventListener("scroll", recompute);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);
  return (
    <div style={{ position: "relative" }}>
      {/* `data-hscroll` marks this scroller as DELIBERATE for the
          i18n:layout gate, which now fails on any other element that can be
          dragged sideways. Presence is the acknowledgement — the gate does not
          judge whether the scrolling is right, only that someone meant it. */}
      <div ref={scrollerRef} role={role} aria-label={ariaLabel} data-hscroll="" style={{
        padding: pad, display: "flex", gap, overflowX: "auto",
        scrollbarWidth: "none",
        ...innerStyle,
      } as React.CSSProperties}>
        {children}
      </div>
      {!atEnd && (
        <>
          <div aria-hidden="true" style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: 44,
            background: `linear-gradient(to right, transparent, ${fadeColor} 70%)`,
            pointerEvents: "none",
          }} />
          <div aria-hidden="true" style={{
            position: "absolute", right: 6, top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22,
            background: alpha(fadeColor, "ee"), borderRadius: 11,
            border: `1px solid ${C.rule}`,
          }}>
            <Ico name="chevron" size={14} sw={2.2} color={C.brassHi} />
          </div>
        </>
      )}
    </div>
  );
}

