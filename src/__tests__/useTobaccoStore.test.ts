import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTobaccoStore } from "../hooks/useTobaccoStore";
import { BT, BL } from "../constants";
import { countActive, hasActive, isUntrackedWeight } from "../utils";
import { isUsableLot, stepApplyDelta, stepAutoFinish } from "../utils/lotUtils";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeLot(overrides: Record<string, any> = {}) {
  return {
    id: String(Math.random()),
    status: "cellar" as const,
    weightG: "50",
    datePurchased: "",
    dateProduction: "",
    dateOpened: "",
    dateFinished: "",
    boxNumber: "",
    price: "",
    seller: "",
    disposed: false,
    ...overrides,
  };
}

function makeTob(id: number, lots: any[] = [], overrides: Record<string, any> = {}) {
  return { id, name: "Tabac " + id, brand: "Brand", lots, ...overrides };
}

function makeData(overrides: Record<string, any> = {}) {
  return {
    tobaccos: [],
    wishlist: [],
    sessions: [],
    nxT: 1,
    ...overrides,
  };
}

function makeDeps(data: any, save = vi.fn(), nav = vi.fn()) {
  return {
    data,
    save,
    nav,
    setView: vi.fn(),
    setSearch: vi.fn(),
    fromWishRef: { current: null } as React.MutableRefObject<any>,
  };
}

// ── removeLot — core focus ────────────────────────────────────────────────────
// removeLot is now a soft-delete. It stamps `deletedAt` on the
// targeted lot instead of removing it. Sessions referencing the lot are
// left untouched (lotId still points at the trashed lot, so a restore
// re-attaches them automatically). Permanent deletion is the Trash UI's
// job (`permanentlyDelete("lot", id)` in App.tsx); it both hard-removes
// the lot and orphanises the referencing sessions like the old hard
// removeLot used to.

describe("useTobaccoStore — removeLot", () => {
  it("soft-deletes the lot at the given index (stamps deletedAt, keeps row)", () => {
    const lot0 = makeLot({ id: "L1" });
    const lot1 = makeLot({ id: "L2" });
    const tob = makeTob(1, [lot0, lot1]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L1"); });

    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots).toHaveLength(2);
    expect(saved.tobaccos[0].lots[0].id).toBe("L1");
    expect(saved.tobaccos[0].lots[0].deletedAt).toMatch(/^\d{4}-/);
    expect(saved.tobaccos[0].lots[1].id).toBe("L2");
    expect(saved.tobaccos[0].lots[1].deletedAt).toBeUndefined();
  });

  it("does NOT orphanise sessions on soft-delete (lotId still points at the trashed lot)", () => {
    // Restore should re-attach them cleanly. Permanent deletion (Trash UI)
    // is where the orphanisation kicks in.
    const lot = makeLot({ id: "L10" });
    const tob = makeTob(1, [lot]);
    const sessions = [
      { id: 100, tobaccoId: 1, lotId: "L10", weightG: "5", date: "2025-01-01" },
      { id: 101, tobaccoId: 1, lotId: "L10", weightG: "3", date: "2025-02-01" },
    ];
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob], sessions });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L10"); });

    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].lotId).toBe("L10");
    expect(saved.sessions[1].lotId).toBe("L10");
  });

  it("preserves weightG on sessions (no weight restore on soft-delete)", () => {
    const lot = makeLot({ id: "L10" });
    const tob = makeTob(1, [lot]);
    const sessions = [
      { id: 100, tobaccoId: 1, lotId: "L10", weightG: "5", date: "2025-01-01" },
    ];
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob], sessions });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L10"); });

    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].weightG).toBe("5");
  });

  it("does not touch sessions referencing a different lot", () => {
    const lot0 = makeLot({ id: "L10" });
    const lot1 = makeLot({ id: "L20" });
    const tob = makeTob(1, [lot0, lot1]);
    const sessions = [
      { id: 100, tobaccoId: 1, lotId: "L20", weightG: "5", date: "2025-01-01" },
    ];
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob], sessions });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L10"); }); // soft-deletes L10

    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].lotId).toBe("L20"); // untouched
  });

  it("updates detail state with the lot stripped (live-view consistent)", () => {
    // The detail view consumes liveData semantics: deletedAt lots are
    // not rendered. removeLot mirrors that stripping when refreshing
    // the local `detail` state so the row disappears immediately even
    // though it stays in the persisted data.
    const lot0 = makeLot({ id: "L1" });
    const lot1 = makeLot({ id: "L2" });
    const tob = makeTob(1, [lot0, lot1]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L2"); });

    expect(result.current.detail).not.toBeNull();
    expect(result.current.detail.lots).toHaveLength(1);
    expect(result.current.detail.lots[0].id).toBe("L1");
  });

  it("only soft-deletes the lot at the targeted index", () => {
    const lots = [
      makeLot({ id: "A" }),
      makeLot({ id: "B" }),
      makeLot({ id: "C" }),
    ];
    const tob = makeTob(1, lots);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "B"); }); // target B

    const saved = save.mock.calls[0]![0];
    const ids = saved.tobaccos[0].lots.map((l: any) => l.id);
    expect(ids).toEqual(["A", "B", "C"]); // none removed
    expect(saved.tobaccos[0].lots[0].deletedAt).toBeUndefined();
    expect(saved.tobaccos[0].lots[1].deletedAt).toMatch(/^\d{4}-/); // B trashed
    expect(saved.tobaccos[0].lots[2].deletedAt).toBeUndefined();
  });

  it("does not affect other tobaccos", () => {
    const lot = makeLot({ id: "L1" });
    const tob1 = makeTob(1, [lot]);
    const tob2 = makeTob(2, [makeLot({ id: "L2" })]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob1, tob2] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => { result.current.removeLot(1, "L1"); });

    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[1].lots).toHaveLength(1);
    expect(saved.tobaccos[1].lots[0].deletedAt).toBeUndefined(); // tob2 untouched
  });
});

