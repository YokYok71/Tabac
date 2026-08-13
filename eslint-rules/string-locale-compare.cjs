// Custom lint rule —
// `.localeCompare()` must be called on a value that's provably a string
// at the AST level. The runtime crash that motivated it happened because
// `(lot.boxNumber || "").localeCompare(...)` returns the bare number
// when `lot.boxNumber` is `0` or any other truthy non-string primitive
// — and `.localeCompare` only lives on the String prototype.
//
// A sweep wrapped every known call site in `String(...)`. This rule
// stops the regression from ever coming back: any new `.localeCompare`
// without a provably-string receiver is flagged at lint time.
//
// Safe receiver patterns (we don't flag these):
//   - `String(x)`  — explicit coercion (the canonical fix)
//   - String literals: `"foo".localeCompare(y)`
//   - Template literals: `` `${a} ${b}`.localeCompare(y) ``
//   - Chained string-returning methods on a known-string-y root:
//     `x.toLowerCase()`, `x.toUpperCase()`, `x.trim()`, `x.toString()`,
//     `x.slice(...)`, `x.substring(...)`, `x.substr(...)`,
//     `x.replace(...)`, `x.replaceAll(...)`, `x.padStart(...)`,
//     `x.padEnd(...)`, `x.normalize(...)`, `x.concat(...)`,
//     `x.repeat(...)`. We recognise these via property name only —
//     we don't trace the receiver type, so a hypothetical method of
//     the same name on another prototype would also be accepted.
//   - `x + y` style string concatenations are NOT recognised (the `+`
//     operator can do number addition too) — wrap explicitly.
//
// Escape hatch: any site that is genuinely safe but not recognised
// (e.g. `Object.keys(...)` results, `Array.from(Set<string>)`) can be
// silenced with `// eslint-disable-next-line tabac-local/string-locale-compare`.
//
// Companion rule (`tabac-local/string-only-method`, set at "warn")
// flags the broader family — `.toUpperCase`, `.trim`, `.replace`, etc.
// — that share the same trap with less direct evidence (fewer
// production crashes observed so far).

"use strict";

const STRING_METHOD_NAMES = new Set([
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "toString",
  "slice",
  "substring",
  "substr",
  "replace",
  "replaceAll",
  "padStart",
  "padEnd",
  "normalize",
  "concat",
  "repeat",
  "localeCompare", // returns number, but harmless to treat chained calls as safe
]);

// Walk the scope chain for a variable by name.
function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    if (s.set && s.set.has(name)) return s.set.get(name);
  }
  return null;
}

// Is `node` an identifier bound to a single-assignment local
// whose initializer is itself provably a string? Handles the common
// `var normalized = s.replace(...); normalized.match(...)` /
// `const b = String(x); b.trim()` false positives the pure-AST check
// couldn't see. SOUND for the error-level localeCompare rule:
//   - exactly one definition, and it's a `var`/`let`/`const` declarator
//     with an initializer (params / imports / functions are rejected);
//   - exactly one WRITE reference (the initializer) — any reassignment
//     makes the type unprovable, so we bail;
//   - the use appears AFTER the declarator ends (guards `var` hoisting /
//     use-before-init, where the receiver would be `undefined`);
//   - the initializer is provably a string (recursively, with a `seen`
//     guard against mutually-referential bindings).
function isSingleAssignedStringVar(node, opts, seen) {
  const scope = opts.getScope(node);
  if (!scope) return false;
  const variable = findVariable(scope, node.name);
  if (!variable || seen.has(variable)) return false;
  if (variable.defs.length !== 1) return false;
  const def = variable.defs[0];
  if (def.type !== "Variable" || !def.node || def.node.type !== "VariableDeclarator") return false;
  const init = def.node.init;
  if (!init) return false;
  const writes = variable.references.filter((r) => r.isWrite());
  if (writes.length !== 1) return false; // reassigned somewhere → unprovable
  if (node.range && def.node.range && node.range[0] < def.node.range[1]) return false; // use-before-init
  seen.add(variable);
  return isProvablyStringExpression(init, opts, seen);
}

// `opts` (optional) = { getScope(node) => Scope } — when supplied, bare
// identifiers are traced through their single-assignment binding (see
// isSingleAssignedStringVar). Called WITHOUT opts (the legacy signature)
// the identifier branch is skipped, i.e. the pure syntactic behaviour.
function isProvablyStringExpression(node, opts, seen) {
  if (!node) return false;
  if (!seen) seen = new Set();

  if (node.type === "Literal" && typeof node.value === "string") return true;
  if (node.type === "TemplateLiteral") return true;
  if (
    node.type === "CallExpression"
    && node.callee
    && node.callee.type === "Identifier"
    && node.callee.name === "String"
  ) {
    return true;
  }
  if (
    node.type === "CallExpression"
    && node.callee
    && node.callee.type === "MemberExpression"
    && node.callee.property
    && node.callee.property.type === "Identifier"
    && STRING_METHOD_NAMES.has(node.callee.property.name)
  ) {
    return true;
  }
  if (node.type === "LogicalExpression") {
    return isProvablyStringExpression(node.left, opts, seen)
        && isProvablyStringExpression(node.right, opts, seen);
  }
  // `cond ? "a" : b.trim()` — safe when BOTH branches are provably string.
  if (node.type === "ConditionalExpression") {
    return isProvablyStringExpression(node.consequent, opts, seen)
        && isProvablyStringExpression(node.alternate, opts, seen);
  }
  if (node.type === "Identifier" && opts && typeof opts.getScope === "function") {
    return isSingleAssignedStringVar(node, opts, seen);
  }
  return false;
}

// Exported for reuse by the companion string-only-method rule.
module.exports.isProvablyStringExpression = isProvablyStringExpression;
module.exports.STRING_METHOD_NAMES = STRING_METHOD_NAMES;

/** @type {import('eslint').Rule.RuleModule} */
module.exports.rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require a provably-string receiver before `.localeCompare()`.",
    },
    schema: [],
    messages: {
      unsafe:
        "`.localeCompare()` must be called on a provably-string value (wrap in `String(...)`). "
        + "Otherwise a numeric or boolean value slipping in crashes at runtime with "
        + "\"localeCompare is not a function\" — the regression this rule exists for.",
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
          || node.callee.property.name !== "localeCompare"
        ) {
          return;
        }
        const receiver = node.callee.object;
        if (isProvablyStringExpression(receiver, opts)) return;
        context.report({ node: receiver, messageId: "unsafe" });
      },
    };
  },
};

// Backward-compat: the rule used to be the default export. Keep it so
// the eslint.config.js wiring (and the RuleTester self-test) doesn't
// have to track the shape change.
Object.assign(module.exports, module.exports.rule);
