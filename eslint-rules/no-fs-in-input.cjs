// Preventive tripwire for the iOS zoom-on-focus regression class.
//
// iOS Safari auto-zooms the page when a text field with a font-size below
// 16px receives focus. The design system routes every font size through
// `fs(px)` = `calc(px * var(--cave-font-scale,1))`, which — with the "S"
// text-size preference (factor 0.9) — can render a 14px field at 12.6px,
// tripping the zoom. The dedicated `fsInput(px)` = `max(16px, calc(...))`
// clamps to the 16px floor, so EVERY `<input>` / `<textarea>` MUST size its
// font via `fsInput()`, never `fs()`.
//
// This rule flags a `fontSize: fs(...)` property inside the inline `style`
// object literal of a JSX `<input>` or `<textarea>`. Several such misses
// were caught by hand in an audit; this locks the class shut so
// a future field can't silently reintroduce the zoom.
//
// Scope / limits (intentional):
//   - Only INLINE object literals on the element are inspected. A field that
//     spreads a shared style const (e.g. `style={baseInput}`) is out of
//     reach — but those shared consts (FormFields.tsx `baseInput`) already
//     use `fsInput`, and a regression there would surface in every field.
//   - Only `fontSize` is checked (the only property that triggers the zoom).
//   - `fsInput(...)` is fine; any other value is fine; only a bare `fs(...)`
//     call anywhere inside the fontSize value is flagged.

"use strict";

// True if `node` is (or contains) a CallExpression whose callee is the bare
// identifier `fs`. Handles the direct call and the conditional
// `cond ? fs(14) : fs(12)` shape.
function containsFsCall(node) {
  if (!node || typeof node !== "object") return false;
  if (
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    node.callee.name === "fs"
  ) {
    return true;
  }
  if (node.type === "ConditionalExpression") {
    return (
      containsFsCall(node.consequent) ||
      containsFsCall(node.alternate)
    );
  }
  if (node.type === "LogicalExpression") {
    return containsFsCall(node.left) || containsFsCall(node.right);
  }
  return false;
}

function elementName(opening) {
  const n = opening && opening.name;
  return n && n.type === "JSXIdentifier" ? n.name : "";
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid fontSize: fs(...) on a JSX <input>/<textarea> — text fields must size via fsInput() so the value can't fall below the 16px iOS zoom-on-focus floor.",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      fsInInput:
        "<{{tag}}> font-size uses fs() — use fsInput() instead so it can't drop below 16px (iOS zooms on focus otherwise).",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tag = elementName(node);
        if (tag !== "input" && tag !== "textarea") return;

        for (const attr of node.attributes || []) {
          if (
            !attr ||
            attr.type !== "JSXAttribute" ||
            !attr.name ||
            attr.name.name !== "style"
          ) {
            continue;
          }
          const val = attr.value;
          if (
            !val ||
            val.type !== "JSXExpressionContainer" ||
            !val.expression ||
            val.expression.type !== "ObjectExpression"
          ) {
            continue;
          }
          for (const prop of val.expression.properties || []) {
            if (
              !prop ||
              prop.type !== "Property" ||
              prop.computed ||
              !prop.key
            ) {
              continue;
            }
            const keyName =
              prop.key.type === "Identifier"
                ? prop.key.name
                : prop.key.type === "Literal"
                  ? prop.key.value
                  : "";
            if (keyName !== "fontSize") continue;
            if (containsFsCall(prop.value)) {
              context.report({
                node: prop,
                messageId: "fsInInput",
                data: { tag },
              });
            }
          }
        }
      },
    };
  },
};
