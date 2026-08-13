/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-fs-in-input` defined at
 * /eslint-rules/no-fs-in-input.cjs.
 *
 * The rule flags `fontSize: fs(...)` inside the inline style object of a
 * JSX <input>/<textarea>. Text fields must size via fsInput() so the value
 * can't fall below the 16px iOS zoom-on-focus floor.
 *
 * Exercises every branch:
 *   - fontSize: fs(...) on <input>/<textarea> → reported.
 *   - fontSize inside a conditional that contains fs() → reported.
 *   - fontSize: fsInput(...) → silent.
 *   - fs() in a NON-fontSize property → silent.
 *   - fs() on a non-input element (<span>) → silent.
 *   - style spread const (not an object literal) → silent (out of scope).
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-fs-in-input.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const PROD = "/repo/src/views/curator/SomeView.tsx";

tester.run("no-fs-in-input", rule, {
  valid: [
    // Correct: input sizes via fsInput().
    { code: `const x = <input style={{ fontSize: fsInput(14) }} />;`, filename: PROD },
    { code: `const x = <textarea style={{ fontSize: fsInput(15) }} />;`, filename: PROD },
    // fs() in a non-fontSize property is fine (padding etc. don't zoom).
    { code: `const x = <input style={{ padding: fs(8) }} />;`, filename: PROD },
    // fs() on a non-field element is fine — only inputs zoom.
    { code: `const x = <span style={{ fontSize: fs(12) }}>x</span>;`, filename: PROD },
    { code: `const x = <div style={{ fontSize: fs(20) }} />;`, filename: PROD },
    // style referencing a shared const object is out of scope (no literal).
    { code: `const x = <input style={baseInput} />;`, filename: PROD },
    // Plain numeric fontSize (already ≥16) — not an fs() call.
    { code: `const x = <input style={{ fontSize: 16 }} />;`, filename: PROD },
  ],
  invalid: [
    // Direct fs() on an input.
    {
      code: `const x = <input style={{ fontSize: fs(14) }} />;`,
      filename: PROD,
      errors: [{ messageId: "fsInInput" }],
    },
    // Direct fs() on a textarea.
    {
      code: `const x = <textarea style={{ fontSize: fs(15) }} />;`,
      filename: PROD,
      errors: [{ messageId: "fsInInput" }],
    },
    // Conditional whose branches call fs().
    {
      code: `const x = <input style={{ fontSize: big ? fs(16) : fs(13) }} />;`,
      filename: PROD,
      errors: [{ messageId: "fsInInput" }],
    },
    // Alongside a spread + other props — the fontSize prop is still flagged.
    {
      code: `const x = <input style={{ ...base, padding: fs(6), fontSize: fs(14) }} />;`,
      filename: PROD,
      errors: [{ messageId: "fsInInput" }],
    },
  ],
});
