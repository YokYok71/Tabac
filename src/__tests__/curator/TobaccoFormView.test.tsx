// Smoke tests for src/views/curator/TobaccoFormView.tsx.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { loadCatalogueFixture, resetCatalogueFixture } from "../catalogueFixture";

// The app ships no catalogue — a test that needs one has to
// supply it. The committed excerpt, through the real parser.
vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx, mockT, mockXl } from "../viewTestUtils";
import { AppCtx } from "../../AppContext";
import { CuratorTobaccoFormView } from "../../views/curator/TobaccoFormView";

const emptyForm = {
  name: "", brand: "", category: "", cut: "", blend: "",
  force: 0, roomNote: 0, taste: 0, rating: 0, rebuy: null,
  imageUrl: "", tastingNotes: "", description: "", agingMax: "", lots: [],
};

describe("TobaccoFormView — visibility", () => {
  it("returns null when view !== 'addT' / 'editT'", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "home",
      form: emptyForm,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the form when view === 'addT'", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: emptyForm,
      setForm: vi.fn(),
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe("TobaccoFormView — required-field gate", () => {
  it("Save button is disabled when brand AND name are both empty", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: emptyForm,
      setForm: vi.fn(),
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn).toBeTruthy();
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("true");
  });

  it("Save button is enabled when brand AND name are both filled", () => {
    const filled = { ...emptyForm, name: "Duskfall", brand: "Brackwater" };
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: filled,
      setForm: vi.fn(),
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("false");
  });

  it("Save button stays disabled when only name is filled", () => {
    const partial = { ...emptyForm, name: "Duskfall" };
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: partial,
      setForm: vi.fn(),
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("TobaccoFormView — Cancel", () => {
  it("Cancel button resets form + navigates to inv", () => {
    const setForm = vi.fn();
    const nav = vi.fn();
    const BT = emptyForm;
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: emptyForm,
      setForm,
      nav,
      BT,
    });
    const cancel = container.querySelector("button[aria-label='close']") ||
                   Array.from(container.querySelectorAll("button"))
                     .find(b => /btn_close|btn_cancel|Annuler|Cancel/i.test(b.getAttribute("aria-label") || ""));
    if (cancel) {
      fireEvent.click(cancel);
      expect(setForm).toHaveBeenCalled();
      expect(nav).toHaveBeenCalledWith("inv", { restoreScroll: true });
    }
  });
});

// duplicate detection. Warning-only banner that appears
// when brand+name match an existing live tabac. Skipped if either
// field is empty, skipped for the entity being edited (form.id match),
// skipped for trashed rows (they're already in the corbeille).
describe("TobaccoFormView — duplicate detection", () => {
  // THE THREE NEGATIVES BELOW WERE UNFALSIFIABLE, and the POSITIVE case in
  // this same block is what shows why: it accepts `dup_tob_pre` alongside the
  // French and English wordings, because the harness `t` returns the KEY — so
  // « existe déjà » appears NOWHERE under this harness, and a negative that
  // only forbids those words holds whether the banner is hidden, shown, or
  // wired to fire on every keystroke. PROBED: forcing the duplicate memo to
  // return a row unconditionally left all 26 cases in this file green.
  //
  // The regex forbids the KEYS as well. A negative assertion must reject
  // exactly what the positive one accepts, or it is a decoration.
  const DUP_BANNER = /existe déjà|already exists|dup_tob_pre|dup_tob_wish_pre/i;

  const dupData = {
    tobaccos: [
      { id: 1, name: "Duskfall", brand: "Brackwater", lots: [] },
      { id: 2, name: "Trashed", brand: "Brackwater", lots: [],
        deletedAt: "2026-05-15T10:00:00Z" },
    ],
  };

  it("does NOT show the banner when brand or name is empty", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: { ...emptyForm, brand: "Brackwater", name: "" },
      setForm: vi.fn(),
      data: dupData,
    });
    expect(container.textContent).not.toMatch(DUP_BANNER);
  });

  it("shows the banner when brand+name (case-insensitive) match a live tabac", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: { ...emptyForm, brand: "brackwater", name: "DUSKFALL" },
      setForm: vi.fn(),
      data: dupData,
    });
    expect(container.textContent).toMatch(/existe déjà|already exists|dup_tob_pre/i);
    expect(container.textContent).toContain("Brackwater — Duskfall");
  });

  it("does NOT show the banner when only a trashed tabac matches", () => {
    // dup #2 carries deletedAt → it's in the corbeille, not the
    // active inventory; the user is allowed to re-add the brand+name.
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: { ...emptyForm, brand: "Brackwater", name: "Trashed" },
      setForm: vi.fn(),
      data: dupData,
    });
    expect(container.textContent).not.toMatch(DUP_BANNER);
  });

  it("does NOT show the banner in editT when editing the matching tabac itself", () => {
    // Editing tobacco #1: brand+name match itself, but we shouldn't
    // flag the user editing their own row.
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: { ...emptyForm, id: 1, brand: "Brackwater", name: "Duskfall" },
      setForm: vi.fn(),
      data: dupData,
    });
    expect(container.textContent).not.toMatch(DUP_BANNER);
  });

  it("does NOT block save when a duplicate is detected (warning only)", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: { ...emptyForm, brand: "Brackwater", name: "Duskfall" },
      setForm: vi.fn(),
      data: dupData,
    });
    const saveBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_add|Ajouter|Add/i.test(b.textContent || ""));
    expect(saveBtn?.getAttribute("aria-disabled")).toBe("false");
  });
});

