// Generic modal primitive used by Search / Settings / LotDetail.
// State-driven entry transition, esc-close, backdrop-close.

import React, { useState, useEffect, useRef } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { IconBtn, Lbl } from "./primitives.tsx";
import { pushModalClose, isTopModalClose } from "../../utils/modalStack.ts";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  align?: "top" | "center";
  padding?: number;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // Where to move focus when the modal opens.
  //   "field"     (default) — first focusable element (input/select/button).
  //                Right for action-first modals (Search wants the query
  //                field focused so the user types immediately).
  //   "container" — the dialog panel itself (tabIndex=-1). Use for
  //                REVIEW modals pre-filled with data the user is meant to
  //                read before editing — focusing the first text field
  //                there pops the mobile keyboard unprompted and scrolls
  //                the panel, which is disorienting (catalog QuickAdd).
  initialFocus?: "field" | "container";
  // Opt-in "capped height + internal scroll" layout for tall EDIT
  // modals (LotFormModal / MaintFormModal). The panel becomes a bounded flex
  // column (maxHeight:100% of the padded backdrop) so ITS OWN inner
  // `overflow-y:auto` region scrolls — instead of the whole backdrop scrolling
  // and bleeding to the background page underneath (the "page bouge, pas la
  // modale" report). The caller lays out a sticky top bar + a `flex:1;
  // overflow-y:auto; overscroll-behavior:contain` body + an optional footer.
  capHeight?: boolean;
}

