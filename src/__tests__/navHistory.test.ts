import { describe, it, expect } from "vitest";
import {
  isFormView,
  isRestorable,
  isBareRoot,
  locIdentity,
  sameLoc,
  pushLoc,
  pushDrillOrigin,
  nextStackOnNav,
  fallbackParent,
  decideBack,
  firstOpenModal,
  type NavLoc,
} from "../utils/navHistory";

const L = (view: string, extra: Partial<NavLoc> = {}): NavLoc => ({ view, ...extra });

describe("navHistory — classifiers", () => {
  it("isFormView flags the 8 add/edit forms and nothing else", () => {
    ["addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"].forEach((v) =>
      expect(isFormView(v)).toBe(true),
    );
    ["home", "inv", "pipes", "acc", "journal", "stats", "catalog", "tasting", "help"].forEach((v) =>
      expect(isFormView(v)).toBe(false),
    );
  });

  it("isBareRoot flags a dock page with NO fiche open", () => {
    ["home", "inv", "pipes", "acc", "journal", "stats"].forEach((v) =>
      expect(isBareRoot(L(v))).toBe(true),
    );
    // a dock page WITH a fiche open is a drill state, not a bare root
    expect(isBareRoot(L("inv", { detailId: 1 }))).toBe(false);
    expect(isBareRoot(L("pipes", { pipeDetId: 2 }))).toBe(false);
    expect(isBareRoot(L("acc", { accDetId: 3 }))).toBe(false);
    // non-dock views are never bare roots
    expect(isBareRoot(L("catalog"))).toBe(false);
    expect(isBareRoot(L("editT"))).toBe(false);
  });

  it("isRestorable excludes forms, tasting, AND bare main pages", () => {
    expect(isRestorable(L("editJ"))).toBe(false);
    expect(isRestorable(L("addT"))).toBe(false);
    expect(isRestorable(L("tasting"))).toBe(false);
    // no history between main pages → bare dock pages are not restorable
    expect(isRestorable(L("inv"))).toBe(false);
    expect(isRestorable(L("journal"))).toBe(false);
    expect(isRestorable(L("stats"))).toBe(false);
    expect(isRestorable(L("home"))).toBe(false);
    // but a dock page WITH a fiche open IS a drill state → restorable
    expect(isRestorable(L("inv", { detailId: 1 }))).toBe(true);
    expect(isRestorable(L("pipes", { pipeDetId: 2 }))).toBe(true);
    // and a non-dock sub-page is restorable
    expect(isRestorable(L("catalog"))).toBe(true);
  });
});

describe("navHistory — identity", () => {
  it("identity keys on view + open-detail ids, NOT statusFilter", () => {
    expect(sameLoc(L("inv", { detailId: 1, statusFilter: "active" }), L("inv", { detailId: 1, statusFilter: "wish" }))).toBe(true);
    expect(sameLoc(L("inv", { detailId: 1 }), L("inv", { detailId: 2 }))).toBe(false);
    expect(sameLoc(L("inv"), L("pipes"))).toBe(false);
    // identity gained a 5th segment for sessionDetailId.
    expect(locIdentity(L("inv", { detailId: 5 }))).toBe("inv|5|||");
    expect(locIdentity(L("pipes", { pipeDetId: 9 }))).toBe("pipes||9||");
    expect(locIdentity(L("journal", { sessionDetailId: 7 }))).toBe("journal||||7");
  });
});

