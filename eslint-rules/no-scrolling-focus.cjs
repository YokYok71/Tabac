// `element.focus()` MUST pass `{ preventScroll: true }`.
//
// Focus moves the viewport by default. In this app none of the focus moves is
// a navigation the user asked for — opening a dialog, restoring focus to the
// trigger on close, trapping Tab inside a panel, arrow-keying between five
// stars or between filter chips. In a long list (the catalogue is 1222 rows
// and ~75 000 px) a focus that scrolls loses the reader's place outright,
// which is exactly what was reported: "je ne me retrouve pas au même endroit
// dans la liste catalogue".
//
// WHY A RULE AND NOT DISCIPLINE. The defect is invisible in this repo's own
// test engine. jsdom does not lay out or scroll at all, and CHROMIUM does not
// reproduce it either: there a tap focuses a `div[tabindex=0]`, so restoring
// focus lands back on the row, and `document.body.focus()` is a no-op. iOS
// Safari does neither — it does not focus non-form elements on tap, so the
// recorded "last active" element is <body>. So a bare `.focus()` can be added,
// measured green in every harness available here, and still lose the user's
// place on the only platform that matters for it.
//
// Scope / limits (intentional):
//   - Flags a CallExpression whose callee is a MemberExpression ending in
//     `.focus` — the DOM shape. A bare `focus()` identifier call is ignored.
//   - Flags no arguments, or an object argument without `preventScroll: true`.
//     A spread or a variable argument is accepted: the rule cannot see inside
//     it, and guessing would produce the false positives that get guards
//     switched off.
//   - Escape hatch for a site that genuinely wants the scroll:
//     `// eslint-disable-next-line tabac-local/no-scrolling-focus -- reason`.
//     None exists today; the one site that DOES want scrolling
//     (InventoryListView's chip row) asks for it explicitly with
//     `scrollIntoView`, which is clearer than relying on focus's side effect.

"use strict";

function hasPreventScroll(arg) {
  if (!arg) return false;
  // A variable / spread / call — unreadable here, so accept it rather than
  // guess. See the scope note above.
  if (arg.type !== "ObjectExpression") return true;
  return arg.properties.some(function (p) {
    if (p.type === "SpreadElement") return true;   // same reasoning
    var key = p.key && (p.key.name || p.key.value);
    if (key !== "preventScroll") return false;
    // `preventScroll: false` is an explicit request to scroll — that is what
    // the disable comment is for, so it is still flagged.
    return !(p.value && p.value.type === "Literal" && p.value.value === false);
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require { preventScroll: true } on .focus() so moving focus never moves the viewport",
    },
    schema: [],
    messages: {
      bare:
        "focus() scrolls the page by default. Pass { preventScroll: true } — moving focus is not a navigation the user asked for. If this site genuinely wants to scroll, say so with scrollIntoView() or disable this rule with a reason.",
    },
  },
  create: function (context) {
    return {
      CallExpression: function (node) {
        var callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        var prop = callee.property;
        if (!prop) return;
        var name = callee.computed
          ? (prop.type === "Literal" ? prop.value : null)
          : prop.name;
        if (name !== "focus") return;
        if (node.arguments.length > 0 && hasPreventScroll(node.arguments[0])) return;
        context.report({ node: node, messageId: "bare" });
      },
    };
  },
};
