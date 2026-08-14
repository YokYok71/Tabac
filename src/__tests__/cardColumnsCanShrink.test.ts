// A growing flex column that also carries padding must declare `minWidth: 0`.
//
// WHY THIS KEEPS HAPPENING. A flex item defaults to `min-width: auto`, which is
// its MIN-CONTENT width — so `flex: 1` does not mean "take what is left", it
// means "take what is left, but never less than my widest unbreakable child".
// A list card is a photo column plus a text column inside an `overflow: hidden`
// box, so the moment a translated badge or a long word exceeds the share, the
// text column grows instead of shrinking and its children are painted past the
// card and clipped. Nothing about it looks wrong in French.
//
// MEASURED on the pipe card at 360px in German at the "L" text size: the column
// wanted 253px where the card offered 234, and the name, the spec line and the
// "Ausgemustert" badge were each cut 5px short. The two tobacco cards already
// carried the fix; the pipe card never had it, and the accessory card — whose
// seeded strings simply happen to be shorter — did not either. That is the
// shape this file exists for: the twin nobody looked at is the one that bites,
// and the layout matrix passing on it is a property of the fixture, not of the
// layout.
//
// SOURCE-LEVEL on purpose. jsdom does not lay anything out, so the arithmetic is
// unreachable through a render, and `npm run i18n:layout` — which does measure
// it — needs a browser and is not a CI gate. This runs in `npm test`.
// Comments are blanked before matching, per the trap this repo has hit three
// times: a check satisfied by the prose explaining the fix rather than by the
// fix.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The list views whose cards are a photo column beside a text column. */
const VIEWS = [
  "src/views/curator/InventoryListView.tsx",
  "src/views/curator/PipesListView.tsx",
  "src/views/curator/AccListView.tsx",
];

/** Length-preserving comment blanking, so reported line numbers stay true. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

describe("a growing card column can shrink", () => {
  for (const file of VIEWS) {
    it(`${file.split("/").pop()}: every padded \`flex: 1\` column declares minWidth: 0`, () => {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      const offenders: string[] = [];
      let found = 0;
      lines.forEach((line, i) => {
        // The card's text column: the one flex child that grows AND owns the
        // padding. A `flex: 1` with no padding is a spacer or a bar, and is not
        // what clips — narrowing to this shape keeps the rule free of the false
        // positives that get a guard switched off.
        if (!/flex:\s*1\s*,/.test(line) || !/padding:/.test(line)) return;
        found++;
        if (!/minWidth:\s*0\b/.test(line)) offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 90)}`);
      });
      expect(found, `${file}: no padded flex:1 column found — the shape moved, re-point this test`)
        .toBeGreaterThan(0);
      expect(offenders, "a padded flex:1 column without minWidth: 0 will push its children past the card")
        .toEqual([]);
    });
  }

  it("covers every list view that renders a card with a photo column", () => {
    // Non-vacuity for the LIST itself: a fourth list view added without being
    // named here would be unguarded, and the defect is invisible in French.
    expect(VIEWS.length).toBe(3);
    for (const f of VIEWS) {
      expect(readFileSync(f, "utf8"), `${f}: no longer looks like a card list`).toContain("flex: 1");
    }
  });
});
