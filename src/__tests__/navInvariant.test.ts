/**
 * Regression guard for the nav() invariant.
 *
 * Bug history: App.tsx's nav() reset
 * editId / editPipeId / editAccId / editSessId (and setAccForm /
 * setSessForm to their empty templates). Every edit handler in the
 * detail views follows the pattern:
 *
 *   setXxxForm(Object.assign({}, BX, item));
 *   setEditXxxId(item.id);
 *   nav("editX");
 *
 * React batches setStates within a single event and applies them in
 * order — so nav()'s setEditXxxId(null), called AFTER the handler's
 * setEditXxxId(item.id), won the race. At save time the store's
 * updateXxx walked `.map(p => p.id === editXxxId)` with
 * editXxxId === null, matched nothing, and silently persisted
 * unchanged data. No error.
 *
 * Unit tests of the stores didn't catch this because they invoked
 * setEditXxxId + updateXxx directly without crossing nav().
 *
 * This test does the static check: it reads App.tsx, extracts the
 * nav() function body, and asserts that none of the forbidden state
 * setters appear inside. A future commit that re-introduces the
 * reset fails this test immediately.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const APP_SRC = fs.readFileSync(
  path.resolve(__dirname, "../App.tsx"),
  "utf8",
);

// Extract everything between the `function nav(...) {` signature and
// the matching closing `}` at the same 2-space indent level. The nav
// function is defined inline in App.tsx at top-level inside the App
// component body.
function extractNavBody(src: string): string | null {
  // Signature lives at 2-space indent inside the App component.
  const sigRe = /^ {2}function nav\([^)]*\) \{$/m;
  const m = src.match(sigRe);
  if (!m) return null;
  const startIdx = src.indexOf(m[0]) + m[0].length;
  const tail = src.slice(startIdx);
  // Closing brace at the same 2-space indent (matches `\n  }`).
  const endRe = /\n {2}\}/;
  const endM = tail.match(endRe);
  if (!endM) return null;
  return tail.slice(0, tail.indexOf(endM[0]));
}

const NAV_BODY = extractNavBody(APP_SRC);

describe("App.tsx nav() — the edit-id lifecycle invariant", () => {
  it("the nav() function is locatable in App.tsx", () => {
    expect(
      NAV_BODY,
      "Could not extract nav() body — has the signature changed? Update the regex in extractNavBody if you intentionally refactored.",
    ).toBeTruthy();
  });

  // Forbidden statements: setters that wipe edit lifecycle state. If
  // any reappear inside nav(), all edit-via-detail flows (tobacco /
  // pipe / accessory / session) silently lose the user's changes at
  // save time. See CLAUDE.md "AppContext Pattern" → "nav() MUST NOT
  // reset edit IDs or form state".
  const forbidden: Array<[string, RegExp]> = [
    ["setEditId(null)", /\bsetEditId\s*\(\s*null\s*\)/],
    ["setEditPipeId(null)", /\bsetEditPipeId\s*\(\s*null\s*\)/],
    ["setEditAccId(null)", /\bsetEditAccId\s*\(\s*null\s*\)/],
    ["setEditSessId(null)", /\bsetEditSessId\s*\(\s*null\s*\)/],
    ["setEditWishId(null)", /\bsetEditWishId\s*\(\s*null\s*\)/],
    // Form resets are equally dangerous (accessory + session edit
    // handlers used to lose their form data through these).
    ["setForm(", /\bsetForm\s*\(/],
    ["setPipeForm(", /\bsetPipeForm\s*\(/],
    ["setAccForm(", /\bsetAccForm\s*\(/],
    ["setSessForm(", /\bsetSessForm\s*\(/],
    ["setWishForm(", /\bsetWishForm\s*\(/],
    // Locked-by-id state: detail object pointers (these CAN appear in
    // nav, listed here as a sanity bracket — current code DOES reset
    // setDetail/setPipeDet/setAccDet for sub-views, which is fine
    // because they're not user-edit state). NOT enforced.
  ];

  forbidden.forEach(([label, re]) => {
    it(`nav() body does NOT contain ${label}`, () => {
      expect(NAV_BODY).toBeTruthy();
      expect(
        NAV_BODY!,
        `nav() must not invoke ${label} — re-introducing this breaks the edit flow for tobacco/pipe/accessory/session. See CLAUDE.md "AppContext Pattern" invariant.`,
      ).not.toMatch(re);
    });
  });
});
