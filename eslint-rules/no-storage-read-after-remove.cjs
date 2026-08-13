// Tripwire for the OAuth read-after-clear bug
// pattern. Flags `localStorage.removeItem("X")` followed within the
// same function scope by `localStorage.getItem("X")` of the same
// key — a read after the key has been wiped will always return null,
// which is almost certainly a bug (that regression silently
// dropped every fresh Drive token for 8 releases because of exactly
// this pattern).
//
// Scope: function-local. Block boundaries (if / try / for) do NOT
// reset the tracking — a removeItem in the function preamble
// followed by a getItem in a later conditional branch is still the
// bug. Function boundaries DO reset (nested functions have their
// own logic).
//
// What's deliberately NOT flagged:
//   - getItem THEN removeItem (the safe pattern — capture, then
//     clean up).
//   - getItem THEN removeItem THEN getItem (the safe-then-bug
//     pattern is caught by the second getItem because tracking
//     records the removeItem in between).
//   - Both ops on dynamic / computed keys: we only track literal
//     string arguments. A `localStorage.removeItem(k)` followed
//     by `localStorage.getItem(k)` (variable k) could be either
//     branch but we can't tell — silent.
//   - sessionStorage: identical risk but the codebase's only
//     usage is the tkSet/tkGet/tkClear helper. Out of scope for
//     now; can be extended if a future module starts touching
//     sessionStorage directly.
//
// Severity: "error" — this exact bug shipped for 8 builds and
// took a critical fix to recover from. The pattern is never
// intentional in production code; tests can disable it per-file
// via the eslint.config.js override.

"use strict";

const STORAGE_OBJECTS = new Set(["localStorage"]);

/**
 * Returns true if `node` is a reference to localStorage, either as
 * a bare identifier (`localStorage`) or as a property access on
 * any identifier (`window.localStorage`, `w.localStorage`, etc.).
 * The latter form is used by `src/utils/oauthReturn.ts` for
 * testability — without this branch, a refactor that re-introduced
 * the read-after-clear bug inside a function taking `window` as an arg
 * would bypass the rule. Caught by an audit.
 */
function isLocalStorageRef(node) {
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

/**
 * Extract the literal-string key from a localStorage.XXX("K", ...)
 * call (also accepts `<ident>.localStorage.XXX("K", ...)`). Returns
 * null if the receiver isn't a recognised localStorage reference,
 * the method isn't the requested one, the key isn't a Literal
 * string, or any precondition fails.
 */
function extractStorageKey(node, method) {
  if (!node || node.type !== "CallExpression") return null;
  const callee = node.callee;
  if (!callee || callee.type !== "MemberExpression") return null;
  if (callee.computed) return null;
  if (!isLocalStorageRef(callee.object)) return null;
  if (!callee.property || callee.property.type !== "Identifier") return null;
  if (callee.property.name !== method) return null;
  const arg = node.arguments && node.arguments[0];
  if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") return null;
  return arg.value;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag a localStorage.removeItem(K) followed within the same function "
        + "by localStorage.getItem(K) of the same literal key — that read "
        + "always returns null because the key was just wiped.",
    },
    schema: [],
    messages: {
      readAfterRemove:
        "localStorage.getItem(\"{{key}}\") happens AFTER a removeItem(\"{{key}}\") "
        + "earlier in this function — the read will always return null. "
        + "Either capture the value BEFORE the removeItem (the read-before-clear "
        + "pattern in src/utils/oauthReturn.ts), or move the removeItem after "
        + "every read of the same key. See CLAUDE.md \"OAuth read-before-clear\" "
        + "invariant for the regression that motivated this rule.",
    },
  },
  create(context) {
    // Scope tracking is per-BlockStatement (with a
    // function-root frame as fallback), and on block exit we DO NOT
    // propagate the block's removeItems to the parent if the block
    // ended with a `return` or `throw`. That handles the mutually-
    // exclusive-branch pattern in src/utils/oauthReturn.ts (PKCE
    // branch removes gdrive-pending then returns, implicit-grant
    // branch reads gdrive-pending later — they never co-execute).
    //
    // Data structure: `scopeStack[topOfOuter]` is the current
    // function's frame stack. Each frame is `{ removed: Map<key,
    // node> }`. Function entry pushes a fresh stack with one root
    // frame; function exit pops the whole stack. BlockStatement
    // entry pushes a frame; exit either merges into parent (normal
    // fall-through) or discards (block ends with return/throw).
    const scopeStack = [];

    function pushFunction() {
      scopeStack.push([{ removed: new Map() }]);
    }
    function popFunction() {
      scopeStack.pop();
    }
    function currentFunctionFrames() {
      return scopeStack[scopeStack.length - 1] || null;
    }
    function pushBlock() {
      const fn = currentFunctionFrames();
      if (fn) fn.push({ removed: new Map() });
    }
    function popBlock(endsUnconditionally) {
      const fn = currentFunctionFrames();
      if (!fn || fn.length === 0) return;
      const frame = fn.pop();
      if (endsUnconditionally) return; // discard — code outside this block doesn't see these removes
      if (fn.length === 0) return; // nothing to merge into
      const parent = fn[fn.length - 1];
      for (const [k, n] of frame.removed) {
        if (!parent.removed.has(k)) parent.removed.set(k, n);
      }
    }
    function isRemoved(key) {
      const fn = currentFunctionFrames();
      if (!fn) return false;
      for (let i = fn.length - 1; i >= 0; i--) {
        if (fn[i].removed.has(key)) return true;
      }
      return false;
    }
    function recordRemove(key, node) {
      const fn = currentFunctionFrames();
      if (!fn || fn.length === 0) return;
      const top = fn[fn.length - 1];
      if (!top.removed.has(key)) top.removed.set(key, node);
    }

    return {
      // Program is the top-level scope (module-level code outside
      // any function). Treated like a function for tracking
      // purposes — bare top-level remove/get sequences still flag.
      Program: pushFunction,
      "Program:exit": popFunction,
      ":function": pushFunction,
      ":function:exit": popFunction,
      BlockStatement: pushBlock,
      "BlockStatement:exit"(node) {
        const lastStmt = node.body && node.body[node.body.length - 1];
        const endsUnconditionally = !!(
          lastStmt
          && (lastStmt.type === "ReturnStatement" || lastStmt.type === "ThrowStatement")
        );
        popBlock(endsUnconditionally);
      },

      CallExpression(node) {
        const readKey = extractStorageKey(node, "getItem");
        if (readKey !== null) {
          if (isRemoved(readKey)) {
            context.report({
              node,
              messageId: "readAfterRemove",
              data: { key: readKey },
            });
          }
          return;
        }
        const removedKey = extractStorageKey(node, "removeItem");
        if (removedKey !== null) {
          recordRemove(removedKey, node);
        }
      },
    };
  },
};
