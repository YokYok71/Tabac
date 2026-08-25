import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import { useTobaccoStore } from "../hooks/useTobaccoStore.ts";
import { INIT } from "../constants.ts";

/**
 * The auto-update must never reload on top of unsaved input.
 *
 * WHY THIS IS A SOURCE TEST. `deferAutoUpdate` is one expression inside App's
 * useAppUpdate call, and reproducing it through a render would mean mounting
 * the whole app in six states. What actually rots here is the LIST: someone
 * adds a form-bearing surface and forgets this predicate, and nothing breaks
 * visibly — the user just loses what they typed, occasionally, to a reload
 * that on the silent path has no countdown to cancel.
 *
 * The reason this matters more than it looks: the update does NOT wait for the
 * user to accept. The visible banner is a 10-second veto window that fires by
 * itself, and the data_only path fires with no banner at all. So this
 * predicate IS the protection for unsaved work — there is no second gate.
 */
const APP = readFileSync("src/App.tsx", "utf8");
const DEFER = (function () {
  const i = APP.indexOf("deferAutoUpdate: !!(");
  expect(i).toBeGreaterThan(-1);          // non-vacuity: the predicate exists
  return APP.slice(i, APP.indexOf("),", i));
})();

describe("deferAutoUpdate covers every surface holding unsaved input", () => {
  it("defers for an active tasting, in BOTH stages", () => {
    // A silent data-only update firing on visibilitychange during
    // "setup" reloaded the app mid-setup.
    expect(DEFER).toContain('tasting.stage === "running"');
    expect(DEFER).toContain('tasting.stage === "setup"');
  });

  it("defers for all eight full-screen add/edit form views", () => {
    ["addT", "editT", "addP", "editP", "addA", "editA", "addJ", "editJ"]
      .forEach((v) => expect(DEFER).toContain('"' + v + '"'));
  });

  it("defers for the lot modal — through the flag the MODAL reports, not the store's", () => {
    // THIS CASE USED TO ASSERT `DEFER.toContain("lotForm")` AND THAT WAS
    // SATISFIED BY A CLAUSE THAT WAS ALWAYS TRUE.
    //
    // `ctx.lotForm` comes from `useTobaccoStore`, seeded
    // `useState(Object.assign({}, BL))` — a POPULATED object — and never once
    // set to null (its two writers assign another `{...BL}`). So
    // `(lotForm && view === "inv" && !!detail)` collapsed to
    // `view === "inv" && !!detail`: ANY open tobacco fiche deferred every
    // update, and Settings → Application said « la fiche d'un lot est
    // ouverte. Fermez-la » with nothing to close. Backgrounding from a fiche
    // also made the SILENT data-only path skip, so translation releases sat
    // undelivered.
    //
    // The real modal is LOCAL state in `InventoryDetailView` that SHADOWS the
    // ctx name — which is why the ctx one looked wired. It reports itself now,
    // exactly as the maintenance modal does.
    //
    // A source assertion cannot see that a value is always truthy; the case
    // below drives the store and shows it.
    expect(DEFER).toContain("lotFormOpen");
    const INV = readFileSync("src/views/curator/InventoryDetailView.tsx", "utf8");
    expect(INV).toContain("setLotFormOpen");
    // Cleared on unmount, or leaving the fiche with the modal open would
    // block every update for the rest of the session — invisibly.
    expect(INV).toMatch(/return function \(\) \{[^}]*setLotFormOpen\(false\)/);
  });

  it("the store's `lotForm` really is always truthy — the old clause was a constant", () => {
    // Non-vacuity for the case above, and the only way to SHOW the defect:
    // it is a property of the VALUE, invisible to any source check.
    const { result } = renderHook(() => useTobaccoStore({
      data: { ...INIT }, save: () => {}, nav: () => {}, weightUnit: "g",
    } as any));
    expect(result.current.lotForm, "seeded from BL, so never falsy").toBeTruthy();
  });

  it("defers for the WISHLIST overlay", () => {
    // Excluded on the grounds that showWishForm/editWishId
    // were "composed after this hook". Nothing between the two hooks consumed
    // useAppUpdate's return, so the call moved below useWishStore. Being an
    // overlay rather than a `view` key is a routing detail: it is a full
    // add/edit form and it even registers with useUnsavedFormGuard.
    expect(DEFER).toContain("showWishForm");
    expect(DEFER).toContain("editWishId");
  });

  it("defers for the pipe MAINTENANCE modal", () => {
    // Its state is local to PipesDetailView, which App cannot see, so the
    // modal reports itself through ctx.setMaintFormOpen. "Lower-stakes" was
    // never the test: a reload discards a half-written maintenance note just
    // as completely as anything else.
    expect(DEFER).toContain("maintFormOpen");
    const PIPES = readFileSync("src/views/curator/PipesDetailView.tsx", "utf8");
    // CETTE ASSERTION ÉTAIT CREUSE, ET C'EST ELLE QUI PRÉTENDAIT GARANTIR LE
    // SIGNAL. Elle cherchait `setMaintFormOpen` n'importe où dans le fichier —
    // or la chaîne survit dans la déclaration (`const setMaintFormOpen =
    // ctx.setMaintFormOpen`) ET dans le nettoyage ci-dessous, si bien que
    // SONDÉ, supprimer l'appel qui signale l'OUVERTURE laissait les 17 cas
    // verts. Elle exige maintenant l'appel avec son argument, ce qui est
    // strictement plus fort. **Mais ce n'est pas ici que le signal est
    // garanti** : le bloc « la modale d'entretien se déclare » de
    // `PipesDetailView.test.tsx` pilote le vrai composant et rougit sur cette
    // mutation. Ce fichier verrouille le CÂBLAGE, l'autre le COMPORTEMENT.
    expect(PIPES).toContain("setMaintFormOpen(maintFormIsOpen)");
    // …and it must CLEAR on unmount, or leaving the fiche with the modal open
    // would block every future update for the rest of the session.
    expect(PIPES).toMatch(/return function \(\) \{[^}]*setMaintFormOpen\(false\)/);
  });

  it("the hook call sits AFTER useWishStore, which is what makes this possible", () => {
    // Guards the move: putting useAppUpdate back above useWishStore would make
    // showWishForm a ReferenceError rather than a silent gap, but a future
    // reorder should fail here with an explanation instead.
    expect(APP.indexOf("} = useWishStore({")).toBeLessThan(APP.indexOf("} = useAppUpdate({"));
  });
});

