// Tripwire for the "hex alpha concatenated onto a themed token" class.
//
// Every colour in `theme-curator.ts` used to be a literal hex,
// so appending two hex digits produced a valid 8-digit colour:
//     background: C.brass + "22"           // "#d4a66122" — a 13% brass tint
// Varizing the palette (light/dark mode + the three colour themes) turned every
// token into `var(--c-brass, #d4a661)`, and the SAME expression now yields
//     "var(--c-brass, #d4a661)22"
// which is not a colour. Browsers drop an invalid declaration SILENTLY, so the
// element renders with no background / no border and nothing errors. The
// documented replacement is `alpha(token, "22")` → `color-mix(...)`.
//
// WHY A RULE. The varization migration swept this, CLAUDE.md documents it in two
// places, and a later audit pass explicitly cleared the category — yet four live
// sites were still shipping (MaturityChip's background + sm border,
// AICard's card border + button border). Each survived because the sweeps
// grepped ONE spelling. The shapes actually in the wild were:
//     C.brass + "22"                        // plain concat
//     b.base + (b.warn ? "22" : "1c")       // concat with a ternary
//     `${C.brass}22`                        // suffix inside the quasi
//     `${C.brass}${hasKey ? "55" : "25"}`   // SPLIT across two interpolations
// The last one is invisible to a `${C.x}AA` grep, which is exactly why it lived
// longest. An AST rule sees all four as the same thing: a 2-hex-digit string in
// a position that concatenates it onto whatever precedes it.
//
// WHAT IT FLAGS. A 2-hex-digit string literal (or a ternary whose branches are
// both such literals) sitting in a concatenation slot:
//   (a) the right operand of a `+`;
//   (b) a template expression preceded by an empty quasi — i.e. glued directly
//       to the expression before it;
//   (c) a template quasi that STARTS with exactly two hex digits and follows an
//       interpolation, where those digits are not part of a longer word.
//
// It does NOT judge whether the left-hand side is a colour: a 2-hex string being
// concatenated onto something is an alpha suffix essentially by definition, and
// requiring the receiver to "look like a colour" is what let the split form slip
// through the greps. Escape hatch for a genuine non-colour case:
// `// eslint-disable-next-line tabac-local/no-hex-alpha-concat`.
//
// SCOPE. Wired to the design-system files only (the same set as the no-hex and
// no-raw-fontSize selectors) — outside them a 2-hex string next to an expression
// is far more likely to be data than a colour.

"use strict";

const HEX2 = /^[0-9a-fA-F]{2}$/;

// A 2-hex-digit string literal, or a ternary picking between two of them
// (`cond ? "22" : "1c"` — the MaturityChip / AICard shape), or a local const
// bound to either (the AgingBadge shape: `const bgAlpha = c ? "22" : "1c"`
// then `colour + bgAlpha`). The indirection matters: AgingBadge carried the
// SAME defect as MaturityChip and a literal-only version of this rule stayed
// green on it, which is the same one-spelling blindness the greps had.
function isHex2Alpha(node, resolve, seen) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "Literal" && typeof node.value === "string") {
    return HEX2.test(node.value);
  }
  if (node.type === "ConditionalExpression") {
    return (
      isHex2Alpha(node.consequent, resolve, seen) &&
      isHex2Alpha(node.alternate, resolve, seen)
    );
  }
  // `ALPHAS.warn` — a small alpha lookup table is a realistic shape, and an
  // audit confirmed the Identifier-only version sailed past it.
  if (node.type === "MemberExpression" && !node.computed && resolve) {
    const obj = node.object, prop = node.property;
    if (obj && obj.type === "Identifier" && prop && prop.type === "Identifier") {
      const init = resolve(obj);
      if (init && init.type === "ObjectExpression") {
        for (const p of init.properties || []) {
          if (
            p.type === "Property" && !p.computed && p.key &&
            (p.key.name === prop.name || String(p.key.value) === prop.name)
          ) {
            return isHex2Alpha(p.value, resolve, seen);
          }
        }
      }
    }
    return false;
  }
  if (node.type === "Identifier" && resolve) {
    // Guard against a self-referential / cyclic binding.
    const key = node.name;
    const marks = seen || new Set();
    if (marks.has(key)) return false;
    marks.add(key);
    const init = resolve(node);
    return init ? isHex2Alpha(init, resolve, marks) : false;
  }
  return false;
}

