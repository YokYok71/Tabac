// Two layout defects, and the reason `i18n:layout` could
// not see either of them.
//
// That checker fails on three things: horizontal DOCUMENT overflow, a text
// NODE wider than its box under nowrap/hidden/ellipsis, and (since 141) a
// draggable horizontal scroller. Both defects here are outside all three:
//
//   • the tasting Lieu block is 24 px WIDER than its siblings but still inside
//     the viewport, so nothing overflows and nothing is hidden — it just steps
//     out of the left margin every other section keeps;
//   • the help search PLACEHOLDER is an ATTRIBUTE, not a text node, so the
//     walk never reads it.
//
// Both are asserted at source level, which is the honest level for them: the
// first IS a source fact (a declaration missing beside its siblings) and the
// second is a layout property jsdom cannot measure — it reports every offset
// as 0. Comments are blanked before matching, because a check satisfied by the
// comment explaining the fix has been this file's recurring trap (three
// separate releases each shipped one).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Length-preserving comment blanking, so a match is code and not prose. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

describe("the tasting setup's Lieu block keeps the page gutter", () => {
  const src = code("src/views/curator/TastingView.tsx");

  it("carries the same 12 px horizontal gutter as every sibling section", () => {
    expect(src).toContain('marginTop: 16, padding: "0 12px"');
  });

  it("a bare `marginTop: 16` wrapper no longer opens that block", () => {
    // The exact shape that shipped. Asserted as ABSENT so the fix cannot be
    // reverted by dropping the padding back off.
    expect(src).not.toMatch(/<div style=\{\{ marginTop: 16 \}\}>/);
  });

  it("and the siblings it must line up with are still 12 px", () => {
    // Non-vacuity: if the whole view moved to another gutter this test would
    // otherwise keep passing while the block was misaligned again.
    const gutters = src.match(/padding: "0 12px/g) || [];
    expect(gutters.length, "the 12 px page gutter is the house rule").toBeGreaterThan(3);
  });
});

describe("the help search field keeps its placeholder readable", () => {
  const src = code("src/views/curator/HelpView.tsx");

  it("the row wraps rather than squeezing the field", () => {
    expect(src).toMatch(/display: "flex"[\s\S]{0,200}?flexWrap: "wrap"/);
  });

  it("the field has a width floor, which is what makes the row actually break", () => {
    // Without it the field simply shrinks and the placeholder clips again —
    // `flexWrap` alone changes nothing, since a flex item with `flex: 1` is
    // happy at any width.
    expect(src).toContain('flex: "1 1 220px"');
  });

  it("the collapse-all button is still nowrap — it is a label, not a paragraph", () => {
    expect(src).toContain('whiteSpace: "nowrap"');
  });

  it("the German placeholder really is the longest — the premise, checked", () => {
    // If a future translation pass made them all short this fix would be
    // carrying no weight, and the next reader should be told so rather than
    // find an unexplained flexWrap.
    const lens = ["fr", "en", "es", "de", "it", "pt"].map((c) => {
      const dict = readFileSync(`src/i18n/${c}.ts`, "utf8");
      const ph = (dict.match(/^ {2}help_search_placeholder:"(.*)",$/m) || [])[1] || "";
      const btn = (dict.match(/^ {2}btn_collapse_all:"(.*)",$/m) || [])[1] || "";
      return { c, total: ph.length + btn.length };
    });
    const worst = lens.sort((a, b) => b.total - a.total)[0]!;
    expect(worst.c, "German is the case this row is sized against").toBe("de");
  });
});
