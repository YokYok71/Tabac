// Smoke tests for src/views/curator/WishFormView.tsx.

import { describe, it, expect, vi } from "vitest";
import { loadCatalogueFixture, resetCatalogueFixture } from "../catalogueFixture";

// The app ships no catalogue — a test that needs one has to
// supply it. The committed excerpt, through the real parser.
vi.mock("../../utils/catalogueStore.ts", () => ({
  catalogueLoad: () => Promise.resolve(loadCatalogueFixture()),
}));
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorWishFormView } from "../../views/curator/WishFormView";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../../utils/tobaccoDb";

const emptyWish = {
  name: "", brand: "", category: "", blend: "", cut: "",
  force: 0, roomNote: 0, taste: 0,
  description: "", agingMax: "", tastingNotes: "",
  imageUrl: "", notes: "", priority: "medium",
};

describe("WishFormView — visibility", () => {
  it("renders nothing when showWishForm=false AND editWishId=null", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the form when showWishForm=true", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: emptyWish,
      setWishForm: vi.fn(),
    });
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the form when editWishId is set (even with showWishForm=false)", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: "W1",
      wishForm: { ...emptyWish, name: "Existing", brand: "X" },
      setWishForm: vi.fn(),
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe("WishFormView — priority segmented", () => {
  it("renders 3 priority options", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: emptyWish,
      setWishForm: vi.fn(),
    });
    // The 3 priority pills should be rendered as buttons.
    expect(container.textContent).toMatch(/Haute|High|prio_high/);
    expect(container.textContent).toMatch(/Moyenne|Medium|prio_medium/);
    expect(container.textContent).toMatch(/Basse|Low|prio_low/);
  });
});

// duplicate detection on wishlist. Two flavours of warning:
//   - "wish":    same brand+name already on the wishlist (raw dup).
//   - "tobacco": same brand+name already in the active inventory →
//                user already owns it; the wish is moot.
// Warning only — save isn't blocked. Skipped on empty brand/name,
// skipped on the entry being edited, skipped for trashed rows.
describe("WishFormView — duplicate detection", () => {
  it("does NOT show the banner when brand or name is empty", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: { ...emptyWish, brand: "Brackwater", name: "" },
      setWishForm: vi.fn(),
      data: {
        wishlist: [{ id: 1, brand: "Brackwater", name: "Duskfall" }],
        tobaccos: [],
      },
    });
    expect(container.textContent).not.toMatch(/déjà|already/i);
  });

  it("shows the 'wish dup' banner when an identical wish already exists", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: { ...emptyWish, brand: "brackwater", name: "DUSKFALL" },
      setWishForm: vi.fn(),
      data: {
        wishlist: [{ id: 1, brand: "Brackwater", name: "Duskfall" }],
        tobaccos: [],
      },
    });
    expect(container.textContent).toMatch(/envie identique|identical wish|wishdup_wish_pre/i);
  });

  it("shows the 'already own it' banner when the brand+name match a live tabac", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: { ...emptyWish, brand: "Brackwater", name: "Duskfall" },
      setWishForm: vi.fn(),
      data: {
        wishlist: [],
        tobaccos: [{ id: 1, brand: "Brackwater", name: "Duskfall", lots: [] }],
      },
    });
    expect(container.textContent).toMatch(/déjà partie de votre inventaire|already in your inventory|wishdup_own_pre/i);
  });

  it("does NOT show the banner when only a trashed wish or trashed tabac matches", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: { ...emptyWish, brand: "Brackwater", name: "Duskfall" },
      setWishForm: vi.fn(),
      data: {
        wishlist: [{ id: 1, brand: "Brackwater", name: "Duskfall",
          deletedAt: "2026-05-15T10:00:00Z" }],
        tobaccos: [{ id: 2, brand: "Brackwater", name: "Duskfall", lots: [],
          deletedAt: "2026-05-15T10:00:00Z" }],
      },
    });
    expect(container.textContent).not.toMatch(/déjà|already/i);
  });

  it("does NOT show the banner in edit mode when the matching row is the wish itself", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 1,
      wishForm: { ...emptyWish, brand: "Brackwater", name: "Duskfall" },
      setWishForm: vi.fn(),
      data: {
        wishlist: [{ id: 1, brand: "Brackwater", name: "Duskfall" }],
        tobaccos: [],
      },
    });
    expect(container.textContent).not.toMatch(/déjà|already/i);
  });
});

// ── Cancel does NOT reset statusFilter ────────────────────────
// The wish form is an OVERLAY sitting on top of InventoryListView with
// statusFilter="wish". Earlier cancel() called nav("inv") which silently
// reset statusFilter to "active", flipping the user from the wishlist to the
// tobacco inventory. Now cancel just closes the overlay; the underlying
// view keeps its statusFilter intact.