// ── addTobacco ────────────────────────────────────────────────────────────────

describe("useTobaccoStore — addTobacco", () => {
  it("does nothing when name is empty", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData(), save)));
    act(() => { result.current.addTobacco(); });
    expect(save).not.toHaveBeenCalled();
  });

  it("updateTobacco does NOT persist a cleared name/brand (back-guard HIGH)", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ tobaccos: [{ id: 1, name: "Duskfall", brand: "Brackwater", lots: [] }] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save, nav)));
    act(() => {
      result.current.setEditId(1);
      // user cleared the name (canSave greyed out, but the back-guard Enregistrer
      // calls updateTobacco directly without re-checking canSave)
      result.current.setForm((f: any) => ({ ...f, id: 1, name: "", brand: "Brackwater" }));
    });
    act(() => { result.current.updateTobacco(); });
    expect(save).not.toHaveBeenCalled(); // no nameless entity persisted
    expect(nav).not.toHaveBeenCalled();  // and no navigate-away "it saved" illusion
  });

  it("saves tobacco with incremented id and navigates to inv", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ tobaccos: [], nxT: 3 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save, nav)));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].id).toBe(3);
    expect(saved.nxT).toBe(4);
    expect(nav).toHaveBeenCalledWith("inv", { restoreScroll: true });
  });

  it("mints a stable cross-device uid at creation", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [], nxT: 1 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    const saved = save.mock.calls[0]![0];
    expect(typeof saved.tobaccos[0].uid).toBe("string");
    expect(saved.tobaccos[0].uid.length).toBeGreaterThan(0);
  });

  it("expands the new tobacco's brand group so it's visible on return", () => {
    const data = makeData({ nxT: 1 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data)));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    expect(result.current.collapsedTobGroups["Brackwater"]).toBe(false);
  });

  it("does NOT touch collapsedTobGroups on the override (catalog) path", () => {
    const data = makeData({ nxT: 1 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data)));
    act(() => { result.current.addTobacco({ name: "X", brand: "Y", lots: [] }); });
    expect(result.current.collapsedTobGroups).toEqual({});
  });

  it("numbers the starter lot to max box + 1 when the user already numbers boxes", () => {
    const save = vi.fn();
    // An existing tobacco carries a numeric box number 5.
    const data = makeData({ nxT: 2, tobaccos: [makeTob(1, [{ id: "L1", boxNumber: "5", status: "cellar", weightG: "50", weightInitial: "50" }])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    const saved = save.mock.calls[0]![0];
    const newTob = saved.tobaccos.find((t: any) => t.name === "Duskfall");
    expect(newTob.lots[0].boxNumber).toBe("6");
  });

  it("leaves the starter lot box number empty when the user doesn't number boxes", () => {
    const save = vi.fn();
    const data = makeData({ nxT: 1 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].boxNumber).toBe("");
  });

  it("removes the wishlist item when fromWishRef is set", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const wishItem = { id: 99, name: "Wish" };
    const data = makeData({ wishlist: [wishItem] });
    const deps = makeDeps(data, save, nav);
    deps.fromWishRef.current = 99;
    const { result } = renderHook(() => useTobaccoStore(deps));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    const saved = save.mock.calls[0]![0];
    expect(saved.wishlist).toHaveLength(0);
    expect(deps.fromWishRef.current).toBeNull();
  });

  it("resets form after save", () => {
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData())));
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    expect(result.current.form).toEqual(Object.assign({}, BT));
  });
});

// ── addLotToTobacco — origin status clamp ─────────────────────────────────────

describe("useTobaccoStore — addLotToTobacco status clamp", () => {
  it("clamps status:'finished' to 'cellar' at creation (defence in depth)", () => {
    // The UI form hides the "finished" option from the creation picker,
    // but a programmatic caller (import, fixture, future helper) could
    // still slip one through. addLotToTobacco must clamp it so the rest
    // of the pipeline can rely on `created lot.status ∈ {cellar, jar}`.
    const save = vi.fn();
    const tob = makeTob(1, []);
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, {
        status: "finished",
        weightG: "50",
        weightInitial: "50",
      }));
    });
    const saved = save.mock.calls[0]![0];
    const created = saved.tobaccos[0].lots[0];
    expect(created.status).toBe("cellar");
    expect(created.originalStatus).toBe("cellar");
    expect(created.dateFinished).toBeFalsy();
  });

  // Every created lot carries a stable cross-device uid; bulk-added
  // clones each get their OWN distinct uid (distinct physical tins).
  it("stamps a distinct uid on each bulk-added lot", () => {
    const save = vi.fn();
    const tob = makeTob(1, []);
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { status: "cellar", weightG: "50", weightInitial: "50", boxNumber: "1" }), 3);
    });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.length).toBe(3);
    const uids = lots.map((l: any) => l.uid);
    expect(uids.every((u: string) => typeof u === "string" && u.length > 0)).toBe(true);
    expect(new Set(uids).size).toBe(3); // all distinct
  });

  it("preserves status:'jar' at creation and stamps dateOpened", () => {
    // LotFormModal is responsible for mirroring status → originalStatus
    // at creation; addLotToTobacco only fills originalStatus when the
    // caller left it blank. We pass it explicitly here so the assertion
    // matches the production form flow.
    const save = vi.fn();
    const tob = makeTob(1, []);
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, {
        status: "jar",
        originalStatus: "jar",
        weightG: "50",
        weightInitial: "50",
      }));
    });
    const created = save.mock.calls[0]![0].tobaccos[0].lots[0];
    expect(created.status).toBe("jar");
    expect(created.originalStatus).toBe("jar");
    expect(created.dateOpened).toBeTruthy();
  });
});

