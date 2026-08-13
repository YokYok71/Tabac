import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-scrolling-focus.cjs");

// RuleTester drives describe/it itself, so it must run at the TOP level —
// calling it inside an `it` throws "Calling the suite function inside test
// function is not allowed". Same wiring as the other rule self-tests here.
(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

// self-test for tabac-local/no-scrolling-focus.
//
// A lint rule's failure mode is SILENCE: one that stops matching reports
// Nothing, which is indistinguishable from a clean codebase. An earlier release found a
// rule that had shipped with no self-test for exactly this reason, so every
// rule gets one.
//
// What this rule exists for: `focus()` scrolls the page by default, and the
// defect is invisible in BOTH engines available here — jsdom does not lay out
// or scroll at all, and Chromium focuses a `div[tabindex=0]` on tap (so a
// focus restore lands back on the row) and treats `document.body.focus()` as a
// no-op. iOS Safari does neither. So a bare `.focus()` can be added, measured
// green in every harness in this repo, and still lose the user's place.

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-scrolling-focus", rule, {
  valid: [
    { code: "el.focus({ preventScroll: true });" },
    { code: "ref.current?.focus({ preventScroll: true });" },
    { code: "(a || b).focus({ preventScroll: true });" },
    // Unreadable argument — accepted rather than guessed at. Guessing is what
    // produces the false positives that get guards switched off.
    { code: "el.focus(opts);" },
    { code: "el.focus({ ...opts });" },
    // Not the DOM shape.
    { code: "focus();" },
    { code: "el.blur();" },
    { code: "el.focusSomething();" },
    // A property that merely CONTAINS the word.
    { code: "el.refocus();" },
  ],
  invalid: [
    // The shape the whole build was about.
    { code: "el.focus();", errors: [{ messageId: "bare" }] },
    { code: "ref.current?.focus();", errors: [{ messageId: "bare" }] },
    { code: "document.body.focus();", errors: [{ messageId: "bare" }] },
    { code: "(focusable || node).focus();", errors: [{ messageId: "bare" }] },
    // An options object that says nothing about scrolling is no better than
    // none — this is the shape a half-applied fix would leave behind.
    { code: "el.focus({});", errors: [{ messageId: "bare" }] },
    { code: "el.focus({ visible: true });", errors: [{ messageId: "bare" }] },
    // Explicitly asking to scroll: still flagged, because the disable comment
    // is where that decision gets a reason attached.
    { code: "el.focus({ preventScroll: false });", errors: [{ messageId: "bare" }] },
    // Computed access must not be an escape hatch.
    { code: "el['focus']();", errors: [{ messageId: "bare" }] },
],
});

describe("tabac-local/no-scrolling-focus — wiring", () => {
  it("is wired into eslint.config.js at error level", () => {
    // The rule file existing proves nothing — the lesson, one layer out:
    // a decision that is never CALLED guards nothing.
    const cfg = readFileSync(resolve(__dirname, "../../eslint.config.js"), "utf8");
    expect(cfg).toContain('"tabac-local/no-scrolling-focus": "error"');
    expect(cfg).toContain("no-scrolling-focus.cjs");
  });

  it("is OFF in tests and in scripts, for a stated reason", () => {
    // A `.focus()` there SIMULATES the browser, which does scroll — opting out
    // would model something that never happens. Asserted so the exemption
    // stays deliberate rather than becoming a place to hide production code.
    const cfg = readFileSync(resolve(__dirname, "../../eslint.config.js"), "utf8");
    const offs = cfg.split('"tabac-local/no-scrolling-focus": "off"').length - 1;
    expect(offs).toBe(2);
  });
});
