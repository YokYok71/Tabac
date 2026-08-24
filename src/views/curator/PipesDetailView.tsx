// Curator PipesDetailView — single pipe fiche.

import { useState, useEffect, useRef, useMemo } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl, imgCache } from "../../utils/imgCache.ts";
import { alpha, fs, C, F, catColor, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { fmtNum, findById, fmtDate, daysSince, latestSessionMonthSeed, toggleCollapseKey, safeSellerHref, today, plural } from "../../utils.ts";
import { monthsShort } from "../../constants.ts";
import { topPairings } from "../../utils/stats.ts";
import { computePipeUsageProfile } from "../../utils/ghosting.ts";
import { Notice } from "../../components/curator/Notice.tsx";
import { TagChipRow } from "../../components/curator/TagChipRow.tsx";
import {
  Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  SectionHead, SpecRow,
} from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { PipeRestChip } from "./PipesListView.tsx";
import { pipeRestDays } from "../../utils/rotation.ts";
import { pipeSessionsSinceMaint, isPipeMaintenanceDue, PIPE_MAINT_SESSIONS_THRESHOLD } from "../../utils/pipeMaint.ts";
import {
  CATS_EN, SHAPES_EN, BENDS_EN, BOWL_MATS_EN, STEM_MATS_EN, FINISHES_EN, FILTERS_EN,
} from "../../constants.ts";
import { CuratorMaintFormModal, MaintFormData } from "./MaintFormModal.tsx";
import type { Pipe, MaintEntry } from "../../types.ts";

export function CuratorPipesDetailView() {
  const ctx = useAppCtx();
  const {
    view, pipeDet, setPipeDet, t, lang, xl, lengthUnit = "mm", weightUnit = "g", currencySymbol = "€",
    nav, setEditPipeId, setPipeForm, BP, data,
    deletePipe, addMaintenance, updateMaintenance, removeMaintenance,
    imgLocal, setLightbox, dateFormat, maintReminderThreshold, maintRemindersEnabled,
    crossOpenDetail, navToInvFiltered, navToPipesByTag,
  } = ctx;
  const [maintForm, setMaintForm] = useState<MaintFormData | null>(null);
  // Report the modal upward so the auto-update defers to its
  // unsaved input. App cannot see this state, and the SILENT data-only path
  // has no countdown to cancel — without this the reload just discards it.
  const setMaintFormOpen = ctx.setMaintFormOpen;
  // Extracted so the dep is statically checkable (it was `[!!maintForm, …]`,
  // which the hooks rule cannot verify and reported twice). Open/close only —
  // never on a keystroke inside the modal.
  const maintFormIsOpen = !!maintForm;
  useEffect(function () {
    if (setMaintFormOpen) setMaintFormOpen(maintFormIsOpen);
    return function () { if (setMaintFormOpen) setMaintFormOpen(false); };
  }, [maintFormIsOpen, setMaintFormOpen]);
  // The Carnet d'entretien is grouped by year → month, like the
  // journal. maintData.flat is the newest-first list (date desc, then id desc,
  // `Number(id)||0`-guarded so a corrupted id can't NaN the same-day order);
  // maintData.groups is the [year → month → entries] tree for the render.
  const maintData = useMemo(() => {
    const flat: MaintEntry[] = ((pipeDet?.maintenance || []) as MaintEntry[])
      .slice()
      .sort((a, b) =>
        String(b.date || "").localeCompare(String(a.date || ""))
        || ((Number(b.id) || 0) - (Number(a.id) || 0)));
    const byYear: Record<string, Record<string, MaintEntry[]>> = Object.create(null);
    flat.forEach((m) => {
      const d = String(m.date || "");
      const year = d.slice(0, 4) || "—";
      const ym = d.slice(0, 7) || "—";
      if (!byYear[year]) byYear[year] = Object.create(null);
      (byYear[year]![ym] = byYear[year]![ym] || []).push(m);
    });
    const groups = Object.keys(byYear).sort((a, b) => String(b).localeCompare(String(a))).map((year) => {
      const months = byYear[year] || {};
      return {
        year, yearKey: "y:" + year,
        months: Object.keys(months).sort((a, b) => String(b).localeCompare(String(a)))
          .map((ym) => ({ name: ym, monthKey: "m:" + ym, items: months[ym] || [] })),
        total: Object.values(months).reduce((s, arr) => s + arr.length, 0),
      };
    });
    return { flat, groups };
  }, [pipeDet]);
  // Collapse state (inverted: absent = collapsed, false = expanded). Seeded
  // once per pipe to expand the MOST RECENT entry's month — mirrors the
  // journal's latest-month default.
  const [collapsedMaint, setCollapsedMaint] = useState<Record<string, any>>({});
  const maintSeedRef = useRef<any>(null);
  useEffect(() => {
    const pid = pipeDet?.id;
    if (maintSeedRef.current === pid) return;
    maintSeedRef.current = pid;
    setCollapsedMaint(latestSessionMonthSeed(pipeDet?.maintenance || []));
  }, [pipeDet]);
  const toggleMaint = (key: string) => setCollapsedMaint((prev) => toggleCollapseKey(prev, key));
  // THE MODAL MUST NOT OUTLIVE ITS PIPE. This view is mounted unconditionally
  // by CuratorApp and self-gates with the early return below, so it never
  // unmounts and its `useState` survives: open pipe A, tap "Ajouter un
  // entretien", tap a dock tab (nav() clears `pipeDet`, the view returns
  // null), then open pipe B — and the modal is on screen again over B, still
  // holding what was typed for A. `onSave` reads the CURRENT `p.id`, so an
  // add landed on B, while an edit or delete targeted an entry id B does not
  // have and silently no-opped — with the undo toast still shown for a delete
  // that never happened. `nav()` clears `sessionDetail` for exactly this
  // reason and simply cannot see this state.
  useEffect(() => { setMaintForm(null); }, [pipeDet?.id]);
  if (view !== "pipes" || !pipeDet) return null;
  const p: Pipe = pipeDet;
  const active = p.status === "active";
  const maintLog: MaintEntry[] = maintData.flat;
  const lastMaintDays = maintLog[0]?.date ? daysSince(maintLog[0].date) : null;
  // Usage-based maintenance reminder — sessions smoked since the
  // last cleaning. Due (warn) once it crosses the threshold.
  //
  // The DUE decision goes through `isPipeMaintenanceDue`, which is the rule the
  // Home section and the pipe-card chips already read; this view carried its
  // own copy (`sessionsSince >= threshold`), so the helper had no production
  // consumer at all and read as dead code. Two implementations of one rule is
  // what this repo keeps paying for — and the count itself was unified one
  // release earlier for exactly that reason, leaving this last comparison
  // behind.
  //
  // `maintInfo` stays: the Notice below states HOW MANY sessions, which a
  // boolean cannot answer. That does mean one extra pass over the sessions on
  // this screen, and the cost is stated rather than waved past — MEASURED on
  // one machine, the pass is 1.96 ms at 5000 sessions and 0.4 ms at 1000, so
  // this fiche goes from one pass to two. Accepted because it is ONE screen
  // showing ONE pipe: the same shape inside the collection loop cost 62.7 ms
  // (30 pipes × 5000) and recomputed on every data write, which is why that
  // one takes a precomputed index and this one does not.
  //
  // `active` is kept AHEAD of the call rather than delegated to the helper's
  // own status guard: the helper excludes `finished`, this view requires
  // `active`, and those differ for any third status value. Short-circuiting
  // also skips the extra pass entirely on a retired pipe.
  const maintInfo = pipeSessionsSinceMaint(p, data?.sessions, today());
  const maintThreshold = (typeof maintReminderThreshold === "number" && maintReminderThreshold >= 1) ? maintReminderThreshold : PIPE_MAINT_SESSIONS_THRESHOLD;
  const maintDue = maintRemindersEnabled !== false && active
    && isPipeMaintenanceDue(p, data?.sessions, maintThreshold, today());
  // Top tabacs smoked with this pipe.
  const topTobaccos = topPairings(
    data?.sessions, "pipeId", p.id, "tobaccoId",
    (id) => findById(data?.tobaccos as any[], id),
  ).map((x) => ({ tob: x.entity, n: x.n }));
  // The pipe's usage profile — which tobacco families it has
  // smoked, and whether it's dedicated to a ghosting-prone one.
  const usage = computePipeUsageProfile(p.id, data?.sessions, data?.tobaccos);
  const tr = (v: string | undefined, map: Record<string, string>) => v ? (xl ? xl(v, map) : v) : "";

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="back" onClick={() => setPipeDet(null)} ariaLabel={t ? t("nav_back") : "Retour"} />}
          title={t ? t("ttl_pipe_fiche") : "Fiche pipe"}
          trailing={<>
            <CuratorTrashIndicator />
            <IconBtn icon="edit" ariaLabel={t ? t("btn_edit") : "Modifier"}
              onClick={() => {
                if (setPipeForm && BP && setEditPipeId && nav) {
                  setPipeForm(Object.assign({}, BP, p));
                  setEditPipeId(p.id);
                  nav("editP");
                }
              }} />
            <IconBtn icon="trash" color={C.oxbloodHi}
              ariaLabel={t ? t("btn_delete") : "Supprimer"}
              onClick={() => { deletePipe && deletePipe(p.id); }} />
          </>}
        />

        {/* Hero */}
        <div style={{ padding: "8px 16px 22px" }}>
          <Lbl color={C.oxbloodHi}>{p.brand || "—"}</Lbl>
          {/* The fiche's `<h1>`. This is the largest
              text on the screen and the thing the page is ABOUT, and it
              was a bare `<div>`, so the fiche jumped straight to the
              `<h2>` section heads with no h1 above them — a screen-reader
              user got the sections and never the subject. `fontWeight`
              and `margin` are pinned so the browser's own h1 defaults
              cannot move the layout, exactly as `PageTitle` does. */}
          <h1 style={{
            fontFamily: F.display, fontSize: fs(40), lineHeight: 1.05, color: C.ivory,
            letterSpacing: -0.8, fontWeight: 400, margin: "8px 0 0",
          }}>
            <span style={{ fontStyle: "italic" }}>{p.name || "—"}</span>
          </h1>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <Stars n={p.rating || 0} size={14} sequenced />
            <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
            <Lbl color={C.tx2}>{tr(p.shape, SHAPES_EN) || "—"}</Lbl>
            <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
            <span style={{
              padding: "2px 7px", borderRadius: 4,
              background: active ? alpha(C.sage, "22") : alpha(C.tx3, "22"),
              color: active ? C.sage : C.tx3,
              fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
              textTransform: "uppercase", fontWeight: 700,
            }}>{active ? (t ? t("pipe_active_lbl") : "Active") : (t ? t("pipe_retired_lbl") : "Retirée")}</span>
            {/* Rest indicator (days since last session). */}
            {active && <PipeRestChip restDays={pipeRestDays(p.id, data?.sessions || [])} t={t} />}
          </div>
        </div>

        {/* Big imagery slot */}
        {/* Was a bare `<div onClick>` — no role, no tabIndex, no key
        handler. The small extra-photo thumbnails one scroll below are real
        <button>s, so a keyboard / switch user could open EVERY small photo
        but not the big main one, and a screen reader was never told the hero
        image was actionable. PressCard supplies role="button", tabIndex,
        Enter/Space, the focus ring and the iOS reliable-tap path in one
        wrapper. jest-axe has no rule for div[onClick], which is how three of
        these survived a hand a11y audit. */}
        <PressCard
          onClick={p.imageUrl ? () => setLightbox && setLightbox(p.imageUrl) : undefined}
          ariaLabel={t ? t("lbl_image") : "Image"}
          style={{
            margin: "0 12px 18px", height: 220,
            background: p.imageUrl
              ? `${safeBgUrl((imgLocal && imgLocal[p.imageUrl]) || p.imageUrl)} center/contain no-repeat`
              : `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
            // No frame around an actual photo. The heroes were given `contain`
            // and the borders were stripped from the LIST
            // cards — the fiches kept theirs, which is the frame reported here.
            // With `contain`, a wide pipe fills maybe a third of the box height,
            // so the border closes a mostly-empty rectangle in a colour distinct
            // from the page. The empty-slot placeholder KEEPS its border: that
            // is a UI slot, not a photo.
            ...(p.imageUrl ? {} : { border: `1px solid ${C.rule}` }),
            borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.oxbloodHi, position: "relative", overflow: "hidden",
            cursor: p.imageUrl ? "pointer" : "default",
          }}>
          {!p.imageUrl && <Ico name="pipe" size={80} sw={1.1} />}
        </PressCard>

        {/* Additional photos gallery (loaded on demand). */}
        {Array.isArray(p.photos) && p.photos.length > 0 && (
          <PipeDetailGallery photos={p.photos} onOpen={(k: string) => setLightbox && setLightbox(k)} t={t} />
        )}

        {/* Specs */}
        <SectionHead title={t ? t("sec_specs") : "Caractéristiques"} sub={t ? t("lbl_details") : "détails"} accent={C.oxbloodHi} />
        <div style={{ padding: "0 12px 18px" }}>
          <div style={{
            background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
            boxShadow: CARD_SHADOW,
            padding: "10px 14px",
          }}>
            <SpecRow label={t ? t("lbl_shape") : "Forme"} value={tr(p.shape, SHAPES_EN)} />
            <SpecRow label={t ? t("lbl_bend") : "Courbure"} value={tr(p.courbure, BENDS_EN)} />
            <SpecRow label={t ? t("lbl_bowl_short") : "Foyer"} value={tr(p.bowlMaterial, BOWL_MATS_EN)} />
            <SpecRow label={t ? t("lbl_finish") : "Finition"} value={tr(p.finish, FINISHES_EN)} />
            <SpecRow label={t ? t("lbl_stem_short") : "Tuyau"} value={tr(p.stemMaterial, STEM_MATS_EN)} />
            <SpecRow label={t ? t("lbl_filter_kind") : "Filtre"} value={tr(p.filterType, FILTERS_EN)} />
            <SpecRow label={t ? t("lbl_length") : "Longueur"} value={p.length ? `${fmtNum(p.length, lang)} ${lengthUnit}` : ""} />
            <SpecRow label={t ? t("lbl_weight_simple") : "Poids"} value={p.weight ? `${fmtNum(p.weight, lang)} ${weightUnit}` : ""} />
            <SpecRow label={t ? t("lbl_chamber_short") : "Diam. foyer"} value={p.chamberDiameter ? `${fmtNum(p.chamberDiameter, lang)} mm` : ""} />
            <SpecRow label={t ? t("lbl_chamber_depth_short") : "Prof. foyer"} value={p.chamberDepth ? `${fmtNum(p.chamberDepth, lang)} mm` : ""} last />
          </div>
        </div>

        {/* Acquisition */}
        {(p.datePurchased || p.price || p.seller) && (
          <>
            <SectionHead title={t ? t("sec_acquisition") : "Acquisition"} accent={C.sage} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                boxShadow: CARD_SHADOW,
                padding: "10px 14px",
              }}>
                {/* Pipe dates stored as year-only (`YYYY`).
                    Render the raw value — no fmtDate, no dateFormat. */}
                <SpecRow label={t ? t("lbl_purchased_pipe") : "Achetée en"} value={p.datePurchased || ""} />
                <SpecRow label={t ? t("lbl_production") : "Production"} value={p.dateProduction || ""} />
                <SpecRow label={t ? t("lbl_price_lbl") : "Prix"} value={p.price ? `${fmtNum(p.price, lang)} ${currencySymbol}` : ""} />
                {(() => {
                  const sHref = safeSellerHref(p.sellerUrl);
                  const sVal = p.seller || (sHref ? new URL(sHref).host : "");
                  return <SpecRow label={t ? t("lbl_seller") : "Vendeur"} value={sVal} {...(sHref ? { href: sHref } : {})} last />;
                })()}
              </div>
            </div>
          </>
        )}

        {/* Description and notes are two distinct fields
            (description = public info about the pipe model; notes =
            personal observations about THIS pipe). They used to
            share a single `« {p.notes || p.description} »` block via
            `||` fallback — so if the user filled BOTH, the description
            was silently hidden. Now each renders in its own labelled
            block. The description uses the same "Détails" pattern as
            the tobacco fiche; the notes keep the italic-callout block. */}
        {p.description && (
          <>
            <SectionHead title={t ? t("lbl_desc") : "Description"} accent={C.brassDim} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                boxShadow: CARD_SHADOW,
                padding: "12px 16px",
                fontSize: fs(15), color: C.cream, lineHeight: 1.5, whiteSpace: "pre-wrap",
              }}>{p.description}</div>
            </div>
          </>
        )}
        {p.notes && (
          <div style={{
            margin: "0 12px 18px", padding: "14px 18px",
            background: CARD_BG, border: `1px dotted ${C.rule2}`, borderRadius: 8,
            position: "relative",
          }}>
            <div style={{ position: "absolute", top: -8, left: 14, padding: "0 6px", background: C.bg }}>
              <Lbl color={C.brassHi}>{t ? t("lbl_notes") : "Notes"}</Lbl>
            </div>
            <div style={{
              fontFamily: F.display, fontStyle: "italic", fontSize: fs(17),
              color: C.cream, lineHeight: 1.55, marginTop: 4,
            }}>« {p.notes} »</div>
          </div>
        )}

        {/* User tags / collections — tap a chip to filter the pipe
            list by that collection (back returns to this fiche). */}
        {/* The item's own collections, folded behind the label —
            shared component, was a byte-identical copy in all three fiches. */}
        <TagChipRow tags={(p as any).tags} onOpen={(tg) => navToPipesByTag && navToPipesByTag(tg)} t={t} />

        {/* Families smoked in this pipe + ghosting dedication note.
            Ghosting is a property of the PIPE (its history), so the profile
            lives here permanently — the session-time warning is just the
            point-of-action echo of the same data. */}
        {usage.total > 0 && (
          <>
            <SectionHead title={t ? t("sec_pipe_families") : "Familles fumées"} accent={C.ember} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                boxShadow: CARD_SHADOW,
                padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9,
              }}>
                {usage.families.map((fam) => {
                  const pct = Math.round((fam.count / usage.total) * 100);
                  const col = catColor ? catColor(fam.category) : C.brass;
                  return (
                    // Tapping a family opens the tobacco inventory
                    // filtered to that category. navToInvFiltered now
                    // records the open pipe fiche as the back-origin AND clears
                    // pipeDet/detail/accDet itself, so system-back returns to the
                    // fiche and the list lands scrolled to the top.
                    <PressCard key={fam.category}
                      onClick={() => { if (navToInvFiltered) navToInvFiltered(fam.category, null); }}
                      style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 96, flexShrink: 0, fontSize: fs(14.5), color: C.tx, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {xl ? xl(fam.category, CATS_EN) : fam.category}
                      </div>
                      <div style={{ flex: 1, height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: pct + "%", height: "100%", background: col, borderRadius: 4 }} />
                      </div>
                      <div style={{ fontFamily: F.mono, fontSize: fs(13.5), color: C.tx2, width: 58, textAlign: "right" }}>
                        {fam.count}× · {pct}%
                      </div>
                      <Ico name="chevron" size={14} sw={2} />
                    </PressCard>
                  );
                })}
              </div>
              {usage.ghosted && usage.dominant && (
                <Notice tone="warn" style={{ marginTop: 10 }}>
                  {String(t ? t("pipe_dedicated_note") : "👻 Pipe plutôt dédiée au {family} — y fumer un autre profil risque le ghosting (mélange des goûts).")
                    .replace("{family}", xl ? xl(usage.dominant, CATS_EN) : usage.dominant)}
                </Notice>
              )}
            </div>
          </>
        )}

        {/* Top tabacs paired with this pipe */}
        {topTobaccos.length > 0 && (
          <>
            <SectionHead title={t ? t("pairing_top_tobaccos") : "Top tabacs fumés ici"} accent={C.brass} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                overflow: "hidden", boxShadow: CARD_SHADOW,
              }}>
                {topTobaccos.map((row, i) => {
                  const photo = row.tob.imageUrl ? ((imgLocal && imgLocal[row.tob.imageUrl]) || row.tob.imageUrl) : null;
                  return (
                    // Tapping a paired tabac opens its fiche (was an
                    // inert div — mirror of the tobacco-detail top-pipes fix).
                    // Cross-open records this pipe fiche on the back
                    // stack so back returns here, not the tobacco list.
                    <PressCard key={row.tob.id}
                      onClick={() => { if (crossOpenDetail) crossOpenDetail({ view: "inv", kind: "tobacco", obj: row.tob }); }}
                      style={{
                        padding: "10px 14px",
                        display: "flex", alignItems: "center", gap: 12,
                        borderBottom: i < topTobaccos.length - 1 ? `1px solid ${C.rule}` : "none",
                      }}>
                      {photo ? (
                        <div style={{
                          width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                          background: `${safeBgUrl(photo)} center/cover no-repeat, ${C.bg}`,
                          border: `1px solid ${C.rule}`,
                        }} />
                      ) : (
                        <div style={{
                          width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                          background: C.bg, border: `1px solid ${C.rule}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: C.brass,
                        }}>
                          <Ico name="leaf" size={16} sw={1.4} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: fs(14.5), color: C.tx2 }}>{row.tob.brand || "—"}</div>
                        <div style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, fontSize: fs(16) }}>
                          {row.tob.name || "—"}
                        </div>
                      </div>
                      <div style={{
                        fontFamily: F.mono, fontSize: fs(13.5), color: C.brassHi,
                        background: alpha(C.brass, "22"), padding: "3px 8px", borderRadius: 4,
                      }}>{row.n}×</div>
                      <Ico name="chevron" size={16} sw={2} />
                    </PressCard>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Carnet d'entretien — dated care log for this pipe.
            Tap a row to edit, "Ajouter" to log a new action. */}
        <SectionHead title={t ? t("sec_maintenance") : "Carnet d'entretien"}
          sub={lastMaintDays != null
            ? (t ? String(t("maint_last")).replace("{n}", String(lastMaintDays)) : `dernier il y a ${lastMaintDays} j`)
            : (t ? t("maint_none") : "aucun entretien")}
          accent={C.sage} />
        <div style={{ padding: "0 12px 18px" }}>
          {maintDue && (
            <div style={{ marginBottom: 10 }}>
              <Notice tone="warn" icon="clock">
                {String(maintInfo.everMaintained
                  ? (t ? t("maint_since") : "{n} {s} depuis l'entretien")
                  : (t ? t("maint_never") : "{n} {s}, jamais nettoyée")
                ).replace("{n}", String(maintInfo.sessionsSince))
                 .replace("{s}", plural(maintInfo.sessionsSince,
                   t ? t("lbl_session_word") : "séance",
                   t ? t("lbl_sessions_word") : "séances", lang))}
              </Notice>
            </div>
          )}
          {maintLog.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {maintData.groups.map((yr) => {
                const yrCollapsed = collapsedMaint?.[yr.yearKey] !== false;
                const monthLabel = (ym: string) => {
                  const parts = String(ym).split("-");
                  const mi = parseInt(parts[1] || "0", 10);
                  const names = monthsShort(lang);
                  return (mi >= 1 && mi <= 12) ? names[mi - 1] : ym;
                };
                return (
                  <div key={yr.year} style={{ marginBottom: 8 }}>
                    <PressCard onClick={() => toggleMaint(yr.yearKey)} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", marginBottom: 6, borderRadius: 8,
                      background: C.cardHi, border: `1px solid ${alpha(C.brass, "33")}`,
                    }}>
                      <span style={{ fontFamily: F.display, fontSize: fs(22), color: C.brass, fontStyle: "italic", letterSpacing: -0.3 }}>{yr.year}</span>
                      <span style={{ fontFamily: F.mono, fontSize: fs(13.5), color: C.tx3 }}>{yr.total}</span>
                      <span style={{ marginLeft: "auto", transition: "transform 200ms", transform: yrCollapsed ? "rotate(0deg)" : "rotate(90deg)", color: C.tx3 }}>
                        <Ico name="chevron" size={14} sw={1.7} />
                      </span>
                    </PressCard>
                    {!yrCollapsed && yr.months.map((g) => {
                      const collapsed = collapsedMaint?.[g.monthKey] !== false;
                      return (
                        <div key={g.monthKey} style={{ marginLeft: 12 }}>
                          <PressCard onClick={() => toggleMaint(g.monthKey)} style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 12px", marginBottom: 6, borderRadius: 8,
                            background: CARD_BG, border: `1px solid ${C.rule}`,
                          }}>
                            <Lbl color={C.brassHi} size={12}>{monthLabel(g.name)}</Lbl>
                            <span style={{ fontFamily: F.mono, fontSize: fs(13.5), color: C.tx3 }}>{g.items.length}</span>
                            <span style={{ marginLeft: "auto", transition: "transform 200ms", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", color: C.tx3 }}>
                              <Ico name="chevron" size={14} sw={1.7} />
                            </span>
                          </PressCard>
                          {!collapsed && (
                            <div style={{ background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
                              {g.items.map((m, i) => (
                                <button key={m.id} type="button"
                                  onClick={() => setMaintForm({ pipe: p, entry: m })}
                                  style={{
                                    width: "100%", textAlign: "left", background: "transparent",
                                    border: "none", cursor: "pointer",
                                    padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 12,
                                    borderBottom: i < g.items.length - 1 ? `1px solid ${C.rule}` : "none",
                                  }}>
                                  <div style={{ flexShrink: 0, minWidth: 66, whiteSpace: "nowrap", fontFamily: F.mono, fontSize: fs(13), color: C.tx2, paddingTop: 2 }}>
                                    {m.date ? fmtDate(m.date, dateFormat) : "—"}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {/* Kind badge alone on the first line;
                                        task pills wrap onto their own line below. */}
                                    {(() => {
                                      const mk = m.kind || "light";
                                      const kc = mk === "full" ? C.brass : mk === "none" ? C.tx3 : C.sage;
                                      const kindKey = "maint_kind_" + mk;
                                      return (
                                        <span style={{
                                          display: "inline-block", fontFamily: F.mono, fontSize: fs(11),
                                          letterSpacing: 1, textTransform: "uppercase", fontWeight: 700,
                                          color: kc, background: alpha(kc, "22"), padding: "2px 6px", borderRadius: 3,
                                        }}>{t ? t(kindKey) : mk}</span>
                                      );
                                    })()}
                                    {(m.tasks || []).length > 0 && (
                                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                                        {(m.tasks || []).map((tk: string) => {
                                          const taskKey = "maint_task_" + tk;
                                          return (
                                            <span key={tk} style={{
                                              display: "inline-block", fontFamily: F.body, fontSize: fs(12.5),
                                              fontWeight: 500, color: C.tx2, background: C.bg,
                                              border: `1px solid ${C.rule}`, padding: "1px 7px", borderRadius: 10,
                                            }}>{t ? t(taskKey) : tk}</span>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {m.notes && (
                                      <div style={{ marginTop: 5, fontSize: fs(14.5), color: C.tx, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{m.notes}</div>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          <PressCard onClick={() => setMaintForm({ pipe: p })} style={{
            padding: "12px 14px", borderRadius: 8,
            background: CARD_BG, border: `1px dashed ${C.rule2}`, color: C.sage,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
          }}>
            <Ico name="plus" size={16} sw={2} /> {t ? t("maint_add") : "Ajouter un entretien"}
          </PressCard>
        </div>

        {/* Status toggle PressCard removed from the
            read-only detail view. Retiring (or reactivating) a pipe is
            now exclusively a write action that lives in the edit form
            (PipeFormView's status SegmentedField). The detail keeps the
            current status visible via the badge next to the title; the
            user opens Edit to flip it. */}

        {/* The "Démarrer une dégustation" CTA was removed from the
            pipe fiche per user request — it lives on the Home + the Journal
            (session) page only now. */}
      </div>

      <CuratorMaintFormModal
        open={!!maintForm}
        data={maintForm}
        onClose={() => setMaintForm(null)}
        onSave={(entry) => {
          if (!maintForm) return;
          if (maintForm.entry) updateMaintenance && updateMaintenance(p.id, maintForm.entry.id, entry);
          else addMaintenance && addMaintenance(p.id, entry);
          setMaintForm(null);
        }}
        onDelete={maintForm?.entry ? () => {
          if (maintForm?.entry) removeMaintenance && removeMaintenance(p.id, maintForm.entry.id);
          setMaintForm(null);
        } : undefined}
      />
    </div>
  );
}


// Pipe additional-photos gallery. Resolves the local-photo keys
// from IndexedDB ON DEMAND (only when a fiche is open), so a large collection
// never balloons the global imgLocal. Tap a thumbnail → lightbox.
// `t` threaded in for the thumbnail aria-label, which was the
// hardcoded "Photo" — es/de/it screen-reader users heard the wrong word while
// `lbl_image` existed in all five dictionaries.
function PipeDetailGallery({ photos, onOpen, t }: { photos: string[]; onOpen: (k: string) => void; t?: ((k: string) => string) | undefined }) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const missing = photos.filter((k) => k && k.indexOf("local-photo-") === 0 && !previews[k]);
    if (!missing.length) return;
    Promise.all(missing.map((k) => imgCache.get(k).then((v) => ({ k, v })).catch(() => ({ k, v: null as any }))))
      .then((res) => {
        if (!alive) return;
        const upd: Record<string, string> = {};
        res.forEach((r) => { if (r.v) upd[r.k] = r.v; });
        if (Object.keys(upd).length) setPreviews((p) => Object.assign({}, p, upd));
      });
    return () => { alive = false; };
  }, [photos, previews]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 12px 18px" }}>
      {photos.map((k) => (
        <button key={k} type="button" onClick={() => onOpen(k)} aria-label={t ? t("lbl_image") : "Image"}
          style={{
            width: 76, height: 76, borderRadius: 8, padding: 0, cursor: "pointer",
            border: `1px solid ${C.rule2}`, overflow: "hidden",
            background: `${safeBgUrl(previews[k] || "")} center/cover no-repeat, ${C.bg2}`,
          }} />
      ))}
    </div>
  );
}