// ── addLotToTobacco — bulk create ─────────────────────────────────

describe("useTobaccoStore — addLotToTobacco bulk create", () => {
  it("creates one lot when count is omitted (backward compatible)", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1, [])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50" }));
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots).toHaveLength(1);
  });

  it("creates N identical lots, each with a distinct id, in one save", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1, [])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50", boxNumber: "" }), 3);
    });
    expect(save).toHaveBeenCalledTimes(1);
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots).toHaveLength(3);
    const ids = lots.map((l: any) => l.id);
    expect(new Set(ids).size).toBe(3);
    // Same weight on every clone.
    expect(lots.every((l: any) => l.weightInitial === "50")).toBe(true);
  });

  it("increments a NUMERIC box number across the clones", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1, [])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50", boxNumber: "5" }), 3);
    });
    const boxes = save.mock.calls[0]![0].tobaccos[0].lots.map((l: any) => l.boxNumber);
    expect(boxes).toEqual(["5", "6", "7"]);
  });

  it("copies a NON-numeric box number verbatim on every clone", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1, [])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50", boxNumber: "B-2017" }), 2);
    });
    const boxes = save.mock.calls[0]![0].tobaccos[0].lots.map((l: any) => l.boxNumber);
    expect(boxes).toEqual(["B-2017", "B-2017"]);
  });

  it("clamps count to 1..50", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1, [])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50" }), 999);
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots).toHaveLength(50);
  });
});

// ── deleteTobacco ─────────────────────────────────────────────────────────────

describe("useTobaccoStore — deleteTobacco", () => {
  // deleteTobacco now soft-deletes (sets `deletedAt`)
  // instead of removing the row. The row stays in the array — the
  // ctx layer filters it out for views, the Trash UI surfaces it
  // for 30 days, then the startup cleanup hard-removes it.
  it("marks the tobacco deleted (soft-delete) without removing it", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1), makeTob(2)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.deleteTobacco(1); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos).toHaveLength(2);
    const t1 = saved.tobaccos.find((t: any) => t.id === 1);
    const t2 = saved.tobaccos.find((t: any) => t.id === 2);
    expect(t1.deletedAt).toMatch(/^\d{4}-/);
    expect(t2.deletedAt).toBeUndefined();
  });

  it("clears detail when deleted tobacco is currently displayed", () => {
    const save = vi.fn();
    const tob = makeTob(1);
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.setDetail(tob); });
    act(() => { result.current.deleteTobacco(1); });
    expect(result.current.detail).toBeNull();
  });

  it("does not clear detail when a different tobacco is deleted", () => {
    const save = vi.fn();
    const tob1 = makeTob(1);
    const tob2 = makeTob(2);
    const data = makeData({ tobaccos: [tob1, tob2] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.setDetail(tob1); });
    act(() => { result.current.deleteTobacco(2); });
    expect(result.current.detail).not.toBeNull();
    expect(result.current.detail.id).toBe(1);
  });

  // refresh the snapshot on every referencing session
  // BEFORE the tabac drops out of liveData. Without this, a session
  // logged against the old name / image keeps showing the stale
  // snapshot in the journal as soon as the tabac is soft-deleted.
  it("refreshes tobaccoSnapshot on referencing sessions with the tabac's CURRENT state", () => {
    const save = vi.fn();
    const tob = makeTob(1, [], {
      brand: "Brackwater", name: "DuskfallV2",          // renamed
      imageUrl: "local-photo-new",                    // re-imaged
    });
    const sessions = [
      // Session was logged when tabac was {Brackwater, Duskfall, local-photo-old}.
      { id: 100, tobaccoId: 1, pipeId: "", lotId: "",
        date: "2025-01-01", duration: "30", weightG: "0",
        tobaccoSnapshot: { brand: "Brackwater", name: "Duskfall",
                           imageUrl: "local-photo-old" } },
    ];
    const data = makeData({ tobaccos: [tob], sessions });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.deleteTobacco(1); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].tobaccoSnapshot).toEqual({
      brand: "Brackwater", name: "DuskfallV2", imageUrl: "local-photo-new",
    });
  });

  it("does not touch sessions that don't reference the deleted tabac", () => {
    const save = vi.fn();
    const tob1 = makeTob(1, [], { brand: "X", name: "Y" });
    const tob2 = makeTob(2, [], { brand: "Z", name: "W" });
    const sessions = [
      { id: 100, tobaccoId: 2, date: "2025-01-01",
        tobaccoSnapshot: { brand: "Z", name: "W", imageUrl: "" } },
    ];
    const data = makeData({ tobaccos: [tob1, tob2], sessions });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.deleteTobacco(1); });
    const saved = save.mock.calls[0]![0];
    // Session referencing tob2 unchanged.
    expect(saved.sessions[0].tobaccoSnapshot).toEqual({
      brand: "Z", name: "W", imageUrl: "",
    });
  });
});

// ── changeLotStatus ───────────────────────────────────────────────────────────

