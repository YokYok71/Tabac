import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWishStore } from "../hooks/useWishStore";
import { BW } from "../constants";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeWish(id: number, overrides: Record<string, any> = {}) {
  return Object.assign({}, BW, { id, name: "Wish " + id, brand: "Brand" + id }, overrides);
}

function makeData(overrides: Record<string, any> = {}) {
  return {
    wishlist: [],
    nxW: 1,
    ...overrides,
  };
}

function makeDeps(data: any, save = vi.fn(), nav = vi.fn()) {
  return {
    data,
    save,
    nav,
    setForm: vi.fn(),
    fromWishRef: { current: null } as { current: any },
    scrollSaveRef: { current: {} } as { current: Record<string, any> },
  };
}

// ── initial state ─────────────────────────────────────────────────────────────

describe("useWishStore — initial state", () => {
  it("starts with blank wishForm", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    expect(result.current.wishForm).toEqual(Object.assign({}, BW));
  });

  it("starts with editWishId = null", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    expect(result.current.editWishId).toBeNull();
  });

  it("starts with showWishForm = false", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    expect(result.current.showWishForm).toBe(false);
  });

  it("starts with wishGrouped = true", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    expect(result.current.wishGrouped).toBe(true);
  });
});

// ── addWish ───────────────────────────────────────────────────────────────────

describe("useWishStore — addWish", () => {
  it("does nothing when name is empty", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data, save, nav)));
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "" }));
    });
    act(() => {
      result.current.addWish();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("adds a wish with the correct id from nxW", () => {
    const save = vi.fn();
    const data = makeData({ nxW: 4 });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Brackwater" }));
    });
    act(() => {
      result.current.addWish();
    });
    expect(save).toHaveBeenCalledOnce();
    const saved = save.mock.calls[0]![0];
    expect(saved.wishlist).toHaveLength(1);
    expect(saved.wishlist[0].id).toBe(4);
    expect(saved.wishlist[0].name).toBe("Brackwater");
    expect(saved.nxW).toBe(5);
  });

  it("resets wishForm after adding", () => {
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Something" }));
    });
    act(() => {
      result.current.addWish();
    });
    expect(result.current.wishForm).toEqual(Object.assign({}, BW));
  });

  it("expands the new wish's brand group so it's visible on return", () => {
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Duskfall", brand: "Brackwater" }));
    });
    act(() => {
      result.current.addWish();
    });
    expect(result.current.collapsedWishGroups["Brackwater"]).toBe(false);
  });

  it("a BRAND-LESS wish expands the stable '' group (not the localized fallback)", () => {
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Mystery blend", brand: "" }));
    });
    act(() => {
      result.current.addWish();
    });
    // The view groups brand-less wishes under "" (localized only at display);
    // expanding "" here matches, so the added wish isn't hidden in a collapsed
    // group and read as a failed save.
    expect(result.current.collapsedWishGroups[""]).toBe(false);
  });

  it("does NOT touch collapsedWishGroups on the override (catalog) path", () => {
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.addWish({ name: "Duskfall", brand: "Brackwater" });
    });
    expect(result.current.collapsedWishGroups).toEqual({});
  });

  it("sets showWishForm to false after adding", () => {
    const data = makeData();
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.setShowWishForm(true);
      result.current.setWishForm(Object.assign({}, BW, { name: "Test" }));
    });
    act(() => {
      result.current.addWish();
    });
    expect(result.current.showWishForm).toBe(false);
  });
});

// ── updateWish ────────────────────────────────────────────────────────────────

describe("useWishStore — updateWish", () => {
  it("updates the correct wish by editWishId", () => {
    const save = vi.fn();
    const wish1 = makeWish(1);
    const wish2 = makeWish(2);
    const data = makeData({ wishlist: [wish1, wish2] });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));
    act(() => {
      result.current.setEditWishId(2);
      result.current.setWishForm(Object.assign({}, BW, { name: "Updated Wish", brand: "NewBrand" }));
    });
    act(() => {
      result.current.updateWish();
    });
    const saved = save.mock.calls[0]![0];
    const updated = saved.wishlist.find((w: any) => w.id === 2);
    expect(updated.name).toBe("Updated Wish");
    expect(updated.brand).toBe("NewBrand");
    // wish1 untouched
    expect(saved.wishlist.find((w: any) => w.id === 1).name).toBe("Wish 1");
  });

  it("does nothing when wishForm name is empty", () => {
    const save = vi.fn();
    const data = makeData({ wishlist: [makeWish(1)] });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));
    act(() => {
      result.current.setEditWishId(1);
      result.current.setWishForm(Object.assign({}, BW, { name: "" }));
    });
    act(() => {
      result.current.updateWish();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("resets wishForm, editWishId, and showWishForm after update", () => {
    const data = makeData({ wishlist: [makeWish(1)] });
    const { result } = renderHook(() => useWishStore(makeDeps(data)));
    act(() => {
      result.current.setEditWishId(1);
      result.current.setWishForm(Object.assign({}, BW, { name: "Modified" }));
      result.current.setShowWishForm(true);
    });
    act(() => {
      result.current.updateWish();
    });
    expect(result.current.wishForm).toEqual(Object.assign({}, BW));
    expect(result.current.editWishId).toBeNull();
    expect(result.current.showWishForm).toBe(false);
  });
});