// "Sync with DB" feature on the edit form. When the
// edited tobacco's brand+name match a catalog entry AND at least one
// field diverges from the catalog value, an info Notice surfaces with
// a one-tap "Synchroniser" button. Only fires in edit mode and never
// touches description / personal notes.
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../../utils/tobaccoDb";

async function primeDb() {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
  await loadTobaccoDb();
}

describe("TobaccoFormView — sync with DB", () => {
  it("does NOT render the sync notice in add mode, even with a DB-known brand+name", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT",
      form: {
        ...emptyForm,
        // Brand + name match a real catalog entry, but we're in addT.
        brand: "Halvorsen", name: "Duskfall",
      },
      setForm: vi.fn(),
    });
    expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser|Catalog update/i);
  });

  it("does NOT render when brand+name don't match any catalog entry", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Totally Made Up Brand", name: "Imaginary Blend",
      },
      setForm: vi.fn(),
    });
    expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser/i);
  });

  it("renders the sync notice when a catalog entry exists AND at least one field diverges", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        // Halvorsen Duskfall is "Anglais" in the catalog — force a divergence.
        category: "Aromatique",
      },
      setForm: vi.fn(),
    });
    // dbReady flips async via useEffect → wait for the notice to render.
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i);
    });
  });

  it("clicking Synchroniser calls setForm with the catalog values for divergent fields", async () => {
    await primeDb();
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique", // diverges (DB says Anglais)
      },
      setForm,
    });
    let syncBtn: Element | undefined;
    await waitFor(() => {
      // PressCard renders no native button — it's a div with onClick.
      // Match the deepest element whose own text (no children) is the
      // Sync label so we click the actual interactive node.
      syncBtn = Array.from(container.querySelectorAll("*"))
        .find(el =>
          el.children.length === 0 &&
          /^(db_sync_apply|Synchroniser|Sync)$/i.test((el.textContent || "").trim()),
        );
      expect(syncBtn).toBeTruthy();
    });
    fireEvent.click(syncBtn!);
    expect(setForm).toHaveBeenCalled();
    const calls = setForm.mock.calls;
    const patched = calls[calls.length - 1]![0];
    // The form patch should set category to the DB value (Anglais),
    // not keep the divergent Aromatique.
    expect(patched.category).toBe("Anglais");
  });

  // applying the sync blurs the focused element first, so
  // when the banner (which holds the Synchroniser button) unmounts, mobile
  // WebKit doesn't reassign focus to the name/category field below and pop
  // the keyboard. Here we focus an input, sync, and assert focus left it.
  it("blurs the active element when syncing so focus doesn't jump to a field", async () => {
    await primeDb();
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      },
      setForm,
    });
    let syncBtn: Element | undefined;
    await waitFor(() => {
      syncBtn = Array.from(container.querySelectorAll("*"))
        .find(el =>
          el.children.length === 0 &&
          /^(db_sync_apply|Synchroniser|Sync)$/i.test((el.textContent || "").trim()),
        );
      expect(syncBtn).toBeTruthy();
    });
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.click(syncBtn!);
    // Focus was moved off the field (to <body>) before the banner unmounts.
    expect(document.activeElement).not.toBe(input);
  });

  // dismiss branch coverage (audit gap).
  it("clicking 'Garder mes valeurs' hides the notice for the current entry", async () => {
    await primeDb();
    function Wrapped() {
      const [form, setForm] = React.useState({
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      });
      return (
        <Wrapper ctx={{ view: "editT", form, setForm }} />
      );
    }
    function Wrapper({ ctx }: { ctx: any }) {
      return renderWithCtx(<CuratorTobaccoFormView />, ctx).container as any;
    }
    // Use renderWithCtx directly — Wrapped/Wrapper above is for clarity
    // but we render directly here so we keep access to container + setForm.
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      },
      setForm,
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i);
    });
    // Click "Garder mes valeurs" (db_sync_dismiss).
    const dismissBtn = Array.from(container.querySelectorAll("*"))
      .find(el =>
        el.children.length === 0 &&
        /^(db_sync_dismiss|Garder mes valeurs|Keep my values)$/i.test((el.textContent || "").trim()),
      );
    expect(dismissBtn).toBeTruthy();
    fireEvent.click(dismissBtn!);
    await waitFor(() => {
      expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser/i);
    });
    // setForm must NOT have been called by the dismiss action.
    expect(setForm).not.toHaveBeenCalled();
    // Suppress unused-vars on the stateful helpers.
    void Wrapped;
  });

  it("dismiss scope is per-entry — switching to a different id resurfaces the notice", async () => {
    await primeDb();
    // Render with id=1 + divergence, dismiss it.
    const { container, rerender } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 1,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      },
      setForm: vi.fn(),
    });
    await waitFor(() => expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i));
    const dismissBtn = Array.from(container.querySelectorAll("*"))
      .find(el =>
        el.children.length === 0 &&
        /^(db_sync_dismiss|Garder mes valeurs|Keep my values)$/i.test((el.textContent || "").trim()),
      );
    fireEvent.click(dismissBtn!);
    await waitFor(() => expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser/i));

    // Re-render with a DIFFERENT id (user clicked Edit on another
    // tabac that ALSO matches a divergent catalog entry).
    rerender(
      <AppCtx.Provider value={{
        t: mockT, xl: mockXl, lang: "fr",
        view: "editT",
        form: {
          ...emptyForm, id: 999,
          brand: "Halvorsen", name: "Duskfall",
          category: "Aromatique",
        },
        setForm: vi.fn(),
        BT: emptyForm, data: { tobaccos: [] },
      } as any}>
        <CuratorTobaccoFormView />
      </AppCtx.Provider>,
    );
    // Notice must resurface — the dismissal was scoped to id=1.
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i);
    });
  });

  // description + name + brand now in the diff/patch.
  // tastingNotes stays excluded — only user-owned prose.
  it("applies description, name AND brand from the catalog (only tastingNotes stays untouched)", async () => {
    await primeDb();
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 7,
        // Brand cased differently AND name cased differently AND
        // empty description AND personalised tasting notes that
        // MUST survive the sync.
        brand: "halvorsen", name: "duskfall",
        category: "Aromatique",       // diverges
        description: "",              // diverges (catalog has prose)
        tastingNotes: "Top dose de fin de journée — à conserver",
      },
      setForm,
    });
    // Wait for the notice + click Sync.
    let syncBtn: Element | undefined;
    await waitFor(() => {
      syncBtn = Array.from(container.querySelectorAll("*"))
        .find(el =>
          el.children.length === 0 &&
          /^(db_sync_apply|Synchroniser|Sync)$/i.test((el.textContent || "").trim()),
        );
      expect(syncBtn).toBeTruthy();
    });
    fireEvent.click(syncBtn!);
    const calls = setForm.mock.calls;
    const patched = calls[calls.length - 1]![0];
    // Description, name, brand all overwritten to the canonical
    // catalog values.
    expect(patched.description.length).toBeGreaterThan(20);
    expect(patched.name).toBe("Duskfall");      // canonical casing
    expect(patched.brand).toBe("Halvorsen");     // canonical casing
    expect(patched.category).toBe("Anglais");
    // tastingNotes preserved verbatim — the only user-owned prose.
    expect(patched.tastingNotes).toBe("Top dose de fin de journée — à conserver");
  });

  // defensive — catalog-internal fields (aliases) AND
  // user-personal fields (tastingNotes, imageUrl, rating, rebuy, lots)
  // must NEVER be overwritten by the sync. `LookupResult` strips
  // aliases at the API boundary; FIELDS deliberately omits the
  // user-personal ones. This test locks the full preservation
  // contract.
  it("aliases, imageUrl, rating, rebuy, lots, tastingNotes ALL preserved through sync", async () => {
    await primeDb();
    const setForm = vi.fn();
    const userValues = {
      tastingNotes: "Top dose de fin de journée",
      imageUrl: "local-photo-1234567890",
      rating: 5,
      rebuy: true,
      lots: [{ id: 42, weightG: "50", status: "cellar" }],
    };
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT",
      form: {
        ...emptyForm, id: 8,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
        ...userValues,
      },
      setForm,
    });
    let syncBtn: Element | undefined;
    await waitFor(() => {
      syncBtn = Array.from(container.querySelectorAll("*"))
        .find(el =>
          el.children.length === 0 &&
          /^(db_sync_apply|Synchroniser|Sync)$/i.test((el.textContent || "").trim()),
        );
      expect(syncBtn).toBeTruthy();
    });
    fireEvent.click(syncBtn!);
    const calls = setForm.mock.calls;
    const patched = calls[calls.length - 1]![0];
    // Catalog-internal field never written.
    expect(patched.aliases).toBeUndefined();
    // User-personal fields preserved verbatim.
    expect(patched.tastingNotes).toBe(userValues.tastingNotes);
    expect(patched.imageUrl).toBe(userValues.imageUrl);
    expect(patched.rating).toBe(userValues.rating);
    expect(patched.rebuy).toBe(userValues.rebuy);
    expect(patched.lots).toEqual(userValues.lots);
  });
});

