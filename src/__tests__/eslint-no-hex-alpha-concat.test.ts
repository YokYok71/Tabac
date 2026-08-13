/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-hex-alpha-concat` defined at
 * /eslint-rules/no-hex-alpha-concat.cjs.
 *
 * The rule flags a 2-hex-digit alpha suffix concatenated onto a colour.
 * Since the palette was varized, `C.brass` is
 * `var(--c-brass, #d4a661)` — so `C.brass + "22"` yields
 * `var(--c-brass, #d4a661)22`, which is not a colour. The browser drops the
 * declaration SILENTLY (no background, no border, no console error), which is
 * why four such sites shipped and survived a migration sweep, two CLAUDE.md
 * entries and an audit pass that explicitly cleared the category.
 *
 * The four REAL shapes that were live are all pinned below as
 * invalid fixtures, because each prior sweep grepped only one of them:
 *   1. `b.base + (b.warn ? "22" : "1c")`        MaturityChip background
 *   2. `${b.base}${b.warn ? "55" : "44"}`       MaturityChip sm border  ← split
 *   3. `${C.brass}55`                           AICard card border
 *   4. `${C.brass}${hasKey ? "55" : "25"}`      AICard button border    ← split
 * The SPLIT form (2 and 4) is the one no `${C.x}AA` grep could ever see; if a
 * future simplification of the rule drops case (b), those two go green again.
 *
 * The valid fixtures guard the other direction — the rule must not fire on the
 * sanctioned `alpha(token, "22")` call, on ordinary string concatenation, or on
 * hex digits that merely begin a longer word (`${x}ffset`).
 */

import { RuleTester } from "eslint";
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-hex-alpha-concat.cjs");

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

tester.run("no-hex-alpha-concat", rule, {
  valid: [
    // The sanctioned replacement — the alpha lives inside alpha(), where it is
    // an argument, not a concatenation operand.
    `const s = { background: alpha(C.brass, "22") };`,
    `const s = { background: alpha(b.base, b.warn ? "22" : "1c") };`,
    `const s = { border: \`1px solid \${alpha(C.sage, "44")}\` };`,
    // Ordinary string work must not be touched.
    `const label = name + " · " + count;`,
    `const cls = \`\${base}-title\`;`,
    // A quasi whose first two chars are hex but continue a word: `ffset` is not
    // an alpha suffix. Without the (?![0-9a-zA-Z_-]) guard this would fire.
    "const s = `${x}ffset`;",
    "const s = `${w}px`;",
    // A 2-hex string that is NOT in a concatenation slot (data, not a colour) —
    // the codebase is full of these ("12", "25", "2d", SVG coords).
    `const weight = "50";`,
    `const ctx = canvas.getContext("2d");`,
    { code: `const x = <circle cx="12" cy="12" r="9" />;`, filename: "/repo/src/i.tsx" },
    // First interpolation of a template is not glued to a preceding expression.
    "const s = `${aa}`;",
    // Left operand of a + is not flagged — only the suffix position is.
    `const s = "22" + something;`,
    // ── the CONTEXT gate. The rule was positional only, and an
    //    audit found it flagged 8 of 10 plausible non-colour lines — including
    //    SVG path geometry, in files (Charts.jsx, icons.tsx) that are in scope
    //    and consist of little else. An over-strict guard is worse than none:
    //    it gets correct code rewritten to please it. An alpha suffix is only a
    //    colour bug inside a colour-bearing CSS property.
    "const s = { d: `M${x}10 20Z` };",
    "const s = { width: `${x}20` };",
    `const s = String(n) + "00";`,
    `const PAD = "00"; const s = n + PAD;`,
    "const s = `${x}20%`;",
    // Non-colour property AND a non-colour receiver — neither trigger fires.
    "const s = { transform: `${scale}22` };",
  ],
  invalid: [
    // ── Shape 1: plain concat with a ternary (MaturityChip background) ──
    {
      code: `const s = { background: b.base + (b.warn ? "22" : "1c") };`,
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    // ── plain concat with a bare literal ──
    {
      code: `const s = { background: C.brass + "22" };`,
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    // ── Shape 2/4: SPLIT interpolation — invisible to a `${C.x}AA` grep ──
    {
      code: "const s = { border: `1px solid ${b.base}${b.warn ? \"55\" : \"44\"}` };",
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    {
      code: "const s = { border: `1px solid ${C.brass}${hasKey ? \"55\" : \"25\"}` };",
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    // ── Shape 3: literal suffix in the quasi ──
    {
      code: "const s = { border: `1px solid ${C.brass}55` };",
      errors: [{ messageId: "hexAlphaQuasi" }],
    },
    // Suffix followed by a legal terminator (not a word char) still fires.
    {
      code: "const s = { background: `linear-gradient(90deg, ${C.brass}22, transparent)` };",
      errors: [{ messageId: "hexAlphaQuasi" }],
    },
    // Two independent violations in one template are both reported.
    {
      code: "const s = { boxShadow: `${C.brass}22 ${C.sage}44` };",
      errors: [{ messageId: "hexAlphaQuasi" }, { messageId: "hexAlphaQuasi" }],
    },
    // An alpha held in a small lookup table — the Identifier-only resolver
    // sailed past this shape.
    {
      code: `const A = { ok: "1c" }; const s = { background: C.sage + A.ok };`,
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    // ── a provably-colour RECEIVER fires on its own, whatever
    //    property it lands in. The context gate alone left these three
    //    invisible — including `catColor(x) + "22"`, the exact line
    //    constants.ts warns about in its own comment, and the reason its new
    //    lint scope was otherwise near-vacuous (a palette module has no
    //    `background:` keys to gate on).
    {
      code: `const bg = C.brass + "22";`,
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    {
      code: `const bg = catColor(tob.category) + "22";`,
      errors: [{ messageId: "hexAlphaConcat" }],
    },
    {
      code: "const s = `0 0 0 1px ${C.brass}22`;",
      errors: [{ messageId: "hexAlphaQuasi" }],
    },
    // Even in a property that is not a colour: the concat is broken regardless.
    {
      code: "const s = { transform: `${C.brass}22` };",
      errors: [{ messageId: "hexAlphaQuasi" }],
    },
  ],
});

/**
 * The rule only protects what it is WIRED to. A rule that exists but is not
 * registered — or is registered outside the design-system scope — reports
 * nothing while reading as "covered", which is the exact failure mode this
 * whole class already demonstrated. Assert the wiring from the config source.
 */
describe("no-hex-alpha-concat wiring", () => {
  const cfg = readFileSync(resolve(__dirname, "../../eslint.config.js"), "utf8");

  it("is registered as a tabac-local rule and enabled at error level", () => {
    expect(cfg).toContain('"no-hex-alpha-concat": noHexAlphaConcatRule');
    expect(cfg).toMatch(/"tabac-local\/no-hex-alpha-concat":\s*"error"/);
  });

  it("covers the Curator source AND the two modules that define the tokens", () => {
    // Asserting a source ORDER was brittle: a later change added a second
    // registration block and the ordering assertion broke on a correct change.
    // Assert the two things that actually matter instead.
    const enabled = cfg.split('"tabac-local/no-hex-alpha-concat": "error"').length - 1;
    expect(enabled, "must be enabled in both blocks").toBe(2);
    // theme-curator.ts and constants.ts DEFINE the var()-based palette, and
    // constants.ts even documents this hazard — yet both were out of reach
    // (one sits in the design-system block's `ignores`, the
    // other outside its glob entirely).
    expect(cfg).toMatch(/files:\s*\["src\/theme-curator\.ts",\s*"src\/constants\.ts"\]/);
    expect(cfg).toContain("No hardcoded hex colours in the Curator UI");
  });
});
