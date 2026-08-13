// text painted PAST a hidden-overflow ancestor.
//
// `i18n:layout` had three failure modes: the DOCUMENT slides sideways, a text
// leaf clips its OWN content, and some container became horizontally
// draggable. An earlier release met a case that is none of them — the lot modal's
// Close/Delete/Edit row needed 349px in a 340px panel in German at the DEFAULT
// text size and the third button read « BEARBE » — and recorded the gap here
// rather than closing it. The shared `Modal` panel is `overflow: hidden`, so
// the excess is swallowed AND `document.scrollWidth` stays unchanged: the
// screen was in the checker's list and passed.
//
// The fourth rule closed it, and on its first honest run over the clean tree
// it found TWO pre-existing defects nothing had ever seen. Both are locked
// below, because the value of the rule is the defects it prevents, not the
// rule's own presence.
//
// WHY SOURCE-LEVEL: the rule is geometry (a leaf's right edge against its
// clipping ancestor's client edge) and jsdom reports every layout box as zero,
// so the arithmetic is unreachable from a unit test. Same position as
// scrollRestoration.test.ts. What IS checkable here is that the decisions
// survive, and that the two fixes are not quietly reverted.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Blank comments length-preservingly so a match is CODE and not prose.
 * Learned three times in this repo: the first version
 * of a source-level guard is routinely satisfied by the comment explaining
 * the very fix it is meant to lock, and stays green under probe.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

describe("the checker gained the fourth failure mode", () => {
  const src = code("scripts/i18n-layout.cjs");

  it("collects cut-off text and reports it as a FAILURE, not a note", () => {
    // The tobacco-card footer canary is reported without failing; this must
    // not join it. A silently unreachable control is a defect, not a taste.
    expect(src).toContain("cutOff");
    expect(src).toMatch(/for \(const c of r\.cutOff\)[\s\S]{0,200}failures\.push/);
  });

  it("hands `auto` / `scroll` back to the hscroll rule instead of accusing it", () => {
    // Content inside a real scroller IS reachable — by dragging — and build
    // 141's rule already owns that case. Walking past it would report every
    // deliberate scroller a second time under the wrong name.
    expect(src).toMatch(/ox === "auto" \|\| ox === "scroll"/);
    expect(src).toMatch(/data-hscroll/);
  });

  it("exempts a SIGNPOSTED truncation — the over-reach that was caught and removed", () => {
    // The first version flagged seven search-result rows: the title is a
    // nowrap/hidden/ellipsis div wrapping an italic <span>, so the span is the
    // leaf and lays out at natural width. But an ellipsis renders "…", which
    // tells the reader there is more — and whether that is the RIGHT call is
    // editorial. An earlier release decided it both ways inside one component: wrong
    // for the subtitle (closed enum set, computable maximum) and right for the
    // title (a blend name is unbounded). A rule flagging both would force the
    // second to be "fixed" into unbounded wrapping.
    //
    // POSITIONAL, and it had to be: the first version of this case asserted
    // only that `textOverflow === "ellipsis"` appears somewhere in the file —
    // and it appears TWICE, the other in the pre-existing `clipped` rule's
    // `cannotShow`. Deleting the exemption left the other match and the case
    // stayed GREEN under probe. What matters is not that the string exists but
    // that the check sits INSIDE the hidden branch, before the element is
    // accused, so that is what is asserted.
    // The gaps are MEASURED, not guessed: 835 chars from the branch to the
    // exemption (the reasoning above it is long, and `code()` blanks comments
    // length-preservingly so they still occupy their span) and 44 to the
    // assignment. Budgeted with room to breathe, but far below the distance to
    // the OTHER `textOverflow` in the file, which is what must not match here.
    expect(src).toMatch(
      /ox === "hidden"[\s\S]{0,1200}?textOverflow === "ellipsis"[\s\S]{0,200}?clip = p/,
    );
  });

  it("measures against the client edge, not the border box", () => {
    // getBoundingClientRect().right includes the border; clientLeft skips it
    // and clientWidth excludes it and any scrollbar. Off-by-a-border here
    // would make every bordered panel report ~1px and drown the real hits.
    expect(src).toMatch(/clip\.clientLeft \+ clip\.clientWidth/);
  });

  it("says so in the success line — a green run must state what it checked", () => {
    expect(src).toMatch(/no stray horizontal scroller, nothing cut off/);
  });
});

describe("the two defects the rule found on its first clean run", () => {
  it("the session detail modal's action row wraps, like its lot-modal twin", () => {
    // Byte-identical to the lot detail modal's row BEFORE it was fixed.
    // An earlier release fixed one twin and never looked at the other, so « BEARBEITEN »
    // was cut 27px past the panel edge in German at the default text size.
    const src = code("src/views/curator/JournalView.tsx");
    const row = src.match(/\{\s*display: "flex",[^}]*gap: 10, marginTop: 6\s*\}/);
    expect(row, "the session modal action row moved — re-check it wraps").toBeTruthy();
    expect(row![0]).toContain('flexWrap: "wrap"');
  });

  it("the Stats category legend label can shrink AND can break", () => {
    // A flex item defaults to `min-width: auto`, so `flex: 1` alone refuses to
    // shrink below its content: at 360px the donut (160) + gap (14) leave the
    // legend ~132px, « Virginia/Burley » needs more, and the VALUE beside it
    // was pushed past the card's `overflow: hidden` edge and cut. The trap of
    // Three earlier releases, a fourth time.
    //
    // BOTH halves are asserted because either alone is insufficient:
    // minWidth:0 lets the box shrink, and `/` is UAX #14 class SY — not a
    // break opportunity — so without softBreakSlashes the TEXT would simply
    // overflow the now-narrower box instead.
    const src = code("src/views/curator/StatsView.tsx");
    const i = src.indexOf("softBreakSlashes(String(item.label))");
    expect(i, "the Stats legend label lost its slash break").toBeGreaterThan(0);
    const span = src.slice(Math.max(0, i - 240), i);
    expect(span).toContain("minWidth: 0");
    expect(span).toContain('overflowWrap: "anywhere"');
  });

  it("reuses HomeViewV2's shape rather than inventing a second one", () => {
    // An earlier release solved this exact string in this exact bind for the Home
    // "Familles" row. Two spellings of one rule is how the tag predicate came
    // to live in four copies and FAMILY_AGING_MAX in two (168).
    const home = code("src/views/curator/HomeViewV2.tsx");
    expect(home).toContain("softBreakSlashes(");
    expect(home).toContain("minWidth: 0");
  });
});
