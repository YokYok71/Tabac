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
//   - Only MODULE-SCOPE `const` or `var` declarations (the lookup-table
//     pattern; `let` is exempt, being genuinely reassignable). It was `const`
//     ONLY until this project's real tables — declared `export var` throughout
//     — turned out to be invisible to it, live defect included. A local `{}`
//     accumulator indexed in a tight loop is a different animal and is not
//     flagged.
//   - Not flagged when the same statement already carries an own-property test
//     on the SAME map (`Object.prototype.hasOwnProperty.call(M, k)` or
//     `Object.hasOwn(M, k)`) — see hasOwnPropertyGuard for why that exemption
//     is not a loophole.
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
  // `const` and `var`, NOT `let`. The gate used to be `const` only, on the
  // reasoning that a reassignable binding could become anything — true of
  // `let`, and it made the rule BLIND to nearly every map in this project,
  // which declares its lookup tables as `export var` throughout (constants.ts,
  // the hooks). Measured: `npx eslint src/hooks/useAiAutoFill.ts` reported
  // ZERO on a live defect — `AI_MODEL_OPTIONS[provider]`, indexed by a value
  // read straight from storage, resolving `__proto__` to `Object.prototype`
  // and throwing on every render of App.
  //
  // `var` is kept in scope because this codebase uses it as its module-level
  // declaration form, not as a mutable one; `let` stays exempt, which is the
  // distinction the original reasoning was really about.
  const parent = def.parent || def.node.parent;
  if (parent && parent.kind && parent.kind !== "const" && parent.kind !== "var") return false;
  if (!initIsPlainObjectMap(def.node.init)) return false;
  return keyTypeForgeable(def.node);
}

/**
 * True when the read is already gated by an own-property test on the SAME map,
 * inside the same statement.
 *
 * WHY THIS EXISTS. Widening the rule from `const` to `var` made it see the
 * project's real lookup tables for the first time — and five of the seven
 * sites it then reported were ALREADY CORRECT, each carrying an inline
 * `Object.prototype.hasOwnProperty.call(MAP, k)` and a comment explaining it.
 * Reporting those would have left two bad choices: revert the widening and
 * lose the live defect it found, or bolt an `eslint-disable` onto five correct
 * sites, which teaches the next reader to silence the rule. An over-strict
 * guard gets correct work rewritten to please it — the failure this whole
 * family of rules exists to avoid.
 *
 * Deliberately TEXTUAL and scoped to the enclosing statement: the map NAME is
 * pinned, so a guard on a different map in the same statement does not count,
 * and a guard several statements away does not either (it would be a
 * different control-flow claim than this rule can verify). `Object.hasOwn` is
 * accepted as the modern spelling of the same test.
 *
 * NOT accepted: a call to a named predicate that happens to wrap the test
 * (`isLangLoaded(code)`). Following that would mean resolving an arbitrary
 * function, and the honest answer for such a map is to build it
 * null-prototype — which is what the two remaining sites did.
 */
function hasOwnPropertyGuard(node, sourceCode) {
  const name = node.object && node.object.name;
  if (!name) return false;
  let cur = node;
  while (cur && !/Statement$|Declaration$/.test(cur.type)) cur = cur.parent;
  if (!cur) return false;
  const text = sourceCode.getText(cur);
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "(?:hasOwnProperty\\s*\\.\\s*call\\s*\\(\\s*" + esc + "\\b"
    + "|Object\\s*\\.\\s*hasOwn\\s*\\(\\s*" + esc + "\\b)",
  ).test(text);
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
        if (hasOwnPropertyGuard(node, sourceCode)) return;
        context.report({ node, messageId: "unsafe", data: { name: node.object.name } });
      },
    };
  },
};
