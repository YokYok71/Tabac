// CuratorDocPageView — smoke tests. The extraction logic itself is
// covered by docPage.test.ts; here we assert the view wiring (visibility
// per view key, title, loading).
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppCtx } from "../../AppContext.tsx";
import { CuratorDocPageView, DOC_PAGES } from "../../views/curator/DocPageView.tsx";

function renderWith(ctx: any) {
  return render(
    <AppCtx.Provider value={ctx}>
      <CuratorDocPageView />
    </AppCtx.Provider>
  );
}

const baseCtx = {
  lang: "fr",
  t: (k: string) => k,
  nav: () => {},
};

describe("CuratorDocPageView — visibility", () => {
  it("returns null for a view that isn't a doc page", () => {
    const { container } = renderWith({ ...baseCtx, view: "home" });
    expect(container.firstChild).toBeNull();
  });

  it("registers changelog, privacy and licenses", () => {
    expect(Object.keys(DOC_PAGES).sort()).toEqual(["changelog", "licenses", "privacy"]);
  });
});

describe("CuratorDocPageView — per-page render", () => {
  for (const key of ["changelog", "privacy", "licenses"]) {
    it(`renders the ${key} title + loading state while its html is fetched`, () => {
      renderWith({ ...baseCtx, view: key });
      // title uses the page's titleKey; our t() echoes the key back
      expect(screen.getByText(DOC_PAGES[key]!.titleKey)).toBeInTheDocument();
      expect(screen.getByText(/lbl_loading_dots|Chargement/i)).toBeInTheDocument();
    });
  }
});

// ── LE RETOUR DOIT PRÉFÉRER closeDocPage ────────────────────────────────────
// Une page doc ouverte DEPUIS Réglages doit y revenir : `openDocFromSettings`
// range la vue sous-jacente dans `settingsReturnRef` et `closeDocPage` rouvre
// Réglages par-dessus. Le repli sur `nav("home")` n'existe que pour les portes
// qui n'ont PAS de Réglages derrière elles — le pied de page du Home, la porte
// des conditions.
//
// Sondé : remplacer tout le gestionnaire par `nav("home")` laissait 1053 cas
// verts, et le bouton Retour ramenait l'utilisateur à l'Accueil au lieu de
// l'écran d'où il venait. Un contrôle qui n'est pas cassé, seulement infidèle.
describe("CuratorDocPageView — le retour", () => {
  it("appelle closeDocPage quand il existe, et PAS nav", () => {
    const calls: string[] = [];
    const { container } = renderWith({
      ...baseCtx, view: "privacy",
      nav: (v: string) => calls.push("nav:" + v),
      closeDocPage: () => calls.push("close"),
    });
    const back = container.querySelector('[aria-label="btn_back"]') as HTMLElement | null;
    expect(back, "le bouton Retour a disparu de la barre").toBeTruthy();
    back!.click();
    expect(calls, "le retour a navigué au lieu de rendre la main à Réglages").toEqual(["close"]);
  });

  it("retombe sur nav('home') quand aucun Réglages n'est derrière", () => {
    // Le contre-sens : sans ce cas, un gestionnaire qui n'appellerait JAMAIS
    // `nav` passerait pour correct et le pied de page du Home mènerait à un
    // cul-de-sac.
    const calls: string[] = [];
    const { container } = renderWith({
      ...baseCtx, view: "privacy", nav: (v: string) => calls.push("nav:" + v),
    });
    (container.querySelector('[aria-label="btn_back"]') as HTMLElement).click();
    expect(calls).toEqual(["nav:home"]);
  });
});
