// Curator confirmation overlays — destructive action confirmations
// (delete tobacco, etc.) + auxiliary banners (saveError, saveWarn,
// update pill, "just updated" toast). Mirrors the side-effects that
// live above all views.

import { useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { pickTopBanner } from "../../utils/bannerStack.ts";
import { pickBottomToast, BOTTOM_TOAST_OFFSET } from "../../utils/bottomToast";
import { APP_BUILD , WELCOME_KEY} from "../../constants.ts";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { PressCard, Spinner } from "../../components/curator/primitives.tsx";
import { Ico } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { getDiagnosticSnapshot } from "../../utils/diagnostic.ts";
import { lsSet, lsRemove } from "../../utils/appStorage.ts";

// CuratorDelConfirmModal removed — every entity now
// soft-deletes into the Trash (30-day retention) with an 8 s undo
// toast as the immediate safety net. The confirm dialog was redundant.

// ─── Save error banner ───────────────────────────────────────
export function CuratorSaveErrorBanner() {
  const ctx = useAppCtx();
  const { saveError, setSaveError, modalOpenTs, setImportModal, setSettingsTab } = ctx;
  // One ordered decision for every top:0 banner — see bannerStack.ts.
  if (pickTopBanner(ctx as any) !== "saveError") return null;
  return (
    <div
      role="alert"
      data-top-banner=""
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 492,
        background: C.oxbloodHi, color: C.ivory,
        paddingTop: `max(env(safe-area-inset-top, 0), 10px)`,
        paddingBottom: 10, paddingLeft: 16, paddingRight: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      }}>
      {/* The ACTION is a real <button>, not the container.
          All four top banners were a bare <div onClick> whose entire surface
          was the action — no role="button", no tabIndex, no key handler — so a
          keyboard or screen-reader user was TOLD there was a problem (the
          role="alert" works) and given no way to act on it. Exactly the defect
          fixed on the update pill's <span onClick>, in four more
          places. Three of the four carry a dismiss ×, so the container cannot
          itself become a <button> (nested interactives); the text is the
          button and the × stays its sibling, which is the same shape the pill
          ended up with. role="alert" stays on the container so the
          announcement is unchanged. */}
      <button
        type="button"
        onClick={() => {
          setSaveError && setSaveError(null);
          if (modalOpenTs) modalOpenTs.current = Date.now();
          // Storage save error → land the user on the Data
          // tab (Drive backup, Export & Import) where the recovery
          // actions live.
          if (setSettingsTab) setSettingsTab("data");
          setImportModal && setImportModal(true);
        }}
        style={{
          display: "block", width: "100%", background: "transparent",
          border: "none", padding: 0, textAlign: "center", cursor: "pointer",
          color: "inherit", font: "inherit",
          fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        }}>
        {saveError}
      </button>
    </div>
  );
}

// ─── Save warning banner (storage near full) ─────────────────
export function CuratorSaveWarnBanner() {
  const ctx = useAppCtx();
  const { saveWarn, setSaveWarn, dismissQuotaWarn, modalOpenTs, setImportModal, setSettingsTab, t } = ctx;
  if (pickTopBanner(ctx as any) !== "saveWarn") return null;
  return (
    <div
      role="alert"
      data-top-banner=""
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 491,
        background: C.amber, color: C.ink,
        paddingTop: `max(env(safe-area-inset-top, 0), 10px)`,
        paddingBottom: 10, paddingLeft: 16, paddingRight: 40,
        fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <button
        type="button"
        onClick={() => {
          setSaveWarn && setSaveWarn(null);
          if (modalOpenTs) modalOpenTs.current = Date.now();
          // Quota / save warning → land on the Data tab
          // (Export & Import is where the user would clear or back up).
          if (setSettingsTab) setSettingsTab("data");
          setImportModal && setImportModal(true);
        }}
        style={{
          flex: 1, textAlign: "center", background: "transparent",
          border: "none", padding: 0, cursor: "pointer",
          color: "inherit", font: "inherit",
          fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        }}>{saveWarn}</button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setSaveWarn && setSaveWarn(null);
          // The dismissal timestamp used to be recorded here so the quota probe
          // would not immediately re-raise the same warning.
          //
          // It wrote that key UNCONDITIONALLY, and `saveWarn`
          // is a SHARED channel: the tasting auto-end notice
          // rides it too, so closing « Dégustation clôturée automatiquement »
          // silenced the "storage 80 % full" warning for SEVEN DAYS. A
          // protection disarmed by a gesture that has nothing to do with it,
          // with nothing said. The quota hook is the only place that knows
          // whether the banner on screen is its own, so the write moved there
          // (`raisedRef`, the same discrimination given to the clearing
          // branch). This banner just reports the dismissal.
          dismissQuotaWarn && dismissQuotaWarn();
        }}
        aria-label={t ? t("btn_close") : "Fermer"}
        style={{
          position: "absolute", right: 10,
          background: "transparent", border: "none", color: C.ink,
          fontSize: fs(20), fontWeight: 700, cursor: "pointer", padding: "2px 8px", lineHeight: 1,
        }}>×</button>
    </div>
  );
}