describe("navHistory — pushLoc", () => {
  it("appends a restorable (drill / non-dock) location", () => {
    const s = pushLoc([], L("inv", { detailId: 1 }));
    expect(s.map((x) => x.view)).toEqual(["inv"]);
    const s2 = pushLoc(s, L("pipes", { pipeDetId: 2 }));
    expect(s2).toHaveLength(2);
  });

  it("never pushes a BARE main page — no history between dock tabs", () => {
    expect(pushLoc([], L("home"))).toHaveLength(0);
    expect(pushLoc([], L("inv"))).toHaveLength(0);
    expect(pushLoc([], L("pipes"))).toHaveLength(0);
    expect(pushLoc([], L("journal"))).toHaveLength(0);
    expect(pushLoc([], L("stats"))).toHaveLength(0);
  });

  it("never pushes a form or the tasting view", () => {
    expect(pushLoc([L("catalog")], L("editJ"))).toHaveLength(1);
    expect(pushLoc([L("catalog")], L("tasting"))).toHaveLength(1);
  });

  it("de-dups against the top (same identity)", () => {
    const s = pushLoc([L("inv", { detailId: 1 })], L("inv", { detailId: 1 }));
    expect(s).toHaveLength(1);
    // a different detail id IS a new screen
    expect(pushLoc([L("inv", { detailId: 1 })], L("inv", { detailId: 2 }))).toHaveLength(2);
  });

  it("caps the depth, dropping the oldest", () => {
    let s: NavLoc[] = [];
    for (let i = 0; i < 50; i++) s = pushLoc(s, L("sub" + i), 40); // non-dock → restorable
    expect(s).toHaveLength(40);
    expect(s[0]!.view).toBe("sub10"); // 0..9 dropped
    expect(s[s.length - 1]!.view).toBe("sub49");
  });
});

describe("navHistory — pushDrillOrigin", () => {
  it("RECORDS a bare-root origin like Home (unlike pushLoc)", () => {
    expect(pushDrillOrigin([], L("home")).map(x => x.view)).toEqual(["home"]);
    expect(pushDrillOrigin([], L("inv")).map(x => x.view)).toEqual(["inv"]);
  });
  it("still skips FORMS (never a back target)", () => {
    expect(pushDrillOrigin([L("home")], L("editJ"))).toHaveLength(1);
  });

  // This REVERSES the tasting half of the case, which used to read
  // `pushDrillOrigin([L("home")], L("tasting"))).toHaveLength(1)`.
  //
  // An earlier release made a running tasting's tobacco/pipe rows open their fiche, and
  // the report was immediate: « le swipe back ne me ramène pas dans la
  // session ». A tasting IS a place you come back to. It stays out of `pushLoc`
  // (never an ordinary history entry — see isRestorable, still asserted below);
  // only an explicit drill records it.
  //
  // The objection that kept it out — the 95-min auto-end can clear the session
  // while the user reads the fiche, and nav("tasting") would then paint an empty
  // screen — is real, and is answered in decideBack (`tastingLive`), not by
  // refusing to record the origin. Do not "restore" the old exclusion.
  it("RECORDS a running tasting as a drill origin (reversal)", () => {
    expect(pushDrillOrigin([L("home")], L("tasting")).map(x => x.view))
      .toEqual(["home", "tasting"]);
  });
  it("but a tasting is still NOT an ordinary history entry", () => {
    expect(isRestorable(L("tasting"))).toBe(false);
    expect(pushLoc([L("home")], L("tasting"))).toHaveLength(1);
  });
  it("de-dups against the top + caps depth", () => {
    expect(pushDrillOrigin([L("home")], L("home"))).toHaveLength(1);
    let s: NavLoc[] = [];
    for (let i = 0; i < 50; i++) s = pushDrillOrigin(s, L("home" + i), 40);
    expect(s).toHaveLength(40);
  });

  // A drill origin is stamped `drill:true` so applyLoc
  // can tell it from a normal nav() push of the same screen shape (pushLoc).
  it("stamps drill:true on the pushed entry (pushLoc does NOT)", () => {
    const drilled = pushDrillOrigin([], { view: "stats" });
    expect(drilled[0]!.drill).toBe(true);
    const normal = pushLoc([], { view: "inv", detailId: "X" });
    expect(normal[0]!.drill).toBeUndefined();
  });

  it("the drill flag is METADATA — excluded from identity/de-dup", () => {
    // A drilled `inv+detailX` and a plain-pushed `inv+detailX` are the SAME
    // screen, so pushing the second over the first de-dups.
    const s = pushDrillOrigin([{ view: "inv", detailId: "X" }], { view: "inv", detailId: "X" });
    expect(s).toHaveLength(1);
  });
});