// ── delWish ───────────────────────────────────────────────────────────────────

describe("useWishStore — delWish", () => {
  // soft-delete — row stays but gets `deletedAt`.
  it("marks the wish deleted (soft-delete) without removing it", () => {
    const save = vi.fn();
    const wish1 = makeWish(1);
    const wish2 = makeWish(2);
    const data = makeData({ wishlist: [wish1, wish2] });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));
    act(() => {
      result.current.delWish(1);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.wishlist).toHaveLength(2);
    const w1 = saved.wishlist.find((w: any) => w.id === 1);
    const w2 = saved.wishlist.find((w: any) => w.id === 2);
    expect(w1.deletedAt).toMatch(/^\d{4}-/);
    expect(w2.deletedAt).toBeUndefined();
  });

  it("does nothing when id is not found (list unchanged)", () => {
    const save = vi.fn();
    const wish1 = makeWish(1);
    const data = makeData({ wishlist: [wish1] });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));
    act(() => {
      result.current.delWish(999);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.wishlist).toHaveLength(1);
  });
});

// ── wishToInv ─────────────────────────────────────────────────────────────────

describe("useWishStore — wishToInv", () => {
  it("pre-fills tobacco form with wish fields", () => {
    const setForm = vi.fn();
    const nav = vi.fn();
    const wish = makeWish(3, {
      name: "Regent Mixture",
      brand: "Brackwater",
      category: "Anglais",
      blend: "Latakia base",
      cut: "Ribbon",
      force: 3,
      roomNote: 2,
      taste: 4,
      tastingNotes: "Smoky, sweet",
      description: "Classic blend",
      imageUrl: "https://example.com/img.jpg",
      agingMax: "10",
    });
    const data = makeData({ wishlist: [wish] });
    const deps = makeDeps(data, vi.fn(), nav);
    deps.setForm = setForm;
    const { result } = renderHook(() => useWishStore(deps));
    act(() => {
      result.current.wishToInv(wish);
    });
    expect(setForm).toHaveBeenCalledOnce();
    const formArg = setForm.mock.calls[0]![0];
    expect(formArg.name).toBe("Regent Mixture");
    expect(formArg.brand).toBe("Brackwater");
    expect(formArg.category).toBe("Anglais");
    expect(formArg.blend).toBe("Latakia base");
    expect(formArg.cut).toBe("Ribbon");
    expect(formArg.force).toBe(3);
    expect(formArg.roomNote).toBe(2);
    expect(formArg.taste).toBe(4);
    expect(formArg.tastingNotes).toBe("Smoky, sweet");
    expect(formArg.description).toBe("Classic blend");
    expect(formArg.imageUrl).toBe("https://example.com/img.jpg");
    expect(formArg.agingMax).toBe("10");
  });

  it("navigates to 'addT' view", () => {
    const nav = vi.fn();
    const wish = makeWish(1);
    const data = makeData({ wishlist: [wish] });
    const deps = makeDeps(data, vi.fn(), nav);
    const { result } = renderHook(() => useWishStore(deps));
    act(() => {
      result.current.wishToInv(wish);
    });
    expect(nav).toHaveBeenCalledWith("addT");
  });

  it("stores wish id in fromWishRef", () => {
    const wish = makeWish(7);
    const data = makeData({ wishlist: [wish] });
    const deps = makeDeps(data);
    const { result } = renderHook(() => useWishStore(deps));
    act(() => {
      result.current.wishToInv(wish);
    });
    expect(deps.fromWishRef.current).toBe(7);
  });

  it("does NOT delete the wish immediately (deletion is deferred)", () => {
    const save = vi.fn();
    const wish = makeWish(5);
    const data = makeData({ wishlist: [wish] });
    const deps = makeDeps(data, save);
    const { result } = renderHook(() => useWishStore(deps));
    act(() => {
      result.current.wishToInv(wish);
    });
    // save should NOT have been called with a removed wish
    // (either not called at all, or called without filtering the wish out)
    if (save.mock.calls.length > 0) {
      const saved = save.mock.calls[0]![0];
      const wishStillPresent = (saved.wishlist || []).some((w: any) => w.id === 5);
      expect(wishStillPresent).toBe(true);
    } else {
      // save not called at all — also correct, wish preserved
      expect(save).not.toHaveBeenCalled();
    }
  });

  it("handles wish with missing optional fields gracefully", () => {
    const setForm = vi.fn();
    const wish = { id: 1, name: "Simple Wish" };
    const data = makeData({ wishlist: [wish] });
    const deps = makeDeps(data);
    deps.setForm = setForm;
    const { result } = renderHook(() => useWishStore(deps));
    act(() => {
      result.current.wishToInv(wish);
    });
    const formArg = setForm.mock.calls[0]![0];
    expect(formArg.name).toBe("Simple Wish");
    expect(formArg.brand).toBe("");
    expect(formArg.force).toBe(0);
    expect(formArg.agingMax).toBe("");
  });
});