// ─── Update pill (floating) ──────────────────────────────────
export function CuratorUpdatePill() {
  const ctx = useAppCtx();
  const {
    newerBuild, importModal, updatePillDismissed, setUpdatePillDismissed, autoUpdateCountdown,
    modalOpenTs, setImportModal, setUpdateStatus, setSettingsTab, t,
  } = ctx;
  // Keyed on `newerBuild`, not `updateAvailable`.
  //
  // `updateAvailable` is only set on the path that intends to show a
  // countdown, so the pill vanished in exactly the states where a MANUAL
  // route matters most: while the update is deferred behind an open form,
  // while the anti-loop latch has stood down, and on the silent data_only
  // path. `newerBuild` is recorded on every detection and gated by nothing,
  // so the pill is now present whenever an update is pending —
  // which is the whole point of a pill.
  // Audit: also hidden while the countdown dialog is up.
  // The pill sits at zIndex 490 and the shared Modal at 200, so it painted ON
  // TOP of the dimmed backdrop — outside the focus trap, brighter than the
  // dialog, offering the same action twice, and still tappable through the
  // scrim (which opened Settings UNDERNEATH a dialog that then reloaded the
  // app 10 s later). A regression from combining the two preceding changes.
  if (!newerBuild || importModal || updatePillDismissed) return null;
  if (autoUpdateCountdown !== null && autoUpdateCountdown !== undefined) return null;
  return (
    <div style={{
      position: "fixed", bottom: 90, right: 14, zIndex: 490,
      background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
      color: C.bg, borderRadius: 999,
      padding: "8px 12px",
      fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
      boxShadow: `0 8px 24px ${alpha(C.brass, "55")}`,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <button
        type="button"
        onClick={() => {
          if (modalOpenTs) modalOpenTs.current = Date.now();
          // Pre-position the user on the Application tab
          // (where the update banner + "Mettre à jour" CTA live) BEFORE
          // opening Settings. It used to scroll to a DOM
          // anchor inside Settings — meaningless now that the section
          // is hidden behind a tab. Setting the tab makes the relevant
          // content immediately visible on open.
          if (setSettingsTab) setSettingsTab("app");
          setImportModal && setImportModal(true);
          setUpdateStatus && setUpdateStatus(newerBuild);
        }}
        /* Audit HIGH: a real <button>. This was a
           <span onClick> with no role, no tabIndex and no key handler — not in
           the tab order, announced as static text. The × beside it IS a proper
           button with an aria-label, so a keyboard or screen-reader user could
           DISMISS the update notification but never ACT on it: the one control
           just rewritten to be explicit was the one nobody could reach.
           CLAUDE.md's own a11y invariant forbids exactly this shape. */
        style={{
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", padding: 0,
          font: "inherit", color: "inherit", minHeight: 24,
        }}>
        {/* It said "✓ v1.5" and nothing else. A CHECKMARK next
            to a version number reads as "you are up to date" — the exact
            opposite of the message — and the version alone is uninformative
            because it is usually the same minor the user is already running
            (the build is what changed). Reported from the app as "that is all,
            not explicit". Now the circular-refresh glyph and the words that
            already existed in the dictionary and this component never used:
            `upd_do` ("Mettre à jour"), with the build that is waiting. */}
        <Ico name="restore" size={13} sw={2} />
        {(t ? t("upd_do") : "Mettre à jour") + " · " + newerBuild.build}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setUpdatePillDismissed && setUpdatePillDismissed(true); }}
        aria-label={t ? t("btn_close") : "Fermer"}
        style={{
          background: "transparent", border: "none", color: C.bg,
          fontSize: fs(17), fontWeight: 700, cursor: "pointer",
          padding: 0, lineHeight: 1,
        }}>×</button>
    </div>
  );
}

// ─── Auto-update countdown ───────────────────────────────────
/**
 * A real dialog, not a hairline strip.
 *
 * Until now this was a ~15 px full-width bar pinned to `top: 0`, alive for ten
 * seconds. On an installed iOS PWA it lands directly under the status bar and
 * immediately above the app's own brass masthead, in the same brass gradient —
 * so the one moment the app tells you it is about to RELOAD ITSELF was the
 * easiest thing on screen to miss. Reported from the app: "it is mainly the
 * banner that is not explicit; there should be a countdown and a bigger
 * pop-up".
 *
 * What a reload costs is why the prominence is warranted rather than merely
 * nicer: the app disappears and comes back. `deferAutoUpdate`
 * already guarantees this can never fire over unsaved input, so the dialog is
 * never a trap — but it must be SEEN, and a 15 px strip in the app's own
 * accent colour is not seen.
 *
 * Uses the shared Modal so it inherits role="dialog", the focus trap, Escape,
 * and the modal stack — which makes system-back and the edge-swipe mean "Plus
 * tard" for free, rather than doing nothing.
 */
export function CuratorAutoUpdateBanner() {
  const ctx = useAppCtx();
  const { autoUpdateCountdown, cancelAutoUpdate, dismissCountdown, doUpdate, newerBuild, t } = ctx;
  const active = autoUpdateCountdown !== null && autoUpdateCountdown !== undefined;
  return (
    <Modal
      open={!!active}
      /* Audit: the backdrop / Escape / system-back dismiss the
         countdown for THIS occurrence only — they must not latch the durable
         "declined this build" flag the way the explicit Plus tard button does.
         The panel is maxWidth 380 at align:top, so most of the screen is
         backdrop: an accidental tap was being read as the same deliberate
         decision, silently, with no way back except the manual route. */
      onClose={() => dismissCountdown && dismissCountdown()}
      maxWidth={380}
      ariaLabel={t ? t("upd_available") : "Nouvelle version disponible"}>
      {/* Audit: 20px, not 2. `Modal` defaults `padding` to 0 and
            no caller passes it, so this panel's own padding is the only inset —
            at 2px the buttons ran into a borderRadius:14 overflow-hidden corner.
            Siblings use 18-26 (WelcomeModal 26/24/22, unsaved-changes 18). */}
      <div style={{ textAlign: "center", padding: "20px 20px 18px" }}>
        <div style={{
          fontFamily: F.display, fontStyle: "italic", fontSize: fs(24),
          color: C.title, marginBottom: 6,
        }}>
          {t ? t("upd_available") : "Nouvelle version disponible"}
        </div>
        {newerBuild && (
          <div style={{ fontFamily: F.mono, fontSize: fs(13), color: C.tx3, marginBottom: 16 }}>
            {"v" + newerBuild.version + " · " + newerBuild.build}
          </div>
        )}
        {/* The countdown is the point of the dialog, so it is the biggest
            thing in it. A number that large also makes the deadline legible
            at a glance from across a room, which a 15 px strip never was. */}
        <div style={{
          fontFamily: F.mono, fontSize: fs(52), fontWeight: 700,
          color: C.brassHi, lineHeight: 1.05,
        }}>
          {autoUpdateCountdown ?? ""}
        </div>
        <div style={{ fontFamily: F.body, fontSize: fs(14), color: C.tx2, margin: "6px 0 18px" }}>
          {t ? t("upd_auto_body") : "L'application va redémarrer pour installer la mise à jour."}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ModalAction variant="primary" onClick={() => doUpdate && doUpdate()}>
            {t ? t("upd_do_now") : "Mettre à jour maintenant"}
          </ModalAction>
          <ModalAction variant="secondary" onClick={() => cancelAutoUpdate && cancelAutoUpdate()}>
            {t ? t("upd_auto_later") : "Plus tard"}
          </ModalAction>
        </div>
      </div>
    </Modal>
  );
}

