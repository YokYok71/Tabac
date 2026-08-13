// Custom lint rule — a MODULE-LEVEL lookup table built as a plain
// object literal (`const M: Record<string, X> = { … }`) must NOT be indexed by
// a DYNAMIC (non-literal) key. `M[userKey]` on a plain object resolves a key
// equal to a prototype member ("__proto__", "constructor", "toString", …) to
// the value on Object.prototype — a truthy non-X — which then defeats the
// ubiquitous `M[key] || fallback` guard (successive audit rounds kept surfacing one more of
// these: resolveCanonicalBrand, computeAgingSweetSpot maps, AccListView
// TYPE_COLORS/TYPE_ICONS, toggleCollapseKey…).
//
// The fix is a null-prototype map — `Object.assign(Object.create(null), { … })`
// — so a forged key has no prototype chain to fall through to. This rule flags
// the unsafe shape at lint time so the class stops recurring.
//
// SCOPE (deliberately narrow to keep false positives ~0):
//   - Only MODULE-SCOPE `const` declarations (the lookup-table pattern). A
//     local `{}` accumulator indexed in a tight loop is a different animal and
//     is not flagged.
//   - Only when the initializer is a BARE ObjectExpression. The safe forms —
//     `Object.create(null)`, `Object.assign(Object.create(null), {…})`,
//     `new Map(…)` — are recognised and skipped.
//   - Only computed access `M[expr]` where `expr` is NOT a string/number
//     literal. `M["known"]` / `M[0]` are static and safe.
//   - WRITE targets are skipped (`M[k] = v` builds the map; the read is what's
//     dangerous). Actually a plain-object WRITE of `__proto__` is its own trap,
//     but the maps this guards are const literals never written to, so we scope
//     to reads to avoid noise.
//
// Escape hatch: `// eslint-disable-next-line tabac-local/no-dynamic-index-plain-map`
// for a map whose keys are provably a closed safe set (rare).

"use strict";

// Walk the scope chain for a variable by name.
function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    if (s.set && s.set.has(name)) return s.set.get(name);
  }
  return null;
}

// A declarator initializer is a SAFE (null-proto or non-plain) map when it is:
//   Object.create(null)
//   Object.assign(Object.create(null), …)   (any 1st arg that is create(null))
//   new Map(…) / new WeakMap(…)
// Anything else that is a bare ObjectExpression is UNSAFE (a plain prototype).
function initIsPlainObjectMap(init) {
  if (!init) return false;
  if (init.type === "ObjectExpression") return true;
  // Object.assign(Object.create(null), {...}) → safe (first arg null-proto).
  if (
    init.type === "CallExpression"
    && init.callee
    && init.callee.type === "MemberExpression"
    && init.callee.object
    && init.callee.object.type === "Identifier"
    && init.callee.object.name === "Object"
    && init.callee.property
    && init.callee.property.type === "Identifier"
    && init.callee.property.name === "assign"
  ) {
    const first = init.arguments && init.arguments[0];
    if (isObjectCreateNull(first)) return false; // safe
    // Object.assign({}, …) — first arg a plain object → still unsafe.
    if (first && first.type === "ObjectExpression") return true;
    return false; // Object.assign(someVar, …) — unknown, don't flag
  }
  return false;
}

function isObjectCreateNull(node) {
  return !!node
    && node.type === "CallExpression"
    && node.callee
    && node.callee.type === "MemberExpression"
    && node.callee.object
    && node.callee.object.type === "Identifier"
    && node.callee.object.name === "Object"
    && node.callee.property
    && node.callee.property.type === "Identifier"
    && node.callee.property.name === "create"
    && node.arguments
    && node.arguments.length === 1
    && node.arguments[0]
    && node.arguments[0].type === "Literal"
    && node.arguments[0].value === null;
}

