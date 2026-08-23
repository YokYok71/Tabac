// Curator InventoryDetailView — single tobacco fiche with lots, profile,
// notes, tags. (The "Démarrer une dégustation" CTA was removed —
// it lives on the Home + Journal only now.)
// Lot taps + "Ajouter un lot" both open the CuratorLotFormModal.

import { useState, useEffect } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { lotAge, fmtDate, fmtNum, fmtLotWeight, fmtLotAge, plural, findById, effectiveAgingMax, safeSellerHref, nextBoxNumber, today, daysSince, sessionsForLot } from "../../utils.ts";
import { MaturityChip } from "../../components/curator/MaturityChip.tsx";
import { TagChipRow } from "../../components/curator/TagChipRow.tsx";
import { makeLotDuplicate, isUsableLot } from "../../utils/lotUtils.ts";
import { scopeFromStatusFilter, scopedHeldWeight, scopedOldestAgeDays, scopeLabelKey, lotInScope, lotMaturityBucket } from "../../utils/cellarInsights.ts";
import { topPairings, computeAromaProfile } from "../../utils/stats.ts";
import { aromaLabelKey } from "../../utils/aromas.ts";
import { alpha, fs, C, F, catColor, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { CATS_EN, CUTS_EN } from "../../constants.ts";
import {
  AnimNum, Stars, Lbl, IconBtn, PressCard, ScreenWash, TopBar,
  SectionHead, GrowBarH, StatTile, useEnter,
} from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { CuratorLotFormModal, LotFormData } from "./LotFormModal.tsx";
import type { Tobacco, Lot } from "../../types.ts";

// Audit: humanized lot-age label (`Nj` / `Nmo` / `Ny Nm`), hoisted
// to module scope from two byte-identical in-component copies (LotRow +
// LotDetailModal). Takes `t` so it stays outside the component closure.

export function CuratorInventoryDetailView() {
  const ctx = useAppCtx();
  const {
    view, detail, setDetail, t, xl, lang, dateFormat, ageLabel,
    nav, setEditId, setForm, BT,
    addLotToTobacco, updateLotInTobacco, removeLot, changeLotStatus,
    weightUnit = "g", currencySymbol = "€", data,
    lotAgingStatus, setLightbox, imgLocal,
    deleteTobacco, statusFilter, crossOpenDetail, crossOpenSession, navToInvByTag,
  } = ctx;
  const [lotForm, setLotForm] = useState<LotFormData | null>(null);
  // Read-only detail modal — tapping a lot row opens this
  // first. The Edit button inside switches to `lotForm` (write mode).
  const [lotDetail, setLotDetail] = useState<LotFormData | null>(null);
  // Report the lot form upward so the auto-update defers to its unsaved
  // weight / price / date input. App cannot see this state — and note it
  // SHADOWS `ctx.lotForm`, which comes from `useTobaccoStore`, is seeded from
  // the populated `BL` template and is never falsy. The deferral clause read
  // that one, so it was permanently true and meant "a tobacco fiche is open":
  // every update was blocked from a fiche, and Settings named a modal that
  // was not there. Same shape as PipesDetailView's `setMaintFormOpen`.
  const setLotFormOpen = ctx.setLotFormOpen;
  // Extracted rather than written `[!!lotForm, …]` inline: the dep must be
  // statically checkable, and the effect must fire on OPEN/CLOSE only — never
  // on a keystroke inside the modal.
  const lotFormIsOpen = !!lotForm;
  useEffect(function () {
    if (setLotFormOpen) setLotFormOpen(lotFormIsOpen);
    // MUST clear on unmount, or leaving the fiche with the modal open leaves
    // the flag armed for the rest of the session, invisibly.
    return function () { if (setLotFormOpen) setLotFormOpen(false); };
  }, [lotFormIsOpen, setLotFormOpen]);
  const [showFinishedLots, setShowFinishedLots] = useState(false);
  // The fiche ALREADY hid non-matching lots when the list was
  // filtered (jar / cellar / finished) while its total weight counted every
  // lot — the screen contradicted itself. The weight is now scoped the same
  // way, the maturity bands are honoured too, and this local override lets the
  // user see the whole tobacco without touching the global list filter (so
  // going back keeps their filter).
  const [lotScopeOff, setLotScopeOff] = useState(false);

  if (view !== "inv" || !detail) return null;
  const tob: Tobacco = detail;
  const color = catColor(tob.category);
  // The lot slice this fiche is showing, if any (null = the whole tobacco).
  const lotScope = lotScopeOff ? null : scopeFromStatusFilter(statusFilter);
  const totalW = scopedHeldWeight(tob, lotScope);
  // ONE predicate for every aggregate this fiche displays: the scoped slice,
  // or every LIVE active lot when unscoped. Never soft-deleted, never finished
  // (they hold no stock). The "Plus ancien" age used to come from
  // oldestAge(tob) — every active lot — so a fiche filtered to "En pot" could
  // report the age of a CELLAR lot. Anything the fiche says while a scope is
  // active must be about the lots in that scope, nothing else.
  // The SHARED predicate, not a local copy. The copy had to be kept
  // in step with every new scope by hand — and it silently wasn't: a "recent"
  // scope fell through to its maturity branch and matched nothing, so the
  // fiche would have listed zero lots.
  const inScope = (l: any) => lotInScope(l, lotScope, effectiveAgingMax(tob));
  // scope-ok: this IS the scope route — every hero figure derives from it.
  const scopedLots = (tob.lots || []).filter(inScope);
  const heroLotCount = scopedLots.length;
  // "actif" (a un lot non-fini) ≠ "fumable en séance". Surface
  // a hint that reconciles the two by COMMUNICATION — no change to the
  // active/inactive predicate.
  // The CASE this hint covers has changed, so its wording had
  // to. It was written for the freshly-created tabac whose starter lot has
  // no weight at all — but an UNWEIGHED lot was settled to be an
  // absence of data, not an empty tin, so such a tabac IS offered in both
  // session pickers and the hint about it was simply false. What remains is
  // the opposite state: every active lot carries an explicit weight of ZERO
  // (typed by hand, or a finished lot reopened at 0), which the pickers do
  // refuse. `lot_no_weight_hint` now names that state in all six languages —
  // "renseigne le poids" was wrong for it, the weight IS filled in.
  // Scoped like every other figure — under "En pot" the hint must
  // be about the jar lots, not about a cellar lot the user filtered out.
  const _liveLots = scopedLots;
  const _hasActiveLot = _liveLots.length > 0;
  // This was a LOCAL COPY of the usable-lot predicate, and
  // the shared one changed without it. Consequence: the fiche went
  // on showing « renseigne le poids d'un lot pour pouvoir utiliser ce tabac
  // dans une séance » about a tobacco the session picker was already
  // offering — a hint that had become false. The copied-predicate failure
  // this repo keeps paying for; it reads the shared one now.
  const _hasUsableLot = _liveLots.some(isUsableLot);
  const activeButUnusable = _hasActiveLot && !_hasUsableLot;
  // Oldest lot age (in days) across all lots — for the hero info block.
  // The IN-SCOPE oldest lot, through the shared helper (it was
  // oldestAge(tob), which spans every active lot AND counts soft-deleted ones).
  const oldestDays = scopedOldestAgeDays(tob, lotScope);
  // Lot list filtered per statusFilter and finished toggle.
  // Audit finding: also exclude soft-deleted lots. When the
  // fiche is opened from the list it carries a trash-stripped `liveData`
  // tobacco, but addLotToTobacco / updateLotInTobacco / changeLotStatus call
  // setDetail(rawTob) whose `lots` still hold deletedAt rows — this defensive
  // filter keeps a trashed lot from re-surfacing after those mutations.
  // scope-ok: the raw read is the full lot list on purpose — the SECOND filter
  // below applies `inScope` (plus the finished toggle), so this is the scope
  // route for the lot LIST itself, not a figure that bypasses it.
  const visibleLots = (tob.lots || []).filter(l => !(l as any).deletedAt).filter(l => {
    if (l.status === "finished" && !showFinishedLots) {
      // Honor the global statusFilter if set to "finished"
      return statusFilter === "finished";
    }
    // Every scope — the two statuses, the four maturity bands and
    // "Achats récents" — goes through the SAME shared predicate as the card,
    // so the fiche can't disagree with the page that sent the user here.
    if (lotScope) return inScope(l);
    if (statusFilter === "finished") return l.status === "finished";
    return true;
  }).slice().sort((a, b) => {
    // Jars first, then cellar, then finished — and within each
    // status group sort by boxNumber (natural-numeric where possible) so
    // the user always sees "Pot 1, Pot 2, …, Cave 1, …" deterministically.
    const rank = (l: Lot) => l.status === "jar" ? 0 : l.status === "cellar" ? 1 : 2;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const numA = parseFloat(a.boxNumber || "");
    const numB = parseFloat(b.boxNumber || "");
    const hasNumA = !isNaN(numA);
    const hasNumB = !isNaN(numB);
    if (hasNumA && hasNumB && numA !== numB) return numA - numB;
    // Fall back to string compare of boxNumber, then to creation order
    // (lot.id is Date.now() at creation, so smaller = older).
    const sa = String(a.boxNumber || "");
    const sb = String(b.boxNumber || "");
    if (sa !== sb) return String(sa).localeCompare(String(sb));
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  // Audit: skip soft-deleted lots — `detail` is
  // re-seeded with the RAW tobacco after an in-fiche mutation, so a trashed
  // finished lot would otherwise inflate the section sub-count and the
  // "Voir terminés (N)" button (which then reveals nothing).
  // scope-ok: unscoped ON PURPOSE — its only consumer (the "Les lots" sub-count
  // and the "Voir terminés (N)" button) is gated on `!lotScope`, and a finished
  // lot is never in scope anyway (lotInScope excludes it).
  const finishedCount = (tob.lots || []).filter(l => l.status === "finished" && !l.deletedAt).length;
  // Top pipes paired with this tabac via sessions.
  const topPipes = topPairings(
    data?.sessions, "tobaccoId", tob.id, "pipeId",
    (id) => findById(data?.pipes as any[], id),
  ).map((x) => ({ pipe: x.entity, n: x.n }));

  // Aroma fingerprint of THIS tobacco — aggregates the aromas
  // tapped across every session of it (most frequent first). Answers "what
  // does my palate consistently find in this blend", turning the per-session
  // captures into a per-tobacco profile. Pure derivation, no stored field.
  const tobAromas = computeAromaProfile(
    (data?.sessions || []).filter((s: any) => s && String(s.tobaccoId) === String(tob.id)),
  );

  // Aging status — count overaged / approaching lots. Through
  // effectiveAgingMax so the family default applies when no explicit target.
  const eam = effectiveAgingMax(tob);
  // Reported: the "1 lot trop vieux" banner at the top of the fiche
  // counted EVERY lot, so a fiche filtered to "En pot" warned about a CELLAR
  // lot — the alert the user could not act on from that screen. Scoped now.
  // (Under a jar scope it is always 0: aging is cellar-only by construction.)
  const aging = scopedLots.reduce((acc, l) => {
    if (!lotAgingStatus) return acc;
    const s = lotAgingStatus(l, eam);
    if (s === "overaged")    acc.overaged++;
    if (s === "approaching") acc.approaching++;
    return acc;
  }, { overaged: 0, approaching: 0 });

  const onSaveLot = (lot: Lot, count: number) => {
    if (!lotForm) return;
    if (lotForm.lot !== undefined && lotForm.idx !== undefined) {
      updateLotInTobacco && updateLotInTobacco(tob.id, lotForm.lot.id, lot);
    } else {
      addLotToTobacco && addLotToTobacco(tob.id, lot, count);
    }
    setLotForm(null);
    // See TobaccoFormView for the iOS auto-save piggyback.
    ctx.triggerIosAutosaveReauth && ctx.triggerIosAutosaveReauth();
  };
  const onDeleteLot = () => {
    if (!lotForm || !lotForm.lot) return;
    removeLot && removeLot(tob.id, lotForm.lot.id);
    setLotForm(null);
  };
  // Duplicate a lot — a fresh full copy (another tin of the same
  // purchase), with the next box number. Reachable from BOTH the lot detail
  // modal (the discoverable place) and the lot edit modal. From
  // edit mode it does NOT persist unsaved edits to the original (like Cancel +
  // create-a-copy). Closes whichever modal was open.
  const onDuplicateLot = (lot: Lot) => {
    const dup = makeLotDuplicate(lot, nextBoxNumber((ctx.data?.tobaccos as any[]) || []));
    addLotToTobacco && addLotToTobacco(tob.id, dup, 1);
    setLotForm(null);
    setLotDetail(null);
    ctx.triggerIosAutosaveReauth && ctx.triggerIosAutosaveReauth();
  };

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="back" onClick={() => setDetail(null)} ariaLabel={t ? t("nav_back") : "Retour"} />}
          title={t ? t("ttl_tobacco_fiche") : "Fiche tabac"}
          trailing={<>
            {/* Global trash indicator left of the entity-
                specific edit/trash so the user can reach the Trash
                from any detail screen. Amber tint distinguishes it
                from the oxblood per-entity trash. Hidden when trash
                empty. */}
            <CuratorTrashIndicator />
            <IconBtn icon="edit" ariaLabel={t ? t("btn_edit") : "Modifier"}
              onClick={() => {
                if (setForm && BT && setEditId && nav) {
                  setForm(Object.assign({}, BT, tob));
                  setEditId(tob.id);
                  nav("editT");
                }
              }} />
            <IconBtn icon="trash" color={C.oxbloodHi}
              ariaLabel={t ? t("btn_delete") : "Supprimer"}
              onClick={() => deleteTobacco && deleteTobacco(tob.id)} />
          </>}
        />

        {/* Aging warning banner. Now uses the shared
            <Notice> primitive. The colour family follows the
            charter: overaged → error (oxblood), approaching →
            warn (amber). Pre-180 the "approaching" tone was
            mapped to brass which was off-charter — fixed here. */}
        {(aging.overaged > 0 || aging.approaching > 0) && (
          <div style={{ margin: "0 12px 14px" }}>
            <Notice
              tone={aging.overaged > 0 ? "error" : "warn"}
              icon={aging.overaged > 0 ? "clock" : "diamond"}>
              {aging.overaged > 0
                ? `${aging.overaged} ${aging.overaged > 1 ? t("lbl_lots_plural") : t("lbl_lot")} ${t("aging_too_old")}`
                : `${aging.approaching} ${aging.approaching > 1 ? t("lbl_lots_plural") : t("lbl_lot")} ${t("aging_nearing_peak")}`}
            </Notice>
          </div>
        )}

        {/* Hero */}
        <div style={{ padding: "8px 16px 22px", position: "relative", display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* Was a bare `div onClick` — no role, no tabIndex, no key
              handler. The small extra-photo thumbnails on the pipe fiche are real
              buttons, so a keyboard / switch user could open EVERY small photo
              but not the big main one, and a screen reader was never told the
              hero image was actionable. PressCard supplies role="button",
              tabIndex, Enter/Space, the focus ring and the iOS reliable-tap path
              in one wrapper. jest-axe has no rule for div[onClick], which is how
              three of these survived a hand a11y audit. */}
          {tob.imageUrl && (
            <PressCard
              onClick={() => setLightbox && setLightbox(tob.imageUrl)}
              ariaLabel={t ? t("lbl_image") : "Image"}
              style={{
                width: 96, height: 96, flexShrink: 0, borderRadius: 8,
                background: `${safeBgUrl((imgLocal && imgLocal[tob.imageUrl]) || tob.imageUrl)} center/contain no-repeat`,
                // See PipesDetailView. This block only renders
                // when a photo exists, so the border was always framing one.
                // The soft category-tinted shadow stays — it lifts the thumb
                // off the page, it is not a hard edge around the image.
                cursor: "pointer",
                boxShadow: `0 4px 14px ${alpha(color, "33")}`,
              }}
            >{null}</PressCard>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Lbl color={color}>{tob.brand || "—"}</Lbl>
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
              <span style={{ fontStyle: "italic" }}>{tob.name || "—"}</span>
            </h1>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Stars n={tob.rating || 0} size={14} sequenced />
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx2}>{[xl ? xl(tob.category, CATS_EN) : tob.category, xl ? xl(tob.cut, CUTS_EN) : tob.cut].filter(Boolean).join(" · ") || "—"}</Lbl>
              {/* Surface the tri-state rebuy decision in the
                  hero. null = undecided (no badge), true = sage "À reprendre",
                  false = oxblood "✕ Pas reprendre". Same colour grammar as the
                  badges shown on TobaccoCard so the cue is consistent across
                  list and detail. */}
              {tob.rebuy === true && (
                <span style={{
                  padding: "2px 7px", borderRadius: 4,
                  background: alpha(C.sage, "22"), color: C.sage,
                  fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
                  textTransform: "uppercase", fontWeight: 700,
                }}>{t ? t("rebuy_yes") : "À reprendre"}</span>
              )}
              {tob.rebuy === false && (
                <span style={{
                  padding: "2px 7px", borderRadius: 4,
                  background: alpha(C.oxbloodHi, "22"), color: C.oxbloodHi,
                  fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
                  textTransform: "uppercase", fontWeight: 700,
                }}>✕ {t ? t("rebuy_no") : "Pas reprendre"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Big metric */}
        <div style={{
          margin: "0 12px 18px", padding: "20px 22px",
          background: `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
          border: `1px solid ${C.rule}`, borderRadius: 8,
          display: "flex", alignItems: "center", gap: 18,
        }}>
          <div style={{ flex: 1 }}>
            {/* The cell-accent now lives on the overline label
                (was C.tx2 — replaced with the category color), so the big
                AnimNum can use C.ivory for guaranteed AA contrast on every
                category. Previously low-luminance categories (Dark Fired,
                Perique, Latakia) hit the WCAG 1.4.3 AA-large threshold
                with no margin against the dark card background. */}
            {/* The label follows the SCOPE. It was hardcoded to
                "En cave" — so an unfiltered fiche announced "EN CAVE" over a
                total that includes the jars, and a fiche opened from the
                "En pot" filter said "EN CAVE" over a jar weight. Unscoped now
                reads "En stock"; "En cave" appears only for the cellar slice. */}
            <Lbl color={color}>{t(scopeLabelKey(lotScope))}</Lbl>
            <div style={{
              fontFamily: F.display, fontSize: fs(56), color: C.ivory, lineHeight: 1,
              fontStyle: "italic", marginTop: 8, letterSpacing: -2,
            }}>
              <AnimNum value={totalW} delay={150} duration={900} />
              <span style={{ fontSize: fs(24), color: C.tx2, fontStyle: "normal", marginLeft: 4 }}>{weightUnit}</span>
            </div>
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: C.rule, margin: "6px 0" }} />
          <div>
            <Lbl color={C.tx2}>{t("lbl_lots")}</Lbl>
            <div style={{ fontFamily: F.display, fontSize: fs(40), color: C.ivory, lineHeight: 1, marginTop: 8 }}>
              {/* Count the lots that BACK the weight beside it. It
                  counted every lot — finished and even soft-deleted ones — so
                  "945 g / 19 lots" mixed a stock figure with a historical
                  count. Finished lots keep their own counter on the "Les lots"
                  header. */}
              <AnimNum value={heroLotCount} delay={300} />
            </div>
          </div>
        </div>

        {/* Profile triangle */}
        {(tob.force || tob.taste || tob.roomNote) ? (
          <>
            <SectionHead title={t ? t("sec_flavour") : "Profil gustatif"} accent={color} />
            <div style={{
              margin: "0 12px 18px", padding: "14px 18px",
              background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
              boxShadow: CARD_SHADOW,
            }}>
              {([
                [t("lbl_force"),     tob.force || 0,    C.oxbloodHi],
                [t("lbl_taste"),     tob.taste || 0,    C.brassHi],
                [t("lbl_room_note"), tob.roomNote || 0, C.sageHi],
              ] as [string, number, string][]).map(([lbl, val, c], i) => (
                <div key={lbl} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "9px 0",
                  borderBottom: i < 2 ? `1px dotted ${C.rule}` : "none",
                }}>
                  <Lbl color={C.tx2} style={{ minWidth: 70 }}>{lbl}</Lbl>
                  <div style={{
                    flex: 1, height: 6, background: C.bg, borderRadius: 3,
                    overflow: "hidden", border: `1px solid ${C.rule}`,
                  }}>
                    <GrowBarH pct={val * 20} color={c} delay={400 + i * 80} />
                  </div>
                  <div style={{
                    minWidth: 24, textAlign: "right", fontFamily: F.display,
                    fontSize: fs(20), color: c, fontStyle: "italic",
                  }}>
                    {val}<span style={{ fontSize: fs(14.5), color: C.tx3, fontStyle: "normal" }}>/5</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* Notes */}
        {tob.tastingNotes && (
          <div style={{
            margin: "0 12px 18px", padding: "14px 18px",
            background: CARD_BG, border: `1px dotted ${C.rule2}`, borderRadius: 8,
            position: "relative",
          }}>
            <div style={{ position: "absolute", top: -8, left: 14, padding: "0 6px", background: C.bg }}>
              <Lbl color={C.brassHi}>{t("sec_tasting_notes")}</Lbl>
            </div>
            <div style={{
              fontFamily: F.display, fontStyle: "italic", fontSize: fs(17),
              color: C.cream, lineHeight: 1.55, marginTop: 4,
            }}>« {tob.tastingNotes} »</div>
          </div>
        )}

        {/* User tags / collections — tap a chip to filter the
            inventory by that collection (back returns to this fiche). */}
        {/* The item's own collections, folded behind the label —
            shared component, was a byte-identical copy in all three fiches. */}
        <TagChipRow tags={tob.tags} onOpen={(tg) => navToInvByTag && navToInvByTag(tg)} t={t} />

        {/* Composition / description / aging info */}
        {(tob.blend || tob.description || tob.agingMax || oldestDays > 0) && (
          <>
            <SectionHead title={t ? t("sec_details") : "Détails"} accent={C.brassDim} />
            <div style={{
              margin: "0 12px 18px", padding: "12px 16px",
              background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
              boxShadow: CARD_SHADOW,
              display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10,
            }}>
              {tob.blend && (
                <div>
                  <Lbl color={C.tx2}>{t ? t("lbl_blend") : "Composition"}</Lbl>
                  <div style={{ marginTop: 3, fontSize: fs(15), color: C.cream, lineHeight: 1.4 }}>
                    {tob.blend}
                  </div>
                </div>
              )}
              {tob.description && (
                <div>
                  <Lbl color={C.tx2}>{t ? t("lbl_desc") : "Description"}</Lbl>
                  <div style={{ marginTop: 3, fontSize: fs(15), color: C.cream, lineHeight: 1.5 }}>
                    {tob.description}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {tob.agingMax && (
                  <div>
                    <Lbl color={C.tx2}>{t ? t("lbl_aging_max") : "Âge max cave (ans)"}</Lbl>
                    <div style={{ marginTop: 3, fontFamily: F.mono, fontSize: fs(15), color: C.brassHi }}>
                      {tob.agingMax} {t("lbl_yrs")}
                    </div>
                  </div>
                )}
                {oldestDays > 0 && (
                  <div>
                    <Lbl color={C.tx2}>{t ? t("lbl_oldest") : "Plus ancien"}</Lbl>
                    <div style={{ marginTop: 3, fontFamily: F.mono, fontSize: fs(15), color: C.sageHi }}>
                      {ageLabel ? ageLabel(oldestDays) : `${oldestDays}j`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Lots */}
        <SectionHead title={t ? t("sec_lots") : "Les lots"}
          // While a scope is active the fiche says nothing about
          // lots outside it — so the finished-lot tally stands down too.
          sub={`${visibleLots.length}${(!lotScope && finishedCount > 0) ? " · " + finishedCount + " " + plural(finishedCount, t("lbl_finished_word"), t("lbl_finished_word_p"), lang) : ""}`}
          accent={color} />
        {/* a fiche that silently hides lots is confusing, so name the
            slice it is showing and offer a way out. The override is LOCAL — it
            leaves the global list filter alone, so going back keeps it. */}
        {lotScope && (
          <div style={{ padding: "0 12px 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px",
              background: alpha(C.brass, "22"), border: `1px solid ${alpha(C.brass, "55")}`,
              borderRadius: 999, color: C.brassHi,
              fontFamily: F.mono, fontSize: fs(11), letterSpacing: 0.6, textTransform: "uppercase",
            }}>
              {t ? t("lbl_filtered_on") : "Filtré"}
              {" · "}
              {t(scopeLabelKey(lotScope))}
            </span>
            <PressCard
              onClick={() => setLotScopeOff(true)}
              style={{
                padding: "4px 10px", borderRadius: 8, background: "transparent",
                border: `1px solid ${C.rule}`, color: C.tx2,
                fontFamily: F.body, fontSize: fs(13),
              }}>
              {t ? t("btn_show_all_lots") : "Tout afficher"}
            </PressCard>
          </div>
        )}
        {activeButUnusable && (
          <div style={{ padding: "0 12px 10px" }}>
            <Notice tone="info">
              {t ? t("lot_no_weight_hint") : "Tous les lots actifs sont à zéro : ajoute du poids pour utiliser ce tabac dans une séance."}
            </Notice>
          </div>
        )}
        <div style={{ padding: "0 12px 16px" }}>
          {visibleLots.map((lot, i) => {
            // scope-ok: not a figure — the lot's index in the RAW array, which
            // is what the store mutations key on (a scoped index would edit the
            // wrong lot).
            const realIdx = (tob.lots || []).indexOf(lot);
            return (
              <LotRow key={lot.id || realIdx} lot={lot} idx={i}
                maturity={lotMaturityBucket(lot, eam)}
                onOpen={() => setLotDetail({ tobacco: tob, lot, idx: realIdx })}
                onReactivate={() => {
                  // weightG > 0 → status flip directly;
                  // weightG === 0 → open the form pre-filled with 50g.
                  if ((parseFloat(lot.weightG) || 0) > 0) {
                    // Respect the lot's true origin: a lot stamped
                    // originalStatus="jar" never moved through cellar,
                    // so reactivating it to "cellar" would violate
                    // invariant #5 (status === "cellar" ⇒ originalStatus
                    // !== "jar") and let auto-repair silently rewrite
                    // the history. Fall back to "cellar" for legacy
                    // lots whose origin isn't recorded.
                    const target: "jar" | "cellar" =
                      lot.originalStatus === "jar" ? "jar" : "cellar";
                    changeLotStatus && changeLotStatus(tob.id, lot.id, target);
                    return;
                  }
                  // Audit: derive the target
                  // from originalStatus — the SAME rule as the weightG>0 branch
                  // above — NOT from dateOpened. A legacy finished lot that
                  // migrateData stamped originalStatus="jar" (finished with no
                  // dateOpened) would otherwise land in status:"cellar" +
                  // originalStatus:"jar", the impossible state that trips the
                  // `cellar-not-jar-origin` invariant. When targeting jar,
                  // default dateOpened so invariant #4 (jar ⇒ dateOpened) holds
                  // in the prefill too (updateLotInTobacco also fills it on save).
                  const rTarget: "jar" | "cellar" =
                    lot.originalStatus === "jar" ? "jar" : "cellar";
                  const reactivated: any = Object.assign({}, lot, {
                    status: rTarget,
                    weightG: "50",
                    dateFinished: "",
                    disposed: false,
                  });
                  if (rTarget === "jar" && !reactivated.dateOpened) reactivated.dateOpened = today();
                  setLotForm({ tobacco: tob, lot: reactivated, idx: realIdx });
                }}
                t={t} lang={lang} dateFormat={dateFormat} weightUnit={weightUnit} />
            );
          })}
          {finishedCount > 0 && !lotScope && statusFilter !== "finished" && (
            <PressCard
              onClick={() => setShowFinishedLots(v => !v)}
              style={{
                marginTop: 4, padding: "9px 14px", borderRadius: 8,
                background: "transparent", border: `1px solid ${C.rule}`,
                color: C.tx3, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontFamily: F.body, fontSize: fs(13.5),
              }}>
              {/* Rotate the disclosure chevron to reflect state
                  (was a dead `? "chevron" : "chevron"` ternary — never moved). */}
              <span style={{ display: "inline-flex", transition: "transform 200ms", transform: showFinishedLots ? "rotate(90deg)" : "rotate(0deg)" }}>
                <Ico name="chevron" size={12} />
              </span>
              {showFinishedLots
                ? (t ? t("btn_hide_finished_count") : "Masquer terminés")
                : (t ? t("btn_show_finished_count") : "Voir terminés") + ` (${finishedCount})`}
            </PressCard>
          )}
          <PressCard
            onClick={() => setLotForm({ tobacco: tob })}
            style={{
              marginTop: 8, padding: "11px 14px", borderRadius: 8,
              border: `1px dashed ${C.rule2}`, color: C.brassHi,
              display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
              fontFamily: F.body, fontWeight: 500, fontSize: fs(15),
              background: "transparent",
            }}>
            <Ico name="plus" size={16} sw={1.8} />
            {t("btn_add_lot")}
          </PressCard>
        </div>

        {/* Aroma fingerprint from this tobacco's sessions. */}
        {tobAromas.items.length > 0 && (
          <>
            <SectionHead title={t ? t("sec_tobacco_aromas") : "Arômes perçus"} accent={color} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{ fontSize: fs(13.5), color: C.tx3, marginBottom: 10, lineHeight: 1.4 }}>
                {/* The session noun goes through plural(): the count is very
                    often 1 (the section shows as soon as ONE session carries an
                    aroma), and every one of the six dictionaries had hardcoded
                    the PLURAL noun — so it read "1 sessões" / "1 séances" /
                    "1 sessions" in all six. Same fix as the calendar day count
                    in HomeViewV2. */}
                {String(t ? t("tobacco_aromas_hint") : "Arômes les plus notés au fil de {n} {s} de ce tabac.")
                  .replace("{n}", String(tobAromas.taggedSessions))
                  .replace("{s}", plural(tobAromas.taggedSessions,
                    t ? t("lbl_session_word") : "séance",
                    t ? t("lbl_sessions_word") : "séances", lang))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tobAromas.items.map((it) => (
                  <span key={it.key} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px",
                    background: alpha(color, "1c"), border: `1px solid ${alpha(color, "55")}`,
                    color: C.ivory, borderRadius: 8,
                    fontSize: fs(13.5), fontFamily: F.body, fontWeight: 500,
                  }}>
                    {t(aromaLabelKey(it.key))}
                    <span style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx2 }}>{it.count}×</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Top pipes paired with this tobacco */}
        {topPipes.length > 0 && (
          <>
            <SectionHead title={t ? t("pairing_top_pipes") : "Top pipes utilisées"} accent={C.oxbloodHi} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                overflow: "hidden", boxShadow: CARD_SHADOW,
              }}>
                {topPipes.map((p, i) => {
                  const photo = p.pipe.imageUrl ? ((imgLocal && imgLocal[p.pipe.imageUrl]) || p.pipe.imageUrl) : null;
                  return (
                    // Tapping a paired pipe opens its fiche (was an
                    // inert div). Cross-open records this tobacco
                    // fiche on the back stack so back returns here, not the
                    // pipe list.
                    <PressCard key={p.pipe.id}
                      onClick={() => { if (crossOpenDetail) crossOpenDetail({ view: "pipes", kind: "pipe", obj: p.pipe }); }}
                      style={{
                        padding: "10px 14px",
                        display: "flex", alignItems: "center", gap: 12,
                        borderBottom: i < topPipes.length - 1 ? `1px solid ${C.rule}` : "none",
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
                          color: C.oxbloodHi,
                        }}>
                          <Ico name="pipe" size={16} sw={1.4} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: fs(14.5), color: C.tx2 }}>{p.pipe.brand || "—"}</div>
                        <div style={{ fontFamily: F.display, fontStyle: "italic", color: C.ivory, fontSize: fs(16) }}>
                          {p.pipe.name || "—"}
                        </div>
                      </div>
                      <div style={{
                        fontFamily: F.mono, fontSize: fs(13.5), color: C.brassHi,
                        background: alpha(C.brass, "22"), padding: "3px 8px", borderRadius: 4,
                      }}>{p.n}×</div>
                      <Ico name="chevron" size={16} sw={2} />
                    </PressCard>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* The "Démarrer une dégustation" CTA was removed from the
            tobacco fiche per user request — it lives on the Home + the Journal
            (session) page only now. */}
      </div>

      {/* Lot detail (read-only) modal — opens first on row tap. Edit
          switches to the write-mode lotForm; Delete reuses the same
          confirm flow as the form's trash button. */}
      {lotDetail && lotDetail.lot && (
        <LotDetailModal
          data={lotDetail}
          weightUnit={weightUnit}
          currencySymbol={currencySymbol}
          lang={lang}
          dateFormat={dateFormat}
          t={t}
          sessions={sessionsForLot((data && data.sessions) || [], lotDetail.lot.id)}
          onOpenSession={(s) => {
            // Leave the read-only lot modal ARMED rather than clearing it: the
            // fiche's subtree unmounts on nav, so nothing is left on screen,
            // and system-back pops here and re-opens the very lot the user was
            // reading. Clearing it would drop them on a bare fiche instead.
            crossOpenSession && crossOpenSession(s);
          }}
          onClose={() => setLotDetail(null)}
          onEdit={() => {
            const cur = lotDetail;
            setLotDetail(null);
            setLotForm(cur);
          }}
          onDelete={() => {
            if (!lotDetail || !lotDetail.lot) return;
            const delId = lotDetail.lot.id;
            setLotDetail(null);
            // No confirm — the lot goes to the Trash (30 d)
            // and the 8 s undo toast still catches accidents.
            removeLot && removeLot(tob.id, delId);
          }}
          onDuplicate={() => {
            if (lotDetail && lotDetail.lot) onDuplicateLot(lotDetail.lot);
          }}
        />
      )}

      {/* Lot add/edit modal */}
      <CuratorLotFormModal
        open={!!lotForm}
        onClose={() => setLotForm(null)}
        data={lotForm}
        onSave={onSaveLot}
        onDelete={lotForm?.lot ? onDeleteLot : undefined}
        onDuplicate={lotForm?.lot ? onDuplicateLot : undefined}
        weightUnit={weightUnit}
      />
    </div>
  );
}

function LotRow({
  lot, idx, maturity, onOpen, onReactivate, t, lang, dateFormat, weightUnit = "g",
}: {
  lot: Lot; idx: number;
  // Full maturity band (young/optimal/peak/tooOld) instead of the
  // warn-only overaged/approaching, so every active lot shows where it sits.
  maturity?: "young" | "optimal" | "peak" | "tooOld" | null;
  onOpen: () => void;
  onReactivate?: () => void;
  // t required after i18n cleanup; always provided by ctx.
  t: (k: string) => string; lang?: string; dateFormat?: string; weightUnit?: string;
}) {
  const e = useEnter(500 + idx * 80);
  const isJar = lot.status === "jar";
  const isFinished = lot.status === "finished";
  const canReactivate = isFinished;
  // Lot rows now show only "Nº — age" plus the warning badges.
  // Weight, dates, price, seller are visible on tap (edit modal). The
  // status (cave / pot / fini) is preserved via the icon container colour
  // AND a short inline tag, so the cave-vs-pot distinction stays visible
  // at a glance even on a compact row.
  const statusTag = isFinished ? t("lot_finished_lbl")
                  : isJar     ? t("lot_jar")
                              : t("lot_cellar");
  const statusColor = isFinished ? C.tx2 : isJar ? C.brassHi : C.sage;
  // Number = user-entered boxNumber when set, else fall back to the
  // 1-based row index so every lot reads as "Nº something".
  const lotNumber = lot.boxNumber || String(idx + 1);
  // Age formatted via lotAge(...) → days; we then humanize inline since
  // ageLabel isn't passed to LotRow. Keeps the row self-contained.
  const ageDays = lotAge(lot);
  return (
    <div
      tabIndex={0}
      // a stable hook for tests. The suite used to select these rows
      // by matching "Nº " in the aria-label — which coupled it to a hardcoded
      // FRENCH literal in production code, so translating that literal (the
      // point of translating it) silently emptied the selection and the assertion
      // failed for a reason unrelated to what it checks.
      data-lot-row={String(lot.id)}
      aria-label={`${statusTag} ${t ? t("lbl_box_short") : "Nº "}${lotNumber}`}
      onClick={onOpen}
      // Keyboard-activable (was a bare <div onClick> — a11y gap).
      // Kept as a focusable div (NOT role="button") on purpose: the row can
      // contain a nested "Réactiver" <button> for finished lots, and a
      // button-role wrapper around a button is a nested-interactive violation.
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(); }
      }}
      style={{
      background: CARD_BG, border: `1px solid ${C.rule}`,
      borderRadius: 8, marginBottom: 8, padding: "12px 14px",
      boxShadow: CARD_SHADOW,
      display: "flex", alignItems: "center", gap: 14,
      // NO row-wide opacity. There used to be
      // `opacity: isFinished ? (lot.disposed ? 0.4 : 0.6) : 1` here, and the
      // correction worth recording is that it was NEVER RENDERING: `...e`
      // (useEnter) is spread at the end of this same object literal and always
      // carries an `opacity` (0 then 1), so the later key won and finished rows
      // always drew at full opacity. I first removed this line describing a
      // live 2.56:1 / 1.79:1 defect; the test disproved that within a minute
      // (jsdom reported the row's opacity as the animation's, not the fade's).
      // Removing it is still right — it is a landmine, not a bug: moving `...e`
      // up, or dropping the entry animation, would silently ACTIVATE it. Those
      // ratios are what it would then cause (C.tx3 on CARD_BG, dark palette:
      // 4.94:1 at full, 2.56:1 at 0.6, 1.79:1 at 0.4 — both under the 3:1
      // hard-failure floor), and no WCAG 1.4.3 exemption would apply since the
      // row is a fully active control (tabIndex, onClick, Enter/Space). The
      // fade was redundant regardless: the row already renders an explicit
      // status tag and, when disposed, a dedicated pill.
      // The same spread-order inversion makes the equivalent PipeCard claim wrong
      // in the same way; corrected at that site too.
      cursor: "pointer", textAlign: "left",
      // touch-action: manipulation — same tap-responsiveness fix as
      // PressCard. Keep the native onClick path but strip
      // the 300 ms iOS Safari tap delay.
      touchAction: "manipulation",
      ...e,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 8,
        background: isFinished ? C.bg : isJar ? alpha(C.brass, "22") : alpha(C.sage, "22"),
        color: statusColor,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${isFinished ? C.rule2 : isJar ? alpha(C.brass, "44") : alpha(C.sage, "44")}`,
        flexShrink: 0,
      }}>
        <Ico name="box" size={20} sw={1.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <Lbl color={statusColor} size={10.5}>{statusTag}</Lbl>
          <span style={{
            fontFamily: F.display, fontSize: fs(18), color: C.ivory,
            fontStyle: "italic", lineHeight: 1,
          }}>Nº {lotNumber}</span>
          <span style={{
            fontFamily: F.mono, fontSize: fs(13.5), color: C.tx2, letterSpacing: 0.4,
          }}>· {fmtLotAge(ageDays, t)}</span>
          {/* Surface the relevant lifecycle date on the lot
              row so the user doesn't have to open the detail modal:
                - jar         → date opened (mise en pot)
                - cellar      → date purchased (mise en cave, proxy)
                - finished/disposed → dateFinished
              Renders only when the chosen date is present. */}
          {isJar && lot.dateOpened && (
            <span style={{
              fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.3,
            }}>· {t("lot_jarred_on")} {fmtDate(lot.dateOpened, dateFormat)}</span>
          )}
          {!isJar && !isFinished && lot.datePurchased && (
            <span style={{
              fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.3,
            }}>· {t("lot_cellared_on")} {fmtDate(lot.datePurchased, dateFormat)}</span>
          )}
          {isFinished && lot.dateFinished && (
            <span style={{
              fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.3,
            }}>· {t("lot_ended_on")} {fmtDate(lot.dateFinished, dateFormat)}</span>
          )}
          {/* Surface the current lot balance directly in the
              row. It used to be visible only after
              tapping into the detail modal. Styled as a small chip
              tinted with the row's status color so the eye picks it up
              without dominating the row. */}
          <span style={{
            display: "inline-flex", alignItems: "center",
            padding: "2px 6px",
            background: alpha(statusColor, "22"), color: statusColor,
            fontFamily: F.mono, fontSize: fs(12), fontWeight: 700,
            letterSpacing: 0.6, borderRadius: 3,
          }}>{fmtLotWeight(lot.weightG, lang, weightUnit)}</span>
          {isFinished && lot.disposed && (
            <span style={{
              fontFamily: F.mono, fontSize: fs(11), color: C.oxbloodHi,
              background: alpha(C.oxblood, "22"), padding: "2px 6px", borderRadius: 3,
              letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
            }}>🚮 {t("lot_disposed")}</span>
          )}
          {/* Storage location annotation. */}
          {lot.storageLocation && (
            <span style={{
              fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, letterSpacing: 0.3,
            }}>· 📍 {lot.storageLocation}</span>
          )}
          {maturity && <MaturityChip bucket={maturity} size="sm" t={t} />}
          {/* The jar-specific signal that replaces the cellaring
              maturity chip on an OPENED lot — how long it's been open. Neutral
              (brass, jar's colour), NOT a warn: an open jar may be drying OR
              deliberately aging, so we only inform, never alert. */}
          {isJar && lot.dateOpened && daysSince(String(lot.dateOpened)) != null && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px",
              background: alpha(C.brass, "22"), color: C.brassHi,
              fontFamily: F.mono, fontSize: fs(11.5), letterSpacing: 0.4,
              borderRadius: 3, fontWeight: 700,
            }}>{t("lot_open_since")} · {fmtLotAge(daysSince(String(lot.dateOpened)), t)}</span>
          )}
        </div>
      </div>
      {canReactivate && onReactivate ? (
        <button type="button"
          onClick={(ev) => { ev.stopPropagation(); onReactivate(); }}
          aria-label={t ? t("btn_reactivate") : "Réactiver"}
          style={{
            padding: "6px 10px", borderRadius: 8, flexShrink: 0,
            background: alpha(C.sage, "22"), color: C.sageHi,
            border: `1px solid ${alpha(C.sage, "55")}`, cursor: "pointer",
            fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
            letterSpacing: 0.8, textTransform: "uppercase",
          }}>↻ {t ? t("btn_reactivate") : "Réactiver"}</button>
      ) : (
        <Ico name="chevron" size={16} />
      )}
    </div>
  );
}

// Module-scoped row helper used by LotDetailModal. Was defined inline
// inside LotDetailModal — the eslint rule
// `react-hooks/static-components` flagged it (and every <Row> call site)
// because a function expression defined during render is a new component
// identity on each render, which can reset child state. Hoisting to
// module scope kills nine pre-existing errors at once.
function LotDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0" }}>
      <Lbl color={C.tx3} size={11}>{label}</Lbl>
      <span style={{ fontFamily: F.body, fontSize: fs(15), color: C.tx, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Lot detail (read-only) modal. Surfaces every relevant lot
// field at a glance without putting the user into write mode. Mirrors
// the SessionDetailModal pattern in JournalView: tap a row → read-only
// modal → explicit Edit / Delete / Close buttons.
function LotDetailModal({
  data, weightUnit, currencySymbol, lang, dateFormat, t, sessions, onOpenSession,
  onClose, onEdit, onDelete, onDuplicate,
}: {
  data: LotFormData;
  weightUnit: string;
  currencySymbol?: string;
  lang?: string;
  dateFormat?: string;
  // `t` is required after the i18n cleanup in this file.
  // It's always provided by useAppCtx (ctx.t) which is set in App.tsx.
  t: (k: string) => string;
  // The LIVE sessions charged against THIS lot, most recent
  // first (utils.sessionsForLot). Passed in rather than derived here so the
  // modal stays a presentation component and the filter has one tested home.
  sessions: any[];
  onOpenSession: (s: any) => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const lot = data.lot!;
  const isJar = lot.status === "jar";
  const isFinished = lot.status === "finished";
  const statusLabel = isFinished
    ? t("lot_finished_lbl")
    : isJar
      ? t("lot_jar")
      : t("lot_cellar");
  const statusColor = isFinished ? C.tx2 : isJar ? C.brassHi : C.sage;
  const ageDays = lotAge(lot);
  const lotNumber = lot.boxNumber || (data.idx !== undefined ? String(data.idx + 1) : "—");
  return (
    // `capHeight` + the standard inner scroll shape. Adding the
    // session list makes this modal unboundedly tall — a 100 g tin can carry
    // forty bowls — and the rule is that any modal able to exceed the
    // screen uses `capHeight`, never a `vh` cap: a cap cannot know the
    // backdrop's own padding and safe areas, and an uncontained scroll port
    // chains the swipe to the page behind. `minHeight: 0` on the body is
    // load-bearing (a flex item defaults to `min-height: auto` and refuses to
    // shrink below its content).
    <Modal open={true} onClose={onClose} maxWidth={520} capHeight
      ariaLabel={t("lot_details")}>
      <ModalHeader
        overline={t("lot_for_detail")}
        title={
          <>
            <span style={{ color: statusColor }}>{statusLabel}</span>
            <span style={{ color: C.tx3, fontWeight: 400 }}> · </span>
            <span style={{ fontStyle: "italic", color: C.brass }}>Nº {lotNumber}</span>
          </>
        }
        accent={statusColor} />
      <div style={{
        padding: "0 12px 18px",
        flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
      }}>
        {/* Top stats row: current + initial weight + age. */}
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 8,
          marginBottom: 12,
        }}>
          <StatTile label={t("lbl_current")}
            value={fmtLotWeight(lot.weightG, lang, weightUnit)} accent={statusColor} />
          <StatTile label={t("lbl_initial")}
            value={lot.weightInitial ? `${fmtNum(lot.weightInitial, lang)}${weightUnit}` : "—"} accent={C.tx2} />
          <StatTile label={t("sort_age")}
            value={fmtLotAge(ageDays, t)} accent={C.brassHi} />
        </div>

        {/* Maturity band of THIS lot (young / optimal / peak /
            tooOld), via the shared classifier + family-default fallback, so
            the modal matches the chip shown on the lot row + the card. Only
            active lots have a maturity (finished → null → no chip). */}
        {(() => {
          const bucket = lotMaturityBucket(lot, effectiveAgingMax(data.tobacco));
          return bucket ? (
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
              <MaturityChip bucket={bucket} size="md" t={t} />
            </div>
          ) : null;
        })()}

        {/* Detail rows. The cellar-with-dateOpened combo (the legacy
            auto-revert; that rule was removed long ago,
            but the persisted state can still hold it on migrated lots
            or via manual revert through the lot edit modal) labels
            the date "previously opened" to keep the historical trace
            explicit. */}
        <div style={{
          padding: "4px 12px", borderRadius: 8,
          background: CARD_BG, border: `1px solid ${C.rule}`,
          marginBottom: 10,
        }}>
          <LotDetailRow label={t("lbl_box_number")} value={lot.boxNumber || ""} />
          <LotDetailRow label={t("lbl_storage_location_short")} value={lot.storageLocation || ""} />
          <LotDetailRow label={t("lbl_production")} value={lot.dateProduction ? fmtDate(lot.dateProduction, dateFormat) : ""} />
          <LotDetailRow label={t("lbl_purchased")} value={lot.datePurchased ? fmtDate(lot.datePurchased, dateFormat) : ""} />
          {lot.dateOpened && (
            <LotDetailRow label={isJar ? t("lbl_opened_on") : t("lbl_previously_opened")}
              value={fmtDate(lot.dateOpened, dateFormat)} />
          )}
          {isFinished && lot.dateFinished && (
            <LotDetailRow label={t("lbl_finished_on")} value={fmtDate(lot.dateFinished, dateFormat)} />
          )}
          {isFinished && (
            <LotDetailRow label={t("lbl_lot_outcome")}
              value={lot.disposed ? t("lot_outcome_disposed") : t("lot_outcome_consumed")} />
          )}
          <LotDetailRow label={t("lbl_original_status")}
            value={lot.originalStatus === "jar" ? t("lot_jar") : t("lot_cellar")} />
          <LotDetailRow label={t("lbl_price_lbl")} value={lot.price ? `${fmtNum(lot.price, lang)} ${currencySymbol || "€"}` : ""} />
          {(() => {
            const sHref = safeSellerHref(lot.sellerUrl);
            const sVal = lot.seller || (sHref ? new URL(sHref).host : "");
            return (
              <LotDetailRow label={t("lbl_seller")} value={
                sHref && sVal
                  ? <a href={sHref} target="_blank" rel="noopener noreferrer" style={{ color: C.brassHi, textDecoration: "underline" }}>{sVal} ↗</a>
                  : sVal
              } />
            );
          })()}
        </div>

        {/* The sessions charged against THIS lot — date and
            grams smoked, each row opening the session's own fiche. Until now
            the lot told you how much was left and never what became of the
            rest, so "where did those 40 g go" had no answer on the screen that
            raises the question; the journal could be filtered by tobacco but
            never by LOT. Newest first, same order as the journal (they share
            one comparator). The row is a real button with an
            accessible name — `aria_session_card`, the key the journal cards
            already use, so the two doors to a session announce identically. */}
        <div style={{ marginBottom: 10 }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 8, padding: "0 2px 6px",
          }}>
            <Lbl color={C.tx3} size={11}>{t("lot_sessions")}</Lbl>
            {sessions.length > 0 && (
              <span style={{ fontFamily: F.mono, fontSize: fs(11), color: C.tx3 }}>
                {sessions.length}
              </span>
            )}
          </div>
          {sessions.length === 0 ? (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: CARD_BG, border: `1px solid ${C.rule}`,
              fontFamily: F.body, fontSize: fs(13.5), color: C.tx3,
            }}>{t("lot_sessions_none")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {sessions.map((s: any) => (
                <PressCard key={s.id} onClick={() => onOpenSession(s)}
                  ariaLabel={t("aria_session_card")}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", minHeight: 44,
                    background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                  }}>
                  <span style={{
                    flex: 1, minWidth: 0, fontFamily: F.body, fontSize: fs(14), color: C.tx,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {fmtDate(s.date, dateFormat)}
                    {s.time ? <span style={{ color: C.tx3 }}>{" · " + s.time}</span> : null}
                  </span>
                  <span style={{
                    flex: "0 0 auto", fontFamily: F.mono, fontSize: fs(13), color: C.brassHi,
                  }}>{fmtLotWeight(s.weightG, lang, weightUnit)}</span>
                  <Ico name="chevron" size={14} sw={1.8} color={C.tx3} />
                </PressCard>
              ))}
            </div>
          )}
        </div>

        {/* a prominent full-width "Dupliquer" action — the
            discoverable place to copy a lot (another tin of the same purchase).
            Sits above the Close/Delete/Edit row. */}
        <PressCard onClick={onDuplicate} ariaLabel={t("aria_duplicate_lot")} style={{
          padding: "11px 12px", marginTop: 6, marginBottom: 10,
          background: alpha(C.brassHi, "22"), border: `1px solid ${alpha(C.brassHi, "66")}`,
          borderRadius: 8, textAlign: "center",
          color: C.brassHi, fontFamily: F.mono, fontSize: fs(13.5),
          letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Ico name="copy" size={15} sw={1.8} />
          {t("lot_duplicate")}
        </PressCard>

        {/* Actions: Close · Delete · Edit (same layout as the session
            detail modal so the two read-only screens feel identical).
            `flexWrap`, a PRE-EXISTING clip found by rendering
            this modal in German while adding the session list above it, and
            measured identical at HEAD so it is not from that change: the three
            labels needed 349 px in a 340 px box at the DEFAULT text size (375
            at "L") and the third button read « BEARBE », cut at the panel
            edge. They are single words, so a flex item at its default
            `min-width: auto` could only clip. Wrapping costs a line ONLY where
            the three do not fit — verified in a browser: one line in fr / en /
            pt, two in de — and clips nothing. Same remedy as on the
            list controls rows. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
          <PressCard onClick={onClose} style={{
            flex: 1, padding: "11px 12px",
            background: CARD_BG, border: `1px solid ${C.rule}`,
            borderRadius: 8, textAlign: "center",
            color: C.tx, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {t("btn_close")}
          </PressCard>
          <PressCard onClick={onDelete} style={{
            flex: 1, padding: "11px 12px",
            background: alpha(C.oxblood, "22"), border: `1px solid ${alpha(C.oxblood, "66")}`,
            borderRadius: 8, textAlign: "center",
            color: C.oxbloodHi, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {t("btn_delete")}
          </PressCard>
          <PressCard onClick={onEdit} style={{
            flex: 1, padding: "11px 12px",
            background: alpha(C.brass, "33"), border: `1px solid ${alpha(C.brass, "88")}`,
            borderRadius: 8, textAlign: "center",
            color: C.brassHi, fontFamily: F.mono, fontSize: fs(13.5),
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {t("btn_edit")}
          </PressCard>
        </div>
      </div>
    </Modal>
  );
}

