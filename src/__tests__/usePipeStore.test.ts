import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePipeStore } from "../hooks/usePipeStore";
import { BP } from "../constants";

// ── helpers ───────────────────────────────────────────────────────────────────

function makePipe(id: number, overrides: Record<string, any> = {}) {
  return Object.assign({}, BP, { id, name: "Pipe " + id, brand: "Brand" + id, status: "active" }, overrides);
}

function makeData(overrides: Record<string, any> = {}) {
  return {
    pipes: [],
    nxP: 1,
    ...overrides,
  };
}

function makeDeps(data: any, save = vi.fn(), nav = vi.fn()) {
  return { data, save, nav };
}

// ── initial state ─────────────────────────────────────────────────────────────

describe("usePipeStore — initial state", () => {
  it("starts with blank pipeForm", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.pipeForm).toEqual(Object.assign({}, BP));
  });

  it("starts with pipeDet = null", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.pipeDet).toBeNull();
  });

  it("starts with editPipeId = null", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.editPipeId).toBeNull();
  });

  it("starts with showFinishedPipes = false", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.showFinishedPipes).toBe(false);
  });

  it("starts with pipesGrouped = true", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.pipesGrouped).toBe(true);
  });

  it("starts with collapsedPipeGroups = {}", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    expect(result.current.collapsedPipeGroups).toEqual({});
  });
});

// ── addPipe ───────────────────────────────────────────────────────────────────

describe("usePipeStore — addPipe", () => {
  it("does nothing when name and brand are both empty", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save, nav)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "", brand: "" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(save).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it("adds a pipe when both name and brand are provided", () => {
    const save = vi.fn();
    const nav = vi.fn();
    const data = makeData({ nxP: 5 });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save, nav)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Dublin", brand: "Halvorsen" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(save).toHaveBeenCalledOnce();
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes).toHaveLength(1);
    expect(saved.pipes[0].id).toBe(5);
    expect(saved.pipes[0].name).toBe("Dublin");
    expect(saved.nxP).toBe(6);
  });

  it("does NOT add a pipe when brand is missing", () => {
    const save = vi.fn();
    const data = makeData({ nxP: 3 });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Dublin", brand: "" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("does NOT add a pipe when name is missing", () => {
    const save = vi.fn();
    const data = makeData({ nxP: 3 });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "", brand: "Savinelli" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("navigates to 'pipes' after adding", () => {
    const nav = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => usePipeStore(makeDeps(data, vi.fn(), nav)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Billiard", brand: "Brackwater" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(nav).toHaveBeenCalledWith("pipes", { restoreScroll: true });
  });

  it("resets pipeForm after adding", () => {
    const data = makeData();
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Poker", brand: "Chacom" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(result.current.pipeForm).toEqual(Object.assign({}, BP));
  });

  it("sets status to 'active' if missing", () => {
    const save = vi.fn();
    const data = makeData();
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Apple", brand: "Stanwell", status: "" }));
    });
    act(() => {
      result.current.addPipe();
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes[0].status).toBe("active");
  });

  it("expands the new pipe's brand group so it's visible on return", () => {
    const data = makeData();
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Poker", brand: "Chacom" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(result.current.collapsedPipeGroups["Chacom"]).toBe(false);
  });

  it("increments nxP counter", () => {
    const save = vi.fn();
    const data = makeData({ nxP: 7 });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, { name: "Ball", brand: "Vauen" }));
    });
    act(() => {
      result.current.addPipe();
    });
    expect(save.mock.calls[0]![0].nxP).toBe(8);
  });
});

// ── updatePipe ────────────────────────────────────────────────────────────────

describe("usePipeStore — updatePipe", () => {
  it("updates the correct pipe by editPipeId", () => {
    const save = vi.fn();
    const pipe1 = makePipe(1);
    const pipe2 = makePipe(2);
    const data = makeData({ pipes: [pipe1, pipe2] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setEditPipeId(2);
      result.current.setPipeForm(Object.assign({}, BP, { name: "Updated Pipe", brand: "NewBrand" }));
    });
    act(() => {
      result.current.updatePipe();
    });
    const saved = save.mock.calls[0]![0];
    const updatedPipe = saved.pipes.find((p: any) => p.id === 2);
    expect(updatedPipe.name).toBe("Updated Pipe");
    expect(updatedPipe.brand).toBe("NewBrand");
    // pipe1 is untouched
    expect(saved.pipes.find((p: any) => p.id === 1).name).toBe("Pipe 1");
  });

  it("resets editPipeId and pipeForm after update", () => {
    const data = makeData({ pipes: [makePipe(1)] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.setEditPipeId(1);
      // update requires name+brand (mirrors addPipe's guard)
      result.current.setPipeForm(Object.assign({}, BP, { name: "Modified", brand: "B" }));
    });
    act(() => {
      result.current.updatePipe();
    });
    expect(result.current.editPipeId).toBeNull();
    expect(result.current.pipeForm).toEqual(Object.assign({}, BP));
  });

  it("navigates to 'pipes' after update", () => {
    const nav = vi.fn();
    const data = makeData({ pipes: [makePipe(1)] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, vi.fn(), nav)));
    act(() => {
      result.current.setEditPipeId(1);
      result.current.setPipeForm(Object.assign({}, BP, { name: "N", brand: "B" }));
    });
    act(() => {
      result.current.updatePipe();
    });
    expect(nav).toHaveBeenCalledWith("pipes", { restoreScroll: true });
  });
});