// `${x}22` / `${x}22px`? The first is an alpha suffix, the second a length.
// Require the two hex digits to be the whole quasi or be followed by something
// that can't continue a token (so `ff` in `${x}ffset` is not flagged).
const QUASI_ALPHA = /^[0-9a-fA-F]{2}(?![0-9a-zA-Z_-])/;

// The rule was once positional ONLY — it asked whether a 2-hex string
// sat in a concatenation slot and deliberately refused to judge what it was
// concatenated TO. That refusal is right about the RECEIVER (insisting it "look
// like a colour" is exactly what made the greps miss the split-interpolation
// form), but with no other constraint the rule flagged 8 of 10 plausible
// non-colour lines in an audit: `String(n) + "00"`, `n + PAD`, `` `${x}20%` ``,
// and — the one that matters — `` `M${x}10 20Z` ``, SVG path geometry. Charts.jsx
// and icons.tsx are IN scope and are nothing but path data, so the rule was one
// path-builder away from forcing correct code to be rewritten to please it. An
// over-strict guard is worse than none, because it gets correct work deleted.
//
// So constrain the CONTEXT instead of the receiver: an alpha suffix is only a
// colour bug when it lands in a colour-bearing CSS property. All five real
// sites it was written for were `background:` or `border:`; SVG geometry never is.
const COLOUR_PROPS = new Set([
  "background", "backgroundColor", "backgroundImage", "color",
  "border", "borderColor", "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "boxShadow", "textShadow", "outline", "outlineColor",
  "fill", "stroke", "caretColor", "textDecorationColor", "columnRuleColor",
]);

// ...OR the receiver is unmistakably a colour. Requiring the colour PROPERTY
// alone created real false negatives: an audit showed `const bg = C.brass +
// "22"` used a line later, and `catColor(x) + "22"` — the exact hazard
// constants.ts documents in its own comment — were both invisible, and it made
// the theme-curator.ts / constants.ts scope near-vacuous, since a palette
// module has no `background:` keys at all. My earlier refusal to judge the
// receiver was about not using it INSTEAD of position (that is what made the
// greps miss the split form); using it as an ADDITIONAL trigger costs nothing
// and closes the gap. Deliberately narrow: the `C.*` token object, the two
// colour helpers, the named palette tables, or a const resolving to one.
const COLOUR_TABLES = new Set(["C", "CAT_COLORS", "CARD_ACCENTS", "CURATOR_CHART_COLORS", "MODE_LIGHT"]);
const COLOUR_CALLS = new Set(["catColor", "alpha"]);
function isColourExpr(node, resolve, seen) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "MemberExpression" && node.object && node.object.type === "Identifier") {
    return COLOUR_TABLES.has(node.object.name);
  }
  if (node.type === "CallExpression" && node.callee && node.callee.type === "Identifier") {
    return COLOUR_CALLS.has(node.callee.name);
  }
  if (node.type === "ConditionalExpression") {
    return isColourExpr(node.consequent, resolve, seen) || isColourExpr(node.alternate, resolve, seen);
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return isColourExpr(node.left, resolve, seen);
  }
  if (node.type === "Identifier" && resolve) {
    const marks = seen || new Set();
    if (marks.has(node.name)) return false;
    marks.add(node.name);
    const init = resolve(node);
    return init ? isColourExpr(init, resolve, marks) : false;
  }
  return false;
}

