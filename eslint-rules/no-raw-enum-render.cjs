// Enforce the enum DISPLAY invariant (docs/checks.md § "Enum DISPLAY
// invariant") in the Curator UI.
//
// WHY. Enum values (category, cut, shape, courbure, filterType, bowlMaterial,
// stemMaterial, finish, accessory type, fuel) are STORED canonical — in French
// — and must be run through `xl(value, XXX_EN)` at every render site. A bare
// `{item.category}` looks perfectly fine in French and in English (the FR value
// often reads as English too), so the leak is INVISIBLE to anyone testing in
// those two languages — and it silently shows French to es/de/it users. That is
// exactly how the six-site leak shipped: the tobacco card + detail
// (category·cut), the Home featured tobacco and pipe, the pipe-detail shape
// header, the accessory-card fuel and every SearchModal subtitle were all
// rendering the stored value directly. The fix was written up as an invariant;
// nothing checked it.
//
// This flags a bare enum-field read used as RENDERED JSX TEXT. All the sites
// that exist today are correct, so it ships at "error": any hit is a new leak.
//
// Scope / limits (intentional):
//   - JSX CHILDREN only. An enum in an ATTRIBUTE is usually the opposite
//     requirement: `<SelectField value={form.category}>` MUST pass the
//     canonical value (translating it would break the option match and the
//     save), and `key={fam.category}` wants a stable identity, not a label.
//     So attributes are never flagged. The cost: an enum passed as a display
//     PROP (`<SpecRow value={…}>`) is out of reach — those sites go through
//     `xl()` today and a regression there is at least visible in French.
//   - A read is FINE when it is an argument of `xl(...)`, or when it sits in a
//     conditional whose test mentions `xl` — that is the ubiquitous
//     `{xl ? xl(v, CATS_EN) : v}` dev-fallback idiom, whose raw branch only
//     renders in a `t`-less test harness.
//   - GUARDS are not renders: the left operand of `&&`/`||` and the test of a
//     conditional (`{a.fuel && <span>…</span>}`) are skipped.
//   - Field names only — the rule cannot know the receiver's type. `.type` is
//     generic, but children-only scoping makes it safe in practice (the only
//     JSX-child `.type` in the Curator UI is the accessory one, already xl'd).

"use strict";

// The canonical-French enum fields. Keep in lock-step with the ENUM_TRANSLATIONS
// rows in src/constants.ts — a new translated enum field belongs here too.
const ENUM_FIELDS = new Set([
  "category",
  "cut",
  "shape",
  "courbure",
  "filterType",
  "bowlMaterial",
  "stemMaterial",
  "finish",
  "fuel",
  "type",
]);

function isEnumRead(node) {
  if (node.type !== "MemberExpression" || node.computed) return false;
  return (
    node.property &&
    node.property.type === "Identifier" &&
    ENUM_FIELDS.has(node.property.name)
  );
}

// Does this subtree mention the `xl` translator? Used for the dev-fallback
// conditional — the whole `xl ? xl(v, X_EN) : v` shape counts as handled.
function mentionsXl(node) {
  let found = false;
  (function walk(n) {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n.type === "Identifier" && n.name === "xl") {
      found = true;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "parent" || k === "loc" || k === "range") continue;
      const v = n[k];
      if (v && typeof v === "object") walk(v);
    }
  })(node);
  return found;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Curator views must render enum values through xl(value, XXX_EN) — enum values are stored canonical (French), so a bare {item.category} silently shows French in es/de/it.",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      rawEnum:
        "`.{{field}}` holds a canonical (French) enum value — render it through xl({{field}} value, XXX_EN) or it shows French to es/de/it users. See CLAUDE.md § Enum DISPLAY invariant.",
    },
  },
  create(context) {
    // Is the value at `cur` rendered as TEXT by the enclosing JSX?
    //
    // Formulated as a walk in which EVERY step must be a rendered position —
    // rather than a list of shapes to excuse. That inversion is what made the
    // rule stop misfiring: a CallExpression ARGUMENT is never rendered (the
    // call's RESULT is), which silences `xl(v, CATS_EN)`, the local alias
    // `tr(v, SHAPES_EN)` in PipesDetailView, and the colour lookups
    // `catColor(fam.category)` — three shapes an excuse-list had to enumerate
    // one by one, and did so wrongly twice. Likewise an object-literal
    // property value (`{ color: catColor(t?.category || "") }` inside a JSX
    // array) never reaches the DOM as text.
    //
    // Returns true only if the chain arrives at a JSXExpressionContainer whose
    // holder is an element/fragment (i.e. children, never an attribute).
    function rendersAsText(node) {
      let cur = node;
      let p = cur.parent;
      while (p) {
        switch (p.type) {
          case "JSXExpressionContainer": {
            const holder = p.parent;
            return (
              !!holder &&
              (holder.type === "JSXElement" || holder.type === "JSXFragment")
            );
          }
          // `${x.cut}` and `a + x.cut` both render the value.
          case "TemplateLiteral":
            break;
          case "BinaryExpression":
            if (p.operator !== "+") return false;
            break;
          case "ConditionalExpression":
            // The test is a guard, not text.
            if (p.test === cur) return false;
            // `{xl ? xl(v, X_EN) : v}` — the raw branch of the dev-fallback
            // idiom only renders in a t-less test harness, so the whole
            // conditional counts as handled.
            if (mentionsXl(p.test)) return false;
            break;
          case "LogicalExpression":
            // `&&` left is a pure guard; `||` / `??` left IS what renders when
            // truthy (`{tob.cut || "—"}` shows the raw enum).
            if (p.left === cur && p.operator === "&&") return false;
            break;
          // An array of children renders each element.
          case "ArrayExpression":
            break;
          // A callback that RETURNS the bare value renders it
          // (`{list.map(x => x.category)}`); a statement in its body doesn't.
          case "ArrowFunctionExpression":
          case "FunctionExpression":
            if (!p.body || p.body.type === "BlockStatement" || cur !== p.body) {
              return false;
            }
            break;
          case "ReturnStatement":
            if (p.argument !== cur) return false;
            break;
          // `{list.map(cb)}` renders whatever `cb` returns, so the callback we
          // just walked out of is still on the render path. Every OTHER call
          // argument is not (falls through to `default`).
          case "CallExpression":
            if (
              !p.callee ||
              p.callee.type !== "MemberExpression" ||
              p.callee.computed ||
              !p.callee.property ||
              (p.callee.property.name !== "map" &&
                p.callee.property.name !== "flatMap")
            ) {
              return false;
            }
            break;
          case "BlockStatement":
          case "ChainExpression":
          case "TSNonNullExpression":
          case "TSAsExpression":
            break;
          // Everything else — a call argument, an object property, a variable
          // initialiser, a JSX attribute — is not rendered text.
          default:
            return false;
        }
        cur = p;
        p = cur.parent;
      }
      return false;
    }

    return {
      MemberExpression(node) {
        if (!isEnumRead(node)) return;
        // Skip writes (`form.category = v`) — not a render.
        const p = node.parent;
        if (p && p.type === "AssignmentExpression" && p.left === node) return;
        if (!rendersAsText(node)) return;
        context.report({
          node,
          messageId: "rawEnum",
          data: { field: node.property.name },
        });
      },
    };
  },
};