export function Modal({
  open, onClose, children, maxWidth = 520, align = "top", padding = 0,
  ariaLabel, ariaLabelledBy, initialFocus = "field", capHeight = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  // Ghost-click defence: keep the backdrop in the DOM ~320 ms
  // after `open` flips to false so the iOS/Android synthetic click that
  // fires ~150-300 ms after a real tap can't fall through to a button
  // underneath (e.g. closing Settings via the X over the HomeView search
  // icon used to open the search modal). The visible fade-out is a bonus:
  // `mounted` flips false instantly so the opacity/transform transition
  // plays during the deferred window. Same pattern as the lightbox
  // (the lightbox ghost-click note in docs/ui.md) but applied to every Modal at once.
  const [shouldRender, setShouldRender] = useState(open);
  // Restore focus to the element that triggered the modal on close.
  //
  // EVERY focus() call in this file passes `preventScroll`.
  // Focus moves the viewport by default, and none of these four moves is a
  // navigation the user asked for: opening a dialog, trapping Tab inside it,
  // and handing focus back on close should all leave the page exactly where it
  // was. In a long list — the catalogue is 1222 rows and ~75 000 px — a focus
  // that scrolls loses the reader's place outright.
  //
  // Reported alongside the history-scroll-restoration swipe defect ("swipe OR ×"), and only the
  // swipe half was reproducible here: in Chromium a tap focuses a
  // `div[tabindex=0]` so the restore lands back on the row, and
  // `document.body.focus()` is a no-op. Neither holds on iOS Safari, which
  // does not focus non-form elements on tap — so `lastActive` is <body> there,
  // and the app's own rule says this engine cannot arbitrate that. The change
  // is made because it is correct on its own terms, not because a headless run
  // proved the cause.
  const lastActive = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Register this modal's close handler on the global modal stack
  // while it's OPEN, so goBack (App.tsx) can dismiss the top-most modal on a
  // swipe-back / system-back — covers every shared-Modal modal, incl. the
  // view-local ones the nav layer can't see (catalog QuickAdd/fiche, lot &
  // maintenance modals, cellar-confirm, encryption prompt, …). The handler
  // reads the latest onClose via a ref so it stays correct without churn.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  // Audit: keep a ref to THIS modal's registered close so the
  // Escape handler can tell whether it's the top-most modal (see below).
  const myCloseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!open) return;
    const fn = () => { if (onCloseRef.current) onCloseRef.current(); };
    myCloseRef.current = fn;
    const unreg = pushModalClose(fn);
    return () => { unreg(); if (myCloseRef.current === fn) myCloseRef.current = null; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const r = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r);
    }
    setMounted(false);
    const t = window.setTimeout(() => setShouldRender(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    // Move focus into the dialog so screen readers announce it.
    requestAnimationFrame(() => {
      const node = dialogRef.current;
      if (!node) return;
      // "container" mode focuses the panel itself (tabIndex=-1)
      // so a review modal doesn't pop the mobile keyboard by focusing its
      // first text field. a11y is still satisfied (role=dialog announced).
      if (initialFocus === "container") { node.focus({ preventScroll: true }); return; }
      const focusable = node.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      );
      (focusable || node).focus({ preventScroll: true });
    });
    return () => {
      const prev = lastActive.current as HTMLElement | null;
      if (prev && typeof prev.focus === "function") prev.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Audit: only the TOP-most modal reacts to Escape. Every
        // open Modal installs this window listener, so without the guard a
        // stacked modal (encryption prompt / import picker over Settings) and
        // the modal beneath it BOTH close at once. Mirrors the stack-aware
        // back gesture (closeTopModal).
        if (isTopModalClose(myCloseRef.current)) onClose();
        return;
      }
      // Focus trap: cycle Tab within the dialog.
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!shouldRender) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        // Was rgba(8,11,10,0.78) — a GREEN-tinted near-black, i.e. a
        // dark-vault value leaking into a mode-agnostic element. Neutralised
        // rather than tokenised: a scrim's job is to DIM the page behind it, so
        // `alpha(C.bg, …)` would be wrong — in light mode C.bg is cream and the
        // backdrop would wash the page out instead of dimming it. Pure black at
        // the same alpha is the honest neutral, and the dark-mode delta is
        // 0.78 × (8,11,10) ≈ 3 % of one channel — imperceptible.
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: align === "center" ? "center" : "flex-start",
        justifyContent: "center",
        padding: `max(env(safe-area-inset-top, 0), 8%) 12px 24px`,
        // Keep touch-scroll momentum inside the overlay so it can't
        // chain to the background page (iOS "la page bouge, pas la modale").
        overscrollBehavior: "contain",
        opacity: mounted ? 1 : 0,
        // Tighten modal animations. Previously 220ms / 340ms
        // with a bouncy spring curve, which made the lot edit modal
        // feel laggy compared to the full-page pipe detail (no
        // animation). New: 130ms backdrop fade + 180ms scale-in with
        // a snappier curve.
        transition: "opacity 130ms cubic-bezier(.2,.7,.3,1)",
        overflowY: "auto",
      }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          // Recessed-tone alignment. The panel is the page-like
          // ground (C.bg) so inner CARD_BG cards (session detail, lot/maint
          // edit forms) read exactly as on the browse pages instead of
          // merging bg2-on-bg2. Brass border + shadow keep it delineated.
          background: C.bg,
          border: `1px solid ${alpha(C.brass, "33")}`,
          borderRadius: 14,
          padding,
          width: "100%",
          maxWidth,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          transform: mounted ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
          transition: "transform 180ms cubic-bezier(.2,.7,.3,1)",
          position: "relative",
          overflow: "hidden",
          outline: "none",
          // Cap the panel to the padded backdrop height and lay its
          // children out as a flex column, so a caller's inner scroll region
          // (not the backdrop) owns the scrolling.
          ...(capHeight ? { maxHeight: "100%", display: "flex", flexDirection: "column" } : {}),
        }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${C.brass}, transparent)` }} />
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  overline, title, onClose, accent = C.brass,
}: {
  overline?: string; title: React.ReactNode; onClose?: () => void; accent?: string;
}) {
  const ctx = useAppCtx();
  const closeLbl = ctx?.t ? ctx.t("btn_close") : "Fermer";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      padding: "16px 18px 14px", gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {overline && <Lbl color={accent} size={10}>{overline}</Lbl>}
        <h2 style={{
          margin: 0, padding: 0, fontWeight: 400,
          fontFamily: F.display, fontSize: fs(28), color: C.ivory,
          letterSpacing: -0.4, lineHeight: 1.1, marginTop: overline ? 4 : 0,
        }}>{title}</h2>
      </div>
      {onClose && (
        <IconBtn icon="close" onClick={onClose} ariaLabel={closeLbl} />
      )}
    </div>
  );
}
