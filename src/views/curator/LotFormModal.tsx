// Curator LotFormModal — Add or edit a single lot inside a tobacco fiche.
// Triggered from InventoryDetailView. Wires to ctx.addLotToTobacco /
// ctx.updateLotInTobacco when the user saves.

import { useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, catColor, CARD_BG } from "../../theme-curator.ts";
import { Lbl, PressCard, IconBtn } from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { MaturityChip, bucketFromAgingStatus } from "../../components/curator/MaturityChip.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import {
  TextField, SegmentedField,
} from "../../components/curator/FormFields.tsx";
import { effectiveAgingMax, nextBoxNumber } from "../../utils.ts";
import type { Tobacco, Lot } from "../../types.ts";

export interface LotFormData {
  tobacco: Tobacco;
  lot?: Lot;       // undefined → add mode
  idx?: number;    // index for edit mode
}

export interface LotFormModalProps {
  open: boolean;
  onClose: () => void;
  data: LotFormData | null;
  // `count` is the number of identical lots to create (add mode
  // only; always 1 on edit). Lets the user log a bulk purchase in one go.
  onSave: (lot: Lot, count: number) => void;
  onDelete?: (() => void) | undefined;
  // Duplicate this lot (edit mode only) — creates a fresh full copy
  // for another tin of the same purchase. Receives the current form values.
  onDuplicate?: ((lot: Lot) => void) | undefined;
  weightUnit?: string | undefined;
}

const EMPTY_LOT: Lot = {
  status: "cellar", originalStatus: "cellar", weightG: "50", weightInitial: "50",
  datePurchased: "", dateProduction: "", dateOpened: "", dateFinished: "",
  boxNumber: "", storageLocation: "", price: "", seller: "", disposed: false,
};