/**
 * A deferring state must be VISIBLE.
 *
 * Reported from the app: Settings said "En attente : une saisie est en cours
 * (formulaire ou dégustation)" while the user was on the Home screen with
 * nothing open. The cause: `deferAutoUpdate` blocks on a tasting in the
 * "setup" stage (a silent reload mid-setup was a real bug), but
 * NOTHING showed such a tasting. TastingBanner renders only for `running`
 * (`stage !== "running"` → null) and the Home CTA read `tasting.stage ===
 * "running"`, so it offered "Démarrer une dégustation".
 *
 * A tasting abandoned at the tobacco-picking step therefore persisted in
 * cave-tasting-active across relaunches and blocked every automatic update
 * indefinitely, with no sign anywhere. It took the "why is it
 * waiting" line to make it findable at all.
 */
describe("a deferring state cannot be invisible", () => {
  const HOME = readFileSync("src/views/curator/HomeViewV2.tsx", "utf8");

  it("the Home CTA offers to resume a SETUP-stage tasting, not to start a new one", () => {
    const decl = HOME.slice(HOME.indexOf("const tastingRunning ="));
    const line = decl.slice(0, decl.indexOf(";") + 1);
    expect(line).toContain('"setup"');
    expect(line).toContain('"running"');
  });

  it("…and that is the same predicate deferAutoUpdate blocks on", () => {
    // If the two ever diverge, an invisible blocking state returns.
    expect(DEFER).toContain('tasting.stage === "setup"');
  });

  it("Settings names WHICH surface is holding it", () => {
    // The old copy said "formulaire ou dégustation" — a guess the user then had
    // to resolve, and in the reported case the answer was a tasting they did
    // not know existed. App knows which clause fired; it now says so.
    const APP_SRC = readFileSync("src/App.tsx", "utf8");
    expect(APP_SRC).toContain('deferReason:');
    const SET = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    expect(SET).toContain("upd_why_deferred_tasting");
    expect(SET).toContain("upd_why_deferred_form");
    // and the vague key is gone, not merely unused
    const FR = readFileSync("src/i18n/fr.ts", "utf8");
    expect(FR).not.toMatch(/^\s*upd_why_deferred:/m);
  });
});

