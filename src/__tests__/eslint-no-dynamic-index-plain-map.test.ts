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
    // `let` stays exempt — genuinely reassignable, so the map's shape at the
    // read site is not knowable from the declaration.
    { code: `let M: Record<string, string> = { a: "x" }; const v = M[k];` },
    // ALREADY GUARDED by an own-property test on the SAME map. Widening the
    // rule to `var` made it see this project's real tables for the first time,
    // and five of the seven sites it reported were correct code carrying
    // exactly this guard. Flagging them would have meant either reverting the
    // widening (losing the live defect it found) or bolting a disable comment
    // onto correct code, which teaches the next reader to silence the rule.
    {
      code: `var M: Record<string, string> = { a: "x" };\n`
        + `function f(k: string) { return Object.prototype.hasOwnProperty.call(M, k) ? M[k]! : ""; }`,
    },
    // …and the modern spelling of the same test.
    {
      code: `var M: Record<string, string> = { a: "x" };\n`
        + `function f(k: string) { return Object.hasOwn(M, k) ? M[k]! : ""; }`,
    },
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
    // MODULE-SCOPE `var`. The gate was `const` only, and this project declares
    // its lookup tables as `export var` throughout — so the rule was blind to
    // nearly all of them, live defect included (`AI_MODEL_OPTIONS[provider]`,
    // indexed by a value read straight from storage).
    {
      code: `var M: Record<string, string> = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    {
      code: `export var M: Record<string, string> = { a: "x" }; const v = M[k];`,
      errors: [{ messageId: "unsafe" }],
    },
    // The guard exemption is pinned to the map NAME: a test on a DIFFERENT map
    // in the same statement must not launder the read.
    {
      code: `var M: Record<string, string> = { a: "x" };\n`
        + `var N: Record<string, string> = { a: "y" };\n`
        + `function f(k: string) { return Object.prototype.hasOwnProperty.call(N, k) ? M[k]! : ""; }`,
      errors: [{ messageId: "unsafe" }],
    },
    // …and to the same STATEMENT: a guard several statements away is a
    // control-flow claim this rule cannot verify.
    {
      code: `var M: Record<string, string> = { a: "x" };\n`
        + `function f(k: string) { const ok = Object.prototype.hasOwnProperty.call(M, k);\n`
        + `  if (!ok) return ""; return M[k]!; }`,
      errors: [{ messageId: "unsafe" }],
    },
  ],
});
