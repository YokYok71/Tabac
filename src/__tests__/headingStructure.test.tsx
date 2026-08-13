// The app's biggest text was, on most screens, not a heading.
//
// CLAUDE.md has stated the model — `PageTitle` is h1,
// `SectionHead`/`ModalHeader` are h2, `FormSection` is h3, "never replace
// those with plain `<div>`" — and four surfaces never used `PageTitle` at all,
// so they built their own hero out of a div and inherited none of it:
//
//   • HomeViewV2's masthead ("Bibliothèque"), fs(44) — no h1 anywhere on the
//     landing screen, and `ZoneHead` under it was a span.
//   • the three fiches (tobacco / pipe / accessory) — the ENTITY NAME, the
//     largest text on screen and the answer to "what am I looking at", was a
//     div while the sections beneath it were real h2s. A screen reader's
//     heading list opened at "Les lots".
//   • all five forms — `FormScreen`'s hero was a div, so a form's outline was
//     h3, h3, h3 with no h1.
//   • the tasting setup — three `SectionHead` h2s under a div hero.
//
// WHY NO CHECK CAUGHT IT: `a11y.curator.test.tsx` runs axe with
// `runOnly: ["wcag2a", "wcag2aa"]`, and BOTH rules that would fire here —
// `page-has-heading-one` and `heading-order` — are tagged best-practice, so
// they are excluded by construction. It also disables `page-has-heading-one`
// explicitly on top of that.
//
// This test is source-level for the same reason the layout gates are:
// rendering the fiches needs the whole ctx, and what rots is WHICH ELEMENT is
// used, not what it looks like. Comments are blanked first (three earlier releases
// each shipped a check satisfied by the comment explaining the fix).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { FormScreen, FormSection } from "../components/curator/FormFields.tsx";

const blank = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

const src = (p: string) => blank(readFileSync(p, "utf8"));

describe("every full-screen surface opens with an h1", () => {
  it("HomeViewV2's masthead is the h1, and ZoneHead an h2", () => {
    const s = src("src/views/curator/HomeViewV2.tsx");
    expect(s, "the masthead was a div — the landing screen had no h1").toMatch(/<h1[\s\S]{0,400}?sec_library/);
    expect(s, "ZoneHead was a span").toMatch(/<h2[\s\S]{0,300}?\{title\}<\/h2>/);
  });

  // The h1's OPENING tag through its close, so an assertion about what the
  // heading contains cannot be satisfied by text sitting after it.
  const h1Block = (s: string) => {
    const m = /<h1[\s\S]*?<\/h1>/.exec(s);
    return m ? m[0] : null;
  };

  for (const [view, obj] of [
    ["InventoryDetailView", "tob"],
    ["PipesDetailView", "p"],
    ["AccessoryDetailView", "a"],
  ] as const) {
    it(`${view}'s hero name is an h1`, () => {
      const s = src(`src/views/curator/${view}.tsx`);
      const h1 = h1Block(s);
      expect(h1, `${view} has no <h1>`).toBeTruthy();
      // …and it is the ENTITY NAME, not some other string that happens to be
      // first: the fiche is ABOUT that object, and it was the one thing the
      // heading outline did not carry.
      expect(h1!, "the h1 must be the entity name").toContain(`${obj}.name`);
      // The browser's own h1 defaults are bold with a large margin, so the
      // overrides are what make this a no-op visually.
      expect(h1!).toContain("fontWeight: 400");
      expect(h1!).toMatch(/margin: "8px 0 0"/);
    });
  }

  it("the tasting SETUP has one; the RUNNING stage deliberately has none", () => {
    const s = src("src/views/curator/TastingView.tsx");
    const all = s.match(/<h1[^>]*>/g) || [];
    // Exactly one: the live timer must NOT become a heading — its text
    // changes every second, so a screen reader would re-announce it forever.
    expect(all.length, "expected exactly one <h1> in TastingView").toBe(1);
    expect(h1Block(s)!, "the h1 is the setup hero").toContain("tasting_upcoming_word");
  });
});

describe("FormScreen renders a real heading outline", () => {
  it("the hero title is an h1", () => {
    render(
      <FormScreen title="Nouveau tabac" onCancel={() => {}} onSave={() => {}}>
        <div />
      </FormScreen>,
    );
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.textContent).toBe("Nouveau tabac");
    // The whole point of the inline overrides: the rendered result is
    // unchanged. A browser's default h1 is bold and carries a big margin.
    expect(h.style.fontWeight).toBe("400");
    expect(h.style.margin).toBe("0px");
  });

  it("a section under it is an h2 — h3 would skip a level", () => {
    render(
      <FormScreen title="Nouveau tabac" onCancel={() => {}} onSave={() => {}}>
        <FormSection title="Identité"><div /></FormSection>
      </FormScreen>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Identité");
    expect(screen.queryByRole("heading", { level: 3 }), "no level was skipped").toBeNull();
  });
});