/**
 * The predicate describes what is ON SCREEN.
 *
 * `lotForm` and `maintFormOpen` are modals rendered INSIDE a detail view that
 * returns null the moment you leave it (`InventoryDetailView` on
 * `view !== "inv" || !detail`; `PipesDetailView` likewise). Nothing clears
 * their state on navigation — the invariant forbids nav() from
 * resetting form state, correctly. So tapping a lot and then tapping the dock
 * left `lotForm` armed for ever: the modal vanished from the screen and the
 * update stayed blocked, invisibly and with no way to clear it. An entirely
 * ordinary sequence, and the most likely explanation for a device that never
 * auto-updates.
 *
 * Same class as the setup tasting. There the fix was to make the
 * state visible; here it is genuinely off-screen, so it must stop blocking.
 */
describe("only ON-SCREEN state may block the update", () => {
  it("the lot modal blocks only while its fiche is open", () => {
    // REVERSAL, recorded on the assertion: this used to pin
    // `lotForm && view === "inv" && !!detail`, and the guard it was written to
    // lock was doing nothing. `ctx.lotForm` (the STORE's, shadowed by the
    // modal's own local state) is seeded from the populated `BL` template and
    // never set to null, so the first term was a constant and the clause meant
    // "a tobacco FICHE is open" — which is not a form, and blocked every
    // update from an ordinary browse screen. The fiche gate is the part that
    // was always right and is kept.
    expect(DEFER).toContain('lotFormOpen && view === "inv" && !!detail');
    expect(DEFER, "the store's always-truthy lotForm must not come back")
      .not.toContain('lotForm && view === "inv"');
  });

  it("the maintenance modal blocks only while its fiche is open", () => {
    expect(DEFER).toContain('maintFormOpen && view === "pipes" && !!pipeDet');
  });

  it("the wishlist overlay needs no such guard — its gate IS the predicate", () => {
    // WishFormView renders on exactly `showWishForm || editWishId` (its own
    // line 185), so the state and the visibility cannot diverge. Asserted so a
    // future refactor that moves it inside a view has to revisit this.
    const WISH = readFileSync("src/views/curator/WishFormView.tsx", "utf8");
    expect(WISH).toContain("if (!showWishForm && !editWishId) return null;");
    expect(DEFER).toContain("showWishForm || editWishId");
  });

  it("Settings can name each of the five sources", () => {
    const SET = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    ["tasting", "maint", "wish", "lot", "form"].forEach((k) =>
      expect(SET).toContain("upd_why_deferred_" + k));
  });
});

/**
 * A BLANK setup could block every automatic update for ever.
 *
 * The rule above is right and is untouched: `deferAutoUpdate` must block on a
 * `setup`-stage tasting. What was missing is the other end — NOTHING cleared
 * one on the way out. `decideBack` routes `tasting` through `fallbackParent`
 * to home without cancelling, so `cave-tasting-active` survives a relaunch
 * carrying `{stage:"setup"}` and the predicate goes on returning true, on a
 * screen the user left days ago. An earlier release met the same state from the other
 * side — it made such a tasting visible and resumable, which is the way out —
 * and did not stop it being created.
 *
 * A NEW USER reaches it unaided: the Home's CTA is « Démarrer une
 * dégustation », the setup needs a tobacco AND a pipe, and a fresh install has
 * neither — so the screen is genuinely unusable for them and a system-back is
 * the natural exit.
 *
 * ONLY a setup with nothing chosen is discarded. That is not work; there is
 * literally nothing in it. The narrowness is the whole safety of the fix.
 */
describe("goBack discards a BLANK setup tasting", () => {
  // Length-preserving comment blanking — three earlier releases each shipped a
  // check that was satisfied by the comment explaining the fix.
  const CODE = APP
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

  it("cancels it on the way out", () => {
    expect(CODE).toMatch(/view === "tasting"[\s\S]{0,200}?tasting\.stage === "setup"[\s\S]{0,200}?tastingCancel\(\)/);
  });

  it("…and ONLY when nothing has been chosen", () => {
    // A setup where the user picked a tobacco or a pipe is work in progress:
    // discarding it would be the opposite defect, and a silent one.
    const i = CODE.indexOf('view === "tasting" && tasting');
    expect(i, "the guard moved — re-read it before editing this test").toBeGreaterThan(-1);
    const guard = CODE.slice(i, CODE.indexOf("tastingCancel()", i));
    expect(guard).toContain("!tasting.tobaccoId");
    expect(guard).toContain("!tasting.pipeId");
  });

  it("the rule is untouched — the predicate still defers on setup", () => {
    // This removes the EMPTY state; it must not stop deferring on a real one.
    expect(DEFER).toContain('tasting.stage === "setup"');
  });
});
