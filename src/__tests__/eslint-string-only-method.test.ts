/**
 * Self-test for the companion ESLint rule
 * `tabac-local/string-only-method`. Mirrors the
 * structure of eslint-string-locale-compare.test.ts.
 *
 * Locks the list of flagged methods + the reuse of the
 * `isProvablyStringExpression` helper exported from the
 * `string-locale-compare` rule module.
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/string-only-method.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("string-only-method", rule, {
  valid: [
    // String(x).<method>() — canonical safe pattern.
    { code: "String(a).toUpperCase();" },
    { code: 'String(a).trim();' },
    { code: 'String(a).startsWith("foo");' },
    // String literals.
    { code: '"foo".toLowerCase();' },
    { code: '"foo".split(" ");' },
    // Template literals.
    { code: "`${a}`.replace(/x/, 'y');" },
    // Chained string method on a provably-string root.
    { code: "String(x).toLowerCase().trim();" },
    // single-assignment local traced back to a string init.
    { code: "const b = String(a); b.trim();" },
    { code: 'var normalized = String(s).replace(",", "."); normalized.match(/x/);' },
    { code: 'const k = ("" + a).length ? String(a) : "x"; k.toLowerCase();' },
    // Ternary RECEIVER where both branches are provably string.
    { code: '(cond ? "a" : String(b)).toUpperCase();' },
    // Methods NOT in the flagged set should pass through (defensive
    // sanity — these live on multiple prototypes).
    { code: "obj.toString();" },
    { code: "arr.slice(0, 2);" },
    { code: "arr.includes(x);" },
    // Non-call member access — untouched.
    { code: "var n = x.length;" },
  ],
  invalid: [
    {
      code: "x.toUpperCase();",
      errors: [{ messageId: "unsafe", data: { method: "toUpperCase" } }],
    },
    {
      code: "x.toLowerCase();",
      errors: [{ messageId: "unsafe", data: { method: "toLowerCase" } }],
    },
    {
      code: "x.trim();",
      errors: [{ messageId: "unsafe", data: { method: "trim" } }],
    },
    {
      code: 'x.startsWith("foo");',
      errors: [{ messageId: "unsafe", data: { method: "startsWith" } }],
    },
    {
      code: 'obj.value.replace(/x/, "y");',
      errors: [{ messageId: "unsafe", data: { method: "replace" } }],
    },
    {
      code: '(obj.value || "").split(",");',
      errors: [{ messageId: "unsafe", data: { method: "split" } }],
    },
    // A REASSIGNED local is not provably a string.
    {
      code: "let x = String(a); x = obj; x.trim();",
      errors: [{ messageId: "unsafe", data: { method: "trim" } }],
    },
    // A local whose init is NOT provably string stays flagged.
    {
      code: "const y = obj.raw; y.toLowerCase();",
      errors: [{ messageId: "unsafe", data: { method: "toLowerCase" } }],
    },
  ],
});
