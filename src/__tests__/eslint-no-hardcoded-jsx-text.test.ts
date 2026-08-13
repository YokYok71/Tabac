/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-hardcoded-jsx-text` defined at
 * /eslint-rules/no-hardcoded-jsx-text.cjs.
 *
 * The rule flags bare JSX text literals (`<span>Bonjour</span>`) that
 * read like user-facing copy — a hardcoded label that never went through
 * t()/xl() and so shows the same string to every language. It is the
 * companion to no-hardcoded-lang-ternary.
 *
 * Exercises every branch:
 *   - Accented / multi-word JSX text → reported.
 *   - Single symbol glyphs (×, —, ✕) → silent (no 2-letter word).
 *   - {t("key")} / {expr} (JSXExpressionContainer, not JSXText) → silent.
 *   - Pure numbers / units → silent.
 *   - Allowed files (i18n dicts, tests) → silent.
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-hardcoded-jsx-text.cjs");

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

tester.run("no-hardcoded-jsx-text", rule, {
  valid: [
    // Single symbol glyph — no real word.
    { code: `const x = <span>×</span>;`, filename: PROD },
    { code: `const x = <span>—</span>;`, filename: PROD },
    { code: `const x = <span>✕</span>;`, filename: PROD },
    // Interpolated text goes through t() — JSXExpressionContainer, not JSXText.
    { code: `const x = <span>{t("hello")}</span>;`, filename: PROD },
    { code: `const x = <span>{value}</span>;`, filename: PROD },
    // Pure number / unit.
    { code: `const x = <span>2026</span>;`, filename: PROD },
    { code: `const x = <span>42 g</span>;`, filename: PROD },
    // Allowed file: the i18n aggregator.
    {
      code: `const x = <span>Bonjour le monde</span>;`,
      filename: "/repo/src/i18n.ts",
    },
    // Allowed file: tests.
    {
      code: `const x = <span>Bonjour le monde</span>;`,
      filename: "/repo/src/__tests__/foo.test.tsx",
    },
  ],
  invalid: [
    // Accented single word.
    {
      code: `const x = <span>Terminé</span>;`,
      filename: PROD,
      errors: [{ messageId: "jsxText" }],
    },
    // Multi-word English phrase (whitespace + word).
    {
      code: `const x = <span>Save your work</span>;`,
      filename: PROD,
      errors: [{ messageId: "jsxText" }],
    },
    // Accented French phrase.
    {
      code: `const x = <div>Une nouvelle envie</div>;`,
      filename: PROD,
      errors: [{ messageId: "jsxText" }],
    },
    // Mixed literal + interpolation — the literal part is still flagged.
    {
      code: `const x = <span>Ma Cave à Tabac · {url}</span>;`,
      filename: PROD,
      errors: [{ messageId: "jsxText" }],
    },
  ],
});