describe("navHistory — nextStackOnNav (clear-on-root)", () => {
  it("RESETS the stack when navigating to any main/dock page", () => {
    const stack = [L("inv", { detailId: 1 }), L("pipes", { pipeDetId: 2 })];
    ["home", "inv", "pipes", "acc", "journal", "stats"].forEach((root) => {
      expect(nextStackOnNav(stack, root, L("acc", { accDetId: 9 }))).toEqual([]);
    });
  });

  it("the reported bug: leaving an OPEN fiche via a dock tab does NOT stack it", () => {
    // acc fiche open → tap Journal (dock): the leaving loc is a drill state,
    // but the TARGET is a main page → stack is cleared, so back from Journal
    // goes to Home (not back to the accessory fiche).
    const after = nextStackOnNav([], "journal", L("acc", { accDetId: 5 }));
    expect(after).toEqual([]);
  });

  it("pushes the leaving screen when drilling into a SUB-screen (form/detail)", () => {
    // detail → edit: target editT is not a root → record the fiche.
    const after = nextStackOnNav([], "editT", L("inv", { detailId: 7 }));
    expect(after).toEqual([L("inv", { detailId: 7 })]);
  });

  it("does not stack a bare main page even when drilling (pushLoc still filters it)", () => {
    // inv (bare) → catalog: target catalog is a sub-screen, but the leaving inv
    // is a bare root → not recorded; back from catalog falls back to inv.
    expect(nextStackOnNav([], "catalog", L("inv"))).toEqual([]);
  });
});

describe("navHistory — firstOpenModal", () => {
  it("returns null when no modal is open", () => {
    expect(firstOpenModal({})).toBeNull();
    expect(firstOpenModal({ lightbox: false, search: false, trash: false, settings: false })).toBeNull();
  });
  it("closes the front-most modal in priority order", () => {
    expect(firstOpenModal({ lightbox: true, settings: true })).toBe("lightbox");
    expect(firstOpenModal({ search: true, trash: true, settings: true })).toBe("search");
    expect(firstOpenModal({ trash: true, settings: true })).toBe("trash");
    expect(firstOpenModal({ settings: true })).toBe("settings");
  });
});

describe("navHistory — fallbackParent", () => {
  it("maps forms to their list, catalog to inv, others to home, home to null", () => {
    expect(fallbackParent("editT")).toBe("inv");
    expect(fallbackParent("addT")).toBe("inv");
    expect(fallbackParent("catalog")).toBe("inv");
    expect(fallbackParent("editP")).toBe("pipes");
    expect(fallbackParent("editA")).toBe("acc");
    expect(fallbackParent("editJ")).toBe("journal");
    expect(fallbackParent("stats")).toBe("home");
    expect(fallbackParent("journal")).toBe("home");
    expect(fallbackParent("home")).toBeNull();
  });
});