describe("useTobaccoStore — changeLotStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("updates lot status", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1", status: "cellar" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
  });

  it("auto-fills dateOpened when transitioning to jar (if not already set)", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1", status: "cellar", dateOpened: "" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateOpened).toBe("2025-06-15");
  });

  it("preserves existing dateOpened when already set", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1", status: "cellar", dateOpened: "2025-01-01" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateOpened).toBe("2025-01-01");
  });

  it("auto-fills dateFinished when transitioning to finished", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1", status: "jar", dateFinished: "" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "finished"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("2025-06-15");
  });

  it("clears dateFinished when transitioning to a non-finished status", () => {
    const lot = makeLot({ id: "L1", status: "finished", dateFinished: "2025-03-01" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("");
  });

  it("does not affect other lots in the same tobacco", () => {
    const lot0 = makeLot({ id: "L1", status: "cellar" });
    const lot1 = makeLot({ id: "L2", status: "cellar" });
    const tob = makeTob(1, [lot0, lot1]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[1].status).toBe("cellar");
  });

  // Réactiver button: finished → jar
  it("reactivation finished→jar preserves existing dateOpened", () => {
    // Lot was opened on 2025-01-01, then finished, then user reactivates it
    // The original dateOpened must survive — the Réactiver button passes status:"jar"
    const lot = makeLot({ id: "L1", status: "finished", dateOpened: "2025-01-01", dateFinished: "2025-06-01" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "jar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].status).toBe("jar");
    expect(saved.tobaccos[0].lots[0].dateOpened).toBe("2025-01-01"); // preserved
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("");          // cleared
  });

  it("reactivation finished→cellar does not set dateOpened", () => {
    // Lot was never opened (went cellar→finished directly), reactivated to cellar
    const lot = makeLot({ id: "L1", status: "finished", dateOpened: "", dateFinished: "2025-06-01" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.changeLotStatus(1, "L1", "cellar"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].status).toBe("cellar");
    expect(saved.tobaccos[0].lots[0].dateOpened).toBe(""); // never set
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("");
  });
});

// ── updateLotInTobacco ────────────────────────────────────────────────────────

describe("useTobaccoStore — updateLotInTobacco", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("updates the lot at the given index from lotForm", () => {
    const lot = makeLot({ id: "L1", weightG: "100" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.setLotForm((f: any) => ({ ...f, weightG: "80", status: "jar" }));
    });
    act(() => { result.current.updateLotInTobacco(1, "L1"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].weightG).toBe("80");
  });

  it("force-stamps the lot id even when the override omits it", () => {
    const lot = makeLot({ id: "L1", weightG: "100" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    // A partial override with NO id — the store must preserve the target id.
    act(() => { result.current.updateLotInTobacco(1, "L1", { status: "jar", weightG: "40", weightInitial: "50" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].id).toBe("L1");
    expect(saved.tobaccos[0].lots[0].weightG).toBe("40");
  });

  it("auto-fills dateOpened when status is jar and dateOpened is empty", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.setLotForm((f: any) => ({ ...f, status: "jar", dateOpened: "" }));
    });
    act(() => { result.current.updateLotInTobacco(1, "L1"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateOpened).toBe("2025-06-15");
  });

  it("auto-fills dateFinished when status is finished and dateFinished is empty", () => {
    vi.setSystemTime(new Date("2025-06-15"));
    const lot = makeLot({ id: "L1" });
    const tob = makeTob(1, [lot]);
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.setLotForm((f: any) => ({ ...f, status: "finished", dateFinished: "" }));
    });
    act(() => { result.current.updateLotInTobacco(1, "L1"); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].dateFinished).toBe("2025-06-15");
  });

  it("resets lotForm and editLotIdx after update", () => {
    const lot = makeLot({ id: "L1" });
    const tob = makeTob(1, [lot]);
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData({ tobaccos: [tob] }))));
    act(() => {
      result.current.setEditLotIdx(0);
      result.current.setLotForm((f: any) => ({ ...f, weightG: "70" }));
    });
    act(() => { result.current.updateLotInTobacco(1, "L1"); });
    expect(result.current.lotForm).toEqual(Object.assign({}, BL));
    expect(result.current.editLotIdx).toBeNull();
  });

  it("does NOT touch rebuy when a lot is marked disposed (manual only)", () => {
    // "À ne pas reprendre" is a deliberate per-tabac judgement, not a
    // consequence of physically disposing a lot. Eliminating a lot leaves the
    // tobacco's rebuy flag untouched (the recurring auto-behaviour was
    // reverted). The lot still gets its disposed flag.
    const lot = makeLot({ id: "L1", status: "finished", disposed: false, weightG: "0" });
    const tob = makeTob(1, [lot], { rebuy: null });
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.updateLotInTobacco(1, "L1", { id: "L1", status: "finished", disposed: true, weightG: "0", weightInitial: "50" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots[0].disposed).toBe(true);
    // rebuy is left exactly as it was — no auto-flag.
    expect(saved.tobaccos[0].rebuy).toBe(null);
  });

  it("does NOT clobber a manually-set rebuy=true when re-editing an already-disposed lot", () => {
    // The lot is ALREADY disposed and the user has re-enabled rebuy on the
    // fiche — editing the same lot again must NOT flip rebuy back to false.
    const lot = makeLot({ id: "L1", status: "finished", disposed: true, weightG: "0" });
    const tob = makeTob(1, [lot], { rebuy: true });
    const save = vi.fn();
    const data = makeData({ tobaccos: [tob] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => { result.current.updateLotInTobacco(1, "L1", { id: "L1", status: "finished", disposed: true, weightG: "0", weightInitial: "50" }); });
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].rebuy).toBe(true);
  });
});

// ── toggleTobGroup ────────────────────────────────────────────────────────────

describe("useTobaccoStore — toggleTobGroup (inverted collapse)", () => {
  it("absent key means collapsed by default", () => {
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData())));
    expect(result.current.collapsedTobGroups["Brand A"]).toBeUndefined();
  });

  it("first toggle expands the group (sets false)", () => {
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData())));
    act(() => { result.current.toggleTobGroup("Brand A"); });
    expect(result.current.collapsedTobGroups["Brand A"]).toBe(false);
  });

  it("second toggle collapses the group (removes key)", () => {
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData())));
    act(() => { result.current.toggleTobGroup("Brand A"); });
    act(() => { result.current.toggleTobGroup("Brand A"); });
    expect(result.current.collapsedTobGroups["Brand A"]).toBeUndefined();
  });

  it("toggling one group does not affect another", () => {
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData())));
    act(() => { result.current.toggleTobGroup("Brand A"); });
    expect(result.current.collapsedTobGroups["Brand B"]).toBeUndefined();
  });
});

