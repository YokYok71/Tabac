// Companion to no-hardcoded-lang-ternary — closes the
// OTHER hardcoded-UI-string shape.
//
// Flags a JSXText node (literal text sitting directly between JSX tags,
// e.g. `<span>Bonjour</span>`) whose trimmed value reads like USER-FACING
// TEXT: it contains a real word (2+ letters) AND either whitespace
// (multi-word phrase) or a Latin accented letter. Such text is a
// hardcoded label that never went through t()/xl(), so it shows the same
// string to every language.
//
// NOT flagged (correct as-is):
//   - Single symbol / icon glyphs: `×`, `—`, `✕`, `·`, `→` — no 2-letter word.
//   - `{t("key")}` / `{xl(v, MAP)}` / `{expr}` — those are
//     JSXExpressionContainer, not JSXText.
//   - Pure numbers / units / punctuation.
//
// A runtime pseudo-loc scan empirically confirmed
// zero such leaks across home / inv / pipes / acc / journal / stats /
// add-form / settings, so this rule ships at "error" as a tripwire: any
// new bare JSX phrase is a real leak.
//
// Escape hatch for a genuinely-intentional case (e.g. a language-neutral
// proper noun rendered as literal text):
//   {/* eslint-disable-next-line tabac-local/no-hardcoded-jsx-text */}
//
// Allowed files (may legitimately hold literal text): the i18n dicts,
// tests, and the rule files.

"use strict";

const ALLOWED_DIR_SUBSTRINGS = [
  "/src/i18n/",
  "/src/__tests__/",
  "/eslint-rules/",
];
const ALLOWED_FILE_SUFFIXES = ["/src/i18n.ts"];

function isAllowedFile(filename) {
  const n = String(filename || "").replace(/\\/g, "/");
  return (
    ALLOWED_FILE_SUFFIXES.some((s) => n.endsWith(s)) ||
    ALLOWED_DIR_SUBSTRINGS.some((s) => n.indexOf(s) !== -1)
  );
}

// A JSXText "looks like UI text" if it has a real word (2+ Latin letters)
// AND either whitespace (a phrase) or an accented letter (a localized word).
// Single symbols (×, —, ✕) and short codes have no 2-letter word → safe.
function looksLikeUiText(raw) {
  const t = String(raw || "").trim();
  if (!t) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return false; // no real word
  return /\s/.test(t) || /[À-ÿ]/.test(t);
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid hardcoded UI text as bare JSX children — labels must go through t(\"key\") / xl(value, XXX_EN), not a literal that shows the same string to every language.",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      jsxText:
        "Hardcoded JSX text \"{{snippet}}\" is shown identically to every language. Move it to the i18n dictionaries and render {t(\"key\")} (or {xl(value, XXX_EN)} for enum labels).",
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
      JSXText(node) {
        if (!looksLikeUiText(node.value)) return;
        const snippet = String(node.value).trim().replace(/\s+/g, " ").slice(0, 40);
        context.report({ node, messageId: "jsxText", data: { snippet } });
      },
    };
  },
};
