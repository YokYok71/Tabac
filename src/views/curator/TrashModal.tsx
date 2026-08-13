// Curator Trash modal — dedicated modal for the soft-deleted
// rows that used to live as a section inside Settings. Mounted in
// CuratorApp at the same level as Search / Settings / Lightbox; open/close
// is driven by ctx.trashOpen / ctx.setTrashOpen.
//
// The modal lists every entity (Tobacco, Pipe, WishlistItem, Accessory,
// Session) and every Lot whose `deletedAt` is set, sorted newest first.
// Each row offers Restore (clears deletedAt) and × (permanent delete).
// A floating "Empty trash" CTA wipes every soft-deleted item in one go.
//
// Why a dedicated modal? The user wanted the trash icon on the Home top
// bar to land *directly* on the trash list — a section buried inside
// Settings required scrolling. A standalone modal is also visually
// cleaner: it owns the full screen so the entries get room to breathe,
// and it doesn't clutter the Settings UX for users who never deleted
// anything.

import { useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { fmtDateTime } from "../../utils.ts";
import { Lbl } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { Notice } from "../../components/curator/Notice.tsx";

// Null-proto maps — a trash entry `kind` equal to a prototype
// member would otherwise resolve to Object.prototype and defeat the fallbacks.
const KIND_KEY: Record<string, string> = Object.assign(Object.create(null), {
  tobacco: "kind_tobacco", pipe: "kind_pipe", wish: "kind_wish",
  accessory: "kind_accessory", session: "kind_session", lot: "kind_lot",
});
const KIND_ICON: Record<string, string> = Object.assign(Object.create(null), {
  tobacco: "leaf", pipe: "pipe", wish: "heart",
  accessory: "box", session: "flame", lot: "box",
});
const KIND_COLOR: Record<string, string> = Object.assign(Object.create(null), {
  tobacco: C.brassHi, pipe: C.oxbloodHi, wish: C.oxbloodHi,
  accessory: C.ember, session: C.sage, lot: C.brass,
});

type Entry = {
  kind: string;
  id: any;
  label: string;
  sublabel?: string | undefined;
  deletedAt: string;
};

function collect(dataRaw: any, tFn: ((k: string) => string) | undefined, weightUnit?: string): Entry[] {
  const tr = (k: string, frFallback: string) => (tFn ? tFn(k) : frFallback);
  const out: Entry[] = [];
  function take(arr: any, kind: string, labelFn: (it: any) => { label: string; sublabel?: string | undefined }) {
    (arr || []).forEach((it: any) => {
      if (it && it.deletedAt) {
        const { label, sublabel } = labelFn(it);
        out.push({ kind, id: it.id, label, sublabel, deletedAt: it.deletedAt });
      }
    });
  }
  const d = dataRaw || {};
  take(d.tobaccos,    "tobacco",   (t: any) => ({
    label: [t.brand, t.name].filter(Boolean).join(" — ") || "—",
  }));
  take(d.pipes,       "pipe",      (p: any) => ({
    label: [p.brand, p.name].filter(Boolean).join(" — ") || "—",
  }));
  take(d.wishlist,    "wish",      (w: any) => ({
    label: [w.brand, w.name].filter(Boolean).join(" — ") || "—",
  }));
  take(d.accessories, "accessory", (a: any) => ({
    label: [a.brand, a.name].filter(Boolean).join(" — ") || "—",
  }));
  take(d.sessions,    "session",   (s: any) => ({
    label: s.date || "—",
    sublabel: s.tobaccoSnapshot
      ? [s.tobaccoSnapshot.brand, s.tobaccoSnapshot.name].filter(Boolean).join(" — ")
      : undefined,
  }));
  // Soft-deleted lots live inside tobacco.lots[]. Skip lots whose parent
  // tobacco is itself trashed — restoring a lot before its parent is
  // meaningless (the parent would still be hidden), and the parent's
  // restore re-floats every untrashed lot for free.
  (d.tobaccos || []).forEach((t: any) => {
    if (!t || t.deletedAt || !Array.isArray(t.lots)) return;
    t.lots.forEach((l: any) => {
      if (!l || !l.deletedAt) return;
      const tobLbl = [t.brand, t.name].filter(Boolean).join(" — ")
        || tr("lbl_tobacco_simple", "tabac");
      const wInit = l.weightInitial || l.weightG || "";
      out.push({
        kind: "lot",
        id: l.id,
        label: tobLbl,
        // The unit follows the global preference (this component
        // destructured `t, dateFormat` only, so an oz user read "50g"), and
        // the box prefix is a t() key — "n°" is the French ordinal.
        sublabel: tr("lot_for_detail", "Lot")
          + (wInit ? ` · ${wInit}${weightUnit || "g"}` : "")
          + (l.boxNumber ? ` · ${tr("lbl_box_short", "Nº ")}${l.boxNumber}` : ""),
        deletedAt: l.deletedAt,
      });
    });
  });
  out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  return out;
}

function daysRemaining(deletedAt: string): number {
  const t = Date.parse(deletedAt);
  if (!isFinite(t)) return 30;
  return Math.max(0, 30 - Math.floor((Date.now() - t) / (24 * 3600 * 1000)));
}

export function CuratorTrashModal() {
  const ctx = useAppCtx();
  const {
    trashOpen, setTrashOpen,
    dataRaw, restoreFromTrash, restoreAllFromTrash, restoreSelectionFromTrash,
    permanentlyDelete, emptyTrash,
    t, dateFormat, weightUnit,
    triggerIosAutosaveReauth,
  } = ctx;
  const tr = (k: string, frFallback: string) => (t ? t(k) : frFallback);
  const close = () => setTrashOpen && setTrashOpen(false);
  const entries = trashOpen ? collect(dataRaw, t, weightUnit) : [];
  const total = entries.length;
  const kindLbl = (kind: string) => (t ? t(KIND_KEY[kind] || kind) : kind);
  // Collapsible help block — explains the 30-day window
  // and the available bulk actions without bloating the entry list.
  // Closed by default; remembering the state in a useState (not in
  // localStorage) is intentional — the explanation is short enough
  // that re-expanding it costs nothing.
  const [helpOpen, setHelpOpen] = useState(false);

  // Selective restore. The user can flip into "selection
  // mode" via the Sélection / Selection toggle, pick rows via a per-
  // row checkbox, and restore just those entries in one tap. Single-
  // row Restore / × buttons are hidden in selection mode; the
  // Tout restaurer / Vider la corbeille bulk row is replaced by a
  // contextual action row (Restaurer la sélection / Annuler).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  function entryKey(e: { kind: string; id: any }): string {
    return e.kind + ":" + String(e.id);
  }
  function toggleSelected(e: { kind: string; id: any }) {
    const k = entryKey(e);
    setSelectedKeys(function (prev) {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedKeys(new Set());
  }
  function restoreSelection() {
    // Route through the new atomic ctx action — looping
    // Calling restoreFromTrash per row had a closure / batching
    // bug where each call read stale `data` and React's batch
    // dropped all but the last save. The atomic helper builds ONE
    // save payload that un-trashes every picked row at once.
    if (!restoreSelectionFromTrash) return;
    if (selectedKeys.size === 0) return;
    restoreSelectionFromTrash(selectedKeys);
    exitSelectMode();
    // See TobaccoFormView for the iOS auto-save piggyback.
    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
  }

  return (
    <Modal open={!!trashOpen} onClose={close} maxWidth={540}
      ariaLabel={tr("trash_title", "Corbeille")}>
      <ModalHeader
        overline={tr("trash_overline", "Récupérable 30 jours")}
        title={tr("trash_title", "Corbeille")}
        onClose={close}
        accent={C.amber}
      />

      <div style={{ padding: "0 18px 18px" }}>
        {/* Hairline accent under the header */}
        <div style={{
          height: 1, background: `linear-gradient(90deg, ${C.rule2}, transparent)`,
          margin: "0 0 14px",
        }} />

        {/* Collapsible help. Closed by default — the
            entries list is what the user came for. Tap the row to
            unfold the rules of the 30-day window. */}
        <button
          type="button"
          onClick={() => setHelpOpen(!helpOpen)}
          aria-expanded={helpOpen}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            background: "transparent", border: "none", padding: "6px 4px",
            cursor: "pointer", color: C.tx2, fontFamily: F.body,
            fontSize: fs(13.5), letterSpacing: 0.2,
            textAlign: "left",
          }}>
          <Ico name="chevron" size={12} sw={2} color={C.amber}
            style={{
              transform: helpOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 160ms ease-out",
            }} />
          <span style={{ flex: 1 }}>
            {tr("trash_help_toggle", "Comment fonctionne la Corbeille ?")}
          </span>
        </button>
        {helpOpen && (
          <div style={{
            marginTop: 6, marginBottom: 14,
            padding: "12px 14px",
            background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
            fontFamily: F.body, fontSize: fs(14.5), lineHeight: 1.55, color: C.tx2,
          }}>
            <>
              <p style={{ margin: "0 0 8px" }}>
                {tr("trash_help_p1_pre", "Les éléments supprimés (tabacs, pipes, accessoires, envies, séances et lots) atterrissent ici pendant")}
                {" "}<strong style={{ color: C.amber }}>{tr("trash_help_p1_days", "30 jours")}</strong>{" "}
                {tr("trash_help_p1_post", "avant d'être effacés automatiquement au démarrage.")}
              </p>
              <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                <li style={{ marginBottom: 4 }}>
                  <strong style={{ color: C.sageHi }}>{tr("trash_restore", "Restaurer")}</strong>{" "}
                  {tr("trash_help_restore_desc", "renvoie un élément dans son inventaire.")}
                </li>
                <li style={{ marginBottom: 4 }}>
                  <strong style={{ color: C.oxbloodHi }}>×</strong>{" "}
                  {tr("trash_help_delete_desc", "supprime définitivement l'élément tout de suite.")}
                </li>
                <li style={{ marginBottom: 4 }}>
                  <strong style={{ color: C.sageHi }}>{tr("trash_restore_all", "Tout restaurer")}</strong>{" "}
                  {tr("trash_help_restoreall_desc", "sort toute la corbeille d'un coup.")}
                </li>
                <li>
                  <strong style={{ color: C.oxbloodHi }}>{tr("trash_empty_btn", "Vider la corbeille")}</strong>{" "}
                  {tr("trash_help_empty_desc", "efface tout définitivement d'un coup.")}
                </li>
              </ul>
              <p style={{ margin: 0, fontSize: fs(13.5), color: C.tx3 }}>
                {tr("trash_help_p2", "Les sauvegardes Google Drive et JSON conservent la corbeille : restaurer une sauvegarde ramène ces éléments dans l'état où ils étaient. Les exports CSV excluent la corbeille — ils représentent l'inventaire vivant.")}
              </p>
            </>
          </div>
        )}

        {total === 0 ? (
          // Empty-state — never reached via the Home indicator (which
          // hides itself when the trash is empty), but reachable if the
          // user opens the modal then taps "Empty trash" to clear the
          // last items.
          <div style={{
            padding: "30px 16px", textAlign: "center",
            background: C.bg2, border: `1px dashed ${C.rule2}`, borderRadius: 10,
            color: C.tx3,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              margin: "0 auto 12px",
              background: alpha(C.sage, "22"), border: `1px solid ${alpha(C.sage, "55")}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.sageHi,
            }}>
              <Ico name="check" size={26} sw={1.6} />
            </div>
            <div style={{
              fontFamily: F.display, fontStyle: "italic",
              fontSize: fs(18), color: C.cream, marginBottom: 6,
            }}>
              {tr("trash_empty_title", "Corbeille vide.")}
            </div>
            <div style={{ fontSize: fs(14.5), lineHeight: 1.55 }}>
              {tr("trash_empty_hint", "Les éléments supprimés patientent 30 jours ici avant d'être effacés définitivement.")}
            </div>
          </div>
        ) : (
          <>
            {/* Summary line */}
            <div style={{ marginBottom: 14 }}>
              <Notice tone="warn" icon="trash">
                {`${total} ${total > 1
                  ? tr("trash_summary_many", "éléments en attente de suppression définitive")
                  : tr("trash_summary_one", "élément en attente de suppression définitive")}`}
              </Notice>
            </div>

            {/* Entry list */}
            <div style={{
              background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 10,
              overflow: "hidden",
            }}>
              {entries.map((e, i) => {
                const accent = KIND_COLOR[e.kind] || C.tx2;
                const last = i === entries.length - 1;
                const days = daysRemaining(e.deletedAt);
                const k = entryKey(e);
                const checked = selectedKeys.has(k);
                return (
                  <div key={e.kind + ":" + e.id}
                    onClick={selectMode ? () => toggleSelected(e) : undefined}
                    // In select mode the whole row IS the checkbox —
                    // keyboard-operable (role/tabIndex/aria-checked + Enter/Space).
                    // Per-row buttons are hidden in select mode, so no nested
                    // interactive control. The inner box is purely visual.
                    {...(selectMode ? {
                      role: "checkbox" as const,
                      tabIndex: 0,
                      "aria-checked": checked,
                      "aria-label": tr("trash_select_aria_prefix", "Sélectionner ") + kindLbl(e.kind) + " " + e.label,
                      onKeyDown: (ev: any) => {
                        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleSelected(e); }
                      },
                    } : {})}
                    style={{
                      // flexWrap + a 100% flex-basis on the date line below is
                      // what puts that line on its own full-width row.
                      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                      padding: "12px 14px",
                      borderBottom: last ? "none" : `1px solid ${C.rule}`,
                      background: selectMode && checked ? alpha(C.sage, "0e") : C.bg,
                      cursor: selectMode ? "pointer" : "default",
                      transition: "background 120ms ease-out",
                    }}>
                    {/* Selection checkbox — only in select mode.
                        Presentational: the row owns the checkbox semantics. */}
                    {selectMode && (
                      <div
                        aria-hidden="true"
                        style={{
                          flexShrink: 0, width: 22, height: 22, borderRadius: 5,
                          border: `1.5px solid ${checked ? C.sageHi : C.rule2}`,
                          background: checked ? alpha(C.sage, "44") : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: C.sageHi, transition: "all 120ms ease-out",
                        }}>
                        {checked && <Ico name="check" size={14} sw={2.4} />}
                      </div>
                    )}
                    {/* Icon glyph */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: alpha(accent, "1f"), border: `1px solid ${alpha(accent, "44")}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: accent,
                    }}>
                      <Ico name={KIND_ICON[e.kind] as any || "more"} size={16} sw={1.7} />
                    </div>
                    {/* Label block.
                        The name WRAPS instead of ellipsizing, and
                        the date line moved out to its own full-width line below
                        the row (see after the actions). Making the restore
                        button icon-only won the column back from 0 to 124 px,
                        which was still not enough: this row carries 180 px of
                        fixed chrome (36 icon + 3 gaps + two 36 px buttons) out of
                        326 px, while the date line alone needs 234 px in German.
                        The row simply cannot hold that on one line in any
                        language — so nothing here was a translation problem, and
                        both clipped strings are ones the user needs in full:
                        WHAT is about to be deleted for ever, and WHEN it
                        expires. A taller row is the cheap side of that trade. */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Lbl color={accent} size={9}>{kindLbl(e.kind)}</Lbl>
                      <div style={{
                        fontFamily: F.display, fontSize: fs(16), color: C.ivory,
                        fontStyle: "italic", marginTop: 2,
                        overflowWrap: "anywhere",
                      }}>
                        {e.label}
                      </div>
                    </div>
                    {/* Per-row actions — hidden in select mode (the
                        contextual "Restaurer la sélection" CTA below
                        handles the bulk action). */}
                    {!selectMode && (
                      <>
                        <button
                          type="button"
                          onClick={() => restoreFromTrash && restoreFromTrash(e.kind, e.id)}
                          aria-label={tr("trash_restore", "Restaurer")}
                          title={tr("trash_restore", "Restaurer")}
                          // Was a TEXT button (`padding: 0 11px`
                          // + the uppercase word). With flexShrink:0 its width
                          // was set by the translation, and the label column
                          // beside it (flex:1, minWidth:0) absorbed the whole
                          // squeeze. MEASURED at 390px: the German
                          // "Wiederherstellen" renders 155px (169px at the "L"
                          // text size), leaving the column 35px / 21px — 72% /
                          // 84% of the item name and 83% / 91% of the
                          // "expires in N days" line clipped by the ellipsis.
                          // On the one screen whose entire purpose is telling
                          // you WHAT you are about to delete for ever and WHEN
                          // it expires. Every language clipped something (fr/es
                          // 25%, it 32%); German merely made it unusable.
                          // Icon-only is width-identical in all five, and the
                          // aria-label + title keep the word available. NOT
                          // solved by shortening the German: that
                          // class of fix on the Italian card badge and reverted
                          // it — the honest lever is the layout.
                          style={{
                            flexShrink: 0, width: 36, height: 36,
                            borderRadius: 8,
                            background: alpha(C.sage, "22"), color: C.sageHi,
                            border: `1px solid ${alpha(C.sage, "66")}`,
                            cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          <Ico name="restore" size={17} sw={1.9} />
                        </button>
                        <button
                          type="button"
                          onClick={() => permanentlyDelete && permanentlyDelete(e.kind, e.id)}
                          aria-label={tr("trash_delete_forever_aria", "Supprimer définitivement")}
                          style={{
                            flexShrink: 0, width: 36, height: 36,
                            borderRadius: 8,
                            background: "transparent", color: C.oxbloodHi,
                            border: `1px solid ${alpha(C.oxblood, "66")}`,
                            cursor: "pointer",
                            fontFamily: F.body, fontSize: fs(20), fontWeight: 700, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          ×
                        </button>
                      </>
                    )}
                    {/* The expiry line, on its own full-width row.
                        It needs 234 px in German and the label column can never
                        offer that — see the label block above. No ellipsis: this
                        is the modal's core promise ("recoverable for N days"),
                        so it wraps rather than being cut. */}
                    <div style={{
                      flexBasis: "100%", minWidth: 0,
                      fontFamily: F.mono, fontSize: fs(12), color: C.tx3,
                      letterSpacing: 0.3, overflowWrap: "anywhere",
                    }}>
                      {e.sublabel ? <>{e.sublabel} · </> : null}
                      {fmtDateTime(e.deletedAt, dateFormat)} · {days}{tr("trash_days_left", "j restants")}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bulk actions row — Restore-all on the left
                (sage, non-destructive, no confirm), Empty trash on the
                right (oxblood, irreversible, confirm prompt). The two
                mirror each other visually so the user can pick either
                end of the spectrum at a glance. */}
            {/* When in select mode, the bulk-actions row
                is replaced by a contextual "Restaurer la sélection"
                + "Annuler" pair. The user can pick a subset of rows
                and restore just those — useful after a mass-trash
                op where the user wants to put back only some of the
                items. The destructive bulk action (Empty trash) is
                deliberately NOT mirrored in select mode: bulk
                permanent-delete-of-a-selection would be a different
                feature and the user's request was restore-only. */}
            {selectMode ? (
              <div style={{
                marginTop: 16, display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  style={{
                    padding: "10px 16px", borderRadius: 8,
                    background: "transparent", color: C.tx2,
                    border: `1px solid ${C.rule2}`,
                    cursor: "pointer",
                    fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                  }}>
                  {tr("btn_cancel", "Annuler")}
                </button>
                <button
                  type="button"
                  onClick={restoreSelection}
                  disabled={selectedKeys.size === 0}
                  aria-disabled={selectedKeys.size === 0}
                  style={{
                    padding: "10px 16px", borderRadius: 8,
                    background: selectedKeys.size === 0 ? C.bg2 : alpha(C.sage, "22"),
                    color: selectedKeys.size === 0 ? C.tx3 : C.sageHi,
                    border: `1px solid ${alpha(selectedKeys.size === 0 ? C.rule : C.sage, "66")}`,
                    cursor: selectedKeys.size === 0 ? "not-allowed" : "pointer",
                    fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}>
                  <Ico name="check" size={13} sw={1.8} />
                  {`${tr("trash_restore_selection", "Restaurer la sélection")} (${selectedKeys.size})`}
                </button>
              </div>
            ) : (
              <div style={{
                marginTop: 16, display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                <button
                  type="button"
                  onClick={() => {
                    restoreAllFromTrash && restoreAllFromTrash();
                    // iOS auto-save piggyback.
                    triggerIosAutosaveReauth && triggerIosAutosaveReauth();
                  }}
                  style={{
                    padding: "10px 16px", borderRadius: 8,
                    background: alpha(C.sage, "22"), color: C.sageHi,
                    border: `1px solid ${alpha(C.sage, "66")}`,
                    cursor: "pointer",
                    fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}>
                  <Ico name="check" size={13} sw={1.8} />
                  {tr("trash_restore_all", "Tout restaurer")}
                </button>
                {/* Selection mode toggle — neutral colour because it
                    isn't an action by itself, just a mode switch. */}
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "transparent", color: C.tx2,
                    border: `1px solid ${C.rule2}`,
                    cursor: "pointer",
                    fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  {tr("trash_select_mode", "Sélection")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Empty trash IS the irreversible bulk action — keep
                    // the confirm prompt here even though we removed it
                    // from the individual delete paths. The 30-day buffer
                    // exists precisely so the user can change their mind;
                    // wiping it all sidesteps that buffer.
                    if (window.confirm(tr("trash_empty_confirm",
                      "Supprimer définitivement tous les éléments de la corbeille ?"))) {
                      emptyTrash && emptyTrash();
                      // iOS auto-save piggyback.
                      triggerIosAutosaveReauth && triggerIosAutosaveReauth();
                    }
                  }}
                  style={{
                    padding: "10px 16px", borderRadius: 8,
                    background: alpha(C.oxblood, "1f"), color: C.oxbloodHi,
                    border: `1px solid ${alpha(C.oxblood, "66")}`,
                    cursor: "pointer",
                    fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                    display: "inline-flex", alignItems: "center", gap: 8,
                  }}>
                  <Ico name="trash" size={13} sw={1.8} />
                  {tr("trash_empty_btn", "Vider la corbeille")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