// ── toggleWishGroup ───────────────────────────────────────────────────────────

describe("useWishStore — toggleWishGroup", () => {
  it("expands a collapsed group (absent → false)", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    expect(result.current.collapsedWishGroups["Brackwater"]).toBeUndefined();
    act(() => {
      result.current.toggleWishGroup("Brackwater");
    });
    expect(result.current.collapsedWishGroups["Brackwater"]).toBe(false);
  });

  it("collapses an expanded group (false → absent)", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    act(() => {
      result.current.toggleWishGroup("Brackwater");
    });
    act(() => {
      result.current.toggleWishGroup("Brackwater");
    });
    expect("Brackwater" in result.current.collapsedWishGroups).toBe(false);
  });

  it("does not affect other groups", () => {
    const { result } = renderHook(() => useWishStore(makeDeps(makeData())));
    act(() => {
      result.current.toggleWishGroup("Brackwater");
    });
    expect(result.current.collapsedWishGroups["Halvorsen"]).toBeUndefined();
  });
});

// ── addWish(override) — one-tap add from the catalog ─────────────────────────
// CatalogView calls addWish(prefilledEntry) so the user doesn't open the
// wishlist form (which on mobile rendered as a sibling below the catalog and
// stayed offscreen). The override path must NOT touch internal wishForm or
// showWishForm state, while still creating a valid entry and bumping nxW.

describe("useWishStore — addWish(override) one-tap add", () => {
  it("creates the wish from the override and bumps nxW", () => {
    const save = vi.fn();
    const data = makeData({ nxW: 5 });
    const { result } = renderHook(() => useWishStore(makeDeps(data, save)));

    const prefilled = Object.assign({}, BW, {
      brand: "Cranmere",
      name: "Tidewalk",
      category: "VaPer",
      cut: "Broken Flake",
      force: 3,
      roomNote: 3,
      taste: 4,
    });

    act(() => { result.current.addWish(prefilled); });

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.wishlist).toHaveLength(1);
    expect(saved.wishlist[0].id).toBe(5);
    expect(saved.wishlist[0].brand).toBe("Cranmere");
    expect(saved.wishlist[0].name).toBe("Tidewalk");
    expect(saved.nxW).toBe(6);
  });

  it("does not flip showWishForm or reset wishForm when given an override", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useWishStore(makeDeps(makeData(), save)));

    // Seed internal state so we can prove it survives the override call.
    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Mid-edit draft" }));
      result.current.setShowWishForm(true);
    });

    act(() => {
      result.current.addWish(Object.assign({}, BW, { name: "Catalog blend", brand: "GLP" }));
    });

    // Override path mustn't tear down the user's parallel form session.
    expect(result.current.showWishForm).toBe(true);
    expect(result.current.wishForm.name).toBe("Mid-edit draft");
  });

  it("legacy form-based call still resets wishForm and closes the overlay", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useWishStore(makeDeps(makeData(), save)));

    act(() => {
      result.current.setWishForm(Object.assign({}, BW, { name: "Form-driven add" }));
      result.current.setShowWishForm(true);
    });
    act(() => { result.current.addWish(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].wishlist[0].name).toBe("Form-driven add");
    expect(result.current.showWishForm).toBe(false);
    expect(result.current.wishForm).toEqual(Object.assign({}, BW));
  });

  it("ignores override without name (defence-in-depth)", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useWishStore(makeDeps(makeData(), save)));

    act(() => { result.current.addWish(Object.assign({}, BW, { brand: "Halvorsen" })); });
    expect(save).not.toHaveBeenCalled();
  });
});