describe("navHistory — decideBack (the whole routing)", () => {
  const base = { view: "inv", hasDetail: false, hasPipeDet: false, hasAccDet: false, hasWishForm: false, stack: [] as NavLoc[] };

  it("closes an open overlay in place when the stack is EMPTY (normal list → fiche)", () => {
    expect(decideBack({ ...base, hasDetail: true, stack: [] })).toEqual({ kind: "close-detail" });
    expect(decideBack({ ...base, hasPipeDet: true })).toEqual({ kind: "close-pipe" });
    expect(decideBack({ ...base, hasAccDet: true })).toEqual({ kind: "close-acc" });
    expect(decideBack({ ...base, hasWishForm: true })).toEqual({ kind: "close-wish" });
  });

  it("an overlay opened via a recorded DRILL pops to its origin — incl. bare-root Home", () => {
    // Home → "du moment" tabac → tobacco fiche. crossOpenDetail recorded Home
    // on the stack AND marked the overlay drillOpened; back must return to Home,
    // NOT close the fiche to the list.
    const home = L("home");
    expect(decideBack({ ...base, view: "inv", hasDetail: true, drillOpened: true, stack: [home] }))
      .toEqual({ kind: "pop", loc: home, rest: [] });
    expect(decideBack({ ...base, view: "pipes", hasPipeDet: true, drillOpened: true, stack: [home] }))
      .toEqual({ kind: "pop", loc: home, rest: [] });
    // Wishlist opened from a Home tile: the wishlist sub-state over a recorded
    // origin also pops to Home instead of the close-wishlist reset.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, drillOpened: true, stack: [home] }))
      .toEqual({ kind: "pop", loc: home, rest: [] });
    // But the wishlist reached normally (from the inv list, empty stack) still
    // resets to the active tobacco list.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, stack: [] }))
      .toEqual({ kind: "close-wishlist" });
  });

  it("the wish FORM over a Home-drilled wishlist closes in place, not pop-to-Home", () => {
    const home = L("home");
    // Home → Envies tile (drillOpened + isWishlist, Home on the stack) → open the
    // wish form. Back must CLOSE THE FORM (close-wish), not pop to Home — the
    // form is layered on top of the still-drilled wishlist. The NEXT back (form
    // gone) then pops to Home.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, hasWishForm: true, drillOpened: true, stack: [home] }))
      .toEqual({ kind: "close-wish" });
    // After the form closes, the drilled wishlist pops to Home as before.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, hasWishForm: false, drillOpened: true, stack: [home] }))
      .toEqual({ kind: "pop", loc: home, rest: [] });
  });

  it("a NON-drill fiche closes in place even with an origin on the stack", () => {
    // Stats → "Top tabacs" bar → filtered inv list (records Stats on the stack)
    // → open a tobacco fiche NORMALLY. drillOpened is false (ctxSetDetail), so
    // back must CLOSE the fiche to the filtered list, not skip to Stats.
    const stats = L("stats");
    expect(decideBack({ ...base, view: "inv", hasDetail: true, drillOpened: false, stack: [stats] }))
      .toEqual({ kind: "close-detail" });
    expect(decideBack({ ...base, view: "pipes", hasPipeDet: true, drillOpened: false, stack: [stats] }))
      .toEqual({ kind: "close-pipe" });
    // …and the wishlist toggled from a filtered list still resets in place.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, drillOpened: false, stack: [stats] }))
      .toEqual({ kind: "close-wishlist" });
  });

  it("cross-fiche drill pops to the previous fiche instead of closing to the list", () => {
    // Tobacco fiche → tap a paired pipe → pipe fiche. Back must return to the
    // tobacco fiche (stack top), NOT close the pipe fiche to the pipe list.
    expect(decideBack({ ...base, view: "pipes", hasPipeDet: true, drillOpened: true, stack: [L("inv", { detailId: 7 })] }))
      .toEqual({ kind: "pop", loc: L("inv", { detailId: 7 }), rest: [] });
    // Mirror: pipe fiche → tap a paired tobacco → tobacco fiche → back → pipe fiche.
    expect(decideBack({ ...base, view: "inv", hasDetail: true, drillOpened: true, stack: [L("pipes", { pipeDetId: 3 })] }))
      .toEqual({ kind: "pop", loc: L("pipes", { pipeDetId: 3 }), rest: [] });
    // But the NORMAL list → fiche (empty stack) still closes to the list.
    expect(decideBack({ ...base, view: "pipes", hasPipeDet: true, stack: [] }))
      .toEqual({ kind: "close-pipe" });
  });

  it("a fiche cross-opened from the session modal pops back to the modal", () => {
    // Journal session modal → tap the tabac block → tobacco fiche. Back must
    // re-open the session modal (the stack top carries sessionDetailId), NOT
    // close the fiche to the tobacco list.
    const modalLoc = L("journal", { sessionDetailId: 42 });
    expect(decideBack({ ...base, view: "inv", hasDetail: true, drillOpened: true, stack: [modalLoc] }))
      .toEqual({ kind: "pop", loc: modalLoc, rest: [] });
    // A journal loc with a session modal open is NOT a bare root, so it IS
    // restorable / history-worthy.
    expect(isBareRoot(modalLoc)).toBe(false);
    expect(isRestorable(modalLoc)).toBe(true);
  });

  it("closes the session-detail modal in place — stays on Journal", () => {
    // journal + session modal open + a non-empty stack: the modal wins over
    // the stack pop, so swipe-back closes it instead of navigating away.
    expect(decideBack({ ...base, view: "journal", hasSessionDetail: true, stack: [L("inv", { detailId: 1 })] }))
      .toEqual({ kind: "close-session" });
  });

  it("leaves the wishlist back to the tobacco list, not Home", () => {
    // inv + statusFilter=wish → back resets the filter (close-wishlist), it
    // does NOT fall through to Home.
    expect(decideBack({ ...base, view: "inv", isWishlist: true, stack: [] }))
      .toEqual({ kind: "close-wishlist" });
    // but an overlay still wins over the wishlist reset
    expect(decideBack({ ...base, view: "inv", isWishlist: true, hasDetail: true }))
      .toEqual({ kind: "close-detail" });
  });

  it("main pages fall back to Home — no history between main pages (the reported ask)", () => {
    expect(decideBack({ ...base, view: "stats", stack: [] })).toEqual({ kind: "nav", target: "home" });
    expect(decideBack({ ...base, view: "journal", stack: [] })).toEqual({ kind: "nav", target: "home" });
    expect(decideBack({ ...base, view: "pipes", stack: [] })).toEqual({ kind: "nav", target: "home" });
  });

  it("a form falls back to its own list when the stack is empty", () => {
    expect(decideBack({ ...base, view: "editJ", stack: [] })).toEqual({ kind: "nav", target: "journal" });
    expect(decideBack({ ...base, view: "editP", stack: [] })).toEqual({ kind: "nav", target: "pipes" });
  });

  it("pops a DRILL state so detail → edit → back returns to the fiche", () => {
    const a = decideBack({ ...base, view: "editT", stack: [L("inv", { detailId: 7 })] });
    expect(a).toEqual({ kind: "pop", loc: L("inv", { detailId: 7 }), rest: [] });
  });

  it("pipe fiche → family filter → back returns to the pipe fiche", () => {
    // navToInvFiltered records the open pipe fiche via pushDrillOrigin, then
    // clears the fiche and lands on a FILTERED inv list (no overlay open). Back
    // must pop to the pipe fiche, not fall through to Home.
    const pipeFiche = L("pipes", { pipeDetId: 4 });
    const a = decideBack({ ...base, view: "inv", stack: [pipeFiche] });
    expect(a).toEqual({ kind: "pop", loc: pipeFiche, rest: [] });
  });

  it("Stats drill → filtered list → back returns to Stats", () => {
    // Every navTo* helper records the origin page (here Stats) via
    // pushDrillOrigin, then lands on a filtered list with NO overlay open. Back
    // pops to Stats instead of falling through to Home (fallbackParent).
    const stats = L("stats");
    expect(decideBack({ ...base, view: "inv", stack: [stats] }))
      .toEqual({ kind: "pop", loc: stats, rest: [] });
    expect(decideBack({ ...base, view: "pipes", stack: [stats] }))
      .toEqual({ kind: "pop", loc: stats, rest: [] });
    expect(decideBack({ ...base, view: "journal", stack: [stats] }))
      .toEqual({ kind: "pop", loc: stats, rest: [] });
  });

  it("carries the popped screen's status filter (re-applied on restore)", () => {
    const a = decideBack({ ...base, view: "editT", stack: [L("inv", { detailId: 3, statusFilter: "finished" })] });
    expect((a as any).loc.statusFilter).toBe("finished");
  });

  it("is a no-op at home with an empty stack (root)", () => {
    expect(decideBack({ ...base, view: "home", stack: [] })).toEqual({ kind: "none" });
  });
});

