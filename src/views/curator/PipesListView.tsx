// Pipes list view.

import { useEffect, useMemo, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { allTags } from "../../utils/tags.ts";
import { alpha, fs, C, F, CARD_ACCENTS, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  PageTitle, useEnter, EmptyState,
} from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  ToggleBtn, ActiveFilterPill, FilterChipSimple, ScrollableChipRow,
} from "../../components/curator/FilterControls.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { SHAPES_EN, SHAPE_FAMILIES, BOWL_MATS_EN, FILTERS_EN, CATS, CATS_EN } from "../../constants.ts";
import { computePipeUsageProfile } from "../../utils/ghosting.ts";
import { computePipeRest, isPipeRested } from "../../utils/rotation.ts";
import { computePipeMaintenanceReminders } from "../../utils/pipeMaint.ts";
import { distinctSortedBrands, today } from "../../utils.ts";
import type { Pipe } from "../../types.ts";

// Shared rest chip — shown on the list card and reused
// (via export) by PipesDetailView. Renders nothing when the pipe has
// never been smoked (no chip beats a confusing "repos ∞").
export function PipeRestChip({ restDays, t }: {
  restDays: number | null | undefined;
  t?: ((k: string) => string) | undefined;
}) {
  if (restDays === null || restDays === undefined) return null;
  const rested = isPipeRested(restDays);
  const color = rested ? C.sage : C.amber;
  const tpl = t ? t("rest_chip") : "repos {n} j";
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", borderRadius: 4,
      background: alpha(color, "22"), color,
      fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
      textTransform: "uppercase", fontWeight: 700,
    }}>{String(tpl).replace("{n}", String(restDays))}</span>
  );
}

