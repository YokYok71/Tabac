/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-unscoped-lot-read` defined at
 * /eslint-rules/no-unscoped-lot-read.cjs.
 *
 * The rule flags every `.lots` READ in the two inventory views unless it is
 * acknowledged by a `// scope-ok: <reason>` comment. It exists because the
 * "figure describes lots the user filtered OUT" bug was fixed seven times
 * And the systematic sweep still found five more sites — the
 * discipline was prose in CLAUDE.md with nothing enforcing it.
 *
 * These cases lock the FAILURE behaviour above all: a guard that quietly stops
 * firing is worse than no guard, because the code then reads as verified.
 *
 * Branches covered:
 *   - bare `.lots` read → reported (the whole point).
 *   - `// scope-ok:` on the line above / on the same line → silent.
 *   - marker heading a CONTIGUOUS multi-line reason → silent (the annotation is
 *     the block, so a long reason needs no reflowing).
 *   - a plain comment with no marker → still reported.
 *   - a read on the statement RIGHT AFTER an annotated one → still reported.
 *     This is not hypothetical: the rule's first version matched the marker
 *     within a 3-line window, and probing it (inject a leak into the real view,
 *     expect red) showed the injected read silently inheriting the license of
 *     the annotated statement above it. One statement, one acknowledgement.
 *   - a marker further up the file → still reported.
 *   - computed `tob["lots"]` → reported (same read, different spelling).
 *   - WRITE targets (`tob.lots = …`, `delete tob.lots`) → silent.
 *   - an object literal `{ lots: [] }` and an unrelated `.lots`-less member →
 *     silent.
 */

import { RuleTester } from "eslint";
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-unscoped-lot-read.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const VIEW = "/repo/src/views/curator/InventoryListView.tsx";

tester.run("no-unscoped-lot-read", rule, {
  valid: [
    // Marker on the line directly above.
    {
      code: [
        "// scope-ok: chip counts describe the whole cellar",
        "const lots = tob.lots || [];",
      ].join("\n"),
      filename: VIEW,
    },
    // Marker trailing on the same line.
    {
      code: `const lots = tob.lots || []; // scope-ok: the scope route itself`,
      filename: VIEW,
    },
    // Marker heading a contiguous multi-line reason — the run counts as one
    // annotation, so the reason can be as long as it needs to be.
    {
      code: [
        "// scope-ok: unscoped on purpose — its only consumer is gated on",
        "// !wScope, so there is no scope to honour at that point, and a",
        "// finished lot is never in scope anyway.",
        "// (extra line of reasoning, still part of the same block)",
        "const n = (tob.lots || []).length;",
      ].join("\n"),
      filename: VIEW,
    },
    // Writes are not derived figures.
    { code: `tob.lots = [];`, filename: VIEW },
    { code: `delete tob.lots;`, filename: VIEW },
    // An object literal KEY named lots is not a read.
    { code: `const t = { name: "x", lots: [] };`, filename: VIEW },
    // Unrelated member reads are untouched.
    { code: `const w = tob.weightG; const s = data.sessions;`, filename: VIEW },
  ],
  invalid: [
    // The bare read — the case the five leaks were made of.
    {
      code: `const total = (tob.lots || []).reduce((a, l) => a + l.weightG, 0);`,
      filename: VIEW,
      errors: [{ messageId: "unscoped" }],
    },
    // A comment WITHOUT the marker must not license the read: the annotation
    // has to be a deliberate act, not any nearby prose.
    {
      code: [
        "// sum every lot's weight for the card",
        "const total = tob.lots.length;",
      ].join("\n"),
      filename: VIEW,
      errors: [{ messageId: "unscoped" }],
    },
    // THE case the probe found: the very next statement must not inherit the
    // annotation. A leak lands exactly here — right beside code that already
    // reads `.lots` for a legitimate reason.
    {
      code: [
        "// scope-ok: licenses the statement below and nothing else",
        "const a = tob.lots.length;",
        "const leak = (tob.lots || []).length;",
      ].join("\n"),
      filename: VIEW,
      errors: [{ messageId: "unscoped", line: 3 }],
    },
    // A marker further up the file does not carry over either.
    {
      code: [
        "// scope-ok: licenses the read below, not the one further down",
        "const a = tob.lots;",
        "",
        "const x = 1;",
        "const b = tob.lots;",
      ].join("\n"),
      filename: VIEW,
      errors: [{ messageId: "unscoped", line: 5 }],
    },
    // Same read, computed spelling.
    {
      code: `const n = tob["lots"].length;`,
      filename: VIEW,
      errors: [{ messageId: "unscoped" }],
    },
    // Two unacknowledged reads → two reports (no dedup by line/file).
    {
      code: `const a = tob.lots.length + other.lots.length;`,
      filename: VIEW,
      errors: [{ messageId: "unscoped" }, { messageId: "unscoped" }],
    },
  ],
});

// The rule is worthless if the views it guards drift out of its `files` scope,
// or if someone "fixes" a red build by blanket-disabling it. Assert the wiring.
describe("no-unscoped-lot-read is actually wired to the two views", () => {
  const config = readFileSync("eslint.config.js", "utf8");

  it("registers the rule at error level for both inventory views", () => {
    expect(config).toContain("no-unscoped-lot-read");
    expect(config).toContain('"src/views/curator/InventoryListView.tsx"');
    expect(config).toContain('"src/views/curator/InventoryDetailView.tsx"');
    expect(config).toContain('"tabac-local/no-unscoped-lot-read": "error"');
  });

  it("no file blanket-disables it", () => {
    // A scoped `// eslint-disable-next-line` on one read would be a legitimate
    // (if worse) alternative to `scope-ok:`; disabling the rule for a whole
    // file would silently retire the guard.
    for (const f of [
      "src/views/curator/InventoryListView.tsx",
      "src/views/curator/InventoryDetailView.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("eslint-disable tabac-local/no-unscoped-lot-read");
    }
  });
});
