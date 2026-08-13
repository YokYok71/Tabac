// Custom lint rule — prevents the "hardcoded UI language"
// leak class from regressing.
//
// Flags a conditional expression whose TEST compares a language variable
// (`lang`, `activeLang`, `l`, `lng`, `uiLang`) to a string code, AND whose
// consequent/alternate is a string literal that reads like USER-FACING TEXT
// (contains whitespace, or a Latin accented letter). This is exactly the
// pattern the big i18n sweep removed — `lang === "en" ? "English text" :
// "Texte français"` — which silently shows French to es/de/it users because
// the ternary only handles two languages. Such strings belong in the i18n
// dictionaries (`t("key")`); enum labels belong in `xl(value, XXX_EN)`.
//
// LOGIC ternaries are intentionally NOT flagged — their branches are language
// CODES or format tokens with no whitespace/accent: `lang === "en" ? "en" :
// "fr"`, `"en-US"` vs `"fr-FR"`, `"dropbox"` vs `"gdrive"`. Those are correct.
//
// Set at "error": the codebase is clean, so any hit is a real new leak.
// Escape hatch for a genuinely-intentional case:
//   // eslint-disable-next-line tabac-local/no-hardcoded-lang-ternary
//
// Allowed files (may legitimately branch text on language):
//   - src/i18n.ts, src/i18n/*.ts      (the dictionaries themselves)
//   - src/hooks/useAiAutoFill.ts       (builds AI PROMPT text per language —
//                                       not UI, intentionally bilingual clauses)
//   - src/__tests__/**, eslint-rules/  (fixtures / the rule itself)

"use strict";

const ALLOWED_FILE_SUFFIXES = [
  "/src/i18n.ts",
  "/src/hooks/useAiAutoFill.ts",
];
const ALLOWED_DIR_SUBSTRINGS = [
  "/src/i18n/",
  "/src/__tests__/",
  "/eslint-rules/",
];

const LANG_IDENTIFIERS = new Set(["lang", "activeLang", "l", "lng", "uiLang"]);

function isAllowedFile(filename) {
  const n = String(filename || "").replace(/\\/g, "/");
  return (
    ALLOWED_FILE_SUFFIXES.some((s) => n.endsWith(s)) ||
    ALLOWED_DIR_SUBSTRINGS.some((s) => n.indexOf(s) !== -1)
  );
}

// A string literal "looks like UI text" if it contains whitespace (multi-word
// phrase) or a Latin accented letter (French/es/de/it word). Language codes
// and format tokens ("en", "fr", "en-US", "dropbox") have neither.
function looksLikeUiText(v) {
  return typeof v === "string" && (/\s/.test(v) || /[À-ÿ]/.test(v));
}

// The test is a lang-vs-code comparison, e.g. `lang === "en"`, `activeLang !== "fr"`.
function isLangComparison(test) {
  if (!test || test.type !== "BinaryExpression") return false;
  if (test.operator !== "===" && test.operator !== "!==" && test.operator !== "==" && test.operator !== "!=") return false;
  const { left, right } = test;
  const idSide = left && left.type === "Identifier" ? left : right && right.type === "Identifier" ? right : null;
  const litSide = left && left.type === "Literal" ? left : right && right.type === "Literal" ? right : null;
  return !!(idSide && litSide && LANG_IDENTIFIERS.has(idSide.name) && typeof litSide.value === "string");
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid inline `lang === \"…\" ? \"text\" : \"text\"` ternaries — UI text must go through t()/xl(), not a two-language ternary that leaks French to es/de/it.",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      langText:
        "Language-branched UI string \"{{snippet}}\" leaks: a `{{id}} === …` ternary only handles two languages, so es/de/it fall back to the wrong one. Move it to the i18n dictionaries and use t(\"key\") (or xl(value, XXX_EN) for enum labels).",
    },
  },
  create(context) {
    const filename =
      typeof context.filename === "string"
        ? context.filename
        : typeof context.getFilename === "function"
          ? context.getFilename()
          : "";
    if (isAllowedFile(filename)) return {};

    return {
      ConditionalExpression(node) {
        if (!isLangComparison(node.test)) return;
        const branches = [node.consequent, node.alternate];
        for (const b of branches) {
          if (b && b.type === "Literal" && looksLikeUiText(b.value)) {
            const idSide =
              node.test.left.type === "Identifier" ? node.test.left.name : node.test.right.name;
            const snippet = String(b.value).slice(0, 40).replace(/\n/g, " ");
            context.report({ node: b, messageId: "langText", data: { snippet, id: idSide } });
            return; // one report per ternary is enough
          }
        }
      },
    };
  },
};