// ─── Export reminder banner ──────────────────────────────────
// Surfaces when the user hasn't saved (Drive or local file) for > 30
// days, OR has 5+ entries and never exported. Sage-tinted (positive
// nudge, not an error). Tap the banner to open Settings → Export.
// × snoozes for 7 days; the App-level probe re-raises automatically
// after another save or once the snooze expires.
export function CuratorExportReminderBanner() {
  const ctx = useAppCtx();
  const {
    setExportReminder, modalOpenTs, setImportModal,
    setSettingsTab, t,
  } = ctx;
  // ONE ordered decision for every top:0 banner (bannerStack.ts).
  // This used to yield to saveError + saveWarn only, so it could render OVER
  // the cloud-newer offer at the same z-index — and its whole surface opens
  // the backup screen.
  if (pickTopBanner(ctx as any) !== "exportReminder") return null;
  return (
    <div
      // `status`, NOT `alert`. An overdue backup is routine news,
      // and `alert` is the assertive class that interrupts — the exact
      // distinction drawn when the Settings update notice moved
      // off tone="warn" ("the same assertive ARIA class as a save failure, for
      // routine news"). Before this it carried no role at all, so a
      // screen-reader user was never told the banner had appeared.
      role="status"
      data-top-banner=""
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 489,
        background: C.sage, color: C.bg,
        paddingTop: `max(env(safe-area-inset-top, 0), 10px)`,
        paddingBottom: 10, paddingLeft: 16, paddingRight: 40,
        fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <button
        type="button"
        onClick={() => {
          if (modalOpenTs) modalOpenTs.current = Date.now();
          // Open Settings on the Data tab — that's where
          // Drive backup + Export/Import live. Without this, the user
          // would land on whichever tab they last visited (or the
          // default Data tab on a fresh first open), which may not be
          // Data if they were just tweaking Préférences or App.
          if (setSettingsTab) setSettingsTab("data");
          setImportModal && setImportModal(true);
        }}
        style={{
          flex: 1, textAlign: "center", background: "transparent",
          border: "none", padding: 0, cursor: "pointer",
          color: "inherit", font: "inherit",
          fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        }}>
        💾 {t ? t("export_reminder_banner") : "Ça fait un moment — sauvegardez votre cave. La sauvegarde cloud protège vos données et synchronise vos appareils (ou export JSON)."}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExportReminder && setExportReminder(false);
          // 7-day snooze; cleared automatically by a fresh save event.
          lsSet("cave-export-reminder-dismissed", String(Date.now()));
        }}
        aria-label={t ? t("btn_close") : "Fermer"}
        style={{
          position: "absolute", right: 10,
          background: "transparent", border: "none", color: C.bg,
          fontSize: fs(20), fontWeight: 700, cursor: "pointer", padding: "2px 8px", lineHeight: 1,
        }}>×</button>
    </div>
  );
}

// ─── Undo toast ──────────────────────────────────────────────
// Renders for 8 s after any undoable action. Tapping "Annuler" calls
// `undoToast.restoreFn`, which swaps the data back to the pre-action
// snapshot. The auto-clear timer lives in App.tsx so it survives this
// component re-rendering on every ctx tick.
//
// ── THE OVERLINE MUST COME FROM THE KIND ───────────────────────────────────
// This toast was written for deletes only, so the verb was the literal
// `t("lbl_deleted")` and the kind fell back to `t(undoToast.kind)`. A later change
// then pushed a NON-delete through it — the bulk catalogue pass — and the app
// announced « CATALOGUE · SUPPRIMÉ » for an update, on a toast whose only
// button says "Annuler": the one reading a user must not be given after
// applying an update to their whole cellar. Reported from the app.
//
// The kind label was ALSO wrong and looked right by accident: `catalogue` is
// not a dictionary key, so `translate` fell back to the RAW KEY and the screen
// rendered the internal kind name — which happens to be a French word. In
// German the same line reads « CATALOGUE · GELÖSCHT ». Same class as the
// `dict[k] || k` defect, where a fallback made a bug invisible.
//
// So ONE table gives both halves, and an UNKNOWN kind renders NO overline
// rather than a guessed one: a future action added without a row here loses
// information, never states something false. `restoreFn` still works.
//
// Note what the per-kind verb slot now makes possible, and what is deliberately
// NOT done with it: French has long shipped « Pipe · supprimé » / « Séance · supprimé »
// — the verb agrees with nothing, because there was only one.
// The table could now give each kind its own form; that is a shipped-wording
// change in five languages, so it stays a separate decision rather than being
// smuggled into a bug fix.
const UNDO_KIND: Record<string, { kind: string; verb: string }> =
  Object.assign(Object.create(null), {
    tobacco:   { kind: "kind_tobacco",   verb: "lbl_deleted" },
    pipe:      { kind: "kind_pipe",      verb: "lbl_deleted" },
    accessory: { kind: "kind_accessory", verb: "lbl_deleted" },
    session:   { kind: "kind_session",   verb: "lbl_deleted" },
    wish:      { kind: "kind_wish",      verb: "lbl_deleted" },
    // The maintenance log was the app's ONLY delete with no
    // undo, no trash and no confirm — on an entry carrying free-text notes.
    maintenance: { kind: "kind_maintenance", verb: "lbl_deleted" },
    catalogue: { kind: "kind_catalogue", verb: "lbl_updated" },
  });