// Is the KEY type of the declared map FORGEABLE by a runtime string — i.e.
// `Record<string, …>`, `Record<any, …>`, an index-signature `{ [k: string]:
// … }`, or no annotation at all? A closed-union key (`Record<AgingBadgeSize,
// …>`, `Record<IcoName, …>`) can only be indexed by a value TypeScript already
// proves is in-set, so it's NOT prototype-forgeable — and wrapping it in
// Object.create(null) would also drop the literal's exhaustiveness check. We
// skip those; we flag the string-keyed / untyped maps, which is the real risk.
function keyTypeForgeable(defNode) {
  const id = defNode.id;
  const ann = id && id.typeAnnotation && id.typeAnnotation.typeAnnotation;
  if (!ann) return true; // untyped → keys are effectively arbitrary strings
  if (
    ann.type === "TSTypeReference"
    && ann.typeName
    && ann.typeName.type === "Identifier"
    && ann.typeName.name === "Record"
  ) {
    // typescript-eslint exposes the generic args as `typeArguments` (newer) or
    // `typeParameters` (older).
    const args = ann.typeArguments || ann.typeParameters;
    const k = args && args.params && args.params[0];
    if (!k) return true;
    return k.type === "TSStringKeyword" || k.type === "TSAnyKeyword" || k.type === "TSUnknownKeyword";
  }
  if (ann.type === "TSTypeLiteral") {
    // A `{ [k: string]: V }` index-signature literal is string-keyed.
    return (ann.members || []).some((m) =>
      m.type === "TSIndexSignature"
      && m.parameters && m.parameters[0]
      && m.parameters[0].typeAnnotation
      && m.parameters[0].typeAnnotation.typeAnnotation
      && m.parameters[0].typeAnnotation.typeAnnotation.type === "TSStringKeyword");
  }
  // Unknown annotation shape → be conservative and flag (null-proto is always
  // safe; a genuine false positive can carry an inline eslint-disable).
  return true;
}

// Is the variable a MODULE-SCOPE const whose single initializer is a bare
// plain-object literal map AND whose key type is runtime-forgeable?
function isModuleConstPlainMap(node, opts) {
  const scope = opts.getScope(node);
  if (!scope) return false;
  const variable = findVariable(scope, node.name);
  if (!variable || variable.defs.length !== 1) return false;
  const def = variable.defs[0];
  if (def.type !== "Variable" || !def.node || def.node.type !== "VariableDeclarator") return false;
  // Must be module-scope (the top-level lookup-table pattern).
  if (!def.node.range) return false;
  const declScope = variable.scope;
  if (!declScope || (declScope.type !== "module" && declScope.type !== "global")) return false;
  // const only (a reassignable let could become anything).
  const parent = def.parent || def.node.parent;
  if (parent && parent.kind && parent.kind !== "const") return false;
  if (!initIsPlainObjectMap(def.node.init)) return false;
  return keyTypeForgeable(def.node);
}

function isLiteralKey(prop) {
  if (!prop) return false;
  if (prop.type === "Literal") return true; // "str" or 0
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
// This was `module.exports.rule = {…}` + an `Object.assign` shim
// copied from string-locale-compare.cjs — which needs it for its own history
// (the rule used to be that file's default export). This rule was born
// with no such history, and nothing ever read `.rule`, so the
// indirection only cost knip the ability to see the export as used.
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A module-level plain-object lookup map must not be indexed by a dynamic key "
        + "(a forged prototype-member key resolves to Object.prototype). Build it with "
        + "Object.assign(Object.create(null), {…}).",
    },
    schema: [],
    messages: {
      unsafe:
        "Dynamic index into the plain-object map `{{name}}` — a forged key equal to a "
        + "prototype member (\"__proto__\", \"constructor\"…) resolves to Object.prototype "
        + "and defeats the `|| fallback` guard. Declare it as "
        + "`Object.assign(Object.create(null), {…})`.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const opts = { getScope: (n) => sourceCode.getScope(n) };
    return {
      MemberExpression(node) {
        if (!node.computed) return;
        if (isLiteralKey(node.property)) return;      // static key → safe
        if (node.object.type !== "Identifier") return; // only NAME[expr]
        // Skip the WRITE target of an assignment (map construction).
        const p = node.parent;
        if (p && p.type === "AssignmentExpression" && p.left === node) return;
        // Skip `delete M[k]` (removal, not a fall-through read).
        if (p && p.type === "UnaryExpression" && p.operator === "delete") return;
        if (!isModuleConstPlainMap(node.object, opts)) return;
        context.report({ node, messageId: "unsafe", data: { name: node.object.name } });
      },
    };
  },
};