export function CuratorPipesListView() {
  const ctx = useAppCtx();
  const {
    view, pipeDet, setPipeDet, data, t, xl, nav, filteredPipes,
    setSearchOpen, maintReminderThreshold, maintRemindersEnabled,
    showFinishedPipes, setShowFinishedPipes,
    BP, setPipeForm, setEditPipeId,
    pShapeFilter, setPShapeFilter,
    pBrandFilter, setPBrandFilter,
    pFilterFilter, setPFilterFilter,
    pRatingFilter, setPRatingFilter,
    // Material filters wired from StatsView click-thrus
    // ("Matière du bol" / "Matière du bec" charts). Exposed here so
    // the user can see and clear them via the ActiveFilterPill row.
    pBowlMaterialFilter = "", setPBowlMaterialFilter,
    pStemMaterialFilter = "", setPStemMaterialFilter,
    pTagFilter = "", setPTagFilter,
    pipesGrouped, setPipesGrouped,
    collapsedPipeGroups, togglePipeGroup, setCollapsedPipeGroups,
    expandCards, setExpandCards,
  } = ctx;
  const brandRing = useFocusRing();
  const ratingRing = useFocusRing();

  // Derive the list of brands actually present in the pipe
  // collection (deduped, alphabetical). Sourced from `data.pipes` (NOT
  // filteredPipes) so the dropdown options don't shrink as the user
  // narrows the filter — picking a brand that's already filtered out
  // would otherwise be impossible to reach.
  const allPipes = (data?.pipes || []) as Pipe[];
  // Distinct user tags across pipes (drives the tag filter row).
  const pipeTagList = useMemo(() => allTags(allPipes), [allPipes]);
  const pipeBrandOptions = useMemo(() => {
    return distinctSortedBrands(allPipes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.pipes]);

  // Stale-filter auto-clear — if the chosen brand disappears (all pipes
  // of that brand deleted), reset the filter to "all" so the list
  // doesn't sit empty under a phantom selection.
  useEffect(() => {
    if (pBrandFilter && !pipeBrandOptions.includes(pBrandFilter)) {
      setPBrandFilter && setPBrandFilter("");
    }
  }, [pBrandFilter, pipeBrandOptions, setPBrandFilter]);

  // Shape filter grouped by family. Only shapes actually present
  // in the collection are offered (derived from data.pipes, not filteredPipes,
  // so the option list doesn't shrink under the active selection), grouped via
  // SHAPE_FAMILIES so the dropdown mirrors the pipe form's shape picker.
  const shapeRing = useFocusRing();
  const pipeShapePresent = useMemo(() => {
    const s = new Set<string>();
    allPipes.forEach((p) => { if (p.shape) s.add(String(p.shape)); });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.pipes]);
  const pipeShapeGroups = useMemo(
    () => SHAPE_FAMILIES
      .map((f) => ({ key: f.key, shapes: f.shapes.filter((s) => pipeShapePresent.has(s)) }))
      .filter((g) => g.shapes.length > 0),
    [pipeShapePresent],
  );
  useEffect(() => {
    if (pShapeFilter && !pipeShapePresent.has(pShapeFilter)) {
      setPShapeFilter && setPShapeFilter("");
    }
  }, [pShapeFilter, pipeShapePresent, setPShapeFilter]);

  // Rest map (pipeId → days since last session, null =
  // never smoked). One scan of sessions for the whole list.
  const restMap = useMemo(
    () => computePipeRest(data?.pipes || [], data?.sessions || []),
    [data?.pipes, data?.sessions],
  );

  // Set of pipe ids due for maintenance (sessions since last
  // cleaning ≥ threshold) — drives the "à entretenir" card chip.
  const maintDueSet = useMemo(
    () => maintRemindersEnabled === false
      ? new Set<string>()
      : new Set(computePipeMaintenanceReminders(data?.pipes || [], data?.sessions || [], maintReminderThreshold, 0, today()).map(x => x.pipeId)),
    [data?.pipes, data?.sessions, maintReminderThreshold, maintRemindersEnabled],
  );

  // Dominant tobacco family per pipe (the family it has smoked the
  // most, from its session history) — powers the "Famille fumée" filter so the
  // user can pick pipes by the kind of tobacco they lean toward, to avoid
  // ghosting (e.g. keep the Latakia pipes for Latakia). null = never smoked.
  const famRing = useFocusRing();
  const [pAdvFiltersOpen, setPAdvFiltersOpen] = useState(false);
  // The tag chip row spent a full row above the first card
  // ("ça prend trop de place"); it now folds behind the same disclosure the
  // tobacco list uses.
  const [pFamilyFilter, setPFamilyFilter] = useState("");
  const pipeFamily = useMemo(() => {
    const m: Record<string, string | null> = {};
    (data?.pipes || []).forEach((p: any) => {
      m[String(p.id)] = computePipeUsageProfile(p.id, data?.sessions || [], data?.tobaccos || []).dominant;
    });
    return m;
  }, [data?.pipes, data?.sessions, data?.tobaccos]);
  const pFamilyOptions = useMemo(() => {
    const present = new Set<string>();
    (data?.pipes || []).forEach((p: any) => { const f = pipeFamily[String(p.id)]; if (f) present.add(f); });
    return (CATS as readonly string[]).filter((c) => present.has(c));
  }, [data?.pipes, pipeFamily]);
  const hasVirginPipes = useMemo(
    () => (data?.pipes || []).some((p: any) => !pipeFamily[String(p.id)]),
    [data?.pipes, pipeFamily],
  );
  // Stale-filter auto-clear — reset if the chosen family (or "vierges") no
  // longer applies to any pipe.
  useEffect(() => {
    if (pFamilyFilter === "__virgin__") { if (!hasVirginPipes) setPFamilyFilter(""); }
    else if (pFamilyFilter && !pFamilyOptions.includes(pFamilyFilter)) setPFamilyFilter("");
  }, [pFamilyFilter, pFamilyOptions, hasVirginPipes]);
  // Reset the local "Famille fumée" filter when the pipes view is
  // LEFT, so it matches the ctx-level pipe filters (shape / brand / rating /
  // filterType) which nav() clears. CuratorApp keeps every view mounted, so
  // this local state would otherwise persist across a navigate-away/return
  // (leaving the pipe list silently narrowed). Opening a pipe fiche keeps
  // view === "pipes" (it's driven by pipeDet, not a view change), so a drill
  // preserves the filter exactly like the ctx ones.
  useEffect(() => {
    if (view !== "pipes") setPFamilyFilter("");
  }, [view]);

  if (view !== "pipes" || pipeDet) return null;
  const pipesBase = (filteredPipes || data?.pipes || []) as Pipe[];
  // Is anything actually narrowing the list? `showFinishedPipes` is
  // EXCLUDED — it widens the list rather than narrowing it, so a reset that
  // turned it off would remove rows the user just asked to see.
  const pipesFiltered = !!(
    pShapeFilter || pBrandFilter || pFilterFilter || pRatingFilter
    || pBowlMaterialFilter || pStemMaterialFilter || pTagFilter || pFamilyFilter
  );
  // See openAddTobacco in InventoryListView for the full
  // reasoning. In short: `pipeForm` is reset only by add/update success and
  // the form's own cancel, `nav()` may not touch it (standing invariant), and leaving
  // a CLEAN edit form skips the unsaved guard — so the working copy survives
  // and `addPipe` does `uid: source.uid || newUid()`, inheriting the edited
  // pipe's cross-device identity along with its `maintenance` and `photos`.
  const openAddPipe = () => {
    if (BP && setPipeForm) setPipeForm(Object.assign({}, BP));
    if (setEditPipeId) setEditPipeId(null);
    nav && nav("addP");
  };

  const resetPipeFilters = () => {
    setPShapeFilter && setPShapeFilter("");
    setPBrandFilter && setPBrandFilter("");
    setPFilterFilter && setPFilterFilter("");
    setPRatingFilter && setPRatingFilter(0);
    setPBowlMaterialFilter && setPBowlMaterialFilter("");
    setPStemMaterialFilter && setPStemMaterialFilter("");
    setPTagFilter && setPTagFilter("");
    setPFamilyFilter("");
  };

  const pipes = pFamilyFilter
    ? pipesBase.filter((p) => pFamilyFilter === "__virgin__"
        ? !pipeFamily[String(p.id)]
        : pipeFamily[String(p.id)] === pFamilyFilter)
    : pipesBase;

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="pipe" ariaLabel={t ? t("aria_pipes") : "Pipes"} color={C.oxbloodHi} />}
          title={t ? t("ttl_collection") : "Collection"}
          trailing={<>
            <CuratorTrashIndicator />
            <IconBtn icon="search" onClick={() => setSearchOpen && setSearchOpen(true)} ariaLabel={t ? t("btn_search") : "Rechercher"} />
            <IconBtn icon="plus" onClick={openAddPipe}
              bg={C.oxbloodHi} color={C.bg} border={false} glow={C.oxbloodHi}
              ariaLabel={t ? t("btn_add_pipe") : "Ajouter une pipe"} style={{ borderRadius: 10 }} />
          </>}
        />

        <PageTitle>
          {t ? t("pipes_title_prefix") : "Les"} <span style={{ fontStyle: "italic", color: C.oxbloodHi }}>{t ? t("pipes_title_word") : "pipes"}</span>
        </PageTitle>

        <div style={{ padding: "0 12px 12px", marginTop: -8, fontSize: fs(15), color: C.tx2 }}>
          <span style={{ fontFamily: F.mono, color: C.oxbloodHi }}>
            <AnimNum value={pipes.length} delay={150} />
          </span> {t ? String(t("stat_pipes_word")).toLowerCase() : "pipes"}
        </div>

        {/* Active filter pills */}
        {(pShapeFilter || pBrandFilter || pFilterFilter || pRatingFilter
          || pBowlMaterialFilter || pStemMaterialFilter || pFamilyFilter || pTagFilter) && (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Lbl color={C.oxbloodHi}>{t ? t("lbl_filter_colon") : "Filtre :"}</Lbl>
            {pShapeFilter && <ActiveFilterPill label={pShapeFilter}
              onClear={() => setPShapeFilter && setPShapeFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pBrandFilter && <ActiveFilterPill label={pBrandFilter}
              onClear={() => setPBrandFilter && setPBrandFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pFilterFilter && <ActiveFilterPill
              label={pFilterFilter === "__none__"
                ? (t ? t("lbl_filter_none") : "Aucun filtre")
                : (xl ? xl(pFilterFilter, FILTERS_EN) : pFilterFilter)}
              onClear={() => setPFilterFilter && setPFilterFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pRatingFilter ? <ActiveFilterPill label={"★ " + pRatingFilter}
              onClear={() => setPRatingFilter && setPRatingFilter(0)}
              accent={C.oxbloodHi} accentBase={C.oxblood} /> : null}
            {pBowlMaterialFilter && <ActiveFilterPill
              label={(t ? t("lbl_bowl_prefix") : "Foyer : ") + pBowlMaterialFilter}
              onClear={() => setPBowlMaterialFilter && setPBowlMaterialFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pStemMaterialFilter && <ActiveFilterPill
              label={(t ? t("lbl_stem_prefix") : "Tuyau : ") + pStemMaterialFilter}
              onClear={() => setPStemMaterialFilter && setPStemMaterialFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pFamilyFilter && <ActiveFilterPill
              label={pFamilyFilter === "__virgin__"
                ? (t ? t("pf_virgin") : "Vierges (jamais fumées)")
                : (xl ? xl(pFamilyFilter, CATS_EN) : pFamilyFilter)}
              onClear={() => setPFamilyFilter("")}
              accent={C.oxbloodHi} accentBase={C.oxblood} />}
            {pTagFilter && <ActiveFilterPill label={"# " + pTagFilter}
              onClear={() => setPTagFilter && setPTagFilter("")}
              accent={C.steelHi} accentBase={C.steel} />}
          </div>
        )}
        {/* User tag / collection filter chip row (pipes).
            Folded behind "Plus de filtres" — the dot on the toggle
            keeps an ACTIVE tag filter visible while the row is hidden. */}
        {pAdvFiltersOpen && pipeTagList.length > 0 && (
          <div style={{ padding: "0 12px 12px" }}>
            <ScrollableChipRow>
              {pipeTagList.map((tg) => (
                <FilterChipSimple key={tg} label={"# " + tg}
                  on={String(pTagFilter || "").toLowerCase() === String(tg).toLowerCase()}
                  onClick={() => setPTagFilter && setPTagFilter(String(pTagFilter || "").toLowerCase() === String(tg).toLowerCase() ? "" : tg)}
                  accent={C.steelHi} />
              ))}
            </ScrollableChipRow>
          </div>
        )}

        {/* Brand + rating filter dropdowns. Brands derive
            from data.pipes — only brands the user actually owns appear.
            Rating goes 0 (no filter) → 5★. Both compose with each
            other and with the existing shape / filter-type / "include
            retired" filters (AND semantics in App.tsx filteredPipes). */}
        {allPipes.length > 0 && (() => {
          // The four filters (shape · brand · family · rating) live
          // on ONE horizontally-scrollable row (ScrollableChipRow) instead of a
          // 2×2 grid. Native selects can't shrink onto one line at large text,
          // so each control keeps a fixed width sized to its resting dimension
          // label (Forme / Marque / Famille / Note) and the row scrolls with the
          // shared chevron cue. A selected value that overflows its select is
          // truncated — the full value is always shown in the ActiveFilterPill
          // row just above, so nothing is lost.
          const selStyle = (ring: { focused: boolean }, w: number) => ({
            width: w, minWidth: 0,
            // The select STRETCHES to the wrapper's full height, and
            // the wrapper's vertical padding moved onto it. The control looked
            // 36 px tall and only its middle 18 px opened the list — measured,
            // and a tap on the wrapper's padding hit the <div>, which has no
            // handler, so half of what reads as a control did nothing.
            alignSelf: "stretch" as const,
            background: "transparent", color: C.ivory,
            border: "none", outline: "none",
            fontFamily: F.body, fontSize: fs(14.5), appearance: "none" as const,
            borderRadius: 4, transition: "box-shadow 200ms",
            ...(ring.focused ? { boxShadow: `0 0 0 2px ${alpha(C.oxbloodHi, "88")}` } : {}),
          });
          const wrapStyle = {
            flex: "0 0 auto" as const,
            display: "flex", alignItems: "center", gap: 6,
            // 44 is this project's own target-size invariant
            // (IconBtn defaults to it). The vertical padding is gone — the
            // select now provides the height itself, so the whole box is live.
            minHeight: 44,
            padding: "0 10px",
            background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
          };
          const hasFamily = pFamilyOptions.length > 0 || hasVirginPipes;
          const shapeCtl = pipeShapeGroups.length > 0 ? (
            <div style={wrapStyle}>
              <Ico name="pipe" size={14} color={C.oxbloodHi} sw={1.5} />
              <select
                value={pShapeFilter || ""}
                aria-label={t ? t("aria_filter_by_shape") : "Filtrer par forme"}
                onChange={(e) => setPShapeFilter && setPShapeFilter(e.target.value)}
                onFocus={shapeRing.onFocus}
                onBlur={shapeRing.onBlur}
                style={selStyle(shapeRing, 78)}>
                <option value="">{t ? t("f_all_shapes") : "Forme"}</option>
                {pipeShapeGroups.map((g) => {
                  const fk = "shape_family_" + g.key;
                  return (
                    <optgroup key={g.key} label={t ? t(fk) : g.key}>
                      {g.shapes.map((s) => (
                        <option key={s} value={s}>{xl ? xl(s, SHAPES_EN) : s}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          ) : null;
          const brandCtl = (
            <div style={wrapStyle}>
              <Ico name="leaf" size={14} color={C.oxbloodHi} sw={1.5} />
              <select
                value={pBrandFilter || ""}
                aria-label={t ? t("aria_filter_by_brand") : "Filtrer par marque"}
                onChange={(e) => setPBrandFilter && setPBrandFilter(e.target.value)}
                onFocus={brandRing.onFocus}
                onBlur={brandRing.onBlur}
                style={selStyle(brandRing, 86)}>
                <option value="">{t ? t("f_all_brands") : "Marque"}</option>
                {pipeBrandOptions.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          );
          const familyCtl = hasFamily ? (
            <div style={wrapStyle}>
              <Ico name="flame" size={14} color={C.oxbloodHi} sw={1.5} />
              <select
                value={pFamilyFilter}
                aria-label={t ? t("aria_filter_by_family") : "Filtrer par famille fumée"}
                onChange={(e) => setPFamilyFilter(e.target.value)}
                onFocus={famRing.onFocus}
                onBlur={famRing.onBlur}
                style={selStyle(famRing, 94)}>
                <option value="">{t ? t("pf_all_families") : "Famille"}</option>
                {pFamilyOptions.map((f) => (
                  <option key={f} value={f}>{xl ? xl(f, CATS_EN) : f}</option>
                ))}
                {hasVirginPipes && <option value="__virgin__">{t ? t("pf_virgin") : "Vierges (jamais fumées)"}</option>}
              </select>
            </div>
          ) : null;
          const ratingCtl = (
            <div style={wrapStyle}>
              <span style={{ color: C.oxbloodHi, fontSize: fs(14.5), lineHeight: 1 }}>★</span>
              <select
                value={pRatingFilter || 0}
                aria-label={t ? t("aria_filter_by_rating") : "Filtrer par note"}
                onChange={(e) => setPRatingFilter && setPRatingFilter(parseInt(e.target.value, 10) || 0)}
                onFocus={ratingRing.onFocus}
                onBlur={ratingRing.onBlur}
                style={selStyle(ratingRing, 96)}>
                <option value={0}>{t ? t("f_any") : "Note"}</option>
                {[5, 4, 3, 2, 1].map(n => (
                  <option key={n} value={n}>{"★".repeat(n)}</option>
                ))}
              </select>
            </div>
          );
          return (
            <ScrollableChipRow pad="0 12px 10px" gap={8}>
              {shapeCtl}
              {brandCtl}
              {familyCtl}
              {ratingCtl}
            </ScrollableChipRow>
          );
        })()}

        {/* Toggles */}
        {/* `flexWrap` — the status chips carry a min-content floor (their labels are nowrap) and the toggles are `flex: 0 0 44px`, so in German at the "L" text size this row pushed the PAGE 20px past 360. The tobacco list met the same arithmetic and answered it with `minWidth: 0` on a wrapper this row does not have; wrapping costs a line only in the languages where it does not fit, and clips nothing. */}
        <div style={{ padding: "0 12px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Binary filter, mutually exclusive. No more "all"
              view that mixed active + retired — the user's mental model
              is either/or. Wording mirrors AccListView's chips. */}
          <FilterChipSimple on={!showFinishedPipes}
            label={t ? t("f_active_pipes") : "Actives"}
            onClick={() => setShowFinishedPipes && setShowFinishedPipes(false)} accent={C.sage} />
          <FilterChipSimple on={!!showFinishedPipes}
            label={t ? t("f_retired_pipes") : "Retirées"}
            onClick={() => setShowFinishedPipes && setShowFinishedPipes(true)} accent={C.oxbloodHi} />
          <div style={{ flex: 1 }} />
          {/* The tag / collection chips fold behind this. It lives IN
              the existing controls row on purpose — a labelled "Plus de
              filtres" button of its own would have cost a row to hide a row,
              which is not what "ça prend trop de place" asked for. Hidden
              entirely when no pipe carries a tag. */}
          {pipeTagList.length > 0 && (
            <ToggleBtn on={pAdvFiltersOpen || !!pTagFilter} icon="filter"
              onClick={() => setPAdvFiltersOpen((v) => !v)}
              ariaLabel={t ? t("tag_filter_label") : "Filtrer par collection"}
              accent={C.steelHi} accentBase={C.steel} />
          )}
          <ToggleBtn on={!!pipesGrouped} icon="more"
            onClick={() => {
              if (pipesGrouped) setPipesGrouped && setPipesGrouped(false);
              else {
                setPipesGrouped && setPipesGrouped(true);
                setCollapsedPipeGroups && setCollapsedPipeGroups({});
              }
            }}
            ariaLabel={t ? t("aria_group_by_brand") : "Grouper par marque"}
            accent={C.oxbloodHi} accentBase={C.oxblood} />
          {/* Show/hide the description on cards (mirrors the
              tobacco list's expanded-card toggle; shares the global
              expandCards state). */}
          <ToggleBtn on={!!expandCards} icon="sliders"
            onClick={() => setExpandCards && setExpandCards((v: any) => !v)}
            ariaLabel={t ? t("aria_expanded_view") : "Cartes détaillées"}
            accent={C.oxbloodHi} accentBase={C.oxblood} />
        </div>

        {/* List */}
        <div style={{ padding: "0 12px" }}>
          {pipes.length === 0 ? (
            // `pipes` is the FILTERED array, so this said « Aucune
            // pipe » to someone who owns twelve and left a shape chip on. See
            // primitives.tsx EmptyState.
            //
            // A THIRD state, because the empty state used to read the
            // retired shelf as a first run. `showFinishedPipes` is BINARY
            // ("retired ONLY", not "also retired"), and it is
            // deliberately excluded from `pipesFiltered` so a reset cannot
            // remove the rows the user just asked for — correct for the
            // RESET, and wrong when the same predicate also picks the LABEL
            // and the ACTION. Own twelve active pipes and none retired, tap
            // « Retirées », and the screen said « Aucune pipe » — false — and
            // offered an add that creates an ACTIVE pipe, invisible in the
            // view being looked at. Both halves wrong at once.
            //
            // The way forward here is the « Actives » chip, not the form.
            <EmptyState
              icon="pipe"
              accent={C.oxbloodHi}
              label={pipesFiltered
                ? (t ? t("list_no_match") : "Aucun résultat pour ces filtres")
                : showFinishedPipes
                  ? (t ? t("no_retired_pipes") : "Aucune pipe retirée")
                  : (t ? t("no_pipes") : "Aucune pipe")}
              actions={pipesFiltered
                ? [{ label: t ? t("btn_reset_filters") : "Réinitialiser les filtres", onClick: resetPipeFilters }]
                : showFinishedPipes
                  ? [{ label: t ? t("btn_see_active_pipes") : "Voir les pipes actives",
                       onClick: () => setShowFinishedPipes && setShowFinishedPipes(false) }]
                  : [{ label: t ? t("btn_add_pipe") : "Ajouter une pipe", onClick: openAddPipe }]} />
          ) : pipesGrouped ? (
            <GroupedPipeList pipes={pipes} t={t}
              collapsedPipeGroups={collapsedPipeGroups || {}}
              togglePipeGroup={togglePipeGroup}
              restMap={restMap}
              maintDueSet={maintDueSet}
              onOpen={(p) => setPipeDet && setPipeDet(p)} />
          ) : (
            pipes.map((p, i) => (
              <PipeCard key={p.id} p={p} idx={i} restDays={restMap[String(p.id)]} maintDue={maintDueSet.has(String(p.id))}
                onOpen={() => setPipeDet && setPipeDet(p)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}


function PipeCard({ p, idx, onOpen, restDays, maintDue }: {
  p: Pipe; idx: number; onOpen: () => void;
  restDays?: number | null | undefined;
  maintDue?: boolean | undefined;
}) {
  const active = p.status === "active";
  // Shared index rotation — same CARD_ACCENTS as tobaccos/accessories.
  const color = CARD_ACCENTS[idx % CARD_ACCENTS.length]!;
  const e = useEnter(100 + idx * 60, { duration: 420 });
  const { imgLocal, t, xl, expandCards } = useAppCtx();
  const photoSrc = p.imageUrl ? ((imgLocal && imgLocal[p.imageUrl]) || p.imageUrl) : null;
  const filterLbl = t ? t("lbl_filter") : "filtre";
  return (
    <PressCard onClick={onOpen} style={{
      background: CARD_BG, border: `1px solid ${C.rule}`,
      borderRadius: 8, marginBottom: 8, padding: 0, overflow: "hidden",
      boxShadow: CARD_SHADOW,
      // Removed `opacity: active ? 1 : 0.55` from the WHOLE card.
      // CORRECTED later — the original comment here asserted this was
      // live and measured ("~2.3:1 in ALL SIX theme×mode combos"). It was not:
      // `...e` (useEnter) is spread at the end of this same object literal and
      // always carries an `opacity`, so the later key won and a retired card
      // always drew at full opacity. The ratio was COMPUTED from the multiplier,
      // never rendered — and the comment's own last line ("this branch never
      // rendered" in the fixture) should have prompted the check. Removing it
      // remains correct: it is a landmine that moving the spread would arm, the
      // "RETIRÉE" pill 25 lines below already carries the signal, and no WCAG
      // 1.4.3 exemption would apply (a PressCard with onClick is active).
      // The identical inversion was found at the InventoryDetailView LotRow.
      ...e,
    }}>
      {/* CARD_ACCENTS top bar — restored (see TobaccoCard). */}
      <div style={{ height: 2, background: color, opacity: 0.65 }} />
      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
        {/* Fixed 100×110 polaroid tile + 8 px inner padding
            so the cream "frame" stays visible even when the pipe photo
            has its own dark background. */}
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
            : <Ico name="pipe" size={36} sw={1.2} />}
        </div>
        {/* `minWidth: 0` is load-bearing: a flex item defaults to
            `min-width: auto`, so this column refused to shrink below its own
            min-content and pushed its children past the card's hidden overflow.
            MEASURED at 360px in German at the "L" text size: the column wanted
            253px where the card offered 234, and the name, the spec line and
            the retired badge were each cut 5px short. Same default, same fix as
            the inventory toggles, the Stats legend and the Settings rows. */}
        <div style={{ flex: 1, minWidth: 0, padding: "12px 14px" }}>
          {/* Wraps because the badge is a single unbreakable word — German
              "AUSGEMUSTERT" alone measures 117px of the 206 this row gets — so
              shrinking is not available and the alternative to a second line is
              clipping the brand. Costs a line only where the pair does not fit. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <Lbl color={color}>{p.brand || "—"}</Lbl>
            {!active && (
              <span style={{
                display: "inline-block", padding: "2px 7px", borderRadius: 4,
                background: alpha(C.tx3, "22"), color: C.tx2,
                fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
                textTransform: "uppercase", fontWeight: 700,
              }}>{t ? t("pipe_retired_lbl") : "Retirée"}</span>
            )}
          </div>
          <div style={{
            fontFamily: F.display, fontSize: fs(20), color: C.ivory, marginTop: 3,
            letterSpacing: -0.3, lineHeight: 1.15, fontStyle: "italic",
          }}>{p.name || "—"}</div>
          <div style={{ marginTop: 6, fontSize: fs(15), color: C.tx2 }}>
            {[
              p.shape && (xl ? xl(p.shape, SHAPES_EN) : p.shape),
              p.bowlMaterial && (xl ? xl(p.bowlMaterial, BOWL_MATS_EN) : p.bowlMaterial),
              p.filterType && `${filterLbl} ${xl ? xl(p.filterType, FILTERS_EN) : p.filterType}`,
            ].filter(Boolean).join(" · ")}
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Stars n={p.rating || 0} size={11} />
            {p.datePurchased && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              {/* Year-only — render raw, no fmtDate. */}
              <Lbl color={C.tx3} size={10}>{t ? t("lbl_since") : "depuis"} {p.datePurchased}</Lbl>
            </>}
            {/* Rest indicator — sage when rested ≥ 2 d,
                amber when smoked recently. Hidden for retired pipes
                (rest is irrelevant once out of rotation) and for
                never-smoked pipes (chip renders null). */}
            {active && <PipeRestChip restDays={restDays} t={t} />}
            {/* Usage-based maintenance reminder chip. */}
            {active && maintDue && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 7px", borderRadius: 4,
                background: alpha(C.amber, "22"), color: C.amber,
                fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1,
                textTransform: "uppercase", fontWeight: 700,
              }}>⚠ {t ? t("maint_due") : "À entretenir"}</span>
            )}
          </div>
        </div>
      </div>
      {/* Expanded description/notes, toggled by expandCards. */}
      {expandCards && (p.description || p.notes) && (
        <div style={{ padding: "10px 14px 14px", borderTop: `1px dotted ${C.rule}`, background: C.bg }}>
          {p.description && (
            <div style={{ fontSize: fs(15), color: C.tx, lineHeight: 1.5, fontFamily: F.body }}>{p.description}</div>
          )}
          {p.notes && (
            <div style={{
              marginTop: p.description ? 8 : 0,
              fontSize: fs(15), color: C.tx2, lineHeight: 1.5, fontFamily: F.body, fontStyle: "italic",
            }}>{p.notes}</div>
          )}
        </div>
      )}
    </PressCard>
  );
}

function GroupedPipeList({
  pipes, t, collapsedPipeGroups, togglePipeGroup, onOpen, restMap, maintDueSet,
}: {
  pipes: Pipe[];
  t?: ((k: string) => string) | undefined;
  collapsedPipeGroups: Record<string, boolean>;
  togglePipeGroup?: (k: string) => void;
  onOpen: (p: Pipe) => void;
  restMap: Record<string, number | null>;
  maintDueSet: Set<string>;
}) {
  const noBrandLbl = t ? t("lbl_no_brand") : "Sans marque";
  const groups = useMemo(() => {
    // Object.create(null) — `p.brand` is user-controlled.
    const g: Record<string, Pipe[]> = Object.create(null);
    pipes.forEach(p => {
      const k = p.brand || noBrandLbl;
      (g[k] = g[k] || []).push(p);
    });
    return Object.keys(g).sort((a, b) => String(a).localeCompare(String(b))).map(k => ({ name: k, items: g[k] || [] }));
  }, [pipes, noBrandLbl]);
  return (
    <>
      {groups.map(({ name, items }) => {
        const collapsed = collapsedPipeGroups[name] !== false;
        return (
          <div key={name}>
            <PressCard onClick={() => togglePipeGroup && togglePipeGroup(name)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", marginBottom: 6, borderRadius: 8,
                background: C.cardHi, border: `1px solid ${C.rule}`,
              }}>
              <Lbl color={C.oxbloodHi} size={12}>{name}</Lbl>
              <span style={{ fontFamily: F.mono, fontSize: fs(14.5), color: C.tx3 }}>
                {items.length} {items.length > 1
                  ? (t ? String(t("stat_pipes_word")).toLowerCase() : "pipes")
                  : (t ? t("lbl_pipe_simple") : "pipe")}
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
                {items.map((p, i) => (
                  <PipeCard key={p.id} p={p} idx={i} restDays={restMap[String(p.id)]} maintDue={maintDueSet.has(String(p.id))}
                    onOpen={() => onOpen(p)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
