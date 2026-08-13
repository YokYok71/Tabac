// Curator AccessoryDetailView — single accessory fiche.

import { useAppCtx } from "../../AppContext.tsx";
import { safeBgUrl } from "../../utils/imgCache.ts";
import { alpha, fs, C, F, CARD_BG, CARD_SHADOW } from "../../theme-curator.ts";
import { fmtNum, safeSellerHref } from "../../utils.ts";
import {
  Stars, Lbl, IconBtn, ScreenWash, TopBar,
  SectionHead, SpecRow, PressCard,
} from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import { TagChipRow } from "../../components/curator/TagChipRow.tsx";
import { CuratorTrashIndicator } from "../../components/curator/TrashIndicator.tsx";
import { ACC_TYPES_EN, LIGHTER_FUELS_EN } from "../../constants.ts";
import type { Accessory } from "../../types.ts";

// Null-proto maps — a forged accessory `type` equal to a prototype
// member would otherwise resolve to Object.prototype and defeat the fallbacks
// (mirrors the AccListView fix).
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

export function CuratorAccessoryDetailView() {
  const ctx = useAppCtx();
  const {
    view, accDet, setAccDet, t, lang, xl, nav,
    setAccForm, setEditAccId, BA, deleteAccessory,
    imgLocal, setLightbox, currencySymbol = "€", navToAccByTag,
  } = ctx;
  if (view !== "acc" || !accDet) return null;
  const a: Accessory = accDet;
  const color = TYPE_COLORS[a.type] || C.brass;
  const icon = TYPE_ICONS[a.type] || "more";

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 130 }}>

        <TopBar
          leading={<IconBtn icon="back" onClick={() => setAccDet && setAccDet(null)} ariaLabel={t ? t("nav_back") : "Retour"} />}
          title={t ? t("ttl_accessory_fiche") : "Fiche accessoire"}
          trailing={<>
            <CuratorTrashIndicator />
            <IconBtn icon="edit" ariaLabel={t ? t("btn_edit") : "Modifier"}
              onClick={() => {
                if (setAccForm && BA && setEditAccId && nav) {
                  setAccForm(Object.assign({}, BA, a));
                  setEditAccId(a.id);
                  nav("editA");
                }
              }} />
            <IconBtn icon="trash" color={C.oxbloodHi}
              ariaLabel={t ? t("btn_delete") : "Supprimer"}
              onClick={() => { deleteAccessory && deleteAccessory(a.id); }} />
          </>}
        />

        {/* Hero */}
        <div style={{ padding: "8px 16px 22px" }}>
          <Lbl color={color}>{a.brand || "—"}</Lbl>
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
            <span style={{ fontStyle: "italic" }}>{a.name || "—"}</span>
          </h1>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Stars n={a.rating || 0} size={14} sequenced />
            <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
            <Lbl color={C.tx2}>{a.type ? (xl ? xl(a.type, ACC_TYPES_EN) : a.type) : "—"}</Lbl>
            {a.fuel && <>
              <span style={{ width: 3, height: 3, borderRadius: 2, background: C.tx3 }} />
              <Lbl color={C.tx3}>{xl ? xl(a.fuel, LIGHTER_FUELS_EN) : a.fuel}</Lbl>
            </>}
            {/* Status badge (Actif / Retiré). Same pattern
                as the PipesDetailView hero badge. The comment
                in the file said "kept visible via the badge next to the
                title" but no badge was actually rendered — accessoires
                were the only detail view to silently drop the status. */}
            <span style={{
              padding: "2px 7px", borderRadius: 4,
              background: a.status === "active" ? alpha(C.sage, "22") : alpha(C.tx3, "22"),
              color: a.status === "active" ? C.sage : C.tx3,
              fontFamily: F.mono, fontSize: fs(11), letterSpacing: 1.2,
              textTransform: "uppercase", fontWeight: 700,
            }}>{a.status === "active"
                ? (t ? t("acc_active") : "Actif")
                : (t ? t("acc_retired") : "Retiré")}</span>
          </div>
        </div>

        {/* Imagery slot */}
        {/* Was a bare `<div onClick>` — no role, no tabIndex, no key
        handler. The small extra-photo thumbnails one scroll below are real
        <button>s, so a keyboard / switch user could open EVERY small photo
        but not the big main one, and a screen reader was never told the hero
        image was actionable. PressCard supplies role="button", tabIndex,
        Enter/Space, the focus ring and the iOS reliable-tap path in one
        wrapper. jest-axe has no rule for div[onClick], which is how three of
        these survived a hand a11y audit. */}
        <PressCard
          onClick={a.imageUrl ? () => setLightbox && setLightbox(a.imageUrl) : undefined}
          ariaLabel={t ? t("lbl_image") : "Image"}
          style={{
            margin: "0 12px 18px", height: 200,
            background: a.imageUrl
              ? `${safeBgUrl((imgLocal && imgLocal[a.imageUrl]) || a.imageUrl)} center/contain no-repeat`
              : `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
            // See PipesDetailView — no frame around a real
            // photo; the empty-slot placeholder keeps its border.
            ...(a.imageUrl ? {} : { border: `1px solid ${C.rule}` }),
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            color, overflow: "hidden", position: "relative",
            cursor: a.imageUrl ? "pointer" : "default",
          }}>
          {!a.imageUrl && <Ico name={icon} size={80} sw={1.1} />}
        </PressCard>

        {/* Acquisition */}
        {(a.datePurchased || a.price || a.seller) && (
          <>
            <SectionHead title={t ? t("sec_acquisition") : "Acquisition"} accent={C.sage} />
            <div style={{ padding: "0 12px 18px" }}>
              <div style={{
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8,
                boxShadow: CARD_SHADOW,
                padding: "10px 14px",
              }}>
                {/* Accessory datePurchased stored as
                    year-only — render raw, no fmtDate. */}
                <SpecRow label={t ? t("lbl_purchased_on") : "Achat"} value={a.datePurchased || ""} />
                <SpecRow label={t ? t("lbl_price_lbl") : "Prix"} value={a.price ? `${fmtNum(a.price, lang)} ${currencySymbol}` : ""} />
                {(() => {
                  const sHref = safeSellerHref(a.sellerUrl);
                  const sVal = a.seller || (sHref ? new URL(sHref).host : "");
                  return <SpecRow label={t ? t("lbl_seller") : "Vendeur"} value={sVal} {...(sHref ? { href: sHref } : {})} last />;
                })()}
              </div>
            </div>
          </>
        )}

        {/* Status toggle PressCard removed from the
            read-only detail view (same as PipesDetailView). Retiring
            (or reactivating) an accessory is now exclusively a write
            action that lives in the edit form (AccessoryFormView's
            status SegmentedField). The detail keeps the current status
            visible via the badge next to the title; the user opens
            Edit to flip it. */}

        {/* Notes */}
        {a.notes && (
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
            }}>« {a.notes} »</div>
          </div>
        )}

        {/* User tags / collections — tap to filter the accessory
            list by that collection (back returns to this fiche). */}
        {/* The item's own collections, folded behind the label —
            shared component, was a byte-identical copy in all three fiches. */}
        <TagChipRow tags={(a as any).tags} onOpen={(tg) => navToAccByTag && navToAccByTag(tg)} t={t} />

        {/* Delete button moved to the TopBar (trash IconBtn)
            to match the tobacco / pipe detail views. The bottom CTA
            block was the last visual asymmetry between the three
            detail screens. */}
      </div>
    </div>
  );
}