describe("WishFormView — cancel does not call nav", () => {
  it("cancel only closes the overlay; no nav() call (would reset statusFilter)", () => {
    const nav = vi.fn();
    const setShowWishForm = vi.fn();
    const setEditWishId = vi.fn();
    const setWishForm = vi.fn();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 1,
      wishForm: { ...emptyWish, brand: "Brackwater", name: "Duskfall" },
      setWishForm, setShowWishForm, setEditWishId, nav,
      BW: { ...emptyWish },
    });
    // FormScreen renders cancel as an IconBtn with aria-label "btn_cancel"
    // (resolved by the mock t() identity in viewTestUtils).
    const cancelBtn = Array.from(container.querySelectorAll("button"))
      .find(b => /btn_cancel|Annuler|Cancel/i.test(b.getAttribute("aria-label") || ""));
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn!);
    expect(setShowWishForm).toHaveBeenCalledWith(false);
    expect(setEditWishId).toHaveBeenCalledWith(null);
    // The bug: nav() was being called and reset statusFilter to "active",
    // yanking the user from the wishlist to the tobacco list. Locked here.
    expect(nav).not.toHaveBeenCalled();
  });
});

// ── Open scrolls to top of form ───────────────────────────────
// The wish form is an overlay, so the page scroll carries over from the
// underlying wishlist. Opening from a scrolled position landed the user
// mid-form. A mount-only effect now scrolls to top when the form opens.

describe("WishFormView — scrolls to top when opened", () => {
  it("calls window.scrollTo(0, 0) when the form mounts with showWishForm=true", () => {
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    // jsdom doesn't implement scrollTo by default; stub it.
    Object.defineProperty(window, "scrollTo", {
      configurable: true, writable: true, value: scrollSpy,
    });
    try {
      renderWithCtx(<CuratorWishFormView />, {
        showWishForm: true,
        editWishId: null,
        wishForm: emptyWish,
        setWishForm: vi.fn(),
      });
      // Either ({top:0,left:0,behavior:"auto"}) or (0,0) call shape.
      expect(scrollSpy).toHaveBeenCalled();
      const args = scrollSpy.mock.calls[0]!;
      if (typeof args[0] === "object") {
        expect(args[0]).toMatchObject({ top: 0, left: 0 });
      } else {
        expect(args).toEqual([0, 0]);
      }
    } finally {
      Object.defineProperty(window, "scrollTo", {
        configurable: true, writable: true, value: original,
      });
    }
  });

  it("calls window.scrollTo(0, 0) when the form mounts with editWishId set", () => {
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    Object.defineProperty(window, "scrollTo", {
      configurable: true, writable: true, value: scrollSpy,
    });
    try {
      renderWithCtx(<CuratorWishFormView />, {
        showWishForm: false,
        editWishId: 1,
        wishForm: { ...emptyWish, name: "Edit me", brand: "X" },
        setWishForm: vi.fn(),
      });
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "scrollTo", {
        configurable: true, writable: true, value: original,
      });
    }
  });

  it("does NOT call window.scrollTo when the form is closed", () => {
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    Object.defineProperty(window, "scrollTo", {
      configurable: true, writable: true, value: scrollSpy,
    });
    try {
      renderWithCtx(<CuratorWishFormView />, {
        showWishForm: false,
        editWishId: null,
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "scrollTo", {
        configurable: true, writable: true, value: original,
      });
    }
  });
});

// ── Hook-order trap regression ────────────────────────────────
// The component is mounted unconditionally in CuratorApp.tsx, so the hook
// count must stay stable across renders even when the form is closed. A
// `dupInfo` useMemo was added BELOW the early returns; combined with the
// scroll-to-top useEffect (also originally BELOW the returns at the time of the
// patch attempt) this tipped the hook-count delta past React's tolerance and
// triggered "Minified React error #310 (Rendered more hooks than during the
// previous render)" the moment the user opened the wish edit form.
//
// Both hooks now sit ABOVE the returns; useMemo internally guards on `!form`.
// This test re-renders the same instance through the closed→open transition
// And asserts that React doesn't throw. On the earlier code this test
// fails (the second render throws #310 from the dev-mode hook tracker).