// tag / collection editor.
describe("TobaccoFormView — tag editor", () => {
  it("renders a suggestion chip from existing inventory tags", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT", form: { ...emptyForm, tags: [] }, setForm: vi.fn(),
      data: { tobaccos: [{ id: 1, tags: ["voyage"] }], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    // The reuse suggestions fold away by default — open the
    // disclosure first. The suggestion itself is what this test is about.
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    const sugg = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.textContent || "").includes("voyage"));
    expect(sugg).toBeTruthy();
  });

  it("adds a typed tag through setForm (sanitised)", () => {
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "addT", form: { ...emptyForm, tags: [] }, setForm,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const input = Array.from(container.querySelectorAll("input"))
      .find((i) => (i.getAttribute("aria-label") || "").includes("tag_add_label")) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "  Matin  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const _c = setForm.mock.calls; const patch = _c[_c.length - 1]![0];
    const next = typeof patch === "function" ? patch({ ...emptyForm, tags: [] }) : patch;
    expect(next.tags).toEqual(["Matin"]);
  });

  it("removes an existing tag", () => {
    const setForm = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, {
      view: "editT", editId: 1,
      form: { ...emptyForm, id: 1, tags: ["voyage", "matin"] }, setForm,
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
    });
    const rm = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").includes("voyage"));
    expect(rm).toBeTruthy();
    fireEvent.click(rm!);
    const _c = setForm.mock.calls; const patch = _c[_c.length - 1]![0];
    const next = typeof patch === "function" ? patch({ ...emptyForm, id: 1, tags: ["voyage", "matin"] }) : patch;
    expect(next.tags).toEqual(["matin"]);
  });
});

