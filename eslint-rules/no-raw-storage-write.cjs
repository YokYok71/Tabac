// Tripwire for unguarded Web-Storage WRITES. `localStorage`
// (and `sessionStorage`) `setItem` / `removeItem` / `clear` THROW in Safari
// private mode and on quota overflow — an unguarded write crashes the whole
// surrounding flow (saving an API key, a Drive fid, a timestamp, a dismissal
// marker, …). The codebase already ships crash-safe wrappers in
// `src/utils/appStorage.ts` (`lsSet` / `lsRemove`, which try/catch and return
// a boolean), so a raw write is never necessary in ordinary code.
//
// This rule flags every direct `.setItem` / `.removeItem` / `.clear` on a
// storage object (bare `localStorage`, or `window.localStorage` /
// `w.localStorage`). The fix is `lsSet(key, value)` / `lsRemove(key)`.
//
// Deliberately NOT covered:
//   - `.getItem` — reads virtually never throw, and `lsGet` adoption is
//     optional (see the Tier-3 note in the session history). Only WRITES
//     are the crash surface.
//   - The OAuth / token / CSRF domain — `appStorage.ts` documents that
//     tokens, CSRF state and the read-before-clear flows keep their
//     dedicated guarded helpers (`tkSet` / `hint*` / `dbx*`) so the
//     companion `no-storage-read-after-remove` rule can still see their
//     literal `removeItem` calls. Those files (`appStorage.ts`,
//     `useGdriveAuth.ts`, `useDropboxAuth.ts`, `dropboxAuthCore.ts`,
//     `oauthReturn.ts`) are allowlisted OFF in eslint.config.js; the
//     handful of stray OAuth-key writes elsewhere carry an inline
//     `eslint-disable-next-line` with a rationale.
//
// Severity: "error" — matches its string-only-method / string-locale-compare
// siblings. Tests disable it per-file via the eslint.config.js override.

"use strict";

const STORAGE_OBJECTS = new Set(["localStorage", "sessionStorage"]);
const WRITE_METHODS = new Set(["setItem", "removeItem", "clear"]);

// True when `node` refers to a Web-Storage object — a bare identifier
// (`localStorage`) or a property access on any identifier
// (`window.localStorage`, `w.sessionStorage`, …). Mirrors the receiver
// detection in no-storage-read-after-remove.cjs so a `window`-arg refactor
// can't bypass either rule.
function isStorageRef(node) {
  if (!node) return false;
  if (node.type === "Identifier" && STORAGE_OBJECTS.has(node.name)) return true;
  if (
    node.type === "MemberExpression"
    && !node.computed
    && node.property
    && node.property.type === "Identifier"
    && STORAGE_OBJECTS.has(node.property.name)
  ) {
    return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag raw localStorage/sessionStorage writes (setItem/removeItem/clear) "
        + "— they throw in Safari private mode / on quota. Use lsSet/lsRemove "
        + "from src/utils/appStorage.ts instead.",
    },
    schema: [],
    messages: {
      rawWrite:
        "Raw {{obj}}.{{method}} throws in Safari private mode / on quota — "
        + "use {{fix}} from src/utils/appStorage.ts (or an inline "
        + "eslint-disable with a rationale for the OAuth/token guarded paths).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
        if (!callee.property || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        if (!WRITE_METHODS.has(method)) return;
        if (!isStorageRef(callee.object)) return;
        const objName =
          callee.object.type === "Identifier"
            ? callee.object.name
            : callee.object.property.name;
        const fix =
          method === "setItem" ? "lsSet(key, value)"
          : method === "removeItem" ? "lsRemove(key)"
          : "the appStorage helpers";
        context.report({
          node,
          messageId: "rawWrite",
          data: { obj: objName, method, fix },
        });
      },
    };
  },
};