export function CuratorLotFormModal({
  open, onClose, data, onSave, onDelete, onDuplicate, weightUnit = "g",
}: LotFormModalProps) {
  const [form, setForm] = useState<Lot>(EMPTY_LOT);
  // Number of identical lots to create (add mode only). Held as a
  // STRING so the field can go EMPTY while the user retypes it:
  // a numeric state snapped a cleared field back to "1" (parseInt("")→NaN→1), so
  // the user "couldn't erase the 1". The effective count is derived (clamped
  // 1..50, blank→1) only when it's actually used.
  const [countStr, setCountStr] = useState("1");
  const count = Math.max(1, Math.min(50, parseInt(countStr, 10) || 1));
  const ctx = useAppCtx();
  const { t, currencySymbol = "€" } = ctx;

  useEffect(() => {
    if (open && data) {
      setCountStr("1");
      if (data.lot) {
        setForm(Object.assign({}, EMPTY_LOT, data.lot));
      } else {
        // New lot — pre-fill boxNumber to the next number (max numeric + 1)
        // across the whole cellar. `nextBoxNumber` returns "" when the user
        // doesn't number their boxes; the visible field then defaults to "1"
        // so they can start a sequence (they can always clear it).
        const nb = nextBoxNumber((ctx.data?.tobaccos as any[]) || []);
        setForm(Object.assign({}, EMPTY_LOT, { boxNumber: nb || "1" }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  if (!data) return null;
  const isEdit = !!data.lot;
  const accent = catColor(data.tobacco.category);
  const set = (patch: Partial<Lot>) => setForm(prev => Object.assign({}, prev, patch));

  // "finished" is hidden at creation — a lot cannot start
  // finished. The user must add it as cellar or jar and transition it
  // explicitly afterwards, otherwise originalStatus would silently
  // default to "cellar" with no meaningful semantic for a never-opened
  // lot that's already "consumed".
  const statusOptions: { value: "cellar" | "jar" | "finished"; label: string; color: string; icon: IcoName }[] = ([
    { value: "cellar" as const,   label: t ? t("lot_cellar") : "Cave",    color: C.sage,    icon: "box" as IcoName },
    { value: "jar" as const,      label: t ? t("lot_jar") : "Pot",        color: C.brassHi, icon: "jar" as IcoName },
    { value: "finished" as const, label: t ? t("lot_finished_lbl") : "Terminé", color: C.tx2,     icon: "check" as IcoName },
  ]).filter(s => isEdit || s.value !== "finished");

  // The primary action ("Enregistrer"/"Ajouter") lives in a STICKY
  // TOP bar (X on the left, Save on the right) so it stays reachable without
  // scrolling and can't overflow the footer; the fields scroll in a bounded,
  // scroll-contained body; delete/duplicate sit in a bottom bar (edit only).
  const saveLabel = isEdit
    ? (t ? t("btn_save") : "Enregistrer")
    : count > 1
      ? (t ? String(t("lot_add_n")).replace("{n}", String(count)) : `Ajouter ${count} lots`)
      : (t ? t("btn_add") : "Ajouter");
  return (
    <Modal open={open} onClose={onClose} maxWidth={500} capHeight
      ariaLabel={data?.lot
        ? (t ? t("lot_edit_title") : "Modifier le lot")
        : (t ? t("lot_new_title") : "Nouveau lot")}>
      {/* Sticky top action bar */}
      <div style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px 8px 12px", borderBottom: `1px solid ${C.rule}`,
      }}>
        <IconBtn icon="close" onClick={onClose} ariaLabel={t ? t("btn_close") : "Fermer"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: F.mono, fontSize: fs(10.5), letterSpacing: 1.2, textTransform: "uppercase",
            color: accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{data.tobacco.brand}</div>
          <div style={{
            fontFamily: F.body, fontSize: fs(14), color: C.tx, fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{isEdit
            ? (t ? t("lot_edit_title") : "Modifier le lot")
            : (t ? t("lot_new_title") : "Nouveau lot")}</div>
        </div>
        <ModalAction variant="primary" onClick={() => onSave(form, isEdit ? 1 : count)}
          style={{ flex: "0 0 auto", padding: "9px 16px" }}>
          {saveLabel}
        </ModalAction>
      </div>

      {/* Scrollable body — this region owns the scroll (overscroll-contained)
          so the background page never moves behind the modal. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
      <div style={{ padding: "14px 18px 4px" }}>
        <Lbl color={accent}>
          {data.tobacco.brand} · {isEdit
            ? `${t ? t("lot_for_detail") : "Lot"} Nº ${String((data.idx ?? 0) + 1).padStart(2, "0")}`
            : (t ? t("lot_new") : "Nouveau lot")}
        </Lbl>
        <div style={{
          fontFamily: F.display, fontSize: fs(24), color: C.ivory,
          marginTop: 6, letterSpacing: -0.3, lineHeight: 1.15,
        }}>
          <span style={{ fontStyle: "italic" }}>{data.tobacco.name}</span>
        </div>
        {/* Aging warning — fires when this specific lot exceeds (or approaches)
            the tobacco's max cellar age. Mirrors the inventory list & lot row
            badges so the user sees the same warning at every level. */}
        {isEdit && ctx.lotAgingStatus && (() => {
          const st = ctx.lotAgingStatus(form, effectiveAgingMax(data.tobacco));
          if (st !== "overaged" && st !== "approaching") return null;
          return (
            <div style={{ marginTop: 10 }}>
              <MaturityChip bucket={bucketFromAgingStatus(st)} size="lg" t={t} />
            </div>
          );
        })()}
      </div>

      {/* Status picker */}
      <div style={{ padding: "12px 18px 4px" }}>
        <Lbl color={C.tx2}>{t ? t("lbl_status") : "Statut"}</Lbl>
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          {statusOptions.map(s => {
            const on = form.status === s.value;
            return (
              <button key={s.value} type="button" onClick={() => {
                // Going to a non-finished status: always clear dateFinished + disposed
                // (CLAUDE.md invariant #12).
                // At creation, originalStatus tracks the picked status
                // (mapped: finished → cellar fallback since a lot
                // cannot start finished). In edit mode the user must
                // change originalStatus through its own picker so a
                // status flip doesn't silently rewrite history.
                const patch: any = s.value !== "finished"
                  ? { status: s.value, dateFinished: "", disposed: false }
                  : { status: s.value };
                if (!isEdit) patch.originalStatus = s.value === "jar" ? "jar" : "cellar";
                set(patch);
              }}
                style={{
                  flex: 1, padding: "10px 8px",
                  border: `1px solid ${on ? s.color : C.rule}`,
                  background: on ? alpha(s.color, "22") : C.bg2,
                  color: on ? s.color : C.tx,
                  borderRadius: 8, cursor: "pointer",
                  fontFamily: F.body, fontSize: fs(15),
                  fontWeight: on ? 700 : 500,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  transition: "background 200ms, color 200ms, border-color 200ms",
                }}>
                <Ico name={s.icon} size={18} sw={on ? 1.9 : 1.5} />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fields — inset in a CARD_BG section so the C.bg field
          wells recess into a card instead of sitting flat on the C.bg modal
          panel, matching the FormScreen edit forms. */}
      <div style={{ padding: "8px 18px 4px" }}>
      <div style={{ background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "14px 16px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        {/* Bulk-purchase quantity — create N identical lots at once.
            Add mode only. */}
        {!isEdit && (
          <div>
            <TextField label={t ? t("lot_quantity") : "Nombre de lots"}
              type="number" min="1" max="50" step="1" mono
              value={countStr}
              onChange={(v) => {
                // Keep digits only, but ALLOW empty so the user can clear the
                // field and retype. The value is clamped 1..50 (blank→1) at the
                // derived `count`, not here — so the field never fights typing.
                setCountStr(String(v).replace(/[^0-9]/g, "").slice(0, 2));
              }} />
            <div style={{ marginTop: 4, fontSize: fs(13.5), color: C.tx3, fontFamily: F.body, lineHeight: 1.45 }}>
              {t ? t("lot_quantity_hint") : "Achat groupé — crée plusieurs lots identiques en une seule fois. Un numéro de boîte chiffré s'incrémente (5, 6, 7…) ; tout autre libellé est recopié tel quel."}
            </div>
          </div>
        )}
        {/* Initial weight — at creation the user only enters
            this value, and the current weightG mirrors it on save.
            On edit we show both fields independently so the user can
            track consumption (weightG) while still correcting the
            recorded initial weight if needed. */}
        <TextField label={`${t ? t("lbl_initial_weight") : "Poids initial"} (${weightUnit})`}
          type="number" min="0" step="0.1" mono
          value={form.weightInitial || ""}
          onChange={(v) => {
            // On creation, weight = initial weight. The current-weight
            // field is hidden, so mirror the value here so the lot
            // starts at the right balance.
            if (!isEdit) set({ weightInitial: v, weightG: v });
            else set({ weightInitial: v });
          }} />

        {isEdit && (
          <TextField label={`${t ? t("lbl_current_weight") : "Poids actuel"} (${weightUnit})`}
            type="number" min="0" step="0.1" mono
            value={form.weightG || ""} onChange={(v) => set({ weightG: v })} />
        )}

        {/* Original status — only meaningful in edit mode.
            At creation, the chosen status IS the original status; we
            sync it implicitly on save. In edit mode we expose it so
            the user can correct mistakes from the legacy migration. */}
        {isEdit && (
          <div>
            <SegmentedField<"cellar" | "jar">
              label={t ? t("lbl_original_status") : "Statut d'origine"}
              value={(form.originalStatus as "cellar" | "jar") || "cellar"}
              onChange={(v) => set({ originalStatus: v })}
              options={[
                { value: "cellar", label: t ? t("lot_cellar") : "Cave" },
                { value: "jar",    label: t ? t("lot_jar")    : "Pot" },
              ]} />
            <div style={{ marginTop: 4, fontSize: fs(13.5), color: C.tx3, fontFamily: F.body, lineHeight: 1.45 }}>
              {t ? t("original_status_hint") : "Comment ce lot est entré en inventaire. Un lot marqué « Pot » ne repasse jamais en Cave tout seul, même si son poids égale le poids initial — vous pouvez toujours changer son statut à la main."}
            </div>
          </div>
        )}

        <TextField label={t ? t("lbl_box_optional") : "N° de boîte (optionnel)"}
          value={form.boxNumber || ""} onChange={(v) => set({ boxNumber: v })}
          placeholder={t ? t("ph_box_number") : "ex: B-2017-12"} mono />

        {/* Free-text storage location. Searchable from
            the inventory list (typing "armoire" finds every tobacco
            with a lot stored there). */}
        <TextField label={t ? t("lbl_storage_location") : "Lieu de stockage (optionnel)"}
          value={form.storageLocation || ""} onChange={(v) => set({ storageLocation: v })}
          placeholder={t ? t("storage_location_placeholder") : "ex: Armoire A · étagère 2"} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <TextField label={t ? t("lbl_production") : "Production"} type="text" mono
            placeholder="2017-09"
            value={form.dateProduction || ""} onChange={(v) => set({ dateProduction: v })} />
          <TextField label={t ? t("lbl_purchase_short") : "Achat"} type="date"
            value={form.datePurchased || ""} onChange={(v) => set({ datePurchased: v })} />
        </div>

        {/* Show the "Opened on" field whenever a date is recorded — even
            for a cellar lot that carries a legacy dateOpened (it was
            preserved through the now-removed auto-revert rule; the
            user can also manually flip jar→cellar here, in which case
            applyLifecycleDates "manual" mode clears dateOpened — but
            pre-existing migrated state may still hold it). Hiding the
            field would prevent the user from correcting an obsolete
            opening date on such a lot. */}
        {(form.status === "jar" || form.dateOpened) && (
          <TextField label={t ? t("lbl_opened_on") : "Ouvert le"} type="date"
            value={form.dateOpened || ""} onChange={(v) => set({ dateOpened: v })} />
        )}
        {form.status === "finished" && (
          <>
            <TextField label={t ? t("lbl_finished_on") : "Terminé le"} type="date"
              value={form.dateFinished || ""} onChange={(v) => set({ dateFinished: v })} />
            <SegmentedField<boolean>
              label={t ? t("lbl_lot_outcome") : "Fin de lot"}
              value={!!form.disposed}
              onChange={(v) => set({ disposed: v })}
              options={[
                { value: false, label: t ? t("lot_outcome_consumed") : "✓ Consommé", color: C.sage },
                { value: true,  label: t ? t("lot_outcome_disposed") : "🚮 Éliminé",  color: C.oxbloodHi },
              ]}
            />
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <TextField label={`${t ? t("lbl_price_lbl") : "Prix"} (${currencySymbol})`} type="number" step="0.01" mono
            value={form.price || ""} onChange={(v) => set({ price: v })} />
          <TextField label={t ? t("lbl_seller") : "Vendeur"}
            value={form.seller || ""} onChange={(v) => set({ seller: v })} />
          <TextField label={t ? t("lbl_seller_url") : "Site du vendeur"} type="url"
            placeholder="https://…"
            value={form.sellerUrl || ""} onChange={(v) => set({ sellerUrl: v })} />
        </div>
      </div>
      </div>
      </div>

      {/* Bottom bar — secondary actions only (delete / duplicate), edit mode.
          The primary Save + close (X) live in the sticky top bar above. */}
      {isEdit && (onDelete || onDuplicate) && (
        <div style={{
          flex: "0 0 auto", padding: "10px 18px", display: "flex", gap: 8,
          borderTop: `1px solid ${C.rule}`,
        }}>
          {onDelete && (
            <PressCard onClick={() => onDelete()} ariaLabel={t ? t("aria_delete_lot") : "Supprimer le lot"} style={{
              padding: "12px 14px", borderRadius: 8,
              background: "transparent", border: `1px solid ${alpha(C.oxblood, "55")}`,
              color: C.oxbloodHi,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
            }}>
              <Ico name="trash" size={14} sw={1.8} />
            </PressCard>
          )}
          {onDuplicate && (
            <PressCard onClick={() => onDuplicate(form)} ariaLabel={t ? t("aria_duplicate_lot") : "Dupliquer le lot"} style={{
              flex: 1,
              padding: "12px 14px", borderRadius: 8,
              background: "transparent", border: `1px solid ${alpha(C.brassHi, "55")}`,
              color: C.brassHi,
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6,
              fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
            }}>
              <Ico name="copy" size={14} sw={1.8} />
              {t ? t("lot_duplicate") : "Dupliquer"}
            </PressCard>
          )}
        </div>
      )}
    </Modal>
  );
}