// back from a fiche opened DURING a tasting returns to the
// tasting. Reported made those rows tappable:
// « le swipe back ne me ramène pas dans la session ».
//
// The load-bearing half is the second describe: a tasting is the ONE origin
// that can vanish on its own (the 95-minute auto-end, or the user ending it
// from the banner). Popping to it then would call nav("tasting") on a view
// whose only render gate is `view !== "tasting"` — an empty screen with no way
// to explain itself. `tastingLive` is what stops that, and dropping the entry
// (rather than blocking the pop) keeps the rest of the chain intact.
describe("navHistory — back to a running tasting", () => {
  const drill = (view: string, over: any = {}) =>
    Object.assign({ view, statusFilter: "active", drill: true }, over) as NavLoc;

  it("pops to the tasting when the session is still live", () => {
    const a = decideBack({
      view: "inv", hasDetail: true, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, drillOpened: true, tastingLive: true,
      stack: [drill("tasting")],
    });
    expect(a.kind).toBe("pop");
    expect((a as any).loc.view).toBe("tasting");
  });

  it("works for the pipe fiche too", () => {
    const a = decideBack({
      view: "pipes", hasDetail: false, hasPipeDet: true, hasAccDet: false,
      hasWishForm: false, drillOpened: true, tastingLive: true,
      stack: [drill("tasting")],
    });
    expect((a as any).loc?.view).toBe("tasting");
  });
});

