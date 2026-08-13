// Structural guard for the lot-SCOPE discipline in the two
// inventory views.
//
// WHY. When the user filters the tobacco list ("En pot", "En cave", "Trop
// vieux", "Achats récents"…), every figure the card and the fiche show must
// describe the lots IN THAT SCOPE — the weight, the lot count, the maturity
// chips, the oldest age, the aging banner, AND the sort order. Successive
// releases fixed that leak SEVEN times, and the final systematic sweep still found
// five more sites, two of them sort keys (invisible as text, so unreachable
// by fixing only what the user could see). The rule was then written into
// CLAUDE.md as prose — "any figure derived from a tobacco's lots goes through
// `lotInScope` / `scopedHeldWeight` / `scopedOldestAgeDays`". Prose is exactly
// what let the five leaks exist: nothing enforced it.
//
// This flags EVERY `.lots` member read in the two views. It is deliberately
// dumb: it does not try to decide whether a given read is correctly scoped —
// that judgement is what a human keeps getting wrong, and a clever rule that
// guessed would either miss the interesting cases or (worse) force correct
// code to be rewritten to please it. Instead the read must be ACKNOWLEDGED
// with a `// scope-ok: <reason>` comment, the same philosophy as the label
// contracts: the guard's job is to force a conscious re-read at the moment
// someone touches lot-derived data, not to be right on its own.
//
// The escape hatch is intentionally cheap to satisfy and impossible to add by
// accident:
//
//   // scope-ok: chip counts describe the whole cellar, not the active filter
//   const lots = tob.lots || [];
//
// Scope / limits (intentional):
//   - Registered ONLY on InventoryListView.tsx + InventoryDetailView.tsx via
//     a `files` block in eslint.config.js. Everywhere else `.lots` is either
//     already inside a scope helper (cellarInsights.ts, lotUtils.ts) or has
//     nothing to do with filtering.
//   - Property reads only. A WRITE (`tob.lots = …`) or an object literal key
//     (`{ lots: [] }`) is not a derived figure, so both are skipped.
//   - Computed access (`tob["lots"]`) is flagged too — same read, different
//     spelling.
//   - The annotation attaches to the ENCLOSING STATEMENT — the comments
//     directly above it, or a trailing comment on the read's own line. It is
//     deliberately NOT a "within N lines" window: the first version used a
//     3-line window and a probe (inject a leak into the real view, expect red)
//     showed a NEW unscoped read placed right below an annotated one silently
//     inherited its license. One statement, one acknowledgement. A contiguous
//     run of `//` lines above the statement is one annotation, so a long reason
//     needs no reflowing — the reason matters more than the token.

"use strict";

const MARKER = /scope-ok\s*:/;

// The statement the read belongs to. Comments directly above THAT node are the
// annotation, so a sibling statement can't borrow it.
function enclosingStatement(node) {
  let n = node;
  while (n.parent) {
    const pt = n.parent.type;
    if (
      pt === "Program" ||
      pt === "BlockStatement" ||
      pt === "StaticBlock" ||
      pt === "SwitchCase" ||
      pt === "ClassBody"
    ) {
      return n;
    }
    n = n.parent;
  }
  return n;
}

function isLotsProperty(node) {
  if (node.computed) {
    return (
      node.property &&
      node.property.type === "Literal" &&
      node.property.value === "lots"
    );
  }
  return (
    node.property &&
    node.property.type === "Identifier" &&
    node.property.name === "lots"
  );
}

// A read, not a write: `tob.lots = x` / `tob.lots += x` / `delete tob.lots`
// are not derived figures.
function isWriteTarget(node) {
  const p = node.parent;
  if (!p) return false;
  if (p.type === "AssignmentExpression" && p.left === node) return true;
  if (p.type === "UpdateExpression" && p.argument === node) return true;
  if (p.type === "UnaryExpression" && p.operator === "delete") return true;
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "In the inventory views, every `.lots` read must be acknowledged with a `// scope-ok: <reason>` comment — figures derived from a tobacco's lots have to honour the active filter scope (lotInScope / scopedHeldWeight / scopedOldestAgeDays).",
      category: "Best Practices",
    },
    schema: [],
    messages: {
      unscoped:
        "Unacknowledged `.lots` read. Any figure derived from a tobacco's lots must honour the active filter scope (lotInScope / scopedHeldWeight / scopedOldestAgeDays). Route it through a scope helper, then acknowledge this read with a `// scope-ok: <reason>` comment on or just above this line.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    // Any comment sitting on the read's own line (a trailing `// scope-ok: …`).
    function markedOnLine(line) {
      for (const c of sourceCode.getAllComments()) {
        if (c.loc.start.line <= line && c.loc.end.line >= line) {
          if (MARKER.test(c.value)) return true;
        }
      }
      return false;
    }

    function acknowledged(node) {
      if (markedOnLine(node.property.loc.start.line)) return true;
      const stmt = enclosingStatement(node);
      // Comments between the previous token and the statement — i.e. the block
      // directly above it. Nothing else counts.
      for (const c of sourceCode.getCommentsBefore(stmt)) {
        if (MARKER.test(c.value)) return true;
      }
      return false;
    }

    return {
      MemberExpression(node) {
        if (!isLotsProperty(node)) return;
        if (isWriteTarget(node)) return;
        if (acknowledged(node)) return;
        context.report({ node, messageId: "unscoped" });
      },
    };
  },
};