// ── the per-fiche catalogue lock ────────────────────────────
// The checkbox is the only visible half of a promise made in
// utils/catalogueApply.ts. These assert the WIRING, which is what breaks: the
// engine has its own suite, and a control that renders but never reaches
// setForm looks perfectly healthy on screen.
describe("TobaccoFormView — catalogue lock", () => {
  const findLock = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[role="checkbox"]'))
      .find((el) => (el.textContent || "").indexOf("lbl_catalogue_lock") !== -1) as HTMLElement | undefined;

  it("renders a real checkbox that announces its state", () => {
    // role + aria-checked, not colour: the lesson. mockT returns
    // the key, so the label is asserted by key rather than by wording.
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, { view: "addT", form: emptyForm, setForm: vi.fn() });
    const box = findLock(container);
    expect(box, "the catalogue-lock checkbox is missing from the form").toBeTruthy();
    expect(box!.getAttribute("aria-checked")).toBe("false");
    expect(box!.getAttribute("aria-describedby"), "the hint must be wired as the description").toBeTruthy();
  });

  it("reflects a fiche that is already locked", () => {
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, { view: "addT", form: { ...emptyForm, catalogueLock: true }, setForm: vi.fn() });
    expect(findLock(container)!.getAttribute("aria-checked")).toBe("true");
  });

  it("writes catalogueLock through to the form on tap", () => {
    const set = vi.fn();
    const { container } = renderWithCtx(<CuratorTobaccoFormView />, { view: "addT", form: emptyForm, setForm: set });
    fireEvent.click(findLock(container)!);
    expect(set).toHaveBeenCalled();
    const arg = set.mock.calls[0]![0];
    const next = typeof arg === "function" ? arg(emptyForm) : arg;
    expect(next.catalogueLock).toBe(true);
  });
});
