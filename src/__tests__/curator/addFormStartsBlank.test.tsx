// The "+" button must BLANK the working copy.
//
// `form` / `pipeForm` / `accForm` are reset in exactly three places each: the
// add success path, the update success path, and the form view's own
// `cancel()`. `nav()` is FORBIDDEN from touching them (the edit-id
// invariant, and it is right). So leaving an edit form any other way keeps the
// working copy loaded — and that is the ordinary way to leave one: a form the
// user has not changed is CLEAN, so `useUnsavedFormGuard` lets a system-back
// or an edge-swipe through without a word.
//
// The next "+" then opened « Un nouveau tabac » over the previous tobacco's
// fields, photo, notes and rating. Saving it is where the damage is:
//
//   useTobaccoStore.addTobacco -> uid: source.uid || newUid()
//
// so the new row inherits the edited entity's `uid` — the cross-device merge
// identity that `resolveMergeMatch` matches on FIRST — and its lots are
// re-stamped only where `!l.id`, so existing lot ids and uids are duplicated
// GLOBALLY, which is exactly what `useTrashOps` and the 30-day sweep filter
// on. Three invariants fire at the next save().
//
// What identifies this as an oversight rather than a decision: the SAME
// handler in `InventoryListView` already did it correctly for the wishlist —
// `setWishForm({...BW}); setEditWishId(null)` — because that form is an
// overlay and had to. The three view-based forms never got it.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { AppCtx, AppCtxType } from "../../AppContext";
import { CuratorInventoryListView } from "../../views/curator/InventoryListView";
import { CuratorPipesListView } from "../../views/curator/PipesListView";
import { CuratorAccListView } from "../../views/curator/AccListView";
import { BT, BP, BA } from "../../constants";

const mockT = (k: string) => k;

function draw(node: React.ReactElement, ctx: Record<string, any>) {
  return render(
    <AppCtx.Provider value={{
      t: mockT, xl: (v: string) => v, lang: "fr", weightUnit: "g",
      data: { tobaccos: [], pipes: [], accessories: [], sessions: [], wishlist: [] },
      BT, BP, BA,
      ...ctx,
    } as unknown as AppCtxType}>{node}</AppCtx.Provider>,
  );
}

// The state a clean exit from an edit form leaves behind.
const STALE_TOB = { id: 7, uid: "tob-uid-7", name: "Duskfall", brand: "Halvorsen",
  lots: [{ id: 101, uid: "lot-uid-101", status: "cellar", weightG: "50" }] };
const STALE_PIPE = { id: 3, uid: "pipe-uid-3", name: "Sherlock", brand: "Halvorsen",
  maintenance: [{ id: 9, uid: "m-9", date: "2026-01-01", kind: "light", tasks: [], notes: "" }] };
const STALE_ACC = { id: 4, uid: "acc-uid-4", name: "Zippo", brand: "Zippo", type: "Briquet" };

function plus(container: HTMLElement, label: string) {
  const b = Array.from(container.querySelectorAll("button, [role='button']"))
    .find((el) => (el.getAttribute("aria-label") || "") === label);
  expect(b, `the "+" button (${label}) is missing`).toBeTruthy();
  (b as HTMLElement).click();
  return b as HTMLElement;
}

describe("the + button opens a BLANK add form", () => {
  it("tobacco: blanks the form and clears the edit id", () => {
    const setForm = vi.fn(), setEditId = vi.fn(), nav = vi.fn();
    const { container } = draw(<CuratorInventoryListView />, {
      view: "inv", filtered: [], statusFilter: "active",
      setForm, setEditId, nav,
    });
    plus(container, "btn_add");
    expect(setForm, "a stale working copy makes addTobacco inherit its uid")
      .toHaveBeenCalledWith(expect.objectContaining({ name: "", brand: "" }));
    expect(setForm.mock.calls[0]![0]).not.toHaveProperty("uid");
    expect(setEditId).toHaveBeenCalledWith(null);
    expect(nav).toHaveBeenCalledWith("addT");
  });

  it("pipe: blanks the form and clears the edit id", () => {
    const setPipeForm = vi.fn(), setEditPipeId = vi.fn(), nav = vi.fn();
    const { container } = draw(<CuratorPipesListView />, {
      view: "pipes", filteredPipes: [], pipeForm: STALE_PIPE,
      setPipeForm, setEditPipeId, nav,
    });
    plus(container, "btn_add_pipe");
    expect(setPipeForm).toHaveBeenCalledWith(expect.objectContaining({ name: "", brand: "" }));
    expect(setPipeForm.mock.calls[0]![0]).not.toHaveProperty("uid");
    // `BP` carries `maintenance: []` of its own, so the assertion is EMPTY
    // rather than absent — the stale log must not come across.
    expect(setPipeForm.mock.calls[0]![0].maintenance).toEqual([]);
    expect(setEditPipeId).toHaveBeenCalledWith(null);
    expect(nav).toHaveBeenCalledWith("addP");
  });

  it("accessory: blanks the form and clears the edit id", () => {
    const setAccForm = vi.fn(), setEditAccId = vi.fn(), nav = vi.fn();
    const { container } = draw(<CuratorAccListView />, {
      view: "acc", accIsActive: (a: any) => a.status === "active", accForm: STALE_ACC,
      setAccForm, setEditAccId, nav,
    });
    plus(container, "btn_add");
    expect(setAccForm).toHaveBeenCalledWith(expect.objectContaining({ name: "", brand: "" }));
    expect(setAccForm.mock.calls[0]![0]).not.toHaveProperty("uid");
    expect(setEditAccId).toHaveBeenCalledWith(null);
    expect(nav).toHaveBeenCalledWith("addA");
  });

  // The damage, stated as a property of the store rather than of the view, so
  // it survives a refactor of either: a source object carrying a uid is
  // adopted wholesale. That is CORRECT for a genuine import and wrong for the
  // "+" — which is why the fix belongs at the button, not in the store.
  it("addTobacco adopts a source uid, which is why the button must blank it", () => {
    expect(BT).not.toHaveProperty("uid");
    expect(BP).not.toHaveProperty("uid");
    expect(BA).not.toHaveProperty("uid");
    expect(STALE_TOB.uid, "fixture sanity").toBeTruthy();
  });
});
