/**
 * A tobacco / pipe / accessory photo is shown WHOLE, and never
 * has a ground of its own. One rule, seven surfaces: the four list cards and
 * the three detail heroes.
 *
 * HOW THIS SETTLED, because the file has been rewritten once already and the
 * history is the reason for its shape:
 *   · the first version combined `center/contain` with an 8px padding and a coloured
 *     ground, deliberately drawing a "polaroid" frame;
 *   · that ground was `C.cream` — a TEXT token — so MODE_LIGHT mapped it to
 *     #2e2a1e and the frame rendered near-black on parchment (fixed 38);
 *   · 38 kept the historic cream for DARK "so the validated look does not move",
 *     which preserved a value that was also wrong (fixed 39, made white);
 *   · 40 asked the right question — why a ground at all? — and removed the frame
 *     by switching to `center/cover`, which fills the box;
 *   · 41 reverses the FIT, not the frame: cover fills by CROPPING, so a tall tin
 *     or a long pipe can never be seen whole — the one thing an inventory photo
 *     is for. Reported from the app with a cropped Marlow & Finch tin.
 *
 * So the settled rule has two halves that must hold TOGETHER, and the earlier
 * attempts each got one of them: `contain` (whole object) AND no ground of its
 * own (no frame). Asserting only one is how this kept half-regressing.
 *
 * It is a SOURCE invariant (the iosPwaDockGuard.test.ts pattern) because the
 * guarantee is that seven separate sites AGREE — a rendering test would have to
 * mount six views and seed IndexedDB photos to observe the same thing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Strip comments before matching: the first version of this test matched the
// words "center/contain" inside the comment EXPLAINING the fix, so it failed on
// correct code. A source guard must read code, not the prose around it.
const codeOf = (file: string) => readFileSync(file, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");

// Extract the style object ENCLOSING a given line, by brace matching.
//
// This used to be sized in LINES (`slice(i, i + 12)`), and brace matching replaced that
// for the three fiche heroes — but left the identical ±N window in place for
// the three list cards, three tests above, in this same file. An audit then
// proved the exact defect (a `borderRight`/`borderBottom` frame around
// the photo column, reported twice from the app) could be reinstated on ALL
// THREE cards with nothing red, because the style object runs ~14 lines past
// the window. A guard sized in lines decays every time someone edits nearby —
// which is precisely what my own added comments had already done to it.
function styleBlockAt(lines: string[], i: number): string {
  let start = i;
  while (start > 0 && !/style=\{\{|<PressCard/.test(lines[start]!)) start--;
  let depth = 0, end = start;
  for (; end < lines.length; end++) {
    for (const ch of lines[end]!) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (end > start && depth <= 0) break;
  }
  return lines.slice(start, end + 1).join("\n");
}

// Every `border…: 1px` in a block must be the EMPTY-SLOT branch of a
// conditional spread — a placeholder is a UI slot, not a photo.
function expectNoHardBorder(block: string, where: string) {
  for (const line of block.split("\n")) {
    const code = line.replace(/\/\/.*$/, "");
    if (!/border(Right|Bottom|Left|Top)?:\s*`?1px/.test(code)) continue;
    expect(code, `unconditional border on ${where}: ${code.trim()}`)
      .toMatch(/\.\.\.\([^)]*imageUrl\s*\?\s*\{\}\s*:\s*\{\s*border/);
  }
}

const LIST_CARDS = [
  ["src/views/curator/InventoryListView.tsx", 2], // TobaccoCard + WishCard
  ["src/views/curator/PipesListView.tsx", 1],
  ["src/views/curator/AccListView.tsx", 1],
] as const;

const DETAIL_HEROES = [
  ["src/views/curator/InventoryDetailView.tsx", "tob.imageUrl"],
  ["src/views/curator/PipesDetailView.tsx", "p.imageUrl"],
  ["src/views/curator/AccessoryDetailView.tsx", "a.imageUrl"],
] as const;

describe("entity photos are shown whole, with no frame", () => {
  for (const [file, count] of LIST_CARDS) {
    const src = codeOf(file);

    it(`${file} — the whole object is visible (contain, ${count} card(s))`, () => {
      const contain = src.split("center/contain no-repeat").length - 1;
      expect(contain, "every card photo must use center/contain").toBe(count);
      expect(src, "cover crops: a tall tin is cut off and never fully visible")
        .not.toContain("center/cover");
    });

    it(`${file} — no border outlines the photo column`, () => {
      // `borderRight` + `borderBottom` in C.rule were the last of the
      // An earlier release frame. They read as a photo/text separator only while the
      // photo FILLED the column; under `contain` a wide photo leaves them
      // closing a mostly-empty box in a colour distinct from the card.
      const lines = src.split("\n");
      const col = lines.findIndex((l) => l.includes("width: 100, height: 110"));
      expect(col, "the photo column should still be 100x110").toBeGreaterThan(-1);
      const block = styleBlockAt(lines, col);
      expect(block, "brace scan should have captured the photo column")
        .toContain("width: 100, height: 110");
      expect(block, "no border on the photo column").not.toMatch(/border(Right|Bottom|Left|Top)?:\s*`?1px/);
    });

    it(`${file} — the photo has no ground of its own`, () => {
      // `padding: photoSrc ? 8 : 0` drew the frame; any photo-conditional
      // padding is the same defect under a different number.
      expect(src).not.toMatch(/padding:\s*photoSrc\s*\?/);
      // A coloured ground behind a CONTAINED photo shows as a band, and can
      // only ever be right in some of the six theme×mode combos. Transparent
      // lets the card show through — the photo floats.
      const m = src.match(/background:\s*photoSrc\s*\?\s*("?)([^:]+)\1\s*:/);
      expect(m, "the photo branch should set a background").toBeTruthy();
      expect(m![2]!.trim().replace(/"/g, ""), "must be transparent, not a colour")
        .toBe("transparent");
    });
  }

  for (const [file, field] of DETAIL_HEROES) {
    it(`${file} — the hero shows the whole object, no fallback colour`, () => {
      const src = codeOf(file);
      const line = src.split("\n").find((l) => l.includes(field) && l.includes("safeBgUrl"));
      expect(line, `no hero background line found for ${field}`).toBeTruthy();
      expect(line, "hero must use contain").toContain("center/contain");
      // The trailing `, ${C.bg2}` fallback was invisible under cover; under
      // contain it becomes a visible band, so it is gone.
      expect(line, "no fallback colour behind a contained hero photo").not.toMatch(/no-repeat,\s*\$\{C\./);
    });

    it(`${file} — no border frames the hero photo`, () => {
      // The gap this closes: one pass gave the heroes `contain` and the next
      // stripped the borders from the LIST cards — but nothing checked the
      // FICHE borders, so all three kept a 1px C.rule frame. Under `contain` a
      // wide pipe fills about a third of the box, so that border closed a
      // mostly-empty rectangle: the exact defect that was reported twice on the
      // lists, still live one screen deeper. Asserting `contain` was never
      // enough on its own; the frame is a separate property.
      const src = codeOf(file);
      const lines = src.split("\n");
      const i = lines.findIndex((l) => l.includes(field) && l.includes("safeBgUrl"));
      expect(i).toBeGreaterThan(-1);
      // Extract the ENCLOSING style object by brace matching, not a fixed ±N
      // window. The first version sliced i-6..i+10 — and adding a few lines of
      // comment above the border silently pushed it outside the window, so the
      // guard reported green on an injected unconditional border. A window sized
      // in lines is a guard that decays every time someone edits nearby.
      const block = styleBlockAt(lines, i);
      expect(block, "brace scan should have captured the background line")
        .toContain("safeBgUrl");
      expectNoHardBorder(block, "the hero");
    });
  }

  it("no photoMatte token lingers", () => {
    // It became unreachable when the frame went; knip is a gate,
    // so a dead token would fail the build rather than sit there.
    expect(codeOf("src/theme-curator.ts")).not.toContain("photoMatte");
  });
});
