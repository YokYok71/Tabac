import React from "react";
import { BP } from "../constants.ts";
import { refreshSnapshotsForRemoval, readDefaultGrouped, toggleCollapseKey, monotonicId, newUid } from "../utils.ts";

var useState = React.useState;

export function usePipeStore({
  data,
  save,
  nav,
}: {
  data: any;
  save: (d: any) => void;
  nav: (v: string, opts?: { restoreScroll?: boolean }) => void;
}) {
  var _pf = useState(Object.assign({}, BP)),
    pipeForm = _pf[0],
    setPipeForm = _pf[1];
  var _pd = useState<any>(null),
    pipeDet = _pd[0],
    setPipeDet = _pd[1];
  var _ep = useState<any>(null),
    editPipeId = _ep[0],
    setEditPipeId = _ep[1];
  var _spf = useState(false),
    showFinishedPipes = _spf[0],
    setShowFinishedPipes = _spf[1];
  var _pg = useState(readDefaultGrouped),
    pipesGrouped = _pg[0],
    setPipesGrouped = _pg[1];
  var _cpg = useState<Record<string, any>>({}),
    collapsedPipeGroups = _cpg[0],
    setCollapsedPipeGroups = _cpg[1];

  function addPipe() {
    if (!pipeForm.name || !pipeForm.brand) return;
    var p = Object.assign({}, pipeForm, { id: data.nxP || 1, uid: pipeForm.uid || newUid(), updatedAt: new Date().toISOString() });
    if (!p.status) p.status = "active";
    save(
      Object.assign({}, data, {
        pipes: (data.pipes || []).concat([p]),
        nxP: (data.nxP || 1) + 1,
      }),
    );
    setPipeForm(Object.assign({}, BP));
    // Expand the new pipe's brand group so it's
    // visible on return (the pipes list groups by brand, collapsed by default).
    setCollapsedPipeGroups(function (prev: any) { return Object.assign({}, prev, { [p.brand]: false }); });
    nav("pipes", { restoreScroll: true });
  }

  function updatePipe() {
    // Mirror addPipe's guard — the back-guard
    // "Enregistrer" calls this without re-checking canSave, so a cleared
    // name/brand must not silently persist a nameless pipe + navigate away.
    if (!pipeForm.name || !pipeForm.brand) return;
    save(
      Object.assign({}, data, {
        pipes: (data.pipes || []).map(function (p: any) {
          // Preserve the stored maintenance log — the pipe edit
          // form doesn't touch it (it's edited via its own modal), so the
          // store's copy is authoritative and must never be clobbered by a
          // stale `pipeForm` snapshot.
          return p.id === editPipeId
            ? Object.assign({}, pipeForm, {
                id: editPipeId,
                maintenance: Array.isArray(p.maintenance) ? p.maintenance : (pipeForm.maintenance || []),
                updatedAt: new Date().toISOString(),
              })
            : p;
        }),
      }),
    );
    setEditPipeId(null);
    setPipeForm(Object.assign({}, BP));
    nav("pipes", { restoreScroll: true });
  }

  function deletePipe(id: any) {
    // Soft-delete — see useTobaccoStore.deleteTobacco for
    // the trash semantics.
    // Refresh `pipeSnapshot` on every referencing session
    // before the pipe leaves liveData — see useTobaccoStore.deleteTobacco
    // for the rationale.
    var now = new Date().toISOString();
    var target = (data.pipes || []).find(function (p: any) { return p && p.id === id; });
    var nextSessions = target
      ? refreshSnapshotsForRemoval(data.sessions || [], [], [target])
      : (data.sessions || []);
    save(
      Object.assign({}, data, {
        pipes: (data.pipes || []).map(function (p: any) {
          if (p.id !== id) return p;
          return Object.assign({}, p, { deletedAt: now });
        }),
        sessions: nextSessions,
      }),
    );
    if (pipeDet && pipeDet.id === id) setPipeDet(null);
  }

  function changePipeStatus(id: any, ns: any) {
    var pipes = (data.pipes || []).map(function (p: any) {
      if (p.id !== id) return p;
      // Stamp updatedAt like every other mutating action so
      // a multi-device status flip propagates through the entity LWW
      // (status is a descriptive, non-protected field). Future-proofing — no
      // view currently routes status through here (it moved to the
      // edit form), but a stale stamp would silently drop the change on merge.
      return Object.assign({}, p, { status: ns, updatedAt: new Date().toISOString() });
    });
    save(Object.assign({}, data, { pipes: pipes }));
    setPipeDet(
      pipes.find(function (p: any) {
        return p.id === id;
      }),
    );
  }

  function togglePipeGroup(key: any) {
    setCollapsedPipeGroups(function (prev: any) {
      return toggleCollapseKey(prev, key);
    });
  }

  // ── Maintenance log ("Carnet d'entretien") ───────────────────────────────
  // Entries live inside pipe.maintenance (like tobacco.lots). Each mutation
  // rewrites the target pipe and, if its detail panel is open, refreshes the
  // pipeDet snapshot so the list re-renders immediately.
  function _mutatePipeMaint(pipeId: any, fn: (list: any[]) => any[]) {
    var pipes = (data.pipes || []).map(function (p: any) {
      if (p.id !== pipeId) return p;
      var list = Array.isArray(p.maintenance) ? p.maintenance : [];
      return Object.assign({}, p, { maintenance: fn(list) });
    });
    save(Object.assign({}, data, { pipes: pipes }));
    var updated = pipes.find(function (p: any) { return p.id === pipeId; });
    if (pipeDet && pipeDet.id === pipeId && updated) setPipeDet(updated);
  }

  function addMaintenance(pipeId: any, entry: any) {
    // The id MUST be assigned LAST. MaintFormModal seeds
    // its form from EMPTY = { id: 0, … } and passes the whole form here, so a
    // leading `{ id: Date.now() }` default was OVERWRITTEN back to 0 by the
    // spread — every maintenance entry ended up with id === 0, and a later
    // update/remove keyed on id then hit EVERY entry at once (corruption). Also
    // drop the vestigial legacy `type` field in favour of kind/tasks.
    // Mint a stable cross-device uid alongside the per-device
    // numeric id (id is forced fresh to close the id:0 collision above).
    var e = Object.assign({ date: "", kind: "light", tasks: [], notes: "" }, entry, { id: monotonicId(), uid: newUid() });
    _mutatePipeMaint(pipeId, function (list: any[]) { return list.concat([e]); });
  }

  function updateMaintenance(pipeId: any, entryId: any, entry: any) {
    _mutatePipeMaint(pipeId, function (list: any[]) {
      return list.map(function (m: any) {
        return m.id === entryId ? Object.assign({}, m, entry, { id: entryId }) : m;
      });
    });
  }

  function removeMaintenance(pipeId: any, entryId: any) {
    _mutatePipeMaint(pipeId, function (list: any[]) {
      return list.filter(function (m: any) { return m.id !== entryId; });
    });
  }

  return {
    pipeForm,
    setPipeForm,
    pipeDet,
    setPipeDet,
    editPipeId,
    setEditPipeId,
    showFinishedPipes,
    setShowFinishedPipes,
    pipesGrouped,
    setPipesGrouped,
    collapsedPipeGroups,
    setCollapsedPipeGroups,
    addPipe,
    updatePipe,
    deletePipe,
    changePipeStatus,
    togglePipeGroup,
    addMaintenance,
    updateMaintenance,
    removeMaintenance,
  };
}
