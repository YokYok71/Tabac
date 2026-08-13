import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccessoryStore } from "../hooks/useAccessoryStore";
import { BA } from "../constants";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAcc(id: number, overrides: Record<string, any> = {}) {
  return Object.assign({}, BA, { id, name: "Acc " + id, brand: "Brand" + id, status: "active" }, overrides);
}

function makeData(overrides: Record<string, any> = {}) {
  return {
    accessories: [],
    nxA: 1,
    ...overrides,
  };
}

function makeDeps(data: any, save = vi.fn(), nav = vi.fn()) {
  return { data, save, nav };
}

// ── initial state ─────────────────────────────────────────────────────────────

describe("useAccessoryStore — initial state", () => {
  it("starts with blank accForm", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.accForm).toEqual(Object.assign({}, BA));
  });

  it("starts with accDet = null", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.accDet).toBeNull();
  });

  it("starts with editAccId = null", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.editAccId).toBeNull();
  });

  it("starts with showRetiredAcc = false", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.showRetiredAcc).toBe(false);
  });

  it("starts with accsGrouped = true", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.accsGrouped).toBe(true);
  });

  it("starts with collapsedAccGroups = {}", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.collapsedAccGroups).toEqual({});
  });
});

// ── addAccessory ──────────────────────────────────────────────────────────────

describe("useAccessoryStore — addAccessory", () => {
  it("does nothing when name and brand are both empty", () => {
    const save = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "", brand: "" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("adds an accessory when name is provided", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ nxA: 3 });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save, nav)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Zippo", brand: "" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(save).toHaveBeenCalledOnce();
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories).toHaveLength(1);
    expect(saved.accessories[0].id).toBe(3);
    expect(saved.accessories[0].name).toBe("Zippo");
    expect(saved.nxA).toBe(4);
  });

  it("expands the new accessory's TYPE group so it's visible on return", () => {
    const data = makeData({ nxA: 1 });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Zippo", type: "Briquet" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(result.current.collapsedAccGroups["Briquet"]).toBe(false);
  });

  it("expands the 'Autre' group when the accessory has no type", () => {
    const data = makeData({ nxA: 1 });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Truc", type: "" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(result.current.collapsedAccGroups["Autre"]).toBe(false);
  });

  it("adds an accessory when brand is provided (no name)", () => {
    const save = vi.fn();
    const data = makeData({ nxA: 1 });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "", brand: "Halvorsen" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it("navigates to 'acc' after adding", () => {
    const nav = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, vi.fn(), nav)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Tamper" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(nav).toHaveBeenCalledWith("acc", { restoreScroll: true });
  });

  it("resets accForm after adding", () => {
    const data = makeData();
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Pouch", brand: "Stanwell" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(result.current.accForm).toEqual(Object.assign({}, BA));
  });

  it("sets status to 'active' when status is missing", () => {
    const save = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Lighter", status: "" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories[0].status).toBe("active");
  });

  it("increments nxA counter", () => {
    const save = vi.fn();
    const data = makeData({ nxA: 9 });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.setAccForm(Object.assign({}, BA, { name: "Stand" }));
    });
    act(() => {
      result.current.addAccessory();
    });
    expect(save.mock.calls[0]![0].nxA).toBe(10);
  });
});

// ── updateAccessory ───────────────────────────────────────────────────────────

describe("useAccessoryStore — updateAccessory", () => {
  it("updates the correct accessory by editAccId", () => {
    const save = vi.fn();
    const acc1 = makeAcc(1);
    const acc2 = makeAcc(2);
    const data = makeData({ accessories: [acc1, acc2] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.setEditAccId(2);
      result.current.setAccForm(Object.assign({}, BA, { name: "Updated Acc", brand: "NewBrand" }));
    });
    act(() => {
      result.current.updateAccessory();
    });
    const saved = save.mock.calls[0]![0];
    const updated = saved.accessories.find((a: any) => a.id === 2);
    expect(updated.name).toBe("Updated Acc");
    expect(updated.brand).toBe("NewBrand");
    // acc1 untouched
    expect(saved.accessories.find((a: any) => a.id === 1).name).toBe("Acc 1");
  });

  it("resets editAccId and accForm after update", () => {
    const data = makeData({ accessories: [makeAcc(1)] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setEditAccId(1);
      result.current.setAccForm(Object.assign({}, BA, { name: "Modified" }));
    });
    act(() => {
      result.current.updateAccessory();
    });
    expect(result.current.editAccId).toBeNull();
    expect(result.current.accForm).toEqual(Object.assign({}, BA));
  });

  it("navigates to 'acc' after update", () => {
    const nav = vi.fn();
    const data = makeData({ accessories: [makeAcc(1)] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, vi.fn(), nav)));
    act(() => {
      result.current.setEditAccId(1);
      // update requires name or brand (mirrors addAccessory's guard)
      result.current.setAccForm(Object.assign({}, BA, { name: "Zippo" }));
    });
    act(() => {
      result.current.updateAccessory();
    });
    expect(nav).toHaveBeenCalledWith("acc", { restoreScroll: true });
  });
});

