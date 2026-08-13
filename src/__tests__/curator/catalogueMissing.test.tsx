// "no catalogue loaded" is a STATE, not a failure, and every
// surface that needs one has to say so.
//
// It REPLACES `catalogOfflineRetry.test.tsx` and `catalogUnavailable.test.tsx`,
// whose subject ceased to exist. Those locked the finding: a dynamic
// `import()` that fails is remembered as a failure in the browser's module
// map, so a retry issues no request and only a reload helps — reported from
// the installed app, offline, where coming back online did not fix the
// catalogue and killing the app did. The app dynamically imports no catalogue
// now, so there is no chunk fetch to fail and no reload to offer.
//
// What DOES carry over is the other half, and it is why this file
// exists rather than nothing: the entry forms marked themselves ready whether
// the catalogue had loaded or not, so a user typing a catalogued blend never
// saw the one-tap fill offer, nothing was wrong with what they typed, and
// nothing said so. A missing catalogue must be visible where it would have
// helped — and, unlike a failed download, it must name the remedy, which is
// Réglages → Données.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { LANG } from "../../i18n";
import { LANGUAGES } from "../../i18n/languages";
import { translate, ensureLang } from "../../i18n";

// No catalogue in the store — the state of every fresh install.
vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(null),
}));

const { CatalogueMissing } = await import("../../components/curator/CatalogueMissing");
const { CuratorCatalogView } = await import("../../views/curator/CatalogView");
const { CuratorTobaccoFormView } = await import("../../views/curator/TobaccoFormView");
const { CuratorWishFormView } = await import("../../views/curator/WishFormView");
const { _resetTobaccoDbForTests } = await import("../../utils/tobaccoDb");

const t = (k: string) => (LANG["fr"] as Record<string, string>)[k] || k;

const blank = {
  name: "", brand: "", category: "", cut: "", blend: "",
  force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
  imageUrl: "", tastingNotes: "", description: "", agingMax: "", lots: [],
};

beforeEach(() => { _resetTobaccoDbForTests(); });

describe("CatalogueMissing", () => {
  it("names the remedy and opens Réglages → Données on the DATA tab", () => {
    // The tab matters: Settings remembers the last one used
    // (`cave-settings-tab`), so opening the modal without setting it can land
    // the user on Préférences with nothing about a catalogue on screen.
    const setImportModal = vi.fn();
    const setSettingsTab = vi.fn();
    renderWithCtx(<CatalogueMissing />, { t, setImportModal, setSettingsTab });
    fireEvent.click(screen.getByRole("button", { name: t("btn_cat_open_settings") }));
    expect(setSettingsTab).toHaveBeenCalledWith("data");
    expect(setImportModal).toHaveBeenCalledWith(true);
  });

  it("offers no reload and no retry — neither can help", () => {
    // The button, and the one before it. Keeping either would send
    // the user to a remedy that cannot work: the catalogue was never fetched,
    // it was never supplied. `lang_offline_reload` is still a live key (the
    // LANGUAGE chunks are still dynamically imported, and there the reload is
    // the right advice), so this is a real string to be absent, not a
    // vacuously-missing one.
    const { container } = renderWithCtx(<CatalogueMissing />, { t });
    expect(t("lang_offline_reload"), "the key must still exist, or this proves nothing")
      .not.toBe("lang_offline_reload");
    expect(container.textContent || "").not.toContain(t("lang_offline_reload"));
  });

  it("has a compact form for the forms, which still names the remedy", () => {
    const { container } = renderWithCtx(<CatalogueMissing compact />, { t });
    expect(container.textContent).toContain(t("cat_missing_short"));
    expect(screen.getByRole("button", { name: t("btn_cat_open_settings") })).toBeTruthy();
  });
});

describe("the surfaces that need a catalogue say so", () => {
  it("the catalogue page, instead of spinning for ever", async () => {
    const { container } = renderWithCtx(<CuratorCatalogView />, {
      view: "catalog", lang: "fr", t, data: { tobaccos: [], wishlist: [] }, nav: vi.fn(),
    });
    await waitFor(() => expect(container.textContent).toContain(t("cat_missing_hint")));
  });

  it("the tobacco form, where the one-tap fill offer would have been", async () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT", form: blank, lang: "fr", t,
    });
    await waitFor(() => expect(container.textContent).toContain(t("cat_missing_short")));
  });

  it("the wishlist form, which must not diverge from the tobacco form", async () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true, wishForm: blank, lang: "fr", t,
    });
    await waitFor(() => expect(container.textContent).toContain(t("cat_missing_short")));
  });
});

describe("every string resolves in every language", () => {
  it("and is not the raw key", async () => {
    for (const { code } of LANGUAGES) {
      await ensureLang(code);
      for (const k of ["cat_missing_hint", "cat_missing_short", "btn_cat_open_settings", "ai_err_no_catalogue"]) {
        const s = translate(code, k);
        expect(s, `${code}.${k}`).not.toBe(k);
        expect(String(s).length, `${code}.${k}`).toBeGreaterThan(5);
      }
    }
  });
});
