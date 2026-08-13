/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-storage-read-after-remove` defined at
 * /eslint-rules/no-storage-read-after-remove.cjs.
 *
 * The rule is a static tripwire for the OAuth
 * bug pattern: localStorage.removeItem("X") followed within the
 * same function by localStorage.getItem("X"), which silently
 * returns null and broke the OAuth dispatcher for 8 releases.
 *
 * This file exercises every branch:
 *   - The bug pattern in flat code → reported.
 *   - The bug pattern across if / try / for branches in one
 *     function → reported.
 *   - The safe pattern (getItem THEN removeItem) → silent.
 *   - Different keys → silent.
 *   - Same pattern across function boundaries → silent (each
 *     function has its own logic).
 *   - Non-literal keys (variables, template literals with subs) →
 *     silent (can't track dynamic keys).
 *   - Bracket notation `localStorage["x"]` → out of scope (only
 *     `.removeItem` / `.getItem` calls are tracked).
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-storage-read-after-remove.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

tester.run("no-storage-read-after-remove", rule, {
  valid: [
    // Safe: read THEN remove (the fix pattern).
    {
      code: `
        function f() {
          var v = localStorage.getItem("X");
          localStorage.removeItem("X");
          return v;
        }
      `,
    },
    // Safe: different keys.
    {
      code: `
        function f() {
          localStorage.removeItem("A");
          var v = localStorage.getItem("B");
          return v;
        }
      `,
    },
    // Safe: function boundary resets tracking.
    {
      code: `
        function outer() {
          localStorage.removeItem("X");
        }
        function inner() {
          return localStorage.getItem("X");
        }
      `,
    },
    // Safe: nested function inside the outer scope.
    {
      code: `
        function outer() {
          localStorage.removeItem("X");
          return function () {
            // Different function — its own logic. Not flagged.
            return localStorage.getItem("X");
          };
        }
      `,
    },
    // Safe: non-literal key on removeItem (we can't track dynamic).
    {
      code: `
        function f(k) {
          localStorage.removeItem(k);
          return localStorage.getItem("X");
        }
      `,
    },
    // Safe: non-literal key on getItem.
    {
      code: `
        function f(k) {
          localStorage.removeItem("X");
          return localStorage.getItem(k);
        }
      `,
    },
    // Safe: bracket notation isn't tracked (out of scope).
    {
      code: `
        function f() {
          localStorage["X"] = null;
          return localStorage.getItem("X");
        }
      `,
    },
    // Safe: only removeItem, no read.
    {
      code: `
        function f() {
          localStorage.removeItem("X");
          localStorage.removeItem("Y");
        }
      `,
    },
    // Safe: sessionStorage isn't tracked (out of scope per header).
    {
      code: `
        function f() {
          sessionStorage.removeItem("X");
          return sessionStorage.getItem("X");
        }
      `,
    },
    // Safe: top-level (Program scope) read before any removeItem.
    {
      code: `
        var v = localStorage.getItem("X");
        localStorage.removeItem("X");
      `,
    },
    // An earlier release invariant: a removeItem inside a block that ends
    // with a `return` does NOT leak to the surrounding scope. The
    // exact pattern in src/utils/oauthReturn.ts where the PKCE
    // branch removes \`gdrive-pending\` then returns, and the
    // implicit-grant branch (unreached when PKCE returned) reads
    // the same key further down.
    {
      code: `
        function processOAuthReturn(w) {
          if (hasCode) {
            w.localStorage.removeItem("gdrive-pending");
            return;
          }
          // Implicit-grant branch — reached only when PKCE didn't
          // return. The removeItem above is dead for this path.
          var pa = w.localStorage.getItem("gdrive-pending");
          return pa;
        }
      `,
    },
    // Same with throw instead of return.
    {
      code: `
        function f() {
          if (cond) {
            localStorage.removeItem("X");
            throw new Error("bail");
          }
          return localStorage.getItem("X");
        }
      `,
    },
    // Nested blocks: outer if's body ends with return → inner
    // removeItem is also discarded.
    {
      code: `
        function f() {
          if (outerCond) {
            if (innerCond) {
              localStorage.removeItem("X");
            }
            return;
          }
          return localStorage.getItem("X");
        }
      `,
    },
  ],

  invalid: [
    // Bug pattern in flat code — the exact shape.
    {
      code: `
        function f() {
          localStorage.removeItem("gdrive-pending");
          var pa = localStorage.getItem("gdrive-pending");
          return pa;
        }
      `,
      errors: [
        { messageId: "readAfterRemove", data: { key: "gdrive-pending" } },
      ],
    },
    // Bug pattern across a try/catch — same function scope.
    {
      code: `
        function f() {
          try { localStorage.removeItem("X"); } catch (e) {}
          return localStorage.getItem("X");
        }
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
    // Bug pattern across an if — same function scope.
    {
      code: `
        function f(cond) {
          if (cond) {
            localStorage.removeItem("X");
          }
          return localStorage.getItem("X");
        }
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
    // Bug pattern at Program top level.
    {
      code: `
        localStorage.removeItem("X");
        var v = localStorage.getItem("X");
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
    // Bug pattern with multiple keys — both flagged.
    {
      code: `
        function f() {
          localStorage.removeItem("A");
          localStorage.removeItem("B");
          var a = localStorage.getItem("A");
          var b = localStorage.getItem("B");
          return a + b;
        }
      `,
      errors: [
        { messageId: "readAfterRemove", data: { key: "A" } },
        { messageId: "readAfterRemove", data: { key: "B" } },
      ],
    },
    // An earlier release extension: the receiver may be a property access
    // (window.localStorage / w.localStorage / etc.) — same bug,
    // same flag. Without this branch, oauthReturn.ts (uses
    // \`w.localStorage\` for testability) could regress without
    // tripping the rule.
    {
      code: `
        function processOAuthReturn(w) {
          w.localStorage.removeItem("gdrive-pending");
          var pa = w.localStorage.getItem("gdrive-pending");
          return pa;
        }
      `,
      errors: [
        { messageId: "readAfterRemove", data: { key: "gdrive-pending" } },
      ],
    },
    // window.localStorage is the most common alias.
    {
      code: `
        function f() {
          window.localStorage.removeItem("X");
          return window.localStorage.getItem("X");
        }
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
    // Mixed: removeItem via member, getItem via bare identifier —
    // still the same storage, still the same key, still the bug.
    {
      code: `
        function f(w) {
          w.localStorage.removeItem("X");
          return localStorage.getItem("X");
        }
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
    // IIFE (the App.tsx OAuth handler shape earlier).
    {
      code: `
        (function () {
          localStorage.removeItem("gdrive-pending");
          var pa = localStorage.getItem("gdrive-pending");
          return pa;
        })();
      `,
      errors: [
        { messageId: "readAfterRemove", data: { key: "gdrive-pending" } },
      ],
    },
    // Arrow function — same scope rules.
    {
      code: `
        const f = () => {
          localStorage.removeItem("X");
          return localStorage.getItem("X");
        };
      `,
      errors: [{ messageId: "readAfterRemove", data: { key: "X" } }],
    },
  ],
});