// ── updateTobaccoTastingNotes ─────────────────────────────────────────────────

describe("useTobaccoStore — updateTobaccoTastingNotes", () => {
  it("patches the targeted tobacco's tastingNotes via save()", () => {
    const save = vi.fn();
    const data = {
      tobaccos: [
        { id: 1, name: "A", tastingNotes: "old A" },
        { id: 2, name: "B", tastingNotes: "old B" },
      ],
    };
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateTobaccoTastingNotes(2, "new B notes");
    });
    expect(save).toHaveBeenCalledOnce();
    const nd = save.mock.calls[0]![0];
    expect(nd.tobaccos[0]).toEqual({ id: 1, name: "A", tastingNotes: "old A" });
    expect(nd.tobaccos[1]).toEqual({ id: 2, name: "B", tastingNotes: "new B notes" });
  });

  it("works with string-keyed ids", () => {
    const save = vi.fn();
    const data = { tobaccos: [{ id: "abc", tastingNotes: "old" }] };
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateTobaccoTastingNotes("abc", "fresh");
    });
    expect(save.mock.calls[0]![0].tobaccos[0].tastingNotes).toBe("fresh");
  });

  it("is a no-op for unknown id (but still saves the shallow copy)", () => {
    const save = vi.fn();
    const data = { tobaccos: [{ id: 1, tastingNotes: "kept" }] };
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateTobaccoTastingNotes(999, "ignored");
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0].tobaccos[0].tastingNotes).toBe("kept");
  });
});

describe("useTobaccoStore — default grouping preference", () => {
  it("tobGrouped defaults to true when cave-default-grouped is absent", () => {
    localStorage.removeItem("cave-default-grouped");
    const { result } = renderHook(() => useTobaccoStore(makeDeps({ tobaccos: [] })));
    expect(result.current.tobGrouped).toBe(true);
  });

  it("tobGrouped defaults to true when cave-default-grouped === '1'", () => {
    localStorage.setItem("cave-default-grouped", "1");
    const { result } = renderHook(() => useTobaccoStore(makeDeps({ tobaccos: [] })));
    expect(result.current.tobGrouped).toBe(true);
  });

  it("tobGrouped defaults to false when cave-default-grouped === '0'", () => {
    localStorage.setItem("cave-default-grouped", "0");
    const { result } = renderHook(() => useTobaccoStore(makeDeps({ tobaccos: [] })));
    expect(result.current.tobGrouped).toBe(false);
  });
});

// ── addTobacco(override) — one-tap add from the catalog ──────────────────────
// CatalogView calls addTobacco(prefilledEntry) so the user doesn't need to
// open the form (which on mobile rendered as a sibling below the catalog in
// document flow, where it was effectively invisible). The override path must
// NOT touch `form` state and must NOT navigate away, while still building a
// valid tobacco entry with a starter lot and bumping nxT.

describe("useTobaccoStore — addTobacco(override) one-tap add", () => {
  it("creates the tobacco from the override and bumps nxT without touching nav", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ nxT: 7 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save, nav)));

    const prefilled = Object.assign({}, BT, {
      brand: "Halvorsen",
      name: "Duskfall",
      category: "Anglais",
      cut: "Ready Rubbed",
      blend: "Latakia, Oriental, Virginia, Perique",
      force: 4,
      roomNote: 3,
      taste: 3,
    });

    act(() => { result.current.addTobacco(prefilled); });

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos).toHaveLength(1);
    expect(saved.tobaccos[0].id).toBe(7);
    expect(saved.tobaccos[0].brand).toBe("Halvorsen");
    expect(saved.tobaccos[0].name).toBe("Duskfall");
    expect(saved.tobaccos[0].category).toBe("Anglais");
    expect(saved.nxT).toBe(8);
    // The override path stays on the catalog — no nav.
    expect(nav).not.toHaveBeenCalled();
  });

  it("auto-creates a starter cellar lot when the override has no lots", () => {
    const save = vi.fn();
    const data = makeData({ nxT: 1 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));

    act(() => {
      result.current.addTobacco(Object.assign({}, BT, { brand: "Pellworm", name: "HH Old Dark Fired" }));
    });

    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].lots).toHaveLength(1);
    expect(saved.tobaccos[0].lots[0].id).toBeTypeOf("number");
    expect(saved.tobaccos[0].lots[0].status).toBe("cellar");
    expect(saved.tobaccos[0].lots[0].datePurchased).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("legacy form-based call (no arg) still saves AND navigates back to inv", () => {
    // Locks the backward-compat contract — earlier callers (form
    // save buttons in TobaccoFormView, wishToInv flow) MUST still
    // behave identically: setForm(BT) + nav("inv", restoreScroll).
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ nxT: 3 });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save, nav)));

    act(() => {
      result.current.setForm(Object.assign({}, BT, { brand: "Vondel", name: "Red Label" }));
    });
    act(() => { result.current.addTobacco(); });

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(saved.tobaccos[0].name).toBe("Red Label");
    expect(saved.nxT).toBe(4);
    expect(nav).toHaveBeenCalledWith("inv", { restoreScroll: true });
  });

  it("ignores override without name/brand (defence-in-depth)", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData(), save)));

    act(() => { result.current.addTobacco(Object.assign({}, BT, { brand: "Halvorsen" })); });
    expect(save).not.toHaveBeenCalled();

    act(() => { result.current.addTobacco(Object.assign({}, BT, { name: "Duskfall" })); });
    expect(save).not.toHaveBeenCalled();
  });
});


