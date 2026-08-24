import React from "react";
import { BT, BL } from "../constants.ts";
import { today, refreshSnapshotsForRemoval, readDefaultGrouped, toggleCollapseKey, monotonicId, newUid, nextBoxNumber } from "../utils.ts";
import { applyLifecycleDates } from "../utils/lotUtils.ts";

var useState = React.useState;

export function useTobaccoStore({
  data,
  save,
  latestData,
  nav,
  setSearch,
  fromWishRef,
}: {
  data: any;
  save: (d: any) => void;
  /** The FRESHEST committed cellar (App's `latestDataRef`), optional so every
   *  existing caller and test keeps working. A mutation that can run as the
   *  SECOND write inside one synchronous handler MUST build on this rather than
   *  on the render's `data`: React has not re-rendered in between, so a payload
   *  built from `data` silently overwrites the first write. See App.tsx. */
  latestData?: () => any;
  nav: (v: string, opts?: { restoreScroll?: boolean }) => void;
  setSearch: (s: string) => void;
  fromWishRef: React.MutableRefObject<any>;
}) {
  // The base every mutation below builds on. Falls back to the render snapshot
  // when App did not hand a ref down (tests, and any future caller).
  function fresh(): any {
    return latestData ? latestData() : data;
  }
  var _f = useState(Object.assign({}, BT)),
    form = _f[0],
    setForm = _f[1];
  var _ei = useState<any>(null),
    editId = _ei[0],
    setEditId = _ei[1];
  var _d = useState<any>(null),
    detail = _d[0],
    setDetail = _d[1];
  var _lf = useState(Object.assign({}, BL)),
    lotForm = _lf[0],
    setLotForm = _lf[1];
  var _al = useState(false),
    addLotMode = _al[0],
    setAddLotMode = _al[1];
  var _el = useState<any>(null),
    editLotIdx = _el[0],
    setEditLotIdx = _el[1];
  var _ld = useState<any>(null),
    lotDet = _ld[0],
    setLotDet = _ld[1];
  var _sf = useState(false),
    showFinished = _sf[0],
    setShowFinished = _sf[1];
  var _tg = useState(readDefaultGrouped),
    tobGrouped = _tg[0],
    setTobGrouped = _tg[1];
  var _ctg = useState<Record<string, any>>({}),
    collapsedTobGroups = _ctg[0],
    setCollapsedTobGroups = _ctg[1];

  function addTobacco(override?: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Optional `override` lets callers (CatalogView one-tap
    // add) inject a fully-shaped tobacco entry without staging the
    // internal `form` state first. When given, we skip `setForm(BT)`
    // (the caller isn't using the form) and skip `nav("inv")` (the
    // caller stays on the catalog).
    var source = override || form;
    if (!source.name || !source.brand) return;
    // Every lot must carry an `id` — the session form's lot picker uses
    // `String(l.id)` as the <option value>, and iOS Safari cannot
    // distinguish two options with the same value (e.g. "undefined") so
    // the selection silently fails. Stamp an id on the auto-created
    // starter lot, and back-fill any pre-imported lots that lack one.
    var lots = source.lots && source.lots.length
      ? source.lots.map(function (l: any) {
          var upd: any = {};
          if (!l || !l.id) upd.id = monotonicId();
          // Stamp the stable cross-device uid on a pre-imported /
          // wish-derived lot that lacks one.
          if (!l || !(typeof l.uid === "string" && l.uid)) upd.uid = newUid();
          if (!l || !l.weightInitial) upd.weightInitial = String((l && l.weightG) || "");
          // Stamp originalStatus from the lot's creation status if
          // missing — needed so the revert-to-cellar rule respects
          // jar-from-start lots. "finished" can't be an origin; we
          // assume cellar in that defensive corner.
          if (!l || !l.originalStatus) {
            upd.originalStatus = (l && l.status === "jar") ? "jar" : "cellar";
          }
          return Object.keys(upd).length ? Object.assign({}, l, upd) : l;
        })
      : [
          // A brand-new tabac (manual form, AI auto-fill, catalogue QuickAdd,
          // wishlist → inventory) gets ONE empty starter lot so it lands as an
          // ACTIVE tabac (a lot-less tabac is now classed inactive — see the
          // "active" filter). The user then edits/adds real tins on the fiche.
          //
          // The starter lot carries NO WEIGHT, and the comment
          // above finally describes what the code does. It inherited `BL`'s
          // `weightG: "50"`, so every first tobacco was created with **50 g of
          // stock the user never entered**: saving brand + name alone produced
          // `1 BOÎTES · 0,1 kg` on the Home and `50g · 1 CAVE` on the card. That
          // invented number then feeds the total weight, the maturity bar, the
          // low-stock threshold, the shopping list, the collection report's
          // weight AND value columns, and the cost per bowl. A user's very
          // first data point was false, with nothing marking it as a guess.
          //
          // WHY EMPTY AND NOT ZERO — the objection is right and the answer is
          // that they are different states. An explicit `"0"` IS an empty tin:
          // `stepAutoFinish` would close the lot on the first session and the
          // session pickers refuse it. An EMPTY value means
          // "never weighed", which the app models explicitly:
          // `isUntrackedWeight` short-circuits `stepApplyDelta` AND
          // `stepAutoFinish`, `isUsableLot` still offers the lot, and
          // `checkLotInvariants` skips its balance. Verified for this change:
          // `countActive` counts on `status !== "finished"` and never reads the
          // weight, so the tabac still lands ACTIVE — which is the whole reason
          // the starter lot exists.
          //
          // `BL` itself is deliberately UNTOUCHED: its `50` is the prefill of
          // the "add a lot" form, a field the user is looking at and can edit.
          // The defect was inheriting it where there is no field and no user.
          Object.assign({}, BL, {
            id: monotonicId(),
            uid: newUid(),
            weightG: "",
            weightInitial: "",
            datePurchased: today(),
            boxNumber: nextBoxNumber(data.tobaccos),
          }),
        ];
    var it = Object.assign({}, source, { id: data.nxT, uid: source.uid || newUid(), lots: lots, updatedAt: new Date().toISOString() });
    var nd = Object.assign({}, data, {
      tobaccos: data.tobaccos.concat([it]),
      nxT: data.nxT + 1,
    });
    if (fromWishRef.current) {
      nd = Object.assign({}, nd, {
        wishlist: (nd.wishlist || []).filter(function (w: any) {
          return w.id !== fromWishRef.current;
        }),
      });
      fromWishRef.current = null;
    }
    save(nd);
    if (!override) {
      setForm(Object.assign({}, BT));
      // The inventory list groups by brand with
      // groups COLLAPSED by default, so a just-added tobacco of a brand the
      // user hasn't expanded lands hidden inside its group. Expand it so the
      // new entry is visible on return (mirrors the catalog path).
      setCollapsedTobGroups(function (p: any) { return Object.assign({}, p, { [source.brand]: false }); });
      // Closing a sub-form: keep the user's previous list position.
      nav("inv", { restoreScroll: true });
    }
  }

  function updateTobacco() {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Mirror addTobacco's required-field guard. The
    // unsaved-changes "Enregistrer" button (useUnsavedFormGuard.onSave → submit)
    // calls this directly and NEVER re-checks canSave, so without this a user
    // who cleared the name/brand then tapped Enregistrer on the back-guard would
    // silently persist an identity-broken (nameless) tobacco and navigate away.
    if (!form.name || !form.brand) return;
    save(
      Object.assign({}, data, {
        tobaccos: data.tobaccos.map(function (t: any) {
          // `lots` MUST come from the store copy, never from the
          // form. `liveData` hands the fiche a tobacco with soft-deleted lots
          // STRIPPED, the edit button seeds the form from that object, and this
          // line replaces the whole raw row — so editing a tobacco after
          // trashing one of its lots destroyed that lot permanently, silently,
          // and broke the documented 30-day restore promise. The tobacco form
          // never edits lots (they have their own modal), exactly as the pipe
          // form never edits `maintenance` — and usePipeStore has defended that
          // field this way from the start. This is the missing twin.
          return t.id === editId
            ? Object.assign({}, form, {
                id: editId,
                lots: Array.isArray(t.lots) ? t.lots : (form.lots || []),
                updatedAt: new Date().toISOString(),
              })
            : t;
        }),
      }),
    );
    setEditId(null);
    setForm(Object.assign({}, BT));
    setDetail(null);
    setSearch("");
    setAddLotMode(false);
    setEditLotIdx(null);
    setLotDet(null);
    setShowFinished(false);
    // Closing a sub-form: keep the user's previous list position.
    nav("inv", { restoreScroll: true });
  }

  function updateTobaccoTastingNotes(tobId: any, notes: string) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    var nd = Object.assign({}, data, {
      tobaccos: (data.tobaccos || []).map(function (t: any) {
        if (String(t.id) !== String(tobId)) return t;
        return Object.assign({}, t, { tastingNotes: notes });
      }),
    });
    save(nd);
  }

  function deleteTobacco(id: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Soft-delete. Stamps `deletedAt` so the row stays in
    // the array (and in Drive backups) but is filtered out of the
    // live ctx view. The Trash section in Settings lists deleted
    // rows for 30 days, after which the startup cleanup removes them
    // permanently. Existing undo-toast snapshot path still
    // works — undo restores the pre-delete data wholesale.
    //
    // Refresh `tobaccoSnapshot` on every session that
    // references this tabac BEFORE stamping deletedAt. Reason: as
    // soon as the row carries deletedAt, `liveData` filters it out
    // and the journal's `tobOf(id)` lookup returns undefined → the
    // entry falls back to the snapshot. If the user had renamed or
    // re-imaged the tabac after the session was logged, the snapshot
    // built at session save time is stale. Refreshing here locks in
    // the latest state the user actually saw.
    var now = new Date().toISOString();
    var target = data.tobaccos.find(function (t: any) { return t && t.id === id; });
    var nextSessions = target
      ? refreshSnapshotsForRemoval(data.sessions || [], [target], [])
      : (data.sessions || []);
    save(
      Object.assign({}, data, {
        tobaccos: data.tobaccos.map(function (t: any) {
          if (t.id !== id) return t;
          return Object.assign({}, t, { deletedAt: now });
        }),
        sessions: nextSessions,
      }),
    );
    if (detail && detail.id === id) setDetail(null);
  }

  function addLotToTobacco(tobId: any, lotOverride?: any, count?: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // `count` lets the user create several identical lots in ONE
    // save ("j'achète en une fois plusieurs lots"). Normalise the base once,
    // then clone it `n` times, each with its own monotonic id. Clamped to
    // 1..50. Backward-compatible: an omitted count means a single lot.
    var n = Math.max(1, Math.min(50, parseInt(String(count), 10) || 1));
    var base = Object.assign({}, lotOverride || lotForm);
    if (!base.datePurchased) base.datePurchased = today();
    // A lot cannot enter the inventory already finished — finished is an
    // end state reached via consumption, not a valid origin. The UI form
    // hides "finished" from the creation status picker; this clamp is a
    // defence-in-depth for programmatic callers (imports, test fixtures,
    // future helpers) so the rest of the pipeline can rely on the
    // invariant `created lot.status ∈ {"cellar", "jar"}`.
    if (base.status === "finished") base.status = "cellar";
    // Initial weight ↔ current weight mirror at creation. The lot form
    // hides the current-weight input at creation; we cross-
    // seed here so either entry path lands a coherent lot regardless of
    // which side the user / AI / import filled.
    if (!base.weightInitial && base.weightG)
      base.weightInitial = String(base.weightG);
    if (!base.weightG && base.weightInitial)
      base.weightG = String(base.weightInitial);
    // Stamp the lot's origin status at creation. Used to anchor the
    // now-removed auto-revert rule; informational only
    // (displayed in the lot edit modal, kept for future migrations /
    // analytics — see CLAUDE.md §12). Anything other than "jar" maps
    // to "cellar".
    if (!base.originalStatus) {
      base.originalStatus = base.status === "jar" ? "jar" : "cellar";
    }
    if (base.status === "jar" && !base.dateOpened) base.dateOpened = today();
    // When duplicating with a NUMERIC box number, increment it across the
    // clones (5, 6, 7…) so the physical boxes stay uniquely numbered; a
    // non-numeric or empty box number is copied verbatim.
    var boxBase = parseInt(String(base.boxNumber), 10);
    var boxIsNumeric = !isNaN(boxBase) && String(base.boxNumber).trim() === String(boxBase);
    var newLots: any[] = [];
    for (var i = 0; i < n; i++) {
      // Each clone is a DISTINCT physical tin → its OWN fresh uid
      // (never inherit base.uid, e.g. from a duplicated lot). monotonicId is the
      // per-device numeric id; uid is the stable cross-device identity.
      var clone = Object.assign({}, base, { id: monotonicId(), uid: newUid() });
      if (n > 1 && boxIsNumeric) clone.boxNumber = String(boxBase + i);
      newLots.push(clone);
    }
    var tobs = data.tobaccos.map(function (t: any) {
      if (t.id !== tobId) return t;
      return Object.assign({}, t, { lots: (t.lots || []).concat(newLots) });
    });
    save(Object.assign({}, data, { tobaccos: tobs }));
    setDetail(
      tobs.find(function (t: any) {
        return t.id === tobId;
      }),
    );
    setLotForm(Object.assign({}, BL));
    setAddLotMode(false);
  }

  function updateLotInTobacco(tobId: any, lotId: any, lotOverride?: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Integrity fix: locate the lot by its stable `id`, NEVER by a
    // positional index. Views hold the trash-STRIPPED lots (liveData) while
    // `data.tobaccos[].lots` is the RAW trash-inclusive array — an index
    // computed by the view points at the WRONG lot when a soft-deleted lot
    // precedes a live one (silent corruption + duplicate ids). Matching by id
    // is the documented primary-key invariant.
    var tobs = data.tobaccos.map(function (t: any) {
      if (t.id !== tobId) return t;
      // "à ne pas reprendre" (rebuy=false) is a MANUAL, per-TABAC
      // judgement — a blend you didn't like and won't buy again. Eliminating a
      // lot is a PHYSICAL act (you might toss a moldy tin of a blend you love),
      // so it no longer auto-sets rebuy. The disposed flag still marks the lot
      // (Éliminés filter, FINI pill); only the rebuy link was removed
      // (the earlier auto-behaviour was reverted — do NOT restore it).
      var newLots = t.lots.map(function (l: any) {
        if (String(l.id) !== String(lotId)) return l;
        var updated = Object.assign({}, lotOverride || lotForm);
        // Force-stamp the lot's stable id LAST — every sibling
        // update fn (updatePipe/updateTobacco/updateSession/updateMaintenance)
        // does this. The override / lotForm (default BL) carries no `id`, so
        // without this a future caller passing a partial override would drop
        // the id → an unmatchable, orphaned lot (id-present violation). No
        // behavioural change today (the sole caller carries l.id through).
        updated.id = l.id;
        // Preserve / seed the initial weight. If the user
        // never filled the field, fall back to the existing recorded
        // value, else the current weightG so the lot always carries an
        // initial-weight reference.
        if (!updated.weightInitial) {
          updated.weightInitial = String(l.weightInitial || updated.weightG || "");
        }
        // Preserve `originalStatus` across edits. The user can still
        // override it explicitly through the lot form (see
        // LotFormModal) — only that field carries the new value
        // through `updated`. Otherwise the previously-recorded value
        // is kept verbatim.
        if (!updated.originalStatus) {
          updated.originalStatus = l.originalStatus
            || (l.status === "jar" ? "jar" : "cellar");
        }
        if (updated.status === "jar" && !updated.dateOpened)
          updated.dateOpened = today();
        if (updated.status === "finished" && !updated.dateFinished)
          updated.dateFinished = today();
        // Defence in depth: leaving "finished" must always clear dateFinished + disposed.
        if (updated.status !== "finished") {
          updated.dateFinished = "";
          updated.disposed = false;
        }
        // Clear dateOpened ONLY on an actual jar/finished → cellar
        // transition. Editing a lot that was already
        // cellar (e.g. one reverted via the auto-revert rule, which
        // preserves dateOpened as historical memory per fix #23) must
        // not silently wipe that history just because the user saved
        // the form without changing the status.
        if (updated.status === "cellar" && l.status !== "cellar") {
          updated.dateOpened = "";
        }
        return updated;
      });
      return Object.assign({}, t, { lots: newLots });
    });
    save(Object.assign({}, data, { tobaccos: tobs }));
    setDetail(
      tobs.find(function (t: any) {
        return t.id === tobId;
      }),
    );
    setLotForm(Object.assign({}, BL));
    setEditLotIdx(null);
  }

  function removeLot(tobId: any, lotId: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    // Soft-delete. The lot stays inside `tobacco.lots` with
    // a `deletedAt` ISO stamp; the live ctx view strips it, the Trash
    // section in Settings surfaces it for 30 days. Sessions referencing
    // the lot keep their `lotId` intact — restoring the lot re-attaches
    // them cleanly. Permanent deletion (via the Trash UI or the 30-day
    // startup cleanup) orphanises those sessions the way the old
    // hard-delete used to (lotId → "").
    var nowStr = new Date().toISOString();
    var tobs = data.tobaccos.map(function (t: any) {
      if (t.id !== tobId) return t;
      return Object.assign({}, t, {
        // Match by stable id, not positional index (see updateLotInTobacco).
        lots: (t.lots || []).map(function (l: any) {
          if (String(l.id) !== String(lotId)) return l;
          return Object.assign({}, l, { deletedAt: nowStr });
        }),
      });
    });
    save(Object.assign({}, data, { tobaccos: tobs }));
    // Mirror the liveData stripping rule when refreshing the detail
    // state so the just-soft-deleted lot disappears from the detail
    // view immediately.
    var refreshed = tobs.find(function (t: any) { return t.id === tobId; });
    if (refreshed) {
      setDetail(Object.assign({}, refreshed, {
        lots: (refreshed.lots || []).filter(function (l: any) {
          return !l || !l.deletedAt;
        }),
      }));
    }
  }

  function changeLotStatus(tobId: any, lotId: any, ns: any) {
    // Build on the FRESHEST committed cellar, not this render's snapshot
    // (see `fresh` above). Deliberately SHADOWS the hook-scope `data` for the
    // whole function, so every read below uses the fresh base — a partial
    // conversion is exactly how a second mutation in one handler loses the first.
    var data = fresh();
    var tobs = data.tobaccos.map(function (t: any) {
      if (t.id !== tobId) return t;
      // Match by stable id, not positional index (see updateLotInTobacco).
      var newLots = t.lots.map(function (l: any) {
        if (String(l.id) !== String(lotId)) return l;
        // Single source of truth: applyLifecycleDates in
        // "manual" mode clears dateOpened on cellar transitions and
        // ensures dateOpened/dateFinished are filled as appropriate.
        return applyLifecycleDates(l, ns, "manual");
      });
      return Object.assign({}, t, { lots: newLots });
    });
    save(Object.assign({}, data, { tobaccos: tobs }));
    setDetail(
      tobs.find(function (t: any) {
        return t.id === tobId;
      }),
    );
  }

  function toggleTobGroup(key: any) {
    setCollapsedTobGroups(function (prev: any) {
      return toggleCollapseKey(prev, key);
    });
  }

  return {
    form,
    setForm,
    editId,
    setEditId,
    detail,
    setDetail,
    lotForm,
    setLotForm,
    addLotMode,
    setAddLotMode,
    editLotIdx,
    setEditLotIdx,
    lotDet,
    setLotDet,
    showFinished,
    setShowFinished,
    tobGrouped,
    setTobGrouped,
    collapsedTobGroups,
    setCollapsedTobGroups,
    addTobacco,
    updateTobacco,
    updateTobaccoTastingNotes,
    deleteTobacco,
    addLotToTobacco,
    updateLotInTobacco,
    removeLot,
    changeLotStatus,
    toggleTobGroup,
  };
}
