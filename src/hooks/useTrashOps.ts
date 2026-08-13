import { reDeductRestoredSessions } from "../utils/lotUtils.ts";
import { refreshSnapshotsForRemoval, isTrashed, stripDeleted } from "../utils.ts";

// Trash operations extracted verbatim from App.tsx.
// Restore a soft-deleted row (clears `deletedAt`), permanently delete
// it (hard-removes from the array), or empty the whole trash. All operate on
// the raw `data` (which still contains the trash) — useExportImport's
// snapshot-based undo isn't involved because these are deliberate, explicit
// user actions in the Trash UI. Behaviour is 1:1 with the former in-component
// closures; `data` / `save` / `weightUnit` are now injected. The functions
// stay plain (not memoised) so they always close over the latest `data`,
// exactly as before.
export function useTrashOps({
  data,
  save,
  weightUnit,
}: {
  data: any;
  save: (d: any) => void;
  weightUnit: string;
}) {
  function _kindToKey(kind: string): "tobaccos" | "pipes" | "wishlist" | "accessories" | "sessions" {
    if (kind === "tobacco") return "tobaccos";
    if (kind === "pipe") return "pipes";
    if (kind === "wish") return "wishlist";
    if (kind === "accessory") return "accessories";
    return "sessions";
  }
  function restoreFromTrash(kind: string, id: any) {
    // Lot trash entries live inside `tobacco.lots`. The
    // kind "lot" carries the lot.id only; we sweep every tobacco's
    // lots and clear `deletedAt` on the matching id.
    // Restore is now a pure deletedAt-clear — no session
    // mutation. The user wants session integrity preserved across
    // every trash op (see permanentlyDelete for the rationale).
    if (kind === "lot") {
      var lotIdStr = String(id);
      var nextTobsL = ((data && data.tobaccos) || []).map(function (t: any) {
        if (!t || !Array.isArray(t.lots)) return t;
        var hit = false;
        var newLots = t.lots.map(function (l: any) {
          if (!l || String(l.id) !== lotIdStr) return l;
          hit = true;
          var clone: any = Object.assign({}, l);
          delete clone.deletedAt;
          return clone;
        });
        if (!hit) return t;
        return Object.assign({}, t, { lots: newLots });
      });
      save(Object.assign({}, data, { tobaccos: nextTobsL }));
      return;
    }
    var key = _kindToKey(kind);
    var arr = (data && data[key]) || [];
    var nextData: any = Object.assign({}, data, {
      [key]: arr.map(function (it: any) {
        if (!it || it.id !== id) return it;
        var clone: any = Object.assign({}, it);
        delete clone.deletedAt;
        return clone;
      }),
    });
    // When un-trashing a session, re-deduct its weight
    // from the lot via the shared helper. `deleteSession` (soft-
    // delete) restored the weight so the inventory matched "this
    // session never happened"; restoring the session must reverse
    // that restitution or the user gains `weightG` grams gratuits
    // per delete-restore cycle. Helper is a no-op for non-sessions
    // (sessions filtered by id) and for sessions referencing a
    // missing lot.
    if (kind === "session") {
      nextData = reDeductRestoredSessions(nextData, [String(id)], weightUnit);
    }
    save(nextData);
  }
  // Restore a multi-pick selection in ONE save. The
  // previous TrashModal.restoreSelection iterated `restoreFromTrash`
  // per row — every call read `data` from the same closure, so
  // React batched the setData updates and only the last row's
  // payload survived ("j'ai sélectionné 2 éléments, il n'a restauré
  // que le premier"). Atomic save fixes it. `selection` is a Set of
  // "kind:id" strings, same encoding as the modal and the import
  // selective restore.
  function restoreSelectionFromTrash(selection: Set<string>) {
    if (!data || !selection || selection.size === 0) return;
    var d: any = data;
    // Explicit per-kind shape (instead of Record<string, Set>)
    // so strict-TS knows every field is a `Set<string>`, not `… | undefined`.
    var picks = {
      tobacco: new Set<string>(),
      pipe: new Set<string>(),
      wish: new Set<string>(),
      accessory: new Set<string>(),
      session: new Set<string>(),
      lot: new Set<string>(),
    };
    selection.forEach(function (k) {
      var ix = k.indexOf(":");
      if (ix < 0) return;
      var kind = k.slice(0, ix);
      var id = k.slice(ix + 1);
      // HasOwnProperty guard so a forged selection
      // `kind` of "__proto__"/"constructor" can't resolve to Object.prototype
      // (truthy) and crash on `set.add` (prototype-safety discipline; `kind`
      // is one of the 6 fixed literals in normal flow, so this is defensive).
      var set = Object.prototype.hasOwnProperty.call(picks, kind)
        ? (picks as any)[kind] as Set<string> | undefined
        : undefined;
      if (set) set.add(id);
    });
    function untrashArr(arr: any[], idSet: Set<string>) {
      if (!Array.isArray(arr) || idSet.size === 0) return arr;
      return arr.map(function (it: any) {
        if (!it || !it.deletedAt) return it;
        if (!idSet.has(String(it.id))) return it;
        var clone: any = Object.assign({}, it);
        delete clone.deletedAt;
        return clone;
      });
    }
    var nextTobs = untrashArr(d.tobaccos, picks.tobacco);
    // Lots: lot picks live inside tobacco.lots. Sweep every tobacco
    // and clear deletedAt on the matching lot ids.
    if (picks.lot.size > 0) {
      nextTobs = nextTobs.map(function (t: any) {
        if (!t || !Array.isArray(t.lots)) return t;
        var anyHit = t.lots.some(function (l: any) {
          return l && l.deletedAt && picks.lot.has(String(l.id));
        });
        if (!anyHit) return t;
        return Object.assign({}, t, {
          lots: t.lots.map(function (l: any) {
            if (!l || !l.deletedAt || !picks.lot.has(String(l.id))) return l;
            var c: any = Object.assign({}, l);
            delete c.deletedAt;
            return c;
          }),
        });
      });
    }
    var nd: any = Object.assign({}, d, {
      tobaccos: nextTobs,
      pipes:       untrashArr(d.pipes,       picks.pipe),
      wishlist:    untrashArr(d.wishlist,    picks.wish),
      accessories: untrashArr(d.accessories, picks.accessory),
      sessions:    untrashArr(d.sessions,    picks.session),
    });
    // Re-deduct the weight of every un-trashed session
    // from its lot via the shared helper (see restoreFromTrash for
    // the rationale).
    nd = reDeductRestoredSessions(nd, picks.session, weightUnit);
    save(nd);
  }
  // `refreshSnapshotsForRemoval` moved to `src/utils.ts`
  // so the stores' soft-delete paths can call it too. See utils.ts
  // for the rationale.
  function permanentlyDelete(kind: string, id: any) {
    // Permanent lot deletion. Hard-removes the lot from
    // its tobacco AND orphanises every session that referenced it
    // (lotId → "") — mirrors the old hard-delete `removeLot` so
    // `deleteSession`'s weight-restore guard (`&& sess.lotId`) still
    // skips on these sessions and stats stay accurate.
    //
    // Permanent tabac/pipe deletion does NOT mutate any
    // session field anymore. The user wants sessions immutable across
    // every trash op: tobaccoId / pipeId stay pointing to the now-
    // gone entity (a "fantôme" id), and the journal renders via the
    // snapshot the session already carries (brand / name / imageUrl).
    // A fresh tabac/pipe created later — same brand+name or not — has
    // a new id, so the old session is NOT auto-linked. The kind
    // "lot" branch keeps its explicit lotId orphanisation because
    // lots have no snapshot (they're abstract) and the weight book-
    // keeping needs the empty lotId so deleteSession's guard fires.
    if (kind === "lot") {
      var lotIdStr2 = String(id);
      var nextTobs2 = ((data && data.tobaccos) || []).map(function (t: any) {
        if (!t || !Array.isArray(t.lots)) return t;
        var newLots = t.lots.filter(function (l: any) {
          return !l || String(l.id) !== lotIdStr2;
        });
        if (newLots.length === t.lots.length) return t;
        return Object.assign({}, t, { lots: newLots });
      });
      var nextSess = ((data && data.sessions) || []).map(function (s: any) {
        if (!s || String(s.lotId) !== lotIdStr2) return s;
        return Object.assign({}, s, { lotId: "" });
      });
      save(Object.assign({}, data, { tobaccos: nextTobs2, sessions: nextSess }));
      return;
    }
    var key = _kindToKey(kind);
    var arr = (data && data[key]) || [];
    var toDelete = arr.find(function (it: any) { return it && it.id === id; });
    var deletedTobs = kind === "tobacco" && toDelete ? [toDelete] : [];
    var deletedPipes = kind === "pipe" && toDelete ? [toDelete] : [];
    var nextSessionsP = refreshSnapshotsForRemoval(
      (data && data.sessions) || [], deletedTobs, deletedPipes,
    );
    // A purged tobacco takes its lots
    // with it, so sessions that referenced those lots would keep a DANGLING
    // `lotId` (the lot object is gone). Clear it — mirroring the `"lot"`
    // branch above, the 30-day sweep, and `emptyTrash` — so the invariant
    // "session.lotId === '' OR the lot exists" holds and deleteSession's
    // weight-restore guard (`&& sess.lotId`) stays correct. (Pipes carry no
    // lots, so only the tobacco case needs this.)
    if (kind === "tobacco" && toDelete && Array.isArray(toDelete.lots)) {
      var purgedLotIds: Record<string, true> = Object.create(null);
      toDelete.lots.forEach(function (l: any) {
        if (l && l.id !== undefined && l.id !== null && l.id !== "") {
          purgedLotIds[String(l.id)] = true;
        }
      });
      nextSessionsP = nextSessionsP.map(function (s: any) {
        if (!s || !s.lotId || !purgedLotIds[String(s.lotId)]) return s;
        return Object.assign({}, s, { lotId: "" });
      });
    }
    save(Object.assign({}, data, {
      [key]: arr.filter(function (it: any) { return !it || it.id !== id; }),
      sessions: nextSessionsP,
    }));
  }
  // Mirror of emptyTrash — clears `deletedAt` from every
  // top-level row AND every lot in a single save. Restoring is a
  // non-destructive operation (it cannot lose data, only re-floats
  // hidden rows), so it skips the confirm prompt that emptyTrash
  // surfaces. Used by the "Tout restaurer" CTA in CuratorTrashModal.
  function restoreAllFromTrash() {
    if (!data) return;
    var d: any = data;
    function stripField(arr: any) {
      return (arr || []).map(function (it: any) {
        if (!it || !it.deletedAt) return it;
        var clone: any = Object.assign({}, it);
        delete clone.deletedAt;
        return clone;
      });
    }
    // A trashed lot whose `uid` is ALREADY LIVE somewhere is
    // not something to restore: it is the source half of a MOVE, and bringing
    // it back duplicates a physical tin.
    //
    // `mergeDuplicates` — the app's own tool for healing the cross-device
    // doubling — moves a tobacco's lots onto the kept row (`Object.assign({},
    // l, { id: nid })`, so the **uid is carried**) and SOFT-deletes the
    // originals, with the trash documented as that merge's undo. An earlier
    // fix closed this same stock-doubling through the per-row door; « Tout
    // restaurer » was left open. Measured: 110 g / 2 lots → merge → 110 g /
    // 2 lots → Tout restaurer → **160 g / 3 lots**, with every invariant
    // silent. One button, no confirm.
    //
    // The signal needs no new field and no knowledge of who trashed what: after
    // a move the same uid exists on a LIVE lot and on a trashed one, and that
    // state has no other legitimate cause — `lot-uid-unique`
    // forbids two LIVE lots sharing one. The per-row restore and
    // `restoreSelectionFromTrash` were already correct and are untouched: there
    // the user names one lot, so the choice is theirs to make.
    //
    // A uid-LESS legacy lot cannot be recognised and keeps the old behaviour —
    // disclosed rather than guessed at, following the trashed-entity precedent.
    var liveLotUids: Record<string, true> = Object.create(null);
    (d.tobaccos || []).forEach(function (t: any) {
      if (!t || !Array.isArray(t.lots)) return;
      t.lots.forEach(function (l: any) {
        if (l && !l.deletedAt && typeof l.uid === "string" && l.uid) liveLotUids[l.uid] = true;
      });
    });
    var nextTobs = stripField(d.tobaccos).map(function (t: any) {
      if (!t || !Array.isArray(t.lots)) return t;
      var anyTrashLot = t.lots.some(function (l: any) { return l && l.deletedAt; });
      if (!anyTrashLot) return t;
      var newLots = t.lots.map(function (l: any) {
        if (!l || !l.deletedAt) return l;
        if (typeof l.uid === "string" && l.uid && liveLotUids[l.uid]) return l; // move source — stays trashed
        var c: any = Object.assign({}, l);
        delete c.deletedAt;
        return c;
      });
      return Object.assign({}, t, { lots: newLots });
    });
    // Restore is a pure deletedAt-clear, no session
    // mutation (the user's "intégrité des sessions" requirement).
    // HOWEVER, sessions that come back from the trash
    // must re-deduct their weight from the lot — `deleteSession`
    // restored the weight at soft-delete time, so the inventory
    // would gain `weightG` grams per round-trip otherwise. Collect
    // the ids of sessions that ACTUALLY had `deletedAt` cleared in
    // this pass, then hand them to the shared re-deduct helper.
    var restoredSessIds: string[] = [];
    (d.sessions || []).forEach(function (origSess: any) {
      if (origSess && origSess.deletedAt && origSess.id !== undefined) {
        restoredSessIds.push(String(origSess.id));
      }
    });
    var nd: any = Object.assign({}, d, {
      tobaccos:    nextTobs,
      pipes:       stripField(d.pipes),
      wishlist:    stripField(d.wishlist),
      accessories: stripField(d.accessories),
      sessions:    stripField(d.sessions),
    });
    nd = reDeductRestoredSessions(nd, restoredSessIds, weightUnit);
    save(nd);
  }
  function emptyTrash() {
    if (!data) return;
    var d: any = data;
    // Also wipe soft-deleted lots inside every (surviving)
    // tobacco and orphanise the sessions that referenced them. We
    // process tobaccos first so a row that's itself in the trash
    // doesn't leak through this step — it'll be dropped anyway by
    // the top-level filter below.
    // Object.create(null) — see lotPurgeIds above.
    var orphanedLotIds: Record<string, true> = Object.create(null);
    var tobsAfterLotPurge = (d.tobaccos || []).map(function (t: any) {
      if (!t || !Array.isArray(t.lots)) return t;
      var newLots = t.lots.filter(function (l: any) {
        if (l && l.deletedAt) {
          if (l.id !== undefined && l.id !== null && l.id !== "") {
            orphanedLotIds[String(l.id)] = true;
          }
          return false;
        }
        return true;
      });
      if (newLots.length === t.lots.length) return t;
      return Object.assign({}, t, { lots: newLots });
    });
    // A top-level tobacco that is ITSELF
    // in the trash is about to be purged wholesale — its lots go with it. The
    // per-surviving-tobacco lot sweep above only collects `deletedAt` lots
    // inside SURVIVING tobaccos, so it misses these. Add every lot id inside a
    // trashed tobacco so the referencing sessions get lotId cleared too.
    (d.tobaccos || []).forEach(function (t: any) {
      if (t && t.deletedAt && Array.isArray(t.lots)) {
        t.lots.forEach(function (l: any) {
          if (l && l.id !== undefined && l.id !== null && l.id !== "") {
            orphanedLotIds[String(l.id)] = true;
          }
        });
      }
    });
    var sessAfterOrphan = (d.sessions || []).map(function (s: any) {
      if (!s || !s.lotId) return s;
      if (!orphanedLotIds[String(s.lotId)]) return s;
      return Object.assign({}, s, { lotId: "" });
    });
    // Refresh `tobaccoSnapshot` / `pipeSnapshot` (brand,
    // name, imageUrl) on every session that points at a tabac or
    // pipe we're about to purge — so the journal still renders the
    // entity even after the row is gone. tobaccoId / pipeId stay
    // untouched (fantôme id; the snapshot drives display).
    var purgedTobs = tobsAfterLotPurge.filter(isTrashed);
    var purgedPipes = (d.pipes || []).filter(isTrashed);
    var sessAfterSnap = refreshSnapshotsForRemoval(
      stripDeleted(sessAfterOrphan),
      purgedTobs,
      purgedPipes,
    );
    save(Object.assign({}, d, {
      tobaccos:    stripDeleted(tobsAfterLotPurge),
      pipes:       stripDeleted(d.pipes),
      wishlist:    stripDeleted(d.wishlist),
      accessories: stripDeleted(d.accessories),
      sessions:    sessAfterSnap,
    }));
  }

  return {
    restoreFromTrash,
    restoreSelectionFromTrash,
    restoreAllFromTrash,
    permanentlyDelete,
    emptyTrash,
  };
}
