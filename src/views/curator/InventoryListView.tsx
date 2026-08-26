// Inventory list view (tobaccos + wishlist filter).
// Renders nothing when view !== "inv" or `detail` is set (InventoryDetailView takes over).
// Reads filtered/sorted/grouped data straight from ctx; only the chrome is Curator.

import { useMemo, useState, useEffect, useRef } from "react";
import React from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { useProgressiveList, useProgressiveGroups } from "../../hooks/useProgressiveList.ts";
import { ProgressiveMore } from "../../components/curator/ProgressiveMore.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { alpha, fs, C, F, CARD_ACCENTS, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { fmtNum, plural, fmtLotAge, daysSince, effectiveAgingMax, countActive } from "../../utils.ts";
import { lsGet, lsSet } from "../../utils/appStorage.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  PageTitle, useEnter, useReliableTap, EmptyState,
} from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import { MaturityChip } from "../../components/curator/MaturityChip.tsx";
import { ToggleBtn, ActiveFilterPill, ScrollableChipRow } from "../../components/curator/FilterControls.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { computeShoppingList, shoppingCount, isLowStock } from "../../utils/shopping.ts";
import { compareByBrandThenName } from "../../utils/sortBrandName.ts";
import { allTags } from "../../utils/tags.ts";
import { FilterChipSimple } from "../../components/curator/FilterControls.tsx";
import { bumpFormSession } from "../../utils/formSession.ts";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { AromaPicker } from "../../components/curator/AromaPicker.tsx";
import { aromaLabelKey } from "../../utils/aromas.ts";
import { lotMaturityBucket, scopeFromStatusFilter, scopedHeldWeight, scopedOldestAgeDays, scopeLabelKey, lotInScope, isRecentPurchase } from "../../utils/cellarInsights.ts";
import { CATS_EN, CUTS_EN } from "../../constants.ts";
import type { Tobacco, WishlistItem } from "../../types.ts";

