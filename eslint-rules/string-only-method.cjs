// Companion rule to `string-locale-compare`. Flags calls to
// any method that only exists on `String.prototype` when the receiver
// isn't provably a string at the AST level. Same trap as the
// localeCompare crash, but applied to the wider family.
//
// Severity intentionally set to "warn" (not "error") in eslint.config.js
// because:
//   - We haven't observed production crashes on any of these methods
//     (yet).
//   - The receiver is very often a string-by-construction (form input
//     stored as `string` in localStorage, an i18n value, a TS-typed
//     parameter the rule can't see) — wrapping in String() would be
//     visual noise.
//   - Keeping it as a warning surfaces new sites during development
//     without blocking CI on legitimate uses.
//
// The `localeCompare` method stays in its own `error`-level rule so
// the proven crash path remains hard-blocked.
//
// Methods covered (all live ONLY on String.prototype):
//   .toUpperCase, .toLowerCase, .trim, .trimStart, .trimEnd,
//   .charAt, .charCodeAt, .codePointAt, .startsWith, .endsWith,
//   .split, .padStart, .padEnd, .replace, .replaceAll, .normalize,
//   .repeat, .search, .match, .matchAll, .substring, .substr
//
// NOT covered (exist on multiple prototypes, no immediate crash):
//   .toString, .toLocaleString (Object/Number/Date all carry their own),
//   .slice (also on Array), .includes (also on Array), .indexOf (also
//   on Array), .concat (also on Array).

"use strict";

const { isProvablyStringExpression } = require("./string-locale-compare.cjs");

const STRING_ONLY_METHOD_NAMES = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "startsWith",
  "endsWith",
  "split",
  "padStart",
  "padEnd",
  "replace",
  "replaceAll",
  "normalize",
  "repeat",
  "search",
  "match",
  "matchAll",
  "substring",
  "substr",
]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Flag string-only methods called on a value that isn't provably a string.",
    },
    schema: [],
    messages: {
      unsafe:
        "`.{{method}}()` only exists on String.prototype — wrap the receiver in `String(...)` "
        + "to be safe if a non-string value slips in. (Companion to the `.localeCompare` rule, "
        + "set at \"warn\" because production crashes here are unobserved so far.)",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const opts = { getScope: (n) => sourceCode.getScope(n) };
    return {
      CallExpression(node) {
        if (
          !node.callee
          || node.callee.type !== "MemberExpression"
          || !node.callee.property
          || node.callee.property.type !== "Identifier"
        ) {
          return;
        }
        const methodName = node.callee.property.name;
        if (!STRING_ONLY_METHOD_NAMES.has(methodName)) return;
        const receiver = node.callee.object;
        if (isProvablyStringExpression(receiver, opts)) return;
        context.report({
          node: receiver,
          messageId: "unsafe",
          data: { method: methodName },
        });
      },
    };
  },
};
