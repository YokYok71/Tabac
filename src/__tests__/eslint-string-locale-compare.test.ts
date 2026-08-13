/**
 * Self-test for the custom ESLint rule `tabac-local/string-locale-compare`
 * defined at /eslint-rules/string-locale-compare.cjs.
 *
 * The rule is the static check that prevents a runtime
 * crash from sneaking back in. This file exercises the rule directly:
 *   - Unsafe call sites get reported.
 *   - Safe call sites (String(...), template literals, string-method
 *     chains, string literals, logical-expr where both sides are safe)
 *     pass without report.
 *
 * RuleTester wires its own describe/it blocks under the hood. We call
 * RuleTester.run at module top level (NOT inside a vitest `it`) — that
 * way RuleTester sees vitest's globals and writes its assertions
 * directly into the test report.
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/string-locale-compare.cjs");

// Vitest exposes describe/it as globals when `globals: true` is set in
// the config (it's set in this project). RuleTester uses the global
// `describe`/`it`/`afterAll`. Inject them explicitly to be safe.
(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

tester.run("string-locale-compare", rule, {
  valid: [
    // String(x) — the canonical fix.
    { code: "String(a).localeCompare(String(b));" },
    // String literal.
    { code: '"foo".localeCompare(bar);' },
    // Template literal.
    { code: "`a-${x}`.localeCompare(y);" },
    // String-method chains.
    { code: "x.toLowerCase().localeCompare(y);" },
    { code: "x.trim().localeCompare(y);" },
    { code: "x.toString().localeCompare(y);" },
    { code: "x.replace(/a/, 'b').localeCompare(y);" },
    // Logical expr with both sides provably string.
    { code: "(String(a) || '').localeCompare(b);" },
    // single-assignment local traced to a string init.
    { code: "const k = String(a); k.localeCompare(b);" },
    { code: "var kk = x.trim(); kk.localeCompare(b);" },
    // A non-localeCompare call should be untouched.
    { code: "x.foo();" },
    // Member access on non-localeCompare property — untouched.
    { code: "var n = x.length;" },
  ],
  invalid: [
    // Plain identifier — the AST can't prove it's a string.
    {
      code: "a.localeCompare(b);",
      errors: [{ messageId: "unsafe" }],
    },
    // Member access (a.b) — the exact crash pattern.
    {
      code: "obj.field.localeCompare(other.field);",
      errors: [{ messageId: "unsafe" }],
    },
    // Logical expr with non-string fallback — the pattern.
    {
      code: "(lot.boxNumber || '').localeCompare(other);",
      errors: [{ messageId: "unsafe" }],
    },
    // A REASSIGNED local stays unprovable (soundness guard:
    // never suppress a real crash path just because it was string once).
    {
      code: "let k = String(a); k = lot.boxNumber; k.localeCompare(b);",
      errors: [{ messageId: "unsafe" }],
    },
  ],
});
