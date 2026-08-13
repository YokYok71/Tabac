// Curator MaintFormModal — add or edit a
// single maintenance entry ("Carnet d'entretien") inside a pipe fiche.
// Triggered from PipesDetailView. Wires to ctx.addMaintenance /
// ctx.updateMaintenance / ctx.removeMaintenance on save / delete.
//
// Model: pick ONE cleaning kind (léger / complet / sans nettoyage)
// then check any number of tasks done. Only light/full feed the reminder
// counter; "none" logs an intervention without resetting it.

import { useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { Lbl, PressCard, IconBtn } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { TextField, TextAreaField, SegmentedField } from "../../components/curator/FormFields.tsx";
import { MAINT_KINDS, MAINT_TASKS } from "../../constants.ts";
import { today } from "../../utils.ts";
import type { Pipe, MaintEntry } from "../../types.ts";

export interface MaintFormData {
  pipe: Pipe;
  entry?: MaintEntry;   // undefined → add mode
}

export interface MaintFormModalProps {
  open: boolean;
  onClose: () => void;
  data: MaintFormData | null;
  onSave: (entry: MaintEntry) => void;
  onDelete?: (() => void) | undefined;
}

const EMPTY: MaintEntry = { id: 0, date: "", kind: "light", tasks: [], notes: "" };

export function CuratorMaintFormModal({
  open, onClose, data, onSave, onDelete,
}: MaintFormModalProps) {
  const ctx = useAppCtx();
  const { t } = ctx;
  const [form, setForm] = useState<MaintEntry>(EMPTY);

  useEffect(() => {
    if (open && data) {
      if (data.entry) setForm(Object.assign({}, EMPTY, data.entry, {
        tasks: Array.isArray(data.entry.tasks) ? data.entry.tasks.slice() : [],
      }));
      // New entry defaults to today so the log reads chronologically without
      // the user having to fill the date every time.
      else setForm(Object.assign({}, EMPTY, { date: today(), tasks: [] }));
    }
  }, [open, data]);

  if (!data) return null;
  const isEdit = !!data.entry;
  const set = (patch: Partial<MaintEntry>) => setForm(prev => Object.assign({}, prev, patch));
  const toggleTask = (key: string) => setForm(prev => {
    const has = (prev.tasks || []).indexOf(key) >= 0;
    const tasks = has ? prev.tasks.filter(x => x !== key) : [...(prev.tasks || []), key];
    return Object.assign({}, prev, { tasks });
  });

  const kindColor: Record<string, string> = { light: C.sage, full: C.brass, none: C.tx3 };
  // Keys built via a variable so doc-check's literal-`t("…")` scanner doesn't
  // mistake the "maint_kind_" prefix for a real key (same pattern as AromaPicker).
  const kindOptions = MAINT_KINDS.map((k) => {
    const key = "maint_kind_" + k;
    return { value: k as string, label: t ? t(key) : k, color: kindColor[k] || C.sage };
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth={500} capHeight
      ariaLabel={isEdit
        ? (t ? t("maint_edit_title") : "Modifier l'entretien")
        : (t ? t("maint_new_title") : "Nouvel entretien")}>
      {/* Sticky top action bar — X (close) + Save, always visible. */}
      <div style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px 8px 12px", borderBottom: `1px solid ${C.rule}`,
      }}>
        <IconBtn icon="close" onClick={onClose} ariaLabel={t ? t("btn_close") : "Fermer"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: F.mono, fontSize: fs(10.5), letterSpacing: 1.2, textTransform: "uppercase",
            color: C.oxbloodHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{data.pipe.brand || "—"}</div>
          {/* The title WRAPS instead of ellipsizing. At 360px and the
              "L" text size the Italian "Nuova manutenzione" needs 158px in a
              148px box and lost its last word. The title set is bounded (two
              strings x six languages), so wrapping cannot run away; the brand
              overline above keeps nowrap+ellipsis because a brand name can be
              any length. Abbreviating the Italian would buy 10px and a vaguer
              word — the BARATTOLO trade already rejected elsewhere. */}
          <div style={{
            fontFamily: F.body, fontSize: fs(14), color: C.tx, fontWeight: 600,
            lineHeight: 1.25,
          }}>{isEdit
            ? (t ? t("maint_edit_title") : "Modifier l'entretien")
            : (t ? t("maint_new_title") : "Nouvel entretien")}</div>
        </div>
        <ModalAction variant="primary" onClick={() => onSave(form)}
          style={{ flex: "0 0 auto", padding: "9px 16px" }}>
          {isEdit ? (t ? t("btn_save") : "Enregistrer") : (t ? t("btn_add") : "Ajouter")}
        </ModalAction>
      </div>

      {/* Scrollable body — owns the scroll (overscroll-contained). */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
      <div style={{ padding: "14px 18px 4px" }}>
        <Lbl color={C.oxbloodHi}>{data.pipe.brand || "—"}</Lbl>
        <div style={{
          fontFamily: F.display, fontSize: fs(24), color: C.ivory,
          marginTop: 6, letterSpacing: -0.3, lineHeight: 1.15, fontStyle: "italic",
        }}>{data.pipe.name || "—"}</div>
      </div>

      {/* Fields — inset in a CARD_BG section so the C.bg field
          wells recess, matching the FormScreen edit forms. */}
      <div style={{ padding: "8px 18px 4px" }}>
      <div style={{ background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "14px 16px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
        <TextField label={t ? t("lbl_date") : "Date"} type="date"
          value={form.date || ""} onChange={(v) => set({ date: v })} />

        <SegmentedField<string>
          label={t ? t("maint_kind_label") : "Type de nettoyage"}
          value={form.kind || "light"}
          onChange={(v) => set({ kind: v as MaintEntry["kind"] })}
          options={kindOptions} />
        {form.kind === "none" && (
          <div style={{ marginTop: -8, fontSize: fs(13.5), color: C.tx3, fontFamily: F.body, lineHeight: 1.4 }}>
            {t ? t("maint_kind_none_hint") : "N'est pas compté dans le rappel de nettoyage."}
          </div>
        )}

        {/* Tasks — multi-select checkbox chips, descriptive only. */}
        <div>
          <div style={{
            fontFamily: F.mono, fontSize: fs(12), letterSpacing: 1.5, textTransform: "uppercase",
            color: C.tx2, marginBottom: 8,
          }}>{t ? t("maint_tasks_label") : "Tâches réalisées"}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MAINT_TASKS.map((key) => {
              const on = (form.tasks || []).indexOf(key) >= 0;
              const taskKey = "maint_task_" + key;
              const label = t ? t(taskKey) : key;
              return (
                <button key={key} type="button" role="checkbox" aria-checked={on}
                  aria-label={label}
                  onClick={() => toggleTask(key)}
                  style={{
                    padding: "7px 12px",
                    border: `1px solid ${on ? C.sage : C.rule}`,
                    background: on ? alpha(C.sage, "22") : C.bg2,
                    color: on ? C.sage : C.tx,
                    borderRadius: 8, cursor: "pointer",
                    fontFamily: F.body, fontSize: fs(15), fontWeight: on ? 700 : 500,
                  }}>
                  {on ? "✓ " : ""}{label}
                </button>
              );
            })}
          </div>
        </div>

        <TextAreaField label={t ? t("lbl_notes") : "Notes"}
          value={form.notes || ""} onChange={(v) => set({ notes: v })}
          placeholder={t ? t("maint_notes_ph") : "ex: 3 cure-pipes, ramonage léger"} />
      </div>
      </div>
      </div>

      {/* Bottom bar — delete only (edit mode); Save + close live in the top bar. */}
      {isEdit && onDelete && (
        <div style={{
          flex: "0 0 auto", padding: "10px 18px", display: "flex", gap: 8,
          borderTop: `1px solid ${C.rule}`,
        }}>
          <PressCard onClick={() => onDelete()} ariaLabel={t ? t("btn_delete") : "Supprimer"} style={{
            flex: 1,
            padding: "12px 14px", borderRadius: 8,
            background: "transparent", border: `1px solid ${alpha(C.oxblood, "55")}`,
            color: C.oxbloodHi,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
          }}>
            <Ico name="trash" size={14} sw={1.8} />
            {t ? t("btn_delete") : "Supprimer"}
          </PressCard>
        </div>
      )}
    </Modal>
  );
}