// ── lot mutators locate by id, not positional index ─────────────
// Regression for the stripped-index integrity bug. The detail view holds the
// trash-STRIPPED lots and computes an index against them, but the store
// indexes the RAW (trash-inclusive) `data.tobaccos[].lots`. When a soft-deleted
// lot precedes a live lot, an index-based mutation hit the WRONG (trashed) lot,
// silently corrupting data and creating duplicate lot ids. Locating by id fixes
// it. These drive the bug red on the old code and green on the fix.
describe("useTobaccoStore — lot mutators locate by id", () => {
  function tobTrashedFirst() {
    // raw order: [trashed A, live B]. Stripped view would show B at index 0.
    return makeTob(1, [
      makeLot({ id: "A", deletedAt: "2020-01-01T00:00:00.000Z", weightG: "10", status: "cellar" }),
      makeLot({ id: "B", status: "cellar", weightG: "50" }),
    ]);
  }

  it("changeLotStatus targets live lot B by id, never the trashed A at raw index 0", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData({ tobaccos: [tobTrashedFirst()] }), save)));
    act(() => { result.current.changeLotStatus(1, "B", "jar"); });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    const A = lots.find((l: any) => l.id === "A");
    const B = lots.find((l: any) => l.id === "B");
    expect(B.status).toBe("jar");        // live lot changed
    expect(A.status).toBe("cellar");     // trashed lot untouched
    expect(A.deletedAt).toBeTruthy();
  });

  it("updateLotInTobacco targets B by id, preserves ids (no duplicate), leaves A intact", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData({ tobaccos: [tobTrashedFirst()] }), save)));
    act(() => {
      result.current.updateLotInTobacco(1, "B", { id: "B", status: "jar", weightG: "40", weightInitial: "50" });
    });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.map((l: any) => l.id).sort()).toEqual(["A", "B"]); // no duplicate id
    expect(lots.find((l: any) => l.id === "B").weightG).toBe("40");
    const A = lots.find((l: any) => l.id === "A");
    expect(A.weightG).toBe("10");        // trashed A untouched
    expect(A.deletedAt).toBeTruthy();
  });

  it("removeLot soft-deletes B by id, never the trashed A", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(makeData({ tobaccos: [tobTrashedFirst()] }), save)));
    act(() => { result.current.removeLot(1, "B"); });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots.find((l: any) => l.id === "B").deletedAt).toBeTruthy();
  });
});

// ── editing a tobacco must not destroy its trashed lots ──────
// Found by a data-layer audit. `liveData` strips soft-deleted lots before the
// fiche sees the tobacco; the edit button seeds the form from THAT object; and
// updateTobacco replaced the whole raw row with the form. So the ordinary path
// (trash a lot → back → edit → save) permanently destroyed the trashed lot and
// silently broke the 30-day restore promise. usePipeStore has defended the
// structurally identical `maintenance` field; this is its twin.
describe("updateTobacco preserves soft-deleted lots", () => {
  it("keeps a trashed lot that the form snapshot never carried", () => {
    const trashed = { id: 900, status: "cellar", weightG: "50", deletedAt: "2026-01-01T00:00:00.000Z" };
    const live = { id: 901, status: "jar", weightG: "20" };
    const raw: any = {
      tobaccos: [{ id: 1, brand: "Halvorsen", name: "Duskfall", lots: [trashed, live] }],
    };
    const save = vi.fn();
    // The form is what the FICHE would hand over: live lots only.
    const form: any = { id: 1, brand: "Halvorsen", name: "Duskfall (edited)", lots: [live] };
    const { result } = renderHook(() => useTobaccoStore(makeDeps(raw, save)));
    act(() => {
      result.current.setEditId(1);
      result.current.setForm(form);
    });
    act(() => { result.current.updateTobacco(); });
    expect(save).toHaveBeenCalled();
    const saved = save.mock.calls[save.mock.calls.length - 1]![0];
    const lots = saved.tobaccos[0].lots;
    expect(lots.map((l: any) => l.id).sort()).toEqual([900, 901]);
    expect(lots.find((l: any) => l.id === 900).deletedAt).toBeTruthy();
    // ...and the edit itself still lands.
    expect(saved.tobaccos[0].name).toBe("Duskfall (edited)");
  });
});

