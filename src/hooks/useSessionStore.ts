import React from "react";
import { BJ } from "../constants.ts";
import { pickJarLot, applyLotWeightDelta, roundWeightToUnit } from "../utils/lotUtils.ts";
import { toggleCollapseKey, findById, entitySnapshot, safeWeight as safeW, isUntrackedWeight, latestSessionMonthSeed, newUid } from "../utils.ts";
import { LANG } from "../i18n.ts";

var useState = React.useState;
var useEffect = React.useEffect;
var useRef = React.useRef;

// Resolve a UI string in the active language (hooks can't reach ctx.t).
// Falls back to ENGLISH: it is the only dictionary compiled in, so
// it is the only one guaranteed present. French was the fallback while all five
// were static; now an un-loaded language would have resolved to `undefined`.
function tr(lang: string | undefined, key: string): string {
  var dict = (LANG as any)[lang || "en"] || LANG.en;
  return dict[key] || (LANG.en as any)[key] || key;
}

export function useSessionStore({
  data,
  save,
  latestData,
  nav,
  weightUnit,
  setSaveError,
  lang,
}: {
  data: any;
  save: (d: any) => void;
  /** The FRESHEST committed cellar (App's `latestDataRef`), optional so every
   *  existing caller and test keeps working. `SessionFormView.submit` commits
   *  the tasting-notes draft and THEN saves the session, both inside one
   *  handler — React has not re-rendered between them, so a session payload
   *  built from the render's `data` overwrites the notes write. See App.tsx. */
  latestData?: () => any;
  nav: (v: string, opts?: { restoreScroll?: boolean }) => void;
  weightUnit: string;
  setSaveError?: (msg: string | null) => void;
  lang?: string;
}) {
  // The base every mutation below builds on. Falls back to the render snapshot
  // when App did not hand a ref down (tests, and any future caller).
  function fresh(): any {
    return latestData ? latestData() : data;
  }
  var _jf = useState(Object.assign({}, BJ)),
    sessForm = _jf[0],
    setSessForm = _jf[1];
  var _ej = useState<any>(null),
    editSessId = _ej[0],
    setEditSessId = _ej[1];
  // The journal grouping is DECOUPLED from the global
  // "default list grouping" setting (cave-default-grouped) — it always starts
  // GROUPED (its own ToggleBtn still lets the user flatten it). Otherwise
  // turning the global setting to a flat list made the journal flat too, so
  // the "collapse all but the latest month" default silently did nothing.
  var _sg = useState(true),
    sessGrouped = _sg[0],
    setSessGrouped = _sg[1];
  var _csg = useState<Record<string, any>>({}),
    collapsedSessGroups = _csg[0],
    setCollapsedSessGroups = _csg[1];
  // Once sessions have loaded, expand ONLY the month of the most
  // recent session (current month when it has sessions, else the last month
  // present); everything else stays collapsed. One-shot; the normal toggle
  // takes over after. `Object.assign({}, seed, prev)` lets any user toggle win.
  var _seedRef = useRef(false);
  useEffect(function () {
    if (_seedRef.current) return;
    var seed = latestSessionMonthSeed((data && data.sessions) || []);
    if (!Object.keys(seed).length) return; // no sessions yet — wait
    _seedRef.current = true;
    setCollapsedSessGroups(function (prev: any) {
      return Object.assign({}, seed, prev);
    });
  }, [data]);

  function _persistSession(form: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    if (!form.date) return false;
    // Round the recorded weight to the deduction grid so the stored
    // session weightG and the lot debit are byte-identical (no sub-grid Σ drift
    // → no false lot-balance-overflow after many hand-typed >1 dp sessions).
    var w = roundWeightToUnit(safeW(form.weightG), weightUnit);
    var resolvedLotId = form.lotId;
    if (w > 0 && form.tobaccoId && !resolvedLotId) {
      var refT = findById<any>(data.tobaccos, form.tobaccoId);
      if (refT) {
        var jl = pickJarLot(refT, weightUnit);
        if (jl && jl.lot.id) resolvedLotId = String(jl.lot.id);
      }
    }
    // Refuse the save when weight > 0 but no lot could be resolved
    //. Without this guard the session would be persisted
    // with an empty lotId AND applyLotWeightDelta would silently
    // skip the deduction (lotId="" makes findIndex return -1 and
    // its delta<0 path has no fallback) — the recorded weight then
    // becomes an off-the-books quantity, breaking the accounting
    // invariant Σ(sessions.weightG) === weightInitial - weightG.
    if (w > 0 && form.tobaccoId && !resolvedLotId) {
      if (setSaveError) {
        setSaveError(tr(lang, "sess_err_no_open_lot"));
      }
      return false;
    }
    // Cap to the lot's actual balance so the session never records more than available.
    // Also refuse the save if the targeted lot is still in "cellar"
    // status. The SessionFormView modal flow promotes
    // the lot to "jar" before invoking the persistence path, so a
    // cellar lot reaching _persistSession means a programmatic caller
    // (tasting end with a cellar lot edited mid-flight, an import,
    // etc.) — silently deducting from a sealed cellar lot would
    // corrupt the lifecycle invariants and the user's mental model.
    var capExists = false;
    if (w > 0 && resolvedLotId) {
      var capT = findById<any>(data.tobaccos, form.tobaccoId);
      if (capT) {
        var capL = findById<any>(capT.lots, resolvedLotId);
        if (capL && capL.status === "cellar") {
          if (setSaveError) {
            setSaveError(tr(lang, "sess_err_cellar_lot"));
          }
          return false;
        }
        // The FIFTH reader of the untracked-weight notion, and
        // the one the original sweep missed. This cap exists so a session can never
        // record more than the lot actually holds; against an UNWEIGHED lot
        // `safeW("")` is 0, so it capped every session to 0 g — silently, on
        // the nominal path that sweep had just opened. The user picks the tin,
        // the estimate fills 2.5 g, they save, and the journal stores nothing.
        //
        // There is no known balance to cap against on such a lot, so there is
        // no cap. The lot itself stays untouched (stepApplyDelta returns it
        // verbatim), which is what keeps it out of the balance rules.
        if (capL) {
          if (!isUntrackedWeight(capL.weightG)) w = Math.min(w, safeW(capL.weightG));
          capExists = true;
        }
      }
    }
    // If the resolved lot doesn't actually EXIST (a stale or
    // imported form.lotId pointing at a since-deleted lot), do NOT keep the id.
    // Passing a dangling id to applyLotWeightDelta falls through locateLotIdx to
    // pickJarLot and MISDIRECTS the deduction onto a different jar lot — the
    // misdirection class its updateSession sibling closed earlier. Orphan the
    // session (lotId "") so neither the deduction below nor a later delete-
    // restore can hit the wrong lot; the recorded weight becomes untracked,
    // which is the safe outcome (matches an accounting-off / orphan session).
    if (w > 0 && resolvedLotId && !capExists) resolvedLotId = "";
    // Stamp a frozen reference to the tobacco / pipe so
    // the session keeps a readable name even after the entity is
    // hard-deleted (post-30-day Trash). Refreshed on every save so a
    // renamed entity propagates into the snapshot too — the snapshot
    // is purely a display fallback, never the canonical source.
    // Snapshot also carries `imageUrl` so the journal can
    // render the photo of the entity even after permanent deletion.
    var snapTob: { brand: string; name: string; imageUrl?: string } | undefined = form.tobaccoSnapshot;
    if (form.tobaccoId) {
      var tobRef = findById<any>(data.tobaccos, form.tobaccoId);
      if (tobRef) snapTob = entitySnapshot(tobRef);
    }
    var snapPipe: { brand: string; name: string; imageUrl?: string } | undefined = form.pipeSnapshot;
    if (form.pipeId) {
      var pipeRef = findById<any>(data.pipes, form.pipeId);
      if (pipeRef) snapPipe = entitySnapshot(pipeRef);
    }
    var s = Object.assign({}, form, {
      id: data.nxJ || 1,
      // Stable cross-device merge identity, minted at creation only
      // (legacy sessions stay uid-less and dedup by the sessKey — see the merge
      // engine). Preserved if the form already carries one (e.g. re-persist).
      uid: form.uid || newUid(),
      lotId: resolvedLotId,
      weightG: String(w),
      // Stamp an edit time so a multi-device merge can apply
      // last-write-wins on the non-key optional fields (notes/rating/geo/
      // aromas) — see useImportConfirm's enrich block.
      updatedAt: new Date().toISOString(),
      tobaccoSnapshot: snapTob,
      pipeSnapshot: snapPipe,
    });
    var nd: any = Object.assign({}, data, {
      sessions: (data.sessions || []).concat([s]),
      nxJ: (data.nxJ || 1) + 1,
    });
    // Require a resolved+existing lot (resolvedLotId is cleared above
    // when the lot doesn't exist) so an empty/dangling id can't misdirect the
    // deduction via pickJarLot.
    if (w > 0 && form.tobaccoId && resolvedLotId)
      nd = applyLotWeightDelta(nd, form.tobaccoId, resolvedLotId, -w, weightUnit);
    save(nd);
    return true;
  }

  function addSession() {
    if (!_persistSession(sessForm)) return;
    setSessForm(Object.assign({}, BJ));
    // Land at the TOP of the journal (no restoreScroll) so the
    // just-added session is visible (it sorts to the top of the latest —
    // expanded — month). Matches addSessionFromTasting; restoring the saved
    // journal scroll left the user mid-list, not on their new entry.
    nav("journal");
  }

  function addSessionFromTasting(form: any, opts?: { navigate?: boolean }) {
    if (!_persistSession(form)) return false;
    // Scroll to the TOP of the journal (no restoreScroll). The
    // user arrives from the full-screen tasting view, not from a scrolled
    // journal, so restoring a stale saved journal position dropped them in
    // the MIDDLE of the list instead of on their just-added session (which
    // sorts to the top of the newest-expanded month).
    //
    // The navigation is OPT-OUT for the AUTO end. That path
    // fires from a timer, not from a tap, and the user is by definition
    // somewhere else — a 95-minute auto-close would yank them out of whatever
    // they were doing, and out of any open FORM, bypassing the unsaved-changes
    // guard entirely (`goBack` is what consults `formGuardRef`; a direct
    // `nav()` is not). The auto-end already announces itself on the amber
    // banner, which is the right amount of interruption.
    if (!opts || opts.navigate !== false) nav("journal");
    return true;
  }

  function updateSession() {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Mirror _persistSession's required-date guard. The
    // back-guard "Enregistrer" calls this without re-checking canSave, so a
    // session whose date was cleared must not persist a dateless row (which
    // breaks journal grouping/sorting).
    if (!sessForm.date) return;
    var old = findById<any>(data.sessions, editSessId);
    var nd: any = data;
    // Round both weights to the deduction grid (see _persistSession /
    // roundWeightToUnit) so restore(+ow) and deduct(−nw) and the stored weightG
    // all agree on the same precision — no sub-grid balance drift.
    var ow = roundWeightToUnit(safeW(old && old.weightG), weightUnit);
    var nw = roundWeightToUnit(safeW(sessForm.weightG), weightUnit);
    // Refresh the snapshots on update (renamed entity → new
    // snapshot). Falls back to any pre-existing snapshot if the
    // referenced entity is gone (already trashed).
    // Snapshot also carries `imageUrl` — see _persistSession.
    var snapTob: { brand: string; name: string; imageUrl?: string } | undefined = sessForm.tobaccoSnapshot;
    if (sessForm.tobaccoId) {
      var tobRefU = findById<any>(data.tobaccos, sessForm.tobaccoId);
      if (tobRefU) snapTob = entitySnapshot(tobRefU);
    }
    var snapPipe: { brand: string; name: string; imageUrl?: string } | undefined = sessForm.pipeSnapshot;
    if (sessForm.pipeId) {
      var pipeRefU = findById<any>(data.pipes, sessForm.pipeId);
      if (pipeRefU) snapPipe = entitySnapshot(pipeRefU);
    }
    function withSnaps(s: any) {
      // Refresh updatedAt on every edit for merge last-write-wins.
      return Object.assign({}, s, { tobaccoSnapshot: snapTob, pipeSnapshot: snapPipe, updatedAt: new Date().toISOString() });
    }
    var sameLot =
      old
      && String(old.tobaccoId) === String(sessForm.tobaccoId)
      && String(old.lotId || "") === String(sessForm.lotId || "")
      && !!old.lotId;
    if (sameLot) {
      // Same-lot edit: combine restore + deduction into a single net
      // delta. The lot's intermediate balance (after restore, before
      // deduction) is never persisted — only the net result is
      // meaningful for the session edit, so capping `nw` against
      // `current + ow` keeps the deduction from overshooting.
      var capT = findById<any>(nd.tobaccos, sessForm.tobaccoId);
      var capL = capT && findById<any>(capT.lots, sessForm.lotId);
      // Fail-closed cellar guard, parity with
      // the cross-lot branch. The UI promotes a cellar lot to jar via
      // the confirm modal before saving, so this only fires for a programmatic /
      // future caller — but the store must refuse deducting from a sealed lot.
      if (capL && capL.status === "cellar") {
        if (setSaveError) setSaveError(tr(lang, "sess_err_cellar_lot"));
        return;
      }
      if (capL && !isUntrackedWeight(capL.weightG)) {
        // Cap nw so the deduction never overshoots the balance after
        // restitution (current weight + ow restoration).
        // An UNWEIGHED lot has no balance to overshoot, and
        // capping against `safeW("") + ow` made editing such a session
        // collapse it to 0 g — so the 0 g the fifth-reader bug wrote could
        // never be corrected by hand either.
        var avail = safeW(capL.weightG) + ow;
        // The cap must land back ON THE GRID. `ow` and `capL.weightG` are each
        // grid values, but their SUM is not — `0.1 + 2.7` is
        // 2.8000000000000003 in IEEE-754 — and the result was stored with a
        // bare `String(nw)`, so the journal rendered `2,8000000000000003g` and
        // the CSV export wrote it verbatim. Every other weight in this store
        // already goes through `roundWeightToUnit`; the cap was the one
        // arithmetic result that did not. `_persistSession`'s cap has no
        // addition (`Math.min(w, safeW(lot.weightG))`), so it can only ever
        // return a value that is already on the grid — this branch is the only
        // one that adds.
        nw = roundWeightToUnit(Math.min(nw, avail), weightUnit);
      }
      nd = Object.assign({}, nd, {
        sessions: (nd.sessions || []).map(function (s: any) {
          return s.id === editSessId
            ? withSnaps(Object.assign({}, sessForm, { id: editSessId, weightG: String(nw) }))
            : s;
        }),
      });
      var net = ow - nw;
      // Only debit when the target lot actually EXISTS
      // (`capL`). Without it, an edit whose weight changes on a session whose
      // lot was removed would fall through applyLotWeightDelta → pickJarLot and
      // MISDIRECT the delta onto a different jar lot (the misdirection
      // class). Safe today because the UI locks the weight of an orphaned
      // session (net === 0), but this closes the latent hole in the store.
      if (net !== 0 && capL && sessForm.tobaccoId && sessForm.lotId)
        nd = applyLotWeightDelta(nd, sessForm.tobaccoId, sessForm.lotId, net, weightUnit);
    } else {
      // Cross-lot edit (different tobacco or different lot). Restore the
      // old lot fully, then deduct from the new lot. The revert rule may
      // fire on the old lot — that's the desired behaviour (old lot is
      // genuinely back to initial since this session no longer consumes
      // from it).
      // Latent-bug fix: the restore requires a non-empty
      // `old.lotId`. An orphaned session (lotId="", its lot was removed)
      // never debited a specific lot, so there is nothing to restore —
      // without this guard `applyLotWeightDelta(..., "", +ow)` misdirected
      // the credit onto pickJarLot's choice (or reactivated a finished
      // lot), breaking the Σsessions === weightInitial−weightG invariant.
      // Symmetric with deleteSession's `&& sess.lotId` guard.
      // The restore requires the OLD lot to still EXIST,
      // mirroring the same-lot branch's `capL` and _persistSession
      //. A non-empty old.lotId pointing at a lot that no longer
      // exists would fall through applyLotWeightDelta → pickJarLot and MISDIRECT
      // the credit onto a DIFFERENT jar of the same tobacco (the same
      // misdirection class). A soft-deleted lot is still found by findById, so
      // this only bites a truly-gone lot (forged import) — defence in depth.
      var capOldT = (ow > 0 && old && old.tobaccoId && old.lotId) ? findById<any>(nd.tobaccos, old.tobaccoId) : null;
      var capOldL = capOldT ? findById<any>(capOldT.lots, old.lotId) : null;
      if (ow > 0 && old && old.tobaccoId && old.lotId && capOldL)
        nd = applyLotWeightDelta(nd, old.tobaccoId, old.lotId, +ow, weightUnit);
      var capL2: any = null;
      if (nw > 0 && sessForm.tobaccoId && sessForm.lotId) {
        var capT2 = findById<any>(nd.tobaccos, sessForm.tobaccoId);
        if (capT2) {
          capL2 = findById<any>(capT2.lots, sessForm.lotId);
          // Refuse cross-lot edits that target a cellar lot. SessionFormView
          // intercepts this case in the UI (the confirm modal), but the
          // store must hold the invariant as a fail-closed defence in depth.
          if (capL2 && capL2.status === "cellar") {
            if (setSaveError) {
              setSaveError(tr(lang, "sess_err_cellar_lot"));
            }
            return;
          }
          // Same exemption on the cross-lot branch — moving a
          // session onto an unweighed lot must not zero its weight.
          if (capL2 && !isUntrackedWeight(capL2.weightG)) nw = Math.min(nw, safeW(capL2.weightG));
        }
      }
      // If the target lot doesn't EXIST
      // (dangling/imported lotId), ORPHAN the session (lotId "") so its recorded
      // weight isn't an off-books dangling ref — the deduction below is already
      // skipped in that case. Mirrors _persistSession's orphan-on-
      // missing rule. Not UI-reachable (the picker only offers existing lots), but it
      // closes the store-level hole.
      var uStoreLotId = sessForm.lotId;
      if (nw > 0 && sessForm.tobaccoId && sessForm.lotId && !capL2) uStoreLotId = "";
      nd = Object.assign({}, nd, {
        sessions: (nd.sessions || []).map(function (s: any) {
          return s.id === editSessId
            ? withSnaps(Object.assign({}, sessForm, { id: editSessId, lotId: uStoreLotId, weightG: String(nw) }))
            : s;
        }),
      });
      // Latent-bug fix: deduct only when a real lot is targeted.
      // Editing an orphaned session (lotId="") is a pure metadata update —
      // passing "" here misdirected the debit via pickJarLot.
      // Also require the target lot to EXIST (`capL2`) —
      // symmetry with the same-lot branch's `capL` — so a dangling non-empty
      // lotId can't misdirect the debit onto a foreign jar.
      if (nw > 0 && capL2 && sessForm.tobaccoId && sessForm.lotId)
        nd = applyLotWeightDelta(nd, sessForm.tobaccoId, sessForm.lotId, -nw, weightUnit);
    }
    save(nd);
    setEditSessId(null);
    setSessForm(Object.assign({}, BJ));
    nav("journal", { restoreScroll: true });
  }

  function deleteSession(id: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Soft-delete. The session row stays in the array tagged with
    // `deletedAt`; the weight it deducted from its lot is restored immediately
    // so the inventory stays accurate. Restoring from Trash re-deducts the
    // weight via `reDeductRestoredSessions` (useTrashOps) — NOT via save()
    // (assertLotInvariants only checks, never mutates). The instant undo-toast
    // instead restores the whole pre-delete snapshot wholesale.
    // The startup cleanup hard-removes the row after 30 days.
    var sess = findById<any>(data.sessions, id);
    // Idempotency guard. deleteSession credits +w back to
    // the lot; calling it twice on the same session (already soft-deleted)
    // would double-credit → weightG can exceed weightInitial (a real,
    // invariant-tripping corruption). An absent or already-trashed session must
    // be a strict no-op — restore/permanentlyDelete own the trash lifecycle.
    if (!sess || sess.deletedAt) return;
    var now = new Date().toISOString();
    var nd: any = Object.assign({}, data, {
      sessions: (data.sessions || []).map(function (s: any) {
        if (s.id !== id) return s;
        return Object.assign({}, s, { deletedAt: now });
      }),
    });
    var w = safeW(sess && sess.weightG);
    if (w > 0 && sess && sess.tobaccoId && sess.lotId) {
      // Only credit the weight back when the referenced lot
      // actually EXISTS. A dangling lotId (forged/corrupt data — normal purge
      // paths clear it) otherwise falls through locateLotIdx → pickJarLot and
      // MISDIRECTS the +w credit onto a DIFFERENT jar lot of the same tobacco
      // (or reactivates an unrelated finished lot). Parity with the guard its
      // siblings already carry: _persistSession + updateSession
      //. A soft-deleted lot still counts as present (kept in raw
      // data with deletedAt), matching applyLotWeightDelta's own findIndex.
      var delTob = findById<any>(nd.tobaccos, sess.tobaccoId);
      var delLot = delTob && findById<any>(delTob.lots, sess.lotId);
      if (delLot)
        nd = applyLotWeightDelta(
          nd,
          sess.tobaccoId,
          sess.lotId,
          +w,
          weightUnit,
        );
    }
    save(nd);
  }

  function toggleSessGroup(key: any) {
    setCollapsedSessGroups(function (prev: any) {
      return toggleCollapseKey(prev, key);
    });
  }

  return {
    sessForm,
    setSessForm,
    editSessId,
    setEditSessId,
    sessGrouped,
    setSessGrouped,
    collapsedSessGroups,
    setCollapsedSessGroups,
    addSession,
    addSessionFromTasting,
    updateSession,
    deleteSession,
    toggleSessGroup,
  };
}
