// Curator AccListView — full feature parity (group by type + retired toggle).

import { useMemo, useCallback, useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { distinctSortedBrands } from "../../utils.ts";
import { alpha, fs, C, F, CARD_ACCENTS, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  PageTitle, useEnter, EmptyState,
} from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import {
  ToggleBtn, FilterChipSimple, ActiveFilterPill, ScrollableChipRow,
} from "../../components/curator/FilterControls.tsx";
import { allTags, tobaccoHasTag } from "../../utils/tags.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { ACC_TYPES, ACC_TYPES_EN, LIGHTER_FUELS_EN } from "../../constants.ts";
import type { Accessory } from "../../types.ts";

// Null-prototype maps — a forged accessory `type` equal to a
// prototype member ("__proto__" / "constructor") would otherwise resolve to
// Object.prototype (a truthy non-string), defeating the `|| C.brass` / `||
// "more"` fallbacks and feeding garbage to the style / <Ico> props.
const TYPE_COLORS: Record<string, string> = Object.assign(Object.create(null), {
  "Briquet":        C.ember,
  "Bourre-pipe":    C.sage,
  "Porte-pipe":     C.oxbloodHi,
  "Blague à tabac": C.brassHi,
  "Autre":          C.tx2,
});
const TYPE_ICONS: Record<string, IcoName> = Object.assign(Object.create(null), {
  "Briquet":        "flame",
  "Bourre-pipe":    "sliders",
  "Porte-pipe":     "pipe",
  "Blague à tabac": "box",
  "Autre":          "more",
});

export function CuratorAccListView() {
  const ctx = useAppCtx();
  const {
    view, accDet, setAccDet, data, t, xl, nav,
    showRetiredAcc, setShowRetiredAcc, accIsActive,
    BA, setAccForm, setEditAccId,
    aBrandFilter = "", setABrandFilter,
    aTypeFilter = "", setATypeFilter,
    aTagFilter = "", setATagFilter,
    accsGrouped, setAccsGrouped,
    collapsedAccGroups, toggleAccGroup,
    expandCards, setExpandCards,
    setSearchOpen,
  } = ctx;
  const brandRing = useFocusRing();
  const typeRing = useFocusRing();
  // The tag chip row folds behind "Plus de filtres" — same as the
  // pipes list, and the tobacco list. Declared here, above the
  // `view !== "acc"` early return, per the Curator hook-order rule.
  const [aAdvFiltersOpen, setAAdvFiltersOpen] = useState(false);
  // Wrap the fallback expressions in useMemo / useCallback so
  // the useMemo below has stable deps — otherwise `accessories` and
  // `isActive` are new refs every render when ctx values are nullish,
  // forcing `visible` to re-compute on every parent re-render.
  const accessories = useMemo(
    () => (data?.accessories || []) as Accessory[],
    [data?.accessories],
  );
  // Distinct user tags across accessories (drives the tag filter row).
  const accTagList = useMemo(() => allTags(accessories), [accessories]);
  const isActive = useCallback(
    (a: Accessory) => accIsActive ? accIsActive(a) : a.status === "active",
    [accIsActive],
  );
  // Is anything narrowing the list? `showRetiredAcc` is EXCLUDED —
  // it SWITCHES which half is shown rather than narrowing, so an empty retired
  // shelf is a genuine "you have retired nothing", not a filter to reset.
  const accFiltered = !!(aBrandFilter || aTypeFilter || aTagFilter);
  // See openAddTobacco in InventoryListView. Same shape:
  // `accForm` survives a clean exit from the edit form, and `addAccessory`
  // carries `source.uid` onto the new row.
  const openAddAccessory = () => {
    if (BA && setAccForm) setAccForm(Object.assign({}, BA));
    if (setEditAccId) setEditAccId(null);
    nav && nav("addA");
  };

  const resetAccFilters = () => {
    setABrandFilter && setABrandFilter("");
    setATypeFilter && setATypeFilter("");
    setATagFilter && setATagFilter("");
  };

  const visible = useMemo(() => {
    // Binary filter — `showRetiredAcc` true means "show
    // RETIRED ONLY" (previously it meant "show all"). Mirrors the new
    // PipesListView semantics.
    let vs = accessories.filter(a => showRetiredAcc ? !isActive(a) : isActive(a));
    // Brand filter — AND-composes with the active/retired
    // toggle, mirroring PipesListView's pBrandFilter.
    if (aBrandFilter) vs = vs.filter(a => a.brand === aBrandFilter);
    // Type (genre) filter — AND-composes with brand.
    if (aTypeFilter) vs = vs.filter(a => (a.type || "Autre") === aTypeFilter);
    // The COLLECTION filter, which had never been applied here.
    // The chip lit up, the "# tag" pill appeared, and the list did not move —
    // worse than a dead control, because it claimed to have filtered. The clause
    // lived in App.tsx's `filteredAccessories` memo — which NOTHING rendered,
    // because this is the one list that filters locally (PipesListView reads
    // ctx.filteredPipes, which is why pipes worked and accessories did not).
    // That unread memo was deleted; this clause is now the only copy.
    // Found by driving all three lists in a browser; no test covered any.
    if (aTagFilter) vs = vs.filter(a => tobaccoHasTag(a, aTagFilter));
    return vs;
  }, [accessories, showRetiredAcc, isActive, aBrandFilter, aTypeFilter, aTagFilter]);

  // Brand options derive from data.accessories (NOT visible)
  // so the dropdown never shrinks as the user narrows the filter —
  // same convention as PipesListView.
  const accBrandOptions = useMemo(() => {
    return distinctSortedBrands(accessories);
  }, [accessories]);

  // Type options — the ACC_TYPES actually present in the
  // collection, kept in the canonical enum order (same "never shrink
  // under the active filter" convention as the brand options).
  const accTypeOptions = useMemo(() => {
    const present = new Set(accessories.map(a => a.type || "Autre"));
    return (ACC_TYPES as readonly string[]).filter(tp => present.has(tp));
  }, [accessories]);

  // Stale-filter auto-clear — guarded reset (no-op in steady state, so
  // the CLAUDE.md prefill-race rule is honoured).
  useEffect(() => {
    if (aBrandFilter && !accBrandOptions.includes(aBrandFilter)) {
      setABrandFilter && setABrandFilter("");
    }
  }, [aBrandFilter, accBrandOptions, setABrandFilter]);
  useEffect(() => {
    if (aTypeFilter && !accTypeOptions.includes(aTypeFilter)) {
      setATypeFilter && setATypeFilter("");
    }
  }, [aTypeFilter, accTypeOptions, setATypeFilter]);

  const byType = useMemo(() => {
    // Object.create(null) — `a.type` is user-controlled
    // and could be "toString" / "constructor" / "valueOf" via a
    // forged import. Without this guard the lookup `out[tp]` would
    // hit Object.prototype.* and corrupt the grouping silently.
    const out: Record<string, Accessory[]> = Object.create(null);
    visible.forEach(a => {
      const tp = a.type || "Autre";
      (out[tp] = out[tp] || []).push(a);
    });
    return out;
  }, [visible]);

  if (view !== "acc" || accDet) return null;

  const activeCount = accessories.filter(isActive).length;
  const retiredCount = accessories.length - activeCount;

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="flame" ariaLabel={t ? t("aria_accessories") : "Accessoires"} color={C.ember} />}
          title={t ? t("ttl_workshop") : "Atelier"}
          trailing={<>
            <CuratorTrashIndicator />
            <IconBtn icon="search" onClick={() => setSearchOpen && setSearchOpen(true)} ariaLabel={t ? t("btn_search") : "Rechercher"} />
            <IconBtn icon="plus" onClick={openAddAccessory}
              ariaLabel={t ? t("btn_add") : "Ajouter"}
              bg={C.ember} color={C.bg} border={false} glow={C.ember}
              style={{ borderRadius: 10 }} />
          </>}
        />

        <PageTitle>
          {t ? t("acc_title_prefix") : "Les"}{" "}
          <span style={{ fontStyle: "italic", color: C.ember }}>
            {t ? t("acc_title_noun") : "accessoires"}
          </span>
        </PageTitle>

        <div style={{ padding: "0 12px 14px", marginTop: -8, fontSize: fs(15), color: C.tx2 }}>
          <span style={{ fontFamily: F.mono, color: C.ember }}>
            <AnimNum value={activeCount} delay={150} />
          </span> {t ? t("acc_in_service") : "en service"} ·{" "}
          <span style={{ fontFamily: F.mono, color: C.tx3 }}>{retiredCount}</span>{" "}
          {t ? t("acc_retired_lower") : "retirés"}
        </div>

        {/* Active filter pills — type (genre) + brand. */}
        {(aTypeFilter || aBrandFilter || aTagFilter) && (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Lbl color={C.ember}>{t ? t("lbl_filter_colon") : "Filtre :"}</Lbl>
            {aTypeFilter && (
              <ActiveFilterPill label={xl ? xl(aTypeFilter, ACC_TYPES_EN) : aTypeFilter}
                onClear={() => setATypeFilter && setATypeFilter("")}
                accent={C.ember} />
            )}
            {aBrandFilter && (
              <ActiveFilterPill label={aBrandFilter}
                onClear={() => setABrandFilter && setABrandFilter("")}
                accent={C.ember} />
            )}
            {aTagFilter && (
              <ActiveFilterPill label={"# " + aTagFilter}
                onClear={() => setATagFilter && setATagFilter("")}
                accent={C.steelHi} accentBase={C.steel} />
            )}
          </div>
        )}
        {/* User tag / collection filter chip row (accessories).
            Folded behind "Plus de filtres" (see the pipes list). */}
        {aAdvFiltersOpen && accTagList.length > 0 && (
          <div style={{ padding: "0 12px 12px" }}>
            <ScrollableChipRow>
              {accTagList.map((tg) => (
                <FilterChipSimple key={tg} label={"# " + tg}
                  on={String(aTagFilter || "").toLowerCase() === String(tg).toLowerCase()}
                  onClick={() => setATagFilter && setATagFilter(String(aTagFilter || "").toLowerCase() === String(tg).toLowerCase() ? "" : tg)}
                  accent={C.steelHi} />
              ))}
            </ScrollableChipRow>
          </div>
        )}

        {/* Genre (type) + brand filter dropdowns on one row.
            Type always shows (there's always at least "Autre"); brand only
            when the collection has a branded accessory. Two flex:1 selects
            fill the width and hold on one line at any text size — the full
            selected value is echoed in the ActiveFilterPill row above. */}
        {accessories.length > 0 && (() => {
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
          const selStyle = (ring: { focused: boolean }) => ({
            flex: 1, minWidth: 0,
            // Stretch to the wrapper's full height — see the
            // wrapper below. The control looked 36 px tall and only its middle
            // 18 px opened the list.
            alignSelf: "stretch" as const,
            background: "transparent", color: C.ivory,
            border: "none", outline: "none",
            fontFamily: F.body, fontSize: fs(14.5), appearance: "none" as const,
            borderRadius: 4, transition: "box-shadow 200ms",
            ...(ring.focused ? { boxShadow: `0 0 0 2px ${alpha(C.ember, "88")}` } : {}),
          });
          return (
            <div style={{ padding: "0 12px 10px", display: "flex", gap: 8 }}>
              <div style={wrapStyle}>
                <Ico name="more" size={14} color={C.ember} sw={1.5} />
                <select
                  value={aTypeFilter || ""}
                  aria-label={t ? t("aria_filter_by_type") : "Filtrer par type"}
                  onChange={(e) => setATypeFilter && setATypeFilter(e.target.value)}
                  onFocus={typeRing.onFocus}
                  onBlur={typeRing.onBlur}
                  style={selStyle(typeRing)}>
                  <option value="">{t ? t("f_all_types") : "Type"}</option>
                  {accTypeOptions.map(tp => (
                    <option key={tp} value={tp}>{xl ? xl(tp, ACC_TYPES_EN) : tp}</option>
                  ))}
                </select>
              </div>
              {accBrandOptions.length > 0 && (
                <div style={wrapStyle}>
                  <Ico name="box" size={14} color={C.ember} sw={1.5} />
                  <select
                    value={aBrandFilter || ""}
                    aria-label={t ? t("aria_filter_by_brand") : "Filtrer par marque"}
                    onChange={(e) => setABrandFilter && setABrandFilter(e.target.value)}
                    onFocus={brandRing.onFocus}
                    onBlur={brandRing.onBlur}
                    style={selStyle(brandRing)}>
                    <option value="">{t ? t("f_all_brands") : "Marque"}</option>
                    {accBrandOptions.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })()}

        {/* Toggles */}
        {/* `flexWrap` — the status chips carry a min-content floor (their labels are nowrap) and the toggles are `flex: 0 0 44px`, so in German at the "L" text size this row pushed the PAGE 20px past 360. The tobacco list met the same arithmetic and answered it with `minWidth: 0` on a wrapper this row does not have; wrapping costs a line only in the languages where it does not fit, and clips nothing. */}
        <div style={{ padding: "0 12px 14px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Binary filter, mutually exclusive. Replaces the
              old "Active only / All" pair which mixed active + retired
              under the same chip — the user wanted a clean either/or
              with wording aligned to PipesListView. */}
          <FilterChipSimple on={!showRetiredAcc}
            label={t ? t("f_active_acc") : "Actifs"}
            onClick={() => setShowRetiredAcc && setShowRetiredAcc(false)} accent={C.sage} />
          <FilterChipSimple on={!!showRetiredAcc}
            label={t ? t("f_retired_acc") : "Retirés"}
            onClick={() => setShowRetiredAcc && setShowRetiredAcc(true)} accent={C.oxbloodHi} />
          <div style={{ flex: 1 }} />
          {/* Tag / collection disclosure, in the EXISTING controls
              row (see the pipes list for why it is not its own labelled row). */}
          {accTagList.length > 0 && (
            <ToggleBtn on={aAdvFiltersOpen || !!aTagFilter} icon="filter"
              onClick={() => setAAdvFiltersOpen((v) => !v)}
              ariaLabel={t ? t("tag_filter_label") : "Filtrer par collection"}
              accent={C.steelHi} accentBase={C.steel} />
          )}
          <ToggleBtn on={!!accsGrouped} icon="more"
            onClick={() => setAccsGrouped && setAccsGrouped((v: any) => !v)}
            ariaLabel={t ? t("aria_group_by_type") : "Grouper par type"}
            accent={C.ember} />
          {/* Show/hide notes on cards (mirrors the tobacco/pipe
              expanded-card toggle; shares the global expandCards state). */}
          <ToggleBtn on={!!expandCards} icon="sliders"
            onClick={() => setExpandCards && setExpandCards((v: any) => !v)}
            ariaLabel={t ? t("aria_expanded_view") : "Cartes détaillées"}
            accent={C.ember} />
        </div>

        {/* Cards */}
        <div style={{ padding: "0 12px" }}>
          {visible.length === 0 ? (
            // `visible` is the FILTERED array — see primitives.tsx.
            // The third state, exactly as in PipesListView —
            // `showRetiredAcc` is binary, so the retired shelf being empty is
            // not "you own no accessories" and its way forward is the
            // « Actifs » chip, not a form that creates an ACTIVE accessory
            // invisible in this view. The sub-header two rows up already read
            // « 0 retirés » while the body said « Aucun accessoire ».
            <EmptyState
              icon="flame"
              accent={C.ember}
              label={accFiltered
                ? (t ? t("list_no_match") : "Aucun résultat pour ces filtres")
                : showRetiredAcc
                  ? (t ? t("no_retired_acc") : "Aucun accessoire retiré")
                  : (t ? t("no_accessories") : "Aucun accessoire")}
              actions={accFiltered
                ? [{ label: t ? t("btn_reset_filters") : "Réinitialiser les filtres", onClick: resetAccFilters }]
                : showRetiredAcc
                  ? [{ label: t ? t("btn_see_active_acc") : "Voir les accessoires actifs",
                       onClick: () => setShowRetiredAcc && setShowRetiredAcc(false) }]
                  : [{ label: t ? t("btn_add_accessory") : "Ajouter un accessoire", onClick: openAddAccessory }]} />
          ) : accsGrouped ? (
            // Order groups by ACC_TYPES enumeration, fall back to insertion order for unknowns.
            (() => {
              const known = (ACC_TYPES as readonly string[]).filter(t => byType[t]).map(t => [t, byType[t]] as [string, Accessory[]]);
              const unknown = Object.keys(byType).filter(t => (ACC_TYPES as readonly string[]).indexOf(t) === -1)
                .map(t => [t, byType[t]] as [string, Accessory[]]);
              return known.concat(unknown);
            })().map(([type, items], si) => {
              const c = TYPE_COLORS[type] || C.brass;
              const collapsed = collapsedAccGroups?.[type] !== false;
              return (
                <div key={type}>
                  <PressCard onClick={() => toggleAccGroup && toggleAccGroup(type)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "10px 12px", marginBottom: 6, borderRadius: 8,
                      background: C.cardHi, border: `1px solid ${C.rule}`,
                    }}>
                    <span style={{ color: c, display: "inline-flex" }}>
                      <Ico name={TYPE_ICONS[type] || "more"} size={14} sw={1.7} />
                    </span>
                    <Lbl color={c} size={12}>{xl ? xl(type, ACC_TYPES_EN) : type}</Lbl>
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
                  {!collapsed && items.map((a, i) => (
                    <AccessoryCard key={a.id} a={a} icon={TYPE_ICONS[type] || "more"}
                      delay={250 + si * 100 + i * 50} idx={i}
                      onOpen={() => setAccDet && setAccDet(a)} />
                  ))}
                </div>
              );
            })
          ) : (
            visible.map((a, i) => {
              const tp = a.type || "Autre";
              return (
                <AccessoryCard key={a.id} a={a} icon={TYPE_ICONS[tp] || "more"}
                  delay={100 + i * 50} idx={i}
                  onOpen={() => setAccDet && setAccDet(a)} />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


function AccessoryCard({
  a, icon, delay, idx, onOpen,
}: { a: Accessory; icon: IcoName; delay: number; idx: number; onOpen: () => void }) {
  // Shared index rotation — same CARD_ACCENTS as tobaccos/pipes,
  // so the brand label matches the top bar (the type shape stays in `icon`).
  const color = CARD_ACCENTS[idx % CARD_ACCENTS.length]!;
  const e = useEnter(delay, { duration: 420 });
  const active = a.status === "active";
  const { imgLocal, t, xl, expandCards } = useAppCtx();
  const photoSrc = a.imageUrl ? ((imgLocal && imgLocal[a.imageUrl]) || a.imageUrl) : null;
  return (
    <PressCard onClick={onOpen} style={{
      background: CARD_BG, border: `1px solid ${C.rule}`,
      borderRadius: 8, marginBottom: 8, padding: 0, overflow: "hidden",
      boxShadow: CARD_SHADOW,
      // See the identical note in PipesListView's PipeCard — a
      // whole-card `opacity: 0.55` put this card's text at ~2.3:1 in all six
      // theme×mode combos, on an active control, next to a "RETIRÉ" pill that
      // already carries the meaning.
      ...e,
    }}>
      {/* CARD_ACCENTS top bar — restored (see TobaccoCard). */}
      <div style={{ height: 2, background: color, opacity: 0.65 }} />
      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
        {/* Fixed 100×110 polaroid tile + 8 px inner padding. */}
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
          color: color, position: "relative",
        }}>
          {photoSrc
            ? <div style={{ width: "100%", height: "100%", background: `${safeBgUrl(photoSrc)} center/contain no-repeat` }} />
            : <Ico name={icon} size={32} sw={1.3} />}
          {!active && (
            <div style={{
              position: "absolute", top: 6, right: 6,
              fontFamily: F.mono, fontSize: fs(11.5), color: C.tx2,
              letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
              background: alpha(C.bg, "cc"), padding: "2px 6px", borderRadius: 3,
            }}>{t ? t("acc_retired") : "Retiré"}</div>
          )}
        </div>
        <div style={{ flex: 1, padding: "12px 14px" }}>
          <Lbl color={color}>{a.brand || "—"}</Lbl>
          <div style={{
            fontFamily: F.display, fontSize: fs(20), color: C.ivory,
            marginTop: 3, letterSpacing: -0.3, lineHeight: 1.15, fontStyle: "italic",
          }}>{a.name || "—"}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <Stars n={a.rating || 0} size={11} />
            {a.fuel && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx3} size={10}>{xl ? xl(a.fuel, LIGHTER_FUELS_EN) : a.fuel}</Lbl>
            </>}
          </div>
        </div>
      </div>
      {/* Notes moved into an expanded block toggled by expandCards
          (was always-inline) so accessories match the tobacco/pipe pattern. */}
      {expandCards && a.notes && (
        <div style={{ padding: "10px 14px 14px", borderTop: `1px dotted ${C.rule}`, background: C.bg }}>
          <div style={{
            fontSize: fs(15), color: C.tx2, fontStyle: "italic", lineHeight: 1.5, fontFamily: F.display,
          }}>« {a.notes} »</div>
        </div>
      )}
    </PressCard>
  );
}