// ── deleteAccessory ───────────────────────────────────────────────────────────

describe("useAccessoryStore — deleteAccessory", () => {
  // soft-delete — row stays but gets `deletedAt`.
  it("marks the accessory deleted (soft-delete) without removing it", () => {
    const save = vi.fn();
    const acc1 = makeAcc(1);
    const acc2 = makeAcc(2);
    const data = makeData({ accessories: [acc1, acc2] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.deleteAccessory(1);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories).toHaveLength(2);
    const a1 = saved.accessories.find((a: any) => a.id === 1);
    const a2 = saved.accessories.find((a: any) => a.id === 2);
    expect(a1.deletedAt).toMatch(/^\d{4}-/);
    expect(a2.deletedAt).toBeUndefined();
  });

  it("clears accDet when the deleted accessory is the current detail", () => {
    const acc1 = makeAcc(1);
    const data = makeData({ accessories: [acc1] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setAccDet(acc1);
    });
    act(() => {
      result.current.deleteAccessory(1);
    });
    expect(result.current.accDet).toBeNull();
  });

  it("does not clear accDet when a different accessory is deleted", () => {
    const acc1 = makeAcc(1);
    const acc2 = makeAcc(2);
    const data = makeData({ accessories: [acc1, acc2] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.setAccDet(acc1);
    });
    act(() => {
      result.current.deleteAccessory(2);
    });
    expect(result.current.accDet).toEqual(acc1);
  });
});

// ── changeAccStatus ───────────────────────────────────────────────────────────

describe("useAccessoryStore — changeAccStatus", () => {
  it("changes status from active to retired", () => {
    const save = vi.fn();
    const acc = makeAcc(1, { status: "active" });
    const data = makeData({ accessories: [acc] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.changeAccStatus(1, "retired");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories[0].status).toBe("retired");
  });

  it("changes status from retired back to active", () => {
    const save = vi.fn();
    const acc = makeAcc(1, { status: "retired" });
    const data = makeData({ accessories: [acc] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.changeAccStatus(1, "active");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories[0].status).toBe("active");
  });

  it("does not touch other accessories", () => {
    const save = vi.fn();
    const acc1 = makeAcc(1, { status: "active" });
    const acc2 = makeAcc(2, { status: "active" });
    const data = makeData({ accessories: [acc1, acc2] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data, save)));
    act(() => {
      result.current.changeAccStatus(1, "retired");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.accessories[1].status).toBe("active");
  });

  it("updates accDet to the updated accessory", () => {
    const acc = makeAcc(1, { status: "active" });
    const data = makeData({ accessories: [acc] });
    const { result } = renderHook(() => useAccessoryStore(makeDeps(data)));
    act(() => {
      result.current.changeAccStatus(1, "retired");
    });
    expect(result.current.accDet?.status).toBe("retired");
  });
});

// ── toggleAccGroup ────────────────────────────────────────────────────────────

describe("useAccessoryStore — toggleAccGroup", () => {
  it("expands a collapsed group (absent → false)", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    expect(result.current.collapsedAccGroups["Briquet"]).toBeUndefined();
    act(() => {
      result.current.toggleAccGroup("Briquet");
    });
    expect(result.current.collapsedAccGroups["Briquet"]).toBe(false);
  });

  it("collapses an expanded group (false → absent)", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    act(() => {
      result.current.toggleAccGroup("Briquet");
    });
    act(() => {
      result.current.toggleAccGroup("Briquet");
    });
    expect("Briquet" in result.current.collapsedAccGroups).toBe(false);
  });

  it("does not affect other groups", () => {
    const { result } = renderHook(() => useAccessoryStore(makeDeps(makeData())));
    act(() => {
      result.current.toggleAccGroup("Briquet");
    });
    expect(result.current.collapsedAccGroups["Bourre-pipe"]).toBeUndefined();
  });
});