// ─── every bulk clone is its own physical tin ─────────────────────
//
// The user buys three identical tins in one action ("Nombre de lots: 3"). They
// share every acquisition field by construction — same price, same date, same
// (or absent) box number — so `lotMergeKey` cannot tell them apart. What CAN
// is the `uid` minted per clone, which is why the merge engine matches
// lots by uid first.
//
// If the clones shared ONE uid, the merge would read them as the same tin and
// keep exactly one: back up on the phone, restore on the tablet, and two of the
// three tins are gone — silently, with the balance still self-consistent. This
// is the same disappearance the lot uid fixed for identical-acquisition tins,
// arriving through the other door.
describe("useTobaccoStore — bulk lots get DISTINCT uids", () => {
  it("three clones from one bulk create carry three different uids", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, {
        weightInitial: "50", weightG: "50", price: "12", datePurchased: "2025-01-01",
      }), 3);
    });
    const lots = save.mock.calls[0]![0].tobaccos[0].lots;
    expect(lots).toHaveLength(3);
    const uids = lots.map((l: any) => l.uid);
    expect(uids.every((u: any) => typeof u === "string" && u.length > 0)).toBe(true);
    expect(new Set(uids).size).toBe(3);
  });

  it("a duplicated lot never inherits the source tin's uid", () => {
    // makeLotDuplicate strips the uid; the store must mint a fresh one rather
    // than let a stale `base.uid` ride through the clone loop.
    const save = vi.fn();
    const src = makeLot({ id: "L1", uid: "uid-of-the-original", weightG: "50", weightInitial: "50" });
    const data = makeData({ tobaccos: [makeTob(1, [src])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, {
        weightInitial: "50", weightG: "50", uid: "uid-of-the-original",
      }), 2);
    });
    const added = save.mock.calls[0]![0].tobaccos[0].lots.slice(1);
    expect(added).toHaveLength(2);
    added.forEach((l: any) => expect(l.uid).not.toBe("uid-of-the-original"));
    expect(added[0].uid).not.toBe(added[1].uid);
  });
});

// ─── Creating a lot always yields a coherent, non-empty lot ──────────────────
//
// LotFormModal hides the current-weight field at creation and sends only
// `weightInitial`; other callers (imports, the AI fill, older fixtures) send
// only `weightG`. Both must land a lot that carries BOTH, or the tin the user
// just entered shows as empty stock while claiming a 50 g initial weight — and
// `weightInitial − weightG` (the balance reference every later session is
// checked against) starts life already wrong.
describe("useTobaccoStore — addLotToTobacco cross-seeds the two weights", () => {
  it("seeds weightG from weightInitial (the LotFormModal creation path)", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "" }));
    });
    const lot = save.mock.calls[0]![0].tobaccos[0].lots[0];
    expect(lot.weightG).toBe("50");
    expect(lot.weightInitial).toBe("50");
  });

  it("seeds weightInitial from weightG (programmatic / import path)", () => {
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "", weightG: "50" }));
    });
    const lot = save.mock.calls[0]![0].tobaccos[0].lots[0];
    expect(lot.weightInitial).toBe("50");
    expect(lot.weightG).toBe("50");
  });

  it("a non-positive lot count still creates exactly one lot", () => {
    // `Math.max(1, …)` is what stops a count of 0 or a negative from running
    // the clone loop zero times: the user taps "Ajouter" and nothing appears.
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, { weightInitial: "50", weightG: "50" }), -3);
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots).toHaveLength(1);
  });

  it("records the creation status as the lot's origin (drives the Réactiver prefill)", () => {
    // A lot created straight into a jar must remember it was opened from the
    // start: the manual Réactiver prefill reads `originalStatus`, so recording
    // "cellar" here would later re-seal a tin the user has been smoking.
    const save = vi.fn();
    const data = makeData({ tobaccos: [makeTob(1)] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.addLotToTobacco(1, Object.assign({}, BL, {
        status: "jar", weightInitial: "50", weightG: "50", originalStatus: "",
      }));
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots[0].originalStatus).toBe("jar");
  });
});

