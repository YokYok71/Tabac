/**
 * Self-test for the custom ESLint rule `tabac-local/number-only-method`
 * — companion to string-only-method for the Number family.
 * Flags .toFixed / .toPrecision / .toExponential on a receiver that isn't
 * provably a number (throws on a string/undefined value).
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/number-only-method.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parser: require("typescript-eslint").parser,
  },
});

tester.run("number-only-method", rule, {
  valid: [
    // Explicit coercion + builtins.
    { code: `Number(x).toFixed(2);` },
    { code: `parseFloat(s).toFixed(1);` },
    { code: `parseInt(s, 10).toFixed(0);` },
    { code: `Math.round(x).toFixed(2);` },
    { code: `Date.now().toFixed(0);` },
    // Arithmetic that always yields a number (not `+`).
    { code: `(a / b).toFixed(2);` },
    { code: `(a - b).toFixed(2);` },
    { code: `(a * b).toFixed(2);` },
    { code: `(a % b).toFixed(2);` },
    { code: `(sum / arr.length).toFixed(1);` },
    // Unary / literals / length.
    { code: `(-x).toFixed(2);` },
    { code: `(+x).toFixed(2);` },
    { code: `(42).toFixed(2);` },
    { code: `arr.length.toFixed(0);` },
    // TS assertion + logical/conditional where both branches are numbers.
    { code: `(x as number).toFixed(2);` },
    { code: `((v as number) || 0).toFixed(0);` },
    { code: `(cond ? a - 1 : Number(b)).toFixed(2);` },
    // Unrelated method / receiver — not flagged.
    { code: `str.toUpperCase();` },
    { code: `date.toLocaleString();` }, // toLocaleString is intentionally NOT covered
  ],
  invalid: [
    { code: `x.toFixed(2);`, errors: [{ messageId: "unsafe" }] },
    { code: `lot.weightG.toFixed(2);`, errors: [{ messageId: "unsafe" }] },
    { code: `val.toPrecision(3);`, errors: [{ messageId: "unsafe" }] },
    { code: `n.toExponential(2);`, errors: [{ messageId: "unsafe" }] },
    // `+` can concatenate strings → NOT provably a number.
    { code: `(a + b).toFixed(2);`, errors: [{ messageId: "unsafe" }] },
    // `x || y` with a non-number branch is not provably a number.
    { code: `(x || "").toFixed(2);`, errors: [{ messageId: "unsafe" }] },
  ],
});