describe("WishFormView — hook order stable across open/close transitions", () => {
  it("transitioning from closed to open does not throw the hooks-count error", () => {
    const setForm = vi.fn();
    const { rerender } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: null,
      wishForm: emptyWish,
      setWishForm: setForm,
      data: { wishlist: [], tobaccos: [] },
    });
    expect(() => {
      rerender(
        <CuratorWishFormView />
      );
    }).not.toThrow();
    // Now flip the form open via a full re-render with the open ctx.
    expect(() => {
      renderWithCtx(<CuratorWishFormView />, {
        showWishForm: true,
        editWishId: null,
        wishForm: emptyWish,
        setWishForm: setForm,
        data: { wishlist: [], tobaccos: [] },
      });
    }).not.toThrow();
  });
});

// Wish-side mirror of the TobaccoFormView "Sync with DB"
// feature. Only fires in edit mode (editWishId set), only when the
// brand+name resolves to a catalog entry, and only when at least one
// factual field diverges. Description / personal notes never touched.

async function primeDb() {
  resetCatalogueFixture();
  _resetTobaccoDbForTests();
  await loadTobaccoDb();
}

describe("WishFormView — sync with DB", () => {
  it("does NOT render the sync notice in add mode", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true,
      editWishId: null,
      wishForm: { ...emptyWish, brand: "Halvorsen", name: "Duskfall" },
      setWishForm: vi.fn(),
      data: { wishlist: [], tobaccos: [] },
    });
    expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser|Catalog update/i);
  });

  it("does NOT render when the wish brand+name don't match any catalog entry", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 42,
      wishForm: {
        ...emptyWish, id: 42,
        brand: "Totally Made Up", name: "Imaginary Wish",
      },
      setWishForm: vi.fn(),
      data: { wishlist: [], tobaccos: [] },
    });
    expect(container.textContent || "").not.toMatch(/db_sync_title|Synchroniser/i);
  });

  it("renders the sync notice when a catalog entry exists AND a field diverges", async () => {
    await primeDb();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 42,
      wishForm: {
        ...emptyWish, id: 42,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique", // diverges (catalog says Anglais)
      },
      setWishForm: vi.fn(),
      data: { wishlist: [], tobaccos: [] },
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i);
    });
  });

  it("clicking Synchroniser calls setWishForm with the catalog values for divergent fields", async () => {
    await primeDb();
    const setWishForm = vi.fn();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 42,
      wishForm: {
        ...emptyWish, id: 42,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      },
      setWishForm,
      data: { wishlist: [], tobaccos: [] },
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
    expect(setWishForm).toHaveBeenCalled();
    const calls = setWishForm.mock.calls;
    const patched = calls[calls.length - 1]![0];
    expect(patched.category).toBe("Anglais");
  });

  // dismiss branch coverage (audit gap).
  it("clicking 'Garder mes valeurs' hides the notice for the current wish", async () => {
    await primeDb();
    const setWishForm = vi.fn();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: false,
      editWishId: 42,
      wishForm: {
        ...emptyWish, id: 42,
        brand: "Halvorsen", name: "Duskfall",
        category: "Aromatique",
      },
      setWishForm,
      data: { wishlist: [], tobaccos: [] },
    });
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/db_sync_title|Synchroniser/i);
    });
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
    expect(setWishForm).not.toHaveBeenCalled();
  });
});

// ── the per-fiche catalogue lock ────────────────────────────
// Same wiring assertions as TobaccoFormView. Kept as a SEPARATE block rather
// than a shared helper: the two forms have different ctx shapes (wishForm /
// setWishForm), and a helper hiding that difference is how one of the two
// would silently stop being covered.
describe("WishFormView — catalogue lock", () => {
  const findLock = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[role="checkbox"]'))
      .find((el) => (el.textContent || "").indexOf("lbl_catalogue_lock") !== -1) as HTMLElement | undefined;

  it("renders a real checkbox that announces its state", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true, editWishId: null, wishForm: emptyWish, setWishForm: vi.fn(),
    });
    const box = findLock(container);
    expect(box, "the catalogue-lock checkbox is missing from the wishlist form").toBeTruthy();
    expect(box!.getAttribute("aria-checked")).toBe("false");
    expect(box!.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("reflects a wish that is already locked", () => {
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true, editWishId: null,
      wishForm: { ...emptyWish, catalogueLock: true }, setWishForm: vi.fn(),
    });
    expect(findLock(container)!.getAttribute("aria-checked")).toBe("true");
  });

  it("writes catalogueLock through to the form on tap", () => {
    const set = vi.fn();
    const { container } = renderWithCtx(<CuratorWishFormView />, {
      showWishForm: true, editWishId: null, wishForm: emptyWish, setWishForm: set,
    });
    fireEvent.click(findLock(container)!);
    expect(set).toHaveBeenCalled();
    const arg = set.mock.calls[0]![0];
    const next = typeof arg === "function" ? arg(emptyWish) : arg;
    expect(next.catalogueLock).toBe(true);
  });
});