export function CuratorUndoToast() {
  const ctx = useAppCtx();
  const { undoToast, setUndoToast, t } = ctx;
  // Absent, or outranked by a more urgent bottom toast (utils/bottomToast).
  if (!undoToast || pickBottomToast(ctx) !== "undo") return null;
  const meta = UNDO_KIND[String(undoToast.kind)];
  const overline = meta && t
    ? String(t(meta.kind)) + " · " + String(t(meta.verb))
    : "";
  const undo = t ? t("btn_undo") : "Annuler";
  return (
    <div style={{
      position: "fixed", bottom: BOTTOM_TOAST_OFFSET,
      left: "50%", transform: "translateX(-50%)",
      zIndex: 500,
      background: CARD_BG, color: C.tx,
      border: `1px solid ${C.rule2}`,
      borderRadius: 10, padding: "10px 8px 10px 14px",
      fontFamily: F.body, fontSize: fs(15),
      boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", gap: 10,
      maxWidth: "calc(100% - 24px)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: 1, minWidth: 0,
      }}>
        {overline ? (
          <span style={{
            fontFamily: F.mono, fontSize: fs(11.5), color: C.tx3,
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          }}>{overline}</span>
        ) : null}
        <span style={{
          color: C.ivory, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", maxWidth: 240,
        }}>{undoToast.label}</span>
      </div>
      <button
        type="button"
        onClick={() => undoToast.restoreFn && undoToast.restoreFn()}
        style={{
          background: alpha(C.brass, "22"), color: C.brassHi,
          border: `1px solid ${alpha(C.brass, "66")}`, borderRadius: 8,
          padding: "8px 14px", cursor: "pointer",
          fontFamily: F.mono, fontSize: fs(12.5), letterSpacing: 1.2,
          textTransform: "uppercase", fontWeight: 700,
        }}>
        {undo}
      </button>
      <button
        type="button"
        onClick={() => setUndoToast && setUndoToast(null)}
        aria-label={t ? t("aria_dismiss") : "Fermer"}
        style={{
          background: "transparent", border: "none", color: C.tx3,
          cursor: "pointer", padding: "4px 6px",
          fontSize: fs(17), lineHeight: 1,
        }}>×</button>
    </div>
  );
}

// ─── Just-updated toast ──────────────────────────────────────
export function CuratorJustUpdatedToast() {
  const ctx = useAppCtx();
  const { justUpdated } = ctx;
  if (!justUpdated || pickBottomToast(ctx) !== "justUpdated") return null;
  return (
    <div style={{
      position: "fixed", bottom: BOTTOM_TOAST_OFFSET, left: "50%", transform: "translateX(-50%)",
      zIndex: 500,
      background: C.sage, color: C.bg,
      borderRadius: 10, padding: "10px 20px",
      fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
      boxShadow: `0 8px 30px ${alpha(C.sage, "44")}`,
      whiteSpace: "nowrap", pointerEvents: "none",
      display: "inline-flex", alignItems: "center", gap: 8,
    }}>
      <Ico name="check" size={15} sw={2.2} />
      Build {APP_BUILD}
    </div>
  );
}

