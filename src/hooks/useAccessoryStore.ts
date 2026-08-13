import React from "react";
import { BA } from "../constants.ts";
import { readDefaultGrouped, toggleCollapseKey, newUid } from "../utils.ts";

var useState = React.useState;

export function useAccessoryStore({
  data,
  save,
  nav,
}: {
  data: any;
  save: (d: any) => void;
  nav: (v: string, opts?: { restoreScroll?: boolean }) => void;
}) {
  var _af = useState(Object.assign({}, BA)),
    accForm = _af[0],
    setAccForm = _af[1];
  var _ad = useState<any>(null),
    accDet = _ad[0],
    setAccDet = _ad[1];
  var _ea = useState<any>(null),
    editAccId = _ea[0],
    setEditAccId = _ea[1];
  var _sra = useState(false),
    showRetiredAcc = _sra[0],
    setShowRetiredAcc = _sra[1];
  var _ag = useState(readDefaultGrouped),
    accsGrouped = _ag[0],
    setAccsGrouped = _ag[1];
  var _cag = useState<Record<string, any>>({}),
    collapsedAccGroups = _cag[0],
    setCollapsedAccGroups = _cag[1];

  function addAccessory() {
    if (!accForm.name && !accForm.brand) return;
    var a = Object.assign({}, accForm, { id: data.nxA || 1, uid: accForm.uid || newUid(), updatedAt: new Date().toISOString() });
    if (!a.status) a.status = "active";
    save(
      Object.assign({}, data, {
        accessories: (data.accessories || []).concat([a]),
        nxA: (data.nxA || 1) + 1,
      }),
    );
    setAccForm(Object.assign({}, BA));
    // Expand the new accessory's TYPE group so
    // it's visible on return (the accessory list groups by type, collapsed by
    // default — the group key is `type || "Autre"`).
    setCollapsedAccGroups(function (prev: any) { return Object.assign({}, prev, { [a.type || "Autre"]: false }); });
    nav("acc", { restoreScroll: true });
  }

  function updateAccessory() {
    // Mirror addAccessory's guard — the back-guard
    // "Enregistrer" calls this without re-checking canSave, so an entity with
    // an empty name AND brand must not be silently persisted.
    if (!accForm.name && !accForm.brand) return;
    save(
      Object.assign({}, data, {
        accessories: (data.accessories || []).map(function (a: any) {
          return a.id === editAccId
            ? Object.assign({}, accForm, { id: editAccId, updatedAt: new Date().toISOString() })
            : a;
        }),
      }),
    );
    setEditAccId(null);
    setAccForm(Object.assign({}, BA));
    nav("acc", { restoreScroll: true });
  }

  function deleteAccessory(id: any) {
    // Soft-delete — see useTobaccoStore.deleteTobacco.
    var now = new Date().toISOString();
    save(
      Object.assign({}, data, {
        accessories: (data.accessories || []).map(function (a: any) {
          if (a.id !== id) return a;
          return Object.assign({}, a, { deletedAt: now });
        }),
      }),
    );
    if (accDet && accDet.id === id) setAccDet(null);
  }

  function changeAccStatus(id: any, ns: any) {
    var accs = (data.accessories || []).map(function (a: any) {
      if (a.id !== id) return a;
      // Stamp updatedAt so a status flip propagates through
      // the entity LWW (parity with changePipeStatus + the CRUD).
      return Object.assign({}, a, { status: ns, updatedAt: new Date().toISOString() });
    });
    save(Object.assign({}, data, { accessories: accs }));
    setAccDet(
      accs.find(function (a: any) {
        return a.id === id;
      }),
    );
  }

  function toggleAccGroup(key: any) {
    setCollapsedAccGroups(function (prev: any) {
      return toggleCollapseKey(prev, key);
    });
  }

  return {
    accForm,
    setAccForm,
    accDet,
    setAccDet,
    editAccId,
    setEditAccId,
    showRetiredAcc,
    setShowRetiredAcc,
    accsGrouped,
    setAccsGrouped,
    collapsedAccGroups,
    setCollapsedAccGroups,
    addAccessory,
    updateAccessory,
    deleteAccessory,
    changeAccStatus,
    toggleAccGroup,
  };
}
