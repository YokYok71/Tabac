import React from "react";
import { BW, BT } from "../constants.ts";
import { restoreScrollY, readDefaultGrouped, toggleCollapseKey, newUid } from "../utils.ts";

var useState = React.useState;

export function useWishStore({
  data,
  save,
  nav,
  setForm,
  fromWishRef,
  scrollSaveRef,
}: {
  data: any;
  save: (d: any) => void;
  nav: (v: string) => void;
  setForm: (f: any) => void;
  fromWishRef: React.MutableRefObject<any>;
  scrollSaveRef: React.MutableRefObject<Record<string, any>>;
}) {
  var _wf = useState(Object.assign({}, BW)),
    wishForm = _wf[0],
    setWishForm = _wf[1];
  var _ew = useState<any>(null),
    editWishId = _ew[0],
    setEditWishId = _ew[1];
  var _swf = useState(false),
    showWishForm = _swf[0],
    setShowWishForm = _swf[1];
  var _wg = useState(readDefaultGrouped),
    wishGrouped = _wg[0],
    setWishGrouped = _wg[1];
  var _cwg = useState<Record<string, any>>({}),
    collapsedWishGroups = _cwg[0],
    setCollapsedWishGroups = _cwg[1];

  function addWish(override?: any) {
    // Optional `override` lets callers (CatalogView one-tap
    // add) inject a fully-shaped wish entry without staging the
    // internal `wishForm` state first. When given, we skip the form
    // reset + overlay close — the caller isn't using the overlay.
    var source = override || wishForm;
    if (!source.name) return;
    save(
      Object.assign({}, data, {
        wishlist: (data.wishlist || []).concat([
          Object.assign({}, source, { id: data.nxW || 1, uid: source.uid || newUid(), updatedAt: new Date().toISOString() }),
        ]),
        nxW: (data.nxW || 1) + 1,
      }),
    );
    if (!override) {
      setWishForm(Object.assign({}, BW));
      setShowWishForm(false);
      // Expand the new wish's brand group so it's
      // visible on return (the wishlist groups by brand, collapsed by default).
      // `source.brand || ""` — the wishlist keys brand-less
      // items on the stable "" (not the localized "Sans marque"), so a wish
      // added with no brand expands the right group instead of staying hidden.
      setCollapsedWishGroups(function (prev: any) { return Object.assign({}, prev, { [source.brand || ""]: false }); });
    }
  }

  function updateWish() {
    if (!wishForm.name) return;
    save(
      Object.assign({}, data, {
        wishlist: (data.wishlist || []).map(function (w: any) {
          return w.id === editWishId
            ? Object.assign({}, wishForm, { id: editWishId, updatedAt: new Date().toISOString() })
            : w;
        }),
      }),
    );
    setWishForm(Object.assign({}, BW));
    setEditWishId(null);
    setShowWishForm(false);
    // Use the shared retry helper (was a single rAF that
    // raced React's remount). The save site for "wish" was once
    // missing — see InventoryListView where setShowWishForm
    // is fired; the open paths now snapshot window.scrollY first.
    var _sy = scrollSaveRef.current["wish"] || 0;
    if (_sy > 0) {
      scrollSaveRef.current["wish"] = 0;
      restoreScrollY(_sy);
    }
  }

  function delWish(id: any) {
    // Soft-delete — see useTobaccoStore.deleteTobacco.
    var now = new Date().toISOString();
    save(
      Object.assign({}, data, {
        wishlist: (data.wishlist || []).map(function (w: any) {
          if (w.id !== id) return w;
          return Object.assign({}, w, { deletedAt: now });
        }),
      }),
    );
  }

  function wishToInv(w: any) {
    setForm(
      Object.assign({}, BT, {
        name: w.name || "",
        brand: w.brand || "",
        category: w.category || "",
        blend: w.blend || "",
        cut: w.cut || "",
        force: w.force || 0,
        roomNote: w.roomNote || 0,
        taste: w.taste || 0,
        description: w.description || "",
        tastingNotes: w.tastingNotes || "",
        imageUrl: w.imageUrl || "",
        agingMax: w.agingMax || "",
        // Carry the catalogue lock across the conversion. The
        // allowlist above copies the very data the lock existed to protect —
        // a corrected composition, a measured force, a rewritten description —
        // so dropping the shield would hand the next bulk pass exactly those
        // fields. Coerced, because the source is stored data.
        catalogueLock: w.catalogueLock === true,
      }),
    );
    nav("addT");
    fromWishRef.current = w.id;
  }

  function toggleWishGroup(key: any) {
    setCollapsedWishGroups(function (prev: any) {
      return toggleCollapseKey(prev, key);
    });
  }

  return {
    wishForm,
    setWishForm,
    editWishId,
    setEditWishId,
    showWishForm,
    setShowWishForm,
    wishGrouped,
    setWishGrouped,
    collapsedWishGroups,
    setCollapsedWishGroups,
    addWish,
    updateWish,
    delWish,
    wishToInv,
    toggleWishGroup,
  };
}
