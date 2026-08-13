// Custom lint rule — automates the iOS/Android parity
// invariant (CLAUDE.md #20) at the AST level.
//
// Flags any string literal (or template element) that reads like a
// settings breadcrumb meant for the user: "Réglages → …",
// "Paramètres → …", "Settings → …". These belong in `src/i18n.ts`
// (translated UI text) or in `getStorageBlockedHint` (platform-
// specific system-settings paths) — never inline in a view, a
// modal, an error message handler, etc. Inline strings drift out
// of parity on every refactor; centralising them is the only way
// to keep iOS and Android user-facing text symmetric.
//
// Why a rule instead of just discipline: the iOS/Android parity
// audit found three live cases (AICard, WelcomeModal, App.tsx
// storage hint) where the breadcrumb form had been written inline
// despite the existing i18n infrastructure. Without a lint check,
// the next contributor in a hurry will do the same. Set at
// "warn" rather than "error" so the legitimate sites flagged
// during transition can be unblocked individually without a
// blanket eslint-disable per file.
//
// Allowed locations:
//   - src/i18n.ts                      (the i18n source-of-truth)
//   - src/utils.ts                     (getStorageBlockedHint helper)
//   - any file under src/__tests__/    (test fixtures may need these)
//
// Pattern matched: case-insensitive, the words "Réglages",
// "Paramètres", or "Settings" followed (within a few chars) by an
// arrow "→". Examples that fire:
//   "Settings → AI"
//   "Réglages → Safari → Avancé"
//   `Paramètres → IA — ${kind}`
// Examples that DON'T fire:
//   "Settings"             (single word, the button label)
//   "open the Settings panel"  (no arrow)
//   "→"                    (no preceding keyword)
//
// Escape hatch: a site that's intentionally inline (e.g. a comment
// quoting the i18n key) can be silenced with
// `// eslint-disable-next-line tabac-local/no-platform-breadcrumb-out-of-i18n`.

"use strict";

// Files allowed to contain the breadcrumb pattern. Path is normalised
// to forward slashes before matching. Matches at the END of the file
// path (so the rule works whether ESLint feeds in an absolute path or
// a project-relative path).
const ALLOWED_FILE_SUFFIXES = [
  "/src/i18n.ts",
  "/src/utils.ts",
];

const ALLOWED_DIR_SUBSTRINGS = [
  "/src/i18n/",   // the per-language dictionaries (src/i18n/fr.ts, en.ts)
  "/src/__tests__/",
  "/eslint-rules/",
];

// Covers all FIVE UI languages. It knew French and English
// only — verified by probe: "Ajustes → IA", "Einstellungen → KI" and
// "Impostazioni → IA" all MISSED. A guard that reads as comprehensive while
// knowing two of five languages is the shape this repo keeps rediscovering
// (the .jsx config gap, the scripts/ gap, the six hardcoded language lists
// LANG_ASSETS replaced), so the fix is the same: cover the set, and say which set.
const BREADCRUMB_RE =
  /(R[ée]glages|Param[èe]tres|Settings|Ajustes|Configuraci[oó]n|Einstellungen|Impostazioni|Defini[cç][oõ]es|Configura[cç][oõ]es)\s*[→>]/i;

// The `t ? t("key") : "French fallback"` idiom is NOT an inline
// copy, even though it is an inline literal. doc:check gate (b.2) requires that
// fallback to be byte-identical to the `fr` dictionary value and fails CI if it
// drifts — so the very thing this rule exists to prevent is already prevented,
// by a stronger guard, for exactly this shape. Firing here left two permanent
// warnings (AICard, TermsGate) that could not be fixed without either breaking
// gate (b.2) or removing a breadcrumb the French copy legitimately needs; one of
// them had accreted a comment claiming the fallback "drops the breadcrumb",
// which was simply false. A permanently-unfixable warning trains people to
// ignore the rule, so narrow the rule rather than keep the noise.
function isTranslationFallback(node) {
  const parent = node.parent;
  if (!parent || parent.type !== "ConditionalExpression") return false;
  if (parent.alternate !== node) return false;
  const c = parent.consequent;
  // `t ? t("key") : "…"` — the consequent must be EXACTLY the shape doc:check
  // gate (b.2) pins: the identifier `t`, called with a single string literal.
  // This exemption was NARROWED. It previously also exempted `xl(...)` and
  // non-literal / multi-argument calls, but gate (b.2) matches only
  // /\bt\(\s*"KEY"\s*\)\s*:\s*"…"/ — so those shapes were exempted on the
  // strength of a guarantee that does not cover them. An audit confirmed both:
  // `xl ? xl(v,M) : "Réglages → …"` drew no lint warning AND no gate finding.
  // An exemption must not claim more than the guard it defers to.
  return !!(
    c &&
    c.type === "CallExpression" &&
    c.callee &&
    c.callee.type === "Identifier" &&
    c.callee.name === "t" &&
    c.arguments.length === 1 &&
    c.arguments[0] &&
    c.arguments[0].type === "Literal" &&
    typeof c.arguments[0].value === "string"
  );
}

function isAllowedFile(filename) {
  const normalised = String(filename || "").replace(/\\/g, "/");
  if (ALLOWED_FILE_SUFFIXES.some((suffix) => normalised.endsWith(suffix))) {
    return true;
  }
  if (ALLOWED_DIR_SUBSTRINGS.some((sub) => normalised.indexOf(sub) !== -1)) {
    return true;
  }
  return false;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forbid 'Settings/Réglages/Paramètres → X' breadcrumbs outside i18n.ts and the storage-hint helper.",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      breadcrumb:
        "Settings-breadcrumb string \"{{snippet}}\" should live in src/i18n.ts (or in getStorageBlockedHint for platform-system paths). Inline copies drift out of iOS/Android parity on every refactor — see CLAUDE.md invariant #20.",
    },
  },
  create(context) {
    // ESLint 9+ exposes the path as `context.filename`. Older versions
    // had `context.getFilename()` — keep a fallback so the rule is
    // resilient to an ESLint downgrade or a different test harness.
    const filename =
      typeof context.filename === "string"
        ? context.filename
        : typeof context.getFilename === "function"
          ? context.getFilename()
          : "";
    if (isAllowedFile(filename)) {
      return {};
    }

    function checkString(node, value) {
      if (typeof value !== "string") return;
      // The `typeof` guard above proves this is a string; the string-only-method
      // rule's recognizer cannot see a type guard, so it flags .match() here.
      // eslint-disable-next-line tabac-local/string-only-method
      const m = value.match(BREADCRUMB_RE);
      if (!m) return;
      // Snippet around the match for the message (≤ 60 chars).
      const start = Math.max(0, m.index - 8);
      const end = Math.min(value.length, m.index + m[0].length + 24);
      const snippet = value.slice(start, end).replace(/\n/g, " ");
      context.report({
        node,
        messageId: "breadcrumb",
        data: { snippet },
      });
    }

    return {
      Literal(node) {
        if (isTranslationFallback(node)) return;
        checkString(node, node.value);
      },
      TemplateElement(node) {
        // node.value.cooked is the un-escaped string content of a
        // template-literal chunk (the parts between ${...}).
        checkString(node, node.value && node.value.cooked);
      },
    };
  },
};