// ── deletePipe ────────────────────────────────────────────────────────────────

describe("usePipeStore — deletePipe", () => {
  // soft-delete — row stays but gets `deletedAt`.
  it("marks the pipe deleted (soft-delete) without removing it", () => {
    const save = vi.fn();
    const pipe1 = makePipe(1);
    const pipe2 = makePipe(2);
    const data = makeData({ pipes: [pipe1, pipe2] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.deletePipe(1);
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes).toHaveLength(2);
    const p1 = saved.pipes.find((p: any) => p.id === 1);
    const p2 = saved.pipes.find((p: any) => p.id === 2);
    expect(p1.deletedAt).toMatch(/^\d{4}-/);
    expect(p2.deletedAt).toBeUndefined();
  });

  it("clears pipeDet when the deleted pipe is the current detail", () => {
    const pipe1 = makePipe(1);
    const data = makeData({ pipes: [pipe1] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.setPipeDet(pipe1);
    });
    act(() => {
      result.current.deletePipe(1);
    });
    expect(result.current.pipeDet).toBeNull();
  });

  it("does not clear pipeDet when a different pipe is deleted", () => {
    const pipe1 = makePipe(1);
    const pipe2 = makePipe(2);
    const data = makeData({ pipes: [pipe1, pipe2] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.setPipeDet(pipe1);
    });
    act(() => {
      result.current.deletePipe(2);
    });
    expect(result.current.pipeDet).toEqual(pipe1);
  });

  // refresh the snapshot on every referencing session
  // BEFORE the pipe drops out of liveData — mirrors the tabac path.
  it("refreshes pipeSnapshot on referencing sessions with the pipe's CURRENT state", () => {
    const save = vi.fn();
    const pipe = makePipe(1, {
      brand: "Halvorsen", name: "SherlockV2",
      imageUrl: "local-photo-new",
    });
    const sessions = [
      { id: 100, tobaccoId: "", pipeId: 1, lotId: "",
        date: "2025-01-01", duration: "30", weightG: "0",
        pipeSnapshot: { brand: "Halvorsen", name: "Sherlock",
                        imageUrl: "local-photo-old" } },
    ];
    const data = makeData({ pipes: [pipe], sessions });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.deletePipe(1); });
    const saved = save.mock.calls[0]![0];
    expect(saved.sessions[0].pipeSnapshot).toEqual({
      brand: "Halvorsen", name: "SherlockV2", imageUrl: "local-photo-new",
    });
  });
});

// ── changePipeStatus ──────────────────────────────────────────────────────────

