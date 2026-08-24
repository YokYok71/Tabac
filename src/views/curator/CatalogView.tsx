// CuratorCatalogView — read-only browser of the catalogue the USER loaded
// (Réglages → Données → Catalogue de référence; the app bundles none). With
// nothing loaded it renders CatalogueMissing, which points at that screen.
// Reached via the 📖 icon in the InventoryListView TopBar. Lets the user
// explore the catalogue, filter / search, and "Add to my inventory" —
// pre-fills the TobaccoFormView with the canonical attributes.
//
// Out of scope (deliberate): editing the catalogue, removing entries,
// saving it into the cellar blob. The catalogue is reference data with its
// own IndexedDB store; the user's inventory is their own data. See the AI
// Integration section in CLAUDE.md for the architectural boundary.

import { useEffect, useMemo, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, fsInput, C, F, catColor, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { CATS_EN, CUTS_EN, canonCategory, canonCut } from "../../constants.ts";
import { pickLang } from "../../utils/docPage.ts";
import {
  loadTobaccoDb,
  tobaccoDbCanonicalKey,
  tobaccoDbSearchMatch,
  displayAliases,
  type TobaccoDb,
  type BlendEntry,
} from "../../utils/tobaccoDb.ts";
import { FAMILY_AGING_MAX } from "../../utils.ts";
import { IconBtn, PressCard, TopBar, PageTitle, Lbl, Stars, ScreenWash } from "../../components/curator/primitives.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { CatalogueMissing } from "../../components/curator/CatalogueMissing.tsx";
import { ToggleBtn, FilterChipSimple, ScrollableChipRow } from "../../components/curator/FilterControls.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { CuratorCompareModal } from "./CompareModal.tsx";
import { useProgressiveList } from "../../hooks/useProgressiveList.ts";
import { ProgressiveMore } from "../../components/curator/ProgressiveMore.tsx";

// THE FILTER IS DEBOUNCED; THE FIELD IS NOT.
//
// MEASURED on this machine, running the real `tobaccoDbSearchMatch` over a
// synthetic catalogue: 6-13 ms per keystroke at 1594 rows and 66-148 ms at
// 20000 (`MAX_CATALOGUE_ROWS`), the cost rising with the query length because a
// longer token falls through to the Levenshtein fallback. A phone is several
// times slower again. Typing "capstan blue" paid that twelve times, once per
// character, each pass blocking the keystroke that followed.
//
// 160 ms: above a fast typist's 120-200 ms inter-key gap, so a burst collapses
// to ONE pass, and below the ~200 ms at which a delayed UI starts reading as
// lag. Only the QUERY lags — `search` stays the controlled value of the input
// and updates on every keystroke, because debouncing the input itself is the
// prefill-race trap CLAUDE.md records (the field snaps back under the user's
// fingers).
//
// AN EMPTY QUERY APPLIES AT ONCE. Clearing the field is a "show me everything"
// gesture and the empty branch does zero matching work (`sq` empty
// short-circuits before `tobaccoDbSearchMatch`), so there is nothing to save by
// delaying it — only a list that looks stuck.
export const CATALOG_SEARCH_DEBOUNCE_MS = 160;

export function CuratorCatalogView() {
  const ctx = useAppCtx();
  const { view, t, xl, lang, data, BT, BW, addTobacco, addWish, nav, catalogSeed, setCatalogSeed,
    setStatusFilter, setCollapsedWishGroups, setCollapsedTobGroups,
    weightUnit, currencySymbol, catalogueMeta } = ctx as any;

  // ─── DB load (lazy) + selection / filter / search state ───
  const [db, setDb] = useState<TobaccoDb | null>(null);
  // The side-by-side comparison. Local to this view on purpose — the catalogue
  // is loaded HERE, so offering catalogue blends as columns costs no extra
  // read, and the cold-start rule forbids pulling it in elsewhere.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareSeed, setCompareSeed] = useState<string | null>(null);
  // `null` does not mean "the download failed" — it means the user has not
  // loaded a catalogue, which is the state of every fresh install. So there is
  // one non-db state, not two, and nothing to retry.
  const [noCatalogue, setNoCatalogue] = useState(false);
  const [search, setSearch] = useState("");
  // What the FILTER reads. Lags `search` by CATALOG_SEARCH_DEBOUNCE_MS; see
  // that constant for the measurement and for why the input is never debounced.
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<string>(""); // "" = all
  const [brandFilter, setBrandFilter] = useState<string>(""); // "" = all
  const [grouped, setGrouped] = useState<boolean>(true);
  // NULL-PROTOTYPE, keyed by the catalogue's own `brand_key` — see the
  // `groups` map below for why that key is untrusted. The consequence here is
  // quieter than a throw and just as unfixable by the user: `collapsed["__proto__"]`
  // reads as `Object.prototype`, so `!== false` keeps the group collapsed, and
  // `toggleGroup`'s write goes through the `__proto__` SETTER, which ignores a
  // non-object — so the group can NEVER be expanded, however many times it is
  // tapped. `toggleGroup` rebuilds onto `Object.create(null)` for the same
  // reason (a bare `Object.assign({}, prev)` would hand the prototype back).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(Object.create(null));
  const [selected, setSelected] = useState<{ key: string; entry: BlendEntry } | null>(null);
  // Brief feedback after an add. Auto-clears after ~2.5 s; the
  // catalog stays open so the user can keep browsing and the freshly-
  // flipped owned/wished badge confirms the row landed.
  const [addedNotice, setAddedNotice] = useState<{ kind: "inv" | "wish"; name: string } | null>(null);
  useEffect(() => {
    if (!addedNotice) return;
    const id = window.setTimeout(() => setAddedNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [addedNotice]);
  // Review-before-save modal — pre-filled with the catalog
  // entry's canonical attributes. The user can tweak before tapping
  // Save (replaces both an earlier full-screen form prefill — which
  // rendered offscreen below the catalog in document flow on mobile —
  // and the original direct-add — which committed without
  // any opportunity to review). The form lives on this state and
  // commits via addTobacco / addWish with the override API.
  // Review fix (a11y): the search input paired `outline:none` with no focus
  // indicator (WCAG 2.4.7) — restore a focus ring like every other input.
  const searchRing = useFocusRing();

  useEffect(() => {
    if (view !== "catalog") return;
    let mounted = true;
    setNoCatalogue(false);
    loadTobaccoDb().then((d) => {
      if (!mounted) return;
      // Two things at once, and BOTH are load-bearing. `noCatalogue`
      // distinguishes "still reading IndexedDB" from "read, and there is
      // nothing there", or the page sits on its spinner for ever. And
      // `setDb(null)` is what makes « Retirer le catalogue » take effect
      // here: the missing-catalogue screen is gated on `!db`, so leaving a
      // stale object would keep the removed catalogue on screen — searchable,
      // and still ADDABLE to the cellar through `addFromCatalog`.
      if (!d) { setDb(null); setNoCatalogue(true); return; }
      setDb(d);
    });
    return () => { mounted = false; };
    // `catalogueMeta` is the signal, not decoration: Settings is a modal over
    // whatever view is behind it, so loading or removing a catalogue while this
    // page is open changes NO other dependency here. It also fixes the mirror
    // case — loading a DIFFERENT catalogue used to leave the old one on screen.
  }, [view, lang, catalogueMeta]);

  // Consume a search seed handed over by the global SearchModal
  // (tapping a catalog hit navigates here). Applied ONCE then cleared — the
  // effect depends on the seed + view, never on `search`, so it doesn't fight
  // the user's typing (prefill-race rule).
  useEffect(() => {
    if (view === "catalog" && catalogSeed) {
      setSearch(catalogSeed);
      // Applied to the FILTER immediately, not through the debounce: this
      // page's contract is that a catalogue hit "opens CatalogView pre-filtered
      // on the query", and a delay there would show the unfiltered catalogue
      // first — exactly what the seed exists to avoid.
      setQuery(catalogSeed);
      setCatalogSeed && setCatalogSeed("");
    }
  }, [view, catalogSeed, setCatalogSeed]);

  // The debounce itself. An empty field applies at once (see the constant).
  useEffect(() => {
    if (search === query) return;
    if (!search) { setQuery(""); return; }
    const id = setTimeout(() => setQuery(search), CATALOG_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search, query]);

  // ─── Owned-set: which catalog keys the user already has ───
  // Compute once per inventory change so we don't run the canonical
  // resolution on every render.
  const tobList = data?.tobaccos;
  const ownedKeys = useMemo(() => {
    if (!db) return new Set<string>();
    const set = new Set<string>();
    const tobs = tobList || [];
    for (const t of tobs) {
      if (!t || t.deletedAt) continue;
      const k = tobaccoDbCanonicalKey(t.brand, t.name);
      if (k) set.add(k);
    }
    return set;
    // Keyed on the COLLECTION, not on `data`. `data` changes identity on every
    // save, and `db` is set on the first visit to this page and never cleared
    // (the view self-gates rather than unmounting), so this re-resolved the
    // whole cellar against the catalogue on every star tap, from any screen.
    // Cost is per MISS, and a miss falls through the full fuzzy ladder:
    // MEASURED at 300 tobaccos against a 20 000-blend catalogue, 1 309 ms —
    // and 145 ms even against a 1 594-blend one.
  }, [db, tobList]);

  // ─── Wished-set: catalog keys present in the user's wishlist ───
  const wishList = data?.wishlist;
  const wishedKeys = useMemo(() => {
    if (!db) return new Set<string>();
    const set = new Set<string>();
    const ws = wishList || [];
    for (const w of ws) {
      if (!w || w.deletedAt) continue;
      const k = tobaccoDbCanonicalKey(w.brand, w.name);
      if (k) set.add(k);
    }
    return set;
  }, [db, wishList]);

  // The "Vous pourriez aimer" section is GONE,
  // on the user's instruction. It scored the catalogue against the taste
  // profile and printed six rows above the list. Do NOT re-add it: the
  // catalogue is the user's OWN file, so a section that ranks
  // it for them is advice about data they curated themselves — and the page
  // exists to be browsed and searched, not to make suggestions. The engine
  // (`utils/recommend.ts`) went with it.

  // ─── Filtered + sorted list ───
  // Tokenized + Levenshtein-tolerant search via
  // tobaccoDbSearchMatch. Replaces the pre-43 plain-substring filter,
  // which broke on word reordering (DB key "capstan|flake blue" with
  // a user query "capstan blue") and on brand typos ("capitan blue").
  const filteredKeys = useMemo(() => {
    if (!db) return [] as string[];
    const sq = String(query).trim();
    return Object.keys(db.blends).filter((k) => {
      const e = db.blends[k]!;
      if (catFilter && e.category !== catFilter) return false;
      const brandKey = String(k).split("|")[0]!;
      if (brandFilter && brandKey !== brandFilter) return false;
      if (sq && !tobaccoDbSearchMatch(k, e, sq)) return false;
      return true;
    }).sort();
  }, [db, query, catFilter, brandFilter]);

  // Unique brands + categories available for filter chips
  const brandOptions = useMemo(() => {
    if (!db) return [];
    const brands = new Set<string>();
    for (const k of Object.keys(db.blends)) brands.add(String(k).split("|")[0]!);
    return Array.from(brands).sort().map((bk) => ({
      key: bk,
      display: (db.brands[bk] && db.brands[bk]!.displayName) || bk,
    }));
  }, [db]);

  const categoryOptions = useMemo(() => {
    if (!db) return [];
    const cats = new Set<string>();
    for (const k of Object.keys(db.blends)) cats.add(db.blends[k]!.category);
    return Array.from(cats).sort();
  }, [db]);

  // Brand groups (when grouped === true)
  const groupedView = useMemo(() => {
    // NULL-PROTOTYPE: the key is the catalogue's own `brand_key`, and
    // `parseCatalogueCsv` keeps an unrecognised value VERBATIM by design — so
    // a CSV saying `brand_key: __proto__` reaches here. On a plain object
    // `groups[bk]` then resolves to `Object.prototype`, which is truthy, so
    // the initialisation is skipped and `.push` is `undefined` → TypeError
    // during render → the error boundary takes the whole app.
    //
    // The catalogue is an EXCHANGEABLE artefact (template, export, cloud
    // save/restore), so "someone sent me their catalogue" is the intended
    // workflow, not an exotic one. Locked by `catalogueForgedBrand.test.tsx`.
    const groups: Record<string, string[]> = Object.create(null);
    for (const k of filteredKeys) {
      const bk = String(k).split("|")[0]!;
      if (!groups[bk]) groups[bk] = [];
      groups[bk]!.push(k);
    }
    const order = Object.keys(groups).sort();
    return order.map((bk) => ({ brandKey: bk, blendKeys: groups[bk]! }));
  }, [filteredKeys]);

  // The FLAT branch renders one row per blend, and a user catalogue may hold up
  // to MAX_CATALOGUE_ROWS. MEASURED at 20 000 rows: 200 613 DOM nodes, 93 MB of
  // heap, a page 1 220 601 px tall and 13.2 SECONDS of frozen main thread — one
  // tap on the grouping toggle above. The grouped branch is naturally bounded
  // (one collapsed row per brand, 2 935 nodes on the same catalogue) and is left
  // alone; a single brand's expanded blends are bounded by how many that maker
  // sells. Hook called ABOVE the early return, per the hook-order rule.
  const flat = useProgressiveList(filteredKeys);

  if (view !== "catalog") return null;
  if (!db) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", color: C.tx, paddingBottom: 130 }}>
        <TopBar
          leading={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconBtn icon="back" onClick={() => nav && nav("inv")} ariaLabel={t ? t("btn_back") : "Retour"} />
              <IconBtn icon="book" ariaLabel={t ? t("ttl_catalogue") : "Catalogue"} color={C.brassHi} />
            </div>
          }
          title={t ? t("catalog_title") : "Catalogue"}
        />
        {noCatalogue ? (
          <div style={{ padding: 24 }}>
            {/* This screen used to carry a chunk-failure message and a reload
                button, because a dynamic import that failed could not be
                retried. The bundled chunk is gone, so the honest
                message is no longer about a download at all: there is no
                catalogue because the user has not loaded one, and the remedy
                is Réglages → Données. Offering a "retry" for a file that was
                never fetched would send them back to a button that cannot
                help. */}
            <CatalogueMissing />
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: C.tx2 }}>
            {t ? t("lbl_loading_dots") : "Chargement…"}
          </div>
        )}
      </div>
    );
  }

  const totalShown = filteredKeys.length;
  const totalCatalog = Object.keys(db.blends).length;

  function toggleGroup(bk: string) {
    setCollapsed((prev) => {
      const n = Object.assign(Object.create(null), prev);
      if (n[bk] === false) delete n[bk]; else n[bk] = false;
      return n;
    });
  }

  function openDetail(key: string) {
    const e = db!.blends[key];
    if (!e) return;
    setSelected({ key, entry: e });
  }

  // Open the review-before-save modal. The catalog used to route
  // straight to TobaccoFormView / WishFormView via
  // nav("addT") / setShowWishForm, but those screens render as a
  // sibling below the catalog in document flow — on mobile that
  // section was effectively invisible ("ça ouvre une section en bas
  // mais on ne la voit pas"). Now we open a proper modal over the
  // catalog. Save commits via addTobacco / addWish with the override
  // API; cancel closes without touching data.
  // DIRECT one-tap add from the catalog fiche — no intermediate
  // review form. The user reported that "Ajouter à la wishlist" opened a form
  // whose Enregistrer button was hidden below the fold ("il faut scroller pour
  // le voir"). The catalogue already carries every field, so we build the
  // payload from the entry and commit immediately. The user can edit the entry
  // later from its fiche. Replaces the earlier startQuickAdd/commitQuickAdd
  // review modal.
  function addFromCatalog(kind: "inv" | "wish") {
    if (!selected) return;
    const e = selected.entry;
    const [bKey] = String(selected.key).split("|");
    const brandDisplay = (db!.brands[bKey!] && db!.brands[bKey!]!.displayName) || bKey || "";
    const lineDesc = (e.description && pickLang(e.description, lang)) || "";
    const base = kind === "inv" ? BT : BW;
    if (!base) return;
    const payload = Object.assign({}, base, {
      brand: brandDisplay,
      name: e.name || "",
      // The FOURTH catalogue-value writer, and the one that sweep
      // missed. `parseCatalogueCsv` keeps an unrecognised taxonomy label
      // VERBATIM on purpose, so a catalogue row saying `Pipeweed` / `Zigzag
      // Cut` used to land in the cellar straight from this button — where it
      // is the unrepresentable-value defect: no `CUT_DENSITY` for the bowl-weight estimate,
      // no `xl()` translation, no `FAMILY_AGING_MAX` so the blend loses its
      // maturity band, and no matching option in the form's fixed dropdown, so
      // the first save rewrites it anyway.
      // Falls back to the TEMPLATE default (empty), not to `Autre`: this is a
      // creation, so there is no personal value to protect and `Autre` on an
      // empty field adds nothing — the same rule, applied to a fresh row.
      category: canonCategory(e.category) || "",
      cut: canonCut(e.cut) || "",
      blend: e.blend || "",
      force: e.force || 0,
      roomNote: e.roomNote || 0,
      taste: e.taste || 0,
      agingMax: e.agingMax || "",
      description: lineDesc,
    });
    if (kind === "inv") {
      if (!addTobacco) return;
      addTobacco(payload);
      // The inventory / wishlist lists group by brand with the
      // groups COLLAPSED by default, so a just-added item lands hidden inside
      // its (possibly new) brand group — the reported "je l'ai ajouté mais il
      // n'est pas apparu". Expand this item's brand group so it's visible the
      // moment the user opens the list.
      if (setCollapsedTobGroups) setCollapsedTobGroups((p: any) => Object.assign({}, p, { [brandDisplay]: false }));
    } else {
      if (!addWish) return;
      addWish(payload);
      if (setCollapsedWishGroups) setCollapsedWishGroups((p: any) => Object.assign({}, p, { [brandDisplay]: false }));
    }
    setAddedNotice({ kind, name: e.name || "" });
    setSelected(null);
    // After an add, return the catalog to a "vierge" state — as if
    // just opened. The user reported that after adding, the search field was
    // still active on return. Clear the search + filters + group-collapse so the
    // next browse starts fresh (the toast still confirms the add + links to it).
    setSearch("");
    setQuery("");
    setCatFilter("");
    setBrandFilter("");
    setCollapsed({});
  }

  // Jump from the confirmation toast straight to the list the
  // item was added to (wishlist filter for a wish, live inventory for a
  // tobacco). The brand group is already expanded by addFromCatalog.
  function goToAdded(kind: "inv" | "wish") {
    setAddedNotice(null);
    if (setStatusFilter) setStatusFilter(kind === "wish" ? "wish" : "active");
    if (nav) nav("inv");
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.tx, paddingBottom: 130 }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ position: "relative" }}>
        {/* The bulk catalogue pass MOVED here from Settings →
            Données. It is an action ABOUT the catalogue, so this is where
            someone thinking about catalogue data already is, and a page-level
            TopBar action is the app's established pattern (search / trash /
            cart / + all live in this slot).
            Icon-only is safe here even for a whole-cellar action because
            NOTHING happens on the tap: it opens the confirm modal, which states
            the counts AND what is never touched before a single field is
            written. The `copy` glyph reads as "copy these data onto my fiches";
            `book` is taken by the page's own identity two icons to the left,
            and `restore` means "restore from trash" app-wide.
            No `disabled` prop needed — startCatalogueApply carries its own
            re-entry guard, and the catalogue is already loaded on this very
            page, so the plan step is effectively instant here (unlike from
            Settings, which had to fetch the chunk first).
            It is on the MAIN TopBar only, not the loading/error one above: you
            cannot apply a catalogue that failed to load. */}
        <TopBar
          leading={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconBtn icon="back" onClick={() => nav && nav("inv")} ariaLabel={t ? t("btn_back") : "Retour"} />
              <IconBtn icon="book" ariaLabel={t ? t("ttl_catalogue") : "Catalogue"} color={C.brassHi} />
            </div>
          }
          title={t ? t("catalog_title") : "Catalogue"}
          trailing={
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <IconBtn
                icon="chart"
                onClick={() => { setCompareSeed(null); setCompareOpen(true); }}
                ariaLabel={t ? t("cmp_title") : "Comparer des blends"}
                color={C.steelHi} />
              <IconBtn
                icon="copy"
                onClick={ctx.startCatalogueApply}
                ariaLabel={t ? t("cat_apply_btn") : "Appliquer les données du catalogue"}
                color={C.steelHi} />
            </div>
          }
        />

        {addedNotice && (
          <button
            type="button"
            aria-live="polite"
            onClick={() => goToAdded(addedNotice.kind)}
            style={{
              position: "fixed",
              top: "max(env(safe-area-inset-top, 0), 72px)",
              left: "50%", transform: "translateX(-50%)",
              zIndex: 100,
              minWidth: 220, maxWidth: "calc(100vw - 32px)",
              padding: "10px 16px",
              borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: F.body, fontSize: fs(14.5), color: C.bg,
              background: addedNotice.kind === "inv"
                ? `linear-gradient(135deg, ${C.sageHi}, ${C.sage})`
                : `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
              boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
              textAlign: "center", fontWeight: 600,
            }}
          >
            {addedNotice.kind === "inv"
              ? (t ? String(t("catalog_toast_added_inv")).replace("{name}", addedNotice.name) : `✓ Ajouté à l'inventaire — « ${addedNotice.name} »`)
              : (t ? String(t("catalog_toast_added_wish")).replace("{name}", addedNotice.name) : `★ Ajouté à la wishlist — « ${addedNotice.name} »`)}
            <span style={{ marginLeft: 8, fontWeight: 700, textDecoration: "underline" }}>
              {t ? t("catalog_toast_view") : "Voir"} →
            </span>
          </button>
        )}

        <div style={{ padding: "0 12px 8px" }}>
          <PageTitle>
            <span style={{ fontStyle: "italic", color: C.brassHi }}>
              {t ? t("catalog_subtitle") : "Base de référence"}
            </span>
          </PageTitle>
        </div>

        <div style={{ padding: "0 12px 14px" }}>
          <Notice tone="info">
            {t
              ? String(t("catalog_intro")).replace("{n}", String(totalCatalog))
              : "Ton catalogue : " + totalCatalog + " blends. Lecture seule — touche une fiche pour l'ajouter à ton inventaire ou ta wishlist."}
          </Notice>
        </div>

        {/* A LABELLED way into the comparison.
            The TopBar keeps its chart icon, but four unlabelled 44 px buttons
            sit in that bar and nothing says which one compares; the feature was
            reported as missing twice by someone who had it in front of them.
            An icon-only trigger is defensible for SAFETY (the argument
            for the catalogue-apply action: the tap opens a confirm, it writes
            nothing) — but "harmless" is not "findable", which is the question
            that was actually being asked. This sits above the fold, right where
            someone browsing blends is already looking, and touches neither the
            shared TopBar nor the apply action's single entry point. */}
        <div style={{ padding: "0 12px 10px" }}>
          <PressCard
            onClick={() => { setCompareSeed(null); setCompareOpen(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "11px 14px", borderRadius: 8,
              background: CARD_BG, border: `1px solid ${C.rule}`,
            }}>
            <span style={{ color: C.steelHi, display: "flex" }}><Ico name="chart" size={17} sw={1.6} /></span>
            <span style={{ fontFamily: F.body, fontSize: fs(14), color: C.tx, flex: 1, minWidth: 0 }}>
              {t ? t("cmp_title") : "Comparer des blends"}
            </span>
            <span style={{ color: C.tx3, display: "flex", flexShrink: 0 }}><Ico name="chevron" size={15} sw={2} /></span>
          </PressCard>
        </div>

        {/* Search */}
        <div style={{ padding: "0 12px 8px" }}>
          <input
            type="search"
            placeholder={t ? t("catalog_search_ph") : "Marque, blend, composition…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={searchRing.onFocus}
            onBlur={searchRing.onBlur}
            aria-label={t ? t("catalog_search_aria") : "Recherche catalogue"}
            style={{
              width: "100%", padding: "10px 14px", background: CARD_BG, color: C.ivory,
              border: `1px solid ${C.rule}`, borderRadius: 8,
              // fsInput clamps to ≥16px so iOS Safari doesn't auto-zoom on focus (matches baseInput).
              fontFamily: F.body, fontSize: fsInput(17), outline: "none",
              boxSizing: "border-box",
              ...searchRing.style,
            }}
          />
        </div>

        {/* Category filter chips */}
        <ScrollableChipRow pad="0 12px 6px" gap={6}>
          <FilterChipSimple
            label={t ? t("f_all") : "Tous"}
            on={!catFilter}
            onClick={() => setCatFilter("")}
            accent={C.brassHi}
          />
          {categoryOptions.map((c) => (
            <FilterChipSimple
              key={c}
              label={xl ? xl(c, CATS_EN) : c}
              on={catFilter === c}
              onClick={() => setCatFilter(catFilter === c ? "" : c)}
              accent={catColor(c)}
            />
          ))}
        </ScrollableChipRow>

        {/* Brand filter (select) + group toggle */}
        <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", alignItems: "center" }}>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            aria-label={t ? t("aria_filter_by_brand") : "Filtrer par marque"}
            style={{
              flex: 1, padding: "8px 10px", background: CARD_BG, color: C.ivory,
              border: `1px solid ${C.rule}`, borderRadius: 8,
              fontFamily: F.body, fontSize: fs(14.5),
            }}
          >
            <option value="">{t ? t("f_all_brands") : "Marque"}</option>
            {brandOptions.map((b) => (
              <option key={b.key} value={b.key}>{b.display}</option>
            ))}
          </select>
          <ToggleBtn
            icon={grouped ? "more" : "sliders"}
            on={grouped}
            onClick={() => setGrouped(!grouped)}
            ariaLabel={t ? t("aria_group_by_brand") : "Grouper par marque"}
            accent={C.brassHi}
          />
        </div>

        {/* Count line */}
        <div style={{ padding: "0 12px 6px", fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.5 }}>
          {totalShown}/{totalCatalog} {t ? t("catalog_results") : "blends"}
        </div>

        {/* List */}
        <div style={{ padding: "0 12px" }}>
          {totalShown === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: C.tx2 }}>
              {t ? t("catalog_no_match") : "Aucun blend ne correspond aux filtres."}
            </div>
          )}
          {grouped
            ? groupedView.map(({ brandKey, blendKeys }) => {
                const isCollapsed = collapsed[brandKey] !== false; // default collapsed
                const brandDisplay = (db.brands[brandKey] && db.brands[brandKey]!.displayName) || brandKey;
                return (
                  <div key={brandKey} style={{ marginBottom: 10 }}>
                    <PressCard
                      onClick={() => toggleGroup(brandKey)}
                      style={{
                        padding: "10px 14px", background: CARD_BG,
                        borderRadius: 8, border: `1px solid ${C.rule}`,
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                    >
                      <Ico name="chevron" size={14} sw={1.7} style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 180ms", color: C.brassHi } as any} />
                      <span style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, flex: 1 }}>{brandDisplay}</span>
                      <span style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3 }}>{blendKeys.length}</span>
                    </PressCard>
                    {!isCollapsed && (
                      <div style={{ marginTop: 6 }}>
                        {blendKeys.map((k) => (
                          <BlendRow key={k} entry={db.blends[k]!} owned={ownedKeys.has(k)} wished={wishedKeys.has(k)} onClick={() => openDetail(k)} t={t} xl={xl} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            : (
              <>
                {flat.visible.map((k) => (
                  <BlendRow key={k} entry={db.blends[k]!} owned={ownedKeys.has(k)} wished={wishedKeys.has(k)} onClick={() => openDetail(k)} t={t} xl={xl} />
                ))}
                <ProgressiveMore hidden={flat.hidden} onMore={flat.revealMore}
                  sentinelRef={flat.sentinelRef} t={t} accent={C.brassHi} />
              </>
            )
          }
        </div>

        {/* The comparison. Rendered here so it is only ever mounted
            with the catalogue in memory. */}
        {compareOpen && (
          <CuratorCompareModal
            open={true}
            onClose={() => { setCompareOpen(false); setCompareSeed(null); }}
            db={db} lang={lang} data={data} t={t} xl={xl}
            weightUnit={weightUnit || "g"} currencySymbol={currencySymbol || "€"}
            seedKey={compareSeed} />
        )}

        {/* Detail modal */}
        {selected && (
          <Modal open={true} onClose={() => setSelected(null)} capHeight ariaLabel={t ? t("catalog_fiche_aria") : "Fiche catalogue"}>
            <CatalogDetailContent
              entry={selected.entry}
              brandDisplay={(db.brands[String(selected.key).split("|")[0]!] && db.brands[String(selected.key).split("|")[0]!]!.displayName) || String(selected.key).split("|")[0]!}
              lang={lang}
              owned={ownedKeys.has(selected.key)}
              wished={wishedKeys.has(selected.key)}
              onAdd={() => addFromCatalog("inv")}
              onAddWish={() => addFromCatalog("wish")}
              onCompare={() => {
                setCompareSeed("catalogue:" + String(selected.key));
                setSelected(null);
                setCompareOpen(true);
              }}
              onClose={() => setSelected(null)}
              t={t}
              xl={xl}
            />
          </Modal>
        )}

      </div>
    </div>
  );
}

// ─── Single blend row in the catalog list ───
function BlendRow({
  entry, owned, wished, onClick, t, xl,
}: {
  entry: BlendEntry; owned: boolean; wished: boolean; onClick: () => void; t?: (k: string) => string; xl?: (s: string, map: Record<string, string>) => string;
}) {
  // owned wins over wished for the row border accent.
  const borderColor = owned ? alpha(C.sage, "55") : (wished ? alpha(C.amber, "55") : C.rule);
  return (
    <PressCard
      onClick={onClick}
      style={{
        padding: "10px 14px", background: CARD_BG,
        marginBottom: 6, borderRadius: 8,
        border: `1px solid ${borderColor}`,
        boxShadow: CARD_SHADOW,
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, fontSize: fs(16) }}>{entry.name}</span>
          {owned && (
            <span style={{ fontFamily: F.mono, fontSize: fs(11), color: C.sageHi, letterSpacing: 0.7, textTransform: "uppercase" }}>
              ✓ {t ? t("catalog_owned_short") : "possédé"}
            </span>
          )}
          {!owned && wished && (
            <span style={{ fontFamily: F.mono, fontSize: fs(11), color: C.amber, letterSpacing: 0.7, textTransform: "uppercase" }}>
              ★ {t ? t("catalog_wished_short") : "envie"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2, fontFamily: F.mono, fontSize: fs(12), color: C.tx3, letterSpacing: 0.5, textTransform: "uppercase" }}>
          <span style={{ color: catColor(entry.category) }}>{xl ? xl(entry.category, CATS_EN) : entry.category}</span>
          <span>·</span>
          <span>{xl ? xl(entry.cut, CUTS_EN) : entry.cut}</span>
        </div>
      </div>
      <Ico name="chevron" size={12} sw={1.7} style={{ transform: "rotate(-90deg)", color: C.tx3 } as any} />
    </PressCard>
  );
}

// ─── Detail modal content ───
function CatalogDetailContent({
  entry, brandDisplay, lang, owned, wished, onAdd, onAddWish, onCompare, onClose, t, xl,
}: {
  entry: BlendEntry; brandDisplay: string; lang: string; owned: boolean; wished: boolean;
  onAdd: () => void; onAddWish: () => void; onCompare: () => void; onClose: () => void; t?: (k: string) => string;
  xl?: (s: string, map: Record<string, string>) => string;
}) {
  const desc = (entry.description && pickLang(entry.description, lang)) || "";
  const aliasNames = displayAliases(entry, brandDisplay);
  return (
    // This was `maxHeight: "85vh"` + `overflowY: auto`, and it
    // is the last modal in the app still on that pattern; the Lot, Maintenance
    // and Compare modals moved to `capHeight` for exactly this
    // report ("la page bouge, pas la modale").
    //
    // MEASURED at 390×844 with the full catalogue behind: the fiche's own
    // scroll range was 842 − 717 = 125 px, while the page underneath was 5261
    // px tall. A real swipe travels much further than 125 px, and
    // `overscroll-behavior` was left at `auto` here, so the gesture ran out of
    // modal and CHAINED to the document. The backdrop does carry `contain`,
    // but it is not itself a scroll port in this layout (scrollHeight ===
    // clientHeight), and containment applies to scroll ports — so the chain
    // walked straight past it to the page.
    //
    // `85vh` was the second half of the problem: it is a guess that ignores the
    // backdrop's own padding (8 % top + 24 px bottom + the safe areas), so the
    // panel could exceed the space it actually had. `capHeight` caps the panel
    // against the real padded box and makes it a flex column; `flex: 1` +
    // `minHeight: 0` then give this region the leftover height — `minHeight`
    // matters, a flex item defaults to `min-height: auto` and would refuse to
    // shrink below its content.
    <div style={{
      padding: 20, color: C.tx,
      flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
    }}>
      <div style={{ marginBottom: 4, fontFamily: F.mono, fontSize: fs(12), letterSpacing: 0.7, color: C.brassHi, textTransform: "uppercase" }}>
        {brandDisplay}
      </div>
      <div style={{ fontFamily: F.display, fontStyle: "italic", fontSize: fs(26), color: C.ivory, lineHeight: 1.15, marginBottom: 12 }}>
        {entry.name}
      </div>
      {/* The OTHER names this blend answers to. It sits
          directly under the title because it is identity, not a spec: the
          question it answers is "why did my tin's name land me here?", and
          a merged catalogue row is the case that makes it necessary (a tin
          labelled "50th Anniversary" opens a fiche titled "Jubilee Pipe
          Tobacco"). `displayAliases` drops every alias already contained in
          the heading, so the row is absent entirely on the fiches where it
          would only echo the title — see that function for the measurement. */}
      {aliasNames.length > 0 && (
        <div style={{ marginTop: -6, marginBottom: 14, fontFamily: F.body, fontSize: fs(13), color: C.tx3, lineHeight: 1.5 }}>
          <span style={{ fontFamily: F.mono, fontSize: fs(11), letterSpacing: 0.5, textTransform: "uppercase" }}>
            {t ? t("catalog_aliases") : "Aussi appelé"}
          </span>
          {" · "}
          <span style={{ color: C.tx2 }}>{aliasNames.join(" · ")}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.5, textTransform: "uppercase" }}>
        <span style={{ color: catColor(entry.category) }}>{xl ? xl(entry.category, CATS_EN) : entry.category}</span>
        <span>·</span>
        <span>{xl ? xl(entry.cut, CUTS_EN) : entry.cut}</span>
        {/* DISPLAYED, not stored. 1205 of the 1222 catalogue
            rows carried an agingMax equal to their family's constant, so the
            column looked like per-blend knowledge and was not; worse, QuickAdd
            COPIED it into the user's cellar, freezing a constant that
            `effectiveAgingMax` would otherwise re-derive (and that table is
            itself revised). The column now holds only genuinely per-blend values
            and the family default is resolved here at render, so this line is
            unchanged on screen while nothing is written to user data. */}
        {(entry.agingMax || FAMILY_AGING_MAX[entry.category] || "") && (
          <><span>·</span><span>{entry.agingMax || FAMILY_AGING_MAX[entry.category]} {t ? t("lbl_yrs") : "ans"}</span></>
        )}
      </div>

      {/* Tasting attrs */}
      <div style={{ background: CARD_BG, padding: "12px 14px", borderRadius: 8, border: `1px solid ${C.rule}`, marginBottom: 14 }}>
        <Lbl color={C.brassHi}>{t ? t("sec_flavour") : "Profil gustatif"}</Lbl>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", rowGap: 6, columnGap: 12, alignItems: "center" }}>
          <span style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.5, textTransform: "uppercase" }}>{t ? t("lbl_force") : "Force"}</span>
          <Stars n={entry.force} />
          <span style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.5, textTransform: "uppercase" }}>{t ? t("lbl_room_note") : "Room Note"}</span>
          <Stars n={entry.roomNote} />
          <span style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.5, textTransform: "uppercase" }}>{t ? t("lbl_taste") : "Goût"}</span>
          <Stars n={entry.taste} />
        </div>
      </div>

      {/* Composition */}
      <div style={{ marginBottom: 14 }}>
        <Lbl color={C.brassHi}>{t ? t("lbl_blend") : "Composition"}</Lbl>
        <div style={{ marginTop: 4, color: C.tx, fontFamily: F.body, fontSize: fs(15) }}>{entry.blend}</div>
      </div>

      {/* Description */}
      {desc && (
        <div style={{ marginBottom: 16 }}>
          <Lbl color={C.brassHi}>{t ? t("lbl_desc") : "Description"}</Lbl>
          <div style={{ marginTop: 4, color: C.tx2, fontFamily: F.body, fontSize: fs(15), lineHeight: 1.55 }}>{desc}</div>
        </div>
      )}

      {/* Status notices (mutually exclusive — owned wins over wished) */}
      {owned && (
        <div style={{ marginTop: 6, marginBottom: 14 }}>
          <Notice tone="success">
            {t ? t("catalog_already_owned") : "Ce blend est déjà dans votre inventaire."}
          </Notice>
        </div>
      )}
      {!owned && wished && (
        <div style={{ marginTop: 6, marginBottom: 14 }}>
          <Notice tone="warn">
            {t ? t("catalog_already_wished") : "Ce blend est déjà dans votre wishlist."}
          </Notice>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {!owned && (
          <ModalAction variant="primary" onClick={onAdd}>
            + {t ? t("catalog_add_btn") : "Ajouter à mon inventaire"}
          </ModalAction>
        )}
        {!owned && !wished && (
          <ModalAction variant="secondary" onClick={onAddWish}>
            ★ {t ? t("catalog_add_wish_btn") : "Ajouter à ma wishlist"}
          </ModalAction>
        )}
        {/* Compare THIS blend against something you own. The second
            entry point, and the one where the question actually arises — you are
            looking at a blend you do not have. */}
        <ModalAction variant="secondary" onClick={onCompare}>
          {t ? t("cmp_title") : "Comparer des blends"}
        </ModalAction>
        <ModalAction variant="secondary" onClick={onClose}>
          {t ? t("btn_close") : "Fermer"}
        </ModalAction>
      </div>
    </div>
  );
}
