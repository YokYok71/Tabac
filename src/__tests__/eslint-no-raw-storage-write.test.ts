/**
 * Self-test for the custom ESLint rule `tabac-local/no-raw-storage-write`
 * defined at /eslint-rules/no-raw-storage-write.cjs.
 *
 * The rule flags raw Web-Storage WRITES (setItem / removeItem / clear on
 * localStorage or sessionStorage), which throw in Safari private mode / on
 * quota. Ordinary code should use lsSet / lsRemove (src/utils/appStorage.ts).
 *
 * Covered branches:
 *   - localStorage.setItem / removeItem / clear      → reported
 *   - sessionStorage.setItem / removeItem            → reported
 *   - window.localStorage.setItem (member receiver)  → reported
 *   - w.sessionStorage.removeItem (aliased receiver) → reported
 *   - localStorage.getItem                           → silent (reads don't throw)
 *   - lsSet(...) / lsRemove(...) wrapper calls        → silent
 *   - a same-named method on an unrelated object      → silent
 *   - computed access localStorage["setItem"](...)    → silent (only .prop calls)
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-raw-storage-write.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-raw-storage-write", rule, {
  valid: [
    // Reads never throw — not flagged.
    { code: `var v = localStorage.getItem("K");` },
    { code: `var v = sessionStorage.getItem("K");` },
    { code: `var v = window.localStorage.getItem("K");` },
    // The crash-safe wrappers.
    { code: `lsSet("K", "v");` },
    { code: `lsRemove("K");` },
    // A same-named method on an unrelated object is fine.
    { code: `myCache.setItem("K", "v");` },
    { code: `obj.removeItem("K");` },
    // Computed member access is out of scope (only `.setItem` etc.).
    { code: `localStorage["setItem"]("K", "v");` },
  ],
  invalid: [
    {
      code: `localStorage.setItem("K", "v");`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `localStorage.removeItem("K");`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `localStorage.clear();`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `sessionStorage.setItem("K", "v");`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `sessionStorage.removeItem("K");`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `window.localStorage.setItem("K", "v");`,
      errors: [{ messageId: "rawWrite" }],
    },
    {
      code: `w.sessionStorage.removeItem("K");`,
      errors: [{ messageId: "rawWrite" }],
    },
    // Even inside a try — the rule is intentionally structural (it doesn't
    // scope-analyse try guards); the fix is lsSet/lsRemove, not a try wrap.
    {
      code: `try { localStorage.setItem("K", "v"); } catch (e) {}`,
      errors: [{ messageId: "rawWrite" }],
    },
  ],
});