// ─── First-launch language auto-detection toast ──────────────
// When main.jsx seeds the UI language from the browser on first launch it
// stamps `cave-lang-auto`. This toast surfaces that once — "language set
// automatically · change" — so a wrong guess is easy to fix. It waits until
// the welcome modal has been dismissed (so the two don't stack on the very
// first open), then shows for 8 s. Any explicit language pick (terms gate or
// Settings) clears the flag first via saveLang, so a deliberate choice never
// triggers it. Reads/clears the flag itself — no App.tsx state needed.
export function CuratorLangDetectedToast() {
  const ctx = useAppCtx();
  const { t, setSettingsTab, setImportModal } = ctx;
  const [show, setShow] = useState(false);
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      try {
        const auto = localStorage.getItem("cave-lang-auto");
        if (!auto || tries > 50) { clearInterval(id); return; } // cancelled / gave up (~60s)
        if (localStorage.getItem(WELCOME_KEY) === "1") {
          clearInterval(id);
          setShow(true);
        }
      } catch (_e) { clearInterval(id); }
    }, 1200);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(false), 8000);
    return () => clearTimeout(id);
  }, [show]);
  // Its "show" is LOCAL state (a polling effect waits for the welcome modal to
  // be dismissed), so it is fed into the shared decision rather than read off
  // ctx like the other three.
  const visible = show && pickBottomToast({ ...ctx, langDetected: show }) === "langDetected";
  // `cave-lang-auto` is a ONE-SHOT marker, and it used to be
  // consumed the instant `show` flipped — i.e. before anything was on screen.
  // Once this toast could be OUTRANKED that became a way to lose the notice
  // for ever: install, leave the welcome modal open, update, then dismiss the
  // welcome modal inside the 5 s window of the just-updated toast, and the
  // marker is spent on a toast that never rendered. Narrow, but it is a
  // regression the ordering would have introduced, so the marker is consumed
  // when the toast is ACTUALLY the winner, not when it becomes eligible.
  useEffect(() => { if (visible) lsRemove("cave-lang-auto"); }, [visible]);
  if (!visible) return null;
  const openSettings = () => {
    setShow(false);
    try { if (setSettingsTab) setSettingsTab("prefs"); } catch (_e) { /* ignore */ }
    if (setImportModal) setImportModal(true);
  };
  return (
    <div style={{
      position: "fixed", bottom: BOTTOM_TOAST_OFFSET, left: "50%", transform: "translateX(-50%)",
      zIndex: 500, maxWidth: "calc(100vw - 32px)",
      background: CARD_BG, color: C.tx,
      border: `1px solid ${C.rule2}`,
      borderRadius: 10, padding: "8px 8px 8px 14px",
      fontFamily: F.body, fontSize: fs(15),
      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
      display: "inline-flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: fs(16) }} aria-hidden="true">🌐</span>
      <span style={{ color: C.tx2 }}>{t ? t("lang_auto_detected") : "Langue détectée automatiquement"}</span>
      <PressCard onClick={openSettings} style={{
        padding: "6px 11px", borderRadius: 8,
        background: alpha(C.brass, "22"), color: C.brassHi,
        fontFamily: F.body, fontSize: fs(13.5), fontWeight: 700,
      }}>{t ? t("lang_auto_change") : "Modifier"}</PressCard>
      <button type="button" aria-label={t ? t("btn_cancel") : "Annuler"}
        onClick={() => setShow(false)} style={{
          background: "transparent", border: "none", color: C.tx3,
          cursor: "pointer", fontSize: fs(20), lineHeight: 1,
          minWidth: 30, minHeight: 30, borderRadius: 6,
        }}>×</button>
    </div>
  );
}

// ─── Diagnostic threshold toast ──────────────────────────────
// Persisted invariant violations accumulate in localStorage. When the
// counter crosses DIAGNOSTIC_TOAST_THRESHOLD, we surface a bottom-
// banner inviting the user to open the Settings → Diagnostic panel.
// Dismissed by tapping the close button; the dismissal lives in
// sessionStorage so it stays gone for the rest of the tab session
// but reappears on next launch if violations are still present.
//
// Threshold dropped from 5 → 1. Rationale — any invariant
// violation is a real data-integrity bug; waiting until five had
// piled up meant the user could ship a corrupted backup before
// realising. With the per-session dismissal already in place, one
// violation now surfaces once per launch (max).
export var DIAGNOSTIC_TOAST_THRESHOLD = 1;
export var DIAGNOSTIC_TOAST_DISMISS_KEY = "cave-diagnostic-toast-dismissed";

export function CuratorDiagnosticToast() {
  const ctx = useAppCtx();
  const { t, setImportModal, tasting } = ctx;
  const [count, setCount] = useState<number>(() => getDiagnosticSnapshot().count);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DIAGNOSTIC_TOAST_DISMISS_KEY) === "1"; }
    catch (_e) { return false; }
  });
  useEffect(() => {
    const id = setInterval(() => {
      setCount(getDiagnosticSnapshot().count);
    }, 3000);
    return () => clearInterval(id);
  }, []);
  if (dismissed) return null;
  if (count < DIAGNOSTIC_TOAST_THRESHOLD) return null;
  // Eclipsed by an active tasting (the top banner is enough; the
  // diagnostic notice can wait).
  if (tasting && tasting.stage === "running") return null;
  function onDismiss() {
    // eslint-disable-next-line tabac-local/no-raw-storage-write -- session-scoped flag (sessionStorage), already try-guarded
    try { sessionStorage.setItem(DIAGNOSTIC_TOAST_DISMISS_KEY, "1"); } catch (_e) {}
    setDismissed(true);
  }
  function onOpenSettings() {
    if (setImportModal) setImportModal(true);
    onDismiss();
  }
  return (
    <div role="status" aria-live="polite" style={{
      // Stacked above the Drive-expired banner when both are
      // visible (drive at bottom 80, this one above).
      position: "fixed", left: 12, right: 12, bottom: 150,
      zIndex: 480,
      background: alpha(C.oxblood, "ee"), color: C.ivory,
      border: `1px solid ${C.oxbloodHi}`,
      borderRadius: 10, padding: "10px 12px",
      fontFamily: F.body, fontSize: fs(15), lineHeight: 1.4,
      boxShadow: `0 6px 20px ${alpha(C.oxblood, "55")}`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <Ico name="more" size={18} sw={2} />
      <div style={{ flex: 1 }}>
        <strong>
          {String(t ? t("diag_toast_count") : "{n} anomalies de cohérence détectées.").replace("{n}", String(count))}
        </strong>
        <div style={{ fontSize: fs(13.5), color: C.cream, marginTop: 2 }}>
          {/* CuratorDiagnosticToast is dead-but-tested code (removed from
            the global UI per CLAUDE.md). Kept routed via t()
            for i18n consistency — the test asserts on key fragments. */}
          {t ? t("diag_toast_hint") : "Ouvre Paramètres → Diagnostic pour les inspecter."}
        </div>
      </div>
      <PressCard onClick={onOpenSettings} style={{
        padding: "6px 10px", borderRadius: 8,
        background: alpha(C.brass, "44"), color: C.brassHi,
        border: `1px solid ${alpha(C.brass, "88")}`,
        fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
        letterSpacing: 1, textTransform: "uppercase",
      }} ariaLabel={t ? t("aria_open_settings") : "Ouvrir Paramètres"}>
        {t ? t("btn_open_short") : "Ouvrir"}
      </PressCard>
      <PressCard onClick={onDismiss} style={{
        padding: "6px 8px", borderRadius: 8,
        background: "transparent", color: C.cream,
        border: `1px solid ${alpha(C.oxbloodHi, "55")}`,
        fontFamily: F.mono, fontSize: fs(12.5),
      }} ariaLabel={t ? t("aria_dismiss_overlay") : "Ignorer"}>
        ×
      </PressCard>
    </div>
  );
}

// ─── Drive session expired banner ────────────────────────────
// Surfaces a fixed bottom-of-screen banner when the user has Drive
// auto-save enabled, a backup file exists on Drive, and the OAuth
// token has expired (or is missing). One-tap reconnect via
// gdriveReconnect(). The user can dismiss for the session (×) or
// permanently turn the banner off ("Ne plus notifier" → flips the
// `cave-show-drive-expired-banner` preference to "0").
export var DRIVE_EXPIRED_DISMISS_KEY = "cave-drive-expired-dismissed";

export function CuratorDriveExpiredBanner() {
  const ctx = useAppCtx();
  const {
    t, autoSaveDrive, tkGet, gdriveReconnect, gdriveStatus,
    tasting, pendingSync,
    cloudProviderId = "gdrive",
  } = ctx;
  // The Dropbox early return USED TO SIT HERE, above the three
  // hooks below — a Rules-of-Hooks violation, because `cloudProviderId` is live
  // ctx state and this component is mounted unconditionally with no key. So
  // flipping the destination Segmented in Settings changed a MOUNTED
  // component's hook count from 1 to 4.
  //
  // MEASURED rather than assumed (an audit called this a crash into the Error
  // Boundary; it is not, in React 19): switching to Drive logs "React has
  // detected a change in the order of Hooks" AND "Internal React error:
  // Expected static flag was missing", and the reverse direction logs nothing
  // at all. So the app survives today — but it is undefined behaviour that
  // React itself reports as an internal error, the `dismissed` state and the
  // 4 s interval are silently torn down and rebuilt across a switch, and a
  // React upgrade or a concurrent-rendering change could turn it into the
  // crash it was reported to be. It is also precisely the hook-order trap
  // CLAUDE.md documents for Curator views.
  //
  // The gate is unchanged in meaning — it just runs after the hooks now.
  const [tick, setTick] = useState(0);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DRIVE_EXPIRED_DISMISS_KEY) === "1"; }
    catch (_e) { return false; }
  });
  useEffect(() => {
    // Poll lightly so the banner appears / disappears within a few
    // seconds of token expiry / refresh.
    const id = setInterval(() => setTick(x => x + 1), 4000);
    return () => clearInterval(id);
  }, []);
  // Reading tick to force a re-render — value itself is unused.
  void tick;
  // The expired-session UX is a Google-implicit-grant artefact.
  // Dropbox renews silently via its refresh token, so the banner has nothing
  // to say while that provider is active. (This was moved below the
  // hooks — see the note above; do NOT move it back up.)
  if (cloudProviderId === "dropbox") return null;
  // The permanent "hide banner" preference was removed.
  // The banner now only fires on a real pending sync + expired token
  // (see the pendingSync gate below), so silencing it would mask a
  // genuine risk. Session-scoped dismiss (× button) remains.
  if (dismissed) return null;
  // Auto-save off → user isn't relying on it, banner is noise.
  if (!autoSaveDrive) return null;
  // Live tasting eclipses the banner — its own top banner is already
  // claiming the screen, and the user is focused on smoking. The
  // expired-Drive notice can wait until the session ends.
  if (tasting && tasting.stage === "running") return null;
  // No unsynced change → no banner. With the iOS
  // save-tap-triggered re-auth (and the silent retry on Android), the
  // common case "I just edited something" self-heals; the banner is
  // only needed when a change is actually waiting to sync. Pure
  // browsing for >1h with an expired token no longer trips it.
  if (!pendingSync) {
    try {
      if (localStorage.getItem("cave-pending-sync") !== "1") return null;
    } catch (_e) { return null; }
  }
  // Never connected to Drive → no expired session to renew.
  var hasConnected = false;
  try {
    hasConnected = !!(localStorage.getItem("gdrive-fid")
                      || localStorage.getItem("gdrive-auto-fid"));
  } catch (_e) {}
  if (!hasConnected) return null;
  // Token still valid → no banner.
  try {
    const _tk = JSON.parse((tkGet && tkGet()) || "null");
    if (_tk && _tk.x > Date.now()) return null;
  } catch (_e) {}
  // Operation in progress → don't compete with the status line.
  if (gdriveStatus) return null;

  function onDismiss() {
    // eslint-disable-next-line tabac-local/no-raw-storage-write -- session-scoped flag (sessionStorage), already try-guarded
    try { sessionStorage.setItem(DRIVE_EXPIRED_DISMISS_KEY, "1"); } catch (_e) {}
    setDismissed(true);
  }
  // The permanent "stop notifying" mute path was removed.
  // With the pendingSync gating (banner requires pendingSync truthy), the
  // banner only fires when there's a real unsynced change AND the token
  // is expired — i.e. an actionable warning. Letting users silence that
  // would hide a genuine risk. The session × (onDismiss) stays for
  // transient acknowledgement.
  function onReconnect() {
    if (gdriveReconnect) {
      Promise.resolve(gdriveReconnect()).then(function () {
        setTick(x => x + 1); // re-evaluate banner
      }).catch(function () {});
    }
  }

  return (
    <div role="status" aria-live="polite" style={{
      position: "fixed", left: 12, right: 12, bottom: 80,
      zIndex: 475,
      background: alpha(C.amber, "ee"), color: C.bg,
      border: `1px solid ${C.amber}`,
      borderRadius: 10, padding: "10px 12px",
      fontFamily: F.body, fontSize: fs(15), lineHeight: 1.4,
      boxShadow: `0 6px 20px ${alpha(C.amber, "55")}`,
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <Ico name="more" size={18} sw={2} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <strong>
          {t ? t("drive_expired_title") : "Session Drive expirée"}
        </strong>
        <div style={{ fontSize: fs(13.5), color: C.bg2, marginTop: 2 }}>
          {t ? t("drive_expired_hint") : "L'auto-sauvegarde ne peut pas s'exécuter tant que tu ne reconnectes pas."}
        </div>
      </div>
      <PressCard onClick={onReconnect} style={{
        padding: "6px 12px", borderRadius: 8,
        background: C.bg2, color: C.brassHi,
        border: `1px solid ${C.brass}`,
        fontFamily: F.mono, fontSize: fs(12.5), fontWeight: 700,
        letterSpacing: 1, textTransform: "uppercase",
      }} ariaLabel={t ? t("aria_reconnect_drive") : "Reconnecter Drive"}>
        {t ? t("btn_reconnect") : "Reconnecter"}
      </PressCard>
      <PressCard onClick={onDismiss} style={{
        padding: "6px 8px", borderRadius: 8,
        background: "transparent", color: C.bg2,
        border: `1px solid ${alpha(C.bg2, "55")}`,
        fontFamily: F.mono, fontSize: fs(14.5), fontWeight: 700,
      }} ariaLabel={t ? t("aria_dismiss_overlay") : "Ignorer"}>×</PressCard>
    </div>
  );
}

// ─── Photo error banner ──────────────────────────────────────
// handlePhotoUpload set photoErr (e.g. "image too large > 20 MB")
// but never rendered it. The upload used to fail silently and the
// user was left clueless. Now surfaces as a transient banner same
// shape as the save warn but in oxblood to flag the failure.
export function CuratorPhotoErrorBanner() {
  const ctx = useAppCtx();
  const { photoErr, setPhotoErr } = ctx;
  // This yielded to saveError but NOT saveWarn, so it could sit
  // hidden under the amber bar at a lower z-index and still catch taps on the
  // part that stuck out.
  if (pickTopBanner(ctx as any) !== "photoErr") return null;
  return (
    <div
      role="alert"
      data-top-banner=""
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 490,
        background: C.oxbloodHi, color: C.ivory,
        paddingTop: `max(env(safe-area-inset-top, 0), 10px)`,
        paddingBottom: 10, paddingLeft: 16, paddingRight: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      }}>
      <button
        type="button"
        onClick={() => setPhotoErr && setPhotoErr("")}
        style={{
          display: "block", width: "100%", background: "transparent",
          border: "none", padding: 0, textAlign: "center", cursor: "pointer",
          color: "inherit", font: "inherit",
          fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        }}>
        {photoErr}
      </button>
    </div>
  );
}

