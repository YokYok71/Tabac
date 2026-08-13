/**
 * Regression guard for the scroll-preservation fix.
 *
 * Bug history: nav() unconditionally
 * snapshotted window.scrollY into scrollSaveRef whenever the leaving
 * view was a list (`inv` / `pipes` / `acc` / `journal`). Combined with
 * detail panels scrolling to top on open (ctxSetDetail / ctxSetPipeDet
 * / ctxSetAccDet), tapping Edit inside a detail panel overwrote the
 * saved list-scroll (set by ctxSetDetail) with 0 — because at that
 * moment window.scrollY was 0 (detail panel at top) and `view` was
 * still the list view. Saving the edit then restored 0 and the user
 * landed at the top of the list.
 *
 * Fix: the scroll snapshot inside nav() is now gated on
 * `!detail && !pipeDet && !accDet` — when a detail panel is open the
 * snapshot stored by ctxSetDetail/ctxSetPipeDet/ctxSetAccDet stays
 * intact and the post-save restore lands at the correct position.
 *
 * This file does a static check on App.tsx so any future refactor that
 * drops the detail-aware guard fails CI immediately.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const APP_SRC = fs.readFileSync(
  path.resolve(__dirname, "../App.tsx"),
  "utf8",
);

function extractNavBody(src: string): string | null {
  const sigRe = /^ {2}function nav\([^)]*\) \{$/m;
  const m = src.match(sigRe);
  if (!m) return null;
  const startIdx = src.indexOf(m[0]) + m[0].length;
  const tail = src.slice(startIdx);
  const endRe = /\n {2}\}/;
  const endM = tail.match(endRe);
  if (!endM) return null;
  return tail.slice(0, tail.indexOf(endM[0]));
}

const NAV_BODY = extractNavBody(APP_SRC);

describe("App.tsx nav() — the scroll-snapshot guard", () => {
  it("nav() body is locatable", () => {
    expect(NAV_BODY).toBeTruthy();
  });

  it("nav() reads detail / pipeDet / accDet before snapshotting the list scroll", () => {
    expect(NAV_BODY).toBeTruthy();
    // Must reference all three detail panels — otherwise tapping Edit
    // from a detail view will overwrite the position saved by
    // ctxSetDetail / ctxSetPipeDet / ctxSetAccDet with window.scrollY=0.
    expect(NAV_BODY!).toMatch(/\bdetail\b/);
    expect(NAV_BODY!).toMatch(/\bpipeDet\b/);
    expect(NAV_BODY!).toMatch(/\baccDet\b/);
  });

  it("the four scrollSaveRef snapshot lines sit behind a guard (not at the top level)", () => {
    expect(NAV_BODY).toBeTruthy();
    // Locate each snapshot line and verify it sits inside a block
    // (preceding `{` somewhere before the next `}` at the same level)
    // rather than at the top of the function body. A simpler proxy:
    // ensure each snapshot is preceded on its own line by extra
    // indentation (it lives inside an `if (!_hasDetail) { ... }` block,
    // so the line starts with at least 6 spaces, not 4).
    const keys = ["inv", "pipes", "acc", "journal"];
    for (const k of keys) {
      const lineRe = new RegExp(
        `\\n( +)if \\(view === "${k}"\\)\\s+scrollSaveRef\\.current\\["${k}"\\]`,
      );
      const m = NAV_BODY!.match(lineRe);
      expect(
        m,
        `Could not find the ${k} snapshot line — has nav() been rewritten? Update this regex or restore the per-list snapshot.`,
      ).toBeTruthy();
      // Top-level function body in nav() uses 4-space indent. A guarded
      // line lives one level deeper (6 spaces). If it slips back to 4,
      // the guard was removed.
      expect(
        m![1]!.length,
        `${k} scroll snapshot is at the top-level of nav() — it must sit inside the detail-aware guard.`,
      ).toBeGreaterThanOrEqual(6);
    }
  });
});
