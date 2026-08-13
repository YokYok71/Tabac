// Companion to `string-only-method` for the Number family.
// `.toFixed()`, `.toPrecision()` and `.toExponential()` live ONLY on
// Number.prototype — calling one on a value that is a string / undefined
// / null at runtime throws `TypeError: x.toFixed is not a function`. The
// codebase stores many numeric-looking values as STRINGS (lot weights,
// prices, form fields), so a `field.toFixed(2)` on unvalidated data is a
// latent crash. The fix is `Number(field).toFixed(2)`.
//
// This flags any `.toFixed` / `.toPrecision` / `.toExponential` whose
// receiver isn't provably a number at the AST level. Deliberately NOT
// covering `.toLocaleString` — it also exists on Date / Array / Object, so
// flagging it would false-positive on non-number receivers.
//
// Safe receivers we DON'T flag (isProvablyNumberExpression):
//   - numeric literals (`42..toFixed()`), `Number(x)`, `parseInt/parseFloat`,
//     `Math.*(…)`, `Date.now()`
//   - arithmetic that ALWAYS yields a number: `a - b`, `a * b`, `a / b`,
//     `a % b`, `a ** b` (NOT `a + b` — `+` can concatenate strings)
//   - unary `-x` / `+x` / `~x`, `++x` / `x--`
//   - `.length` access (`arr.length.toFixed()`)
//   - `x as number` / `<number>x` TS assertions
//   - `A || B`, `A ?? B`, `c ? A : B` when BOTH branches are provably number
//
// Escape hatch for a genuinely-safe-but-unprovable receiver: wrap in
// `Number(x)`, or a scoped `// eslint-disable-next-line
// tabac-local/number-only-method`.
//
// Severity: "error" — matches its string-only-method sibling.

"use strict";

const NUMBER_ONLY_METHOD_NAMES = new Set([
  "toFixed",
  "toPrecision",
  "toExponential",
]);

// Binary operators that ALWAYS produce a number (even on non-numeric
// operands the result is NaN, still typeof "number"). `+` is excluded — it
// concatenates when either side is a string.
const NUMERIC_BINARY_OPS = new Set(["-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"]);
const NUMERIC_UNARY_OPS = new Set(["-", "+", "~"]);

function isNumberCallee(callee) {
  if (!callee) return false;
  // parseInt(...) / parseFloat(...)
  if (callee.type === "Identifier") return callee.name === "parseInt" || callee.name === "parseFloat";
  if (callee.type === "MemberExpression" && !callee.computed && callee.property && callee.property.type === "Identifier") {
    const obj = callee.object;
    const prop = callee.property.name;
    // Math.<anything>(...)
    if (obj && obj.type === "Identifier" && obj.name === "Math") return true;
    // Number.parseInt / Number.parseFloat
    if (obj && obj.type === "Identifier" && obj.name === "Number"
        && (prop === "parseInt" || prop === "parseFloat")) return true;
    // Date.now()
    if (obj && obj.type === "Identifier" && obj.name === "Date" && prop === "now") return true;
  }
  return false;
}

function isNumberTypeAnnotation(ta) {
  return !!ta && ta.type === "TSNumberKeyword";
}

function isProvablyNumberExpression(node, seen) {
  if (!node) return false;
  if (!seen) seen = new Set();
  if (seen.has(node)) return false;
  seen.add(node);

  switch (node.type) {
    case "Literal":
      return typeof node.value === "number";
    case "UnaryExpression":
      return NUMERIC_UNARY_OPS.has(node.operator);
    case "UpdateExpression":
      return true; // ++ / -- always yield a number
    case "BinaryExpression":
      return NUMERIC_BINARY_OPS.has(node.operator);
    case "CallExpression":
      // Number(x) explicit coercion, or a known number-returning builtin.
      if (node.callee && node.callee.type === "Identifier" && node.callee.name === "Number") return true;
      return isNumberCallee(node.callee);
    case "MemberExpression":
      // `.length` is always a number.
      return !node.computed && node.property && node.property.type === "Identifier" && node.property.name === "length";
    case "LogicalExpression":
      // `A || B`, `A ?? B`, `A && B`: number only if BOTH branches are.
      return isProvablyNumberExpression(node.left, seen) && isProvablyNumberExpression(node.right, seen);
    case "ConditionalExpression":
      return isProvablyNumberExpression(node.consequent, seen) && isProvablyNumberExpression(node.alternate, seen);
    case "TSAsExpression":
    case "TSTypeAssertion":
      // `x as number` / `<number>x`. Also transparent to the inner expr:
      // a `(a / b) as number` is number via the arithmetic anyway.
      return isNumberTypeAnnotation(node.typeAnnotation) || isProvablyNumberExpression(node.expression, seen);
    case "TSNonNullExpression":
    case "ChainExpression":
      return isProvablyNumberExpression(node.expression, seen);
    default:
      return false;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag .toFixed / .toPrecision / .toExponential on a receiver that isn't "
        + "provably a number — it throws on a string/undefined value. Wrap the "
        + "receiver in Number(...).",
    },
    schema: [],
    messages: {
      unsafe:
        "`.{{method}}()` only exists on Number.prototype — wrap the receiver in "
        + "Number(...) so a string/undefined value can't crash the call.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
        if (!callee.property || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        if (!NUMBER_ONLY_METHOD_NAMES.has(method)) return;
        const receiver = callee.object;
        if (isProvablyNumberExpression(receiver)) return;
        context.report({ node: receiver, messageId: "unsafe", data: { method } });
      },
    };
  },
};

module.exports.isProvablyNumberExpression = isProvablyNumberExpression;
