/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-hardcoded-lang-ternary` defined at
 * /eslint-rules/no-hardcoded-lang-ternary.cjs.
 *
 * The rule is an anti-regression guardrail for the "hardcoded UI
 * language" leak class that the i18n sweep removed:
 * `lang === "en" ? "English text" : "Texte français"` silently shows
 * French to es/de/it users because the ternary only handles two
 * languages. UI text must go through the i18n dictionaries (t("key"))
 * or xl(value, XXX_EN) for enum labels.
 *
 * This file exercises every branch:
 *   - lang-comparison ternary with a UI-text branch → reported.
 *   - the same across each lang identifier / operator variant → reported.
 *   - LOGIC ternaries (branches are codes / format tokens, no
 *     whitespace / accent) → silent.
 *   - non-lang comparison tests → silent.
 *   - allowed files (i18n dicts, AI-prompt hook, tests) → silent.
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-hardcoded-lang-ternary.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

// A production-code filename so the allow-list doesn't short-circuit.
const PROD = "/repo/src/views/curator/SomeView.tsx";

tester.run("no-hardcoded-lang-ternary", rule, {
  valid: [
    // LOGIC ternary — branches are language codes (no whitespace / accent).
    {
      code: `const x = lang === "en" ? "en" : "fr";`,
      filename: PROD,
    },
    // LOGIC ternary — format tokens.
    {
      code: `const x = lang === "en" ? "en-US" : "fr-FR";`,
      filename: PROD,
    },
    // LOGIC ternary — provider ids.
    {
      code: `const x = lang === "en" ? "dropbox" : "gdrive";`,
      filename: PROD,
    },
    // Not a lang comparison — some other identifier.
    {
      code: `const x = provider === "en" ? "Save your work" : "Autre";`,
      filename: PROD,
    },
    // Comparison to a non-string literal — not a lang-vs-code test.
    {
      code: `const x = lang === 1 ? "Save your work" : "Autre chose";`,
      filename: PROD,
    },
    // Allowed file: the i18n aggregator itself may branch text.
    {
      code: `const x = lang === "en" ? "Save your work" : "Sauvegardez votre travail";`,
      filename: "/repo/src/i18n.ts",
    },
    // Allowed file: a per-language dictionary.
    {
      code: `const x = lang === "en" ? "Save your work" : "Sauvegardez votre travail";`,
      filename: "/repo/src/i18n/en.ts",
    },
    // Allowed file: the AI-prompt hook (intentionally bilingual prompt clauses).
    {
      code: `const x = lang === "en" ? "Write in English" : "Écris en français";`,
      filename: "/repo/src/hooks/useAiAutoFill.ts",
    },
    // Allowed file: tests.
    {
      code: `const x = lang === "en" ? "Save your work" : "Sauvegardez votre travail";`,
      filename: "/repo/src/__tests__/foo.test.ts",
    },
  ],
  invalid: [
    // Classic leak: whitespace phrase in a branch.
    {
      code: `const x = lang === "en" ? "Save your work" : "Sauvegardez votre travail";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
    // Accented single word (no whitespace) still flags.
    {
      code: `const x = lang === "fr" ? "Terminé" : "Done";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
    // !== operator.
    {
      code: `const x = lang !== "fr" ? "Not French text" : "Texte";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
    // Literal on the left side of the comparison.
    {
      code: `const x = "en" === lang ? "Save your work" : "Autre chose";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
    // Alternate lang identifier (activeLang).
    {
      code: `const x = activeLang === "en" ? "Save your work" : "Autre chose";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
    // Alternate lang identifier (uiLang).
    {
      code: `const x = uiLang === "en" ? "Save your work" : "Autre chose";`,
      filename: PROD,
      errors: [{ messageId: "langText" }],
    },
  ],
});
