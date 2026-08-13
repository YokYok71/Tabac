import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// tap targets on the filter and sort controls.
//
// THE STANDARD, because the number 44 gets quoted without its source. WCAG 2.2
// SC 2.5.8 "Target Size (Minimum)" is **24 x 24** and is level AA — the bar
// normally required. WCAG 2.1 SC 2.5.5 "Target Size (Enhanced)" is 44 x 44 and
// is level AAA; Apple's HIG says 44 x 44 pt. This project adopted 44 as a house
// invariant (IconBtn defaults to it), which is stricter than compliance
// demands — worth knowing before treating every sub-44 element as a defect.
//
// WHAT WAS ACTUALLY WRONG, and it failed even AA: the 12 filter/sort selects
// were 18-20 px tall inside a wrapper that was 36 px tall and carried the
// border and background. So the control LOOKED 36 px and only its middle third
// opened the list — measured with elementFromPoint, a tap on the wrapper's
// padding hit the <div>, which has no handler. A small control you aim at; a
// control that looks twice its size you miss without understanding why.
//
// The `appearance: "none"` styling also disqualifies these from SC 2.5.8's
// "user agent control" exception: the author modified the presentation.
//
// Source-level on purpose — jsdom lays nothing out, so the pixel result lives
// in the browser harness. What can be locked here is the shape of the fix.

// Comments blanked, length-preserving. Every assertion below quotes a CSS
// declaration that the fix's own explanatory comment also quotes — and the
// first version of this file was satisfied by the comment, so the probe that
// removed the real declaration stayed green. Third time this trap has been hit
// in this file's neighbourhood; doc:check's gate 15 recorded it first.
const strip = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
const V = (f: string) => strip(readFileSync(resolve(__dirname, "../views/curator/" + f), "utf8"));
const FILTER_VIEWS = ["PipesListView.tsx", "AccListView.tsx", "InventoryListView.tsx", "JournalView.tsx"];

describe("filter/sort selects fill their visible control", () => {
  FILTER_VIEWS.forEach((f) => {
    it(`${f}: the select stretches and the wrapper has no vertical padding`, () => {
      const src = V(f);
      // The select must stretch to the wrapper's height…
      expect(src).toContain('alignSelf: "stretch"');
      // …and the wrapper must not hold vertical padding, which would sit
      // OUTSIDE the select and be dead.
      expect(src).not.toMatch(/padding: "8px 1[02]px",\s*\n\s*background: CARD_BG/);
    });

    it(`${f}: declares the 44 target height on the wrapper`, () => {
      expect(V(f)).toContain("minHeight: 44");
    });
  });
});

describe("the toggle buttons cannot be squeezed below 44", () => {
  it("ToggleBtn declares a non-shrinking 44px basis", () => {
    // They rendered 42 x 44 on the busiest row: `width: 44` with flex-shrink
    // defaulting to 1. A declared 44 the layout quietly overrules is worse than
    // no declaration — it reads as compliant in the source.
    const src = strip(readFileSync(
      resolve(__dirname, "../components/curator/FilterControls.tsx"), "utf8",
    ));
    expect(src).toContain('flex: "0 0 44px"');
  });

  it("the row beside them can yield, so nothing overflows", () => {
    // THE regression this fix caused and had to fix in turn: making the
    // toggles non-shrinking pushed the tobacco controls row past the viewport
    // in German at the L text size (measured before/after at 360 and 390 px —
    // false before, true after). A flex item defaults to `min-width: auto`, so
    // the sort wrapper refused to give up the 8 px. Trading a 2 px
    // accessibility shortfall for a horizontal overflow is a bad trade, and
    // this is the assertion that stops it being made again.
    const src = V("InventoryListView.tsx");
    const rows = src.split("flex: 1, minWidth: 0, display: \"flex\", alignItems: \"center\", gap: 8,");
    expect(rows.length - 1).toBeGreaterThanOrEqual(2);
  });
});
