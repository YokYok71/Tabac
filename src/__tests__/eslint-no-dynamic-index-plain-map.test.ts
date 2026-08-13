/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-dynamic-index-plain-map` (
 * /eslint-rules/no-dynamic-index-plain-map.cjs).
 *
 * The rule flags a DYNAMIC (non-literal) index into a MODULE-LEVEL plain-object
 * lookup map whose KEY type is runtime-forgeable (`Record<string, …>`,
 * `Record<any, …>`, an index-signature literal, or no annotation). A forged
 * key equal to a prototype member ("__proto__", "constructor"…) resolves to
 * Object.prototype and defeats the ubiquitous `M[key] || fallback` guard. The
 * fix is `Object.assign(Object.create(null), { … })`.
 *
 * Exercises every branch:
 *   VALID
 *     - null-proto map (Object.assign(Object.create(null), {…})) → safe
 *     - Object.create(null) map → safe
 *     - closed-union key (Record<SomeUnion, …>) → not forgeable, skipped
 *     - static literal key M["a"] / M[0] → safe
 *     - write target M[k] = v (construction) → skipped
 *     - delete M[k] → skipped
 *     - local (non-module-scope) plain map → out of scope
 *   INVALID
 *     - Record<string, …> module const, dynamic index → flagged
 *     - untyped module const object literal, dynamic index → flagged
 *     - Object.assign({}, {…}) (plain first arg) dynamic index → flagged
 *     - index-signature literal type { [k: string]: … } → flagged
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-dynamic-index-plain-map.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parser: requireCjs("typescript-eslint").parser,
  },
});

tester.run("no-dynamic-index-plain-map", rule, {
  valid: [
    // null-proto map — the canonical safe form.
    { code: `const M: Record<string, string> = Object.assign(Object.create(null), { a: "x" }); const v = M[k];` },
    // bare Object.create(null).
    { code: `const M: Record<string, string> = Object.create(null); const v = M[k];` },
    // closed-union key → not prototype-forgeable, exhaustiveness preserved.
    { code: `type K = "sm" | "md"; const M: Record<K, number> = { sm: 1, md: 2 }; const v = M[size];` },
    // static literal keys are safe.
    { code: `const M: Record<string, string> = { a: "x" }; const v = M["a"];` },
    { code: `const M: Record<string, string> = { a: "x" }; const v = M[0];` },
    // write target (map construction) is not a dangerous read.
    { code: `const M: Record<string, string> = {}; M[k] = "x";` },
    // delete is not a fall-through read.
    { code: `const M: Record<string, string> = { a: "x" }; delete M[k];` },
    // local (function-scope) plain map — out of scope.
    { code: `function f() { const M: Record<string, string> = { a: "x" }; return M[k]; }` },
    // dynamic index into a non-map call result — out of scope.
    { code: `const arr = [1, 2, 3]; const v = arr[i];` },
  ],
  invalid: [
    // Record<string, …> module const, dynamic index.
    {
      code: `const M: Record<string, string> = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    // Untyped module const object literal, dynamic index.
    {
      code: `const M = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    // Object.assign({}, {…}) — plain-object first arg is still a prototype.
    {
      code: `const M: Record<string, string> = Object.assign({}, { a: "x" }); const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    // Index-signature literal type is string-keyed.
    {
      code: `const M: { [k: string]: string } = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    // Record<any, …> is forgeable too.
    {
      code: `const M: Record<any, string> = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
  ],
});
