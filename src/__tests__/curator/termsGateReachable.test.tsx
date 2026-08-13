// The FIRST screen of the app opened with its top cut off,
// and the cut-off part could not be scrolled to.
//
// `TermsGate`'s root is `position: fixed; inset: 0; overflow: auto` and its
// inner column was centred with `justify-content: center`. When the content is
// taller than the viewport, centring overflows it EQUALLY in both directions —
// and `scrollTop` cannot go below 0, so everything above the start edge is
// unreachable, not merely scrolled away.
//
// MEASURED in Chromium before the fix, with `scrollTop` forced to -9999 (it
// stayed 0) and `elementFromPoint` returning nothing at the toggle's centre:
//
//   fr / M / 390x844  (the app's reference width)  toggle at y = -55
//   de / M / 390x844                               toggle at y = -67
//   fr / M / 375x667  (iPhone SE)                  toggle at y = -167
//   de / L / 360x640                               toggle at y = -273, title with it
//   fr / M / 412x915                               toggle at y = +2   (only width that escaped)
//
// After: y = +23 and reachable in all five, and at 834x1400 — where the content
// fits — the column is still centred to the pixel (top 300 of (1400-800)/2).
//
// The lost control is the language switcher: the one thing a non-French speaker
// needs before anything else in the app works. iOS is worse still, since the
// safe-area inset adds to the padding below.
//
// This is a SOURCE-level lock because jsdom does not lay out or scroll — the
// same reason `modalFocusNoScroll.test.tsx` is written this way. Comments are
// blanked first: three separate releases each shipped a check that was
// satisfied by the comment explaining the fix.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/views/curator/TermsGate.tsx", "utf8");
// length-preserving, so any line number in a failure still points at the file
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

describe("the terms gate cannot clip its own top", () => {
  it("the scrolling root is still the fixed layer", () => {
    // The defect needs BOTH halves; if the root ever stops being a scroll
    // container the centring question changes shape and this lock must be
    // revisited rather than silently passing.
    expect(CODE).toMatch(/position:\s*"fixed"/);
    expect(CODE).toMatch(/overflow:\s*"auto"/);
  });

  it("centres the column with auto cross margins, never justify-content", () => {
    expect(CODE, "the inner column must absorb free space with `margin: auto 0`")
      .toMatch(/margin:\s*"auto 0"/);
    // `justifyContent: "center"` on the ROOT is the horizontal centring and is
    // fine — it is the COLUMN's own one that overflowed. The column is the
    // block carrying flexDirection: "column".
    const col = /flexDirection:\s*"column"[^}]*}/.exec(CODE);
    expect(col, "the inner column declaration moved — re-read this test").toBeTruthy();
    expect(col![0], "a centred column inside an overflow:auto root loses its top")
      .not.toMatch(/justifyContent:\s*"center"/);
  });

  it("still offers every registry language", () => {
    // An earlier release was spent making this toggle cover all six; the layout defect
    // made it unreachable, so the two guarantees belong together.
    expect(CODE).toMatch(/LANGUAGES\.map/);
  });
});