describe("usePipeStore — changePipeStatus", () => {
  it("changes status from active to finished", () => {
    const save = vi.fn();
    const pipe = makePipe(1, { status: "active" });
    const data = makeData({ pipes: [pipe] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.changePipeStatus(1, "finished");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes[0].status).toBe("finished");
  });

  it("changes status from finished back to active", () => {
    const save = vi.fn();
    const pipe = makePipe(1, { status: "finished" });
    const data = makeData({ pipes: [pipe] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.changePipeStatus(1, "active");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes[0].status).toBe("active");
  });

  it("does not touch other pipes", () => {
    const save = vi.fn();
    const pipe1 = makePipe(1, { status: "active" });
    const pipe2 = makePipe(2, { status: "active" });
    const data = makeData({ pipes: [pipe1, pipe2] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.changePipeStatus(1, "finished");
    });
    const saved = save.mock.calls[0]![0];
    expect(saved.pipes[1].status).toBe("active");
  });

  it("updates pipeDet to the updated pipe", () => {
    const pipe = makePipe(1, { status: "active" });
    const data = makeData({ pipes: [pipe] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => {
      result.current.changePipeStatus(1, "finished");
    });
    expect(result.current.pipeDet?.status).toBe("finished");
  });
});

// ── togglePipeGroup ───────────────────────────────────────────────────────────

describe("usePipeStore — togglePipeGroup", () => {
  it("expands a collapsed group (absent → false)", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    // Key absent = collapsed (default)
    expect(result.current.collapsedPipeGroups["Savinelli"]).toBeUndefined();
    act(() => {
      result.current.togglePipeGroup("Savinelli");
    });
    expect(result.current.collapsedPipeGroups["Savinelli"]).toBe(false);
  });

  it("collapses an expanded group (false → absent)", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    act(() => {
      result.current.togglePipeGroup("Savinelli");
    });
    expect(result.current.collapsedPipeGroups["Savinelli"]).toBe(false);
    act(() => {
      result.current.togglePipeGroup("Savinelli");
    });
    expect("Savinelli" in result.current.collapsedPipeGroups).toBe(false);
  });

  it("does not affect other groups when toggling", () => {
    const { result } = renderHook(() => usePipeStore(makeDeps(makeData())));
    act(() => {
      result.current.togglePipeGroup("Savinelli");
    });
    expect(result.current.collapsedPipeGroups["Chacom"]).toBeUndefined();
  });
});

// ── maintenance log ────────────────────────────────────────────────

describe("usePipeStore — maintenance log", () => {
  it("addMaintenance appends an entry with a numeric id + given fields", () => {
    const save = vi.fn();
    const data = makeData({ pipes: [makePipe(1, { maintenance: [] })] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.addMaintenance(1, { date: "2026-07-01", kind: "light", tasks: [], notes: "ramonage" }); });
    const log = save.mock.calls[0]![0].pipes[0].maintenance;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ date: "2026-07-01", kind: "light", notes: "ramonage" });
    expect(typeof log[0].id).toBe("number");
    // stable cross-device uid minted alongside the numeric id.
    expect(typeof log[0].uid).toBe("string");
    expect(log[0].uid.length).toBeGreaterThan(0);
  });

  it("addMaintenance seeds an empty array on a legacy pipe with no maintenance field", () => {
    const save = vi.fn();
    const pipe = makePipe(1);
    delete (pipe as any).maintenance;
    const data = makeData({ pipes: [pipe] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.addMaintenance(1, { date: "2026-01-01", kind: "light", tasks: ["wax"], notes: "" }); });
    expect(save.mock.calls[0]![0].pipes[0].maintenance).toHaveLength(1);
  });

  it("addMaintenance overrides a form-supplied id:0 with a fresh non-zero id", () => {
    // MaintFormModal seeds its form from EMPTY = { id: 0, … } and sends the
    // whole form. A leading `{ id: Date.now() }` default was overwritten back
    // to 0 by the spread, so EVERY entry got id 0 → update/remove keyed on id
    // hit every entry at once. The id must now be assigned LAST.
    const save = vi.fn();
    const data = makeData({ pipes: [makePipe(1, { maintenance: [] })] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.addMaintenance(1, { id: 0, date: "2026-07-01", kind: "full", tasks: ["ream"], notes: "" }); });
    const entry = save.mock.calls[0]![0].pipes[0].maintenance[0];
    expect(entry.id).not.toBe(0);
    expect(typeof entry.id).toBe("number");
    expect(entry.id).toBeGreaterThan(0);
    // The earlier vestigial `type` field must not be introduced.
    expect("type" in entry).toBe(false);
  });

  it("two addMaintenance entries created on the same pipe get distinct ids", () => {
    // Thread the saved data back into the hook so the second add operates on
    // the first add's result — proving the two entries don't collide on id 0.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    let data: any = makeData({ pipes: [makePipe(1, { maintenance: [] })] });
    const save = vi.fn((d: any) => { data = d; });
    const { result, rerender } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.addMaintenance(1, { id: 0, date: "2026-01-01", kind: "light", tasks: [], notes: "a" }); });
    rerender();
    act(() => { result.current.addMaintenance(1, { id: 0, date: "2026-02-02", kind: "full", tasks: [], notes: "b" }); });
    const log = data.pipes[0].maintenance;
    expect(log).toHaveLength(2);
    expect(log[0].id).not.toBe(log[1].id);
    nowSpy.mockRestore();
  });

  it("updateMaintenance edits the matching entry by id and keeps the id", () => {
    const save = vi.fn();
    const data = makeData({ pipes: [makePipe(1, { maintenance: [{ id: 42, date: "2026-01-01", kind: "light", tasks: [], notes: "" }] })] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.updateMaintenance(1, 42, { date: "2026-02-02", kind: "none", tasks: ["wax"], notes: "x" }); });
    expect(save.mock.calls[0]![0].pipes[0].maintenance[0]).toEqual({ id: 42, date: "2026-02-02", kind: "none", tasks: ["wax"], notes: "x" });
  });

  it("removeMaintenance drops the matching entry", () => {
    const save = vi.fn();
    const data = makeData({ pipes: [makePipe(1, { maintenance: [
      { id: 1, date: "", kind: "light", tasks: [], notes: "" },
      { id: 2, date: "", kind: "light", tasks: ["wax"], notes: "" },
    ] })] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => { result.current.removeMaintenance(1, 1); });
    const log = save.mock.calls[0]![0].pipes[0].maintenance;
    expect(log).toHaveLength(1);
    expect(log[0].id).toBe(2);
  });

  it("refreshes the pipeDet snapshot when the edited pipe's detail is open", () => {
    const pipe = makePipe(1, { maintenance: [] });
    const data = makeData({ pipes: [pipe] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data)));
    act(() => { result.current.setPipeDet(pipe); });
    act(() => { result.current.addMaintenance(1, { date: "2026-07-01", kind: "light", tasks: [], notes: "" }); });
    expect(result.current.pipeDet.maintenance).toHaveLength(1);
  });

  it("updatePipe preserves the stored maintenance log (defensive against a stale form)", () => {
    const save = vi.fn();
    const data = makeData({ pipes: [makePipe(1, { maintenance: [{ id: 9, date: "2026-01-01", kind: "light", tasks: [], notes: "" }] })] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    act(() => {
      result.current.setEditPipeId(1);
      // Stale form: BP seeds maintenance:[] — must NOT clobber the stored log.
      result.current.setPipeForm(Object.assign({}, BP, { name: "Renamed", brand: "B" }));
    });
    act(() => { result.current.updatePipe(); });
    const updated = save.mock.calls[0]![0].pipes[0];
    expect(updated.name).toBe("Renamed");
    expect(updated.maintenance).toHaveLength(1);
    expect(updated.maintenance[0].id).toBe(9);
  });
});