// ─── Editing a lot must not quietly rewrite its history ─────────────────────
describe("useTobaccoStore — updateLotInTobacco preserves lot history", () => {
  it("keeps weightInitial when the edit payload omits it", () => {
    // weightInitial is the reference the balance invariant measures against
    // (Σsessions === weightInitial − weightG). An edit that dropped it would
    // make every past session of that lot look unaccounted for.
    const save = vi.fn();
    const lot = makeLot({ id: "L1", status: "jar", weightG: "30", weightInitial: "50" });
    const data = makeData({ tobaccos: [makeTob(1, [lot])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateLotInTobacco(1, "L1", { status: "jar", weightG: "25" });
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots[0].weightInitial).toBe("50");
  });

  it("clears dateFinished and disposed when a lot leaves the finished state", () => {
    // Reactivating a tin the user had thrown away must not leave it flagged
    // eliminated: it would keep showing under "Éliminés" and — because
    // stepAutoReactivate refuses to resurrect a disposed lot — would never
    // come back as usable stock again.
    const save = vi.fn();
    const lot = makeLot({
      id: "L1", status: "finished", weightG: "0", weightInitial: "50",
      dateFinished: "2025-01-05", disposed: true,
    });
    const data = makeData({ tobaccos: [makeTob(1, [lot])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateLotInTobacco(1, "L1", {
        status: "jar", weightG: "20", weightInitial: "50",
        dateFinished: "2025-01-05", disposed: true,
      });
    });
    const saved = save.mock.calls[0]![0].tobaccos[0].lots[0];
    expect(saved.dateFinished).toBe("");
    expect(saved.disposed).toBe(false);
  });

  // dateOpened is wiped only on a REAL transition INTO cellar.
  // Editing a lot that is already cellar — an unrelated field, a price
  // correction — must keep the day it was opened, which is the only record of
  // that event.
  it("does not wipe dateOpened when re-saving an already-cellar lot", () => {
    const save = vi.fn();
    const lot = makeLot({ id: "L1", status: "cellar", weightG: "50", weightInitial: "50", dateOpened: "2024-03-02" });
    const data = makeData({ tobaccos: [makeTob(1, [lot])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateLotInTobacco(1, "L1", {
        status: "cellar", weightG: "50", weightInitial: "50",
        dateOpened: "2024-03-02", price: "14",
      });
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots[0].dateOpened).toBe("2024-03-02");
  });

  it("still wipes dateOpened on a genuine jar → cellar transition", () => {
    const save = vi.fn();
    const lot = makeLot({ id: "L1", status: "jar", weightG: "50", weightInitial: "50", dateOpened: "2024-03-02" });
    const data = makeData({ tobaccos: [makeTob(1, [lot])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateLotInTobacco(1, "L1", {
        status: "cellar", weightG: "50", weightInitial: "50", dateOpened: "2024-03-02",
      });
    });
    expect(save.mock.calls[0]![0].tobaccos[0].lots[0].dateOpened).toBe("");
  });

  // Lot ids are minted as numbers but round-trip through CSV / JSON / the DOM
  // as strings, so the match must be String-coerced on both sides. A strict
  // compare silently matches nothing: the user saves the lot form and the lot
  // is unchanged, with no error to explain it.
  it("matches the lot whether the id arrives as a number or a string", () => {
    const save = vi.fn();
    const lot = makeLot({ id: 1700000000000, status: "jar", weightG: "50", weightInitial: "50" });
    const data = makeData({ tobaccos: [makeTob(1, [lot])] });
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save)));
    act(() => {
      result.current.updateLotInTobacco(1, "1700000000000", {
        status: "jar", weightG: "42", weightInitial: "50",
      });
    });
    const saved = save.mock.calls[0]![0].tobaccos[0].lots[0];
    expect(saved.weightG).toBe("42");
    expect(String(saved.id)).toBe("1700000000000");
  });
});

// ── the starter lot carries NO INVENTED STOCK ────────────────
//
// Found by the pre-public-release first-run audit. Every first tobacco was
// created with 50 g the user never entered: the starter lot inherited `BL`'s
// `weightG: "50"`, so saving brand + name alone produced `1 BOÎTES · 0,1 kg`
// on the Home and `50g · 1 CAVE` on the card. That number then feeds the total
// weight, the maturity bar, the low-stock threshold, the shopping list, the
// collection report's weight AND value columns, and the cost per bowl — a
// user's first data point, false, with nothing marking it as a guess.
//
// The objection that made this non-obvious: creating at ZERO would make the
// lot auto-finish. Correct, and the answer is that empty ≠ zero — the app has
// modelled "never weighed". These cases assert BOTH halves,
// because getting only the first one right is what would ship a tabac that
// looks fine and dies on its first session.

describe("useTobaccoStore — the starter lot invents no stock", () => {
  const addOne = () => {
    const save = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => useTobaccoStore(makeDeps(data, save) as any));
    act(() => { result.current.addTobacco({ ...BT, brand: "Halvorsen", name: "Duskfall" }); });
    return save.mock.calls[0]![0].tobaccos[0];
  };

  it("creates the lot with NO weight, not with BL's 50 g", () => {
    const lot = addOne().lots[0];
    expect(lot.weightG, "a weight the user never entered").toBe("");
    expect(lot.weightInitial).toBe("");
  });

  it("but NOT with a zero — a zero is an empty tin and would auto-finish", () => {
    // This is the distinction the whole fix turns on. `"0"` is a weighed,
    // empty tin: `stepAutoFinish` closes it on the first session and both
    // session pickers refuse it. `""` means "never weighed".
    const lot = addOne().lots[0];
    expect(lot.weightG).not.toBe("0");
    expect(isUntrackedWeight(lot.weightG), "must read as untracked").toBe(true);
  });

  it("the tabac still lands ACTIVE — the only reason the starter lot exists", () => {
    // countActive keys on `status !== "finished"` and never reads the weight.
    // If that ever changes, a weightless starter lot would make every new
    // tobacco inactive on creation, and this case says so.
    const tob = addOne();
    expect(tob.lots[0].status).toBe("cellar");
    expect(countActive(tob)).toBe(1);
    expect(hasActive(tob)).toBe(true);
  });

  it("is offered in a session, and the first session does not close it", () => {
    // The failure this fix must not cause: an untracked lot the pickers accept
    // And the pipeline then auto-finishes. An earlier release fixed both steps; assert
    // it here too, because the starter lot is now the commonest untracked lot
    // in the app.
    const lot = addOne().lots[0];
    expect(isUsableLot(lot)).toBe(true);
    const after = stepAutoFinish(stepApplyDelta(lot, -2.5, "g"));
    expect(after.status, "an unweighed lot has no zero to reach").toBe("cellar");
    expect(after.weightG, "and its absence of data is preserved").toBe("");
  });

  it("BL itself is untouched — its 50 is the add-a-lot form's prefill", () => {
    // The defect was inheriting that prefill where there is no field and no
    // user looking at it. Changing BL would silently change the form too.
    expect(BL.weightG).toBe("50");
  });
});
