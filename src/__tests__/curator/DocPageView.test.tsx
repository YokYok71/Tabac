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
