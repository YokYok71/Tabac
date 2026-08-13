// HelpView — smoke tests + parseHelpHtml unit.
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorHelpView, parseHelpHtml } from "../../views/curator/HelpView.tsx";

function renderWith(ctx: any) {
  return render(
    <AppCtx.Provider value={ctx}>
      <CuratorHelpView />
    </AppCtx.Provider>
  );
}

const baseCtx = {
  view: "help",
  lang: "fr",
  t: (k: string) => k,
  nav: () => {},
  collapsedHelpSections: {},
  toggleHelpSection: () => {},
  setAllHelpSectionsCollapsed: () => {},
};

describe("CuratorHelpView — rendering", () => {
  it("returns null when view !== 'help'", () => {
    const { container } = renderWith({ ...baseCtx, view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("renders the page title and the loading message while help.html is being fetched", () => {
    renderWith(baseCtx);
    // The PageTitle says "Mode d'emploi" (FR)
    expect(screen.getByText(/Mode|help_title_prefix/)).toBeInTheDocument();
    expect(screen.getByText(/d'emploi|help_title_word/)).toBeInTheDocument();
    // While fetch is pending the loader is shown
    expect(screen.getByText(/Chargement|lbl_loading_dots/i)).toBeInTheDocument();
  });

  it("renders the EN title when lang = 'en'", () => {
    const { container } = renderWith({ ...baseCtx, lang: "en" });
    // PageTitle splits the heading into "User" + <span>guide</span> so a
    // bare getByText(/guide/) misses the span; assert on the combined
    // textContent of the page instead.
    expect((container.textContent || "")).toMatch(/User\s*guide|help_title/);
    expect(screen.getByText(/Loading|lbl_loading_dots/i)).toBeInTheDocument();
  });
});

describe("parseHelpHtml", () => {
  const fixture = `
    <html><body>
      <div id="sec-fr">
        <h1>Mode d'emploi</h1>
        <h2 id="fr-concepts">1. Concepts de base</h2>
        <p>Texte FR concepts.</p>
        <ul><li>Item un</li><li>Item deux</li></ul>
        <h2 id="fr-cycle">2. Cycle de vie</h2>
        <p>Texte FR cycle.</p>
        <h2 id="fr-other">3. Autre</h2>
        <p>Pas mappé.</p>
      </div>
      <div id="sec-en">
        <h1>User Guide</h1>
        <h2 id="en-concepts">1. Core concepts</h2>
        <p>EN concepts text.</p>
        <h2 id="en-cycle">2. Lifecycle</h2>
        <p>EN cycle text.</p>
      </div>
    </body></html>
  `;

  it("extracts the FR and EN titles for each known section id", () => {
    const out = parseHelpHtml(fixture);
    const concepts = out.find(s => s.key === "concepts");
    const cycle = out.find(s => s.key === "cycle");
    expect(concepts).toBeTruthy();
    expect(cycle).toBeTruthy();
    expect(concepts!.titles.fr).toBe("1. Concepts de base");
    expect(concepts!.titles.en).toBe("1. Core concepts");
    expect(cycle!.titles.fr).toBe("2. Cycle de vie");
    expect(cycle!.titles.en).toBe("2. Lifecycle");
  });

  it("captures every sibling between an h2 and the next h2 as the body", () => {
    const out = parseHelpHtml(fixture);
    const concepts = out.find(s => s.key === "concepts");
    expect(concepts!.bodies.fr).toContain("Texte FR concepts");
    expect(concepts!.bodies.fr).toContain("Item un");
    expect(concepts!.bodies.fr).toContain("Item deux");
    // Stops at the next h2 — must not include the cycle section's content
    expect(concepts!.bodies.fr).not.toContain("Texte FR cycle");
  });

  it("ignores h2 ids that aren't in the SECTION_IDS mapping", () => {
    const out = parseHelpHtml(fixture);
    // "fr-other" is not in the mapping → no section produced for it
    expect(out.some(s => (s.titles.fr || "").indexOf("Autre") !== -1)).toBe(false);
  });

  it("returns an empty array when neither sec-fr nor sec-en is present", () => {
    const out = parseHelpHtml("<html><body><p>nothing</p></body></html>");
    expect(out).toEqual([]);
  });

  // The regression this locks: a stray </div> inside the FR
  // wrapper auto-closed <div id="sec-fr"> early. The DOM-sibling-walk
  // parser then returned empty title+body for every h2 that landed
  // outside the wrapper. Source-order slicing is immune.
  it("still finds h2s when the wrapping <div id='sec-fr'> closes early", () => {
    const broken = `
      <html><body>
        <div id="sec-fr">
          <h2 id="fr-concepts">1. Concepts</h2>
          <p>Concepts content.</p>
          <ul>
            <li>auto-closes the wrapper</li>
          </ul></div>
        <h2 id="fr-maj">13. Mises à jour</h2>
        <p>Updates content.</p>
        <h2 id="fr-corbeille">16. Corbeille</h2>
        <p>Trash content.</p>
      </body></html>
    `;
    const out = parseHelpHtml(broken);
    const concepts = out.find(s => s.key === "concepts");
    const updates = out.find(s => s.key === "updates");
    const trash = out.find(s => s.key === "trash");
    expect(concepts!.titles.fr).toBe("1. Concepts");
    expect(updates!.titles.fr).toBe("13. Mises à jour");
    expect(updates!.bodies.fr).toContain("Updates content");
    expect(trash!.titles.fr).toBe("16. Corbeille");
    expect(trash!.bodies.fr).toContain("Trash content");
  });
});