// ─── Cloud-newer banner (global) ─────────────────────────────
// The "newer cloud backup" banner used to render only on Home. A
// user landing on the journal / inventory missed the signal until
// they navigated back. Promoting to a global overlay means it's
// visible from any view. The button still triggers
// restoreCloudNewerBackup directly (one-tap auto-replace).
export function CuratorCloudNewerBanner() {
  const ctx = useAppCtx();
  const {
    cloudNewerBackup, dismissCloudNewerBackup, restoreCloudNewerBackup,
    cloudRestoreBusy,
    t, view, dateFormat,
  } = ctx;
  // See bannerStack.ts. The Home gate (Home renders its own
  // in-flow block) is part of that one decision now.
  if (pickTopBanner({ ...(ctx as any), isHome: view === "home" }) !== "cloudNewer") return null;
  // Mimics the export-reminder / save-warn shape: a tappable bar
  // pinned to the top with brass accents.
  const fmt = (ts: number) => {
    try {
      const d = new Date(ts);
      const fmtKey = dateFormat || "fr";
      if (fmtKey === "en") return d.toLocaleString("en-US");
      return d.toLocaleString("fr-FR");
    } catch (_e) { return ""; }
  };
  return (
    <div
      data-top-banner=""
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 489,
        background: C.brass, color: C.bg,
        paddingTop: `max(env(safe-area-inset-top, 0), 8px)`,
        paddingBottom: 8, paddingLeft: 14, paddingRight: 10,
        fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
        display: "flex", alignItems: "center", gap: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}>
      <span style={{ flex: 1, lineHeight: 1.3 }}>
        {String(t ? t("cloud_newer_banner") : "Un autre appareil a une version plus récente ({date}). La restaurer efface les données de cet appareil et les remplace par celles de la sauvegarde.")
          .replace("{date}", fmt(cloudNewerBackup.ts))}
      </span>
      <button type="button"
        disabled={!!cloudRestoreBusy}
        onClick={() => restoreCloudNewerBackup && restoreCloudNewerBackup()}
        aria-busy={!!cloudRestoreBusy}
        style={{
          background: C.bg, color: C.brassHi, border: "none",
          padding: "5px 11px", borderRadius: 8,
          fontFamily: F.body, fontSize: fs(13.5), fontWeight: 700,
          cursor: cloudRestoreBusy ? "wait" : "pointer",
          opacity: cloudRestoreBusy ? 0.75 : 1,
          minHeight: 28,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
        {cloudRestoreBusy && <Spinner color={C.brassHi} />}
        {cloudRestoreBusy
          ? (t ? t("st_downloading") : "Téléchargement...")
          : (t ? t("btn_restore_short") : "Restaurer")}
      </button>
      {/* The WAY OUT is the one that grows, not the
          destructive action beside it.

          « Restaurer » is 28 px here and 44 on Home, which is under the house
          rule (44; WCAG AA asks 24). The obvious fix — raise it to 44 — is the
          wrong one: this button replaces the cellar, it sits in a `gap: 8` row
          next to a dismiss ×, and the house rule exists so a control can be
          REACHED, not so a destructive one is easier to hit by accident. The
          real hazard here is aiming for × and landing on Restaurer.

          So the × goes to 44 (it was 28, i.e. the smaller of the two — the
          harmless action was the harder one to hit) and a 14 px gutter
          separates the pair. « Restaurer » stays at 28: deliberately the
          smaller target of the two, and recorded as such so a future sweep
          does not "complete" the house rule here. */}
      <div style={{ width: 14, flexShrink: 0 }} aria-hidden="true" />
      <button type="button"
        onClick={() => dismissCloudNewerBackup && dismissCloudNewerBackup()}
        aria-label={t ? t("aria_dismiss") : "Fermer"}
        style={{
          background: "transparent", border: "none",
          color: C.bg, fontSize: fs(20), lineHeight: 1,
          cursor: "pointer", minWidth: 44, minHeight: 44,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>×</button>
    </div>
  );
}

// ─── Import / merge recap toast ──────────────────────────────
// Non-blocking replacement for the native window.alert the CSV + JSON merge
// imports used to fire. Reads ctx.importRecap (a multi-line message string),
// shows a sage-accented Notice-style toast, auto-dismisses after ~8 s, and
// clears the state on close so it can fire again on the next import.
export function CuratorImportRecapToast() {
  const ctx = useAppCtx();
  const { t, importRecap, setImportRecap, nav } = ctx;
  useEffect(() => {
    if (!importRecap) return;
    const id = setTimeout(() => { if (setImportRecap) setImportRecap(null); }, 8000);
    return () => clearTimeout(id);
  }, [importRecap, setImportRecap]);
  if (!importRecap || pickBottomToast(ctx) !== "importRecap") return null;
  const close = () => { if (setImportRecap) setImportRecap(null); };
  // Tap-through to the affected list (inventory / journal).
  // a single-blend merge opens that tobacco's fiche directly.
  const view = importRecap.view;
  const tobId = importRecap.tobId;
  const open = () => {
    if (setImportRecap) setImportRecap(null);
    if (tobId != null && ctx.crossOpenDetail && ctx.data && Array.isArray(ctx.data.tobaccos)) {
      const obj = ctx.data.tobaccos.find((x: any) => x && String(x.id) === String(tobId));
      if (obj) { ctx.crossOpenDetail({ view: "inv", kind: "tobacco", obj }); return; }
    }
    if (view && nav) nav(view);
  };
  return (
    <div role="status" aria-live="polite" style={{
      position: "fixed", bottom: BOTTOM_TOAST_OFFSET, left: "50%", transform: "translateX(-50%)",
      zIndex: 500, maxWidth: "calc(100vw - 32px)", width: "max-content",
      background: CARD_BG, color: C.tx,
      border: `1px solid ${alpha(C.sage, "55")}`,
      borderLeft: `3px solid ${C.sage}`,
      borderRadius: 10, padding: "10px 8px 10px 14px",
      fontFamily: F.body, fontSize: fs(14),
      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
      display: "inline-flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ fontSize: fs(16), marginTop: 1 }} aria-hidden="true">✓</span>
      <span style={{ color: C.tx, whiteSpace: "pre-line", lineHeight: 1.4 }}>{importRecap.msg}</span>
      {view && (
        <PressCard onClick={open} style={{
          padding: "6px 11px", borderRadius: 8, flex: "0 0 auto",
          background: alpha(C.sage, "22"), color: C.sageHi,
          fontFamily: F.body, fontSize: fs(13.5), fontWeight: 700,
        }}>{t ? t("catalog_toast_view") : "Voir"}</PressCard>
      )}
      <button type="button" aria-label={t ? t("btn_close") : "Fermer"}
        onClick={close} style={{
          background: "transparent", border: "none", color: C.tx3,
          cursor: "pointer", fontSize: fs(20), lineHeight: 1,
          minWidth: 30, minHeight: 30, borderRadius: 6, flex: "0 0 auto",
        }}>×</button>
    </div>
  );
}

// ─── All overlays bundled together ───────────────────────────
// Report the height of whichever top banner is showing.
//
// The mechanism is not new — `CuratorTastingBanner` has measured itself and
// reported up since long before this, and the shell's comment says exactly why:
// "Reserve room for the fixed tasting banner (0 when none). Keeps the active
// view's TopBar icons tappable during a live tasting." The five `top: 0`
// banners never got the same treatment, so THEY went on covering the TopBar —
// all four of its buttons at 390 px, measured — while the reasoning for fixing
// it sat written down one component over.
//
// One observer serves all five because the top-banner ordering guarantees at most one is
// mounted at a time; `pickTopBanner` is the effect's dependency, so switching
// banners re-attaches to the new node. The height is MEASURED rather than
// assumed: it varies with the text, the width, the safe-area inset and the
// user's font-scale setting — at 390 px the export reminder is 110 px and the
// short save error is far less.
function TopBannerHeightProbe({ onHeight }: { onHeight?: (h: number) => void }) {
  const ctx = useAppCtx();
  const active = pickTopBanner(ctx as any);
  useEffect(() => {
    if (!onHeight) return;
    if (!active) { onHeight(0); return; }
    const el = document.querySelector("[data-top-banner]") as HTMLElement | null;
    if (!el) { onHeight(0); return; }
    const measure = () => onHeight(Math.round(el.getBoundingClientRect().height));
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); onHeight(0); };
  }, [active, onHeight]);
  return null;
}

export function CuratorOverlays({ onTopBannerHeight }: { onTopBannerHeight?: (h: number) => void } = {}) {
  return (
    <>
      <CuratorAutoUpdateBanner />
      <CuratorSaveErrorBanner />
      <CuratorSaveWarnBanner />
      <CuratorPhotoErrorBanner />
      <CuratorCloudNewerBanner />
      <CuratorExportReminderBanner />
      <CuratorUpdatePill />
      <CuratorJustUpdatedToast />
      <CuratorLangDetectedToast />
      <CuratorImportRecapToast />
      <CuratorUndoToast />
      {/* CuratorDiagnosticToast removed from the global
          overlays — too noisy for the end user, and the underlying
          tracking is still available in Settings → Diagnostic for
          power-user inspection. The component itself stays in this
          file (still exported for tests) but isn't mounted anywhere. */}
      <CuratorDriveExpiredBanner />
      {/* Last, so the banners above are in the DOM when it measures. */}
      <TopBannerHeightProbe {...(onTopBannerHeight ? { onHeight: onTopBannerHeight } : {})} />
    </>
  );
}