export function CuratorInventoryListView() {
  const ctx = useAppCtx();
  const {
    view, detail, data, t, nav, filtered,
    statusFilter, setStatusFilter,
    catFilter, setCatFilter, cutFilter, setCutFilter,
    brandFilter, setBrandFilter,
    tagFilter, setTagFilter,
    ratingFilter, setRatingFilter,
    aromaFilter = [], setAromaFilter,
    xl,
    sortBy, setSortBy,
    tobGrouped, setTobGrouped, collapsedTobGroups, toggleTobGroup, setCollapsedTobGroups,
    wishGrouped, setWishGrouped, collapsedWishGroups, toggleWishGroup,
    wishFocusId, setWishFocusId,
    expandCards, setExpandCards,
    setDetail, setSearchOpen,
    wishToInv, delWish, setWishForm, setEditWishId, setShowWishForm,
    showWishForm, editWishId,
    lotAgingStatus,
    BW,
    BT, setForm, setEditId,
    scrollSaveRef,
    setShoppingOpen, weightUnit = "g", watchLowWeight,
  } = ctx;
  // Wrap the nullish fallbacks in useMemo so the `tobaccos`
  // reference stays stable when `data?.tobaccos` is the same array — the
  // downstream `counts` useMemo otherwise re-runs every render because
  // `(undefined || [])` creates a new [] on each call.
  const tobaccos = useMemo(
    () => (data?.tobaccos || []) as Tobacco[],
    [data?.tobaccos],
  );
  const wishlist = useMemo(
    () => (data?.wishlist || []) as WishlistItem[],
    [data?.wishlist],
  );
  const wishVisible = statusFilter === "wish";
  const visible = (filtered || tobaccos) as Tobacco[];

  // Shopping-list count → the cart icon in the top bar (shown only
  // when there's something to buy: low-stock rebuys + wishlist).
  const shopCount = useMemo(
    () => shoppingCount(computeShoppingList(data?.tobaccos || [], data?.wishlist || [], {
      lowWeightThreshold: parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25),
    })),
    [data?.tobaccos, data?.wishlist, watchLowWeight, weightUnit],
  );

  // When the user LEAVES the wishlist (swipe-back / tapping another
  // chip resets statusFilter "wish" → "active"), scroll the status-chip strip
  // back to the far left. The Wishlist chip sits at the right of the strip, so
  // the row was stuck there — the user wants it re-homed on "Actifs".
  const [chipScrollReset, setChipScrollReset] = useState(0);
  // Reveal the wishlist card a global-search hit asked for.
  //
  // The search used to land here and drop the id: a 16-item list opened at the
  // top, on a different item, with nothing saying where the match went. The
  // destination is the CARD, not the edit form — a wish has no fiche (the card
  // IS the record) and tap-to-edit was removed from WishCard exactly
  // so a read expectation never lands in a form.
  //
  // Two things have to happen in order, which is why this is an effect and not
  // a scroll call in the search handler: the list may be GROUPED and the item's
  // brand group COLLAPSED, in which case the card is not in the DOM at all, so
  // the group is expanded first and the scroll waits for the next paint.
  const [focusedWishId, setFocusedWishId] = useState<any>(null);
  useEffect(() => {
    if (!wishFocusId || !wishVisible) return;
    const w = (data?.wishlist || []).find((x: any) => String(x.id) === String(wishFocusId));
    if (!w) { setWishFocusId && setWishFocusId(null); return; }
    // The rule: the collapse key is the STABLE brand, "" when absent.
    const key = w.brand || "";
    if (wishGrouped && (collapsedWishGroups || {})[key] !== false) {
      toggleWishGroup && toggleWishGroup(key);
    }
    setFocusedWishId(wishFocusId);
    setWishFocusId && setWishFocusId(null);
  }, [wishFocusId, wishVisible, data, wishGrouped, collapsedWishGroups, toggleWishGroup, setWishFocusId]);

  // Scroll once the card is actually rendered (a just-expanded group needs a
  // paint first), then let the ring fade so the list returns to normal.
  useEffect(() => {
    if (!focusedWishId) return;
    // Align the card's TOP just under the sticky TopBar — never
    // `block: "center"`. A wish card carries the full description, so it is
    // routinely TALLER than the viewport, and centring its box pushed the
    // photo, the brand and the name off the top: exactly the three things that
    // say WHICH card this is. Reported after 175 ("le haut de la fiche est
    // masqué"). The bar's height is MEASURED, because it varies with the
    // safe-area inset and the text-size setting — a constant is wrong on most
    // devices.
    //
    // And the scroll KEEPS CORRECTING across the whole entry animation. Each
    // card fades in through `useEnter` with a delay PROPORTIONAL TO ITS INDEX
    // (100 + idx*50 ms), and expanding a brand group re-lays the list out after
    // the first scroll — so a single scrollTo, or a loop that exits as soon as
    // the position looks settled, lands wrong. MEASURED both ways: one scroll
    // put the card 2 px under a 66 px bar; an early exit left a mid-list card at
    // 1598 px, entirely off screen, because the loop finished before that card's
    // animation had even started.
    //
    // It runs ~1 s and ABORTS the moment the scroll position is not the one it
    // set — i.e. as soon as the user takes over — so it can never fight a
    // deliberate swipe.
    let tries = 0;
    let ourY = -1;
    let raf = 0;
    const seek = () => {
      if (ourY >= 0 && Math.abs(window.scrollY - ourY) > 4) return;   // user scrolled
      const el = document.querySelector(`[data-wish-id="${CSS.escape(String(focusedWishId))}"]`);
      if (el) {
        const bar = document.querySelector("[data-topbar]");
        const off = (bar ? bar.getBoundingClientRect().height : 0) + 10;
        const delta = el.getBoundingClientRect().top - off;
        if (Math.abs(delta) > 2) {
          window.scrollTo({ top: Math.max(0, window.scrollY + delta) });
          ourY = Math.round(window.scrollY);
        }
      }
      if (tries++ < 60) raf = requestAnimationFrame(seek);
    };
    raf = requestAnimationFrame(seek);
    const clear = window.setTimeout(() => setFocusedWishId(null), 2600);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(clear); };
  }, [focusedWishId]);

  const prevWishRef = useRef(wishVisible);
  useEffect(() => {
    if (prevWishRef.current && !wishVisible) setChipScrollReset((n) => n + 1);
    prevWishRef.current = wishVisible;
  }, [wishVisible]);

  // Counts per status — for filter chip badges.
  const sortRing = useFocusRing();
  const wishSortRing = useFocusRing();
  // The wishlist gets its own display order — by product name
  // (default) or by brand. Independent of the brand-grouping toggle; when
  // grouped, it orders the items INSIDE each brand group. Persisted in
  // localStorage `cave-wish-sort` so the choice survives a relaunch.
  const [wishSort, setWishSortState] = useState<"name" | "brand">(
    () => (lsGet("cave-wish-sort") === "brand" ? "brand" : "name"),
  );
  const setWishSort = (v: "name" | "brand") => {
    setWishSortState(v);
    lsSet("cave-wish-sort", v);
  };
  // Focus rings for the type / cut / rating dropdowns.
  // Declared up here (before the early-return for `view !== "inv"`)
  // to honour the Curator UI hook-order trap rule — hooks must be
  // stable across every render including the inactive one.
  const catRing = useFocusRing();
  const cutRing = useFocusRing();
  const ratingRing = useFocusRing();
  // Aroma filter modal (draft edited in the picker, applied on
  // confirm so the list doesn't churn under the open sheet).
  const [aromaModalOpen, setAromaModalOpen] = useState(false);
  const [aromaDraft, setAromaDraft] = useState<string[]>([]);
  // The secondary filters (Type / Coupe / Note dropdowns + the tag
  // chips) are collapsed behind a "Plus de filtres" toggle to save vertical
  // space; a dot on the toggle flags when one of them is active.
  const [advFiltersOpen, setAdvFiltersOpen] = useState(false);
  // "Stock bas" threshold — same definition as the shopping list
  // and the watchlist (user's display unit, default 25 g / 0.9 oz).
  const lowThreshold = parseFloat(watchLowWeight) || (weightUnit === "oz" ? 0.9 : 25);
  const counts = useMemo(() => {
    let cellar = 0, jars = 0, finished = 0, disposed = 0, approaching = 0, overaged = 0, smokesoon = 0, active = 0, usedUp = 0, nolot = 0, norebuy = 0, young = 0, optimal = 0, lowstock = 0, recent = 0;
    for (const tob of tobaccos) {
      if (tob.rebuy === false) norebuy++;
      if (isLowStock(tob, lowThreshold)) lowstock++;
      // scope-ok: these counts label the filter chips THEMSELVES ("how many
      // tabacs have ≥1 jar lot"), so they must see every lot regardless of
      // which chip is currently active — scoping them would make each chip
      // count only the slice already selected.
      const lots = tob.lots || [];
      const eam = effectiveAgingMax(tob);
      // Maturity bands (shared classifier with the Home bar).
      // effectiveAgingMax so the family default drives the bands
      // when the tobacco carries no explicit target.
      if (lots.some((l: any) => lotMaturityBucket(l, eam) === "young")) young++;
      if (lots.some((l: any) => lotMaturityBucket(l, eam) === "optimal")) optimal++;
      // "active" = at least one non-finished lot.
      // Used by the "Actifs" chip — a discrete filter so the user
      // can pick "everything I'm currently smoking or cellaring" without
      // touching "Tous" (which lists every tabac including finished-only).
      // This predicate MUST match App.tsx's "active" filter
      // (`countActive(t) > 0`) verbatim. The lot-less clause was dropped
      // — a tabac with no active lot (including a lot-LESS one) is inactive.
      if (countActive(tob) > 0) active++;
      // Split the old "Inactifs" (countActive===0) into two —
      // "Épuisé" (has lots, all done — a rebuy candidate) and "Sans lot"
      // (no lot at all — incomplete data). MUST match App.tsx's filters.
      if (countActive(tob) === 0) { if (lots.length > 0) usedUp++; else nolot++; }
      if (lots.some((l: any) => l.status === "cellar")) cellar++;
      if (lots.some((l: any) => l.status === "jar")) jars++;
      // "Finis" matches the App.tsx filter — finished
      // non-disposed lots. Disposed lots get their own "Éliminés" chip.
      if (lots.some((l: any) => l.status === "finished" && !l.disposed)) finished++;
      if (lots.some((l: any) => !!l.disposed)) disposed++;
      // MUST match App.tsx's "recent" filter verbatim.
      if (lots.some((l: any) => l.status !== "finished" && isRecentPurchase(l))) recent++;
      if (lotAgingStatus) {
        let mApp = false, mOver = false;
        for (const l of lots) {
          const s = lotAgingStatus(l, eam);
          if (s === "approaching") mApp = true;
          else if (s === "overaged") mOver = true;
        }
        if (mApp) approaching++;
        if (mOver) overaged++;
        // The Home tile's slice — either band. NOT approaching + overaged: a
        // tabac holding one lot of each would be counted twice, and this
        // counts TABACS while the tile counts LOTS, so the two figures answer
        // different questions and only the list has to match its own rows.
        if (mApp || mOver) smokesoon++;
      }
    }
    return { all: tobaccos.length, active, usedUp, nolot, cellar, jars, finished, disposed, approaching, overaged, smokesoon, norebuy, young, optimal, lowstock, recent };
  }, [tobaccos, lotAgingStatus, lowThreshold]);

  // Dropdown filter options derived from the user's live
  // inventory (NOT the full CATS/CUTS enums). Same shape as the
  // Journal's pipe/tobacco filters — only values that appear at
  // least once in the data make it into the dropdown, so the user
  // never sees a phantom option. Sorted using the FR original (the
  // EN translation is purely display via xl()).
  // In wish mode the options derive from the wishlist (wish
  // items carry the same category / cut fields), so the type & cut
  // dropdowns work on both datasets. Switching modes auto-clears a
  // filter whose value doesn't exist in the other dataset via the
  // stale-filter reset below — deliberate, keeps the list from sitting
  // empty under a phantom selection.
  const filterDropdownOptions = useMemo(() => {
    const cats = new Set<string>();
    const cuts = new Set<string>();
    const src: { category?: string; cut?: string }[] = wishVisible ? wishlist : tobaccos;
    for (const it of src) {
      if (it.category) cats.add(it.category);
      if (it.cut) cuts.add(it.cut);
    }
    return {
      cats: Array.from(cats).sort((a, b) => String(a).localeCompare(String(b))),
      cuts: Array.from(cuts).sort((a, b) => String(a).localeCompare(String(b))),
    };
  }, [tobaccos, wishlist, wishVisible]);

  // The wishlist honours the same type / cut dropdowns as the
  // tobacco list (it ignored them entirely before — the filters existed
  // in ctx but only drove the tobacco `filtered` memo in App.tsx).
  // ratingFilter is NOT applied: WishlistItem has no personal `rating`
  // field (only force / roomNote / taste), so the rating select is
  // hidden in wish mode.
  const wishShown = useMemo(() => {
    let ws = wishlist;
    if (catFilter) ws = ws.filter(w => w.category === catFilter);
    if (cutFilter) ws = ws.filter(w => w.cut === cutFilter);
    // Order by product name (default) or by brand (then name).
    const byName = (a: WishlistItem, b: WishlistItem) =>
      String(a.name || "").localeCompare(String(b.name || ""));
    // The shared brand-then-name comparator; `byName` stays for the
    // other mode. This was a fourth copy of the same sentence.
    ws = ws.slice().sort(wishSort === "brand" ? compareByBrandThenName : byName);
    return ws;
  }, [wishlist, catFilter, cutFilter, wishSort]);

  // Distinct user tags across the inventory (drives the filter row).
  const tagList = useMemo(() => allTags(tobaccos), [tobaccos]);

  // Stale-filter reset — if the user deletes the last tabac of a
  // given category / cut, clear the filter so the list doesn't sit
  // empty under a phantom selection. Guarded reset pattern: the
  // setter only fires when the value is missing from the derived
  // list (steady-state is a no-op, so user input doesn't trip the
  // CLAUDE.md "prefill-race trap" rule).
  useEffect(() => {
    if (catFilter && !filterDropdownOptions.cats.includes(catFilter)) {
      setCatFilter && setCatFilter("");
    }
    if (cutFilter && !filterDropdownOptions.cuts.includes(cutFilter)) {
      setCutFilter && setCutFilter("");
    }
  }, [filterDropdownOptions, catFilter, cutFilter, setCatFilter, setCutFilter]);

  // The two FLAT branches render one card per row, unbounded. MEASURED at
  // 390x844 on a 300-tobacco cellar with « Listes groupées par défaut » OFF:
  // 21 757 DOM nodes, 35 MB of heap, a page 70 298 px tall, 2.5 s to render —
  // against 437 nodes for the same cellar grouped. That preference is in
  // Réglages, so a user who prefers flat lists pays it on EVERY visit. Hooks
  // above the early returns, per the hook-order rule; a cellar of ordinary size
  // never reaches the cap.
  const flatTob = useProgressiveList(visible);
  const flatWish = useProgressiveList(wishShown);
  // ET LES GROUPES. Le plafond du branchement PLAT ne couvrait qu'une porte : une
  // MARQUE dépliée rend tous ses tabacs. MESURÉ en jsdom, 5 000 tabacs sous une
  // seule marque — 92 nœuds replié, **140 093 dépliés**. Un tap sur un en-tête
  // qui n'existe que pour être tapé.
  const wishGroupRows = useProgressiveGroups();

  if (view !== "inv" || detail) return null;
  if (showWishForm || editWishId) return null;

  const sortOptions = [
    { value: "name",     label: t ? t("f_name")        : "Nom" },
    { value: "brand",    label: t ? t("f_brand")       : "Marque" },
    { value: "rating",   label: t ? t("f_rating")      : "Note" },
    { value: "aging",    label: t ? t("sort_age")      : "Âge" },
    { value: "qty",      label: t ? t("sort_qty")      : "Quantité" },
    { value: "force",    label: t ? t("lbl_force")     : "Force" },
    { value: "roomNote", label: t ? t("lbl_room_note") : "Room Note" },
    { value: "taste",    label: t ? t("lbl_taste")     : "Goût" },
  ];

  const chips: { id: string; label: string; n: number; icon?: IcoName; color?: string }[] = [
    { id: "all",      label: t ? t("f_all")      : "Tous",   n: counts.all },
    { id: "active",   label: t ? t("f_active") : "Actifs", n: counts.active, color: C.sageHi },
    { id: "cellar",   label: t ? t("f_cellar")   : "En cave",   n: counts.cellar },
    { id: "jar",      label: t ? t("f_jars")     : "En pot",   n: counts.jars },
    { id: "wish",     label: t ? t("lbl_wishlist") : "Wishlist",
      n: wishlist.length, icon: "heart", color: C.oxbloodHi },
    { id: "lowstock", label: t ? t("f_lowstock") : "Stock bas",
      n: counts.lowstock, color: C.amber },
    { id: "recent",   label: t ? t("f_recent") : "Achats récents",
      n: counts.recent, color: C.sageHi },
    { id: "young",    label: t ? t("f_young") : "Jeunes",
      n: counts.young, color: C.sage },
    { id: "optimal",  label: t ? t("f_optimal") : "Optimale",
      n: counts.optimal, color: C.brass },
    { id: "approaching", label: t ? t("mat_peak") : "Pic proche",
      n: counts.approaching, color: C.brassHi },
    { id: "overaged",    label: t ? t("mat_old") : "Trop âgé",
      n: counts.overaged, color: C.oxbloodHi },
    // The destination of the Home tile, wearing the tile's OWN label so the
    // user can see they landed where they tapped. It overlaps the two chips
    // above on purpose — it is their union, and the tile needed a slice that
    // holds everything it counts.
    { id: "smokesoon",   label: t ? t("stat_smoke_soon") : "À fumer rapidement",
      n: counts.smokesoon, color: C.oxbloodHi },
    { id: "used_up", label: t ? t("f_used_up") : "Épuisé",
      n: counts.usedUp, color: C.tx3 },
    { id: "nolot", label: t ? t("f_nolot") : "Sans lot",
      n: counts.nolot, color: C.tx3 },
    { id: "finished", label: t ? t("f_finished") : "Lot fini",  n: counts.finished },
    { id: "disposed", label: t ? t("f_disposed") : "Éliminés",
      n: counts.disposed, color: C.tx3 },
    { id: "norebuy", label: t ? t("f_norebuy") : "À ne pas reprendre",
      n: counts.norebuy, color: C.oxbloodHi },
  ];

  // Statuses that narrow beyond the default "active" view also
  // surface as a clearable × pill in the active-filter row (so a filter set
  // from a Home/Stats deep-link — e.g. the maturity bar — is visible and
  // removable at the top, not just highlighted in the scrollable chip row).
  // The × resets the status to the default "active".
  const STATUS_PILL_IDS = ["cellar", "jar", "recent", "used_up", "nolot", "finished", "disposed", "norebuy", "lowstock", "young", "optimal", "approaching", "overaged", "smokesoon"];
  const statusPill = STATUS_PILL_IDS.indexOf(statusFilter) >= 0
    ? chips.find((c) => c.id === statusFilter)
    : null;

  const noHits = (wishVisible ? wishShown.length : visible.length) === 0;

  // "you own nothing yet" and "your filters matched nothing" are
  // DIFFERENT screens and were showing the same sentence. `visible` is the
  // FILTERED array, so someone with 200 tobaccos and a forgotten chip got the
  // identical « Aucun tabac » as a first-run user, with no hint that a filter
  // was even on. The journal had long distinguished the two; the
  // other three lists never did.
  //
  // The status chip is deliberately EXCLUDED from "is a filter on": it always
  // has a value ("active" by default), so counting it would call every
  // first-run screen filtered and offer a reset that changes nothing.
  const invFiltered = !!(
    (statusFilter && statusFilter !== "active" && statusFilter !== "wish")
    || catFilter || cutFilter || brandFilter || tagFilter
    || ratingFilter || (aromaFilter && aromaFilter.length > 0)
  );
  const resetInvFilters = () => {
    setStatusFilter && setStatusFilter(wishVisible ? "wish" : "active");
    setCatFilter && setCatFilter("");
    setCutFilter && setCutFilter("");
    setBrandFilter && setBrandFilter("");
    setTagFilter && setTagFilter("");
    setRatingFilter && setRatingFilter(0);
    setAromaFilter && setAromaFilter([]);
  };

  // The "+" must BLANK the working copy, exactly as the
  // wishlist branch of this very handler already did. `form` is reset in only
  // three places (add success, update success, the form's own `cancel`), and
  // `nav()` is forbidden from touching it (a standing invariant, correctly) —
  // so LEAVING an edit form any other way keeps the working copy loaded, and
  // that is easy: a CLEAN edit form is skipped by the unsaved guard, so a
  // system-back or an edge-swipe walks straight out with `form` still holding
  // the edited tobacco. The next "+" then opened « Un nouveau tabac » over the
  // previous one's fields.
  //
  // It is not cosmetic. `addTobacco` does `uid: source.uid || newUid()` and
  // re-stamps only lots that LACK an id, so the new row inherits the edited
  // tobacco's `uid` — the cross-device merge identity, which `resolveMergeMatch`
  // matches on FIRST — and duplicates its lot ids GLOBALLY, which is what the
  // trash purge and the 30-day sweep filter on. Three invariants fire
  // (`tobacco-uid-unique`, `lot-id-unique-global`, `lot-uid-unique`).
  //
  // The asymmetry INSIDE this one handler is what identifies it as an
  // oversight rather than a decision: the wishlist form is an overlay and
  // resets at every exit, the three view-based forms never did.
  const openAddTobacco = () => {
    if (BT && setForm) setForm(Object.assign({}, BT));
    if (setEditId) setEditId(null);
    nav && nav("addT");
  };

  // The wishlist's two doors, for the reason the three other lists
  // already have ONE shared opener each: this view had FOUR inline copies of
  // the open-the-overlay sequence — the "+", the empty-state CTA, and the edit
  // handler once per list mode (grouped and flat) — and they had already begun
  // to drift (one wrote `window.scrollY`, the other three `window.scrollY || 0`).
  // Nothing was wrong yet, which is exactly when this is worth doing: the rule
  // "the two doors cannot drift" is written down for tobaccos, pipes and
  // accessories, and the wishlist is the one that never got it.
  //
  // BLANKING is the load-bearing half of the add door. A form left any way
  // other than `cancel()` keeps its working copy, so without the `BW` reset the
  // "new wish" overlay opens over the previously-edited one — and `addWish`
  // would inherit its `uid`, the cross-device merge identity.
  const openAddWish = () => {
    if (!BW || typeof setWishForm !== "function"
        || typeof setEditWishId !== "function"
        || typeof setShowWishForm !== "function") return;
    // Le formulaire d'envie est un CALQUE, pas une vue : `nav()` ne s'exécute
    // jamais pour lui, donc c'est ici qu'une nouvelle session de formulaire
    // s'ouvre. Sans cela, deux « nouvelle envie » successives restent
    // indistinguables pour la garde de l'IA — le trou exact que
    // `utils/formSession.ts` ferme ailleurs.
    bumpFormSession();
    setWishForm(Object.assign({}, BW));
    setEditWishId(null);
    // Snapshot scroll before opening the overlay: it is NOT a view change,
    // so `nav()` never fires and useWishStore reads this back on return.
    if (scrollSaveRef) scrollSaveRef.current["wish"] = window.scrollY || 0;
    setShowWishForm(true);
  };

  const openEditWish = (w: WishlistItem) => {
    if (!BW || typeof setWishForm !== "function"
        || typeof setEditWishId !== "function"
        || typeof setShowWishForm !== "function") return;
    // Même raison qu'à l'ouvreur d'ajout : le calque ne passe pas par `nav()`.
    // L'`id` suffirait ici, mais les deux portes doivent se comporter
    // pareil — c'est la règle « les deux portes ne peuvent pas diverger »
    // écrite quelques lignes plus haut pour ce même formulaire.
    bumpFormSession();
    setWishForm(Object.assign({}, BW, w));
    // Never dropped: without the id, `updateWish`'s .map() matches
    // nothing at save time and the edit is silently lost.
    setEditWishId(w.id);
    if (scrollSaveRef) scrollSaveRef.current["wish"] = window.scrollY || 0;
    setShowWishForm(true);
  };

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="leaf" ariaLabel={t ? t("nav_tobaccos") : "Tabacs"} color={wishVisible ? C.oxbloodHi : C.brass} />}
          title={wishVisible ? (t ? t("ttl_wanted") : "À chasser") : (t ? t("ttl_catalogue") : "Catalogue")}
          onTitleClick={wishVisible ? undefined : () => nav && nav("catalog")}
          titleAriaLabel={t ? t("catalog_open_aria") : "Parcourir le catalogue"}
          trailing={<>
            <CuratorTrashIndicator />
            {shopCount > 0 && (
              <IconBtn icon="cart" color={C.sage} onClick={() => setShoppingOpen && setShoppingOpen(true)} ariaLabel={t ? t("shopping_title") : "Liste de courses"} />
            )}
            <IconBtn icon="book" onClick={() => nav && nav("catalog")} ariaLabel={t ? t("catalog_open_aria") : "Parcourir le catalogue"} />
            <IconBtn icon="search" onClick={() => setSearchOpen && setSearchOpen(true)} ariaLabel={t ? t("btn_search") : "Rechercher"} />
            <IconBtn
              icon="plus"
              onClick={() => {
                if (wishVisible) openAddWish();
                else openAddTobacco();
              }}
              bg={wishVisible ? C.oxbloodHi : C.brass}
              color={C.bg} border={false}
              glow={wishVisible ? C.oxbloodHi : C.brass}
              ariaLabel={t ? t("btn_add") : "Ajouter"} style={{ borderRadius: 10 }}
            />
          </>}
        />

        <PageTitle>
          {wishVisible ? (
            <>{t ? t("wishlist_title_prefix") : "La"} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{t ? t("wishlist_title_word") : "wishlist"}</span></>
          ) : (
            <>{t ? t("tobaccos_title_prefix") : "Les"} <span style={{ fontStyle: "italic", color: C.title }}>{t ? t("tobaccos_title_word") : "tabacs"}</span></>
          )}
        </PageTitle>

        {/* Active filter chips (status / cat / cut / brand / rating / aromas) */}
        {(statusPill || catFilter || cutFilter || brandFilter || tagFilter || (ratingFilter || 0) > 0 || aromaFilter.length > 0) && (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Lbl color={C.brassHi}>{t ? t("filter_lbl") : "🔍 Filtre: "}</Lbl>
            {statusPill && (
              <ActiveFilterPill label={statusPill.label} accent={statusPill.color || C.brassHi} accentBase={statusPill.color || C.brass}
                onClear={() => setStatusFilter && setStatusFilter("active")} />
            )}
            {aromaFilter.map((a: string) => (
              <ActiveFilterPill key={a} label={t ? t(aromaLabelKey(a)) : a} accent={C.sageHi} accentBase={C.sage}
                onClear={() => setAromaFilter && setAromaFilter(aromaFilter.filter((x: string) => x !== a))} />
            ))}
            {catFilter && (
              <ActiveFilterPill label={xl ? xl(catFilter, CATS_EN) : catFilter}
                onClear={() => setCatFilter && setCatFilter("")} />
            )}
            {cutFilter && (
              <ActiveFilterPill label={xl ? xl(cutFilter, CUTS_EN) : cutFilter}
                onClear={() => setCutFilter && setCutFilter("")} />
            )}
            {brandFilter && (
              <ActiveFilterPill label={brandFilter}
                onClear={() => setBrandFilter && setBrandFilter("")} />
            )}
            {tagFilter && (
              <ActiveFilterPill label={"# " + tagFilter} accent={C.steelHi} accentBase={C.steel}
                onClear={() => setTagFilter && setTagFilter("")} />
            )}
            {(ratingFilter || 0) > 0 && (
              <ActiveFilterPill label={"★" + ratingFilter}
                onClear={() => setRatingFilter && setRatingFilter(0)} />
            )}
            <button onClick={() => {
              setCatFilter && setCatFilter("");
              setCutFilter && setCutFilter("");
              setBrandFilter && setBrandFilter("");
              setTagFilter && setTagFilter("");
              setRatingFilter && setRatingFilter(0);
              setAromaFilter && setAromaFilter([]);
              if (statusPill) setStatusFilter && setStatusFilter("active");
            }} style={{
              background: "transparent", border: "none", color: C.tx3,
              cursor: "pointer", padding: "2px 4px", fontSize: fs(14.5),
              textDecoration: "underline", fontFamily: F.body,
            }}>{t ? t("filter_clr") : "✕ Effacer"}</button>
          </div>
        )}

        {/* Sub-header: stats */}
        <div style={{ padding: "0 12px 12px", marginTop: -8, fontSize: fs(15), color: C.tx2 }}>
          {wishVisible ? (
            <>
              <span style={{ fontFamily: F.mono, color: C.oxbloodHi }}>
                <AnimNum value={wishShown.length} delay={150} />
              </span>{wishShown.length !== wishlist.length ? <> / {wishlist.length}</> : null} {t ? t("lbl_wishes") : "envies"} ·{" "}
              <span style={{ fontFamily: F.mono, color: C.brassHi }}>
                <AnimNum value={wishShown.filter(w => w.priority === "high").length} delay={250} />
              </span> {t ? t("lbl_at_high_priority") : "en haute priorité"}
            </>
          ) : (
            <>
              <span style={{ fontFamily: F.mono, color: C.brassHi }}>
                <AnimNum value={visible.length} delay={150} />
              </span> / {tobaccos.length} {t ? t("lbl_references") : "références"}
            </>
          )}
        </div>

        {/* Sort + view toggles */}
        {!wishVisible && (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{
              // `minWidth: 0` — a flex item defaults to
              // `min-width: auto`, so this wrapper refused to shrink below its
              // content and the row overflowed once the toggles beside it
              // stopped shrinking. MEASURED: German at the L text size, 360 and
              // 390 px, before/after — the overflow was introduced by making
              // the toggles a fixed 44 and is removed by letting this yield.
              flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
              minHeight: 44, padding: "0 12px",
              background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
            }}>
              <Lbl color={C.tx2} size={9.5}>{t ? t("lbl_sort") : "Trier"}</Lbl>
              <select
                value={sortBy || "name"}
                aria-label={t ? t("lbl_sort_by") : "Trier par"}
                onChange={(e) => setSortBy && setSortBy(e.target.value)}
                onFocus={sortRing.onFocus}
                onBlur={sortRing.onBlur}
                style={{
                  flex: 1, minWidth: 0,
                  // Same fix as the filter selects — stretch to the
                  // wrapper so the whole visible control is live, not its
                  // middle third.
                  alignSelf: "stretch",
                  background: "transparent", color: C.ivory,
                  border: "none", outline: "none",
                  fontFamily: F.body, fontSize: fs(15),
                  appearance: "none", borderRadius: 4,
                  transition: "box-shadow 200ms",
                  ...(sortRing.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
                }}>
                {sortOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <Ico name="chevron" size={12} sw={1.7}
                style={{ transform: "rotate(90deg)", color: C.tx2 } as any} />
            </div>
            {/* The folded secondary filters (type / cut / rating
                dropdowns + the tag chips, hidden by default) are opened
                from HERE now, not from a labelled "Plus de filtres" button on
                its own row — that button cost a row on the busiest page, and
                the pipes + accessories lists already used an icon in this row.
                Same icon, same place, on all three. The `on` state replaces the
                dot: it stays lit while a hidden filter is applied, so a
                narrowed list can never look unfiltered. */}
            {(filterDropdownOptions.cats.length > 0 || filterDropdownOptions.cuts.length > 0
              || (!wishVisible && tagList.length > 0)) && (
              <ToggleBtn
                on={advFiltersOpen || !!catFilter || !!cutFilter || !!ratingFilter
                  || (!wishVisible && !!tagFilter)}
                icon="filter" accent={C.brassHi}
                onClick={() => setAdvFiltersOpen((v) => !v)}
                ariaLabel={t ? t("filters_more") : "Plus de filtres"} />
            )}
            <ToggleBtn
              on={!!tobGrouped} icon="more"
              onClick={() => {
                if (tobGrouped) setTobGrouped && setTobGrouped(false);
                else {
                  setTobGrouped && setTobGrouped(true);
                  setCollapsedTobGroups && setCollapsedTobGroups({});
                }
              }}
              ariaLabel={t ? t("aria_group_by_brand") : "Grouper par marque"} />
            <ToggleBtn
              on={!!expandCards} icon="sliders"
              onClick={() => setExpandCards && setExpandCards((v: any) => !v)}
              ariaLabel={t ? t("aria_expanded_view") : "Cartes détaillées"} />
            {/* Aroma filter — opens the aroma wheel as a filter. */}
            <ToggleBtn
              on={aromaFilter.length > 0} icon="diamond" accent={C.sage}
              onClick={() => { setAromaDraft(aromaFilter); setAromaModalOpen(true); }}
              ariaLabel={t ? t("aroma_filter_title") : "Filtrer par arômes"} />
          </div>
        )}

        {wishVisible && (
          <div style={{ padding: "0 12px 10px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              // `minWidth: 0` — a flex item defaults to
              // `min-width: auto`, so this wrapper refused to shrink below its
              // content and the row overflowed once the toggles beside it
              // stopped shrinking. MEASURED: German at the L text size, 360 and
              // 390 px, before/after — the overflow was introduced by making
              // the toggles a fixed 44 and is removed by letting this yield.
              flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
              minHeight: 44, padding: "0 12px",
              background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
            }}>
              <Lbl color={C.tx2} size={9.5}>{t ? t("lbl_sort") : "Trier"}</Lbl>
              <select
                value={wishSort}
                aria-label={t ? t("lbl_sort_by") : "Trier par"}
                onChange={(e) => setWishSort(e.target.value === "brand" ? "brand" : "name")}
                onFocus={wishSortRing.onFocus}
                onBlur={wishSortRing.onBlur}
                style={{
                  flex: 1, minWidth: 0,
                  // Same fix as the filter selects — stretch to the
                  // wrapper so the whole visible control is live, not its
                  // middle third.
                  alignSelf: "stretch",
                  background: "transparent", color: C.ivory,
                  border: "none", outline: "none",
                  fontFamily: F.body, fontSize: fs(15),
                  appearance: "none", borderRadius: 4,
                  transition: "box-shadow 200ms",
                  ...(wishSortRing.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
                }}>
                <option value="name">{t ? t("f_name") : "Nom"}</option>
                <option value="brand">{t ? t("f_brand") : "Marque"}</option>
              </select>
              <Ico name="chevron" size={12} sw={1.7}
                style={{ transform: "rotate(90deg)", color: C.tx2 } as any} />
            </div>
            {/* The wishlist has its own controls row, so the filter
                disclosure has to be added HERE too — the tests caught that
                putting it only in the tobacco row made the type / cut
                dropdowns unreachable in wish mode. */}
            {(filterDropdownOptions.cats.length > 0 || filterDropdownOptions.cuts.length > 0) && (
              <ToggleBtn
                on={advFiltersOpen || !!catFilter || !!cutFilter || !!ratingFilter}
                icon="filter" accent={C.brassHi}
                onClick={() => setAdvFiltersOpen((v) => !v)}
                ariaLabel={t ? t("filters_more") : "Plus de filtres"} />
            )}
            {setWishGrouped && (
              <ToggleBtn
                on={!!wishGrouped} icon="more"
                onClick={() => setWishGrouped((v: any) => !v)}
                ariaLabel={t ? t("aria_group_by_brand") : "Grouper par marque"} />
            )}
          </div>
        )}

        {/* Back to ONE horizontally-scrollable chip row (an earlier
            "Statut" / "Maturité" split added two labels + a second
            row and ate too much vertical space before the first card — user
            feedback). Status chips first, then the maturity chips, all in the
            same strip; the auto-hide keeps only the relevant ones. Deep-links,
            the active pill and statusFilter are untouched. */}
        {(() => {
          const shown = chips.filter(f => {
            // Auto-hide the low-signal chips at count 0 (unless selected).
            if ((f.id === "approaching" || f.id === "overaged" || f.id === "smokesoon" || f.id === "disposed" || f.id === "norebuy"
                 || f.id === "lowstock" || f.id === "young" || f.id === "optimal" || f.id === "used_up" || f.id === "nolot")
                && f.n === 0 && statusFilter !== f.id) {
              return false;
            }
            return true;
          });
          return (
            <ScrollableChipRow resetScrollSignal={chipScrollReset}>
              {shown.map(f => (
                <FilterChip key={f.id}
                  f={f}
                  on={statusFilter === f.id}
                  onPick={() => setStatusFilter && setStatusFilter(f.id)} />
              ))}
            </ScrollableChipRow>
          );
        })()}



        {/* Tabac-list type/cut dropdowns. Mirror the
            JournalView pattern — options derived from the
            user's inventory (not the full CATS / CUTS enums), AND
            semantics, hidden in wishlist mode and when the inventory
            is empty. The active-pill row above already lets the user
            remove either filter; the dropdown adds the missing
            entry-point UI (catFilter used to be reachable only via a
            Stats/Home click-thru; cutFilter is brand new).
            Gated behind the "Plus de filtres" toggle. */}
        {advFiltersOpen
          && (wishVisible ? wishlist.length > 0 : tobaccos.length > 0)
          && (filterDropdownOptions.cats.length > 0 || filterDropdownOptions.cuts.length > 0)
          && (() => {
          const selStyle = (ring: ReturnType<typeof useFocusRing>) => ({
            flex: 1, minWidth: 0,
            // Stretch to the wrapper's full height — see the
            // wrapper below. The control looked 36 px tall and only its middle
            // 18 px opened the list.
            alignSelf: "stretch" as const,
            background: "transparent", color: C.ivory,
            border: "none", outline: "none",
            fontFamily: F.body, fontSize: fs(14.5), appearance: "none" as const,
            borderRadius: 4, transition: "box-shadow 200ms",
            ...(ring.focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}` } : {}),
          });
          const wrapStyle = {
            flex: 1, minWidth: 0,
            display: "flex", alignItems: "center", gap: 6,
            // 44 is this project's own target-size invariant, and
            // the vertical padding moved onto the select so the WHOLE box is
            // live rather than just its middle third.
            minHeight: 44,
            padding: "0 10px",
            background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
          };
          return (
            <div style={{ padding: "10px 16px 14px", display: "flex", gap: 8 }}>
              <div style={wrapStyle}>
                <Ico name="leaf" size={14} color={C.brassHi} sw={1.5} />
                <select
                  value={catFilter || ""}
                  aria-label={t ? t("aria_filter_by_type") : "Filtrer par type"}
                  onChange={(e) => setCatFilter && setCatFilter(e.target.value)}
                  onFocus={catRing.onFocus}
                  onBlur={catRing.onBlur}
                  style={selStyle(catRing)}>
                  <option value="">{t ? t("f_all_types") : "Type"}</option>
                  {filterDropdownOptions.cats.map(c => (
                    <option key={c} value={c}>{xl ? xl(c, CATS_EN) : c}</option>
                  ))}
                </select>
              </div>
              <div style={wrapStyle}>
                <Ico name="more" size={14} color={C.amber} sw={1.5} />
                <select
                  value={cutFilter || ""}
                  aria-label={t ? t("aria_filter_by_cut") : "Filtrer par coupe"}
                  onChange={(e) => setCutFilter && setCutFilter(e.target.value)}
                  onFocus={cutRing.onFocus}
                  onBlur={cutRing.onBlur}
                  style={selStyle(cutRing)}>
                  <option value="">{t ? t("f_all_cuts") : "Toutes coupes"}</option>
                  {filterDropdownOptions.cuts.map(c => (
                    <option key={c} value={c}>{xl ? xl(c, CUTS_EN) : c}</option>
                  ))}
                </select>
              </div>
              {/* No rating select in wish mode — WishlistItem
                  has no personal rating field, only force/roomNote/taste. */}
              {!wishVisible && (
                <div style={{ ...wrapStyle, flex: "0 0 96px" }}>
                  <span style={{ color: C.brassHi, fontSize: fs(14.5), lineHeight: 1 }}>★</span>
                  <select
                    value={ratingFilter || 0}
                    aria-label={t ? t("aria_filter_by_rating") : "Filtrer par note"}
                    onChange={(e) => setRatingFilter && setRatingFilter(parseInt(e.target.value, 10) || 0)}
                    onFocus={ratingRing.onFocus}
                    onBlur={ratingRing.onBlur}
                    style={selStyle(ratingRing)}>
                    <option value={0}>{t ? t("f_any") : "Note"}</option>
                    {[5, 4, 3, 2, 1].map(n => (
                      <option key={n} value={n}>{"★".repeat(n)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })()}

        {/* User tag / collection filter — a chip row of the tags
            present in the inventory. Single-select (tap again to clear). Only
            in tobacco mode and only when tags exist.
            Gated behind the "Plus de filtres" toggle. */}
        {advFiltersOpen && !wishVisible && tagList.length > 0 && (
          <div style={{ padding: "0 12px 12px" }}>
            <ScrollableChipRow>
              {tagList.map((tg) => (
                <FilterChipSimple key={tg} label={"# " + tg}
                  on={String(tagFilter || "").toLowerCase() === String(tg).toLowerCase()}
                  onClick={() => setTagFilter && setTagFilter(String(tagFilter || "").toLowerCase() === String(tg).toLowerCase() ? "" : tg)}
                  accent={C.steelHi} />
              ))}
            </ScrollableChipRow>
          </div>
        )}

        {/* List */}
        <div style={{ padding: "0 12px" }}>
          {noHits ? (
            <EmptyState
              icon={wishVisible ? "heart" : "leaf"}
              accent={wishVisible ? C.oxbloodHi : C.brass}
              label={invFiltered
                ? (t ? t("list_no_match") : "Aucun résultat pour ces filtres")
                : wishVisible
                  ? (t ? t("no_wishes") : "Aucune envie")
                  : (t ? t("no_tobacco") : "Aucun tabac")}
              actions={invFiltered
                ? [{ label: t ? t("btn_reset_filters") : "Réinitialiser les filtres", onClick: resetInvFilters }]
                : [{
                    // The "+" is an unlabelled icon in the top bar, far from
                    // the sentence saying there is nothing here. On a first-run
                    // screen that is the ONLY thing worth tapping, so it says so.
                    label: wishVisible
                      ? (t ? t("btn_add_wish") : "Ajouter une envie")
                      : (t ? t("btn_add_tobacco") : "Ajouter un tabac"),
                    onClick: () => {
                      if (wishVisible) openAddWish();
                      else openAddTobacco();
                    },
                  }]} />
          ) : wishVisible ? (
            wishGrouped
              ? (() => {
                  // Object.create(null) — `w.brand` is user-controlled.
                  const g: Record<string, WishlistItem[]> = Object.create(null);
                  wishShown.forEach(w => {
                    // Audit: key on the STABLE brand ("" for
                    // brand-less), not the localized "Sans marque". The wish
                    // form makes brand optional, and addWish expands the group
                    // via `source.brand || ""`; keying on the localized label
                    // meant a brand-less wish landed in a group whose collapse
                    // key never matched, so it stayed hidden and read as a
                    // failed save. The localized label is applied at display.
                    const k = w.brand || "";
                    (g[k] = g[k] || []).push(w);
                  });
                  return Object.keys(g).sort((a, b) => String(a).localeCompare(String(b))).map(name => {
                    const items = g[name] || [];
                    const collapsed = (collapsedWishGroups || {})[name] !== false;
                    const groupLabel = name || (t ? t("lbl_no_brand") : "Sans marque");
                    return (
                      <div key={name}>
                        <PressCard onClick={() => toggleWishGroup && toggleWishGroup(name)}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "10px 12px", marginBottom: 6, borderRadius: 8,
                            background: C.cardHi, border: `1px solid ${C.rule}`,
                          }}>
                          <Lbl color={C.oxbloodHi} size={12}>{groupLabel}</Lbl>
                          <span style={{ fontFamily: F.mono, fontSize: fs(14.5), color: C.tx3 }}>
                            {items.length}
                          </span>
                          <span style={{
                            marginLeft: "auto",
                            transition: "transform 200ms",
                            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                            color: C.tx3,
                          }}>
                            <Ico name="chevron" size={14} sw={1.7} />
                          </span>
                        </PressCard>
                        {!collapsed && items.slice(0, wishGroupRows.shownFor(name)).map((w, i) => (
                          <WishCard key={w.id} w={w} idx={i}
                            focused={String(w.id) === String(focusedWishId)}
                            onAcquire={() => wishToInv && wishToInv(w)}
                            // `openEditWish` writes `scrollSaveRef.current`, and this
                            // branch builds its rows inside an IIFE that runs during
                            // render — so the rule traces the ref write to render time.
                            // It is a handler prop: nothing calls it until a tap. The
                            // flat branch below is the identical call and is NOT
                            // flagged, which is what identifies this as the IIFE
                            // rather than the helper.
                            // eslint-disable-next-line react-hooks/refs
                            onEdit={() => openEditWish(w)}
                            onDelete={() => { delWish && delWish(w.id); }} />
                        ))}
                        {!collapsed && (
                          <ProgressiveMore hidden={items.length - wishGroupRows.shownFor(name)}
                            onMore={() => wishGroupRows.revealMoreIn(name)} t={t} accent={C.oxbloodHi} />
                        )}
                      </div>
                    );
                  });
                })()
              : flatWish.visible.map((w, i) => (
                  <WishCard key={w.id} w={w} idx={i}
                    focused={String(w.id) === String(focusedWishId)}
                    onAcquire={() => wishToInv && wishToInv(w)}
                    onEdit={() => openEditWish(w)}
                    onDelete={() => { delWish && delWish(w.id); }} />
                ))
          ) : null}
          {wishVisible && !wishGrouped && (
            <ProgressiveMore hidden={flatWish.hidden} onMore={flatWish.revealMore}
              sentinelRef={flatWish.sentinelRef} t={t} accent={C.oxbloodHi} />
          )}
          {!wishVisible && (tobGrouped ? (
            <GroupedTobaccoList
              tobaccos={visible}
              t={t}
              expandCards={!!expandCards}
              collapsedTobGroups={collapsedTobGroups || {}}
              toggleTobGroup={toggleTobGroup}
              sortBy={sortBy || "name"}
              onOpen={(tob) => setDetail && setDetail(tob)}
            />
          ) : (
            <>
              {flatTob.visible.map((tob, i) => (
                <TobaccoCard key={tob.id} t={tob} idx={i}
                  expanded={!!expandCards}
                  onOpen={() => setDetail && setDetail(tob)} />
              ))}
              <ProgressiveMore hidden={flatTob.hidden} onMore={flatTob.revealMore}
                sentinelRef={flatTob.sentinelRef} t={t} accent={C.amber} />
            </>
          ))}
        </div>
      </div>

      {/* Aroma filter sheet — pick aromas on the wheel, apply to
          the tobacco list (AND semantics). The list matches a tobacco when
          its aggregated session aromas include every selected aroma. */}
      <Modal open={aromaModalOpen} onClose={() => setAromaModalOpen(false)}
        ariaLabel={t ? t("aroma_filter_title") : "Filtrer par arômes"}>
        <ModalHeader title={t ? t("aroma_filter_title") : "Filtrer par arômes"}
          onClose={() => setAromaModalOpen(false)} />
        <div style={{ padding: "0 12px 18px" }}>
          <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 12, lineHeight: 1.45 }}>
            {t ? t("aroma_filter_hint") : "Affiche les tabacs dont vos séances portent tous les arômes choisis."}
          </div>
          <AromaPicker value={aromaDraft} onChange={setAromaDraft} accent={C.sage} />
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <ModalAction variant="secondary"
              onClick={() => setAromaDraft([])}>
              {t ? t("btn_clear") : "Effacer"}
            </ModalAction>
            <ModalAction variant="primary"
              onClick={() => { setAromaFilter && setAromaFilter(aromaDraft); setAromaModalOpen(false); }}>
              {(t ? t("aroma_filter_apply") : "Appliquer") + (aromaDraft.length ? ` (${aromaDraft.length})` : "")}
            </ModalAction>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// The local EmptyState moved to primitives.tsx — it existed here in
// one copy and verbatim in three other views, and none of the four offered a
// way forward. See that file for the reasoning.

// ─────────────────────────────────────────────────────────────
function TobaccoCard({
  t: tob, idx, expanded, onOpen,
}: { t: Tobacco; idx: number; expanded: boolean; onOpen: () => void }) {
  const { xl, statusFilter } = useAppCtx();
  // Shared index rotation (brand label + top bar match) — see CARD_ACCENTS.
  const color = CARD_ACCENTS[idx % CARD_ACCENTS.length]!;
  // When the list is filtered to a LOT-LEVEL slice — En pot,
  // En cave, or one of the maturity bands (Jeune / Optimale / Pic proche /
  // Trop âgé) — the weight is scoped to the lots the user filtered ON.
  // Unfiltered it stays the full active total, and the fiche always shows
  // everything. The POT / CAVE count badges to its right are deliberately NOT
  // scoped: they're what explains why the number is smaller than the stock.
  const wScope = scopeFromStatusFilter(statusFilter);
  const totalW = scopedHeldWeight(tob, wScope);
  // Every figure on the card describes the lots IN SCOPE. Filtered
  // to "En pot", a card was still announcing "4 CAVE", a total lot count and a
  // maturity distribution — all of it about lots the user had filtered out
  // (and maturity is cellar-only, so those chips could not even describe the
  // jar lot they appeared to qualify).
  const eamCard = effectiveAgingMax(tob);
  // scope-ok: this IS the scope route — every figure below derives from it.
  const scopedLots = (tob.lots || []).filter((l: any) => lotInScope(l, wScope, eamCard));
  const nJar = scopedLots.filter(l => l.status === "jar").length;
  const nCellar = scopedLots.filter(l => l.status === "cellar").length;
  // A disposed lot is always status:"finished", so the FINI pill covers both
  // "terminé" (fully smoked) and "éliminé" (thrown / given away) — the user
  // is fine with one shared FINI badge (a separate ÉLIMINÉ pill was tried
  // and reverted; the auto "à ne pas reprendre" on disposal
  // stays — see updateLotInTobacco).
  // scope-ok: unscoped ON PURPOSE — its only consumer (the FINI pill) renders
  // exclusively when `!wScope`, i.e. when there is no scope to honour.
  const nFinished = (tob.lots || []).filter(l => l.status === "finished").length;
  const e = useEnter(100 + idx * 50, { duration: 420 });
  const { imgLocal, weightUnit = "g", t, lang, ageLabel } = useAppCtx();
  const photoSrc = tob.imageUrl ? ((imgLocal && imgLocal[tob.imageUrl]) || tob.imageUrl) : null;
  // Full maturity distribution ON THE CARD — one chip per present
  // band (young → optimal → peak → tooOld), each WITH its lot count. Same
  // shared classifier as the fiche/modal (effectiveAgingMax → family default),
  // so the card shows the complete, transparent breakdown of this blend's
  // stock (not just the worst alert). Hidden entirely when no active lot.
  const eam = eamCard;
  const buckets = scopedLots.map((l: any) => lotMaturityBucket(l, eam));
  type Band = "young" | "optimal" | "peak" | "tooOld";
  const MAT_ORDER: Band[] = ["young", "optimal", "peak", "tooOld"];
  const matChips = MAT_ORDER
    .map((b) => ({ bucket: b, count: buckets.filter((x) => x === b).length }))
    .filter((c) => c.count > 0);
  // Unscoped keeps the historical "N lots" (every recorded lot, finished
  // included) — that is what an unfiltered card has always meant.
  // scope-ok: the raw read is the `!wScope` branch only — under a scope the
  // count comes from scopedLots.
  const lotCount = wScope ? scopedLots.length : (tob.lots || []).length;
  // Under the jar filter, how long the OLDEST open jar has been
  // open — the one figure that made the fiche worth opening from that list.
  // Only there: on an unfiltered card it would be noise on every row.
  const openSinceDays = wScope !== "jar" ? null : scopedLots.reduce((mx: number | null, l: any) => {
    if (!l.dateOpened) return mx;
    const d = daysSince(String(l.dateOpened));
    return d != null && (mx == null || d > mx) ? d : mx;
  }, null as number | null);
  const noRebuy = tob.rebuy === false;
  return (
    <PressCard onClick={onOpen} style={{
      background: CARD_BG, border: `1px solid ${C.rule}`,
      borderRadius: 8, marginBottom: 8, padding: 0, overflow: "hidden",
      boxShadow: CARD_SHADOW,
      ...e,
    }}>
      {/* CARD_ACCENTS top bar — the per-card colour signal (restored
          after the recessed-tone pass stripped it too eagerly; the
          card ground stays recessed CARD_BG, only the accent bar returns). */}
      <div style={{ height: 2, background: color, opacity: 0.65 }} />
      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
        {/* Photo column is a fixed 100×110 cream tile, padded
            inside so the photo never touches the cream edge. Even when
            the tin photo has its own black background, the 8 px cream
            padding stays visible as a uniform "polaroid frame". */}
        <div style={{
          width: 100, height: 110, flexShrink: 0,
          background: photoSrc ? "transparent" : `linear-gradient(135deg, ${C.bg2}, ${C.bg3})`,
          // No border either. These two edges were the last of the
          // "polaroid" frame — they read as a sensible photo/text
          // separator only while the photo FILLED the column. Now that it
          // is `contain`, so a wide photo (a churchwarden is ~3:1 against a
          // 100x110 column) occupies a third of the height and the two edges
          // close a mostly-empty box in `C.rule`, a colour distinct from the
          // card. Reported from the app: "il y a un carré et le trait de ce
          // carré est d'une couleur différente".
          // `contain`, and NO ground of its own — reported from the
          // app, and it REVERSES the earlier `cover`. Cover guarantees the column
          // is filled, but it does so by CROPPING: a tall tin (or a long pipe)
          // is cut off and can never be seen whole, which is the one thing a
          // photo on an inventory card exists for. `contain` fits the whole
          // object, and the leftover area is transparent so the CARD shows
          // through — the photo floats instead of sitting in a frame. That is
          // what makes this different from the earlier state, which combined
          // `contain` with a coloured ground and an 8px padding to draw a
          // deliberate "polaroid" frame: the frame is what was
          // wrong, not the fit. The gradient stays for the no-photo placeholder,
          // where there is nothing to show through.
          boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: color,
        }}>
          {photoSrc
            ? <div style={{ width: "100%", height: "100%", background: `${safeBgUrl(photoSrc)} center/contain no-repeat` }} />
            : <Ico name="leaf" size={36} sw={1.2} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 13px" }}>
          {/* Layout restructure — the right column (weight +
              status chips) used to sit beside the name and squeezed
              longer canonical labels from the catalog sync.
              Now everything stacks vertically: brand → name (FULL
              width, 18 px italic Newsreader) → cat·cut → aging chips →
              footer row with weight + chips + stars/lots. The name
              gets a complete line on its own, no truncation pressure. */}
          <Lbl color={color}>{tob.brand || "—"}</Lbl>
          <div style={{
            fontFamily: F.display, fontSize: fs(20), color: C.ivory,
            lineHeight: 1.2, marginTop: 3, letterSpacing: -0.3,
            fontStyle: "italic",
          }}>{tob.name || "—"}</div>
          <div style={{ marginTop: 6, fontSize: fs(15), color: C.tx2 }}>
            {[xl ? xl(tob.category, CATS_EN) : tob.category, xl ? xl(tob.cut, CUTS_EN) : tob.cut].filter(Boolean).join(" · ")}
          </div>
          {matChips.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {matChips.map((c) => (
                <MaturityChip key={c.bucket} bucket={c.bucket} count={c.count} alwaysCount size="md" t={t} />
              ))}
            </div>
          )}
          {/* Footer row: weight (large, left) + status chips (right). */}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: F.display, fontSize: fs(24), color: C.ivory, lineHeight: 1, fontStyle: "italic" }}>
              {fmtNum(totalW, lang)}<span style={{ fontSize: fs(15), color: C.tx2, fontStyle: "normal" }}>{weightUnit}</span>
              {wScope && (
                // Name the scope, so a smaller number can't read as wrong data.
                // Shared resolver — the card, the fiche chip and the fiche hero
                // label all read from scopeLabelKey, so they cannot drift.
                <span data-scope={wScope} style={{
                  marginLeft: 6, fontFamily: F.mono, fontSize: fs(11), fontStyle: "normal",
                  letterSpacing: 0.6, color: C.tx3,
                }}>
                  {t(scopeLabelKey(wScope))}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {/* The WORD used to carry `opacity: 0.75` to sit
                  below its count. That cost ~40% of the contrast for pure
                  de-emphasis: in light mode POT measured 3.68:1 and CAVE
                  3.23:1 at 11px, both under AA, on the app's busiest screen
                  (full opacity: 6.44:1 / 5.27:1). The count-vs-word hierarchy
                  survives without it — one is a numeral, the other letter-
                  spaced uppercase mono. Opacity is never the right tool for
                  de-emphasising TEXT; pick a dimmer token instead, so the
                  ratio stays measurable. The now-styleless inner <span> STAYS:
                  InventoryListView.test.tsx locates the badge by matching a
                  span whose ENTIRE text is "POT" (the outer one reads "3 POT"),
                  and that locator anchors the ✕-placement invariant. */}
              {nJar > 0 && (
                <span title={nJar + " " + plural(nJar, t ? t("lbl_jar_lower") : "pot", t ? t("lbl_jar_lower_p") : "pots", lang)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px",
                    background: alpha(C.brass, "22"), color: C.brassHi,
                    fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2, textTransform: "uppercase",
                    borderRadius: 3, fontWeight: 700,
                  }}>{nJar} <span>{t ? t("lbl_jar_upper") : "POT"}</span></span>
              )}
              {nCellar > 0 && (
                <span title={nCellar + " " + plural(nCellar, t ? t("lbl_cellar_lower") : "cave", t ? t("lbl_cellar_lower_p") : "caves", lang)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px",
                    background: alpha(C.sage, "22"), color: C.sage,
                    fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2, textTransform: "uppercase",
                    borderRadius: 3, fontWeight: 700,
                  }}>{nCellar} <span>{t ? t("lbl_cellar_upper") : "CAVE"}</span></span>
              )}
              {/* Explicitly never under a scope. It could not fire
                  anyway (a scoped card always has an in-scope jar or cellar
                  lot), but relying on that emergent property is how the other
                  leaks survived — state the rule instead. */}
              {!wScope && nFinished > 0 && nJar === 0 && nCellar === 0 && (
                // The FINI / DONE pill only appears when
                // there are no remaining active lots. As long as at
                // least one jar or cellar lot exists, the list card
                // focuses on what's in stock — the historical count
                // of finished lots belongs to the detail view. Covers
                // disposed lots too (they're status:"finished").
                <span title={t ? t("aria_all_lots_finished") : "Tous les lots terminés"}
                  style={{
                    display: "inline-flex", alignItems: "center", padding: "2px 6px",
                    background: alpha(C.tx3, "22"), color: C.tx2,
                    fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2, textTransform: "uppercase",
                    borderRadius: 3, fontWeight: 700,
                  }}>{t ? t("lbl_done_upper") : "FINI"}</span>
              )}
              {noRebuy && (
                <span title={t ? t("rebuy_no") : "Pas reprendre"}
                  aria-label={t ? t("rebuy_no") : "Pas reprendre"}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: alpha(C.oxbloodHi, "22"), color: C.oxbloodHi,
                    fontSize: fs(14.5), lineHeight: 1, borderRadius: 3, fontWeight: 700,
                  }}>✕</span>
              )}
            </div>
          </div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 4 }}>
            <Stars n={tob.rating || 0} size={11} />
            <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
            <span style={{ fontFamily: F.mono, fontSize: fs(12), color: C.tx3, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
              {lotCount} {plural(lotCount, t ? t("unit_lot") : "lot", t ? t("unit_lots") : "lots", lang)}
            </span>
            {openSinceDays != null && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
                <span data-open-since style={{ fontFamily: F.mono, fontSize: fs(12), color: C.brassHi, letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                  {t ? t("lot_open_since") : "Ouvert"} · {fmtLotAge(openSinceDays, t)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      {expanded && (() => {
        const hasProfile = (tob.force || 0) > 0 || (tob.roomNote || 0) > 0 || (tob.taste || 0) > 0;
        // The IN-SCOPE oldest lot, through the shared helper.
        const oldestDays = scopedOldestAgeDays(tob, wScope, eamCard);
        const hasAge = oldestDays > 0 && ageLabel;
        const hasAgingMax = !!tob.agingMax;
        if (!tob.tastingNotes && !tob.description && !tob.blend && !hasProfile && !hasAge && !hasAgingMax) return null;
        return (
          <div style={{
            padding: "10px 14px 14px",
            borderTop: `1px dotted ${C.rule}`,
            background: C.bg,
          }}>
            {hasProfile && (
              <div style={{
                display: "flex", gap: 14, flexWrap: "wrap",
                fontFamily: F.mono, fontSize: fs(13), color: C.tx2, letterSpacing: 0.4,
                marginBottom: tob.tastingNotes || tob.description || tob.blend || hasAge ? 8 : 0,
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: C.oxbloodHi }}>{t ? t("abbr_force") : "F"}</span><Stars n={tob.force || 0} size={9} />
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: C.sageHi }}>{t ? t("abbr_room_note") : "R"}</span><Stars n={tob.roomNote || 0} size={9} />
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: C.brassHi }}>{t ? t("abbr_taste") : "G"}</span><Stars n={tob.taste || 0} size={9} />
                </span>
              </div>
            )}
            {hasAge && (
              <div style={{
                fontFamily: F.mono, fontSize: fs(13), color: C.sageHi, letterSpacing: 0.4,
                marginBottom: tob.tastingNotes || tob.description || tob.blend ? 8 : 0,
              }}>🕰 {ageLabel!(oldestDays)}</div>
            )}
            {tob.tastingNotes && (
              <div style={{
                fontSize: fs(15), color: C.cream,
                fontStyle: "italic", lineHeight: 1.55, fontFamily: F.display,
              }}>« {tob.tastingNotes} »</div>
            )}
            {tob.description && (
              <div style={{
                marginTop: tob.tastingNotes ? 8 : 0,
                fontSize: fs(15), color: C.tx, lineHeight: 1.5,
                fontFamily: F.body,
              }}>{tob.description}</div>
            )}
            {tob.blend && (
              <div style={{
                marginTop: (tob.tastingNotes || tob.description) ? 8 : 0,
                fontSize: fs(15), color: C.tx2, lineHeight: 1.5,
                fontFamily: F.body,
              }}>
                <span style={{ color: C.tx3 }}>{t ? t("lbl_blend_label") : "Composition : "}</span>
                {tob.blend}
              </div>
            )}
            {hasAgingMax && (
              <div style={{
                marginTop: (tob.tastingNotes || tob.description || tob.blend) ? 8 : 0,
                fontFamily: F.body, fontSize: fs(15), color: C.tx2, lineHeight: 1.5,
              }}>
                <span style={{ color: C.tx3 }}>{t ? t("lbl_aging_label") : "Vieillissement : "}</span>
                {tob.agingMax}{t ? t("lbl_yrs_with_space") : " ans"}
              </div>
            )}
          </div>
        );
      })()}
    </PressCard>
  );
}

// ─────────────────────────────────────────────────────────────
function GroupedTobaccoList({
  tobaccos, t, expandCards, collapsedTobGroups, toggleTobGroup, sortBy, onOpen,
}: {
  tobaccos: Tobacco[];
  t?: ((k: string) => string) | undefined;
  expandCards: boolean;
  collapsedTobGroups: Record<string, boolean>;
  toggleTobGroup?: (k: string) => void;
  sortBy?: string;
  onOpen: (tob: Tobacco) => void;
}) {
  const noBrandLbl = t ? t("lbl_no_brand") : "Sans marque";
  // The group ordering must rank on the same lot slice the cards
  // inside display (see groupKey below).
  const { statusFilter: groupStatusFilter } = useAppCtx();
  const groups = useMemo(() => {
    // Object.create(null) — `tb.brand` is user-controlled.
    const g: Record<string, Tobacco[]> = Object.create(null);
    tobaccos.forEach(tb => {
      const k = tb.brand || noBrandLbl;
      (g[k] = g[k] || []).push(tb);
    });
    // Group ordering follows the active sort. With brand/name sort we keep
    // alphabetical groups; otherwise we rank groups by the best item value
    // so the user actually sees an effect when switching the sort.
    const keys = Object.keys(g);
    const groupScope = scopeFromStatusFilter(groupStatusFilter);
    const groupKey = (k: string): number => {
      const items = g[k] || [];
      // Ranked on the SAME lots the cards inside show. Before, a
      // brand group filtered to "En pot" was ordered by its cellar weight/age.
      const totalQty = (t: Tobacco) => scopedHeldWeight(t, groupScope);
      if (sortBy === "rating")   return Math.max(0, ...items.map(t => t.rating   || 0));
      if (sortBy === "force")    return Math.max(0, ...items.map(t => t.force    || 0));
      if (sortBy === "roomNote") return Math.max(0, ...items.map(t => t.roomNote || 0));
      if (sortBy === "taste")    return Math.max(0, ...items.map(t => t.taste    || 0));
      if (sortBy === "qty")      return Math.max(0, ...items.map(totalQty));
      if (sortBy === "aging")    return Math.max(0, ...items.map(t => scopedOldestAgeDays(t, groupScope)));
      return 0;
    };
    if (!sortBy || sortBy === "brand" || sortBy === "name") {
      keys.sort((a, b) => String(a).localeCompare(String(b)));
    } else {
      keys.sort((a, b) => groupKey(b) - groupKey(a)
        || String(a).localeCompare(String(b)));
    }
    return keys.map(k => ({ name: k, items: g[k] || [] }));
  }, [tobaccos, noBrandLbl, sortBy]);

  // Une marque dépliée rend tous ses tabacs — voir `useProgressiveGroups`.
  const groupRows = useProgressiveGroups();

  return (
    <>
      {groups.map(({ name, items }) => {
        const collapsed = collapsedTobGroups[name] !== false;
        return (
          <div key={name}>
            <PressCard onClick={() => toggleTobGroup && toggleTobGroup(name)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", marginBottom: 6, borderRadius: 8,
                background: C.cardHi, border: `1px solid ${C.rule}`,
              }}>
              <Lbl color={C.brassHi} size={12}>{name}</Lbl>
              <span style={{ fontFamily: F.mono, fontSize: fs(14.5), color: C.tx3 }}>
                {items.length} {items.length > 1
                  ? (t ? t("lbl_tobaccos_word") : "tabacs")
                  : (t ? t("lbl_tobacco_simple") : "tabac")}
              </span>
              <span style={{
                marginLeft: "auto",
                transition: "transform 200ms",
                transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                color: C.tx3,
              }}>
                <Ico name="chevron" size={14} sw={1.7} />
              </span>
            </PressCard>
            {!collapsed && (
              <div style={{ marginBottom: 10 }}>
                {items.slice(0, groupRows.shownFor(name)).map((tob, i) => (
                  <TobaccoCard key={tob.id} t={tob} idx={i} expanded={expandCards}
                    onOpen={() => onOpen(tob)} />
                ))}
                <ProgressiveMore hidden={items.length - groupRows.shownFor(name)}
                  onMore={() => groupRows.revealMoreIn(name)} t={t} accent={C.brassHi} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
function WishCard({
  w, idx, onAcquire, onEdit, onDelete, focused,
}: { w: WishlistItem; idx: number; onAcquire: () => void; onEdit: () => void; onDelete: () => void;
     focused?: boolean }) {
  const cc = CARD_ACCENTS[idx % CARD_ACCENTS.length]!;
  const { imgLocal, t, xl } = useAppCtx();
  const prioColor = w.priority === "high" ? C.oxbloodHi : w.priority === "medium" ? C.brassHi : C.sage;
  const prioLabel = w.priority === "high" ? (t ? t("prio_high") : "Haute")
                  : w.priority === "medium" ? (t ? t("prio_medium") : "Moyenne")
                  : (t ? t("prio_low") : "Basse");
  const e = useEnter(100 + idx * 50, { duration: 420 });
  const photoSrc = w.imageUrl ? ((imgLocal && imgLocal[w.imageUrl]) || w.imageUrl) : null;
  const hasProfile = (w.force || 0) > 0 || (w.roomNote || 0) > 0 || (w.taste || 0) > 0;
  return (
    // WishCard is no longer a PressCard with whole-card
    // tap-to-edit (that was the original model — confusing for users
    // who expected the same "tap → read-only detail" behaviour as
    // TobaccoCard / PipeCard / AccCard). Now the card is static and
    // the action row carries three explicit actions: Acquérir,
    // Modifier (pencil), Supprimer (trash). No surprise edits.
    <div
      data-wish-id={String(w.id)}
      style={{
        background: CARD_BG, border: `1px solid ${focused ? C.brassHi : C.rule}`,
        borderRadius: 8, marginBottom: 8, padding: 0, overflow: "hidden",
        boxShadow: focused ? `0 0 0 2px ${alpha(C.brassHi, "55")}` : CARD_SHADOW,
        transition: "border-color 400ms, box-shadow 400ms",
        ...e,
      }}>
      {/* CARD_ACCENTS top bar — restored (see TobaccoCard). */}
      <div style={{ height: 2, background: cc, opacity: 0.65 }} />
      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
        {/* Fixed 100×110 polaroid tile with inner padding —
            same shell as TobaccoCard / PipeCard / AccCard so a row of
            mixed cards stays visually aligned. */}
        <div style={{
          width: 100, height: 110, flexShrink: 0,
          background: photoSrc ? "transparent" : `linear-gradient(135deg, ${C.bg2}, ${C.bg3})`,
          // No border either. These two edges were the last of the
          // "polaroid" frame — they read as a sensible photo/text
          // separator only while the photo FILLED the column. Now that it
          // is `contain`, so a wide photo (a churchwarden is ~3:1 against a
          // 100x110 column) occupies a third of the height and the two edges
          // close a mostly-empty box in `C.rule`, a colour distinct from the
          // card. Reported from the app: "il y a un carré et le trait de ce
          // carré est d'une couleur différente".
          // `contain`, and NO ground of its own — reported from the
          // app, and it REVERSES the earlier `cover`. Cover guarantees the column
          // is filled, but it does so by CROPPING: a tall tin (or a long pipe)
          // is cut off and can never be seen whole, which is the one thing a
          // photo on an inventory card exists for. `contain` fits the whole
          // object, and the leftover area is transparent so the CARD shows
          // through — the photo floats instead of sitting in a frame. That is
          // what makes this different from the earlier state, which combined
          // `contain` with a coloured ground and an 8px padding to draw a
          // deliberate "polaroid" frame: the frame is what was
          // wrong, not the fit. The gradient stays for the no-photo placeholder,
          // where there is nothing to show through.
          boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: cc,
        }}>
          {photoSrc
            ? <div style={{ width: "100%", height: "100%", background: `${safeBgUrl(photoSrc)} center/contain no-repeat` }} />
            : <Ico name="heart" size={36} sw={1.2} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 13px" }}>
          {/* The priority badge used to sit in a flex
              parent alongside the entire text column — so the description /
              tasting notes / blend wrapped inside the narrow sub-column for
              their full height even though the badge only occupies the
              top-right corner. Lifted to the brand row: now the badge
              sits next to the brand label and every text block below
              uses the full card width. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lbl color={cc}>{w.brand || "—"}</Lbl>
            <div style={{ flex: 1 }} />
            <div style={{
              padding: "3px 8px", borderRadius: 4, flexShrink: 0,
              background: alpha(prioColor, "22"), border: `1px solid ${alpha(prioColor, "55")}`,
              fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
              textTransform: "uppercase", color: prioColor, fontWeight: 700,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <Ico name="heart" size={10} sw={2} fill="currentColor" />
              {prioLabel}
            </div>
          </div>
          <div style={{
            fontFamily: F.display, fontSize: fs(20), color: C.ivory,
            lineHeight: 1.15, marginTop: 3, letterSpacing: -0.3,
          }}>
            <span style={{ fontStyle: "italic" }}>{w.name || "—"}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: fs(15), color: C.tx2 }}>
            {[xl ? xl(w.category, CATS_EN) : w.category, xl ? xl(w.cut, CUTS_EN) : w.cut].filter(Boolean).join(" · ")}
          </div>
          {w.blend && (
            <div style={{ marginTop: 4, fontSize: fs(15), color: C.tx2, lineHeight: 1.4 }}>
              {w.blend}
            </div>
          )}
          {w.description && (
            <div style={{
              marginTop: 4, fontSize: fs(15), color: C.tx, lineHeight: 1.45,
              whiteSpace: "pre-wrap",
            }}>{w.description}</div>
          )}
          {w.tastingNotes && (
            <div style={{
              marginTop: 6, fontSize: fs(15), color: C.brassHi,
              fontStyle: "italic", lineHeight: 1.5, fontFamily: F.display,
            }}>{w.tastingNotes}</div>
          )}
          {hasProfile && (
            <div style={{
              marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap",
              fontFamily: F.mono, fontSize: fs(13), color: C.tx2, letterSpacing: 0.4,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.oxbloodHi }}>{t ? t("abbr_force") : "F"}</span><Stars n={w.force || 0} size={9} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.sageHi }}>{t ? t("abbr_room_note") : "R"}</span><Stars n={w.roomNote || 0} size={9} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.brassHi }}>{t ? t("abbr_taste") : "G"}</span><Stars n={w.taste || 0} size={9} />
              </span>
            </div>
          )}
          {w.agingMax && (
            <div style={{
              marginTop: 6, fontFamily: F.mono, fontSize: fs(13),
              color: C.brassHi, letterSpacing: 0.4,
            }}>
              {(t ? t("lbl_aging_label") : "Vieillissement : ") + w.agingMax + (t ? t("lbl_yrs_with_space") : " ans")}
            </div>
          )}
          {w.notes && (
            <div style={{
              marginTop: 8, paddingTop: 6, borderTop: `1px dotted ${C.rule}`,
              fontSize: fs(14.5), color: C.cream,
              fontStyle: "italic", lineHeight: 1.5, fontFamily: F.display,
            }}>« {w.notes} »</div>
          )}
          {/* Action row carries three explicit actions
              (Acquérir, Modifier, Supprimer). The whole-card tap-to-
              edit handler is gone, so the stopPropagation here is no
              longer needed — kept defensively in case some ancestor
              picks up a click listener later. */}
          <div
            style={{ marginTop: 10, display: "flex", gap: 6 }}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => ev.stopPropagation()}>
            <button type="button" onClick={onAcquire} style={{
              padding: "9px 14px", border: `1px solid ${C.rule}`,
              background: CARD_BG, color: C.brassHi, borderRadius: 8, cursor: "pointer",
              fontSize: fs(14.5), fontFamily: F.body, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44,
            }}>
              <Ico name="box" size={14} sw={1.8} />
              {t ? t("btn_acquire") : "Acquérir"}
            </button>
            {/* Icon-only buttons bumped to 44×44 (WCAG
                2.5.5 / Curator IconBtn minimum). They were 36px before. */}
            <button type="button" onClick={onEdit}
              aria-label={t ? t("btn_edit") : "Modifier"}
              style={{
                padding: "9px 12px", border: `1px solid ${C.rule}`,
                background: "transparent", color: C.tx2, borderRadius: 8, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                minHeight: 44, minWidth: 44,
              }}>
              <Ico name="edit" size={14} sw={1.8} />
            </button>
            <button type="button" onClick={onDelete}
              aria-label={t ? t("btn_delete") : "Supprimer"}
              style={{
                padding: "9px 12px", border: `1px solid ${alpha(C.oxblood, "55")}`,
                background: "transparent", color: C.oxbloodHi, borderRadius: 8, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                minHeight: 44, minWidth: 44,
              }}>
              <Ico name="trash" size={14} sw={1.8} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Horizontally-scrollable chip row with two scroll affordances:
//   1. A fade gradient on the right edge (always present when there is
//      overflow) suggesting more content is tucked off-screen.
//   2. A small chevron icon centred over the right edge — explicit cue
//      that the row can be swiped / scrolled. Both hide when the user
//      has scrolled all the way to the end.
//
// Built for the "Actifs" chip addition, which made the row likely
// to overflow on phone screens (8+ chips). Previously the bare overflow
// auto worked but was completely invisible — users assumed nothing more
// was hidden.
// FilterChip — single chip in the status filter row. Extracted
// from the inline render so the `useReliableTap` hook can be called at the
// top of a real component (hooks must not run inside .map callbacks).
function FilterChip({
  f, on, onPick,
}: {
  f: { id: string; label: string; n: number; icon?: IcoName; color?: string };
  on: boolean;
  onPick: () => void;
}) {
  const { pressed, handlers } = useReliableTap(onPick);
  const ring = useFocusRing();
  const accent = f.color || C.brass;
  // Arrow-key navigation between chips. The chips render as
  // direct siblings inside the ScrollableChipRow flex container, so
  // sibling-pointer navigation Just Works without prop-drilling refs.
  // Home / End jump to the first / last chip; the loop intentionally
  // stops at the edges rather than wrapping — matches WAI-ARIA's tabs
  // / toolbar pattern and keeps the scroll affordance visible.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const btn = e.currentTarget;
    let target: Element | null;
    if (e.key === "ArrowRight") target = btn.nextElementSibling;
    else if (e.key === "ArrowLeft") target = btn.previousElementSibling;
    else if (e.key === "Home") target = btn.parentElement?.firstElementChild ?? null;
    else if (e.key === "End") target = btn.parentElement?.lastElementChild ?? null;
    else return;
    if (target instanceof HTMLButtonElement) {
      e.preventDefault();
      // preventScroll on the focus, because the scrolling this
      // site DOES want is the explicit call below — horizontal, and clamped to
      // `block: "nearest"` so it never moves the page vertically. Letting
      // focus() scroll first meant two different scrolls for one keypress,
      // only one of them intended.
      target.focus({ preventScroll: true });
      // Bring it into view if the row scrolls horizontally. Guarded
      // against jsdom where scrollIntoView is absent.
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }
  return (
    <button type="button" {...handlers}
      aria-pressed={on}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      onKeyDown={onKeyDown}
      style={{
        padding: "8px 13px",
        border: `1px solid ${on ? accent : C.rule}`,
        background: on ? alpha(accent, "22") : "transparent",
        color: on ? accent : C.tx,
        borderRadius: 8, fontSize: fs(15), fontWeight: 500,
        display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
        cursor: "pointer", outline: "none",
        transform: pressed ? "scale(0.95)" : "scale(1)",
        transition: "background 200ms, color 200ms, border-color 200ms, transform 140ms, box-shadow 200ms",
        ...ring.style,
      }}>
      {f.icon && (
        <span style={{ display: "inline-flex", color: on ? accent : C.tx2 }}>
          <Ico name={f.icon} size={13} sw={1.7} fill={on ? "currentColor" : "none"} />
        </span>
      )}
      {f.label}
      {f.n >= 0 && (
        <span style={{
          fontSize: fs(12), color: on ? accent : C.tx3,
          fontFamily: F.mono, letterSpacing: 0.5,
        }}>{String(f.n).padStart(2, "0")}</span>
      )}
    </button>
  );
}