// Walk up to the enclosing object Property and report whether its key is a
// colour-bearing CSS property. Stops at a function boundary so an unrelated
// outer style object can't license an inner expression.
function inColourProperty(node) {
  for (let n = node; n; n = n.parent) {
    if (
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression" ||
      n.type === "FunctionDeclaration"
    ) {
      return false;
    }
    if (n.type === "Property" && n.key && !n.computed) {
      const name = n.key.type === "Identifier" ? n.key.name
        : n.key.type === "Literal" ? String(n.key.value) : "";
      return COLOUR_PROPS.has(name);
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid concatenating a 2-hex-digit alpha suffix onto a colour — the palette tokens are var(), so `token + \"22\"` yields invalid CSS that browsers drop silently. Use alpha(token, \"22\").",
      category: "Possible Errors",
    },
    schema: [],
    messages: {
      hexAlphaConcat:
        'Hex alpha "{{alpha}}" is concatenated onto a colour. The palette tokens are var(...), so this produces invalid CSS that the browser drops silently (no background / no border, no error). Use alpha(colour, "{{alpha}}") instead.',
      hexAlphaQuasi:
        'Hex alpha "{{alpha}}" is appended to an interpolated colour. The palette tokens are var(...), so this produces invalid CSS that the browser drops silently. Use ${alpha(colour, "{{alpha}}")} instead.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    // Resolve an Identifier to the initializer of its single `const` write,
    // so `const a = c ? "22" : "1c"; colour + a` is seen for what it is.
    // Only a variable written exactly once is followed — a reassigned binding
    // is not statically an alpha suffix.
    function resolveInit(idNode) {
      let scope;
      try {
        scope = sourceCode.getScope(idNode);
      } catch {
        return null;
      }
      for (let s = scope; s; s = s.upper) {
        const v = s.variables.find((x) => x.name === idNode.name);
        if (!v) continue;
        if (v.defs.length !== 1 || v.references.filter((r) => r.isWrite()).length !== 1) {
          return null;
        }
        const def = v.defs[0];
        return def && def.node && def.node.type === "VariableDeclarator"
          ? def.node.init
          : null;
      }
      return null;
    }

    // Describe the flagged suffix in the message. For a ternary, report both
    // branches so the fix is obvious without opening the file.
    function alphaText(node) {
      if (node.type === "Literal") return String(node.value);
      if (node.type === "Identifier") return node.name;
      if (node.type === "MemberExpression" && node.property && node.property.name) {
        return (node.object && node.object.name ? node.object.name + "." : "") + node.property.name;
      }
      const c = node.consequent, a = node.alternate;
      const one = (n) => (n && n.type === "Literal" ? String(n.value) : "…");
      return one(c) + "/" + one(a);
    }

    return {
      // (a) `C.brass + "22"` and `b.base + (b.warn ? "22" : "1c")`
      BinaryExpression(node) {
        if (node.operator !== "+") return;
        if (!isHex2Alpha(node.right, resolveInit)) return;
        if (!inColourProperty(node) && !isColourExpr(node.left, resolveInit)) return;
        context.report({
          node: node.right,
          messageId: "hexAlphaConcat",
          data: { alpha: alphaText(node.right) },
        });
      },

      TemplateLiteral(node) {
        const quasis = node.quasis || [];
        const exprs = node.expressions || [];

        for (let i = 0; i < exprs.length; i++) {
          const expr = exprs[i];
          const before = quasis[i];

          // (b) `${C.brass}${hasKey ? "55" : "25"}` — the alpha is its own
          // interpolation, glued to the previous one by an empty quasi. This is
          // the shape every prior grep missed.
          if (
            isHex2Alpha(expr, resolveInit) &&
            i > 0 &&
            (inColourProperty(node) || isColourExpr(exprs[i - 1], resolveInit)) &&
            before &&
            before.value &&
            before.value.raw === ""
          ) {
            context.report({
              node: expr,
              messageId: "hexAlphaConcat",
              data: { alpha: alphaText(expr) },
            });
            continue;
          }

          // (c) `${C.brass}22` — the suffix is literal text in the next quasi.
          const after = quasis[i + 1];
          const raw = after && after.value ? after.value.raw : "";
          if (raw && QUASI_ALPHA.test(raw) &&
              (inColourProperty(node) || isColourExpr(expr, resolveInit))) {
            context.report({
              node: after,
              messageId: "hexAlphaQuasi",
              data: { alpha: raw.slice(0, 2) },
            });
          }
        }
      },
    };
  },
};
