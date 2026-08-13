/**
 * Self-test for the custom ESLint rule
 * `tabac-local/no-raw-enum-render` defined at
 * /eslint-rules/no-raw-enum-render.cjs.
 *
 * The rule enforces the enum DISPLAY invariant: enum values (category, cut,
 * shape, …) are STORED canonical — in French — so every render site must go
 * through `xl(value, XXX_EN)`. A bare `{item.category}` looks correct in fr
 * AND in en (the French value often reads as English too), so the leak is
 * invisible to anyone testing in those two languages while showing French to
 * es/de/it users. Six such sites shipped at once.
 *
 * Two groups of cases matter equally here:
 *
 * 1. It CATCHES the historical shape. Reinstating the real leak in
 *     AccListView (`<Lbl>{a.fuel}</Lbl>`) was probed against the rule before
 *     it shipped, and is reproduced below as a fixture.
 *
 *  2. It does NOT catch the three shapes that must stay legal — because a
 *     rule that flags correct code gets the correct code rewritten to please
 *     it. Attributes (`value=` MUST pass the canonical value or the <select>
 *     stops matching, `key=` wants identity), guards (`{a.fuel && <span/>}`),
 *     the `{xl ? xl(v, X_EN) : v}` dev-fallback idiom, and — the two the probe
 *     actually found — plain statements inside a `.map()` callback.
 */

import { RuleTester } from "eslint";
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const requireCjs = createRequire(import.meta.url);
const rule = requireCjs("../../eslint-rules/no-raw-enum-render.cjs");

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

const VIEW = "/repo/src/views/curator/SomeView.tsx";

tester.run("no-raw-enum-render", rule, {
  valid: [
    // The correct render.
    { code: `const x = <span>{xl(tob.category, CATS_EN)}</span>;`, filename: VIEW },
    // The dev-fallback idiom — the raw branch only renders in a t-less test.
    {
      code: `const x = <span>{xl ? xl(a.fuel, LIGHTER_FUELS_EN) : a.fuel}</span>;`,
      filename: VIEW,
    },
    {
      code: `const x = <span>{a.type ? (xl ? xl(a.type, ACC_TYPES_EN) : a.type) : "—"}</span>;`,
      filename: VIEW,
    },
    // Attributes are the OPPOSITE requirement: a <select> value must stay
    // canonical or the option no longer matches and the save breaks.
    { code: `const x = <SelectField value={form.category || ""} />;`, filename: VIEW },
    { code: `const x = <SelectField value={form.shape} />;`, filename: VIEW },
    // key= wants a stable identity, not a label.
    { code: `const x = <Frag key={f.category}>{xl(f.category, CATS_EN)}</Frag>;`, filename: VIEW },
    // Guards are not renders.
    { code: `const x = <div>{a.fuel && <span>{xl(a.fuel, F_EN)}</span>}</div>;`, filename: VIEW },
    { code: `const x = <div>{p.shape ? <Head /> : null}</div>;`, filename: VIEW },
    // Plain statements inside a map callback — what the first version wrongly
    // flagged in PipesDetailView (a colour lookup) and SettingsModal (an OAuth
    // event's `.type`, which has nothing to do with the accessory enum).
    {
      code: `const x = <div>{fams.map((fam) => { const col = catColor(fam.category); return <Bar key={fam.category} c={col} />; })}</div>;`,
      filename: VIEW,
    },
    {
      code: `const x = <div>{(() => { var label = ev.type; if (ev.action) label += ev.action; return <b>{label}</b>; })()}</div>;`,
      filename: VIEW,
    },
    // A LOCAL translator alias — PipesDetailView calls `tr(p.shape, SHAPES_EN)`.
    // Nothing tells the rule that `tr` translates; what saves it is the general
    // principle that a call ARGUMENT is never the rendered value (the call's
    // RESULT is). An excuse-list keyed on the name `xl` flagged this.
    { code: `const x = <Lbl>{tr(p.shape, SHAPES_EN) || "—"}</Lbl>;`, filename: VIEW },
    // Same principle: a colour lookup fed from an enum, inside an array of
    // tile descriptors in a JSX container (HomeViewV2's "du moment" tiles).
    {
      code: `const x = <div>{[{ color: catColor(featTob?.category || "") }].map((m) => <Tile key={m.color} c={m.color} />)}</div>;`,
      filename: VIEW,
    },
    // A non-enum field is none of the rule's business.
    { code: `const x = <span>{tob.brand} · {tob.name}</span>;`, filename: VIEW },
    // Writes are not renders.
    { code: `const x = <div>{(() => { form.category = v; return null; })()}</div>;`, filename: VIEW },
  ],
  invalid: [
    // THE historical shape (accessory-card fuel).
    {
      code: `const x = <Lbl>{a.fuel}</Lbl>;`,
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }],
    },
    // Tobacco card "category · cut" — two leaks in one line, which is how the
    // original bug actually read.
    {
      code: `const x = <div>{tob.category} · {tob.cut}</div>;`,
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }, { messageId: "rawEnum" }],
    },
    // A template literal hides it just as well.
    {
      code: "const x = <div>{`${p.shape} · ${p.courbure}`}</div>;",
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }, { messageId: "rawEnum" }],
    },
    // Half-translated: one field goes through xl, the neighbour doesn't. The
    // rule must not let the xl() call vouch for the whole expression.
    {
      code: `const x = <div>{xl(p.shape, SHAPES_EN)} · {p.finish}</div>;`,
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }],
    },
    // The `|| "—"` fallback shape — the enum IS the rendered value here.
    {
      code: `const x = <div>{tob.cut || "—"}</div>;`,
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }],
    },
    // A callback that returns the bare value renders it as text.
    {
      code: `const x = <div>{fams.map((f) => f.category)}</div>;`,
      filename: VIEW,
      errors: [{ messageId: "rawEnum" }],
    },
  ],
});

describe("no-raw-enum-render is wired to the Curator UI", () => {
  const config = readFileSync("eslint.config.js", "utf8");

  it("registers at error level for the Curator source", () => {
    expect(config).toContain("no-raw-enum-render");
    expect(config).toContain('"tabac-local/no-raw-enum-render": "error"');
  });

  it("covers every field carrying a translated enum", () => {
    // The rule's field list must keep up with constants.ts: a new translated
    // enum whose field is missing here is silently unguarded.
    const src = readFileSync("eslint-rules/no-raw-enum-render.cjs", "utf8");
    for (const f of [
      "category", "cut", "shape", "courbure", "filterType",
      "bowlMaterial", "stemMaterial", "finish", "fuel", "type",
    ]) {
      expect(src).toContain(`"${f}"`);
    }
  });
});