describe("navHistory — a tasting that ended is never a back target", () => {
  const drill = (view: string) =>
    ({ view, statusFilter: "active", drill: true }) as NavLoc;

  it("closes the fiche in place instead of navigating to a dead tasting", () => {
    const a = decideBack({
      view: "inv", hasDetail: true, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, drillOpened: true, tastingLive: false,
      stack: [drill("tasting")],
    });
    // The stack is empty once the dead origin is dropped, so the drill-pop
    // branch does not fire and the fiche closes to its list — exactly as if the
    // tasting had never been recorded.
    expect(a.kind).toBe("close-detail");
  });

  it("keeps popping to whatever sits UNDER the dead tasting", () => {
    const a = decideBack({
      view: "inv", hasDetail: true, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, drillOpened: true, tastingLive: false,
      stack: [drill("stats"), drill("tasting")],
    });
    expect(a.kind).toBe("pop");
    expect((a as any).loc.view).toBe("stats");
  });

  it("drops a whole run of dead tasting entries, not just the top one", () => {
    const a = decideBack({
      view: "inv", hasDetail: false, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, tastingLive: false,
      stack: [drill("journal"), drill("tasting"), drill("tasting")],
    });
    expect((a as any).loc.view).toBe("journal");
  });

  it("falls through to the parent when the stack held ONLY a dead tasting", () => {
    const a = decideBack({
      view: "stats", hasDetail: false, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, tastingLive: false,
      stack: [drill("tasting")],
    });
    expect(a.kind).toBe("nav");
  });

  it("leaves a live stack untouched — the pruning is scoped to tasting", () => {
    const stack = [drill("stats"), drill("journal")];
    const a = decideBack({
      view: "inv", hasDetail: true, hasPipeDet: false, hasAccDet: false,
      hasWishForm: false, drillOpened: true, tastingLive: false, stack,
    });
    expect((a as any).loc.view).toBe("journal");
  });
});