describe("usePipeStore — updatePipe regression: edit flow survives nav reset", () => {
  it("editPipeId and pipeForm are PRESERVED when nav is called after them", () => {
    // Reproduces the bug fixed: nav() used to reset
    // setEditPipeId(null), wiping the edit target the handler had
    // just set. The fix removes that reset from nav so the live
    // editPipeId in the hook survives navigation into the edit form.
    const pipe1 = makePipe(1);
    const pipe2 = makePipe(2);
    const save = vi.fn();
    const data = makeData({ pipes: [pipe1, pipe2] });
    const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
    // Simulate the edit handler in PipesDetailView:
    //   setPipeForm(Object.assign({}, BP, p));
    //   setEditPipeId(p.id);
    //   nav("editP");   // ← would reset editPipeId in the old code
    act(() => {
      result.current.setPipeForm(Object.assign({}, BP, pipe2, { name: "Renamed" }));
      result.current.setEditPipeId(2);
    });
    // Now the form is populated and editPipeId === 2. The test
    // does NOT simulate nav since that path lives in App.tsx and
    // its fix is verified separately (App.tsx nav no longer resets
    // these). But the store's update path is what users hit on save.
    expect(result.current.pipeForm.name).toBe("Renamed");
    act(() => {
      result.current.updatePipe();
    });
    const saved = save.mock.calls[0]![0];
    const updated = saved.pipes.find((p: any) => p.id === 2);
    expect(updated.name).toBe("Renamed");
    // pipe1 untouched
    expect(saved.pipes.find((p: any) => p.id === 1).name).toBe("Pipe 1");
  });
});

// `MaintFormModal` seeds its form from `EMPTY = { id: 0, … }`
// and hands the WHOLE form back, so the id in the payload is not trustworthy —
// which is why `addMaintenance` stamps a fresh id LAST and `updateMaintenance`
// re-stamps `entryId` LAST. Without that re-stamp an entry can come out of an
// edit carrying id 0 (or none), and every later update/remove keyed on that id
// hits every such entry at once — the exact corruption the
// `maintenance-id-unique` invariant was raised for. The add path has this covered; the
// edit path did not.
it("updateMaintenance re-stamps the id even when the form payload carries a bogus one", () => {
  const save = vi.fn();
  const data = makeData({ pipes: [makePipe(1, { maintenance: [
    { id: 42, date: "2026-01-01", kind: "light", tasks: [], notes: "" },
    { id: 43, date: "2026-03-03", kind: "full", tasks: [], notes: "" },
  ] })] });
  const { result } = renderHook(() => usePipeStore(makeDeps(data, save)));
  act(() => {
    result.current.updateMaintenance(1, 42, { id: 0, date: "2026-02-02", kind: "none", tasks: ["wax"], notes: "x" });
  });
  const log = save.mock.calls[0]![0].pipes[0].maintenance;
  expect(log[0].id).toBe(42);
  expect(log[0].notes).toBe("x");
  // …and the neighbour is untouched, so the two ids stay distinct.
  expect(log[1].id).toBe(43);
  expect(new Set(log.map((m: any) => m.id)).size).toBe(2);
});
