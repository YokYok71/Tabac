/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-platform-breadcrumb-out-of-i18n` defined at
 * /eslint-rules/no-platform-breadcrumb-out-of-i18n.cjs.
 *
 * This was the ONLY custom rule shipping without a self-test —
 * 11 tests for 12 rules. That gap matters more than it looks: a lint rule that
 * silently stops matching reports nothing, which is indistinguishable from a
 * clean codebase. Every other guard in this repo is probed to failure; this one
 * was taken on faith.
 *
 * The rule automates CLAUDE.md invariant #20 (iOS/Android parity): a
 * "Settings → X" / "Réglages → X" / "Paramètres → X" breadcrumb must live in
 * the i18n dictionaries (translated, and symmetric across platforms), never
 * inline in a view or an error handler where it drifts on the next refactor.
 *
 * Exercises every branch of the implementation:
 *   - the three keyword spellings, with and without accents;
 *   - both arrow forms ("→" and ">");
 *   - the TemplateElement path (a breadcrumb inside a template literal);
 *   - each allow-listed location (i18n.ts, the per-language dicts, utils.ts,
 *     __tests__/, eslint-rules/) — an over-broad allow-list would silence the
 *     rule everywhere, so the negative direction is asserted too;
 *   - the near-misses that must stay silent (bare "Settings", a lone arrow,
 *     prose with no arrow).
 */

import { RuleTester } from "eslint";
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-platform-breadcrumb-out-of-i18n.cjs");

(RuleTester as any).describe = describe;
(RuleTester as any).it = it;
(RuleTester as any).itOnly = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const PROD = "/repo/src/views/curator/SomeView.tsx";

tester.run("no-platform-breadcrumb-out-of-i18n", rule, {
  valid: [
    // ── Near-misses: the keyword alone is a button label, not a breadcrumb.
    { code: `const a = "Settings";`, filename: PROD },
    { code: `const a = "Open the Settings panel to add a key";`, filename: PROD },
    { code: `const a = "→";`, filename: PROD },
    { code: `const a = "Réglages";`, filename: PROD },

    // ── Allow-listed locations. If any of these started reporting, the rule
    //    would fire on the dictionaries themselves and be disabled wholesale.
    { code: `const a = "Paramètres → IA";`, filename: "/repo/src/i18n.ts" },
    { code: `const a = "Paramètres → IA";`, filename: "/repo/src/i18n/fr.ts" },
    { code: `const a = "Settings → AI";`, filename: "/repo/src/i18n/en.ts" },
    // utils.ts hosts getStorageBlockedHint, which legitimately names the
    // per-platform system-settings path.
    { code: `const a = "Réglages → Safari → Avancé";`, filename: "/repo/src/utils.ts" },
    { code: `const a = "Settings → AI";`, filename: "/repo/src/__tests__/x.test.ts" },
    { code: `const a = "Settings → AI";`, filename: "/repo/eslint-rules/some-rule.cjs" },
    // Windows-style separators must normalise, or the allow-list silently
    // stops applying on one platform and the dictionaries go red.
    { code: `const a = "Paramètres → IA";`, filename: "C:\\repo\\src\\i18n\\fr.ts" },

    // ── the `t ? t("key"): "fr fallback"` idiom. doc:check
    //    gate (b.2) pins that literal byte-identical to the fr value, so it
    //    cannot drift — the premise of this rule does not apply. Before the
    //    narrowing these were two permanent warnings plus two hand-written
    //    eslint-disable comments, one of which had grown a claim ("the
    //    fallback drops the breadcrumb") that the string itself contradicted.
    { code: `const a = t ? t("ai_no_key_hint") : "Ajoute une clé API dans Paramètres → IA";`, filename: PROD },

  ],
  invalid: [
    // ── The three keyword spellings, inline in a view.
    {
      code: `const a = "Settings → AI";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      code: `const a = "Paramètres → IA";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      code: `const a = "Réglages → Safari → Avancé";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // Unaccented spellings — a contributor typing without accents must not
    // slip past (the regex carries [ée] / [èe] for exactly this).
    {
      code: `const a = "Reglages → Safari";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      code: `const a = "Parametres → IA";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // ASCII ">" arrow.
    {
      code: `const a = "Settings > AI";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // Case-insensitive.
    {
      code: `const a = "settings → ai";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // ── The narrowing must stay SURGICAL. A rule that quietly stops
    //    firing is the worst outcome here, so pin the near-misses that must
    //    still report: the fallback exemption keys on the CONSEQUENT being a
    //    t()/xl() call, not merely on "a literal in a ternary".
    {
      // A plain ternary — not a translation fallback. Still an inline copy.
      code: `const a = isIos ? "Réglages → Safari" : "Settings → Chrome";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }, { messageId: "breadcrumb" }],
    },
    {
      // The literal is the CONSEQUENT, so it is not the fallback branch.
      code: `const a = t ? "Settings → AI" : t("k");`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      // Consequent is some other call, not a translation lookup.
      code: `const a = cond ? fmt("k") : "Settings → AI";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // These three were exempted on a guarantee that does not
    // cover them. doc:check gate (b.2) pins ONLY `t("LITERAL")`, so an `xl`
    // call, a variable key and a multi-argument call are all unprotected — an
    // audit confirmed neither the lint rule nor the gate said anything.
    {
      code: `const a = xl ? xl(v, M) : "Réglages → Safari";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      code: `const a = t ? t(varKey) : "Paramètres → IA";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    {
      code: `const a = t ? t("k", v) : "Settings → AI";`,
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
    // ── The TemplateElement path: the breadcrumb is a template chunk, not a
    //    Literal, so it needs its own visitor. Dropping it would leave every
    //    interpolated message unguarded.
    {
      code: "const a = `Paramètres → IA — ${kind}`;",
      filename: PROD,
      errors: [{ messageId: "breadcrumb" }],
    },
  ],
});

describe("no-platform-breadcrumb-out-of-i18n wiring", () => {
  it("reports the offending snippet so the message is actionable", () => {
    // A message that only says "a breadcrumb exists somewhere" costs a hunt.
    expect(rule.meta.messages.breadcrumb).toContain("{{snippet}}");
    expect(rule.meta.messages.breadcrumb).toContain("i18n");
  });
});

/**
 * The rule knew two of the five UI languages.
 *
 * It exists to stop platform breadcrumbs ("Settings → AI") being written inline
 * instead of in the dictionaries, which is invariant #20. Its pattern listed
 * French and English only, so the Spanish, German and Italian spellings passed
 * straight through — and those are precisely the languages whose copy is most
 * likely to be written by someone reaching for an inline literal.
 *
 * Same shape as the .jsx config gap, the scripts/ gap and
 * The six hardcoded language lists: a guard that reads as
 * comprehensive while covering a subset. Asserted per language so a future
 * shortening of the alternation fails here rather than going quiet.
 */
describe("no-platform-breadcrumb-out-of-i18n — every UI language", () => {
  const { readFileSync } = require("node:fs");
  const { resolve } = require("node:path");
  const src = readFileSync(
    resolve(__dirname, "../../eslint-rules/no-platform-breadcrumb-out-of-i18n.cjs"), "utf8");
  const m = /const BREADCRUMB_RE =\s*([^;]+);/.exec(src);
  const re: RegExp = eval(m![1]!);

  it.each([
    ["fr", "Réglages → IA"],
    ["fr", "Paramètres > IA"],
    ["en", "Settings → AI"],
    ["es", "Ajustes → IA"],
    ["es", "Configuración → IA"],
    ["de", "Einstellungen → KI"],
    ["it", "Impostazioni → IA"],
    ["pt", "Definições → IA"],
  ])("matches the %s breadcrumb", (_lang, s) => {
    expect(re.test(s)).toBe(true);
  });

  it("does not fire on ordinary prose", () => {
    for (const s of ["random text", "the settings are saved", "Einstellungen sind gespeichert"]) {
      expect(re.test(s), `${s} should not match`).toBe(false);
    }
  });

  it("covers every language in the registry, so a sixth is not silently unguarded", () => {
    // Not an assertion that the pattern is perfect — an assertion that adding a
    // language and forgetting this rule is visible. The word list is per
    // language and cannot be derived, so the check is that each shipped code
    // has SOME spelling covered.
    const { LANGUAGES } = require("../i18n/languages.ts");
    const SAMPLE: Record<string, string> = Object.assign(Object.create(null), {
      fr: "Réglages → X", en: "Settings → X", es: "Ajustes → X",
      de: "Einstellungen → X", it: "Impostazioni → X", pt: "Definições → X",
    });
    for (const l of LANGUAGES) {
      const probe = SAMPLE[l.code];
      expect(probe, `no breadcrumb sample for "${l.code}" — add one when you add a language`).toBeTruthy();
      expect(re.test(probe!), `${l.code} breadcrumb not covered by the rule`).toBe(true);
    }
  });
});
