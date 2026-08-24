// The footer of a progressively-rendered list: the sentinel that extends the
// window on scroll, and the button that does the same thing by hand.
//
// BOTH HALVES ARE REQUIRED, and they are the same decision.
//
// The sentinel is what makes browsing feel continuous — nobody wants to tap a
// button every sixty rows down a catalogue. But an invisible extension is a cap
// that hides its own existence, which this repo has already paid for once (the
// Home's maintenance section shipped capped at five with nothing saying so, and
// read as « the work is done » when it was not). So the count is on screen, and
// the button is also the only way through for a reader whose browser gives no
// IntersectionObserver, who is navigating by keyboard, or who has landed here
// from a search-in-page rather than by scrolling.
//
// Renders NOTHING when the whole list is shown, so an ordinary collection never
// sees it.

import React from "react";
import { fs, C, F } from "../../theme-curator.ts";
import { PressCard } from "./primitives.tsx";

export function ProgressiveMore({
  hidden,
  onMore,
  sentinelRef,
  t,
  accent,
}: {
  hidden: number;
  onMore: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  t?: (k: string) => string;
  accent?: string;
}) {
  if (!hidden || hidden <= 0) return null;
  const col = accent || C.brassHi;
  const label = String(t ? t("list_more") : "Afficher la suite ({n})")
    .replace("{n}", String(hidden));
  return (
    <>
      {/* Sits ABOVE the button so the observer fires before the reader reaches
          the end of the rows — with the 600 px root margin, the next window is
          already in place by the time they get there. */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      <PressCard
        onClick={onMore}
        ariaLabel={label}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 44, padding: "10px 14px", marginBottom: 10,
          borderRadius: 8, background: "transparent",
          border: `1px dashed ${C.rule2}`,
        }}
      >
        <span style={{
          fontFamily: F.mono, fontSize: fs(11.5), letterSpacing: 0.8,
          textTransform: "uppercase", color: col,
        }}>{label}</span>
      </PressCard>
    </>
  );
}
