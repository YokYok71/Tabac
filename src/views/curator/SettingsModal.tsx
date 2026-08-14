// Settings modal. Open/close driven by ctx.importModal / ctx.setImportModal.
//
// Sections (in order):
//   1. Sauvegarde Drive (auto-save toggle + save/restore/disconnect + status)
//   2. Export & Import (JSON, CSV, ZIP, import file)
//   3. Préférences (weight unit, length unit, default session weight)
//   4. Assistant IA (provider, API key, exclude-from-backup)
//   5. Application (version + check update + update flow)
//   6. Sections (visibility toggles)
//   7. Aide (help, contact, privacy, changelog, licenses)

import React, { useState, useEffect } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { APP_VERSION, APP_BUILD, CATS_EN } from "../../constants.ts";
import { VERSION_CHECK_STALE_MS } from "../../hooks/useAppUpdate.ts";
import { LANGUAGES } from "../../i18n/languages.ts";
import { alpha, fs, fsInput, C, F, CARD_BG } from "../../theme-curator.ts";
import { getDiagnosticSnapshot, clearDiagnostic } from "../../utils/diagnostic.ts";
import { readAutosaveDiag, readCloudCheckDiag } from "../../hooks/useGdriveSync.ts";
import { fmtDate, fmtDateTime, today, plural } from "../../utils.ts";
import { useFocusRing, caretToEnd } from "../../components/curator/FormFields.tsx";
import { Lbl, PressCard, Spinner } from "../../components/curator/primitives.tsx";
import { Ico, IcoName } from "../../components/curator/icons.tsx";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { ModalAction } from "../../components/curator/ModalAction.tsx";
import { Notice, statusToneFromMessage } from "../../components/curator/Notice.tsx";
import { ScrollableChipRow } from "../../components/curator/FilterControls.tsx";
import { AI_MODEL_OPTIONS } from "../../hooks/useAiAutoFill.ts";
import { readOAuthEvent, clearOAuthEvent } from "../../utils/oauthDiag.ts";
import { lsSet, lsRemove } from "../../utils/appStorage.ts";
import {
  findDuplicateGroups, duplicateCount, mergeDuplicates,
  type DupGroup, type DupKind,
} from "../../utils/duplicates.ts";

// Master switch for the debug-only Settings tools — the OAuth
// touchpoint line and the "Diagnostic multi-appareils" panel. Kept OFF so
// they're hidden from users, but the code + wiring stay intact so a future
// debugging session can flip this to `true` and get them back instantly
// (they were previously deleted, then restored-but-gated on request).
const SHOW_DEBUG_DIAGNOSTICS = false;

export function CuratorSettingsModal() {
  const ctx = useAppCtx();
  const {
    t, xl, lang, importModal, setImportModal, data,
    weightUnit, saveWeightUnit, lengthUnit, saveLengthUnit,
    fontScale, saveFontScale,
    themeId, saveThemeId,
    themeMode, saveThemeMode,
    currencySymbol, saveCurrencySymbol,
    maintReminderThreshold, saveMaintReminderThreshold,
    maintRemindersEnabled, saveMaintRemindersEnabled,
    dateFormat, saveDateFormat,
    sessDefaultWeight, setSessDefaultWeight, saveLang, langPending, langErr,
    watchLowWeight, saveWatchLowWeight,
    defaultListGrouped, saveDefaultListGrouped,
    accountingEnabled, saveAccountingEnabled,
    // Optional Drive backup encryption (Phase 1)
    driveEncryptionEnabled, saveDriveEncryptionEnabled,
    drivePassphrase, setDrivePassphrase, requestDrivePassphrase,
    gdriveStatus, setGdriveStatus, gdriveConfirm, setGdriveConfirm,
    doGdriveConfirm, gdriveSave, gdriveRestore, gdriveDeleteOption,
    checkCloudNewerNow,
    runSyncDiagnostic, dismissSyncDiag, syncDiag, syncDiagBusy, syncDiagErr, syncDiagSource,
    save, dataRaw,
    deviceName, saveDeviceName,
    autoSaveDrive, setAutoSaveDrive, lastAutoSaveTs,
    cloudProviderId = "gdrive", saveCloudProviderId, dropboxDisconnect,
    backupStatus, doExport, doExportCSV, doBackupZip, doCollectionReport,
    doDownloadCsvTemplate, doImportCsvFile, csvIssues, clearCsvIssues, doImportFile,
    catalogueMeta, catalogueBusy, catalogueOutcome,
    catalogueCloudSave, catalogueCloudRestore, catalogueCloudStatus,
    catalogueAudit, catalogueAuditBusy, auditCatalogue, clearCatalogueAudit,
    loadCatalogueFile, clearCatalogue, downloadCatalogueTemplate, exportCatalogueCsv,
    refreshCatalogueMeta,
    importConfirm, applyImport, cancelImport,
    aiProvider, saveAiProvider, aiModel, saveAiModel, aiModelResolved,
    modelProbe, probeModel, apiKey, saveApiKey,
    excludeApiKey, setExcludeApiKey,
    autofillSource, saveAutofillSource,
    tkClear, tkGet, resetAll,
    newerBuild, lastCheckOkMs, pendingReason, deferReason, updateStatus, setUpdateStatus, doUpdate, checkUpdate,
    canInstallApp, triggerInstall,
    visibleSections, setVisibleSections, view, nav, openDocFromSettings,
    settingsTab, setSettingsTab,
    IS_IOS,
  } = ctx;

  // Re-read the catalogue meta each time this modal mounts.
  // `catalogueLoad` rewrites it when it re-parses after a parser-version
  // change, and that happens inside `tobaccoDb` — which the hook cannot see.
  // Without this the panel shows the counts and warnings from before the
  // re-parse until the next app start (observed: "0 blends · 0 marques" for a
  // catalogue that had just re-parsed to three).
  useEffect(function () {
    if (refreshCatalogueMeta) refreshCatalogueMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The CSV importer SNAPS an unrecognised taxonomy label
  // to the catch-all, and the panel has to name the value the user's own
  // dropdown will show — the three strings hardcoded the FRENCH « Autre » in
  // all six languages, so a German reader was told about a value their form
  // never displays (`CATS_DE.Autre` is "Andere"). Derived from the same map the
  // dropdown reads, so it cannot drift from it.
  const autreLabel = xl ? String(xl("Autre", CATS_EN)) : "Autre";
  const sdwRing = useFocusRing();
  // "À surveiller" threshold input.
  const wlwRing = useFocusRing();
  // Pipe maintenance-reminder threshold input.
  const mrtRing = useFocusRing();
  // AI model selector focus ring.
  const amRing = useFocusRing();
  // Friendly device-name input focus ring.
  const dnRing = useFocusRing();
  const [dupOpen, setDupOpen] = useState(false);
  const [dupMsg, setDupMsg] = useState<string | null>(null);

  // Active tab. Prefers the ctx-driven state set in
  // App.tsx (so the update pill / export reminder banner can pre-
  // position the user on the right tab BEFORE opening Settings).
  // Falls back to a local useState for tests that mount the modal in
  // isolation without the full App ctx — in that case localStorage
  // still provides cross-render persistence so the existing clear-
  // between-tests `beforeEach` keeps working.
  const [localTab, setLocalTab] = useState<SettingsTabId>(() => {
    try {
      const saved = localStorage.getItem("cave-settings-tab");
      if (saved === "data" || saved === "prefs" || saved === "app" || saved === "help") return saved;
    } catch (_e) {}
    return "prefs";
  });
  const ctxTab: SettingsTabId | undefined =
    (settingsTab === "data" || settingsTab === "prefs"
      || settingsTab === "app" || settingsTab === "help")
      ? settingsTab : undefined;
  // setSettingsTab is always supplied by App.tsx (ctx contract); the
  // setActiveTab guard below still handles its runtime absence in tests.
  const activeTab: SettingsTabId = ctxTab ? ctxTab : localTab;
  function setActiveTab(t: SettingsTabId) {
    if (setSettingsTab) {
      setSettingsTab(t);
    } else {
      setLocalTab(t);
      lsSet("cave-settings-tab", t);
    }
  }

  // Light polling tick so the Drive-expired Notice inside
  // this modal re-evaluates the token state every 4 s, matching the
  // behaviour of the global CuratorDriveExpiredBanner in Overlays. Without
  // it, the Notice reads tkGet() at render time and never refreshes —
  // after a successful Reconnect the underlying React tree had no reason
  // to re-render, so the Notice (and the user) kept seeing the expired
  // state even though the token had been refreshed. localStorage writes
  // don't trigger React renders on their own.
  const [_settingsTick, setSettingsTick] = useState(0);
  useEffect(function () {
    if (!importModal) return;
    const id = setInterval(function () { setSettingsTick(function (x) { return x + 1; }); }, 4000);
    return function () { clearInterval(id); };
  }, [importModal]);
  void _settingsTick;

  return (
    <>
    <Modal open={!!importModal} onClose={() => setImportModal && setImportModal(false)} maxWidth={520}
      ariaLabel={t ? t("btn_settings") : "Paramètres"}>
      <ModalHeader
        overline={t ? t("sec_preferences") : "Préférences"}
        title={t ? String(t("modal_title") || "").replace(/^[^\w]+\s*/, "") || "Paramètres" : "Paramètres"}
        onClose={() => setImportModal && setImportModal(false)}
        accent={C.brassHi}
      />
      <SettingsTabs active={activeTab} setActive={setActiveTab} t={t} />

      <div style={{ maxHeight: "min(78vh, 700px)", overflowY: "auto", overscrollBehavior: "contain", padding: "0 18px 18px" }}>

        {/* Each Section now lives under a tab. The
            grouping is:
              - data  : Drive · Export & Import · Assistant IA
              - prefs : Préférences · Sections (visibility)
              - app   : Application · Diagnostic
              - help  : Aide & infos
            Source order is preserved so existing line landmarks
            (tests, anchors, comments) still resolve; the conditional
            wrappers pick which sections actually mount. */}
        {activeTab === "data" && (
        <Section title={t ? t("sec_cloud") : "☁️ Sauvegarde cloud"} accent={C.sage}>
          {/* Backup destination selector. Routing-only —
              each provider keeps its own files and file-id namespace;
              switching never migrates or deletes anything. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: fs(14.5), color: C.tx2 }}>
              {t ? t("lbl_cloud_provider") : "Destination"}
            </span>
            <Segmented
              value={cloudProviderId}
              setValue={(v: string) => saveCloudProviderId && saveCloudProviderId(v)}
              options={[["dropbox", "Dropbox"], ["gdrive", "Google Drive"]]} />
          </div>
          <div style={{
            fontSize: fs(13.5), fontStyle: "italic", color: C.tx3,
            margin: "-2px 4px 10px",
          }}>
            {t ? t("cloud_provider_hint") : "Chaque destination conserve ses propres sauvegardes — changer ne migre rien."}
          </div>
          <Toggle
            value={!!autoSaveDrive}
            setValue={(v) => {
              setAutoSaveDrive && setAutoSaveDrive(v);
              lsSet("cave-autosave", v ? "1" : "0");
            }}
            label={t ? t("lbl_autosave") : "Sauvegarde auto cloud"}
            hint={(function () {
              // Label the "last save" line by the TYPE of the last
              // save on the active provider (manual vs auto), not a fixed
              // "auto" wording. Written per-provider in useGdriveSync at both
              // the manual (gdriveSave) and auto (gdriveSaveQuiet) success
              // sites; read here so a manual save reads "manuelle".
              var ty = (function () {
                try { return localStorage.getItem("cave-last-save-type-" + (cloudProviderId === "dropbox" ? "dropbox" : "gdrive")); } catch (_e) { return null; }
              })();
              var lab = ty === "manual"
                ? (t ? t("settings_last_manual_backup") : "Dernière sauvegarde manuelle :")
                : ty === "auto"
                ? (t ? t("settings_last_auto_backup") : "Dernière sauvegarde auto :")
                : (t ? t("lbl_last_autosave") : "Dernière sauvegarde :");
              return lab + " " + (lastAutoSaveTs ? fmtDateTime(lastAutoSaveTs, dateFormat) : "—");
            })()}
          />
          {/* Visible auto-save diagnostic. The auto-save
              path is silent by design, so a genuinely-broken save looked
              identical to "nothing happened". This surfaces the LAST
              attempt's outcome so a stuck auto-save is no longer invisible
              (esp. on Dropbox). Mirrors the OAuth-diag line style; the 4 s
              settings tick keeps it fresh. */}
          {autoSaveDrive && (() => {
            var d = readAutosaveDiag();
            if (!d) return null;
            var ageMin = Math.max(0, Math.round((Date.now() - d.ts) / 60000));
            var ageStr = ageMin === 0
              ? (t ? t("age_just_now") : "à l'instant")
              : (t ? String(t("age_min_ago")).replace("{n}", String(ageMin)) : ("il y a " + ageMin + " min"));
            // Benign outcomes — no line. The user objected to the
            // permanent "sauvegardé · …" success noise, so `ok` stays silent;
            // `uploaded` / `swept-partial` mean the file DID reach the cloud
            // (only the post-upload bookkeeping lagged) and `ref-reset-stale`
            // is a self-heal — all benign, all hidden.
            var benign = d.stage === "ok" || d.stage === "swept-partial"
              || d.stage === "uploaded" || d.stage === "ref-reset-stale";
            if (benign) return null;
            // v1.3: surface the "never reached the cloud" states in amber.
            // `saving-start` as the LAST recorded stage = a save that started
            // but was frozen mid-flight (iOS suspends the PWA's JS if you lock
            // / switch apps right after finishing a session — the exact silent
            // miss this line now catches). `skip-locked` / `skip-inprogress` =
            // a save skipped because another was mid-flight. Real errors keep
            // the ✗ oxblood tone below.
            var stuck = d.stage === "saving-start" || d.stage === "skip-locked"
              || d.stage === "skip-inprogress";
            // Null-prototype for the same reason as the cloud-check map below:
            // `d.stage` is read back out of localStorage.
            var msgKeyMap: Record<string, string> = Object.assign(Object.create(null), {
              "ok": "autosave_diag_ok",
              "swept-partial": "autosave_diag_swept_partial",
              "uploaded": "autosave_diag_uploaded",
              "saving-start": "autosave_diag_saving_start",
              "skip-locked": "autosave_diag_skip",
              "skip-inprogress": "autosave_diag_skip",
              "ref-reset-stale": "autosave_diag_ref_reset",
              "dropbox-token-failed": "autosave_diag_dropbox_token_failed",
              "no-token": "autosave_diag_no_token",
              "list-error": "autosave_diag_list_error",
              "list-auth-error": "autosave_diag_list_auth_error",
              "upload-error": "autosave_diag_upload_error",
              "upload-auth-error": "autosave_diag_upload_auth_error",
            });
            var msgKey = msgKeyMap[d.stage];
            var label = (msgKey && t) ? t(msgKey) : d.stage;
            // Audit iOS nit: on iOS standalone the silent token
            // refresh can't run, so "no token" is actionable — tell the
            // user a save tap renews it, matching the actionable Dropbox
            // message. (On Android/desktop the silent refresh handles it,
            // so the generic message stays.)
            if (d.stage === "no-token" && IS_IOS) {
              label = t ? t("autosave_diag_no_token_ios")
                : "✗ jeton indisponible — touchez Sauvegarder pour renouveler";
            }
            if (d.detail) label += " · " + d.detail;
            var tone = stuck ? C.amber : C.oxbloodHi;
            return (
              <div style={{
                fontFamily: F.mono, fontSize: fs(12.5), color: tone,
                padding: "2px 4px 8px", display: "flex",
                alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                <span>{t ? t("settings_autosave_diag_label") : "Dernier essai auto :"} {label} · {ageStr}</span>
              </div>
            );
          })()}
          {/* Why the launch-time multi-device check did what it
              did. Every one of its exits was silent — not engaged, no token, a
              list error, or simply nothing newer — so a user whose second
              device never announced newer cloud data could not tell whether it
              had looked and found nothing or never looked at all. Reported
              from the app after switching devices. `found` and `none` are
              benign and stay hidden; the rest are the states worth acting on. */}
          {(function () {
            var d = readCloudCheckDiag();
            if (!d || d.stage === "found" || d.stage === "none") return null;
            // Null-prototype: the key comes from stored data, and on a plain
            // object a forged `constructor` / `toString` stage resolves to an
            // Object.prototype member — truthy, so `k && t(k)` would hand t()
            // a function. Same rule as tabac-local/no-dynamic-index-plain-map
            // (which only sees MODULE-level maps, so a local one is on us).
            var keys: Record<string, string> = Object.assign(Object.create(null), {
              "not-engaged": "cloudcheck_diag_not_engaged",
              "no-drive-token": "cloudcheck_diag_no_token",
              "no-token": "cloudcheck_diag_no_token",
              "list-error": "cloudcheck_diag_list_error",
              "error": "cloudcheck_diag_error",
            });
            var k = keys[d.stage];
            if (!k) return null;
            // "not run" is a state, not a fault — only a genuine failure to
            // reach the cloud earns the alarm colour.
            var ccTone = (d.stage === "list-error" || d.stage === "error")
              ? C.oxbloodHi : C.tx3;
            return (
              <div style={{
                fontFamily: F.mono, fontSize: fs(12.5), color: ccTone,
                padding: "2px 4px 8px",
              }}>
                {(t ? t("settings_cloudcheck_diag_label") : "Contrôle multi-appareils :")
                  + " " + (t ? t(k) : k)}
              </div>
            );
          })()}
          {/* The "Show expired-session banner" toggle was
              removed. With the pendingSync gate the banner only
              fires on a real unsynced change + expired token — silencing
              it would mask a genuine risk. */}

          {/* Optional Drive backup encryption (Phase 1).
              Toggle triggers the setup modal when turning ON, a confirm
              prompt when turning OFF. When ON, surfaces the lock status
              + "enter passphrase" CTA so the user can unlock the cached
              passphrase after a reload without going through a save. */}
          <Toggle
            value={!!driveEncryptionEnabled}
            setValue={(v) => {
              if (!saveDriveEncryptionEnabled) return;
              if (v) {
                if (!requestDrivePassphrase || !setDrivePassphrase) return;
                requestDrivePassphrase("setup").then(function (pw: string | null) {
                  if (!pw) return; // cancelled
                  setDrivePassphrase(pw);
                  saveDriveEncryptionEnabled(true);
                });
              } else {
                // Disabling: confirm — old encrypted backups remain
                // readable with the passphrase, but new ones go plain.
                if (window.confirm(t ? t("enc_disable_confirm") : "Désactiver le chiffrement Drive ? Les prochaines sauvegardes seront en clair. Les sauvegardes chiffrées existantes restent lisibles avec la phrase secrète.")) {
                  saveDriveEncryptionEnabled(false);
                }
              }
            }}
            label={t ? t("enc_toggle_label") : "Chiffrer les sauvegardes cloud"}
            hint={t ? t("enc_toggle_hint") : "Les sauvegardes cloud seront chiffrées avec une phrase secrète. Les anciennes sauvegardes en clair restent restaurables."}
          />
          {driveEncryptionEnabled && (
            <Notice tone={drivePassphrase ? "success" : "warn"} style={{ marginBottom: 8 }}
              action={
                <SettingsButton
                  variant="primary"
                  accent={drivePassphrase ? C.amber : C.sageHi}
                  label={drivePassphrase
                    ? (t ? t("enc_lock_btn") : "Oublier")
                    : (t ? t("enc_unlock_btn") : "Entrer la phrase")}
                  onClick={() => {
                    if (drivePassphrase) {
                      if (setDrivePassphrase) setDrivePassphrase(null);
                    } else {
                      if (!requestDrivePassphrase || !setDrivePassphrase) return;
                      requestDrivePassphrase("unlock").then(function (pw: string | null) {
                        if (pw) setDrivePassphrase(pw);
                      });
                    }
                  }}
                />
              }>
              {drivePassphrase
                ? (t ? t("enc_status_unlocked") : "Phrase secrète en mémoire")
                : (t ? t("enc_status_locked") : "Phrase secrète à entrer")}
            </Notice>
          )}

          {(() => {
            // Inline expired-session note inside Settings (a later
            // refactor). The global banner in Overlays handles the
            // common case; this stays as a fallback view if the user
            // has hidden the banner permanently.
            if (!autoSaveDrive ||
                (!localStorage.getItem("gdrive-fid") && !localStorage.getItem("gdrive-auto-fid"))) return null;
            if (cloudProviderId === "dropbox") return null;
            try {
              const _tk = JSON.parse((tkGet && tkGet()) || "null");
              if (_tk && _tk.x > Date.now()) return null;
            } catch (_e) {}
            return (
              <Notice
                tone="warn"
                action={
                  <SettingsButton
                    variant="primary" accent={C.amber}
                    label={t ? t("btn_reconnect") : "Reconnecter"}
                    onClick={() => ctx.gdriveReconnect && ctx.gdriveReconnect()}
                  />
                }>
                {t ? t("drive_session_expired") : "Session Drive expirée."}
              </Notice>
            );
          })()}

          {/* The OAuth "Dernier OAuth : …" debug touchpoint line
              is HIDDEN (gated on SHOW_DEBUG_DIAGNOSTICS, off) — it was only
              ever a debug aid. Kept here (not deleted) so it can be flipped
              back on for troubleshooting. */}
          {SHOW_DEBUG_DIAGNOSTICS && (() => {
            // Surface the last OAuth touchpoint so the user
            // can see what's happening when Reconnect doesn't take effect.
            // Polled re-render via the modal-level tick (_settingsTick).
            // Hide on Dropbox — the diagnostic is fed by
            // `recordOAuthEvent` which only fires on the Google OAuth
            // round-trip (redirect-start / return-success / token-stored…).
            // Dropbox uses the refresh-grant silent flow + a different
            // dispatcher; showing a stale Google event while the user is
            // on Dropbox just confuses (the value doesn't change when
            // they switch destinations).
            if (cloudProviderId === "dropbox") return null;
            var ev = readOAuthEvent();
            if (!ev) return null;
            var ageMin = Math.max(0, Math.round((Date.now() - ev.ts) / 60000));
            var ageStr = ageMin === 0
              ? (t ? t("age_just_now") : "à l'instant")
              : (t ? String(t("age_min_ago")).replace("{n}", String(ageMin)) : ("il y a " + ageMin + " min"));
            var label = ev.type;
            if (ev.action) label += " · " + ev.action;
            if (ev.detail) label += " · " + ev.detail;
            return (
              <div style={{
                fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3,
                padding: "2px 4px 8px", display: "flex",
                alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                <span>{t ? t("settings_last_oauth") : "Dernier OAuth :"} {label} · {ageStr}</span>
                <button
                  type="button"
                  onClick={() => { clearOAuthEvent(); setSettingsTick(x => x + 1); }}
                  style={{
                    background: "transparent", border: "1px solid " + C.rule,
                    color: C.tx3, padding: "2px 8px", borderRadius: 6,
                    fontSize: fs(11.5), cursor: "pointer", fontFamily: F.mono,
                  }}
                >{t ? t("btn_clear") : "Effacer"}</button>
              </div>
            );
          })()}

          <ActionBtn icon="box"   label={t ? t(cloudProviderId === "dropbox" ? "btn_dropbox_save" : "btn_gdrive_save") : "Sauvegarder"}
            onClick={gdriveSave}  accent={C.sageHi}
            disabled={!!gdriveStatus || !!gdriveConfirm} />
          {/* The status sits HERE, directly under the save
              button, not at the end of the section. It used to render after
              the restore picker / device name / sync diagnostic — eight rows
              below the button just tapped, so "Sauvegarde…" and "✓ OK"
              landed off-screen on a phone and a manual save looked like it
              did nothing. Feedback belongs next to its trigger (the sync
              diagnostic below already does this). Every action that sets the
              status is disabled while it shows, so the row appearing here
              cannot shift a live button under the user's finger. */}
          {gdriveStatus && (
            <Notice tone={statusToneFromMessage(gdriveStatus)}>{gdriveStatus}</Notice>
          )}
          <ActionBtn icon="back"  label={t ? t(cloudProviderId === "dropbox" ? "btn_dropbox_restore" : "btn_gdrive_restore") : "Restaurer"}
            onClick={gdriveRestore} accent={C.sageHi}
            disabled={!!gdriveStatus || !!gdriveConfirm} />
          {/* The restore picker opens HERE, under the button
              that opened it. It used to render at the end of the section —
              past "Vérifier les sauvegardes", "Voir mes sauvegardes", the
              disconnect row, the device name and the sync diagnostic — so on
              a phone tapping "Restaurer" appeared to do nothing at all: the
              backup list was eight rows further down, off-screen. Same fix as
              the save status above. (The cloud panel below stays gated on
              !gdriveConfirm, so the two panels still never show together,
              whatever the render order.) */}
          {gdriveConfirm && (
            <GDriveConfirmPanel
              gdriveConfirm={gdriveConfirm}
              setGdriveConfirm={setGdriveConfirm}
              doGdriveConfirm={doGdriveConfirm}
              gdriveLoadOptionPayload={ctx.gdriveLoadOptionPayload}
              gdriveDeleteOption={gdriveDeleteOption}
              data={data} dateFormat={dateFormat} t={t}
            />
          )}
          {/* Explicit re-check for a newer cloud
              backup. Bypasses the silent-launch dismiss markers so a
              user whose other device just saved can force the banner.
              No longer disabled by the SHARED `gdriveStatus`
              — that guard exists to stop the status Notice shifting the
              save/restore pair under a finger, and this button sits three
              rows below it, so all it did here was make the control silently
              dead for the 3-4 s any other cloud status lingered (including
              this one's own former success message). Reported as "I click
              check backups and nothing happens". It now disables only while
              IT is running, and answers directly underneath. */}
          <ActionBtn icon="cloud"
            label={t ? t("btn_check_cloud_newer") : "Vérifier les sauvegardes cloud"}
            onClick={() => { checkCloudNewerNow && checkCloudNewerNow(); }}
            accent={C.brass}
            disabled={!!syncDiagBusy || !!gdriveConfirm} small />
          {syncDiagSource === "check" && syncDiagBusy && (
            <Notice tone="info">{t ? t("st_connecting") : "Connexion..."}</Notice>
          )}
          {syncDiagSource === "check" && syncDiagErr && (
            <Notice tone="error">{(t ? t("err_prefix") : "Erreur") + " : " + syncDiagErr}</Notice>
          )}
          {syncDiagSource === "check" && syncDiag && (
            <SyncDiagView diag={syncDiag} t={t} lang={lang} onClose={dismissSyncDiag}
              onDeleteEntry={(id: string) => ctx.gdriveDeleteBackupById && ctx.gdriveDeleteBackupById(id)} />
          )}
          {cloudProviderId === "dropbox" && (
            <ActionBtn icon="close" label={t ? t("btn_dropbox_disconnect") : "Déconnecter Dropbox"}
              onClick={() => {
                if (dropboxDisconnect) dropboxDisconnect();
                setGdriveStatus && setGdriveStatus(t ? t("dropbox_disconnected") : "Dropbox déconnecté");
                setTimeout(() => setGdriveStatus && setGdriveStatus(null), 4000);
              }}
              accent={C.tx2} small />
          )}
          {cloudProviderId !== "dropbox" && (
          <ActionBtn icon="close" label={t ? t("btn_gdrive_disconnect") : "Changer de compte Google"}
            onClick={() => {
              try {
                // eslint-disable-next-line tabac-local/no-raw-storage-write -- OAuth account-picker flag keeps its guarded path
                localStorage.setItem("gdrive-force-select", "1");
                lsRemove("gdrive-fid");
                lsRemove("gdrive-auto-fid");
              } catch (_e) {}
              if (tkClear) tkClear();
              const g = (window as any).google;
              if (g?.accounts?.id) g.accounts.id.disableAutoSelect();
              setGdriveStatus && setGdriveStatus(t ? t("drive_account_unlinked") : "Compte déconnecté — utilisez Sauvegarder pour changer");
              setTimeout(() => setGdriveStatus && setGdriveStatus(null), 4000);
            }}
            accent={C.tx2} small />
          )}
          {/* Friendly name for THIS device — device-local, shown in
              the multi-device sync diagnostic so the opaque device id is
              readable. */}
          <Row label={t ? t("device_name_label") : "Nom de cet appareil"}
               sub={t ? t("device_name_hint") : "Affiché dans le diagnostic multi-appareils et ajouté au nom des fichiers de sauvegarde pour les reconnaître. Ne fait pas partie de vos données."}>
            <input
              type="text"
              value={deviceName || ""}
              aria-label={t ? t("device_name_label") : "Nom de cet appareil"}
              placeholder={t ? t("device_name_ph") : "ex : iPhone"}
              maxLength={40}
              onChange={(e) => { saveDeviceName && saveDeviceName(e.target.value); }}
              onFocus={(e) => { dnRing.onFocus(); caretToEnd(e); }}
              onBlur={dnRing.onBlur}
              style={{
                width: 150, padding: "7px 10px",
                background: C.bg2, color: C.ivory,
                border: `1px solid ${C.rule}`, borderRadius: 8,
                fontFamily: F.body, fontSize: fsInput(15), textAlign: "right",
                outline: "none", transition: "box-shadow 200ms, border-color 200ms",
                ...(dnRing.style || {}),
              }} />
          </Row>
          {/* ONE button over the cloud files, where there were two.
              "Voir mes sauvegardes" listed each file with its size and a
              delete; "Diagnostic multi-appareils" listed the same files with
              their verdict (proposed / this device / already seen / older /
              unreadable date) and the per-device roll-up. Reported, and
              fairly: « les mêmes informations s'affichent » — the first thing
              a reader sees in either is the same column of filenames, and
              neither said what question it answered. The panel now carries
              both halves, so the second button and its second listing are
              gone. It stays a TOGGLE (re-tapping closes it); the separate
              OAuth touchpoint debug line above stays gated on
              SHOW_DEBUG_DIAGNOSTICS. */}
          <ActionBtn icon="cloud"
            label={t ? t("btn_view_backups") : "Voir mes sauvegardes"}
            onClick={() => {
              // The toggle must only ever consider ITS OWN
              // result. "Vérifier" used to write the same syncDiag /
              // syncDiagErr slots, so after a check this button's first tap
              // hit the dismiss branch — dismissing a panel rendered under the
              // OTHER button, i.e. doing nothing visible. A dead tap, the exact
              // class this whole series is about, introduced by the change
              // immediately before it.
              if (syncDiagSource === "diag" && (syncDiag || syncDiagErr)) {
                dismissSyncDiag && dismissSyncDiag();
              } else if (runSyncDiagnostic) {
                runSyncDiagnostic();
              }
            }}
            accent={C.tx2}
            disabled={!!syncDiagBusy} small />
          {syncDiagSource === "diag" && syncDiagBusy && (
            <Notice tone="info">{t ? t("st_connecting") : "Connexion..."}</Notice>
          )}
          {syncDiagSource === "diag" && syncDiagErr && (
            <Notice tone="error">{(t ? t("err_prefix") : "Erreur") + " : " + syncDiagErr}</Notice>
          )}
          {syncDiagSource === "diag" && syncDiag && (
            <SyncDiagView diag={syncDiag} t={t} lang={lang} onClose={dismissSyncDiag}
              onDeleteEntry={(id: string) => ctx.gdriveDeleteBackupById && ctx.gdriveDeleteBackupById(id)} />
          )}
          {/* The duplicate utility. Hidden entirely when there is
              nothing to resolve — an always-present button for a condition most
              users never hit is noise, and the count IS the reason to look. */}
          {(() => {
            const src = dataRaw || data;
            const n = duplicateCount(src);
            if (n <= 0) return null;
            return (
              <>
                <ActionBtn icon="chart"
                  label={String(t ? t("btn_duplicates") : "Doublons ({n})").replace("{n}", String(n))}
                  onClick={() => setDupOpen((v: boolean) => !v)}
                  accent={C.amber} small />
                {dupOpen && (
                  <DuplicatesPanel
                    data={src} t={t} dateFormat={dateFormat}
                    onClose={() => setDupOpen(false)}
                    onMerged={(next, moved) => {
                      save && save(next);
                      setDupMsg(String(t ? t("dup_done") : "Fusionné : {lots} lot(s) et {sess} séance(s) déplacés.")
                        .replace("{lots}", String(moved.lots))
                        .replace("{sess}", String(moved.sessions)));
                    }} />
                )}
                {dupMsg && <Notice tone="success">{dupMsg}</Notice>}
              </>
            );
          })()}

        </Section>
        )}

        {/* 2. Export & Import */}
        {/* The user's OWN reference catalogue.
            It sits in Données rather than on the catalogue page because it is
            a data-management action (load / export / remove a file), and
            because the page it feeds may not exist yet: the whole point is
            that a user with no catalogue has somewhere to go. */}
        {activeTab === "data" && (
        <Section title={t ? t("sec_catalogue") : "Catalogue de référence"} accent={C.steelHi}>
          <CatalogueStatus
            t={t}
            meta={catalogueMeta}
            busy={catalogueBusy}
            outcome={catalogueOutcome}
            dateFormat={dateFormat}
          />
          <ActionBtn icon="book" label={t ? t("btn_cat_template") : "Télécharger le modèle"}
            onClick={downloadCatalogueTemplate} accent={C.tx2} />
          <ActionBtn icon="plus" label={t ? t("btn_cat_load") : "Charger un catalogue (.csv)"}
            onClick={loadCatalogueFile} disabled={!!catalogueBusy} accent={C.sage} />
          {catalogueMeta && (
            <ActionBtn icon="box" label={t ? t("btn_cat_export") : "Exporter mon catalogue"}
              onClick={exportCatalogueCsv} accent={C.brassHi} />
          )}
          {/* « Vérifier mon catalogue ».
              The panel above already reports the COUNTS; what it
              cannot say is WHICH row. On a 1594-row file « valeurs non
              reconnues : Krumble Kake » is a fact the user cannot act on.
              Scope is deliberately narrow, on the user's instruction: the two
              MANDATORY columns and the two whose values are IMPOSED. Prose,
              lengths and per-language coverage stay in the Node reviewer tool.
              Gated on a catalogue being loaded — there is nothing to check
              otherwise, and the panel right above already says so. */}
          {catalogueMeta && (
            <ActionBtn icon="check" label={t ? t("cat_audit_btn") : "Vérifier mon catalogue"}
              onClick={auditCatalogue} disabled={!!catalogueAuditBusy} accent={C.sageHi} />
          )}
          {catalogueMeta && catalogueAuditBusy && (
            <div style={{ margin: "8px 0 2px" }}>
              <Notice tone="info">{t ? t("cat_audit_busy") : "Vérification en cours…"}</Notice>
            </div>
          )}
          {catalogueMeta && !catalogueAuditBusy && catalogueAudit && (
            <IssueListPanel
              t={t}
              title={String(t("cat_audit_title"))}
              ok={String(t("cat_audit_ok"))
                .replace("{n}", String(catalogueAudit.rows))
                .replace("{b}", String(catalogueAudit.blends))}
              scope={String(t("cat_audit_scope"))}
              sections={[
                { kind: "no-identity", n: catalogueAudit.noIdentity, label: String(t("cat_audit_identity")).replace("{n}", String(catalogueAudit.noIdentity)) },
                { kind: "duplicate", n: catalogueAudit.duplicates, label: String(t("cat_audit_dupe")).replace("{n}", String(catalogueAudit.duplicates)) },
                { kind: "category", n: catalogueAudit.badCategory, label: String(t("cat_audit_cat")).replace("{n}", String(catalogueAudit.badCategory)) },
                { kind: "cut", n: catalogueAudit.badCut, label: String(t("cat_audit_cut")).replace("{n}", String(catalogueAudit.badCut)) },
              ]}
              issues={catalogueAudit.issues}
              truncated={!!catalogueAudit.truncated}
              onClose={clearCatalogueAudit} />
          )}
          {/* The catalogue's own cloud stream (every cellar mechanism was made
              to ignore it; these are what write to it).
              Placed with the catalogue, not with the cloud section, because
              this is one more thing you do TO your catalogue file. SAVE is
              offered only when a catalogue is loaded (there is nothing to send
              otherwise, and the hook says so rather than reporting a silent
              success); FETCH is offered ALWAYS, because the device that most
              needs it is the one that has none.

              The RESULT renders here, under the two buttons.
              It used to be written to the shared `gdriveStatus`, whose Notice is
              pinned under the CELLAR save button in the Section ABOVE, so the
              answer appeared several rows up the scroll — off screen on a
              phone, and reported as such. The comment that stood here NAMED
              that conflict and shipped anyway, offering the hint below as
              compensation; a hint about what a button DOES is not an answer to
              what it just DID. See `catalogueCloudStatus` in useGdriveSync. */}
          <div style={{
            fontFamily: F.body, fontSize: fs(12), color: C.tx3,
            margin: "10px 2px 6px", lineHeight: 1.45,
          }}>
            {t ? t("cat_cloud_hint") : "Le catalogue voyage dans son propre fichier, séparé de vos sauvegardes de cave : il n'est envoyé que quand vous le demandez."}
          </div>
          {catalogueMeta && (
            <ActionBtn icon="cloud" label={t ? t("cat_cloud_save") : "Sauvegarder le catalogue dans le cloud"}
              onClick={catalogueCloudSave} accent={C.steelHi} />
          )}
          <ActionBtn icon="restore" label={t ? t("cat_cloud_restore") : "Récupérer le catalogue du cloud"}
            onClick={catalogueCloudRestore} accent={C.steelHi} />
          {catalogueCloudStatus && (
            <div style={{ margin: "8px 0 2px" }}>
              <Notice tone={statusToneFromMessage(catalogueCloudStatus)}>{catalogueCloudStatus}</Notice>
            </div>
          )}
          {catalogueMeta && (
            <ActionBtn icon="close" label={t ? t("btn_cat_remove") : "Retirer le catalogue"}
              disabled={!!catalogueBusy}
              onClick={() => {
                if (window.confirm(t ? t("cat_confirm_remove") : "Retirer le catalogue ? Votre cave n'est pas touchée. Vous pourrez le recharger depuis votre fichier.")) {
                  clearCatalogue && clearCatalogue();
                }
              }}
              accent={C.oxbloodHi} />
          )}
        </Section>
        )}

        {activeTab === "data" && (
        <Section title={t ? t("sec_export_import") : "Export & Import"} accent={C.brass}>
          <ActionBtn icon="box"   label={t ? t("btn_export_json") : "Exporter JSON"} onClick={doExport}    accent={C.brassHi} />
          <ActionBtn icon="chart" label={t ? t("btn_export_csv")  : "Exporter CSV"}  onClick={doExportCSV} accent={C.sage} />
          <ActionBtn icon="book"  label={t ? t("btn_export_zip")  : "Exporter ZIP"} onClick={doBackupZip} accent={C.amber} />
          {/* `backupStatus` belongs to the ZIP export ALONE —
              every setBackupStatus call lives inside doBackupZip (the photo
              progress "N/total", "st_zipping", "st_done"). It used to render
              after all seven export/import buttons, five rows below the only
              button that can produce it, so the photo-by-photo progress of a
              long ZIP was off-screen. Do NOT re-generalise this Notice to the
              other actions: JSON/CSV/report/import report through their own
              alerts, and moving it back down would hide the progress again. */}
          {backupStatus && (
            <Notice tone={backupStatus === "done" ? "success" : "info"}>
              {backupStatus === "done" ? (t ? t("st_done") : "✓ OK") : "⏳ " + backupStatus}
            </Notice>
          )}
          <ActionBtn icon="book"  label={t ? t("btn_collection_report") : "Rapport de collection"} onClick={doCollectionReport} accent={C.steelHi} />
          <ActionBtn icon="plus"  label={t ? t("btn_import_file") : "Importer fichier (.json)"} onClick={doImportFile} accent={C.amber} />
          <ActionBtn icon="chart" label={t ? t("btn_import_csv") : "Importer tabacs (.csv)"} onClick={doImportCsvFile} accent={C.sage} />
          {/* The rows the import could not read, under the
              button that produced them (the action↔feedback adjacency rule). The
              recap toast says HOW MANY; a toast is `maxWidth`-bounded and
              self-dismissing, so it cannot say WHICH. Raised only when there
              is something to report. */}
          {csvIssues && (
            <IssueListPanel
              t={t}
              title={String(t("csv_issues_title"))}
              ok=""
              scope={String(t("csv_issues_scope")).replace("{v}", autreLabel)}
              sections={[
                { kind: "no-identity", n: csvIssues.skipped, label: String(t("cat_audit_identity")).replace("{n}", String(csvIssues.skipped)) },
                { kind: "category", n: csvIssues.badCategory, label: String(t("csv_issues_cat")).replace("{n}", String(csvIssues.badCategory)).replace("{v}", autreLabel) },
                { kind: "cut", n: csvIssues.badCut, label: String(t("csv_issues_cut")).replace("{n}", String(csvIssues.badCut)).replace("{v}", autreLabel) },
              ]}
              issues={csvIssues.issues}
              truncated={!!csvIssues.truncated}
              onClose={clearCsvIssues} />
          )}
          <ActionBtn icon="book"  label={t ? t("btn_csv_template") : "Télécharger le modèle CSV"} onClick={doDownloadCsvTemplate} accent={C.tx2} />
          {/* The bulk catalogue pass is NO LONGER here — it
              moved to the catalogue page's own TopBar (CatalogView), which is
              where someone thinking about catalogue data already is. Do not
              re-add it: two entry points for one whole-cellar action is how a
              destructive-looking control ends up in the row above "Effacer
              toutes les données". */}
          <ActionBtn icon="close"
            label={t ? t("btn_reset_all_data") : "Effacer toutes les données"}
            onClick={() => resetAll && resetAll()}
            accent={C.oxbloodHi} />
        </Section>
        )}


        {/* 3. Préférences */}
        {activeTab === "prefs" && (
        <Section title={t ? t("sec_preferences") : "Préférences"} accent={C.amber}>
          {/* Only English is compiled in; the other dictionaries are
              fetched on demand. The Segmented keeps showing the CURRENT language
              while one loads — saveLang flips `lang` only once the dictionary is
              in memory, so the control never lies about what is active. */}
          <Row label={t ? t("lbl_language") : "Langue"}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Segmented value={lang || "en"} setValue={(v) => saveLang && saveLang(v)}
                options={LANGUAGES.map((l) => [l.code, l.label] as [string, string])} />
              {langPending ? <Spinner /> : null}
            </div>
          </Row>
          {langErr ? (
            <div style={{ marginTop: -4, marginBottom: 10 }}>
              {/* Rendered in the language still ACTIVE — the only one guaranteed
                  loaded. Telling someone their chosen language is unavailable in
                  that unavailable language would be its own joke.
                  The copy used to say "reconnect and try again", which
                  CANNOT work: a dynamic import that fails is cached as a failure
                  in the browser's module map, so re-importing the same URL
                  re-throws without touching the network. MEASURED in Chromium:
                  tap offline → reconnect → tap again = ONE request in total, and
                  the second attempt fails identically; only a reload clears it.
                  So the notice now says reload, and offers the button. */}
              <Notice tone="warn">
                {t ? t("lang_offline_err") : "Cette langue doit être téléchargée une première fois. Reconnectez-vous, puis rechargez l'application : réessayer depuis cet écran ne relance pas le téléchargement."}
                <div style={{ marginTop: 8 }}>
                  <ModalAction variant="secondary" onClick={() => { try { window.location.reload(); } catch { /* nothing sensible to do */ } }}>
                    {t ? t("lang_offline_reload") : "Recharger l'application"}
                  </ModalAction>
                </div>
              </Notice>
            </div>
          ) : null}
          {/* Global text-size preference (S/M/L). Multiplies the
              --cave-font-scale CSS variable that every font size derives from. */}
          <Row label={t ? t("lbl_font_scale") : "Taille du texte"}>
            <Segmented value={fontScale || "m"} setValue={(v) => saveFontScale && saveFontScale(v)}
              options={[
                ["s", t ? t("font_scale_s") : "Petit"],
                ["m", t ? t("font_scale_m") : "Moyen"],
                ["l", t ? t("font_scale_l") : "Grand"],
              ]} />
          </Row>
          {/* Colour theme — swaps the brass "gold" identity for a
              steel-blue one via the --c-brass* CSS vars on <html>. */}
          <Row label={t ? t("lbl_theme") : "Thème"}>
            <Segmented value={themeId || "brass"} setValue={(v) => saveThemeId && saveThemeId(v)}
              options={[
                ["brass", t ? t("theme_brass") : "Laiton"],
                ["steel", t ? t("theme_steel") : "Bleu acier"],
                ["english", t ? t("theme_english") : "Anglais"],
              ]} />
          </Row>
          {/* Light/dark mode (parchment vs vault), orthogonal to
              the colour theme. */}
          <Row label={t ? t("lbl_theme_mode") : "Mode"}>
            <Segmented value={themeMode || "dark"} setValue={(v) => saveThemeMode && saveThemeMode(v)}
              options={[
                ["dark", t ? t("theme_mode_dark") : "Sombre"],
                ["light", t ? t("theme_mode_light") : "Clair"],
              ]} />
          </Row>
          <Row label={t ? t("lbl_weight_unit") : "Unité de poids"}>
            <Segmented value={weightUnit || "g"} setValue={(v) => saveWeightUnit && saveWeightUnit(v)}
              options={[["g", "g"], ["oz", "oz"]]} />
          </Row>
          <Row label={t ? t("lbl_length_unit") : "Unité de longueur"}>
            <Segmented value={lengthUnit || "mm"} setValue={(v) => saveLengthUnit && saveLengthUnit(v)}
              options={[["mm", "mm"], ["in", "in"]]} />
          </Row>
          {/* Currency symbol — picked from a fixed preset
              (€ / $ / £ / CHF / JPY). Affects every price label and
              display row across the app. Stored in
              localStorage["cave-currency"]. */}
          <Row label={t ? t("lbl_currency") : "Devise"}>
            <Segmented value={currencySymbol || "€"}
              setValue={(v) => saveCurrencySymbol && saveCurrencySymbol(v)}
              options={[
                ["€",   "€"],
                ["$",   "$"],
                ["£",   "£"],
                ["CHF", "CHF"],
                ["JPY", "JPY"],
              ]} />
          </Row>
          <Row label={t ? t("lbl_date_format") : "Format de date"}>
            {/* Show today's date as the live example so the
                user always sees a current preview, not a stale 2024 string. */}
            <Segmented value={dateFormat || "fr"} setValue={(v) => saveDateFormat && saveDateFormat(v)}
              options={[
                ["fr", "FR (" + fmtDate(today(), "fr") + ")"],
                ["en", "EN (" + fmtDate(today(), "en") + ")"],
              ]} />
          </Row>
          <Row label={t ? t("lbl_default_grouping") : "Listes groupées par défaut"}>
            <Segmented
              value={defaultListGrouped ? "grouped" : "flat"}
              setValue={(v) => saveDefaultListGrouped && saveDefaultListGrouped(v === "grouped")}
              options={[
                ["grouped", t ? t("lbl_grouped") : "Groupé"],
                ["flat",    t ? t("lbl_flat") : "À plat"],
              ]} />
          </Row>
          {/* Master switch for the maintenance-reminder indicator.
              OFF hides every reminder surface (Home section, pipe card chip,
              pipe fiche Notice) but keeps the threshold value editable. */}
          <Toggle
            value={maintRemindersEnabled !== false}
            setValue={(v) => saveMaintRemindersEnabled && saveMaintRemindersEnabled(v)}
            label={t ? t("lbl_maint_reminders") : "Rappels d'entretien"}
            hint={t ? t("maint_reminders_hint") : "Signaler les pipes à entretenir (accueil + fiche pipe)"} />
          {/* Pipe maintenance-reminder threshold (sessions since the
              last cleaning before a pipe is flagged "à entretenir"). Kept
              editable even when the reminders are OFF — the value isn't lost. */}
          {maintRemindersEnabled !== false && (
          <Row label={t ? t("lbl_maint_threshold") : "Rappel d'entretien (séances)"}
               sub={t ? t("maint_threshold_hint") : "Nb de séances avant de signaler une pipe à entretenir"}>
            <WatchThresholdInput
              value={String(maintReminderThreshold ?? 5)}
              onCommit={(v) => saveMaintReminderThreshold && saveMaintReminderThreshold(v)}
              ariaLabel={t ? t("lbl_maint_threshold") : "Rappel d'entretien (séances)"}
              ring={mrtRing} />
          </Row>
          )}
        </Section>
        )}

        {/* Dedicated "Comptabilité" section in the prefs tab.
            Groups the on/off toggle and the default session weight —
            both control how new sessions interact with lot stocks. The
            default weight stays editable while the toggle is OFF: the
            value isn't lost, it's just unused until the user re-enables
            accounting. */}
        {activeTab === "prefs" && (
        <Section title={t ? t("sec_accounting") : "Comptabilité"} accent={C.sage}>
          <Toggle
            value={accountingEnabled !== false}
            setValue={(v) => saveAccountingEnabled && saveAccountingEnabled(v)}
            label={t ? t("lbl_accounting_setting") : "Comptabilité (déduction des lots)"} />
          {accountingEnabled === false && (
            <div style={{
              margin: "-4px 0 4px", padding: "8px 10px",
              background: alpha(C.amber, "1c"), border: `1px solid ${alpha(C.amber, "55")}`,
              borderRadius: 8, fontSize: fs(13.5), color: C.tx2, lineHeight: 1.45,
            }}>
              {t ? t("accounting_off_long_notice") : "Les nouvelles séances sont enregistrées avec un grammage de 0 g. Pas de déduction de lot, pas de passage automatique en Terminé, et ces séances n'apparaissent pas dans les graphes de poids fumé. Le sélecteur de lot reste utile pour noter quel lot tu as fumé, et un lot en cave passe quand même en pot à l'enregistrement (réalité physique : la boîte est ouverte)."}
            </div>
          )}
          <Row label={(t ? t("lbl_sess_default_weight") : "Grammage par défaut (séances)") + ` (${weightUnit || "g"})`}
               sub={t ? t("sess_default_weight_hint") : "Utilisé quand les dimensions du foyer de la pipe manquent (sinon le grammage est estimé d'après le foyer et la coupe)."}>
            <input
              type="text" inputMode="decimal"
              value={sessDefaultWeight || ""}
              aria-label={(t ? t("lbl_sess_default_weight") : "Grammage par défaut (séances)") + " (" + (weightUnit || "g") + ")"}
              onChange={(e) => {
                const v = String(e.target.value).replace(",", ".");
                setSessDefaultWeight && setSessDefaultWeight(v);
                lsSet("cave-session-default-weight", v);
              }}
              onFocus={(e) => { sdwRing.onFocus(); caretToEnd(e); }}
              onBlur={sdwRing.onBlur}
              style={{
                width: 70, padding: "7px 10px",
                background: C.bg2, color: C.ivory,
                border: `1px solid ${C.rule}`, borderRadius: 8,
                fontFamily: F.mono, fontSize: fsInput(17), textAlign: "right",
                outline: "none", transition: "box-shadow 200ms, border-color 200ms",
                ...(sdwRing.style || {}),
              }} />
          </Row>
        </Section>
        )}

        {/* "À surveiller" thresholds. Both inputs keep
            the raw text in LOCAL state while typing and only commit
            (clamped) on blur — committing on every keystroke would
            re-fill the field the instant it's emptied (the
            prefill-race trap: "I can't change this field"). */}
        {activeTab === "prefs" && (
        <Section title={t ? t("home_watch_title") : "À surveiller"} accent={C.amber}>
          <Row label={(t ? t("lbl_watch_low_weight") : "Seuil stock bas") + ` (${weightUnit || "g"})`}
               sub={t ? t("watch_low_hint") : "En dessous, un tabac est signalé (sauf « à ne pas reprendre »)"}>
            <WatchThresholdInput
              value={watchLowWeight || "25"}
              onCommit={(v) => saveWatchLowWeight && saveWatchLowWeight(v)}
              ariaLabel={(t ? t("lbl_watch_low_weight") : "Seuil stock bas") + " (" + (weightUnit || "g") + ")"}
              ring={wlwRing} />
          </Row>
        </Section>
        )}

        {/* 4. Assistant IA (data tab — API key is a piece of data) */}
        {activeTab === "data" && (
        <Section title={t ? t("sec_ai") : "🤖 Assistant IA"} accent={C.oxbloodHi}>
          {/* Preferred auto-fill source. The default, "local",
              consults the CATALOGUE the user
              loaded themselves first — instant, offline, no key needed. "ai"
              puts the configured provider first instead, and falls back to the
              catalogue when the call fails OR when no key is set.
              The option is labelled "Catalogue", not "Base
              locale". The app used to ship a catalogue, so "local
              DB" described something the user neither chose nor owned; now
              there is nothing to consult but their own file, and calling it a
              free built-in base states the opposite of what the app now does. */}
          <Row label={t ? t("lbl_autofill_source") : "Source prioritaire"}
               sub={t ? t("autofill_source_sub") : "Votre catalogue répond instantanément, hors-ligne et sans clé — s'il contient le blend. L'agent IA peut produire des données plus récentes ou détaillées, mais consomme du quota et nécessite une connexion."}>
            <Segmented value={autofillSource === "ai" ? "ai" : "local"}
              setValue={(v) => saveAutofillSource && saveAutofillSource(v as "local" | "ai")}
              options={[
                ["local", t ? t("autofill_src_local") : "Catalogue"],
                ["ai", t ? t("autofill_src_ai") : "Agent IA"],
              ]} />
          </Row>
          <Row label={t ? t("lbl_provider") : "Fournisseur"}>
            <Segmented value={aiProvider || "anthropic"}
              setValue={(v) => saveAiProvider && saveAiProvider(v)}
              options={[
                ["anthropic", "Claude"], ["openai", "GPT"], ["gemini", "Gemini"],
              ]} />
          </Row>
          {/* User-selectable model per provider. */}
          <Row label={t ? t("lbl_ai_model") : "Modèle"}
               sub={aiModel === "auto"
                 // Under "auto" the user delegated the choice, so
                 // name the model that will actually run — otherwise the
                 // setting is opaque about what it spends.
                 ? `${t ? t("lbl_ai_model_auto") : "Auto : le modèle le moins cher disponible"} · ${aiModelResolved || ""}`
                 : (t ? t("lbl_ai_model_hint") : "Un modèle plus puissant est plus lent et coûteux")}>
            {(() => {
              const prov = aiProvider || "anthropic";
              const opts = (AI_MODEL_OPTIONS[prov] || []).slice();
              // Keep the current value selectable even if it's not a preset
              // (e.g. a model saved before the option list changed).
              if (aiModel && !opts.some((o: any) => o.id === aiModel)) {
                opts.unshift({ id: aiModel, label: aiModel });
              }
              return (
                <select
                  aria-label={t ? t("lbl_ai_model") : "Modèle"}
                  value={aiModel || ""}
                  onChange={(e) => saveAiModel && saveAiModel(e.target.value)}
                  style={{
                    background: C.bg2, color: C.tx, border: `1px solid ${C.rule}`,
                    borderRadius: 8, padding: "8px 10px", fontFamily: F.body,
                    fontSize: fs(15), minWidth: 150, maxWidth: 190, outline: "none",
                    ...amRing.style,
                  }}
                  onFocus={amRing.onFocus} onBlur={amRing.onBlur}>
                  {opts.map((o: any) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              );
            })()}
          </Row>
          {/* The liveness verdict sits directly under the picker that
              produced it — the same action → feedback adjacency as the cloud
              save status. It answers "ce modèle répond-il ?" at the moment of
              choice instead of at the next search, which is the gap that let a
              four-month Gemini outage pass unnoticed. Free metadata GET, no
              tokens; only shown once there is a key to check against. */}
          {apiKey ? (
            <div style={{ padding: "0 18px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <PressCard
                onClick={() => probeModel && probeModel()}
                style={{
                  padding: "6px 12px", borderRadius: 8, background: "transparent",
                  border: `1px solid ${C.rule}`, color: C.tx2,
                  fontFamily: F.body, fontSize: fs(13.5),
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                {modelProbe && modelProbe.state === "busy" ? <Spinner /> : null}
                {t ? t("btn_check_model") : "Vérifier le modèle"}
              </PressCard>
              {modelProbe && modelProbe.state !== "busy" ? (
                <span style={{
                  fontFamily: F.mono, fontSize: fs(12.5),
                  color: modelProbe.state === "ok" ? C.sageHi
                    : modelProbe.state === "gone" ? C.oxbloodHi : C.amber,
                }}>
                  {modelProbe.state === "ok"
                    ? (t ? t("ai_model_ok") : "disponible")
                    : modelProbe.state === "gone"
                      ? (t ? t("ai_model_gone_short") : "ne répond plus")
                      : (t ? t("ai_model_unchecked") : "vérification impossible")}
                  {" · "}{modelProbe.model}
                </span>
              ) : null}
            </div>
          ) : null}
          <Row label={t ? t("lbl_api_key") : "Clé API"}
               sub={t ? t("lbl_stored_locally") : "Stockée localement"}>
            <ApiKeyInput
              key={aiProvider}
              defaultValue={apiKey || ""}
              placeholder={aiProvider === "openai" ? "sk-..."
                : aiProvider === "gemini" ? "AIza..." : "sk-ant-..."}
              onSave={(v) => { saveApiKey && saveApiKey(v); }}
              onClear={() => { saveApiKey && saveApiKey(""); }}
              hasKey={!!apiKey}
              saveLabel={t ? t("btn_save_key") : "✓ Sauvegarder"}
            />
          </Row>
          {apiKey && (
            <Notice tone="success">{"✓ " + maskApiKey(apiKey)}</Notice>
          )}
          <Toggle
            value={!!excludeApiKey}
            setValue={(v) => {
              setExcludeApiKey && setExcludeApiKey(v);
              lsSet("cave-exclude-apikey", v ? "1" : "0");
            }}
            label={t ? t("lbl_excl_apikey") : "Exclure les clés API des exports et sauvegardes"}
          />
        </Section>
        )}

        {/* 5. Application */}
        {activeTab === "app" && (
        <Section id="settings-update-section" title={t ? t("sec_application") : "Application"} accent={C.brassHi}>
          {/* "Install app" CTA — only visible when Chrome
              has fired `beforeinstallprompt` (Android Chrome + browsers
              that implement the same event). Hidden on iOS Safari, on
              already-installed PWAs, and once the user accepts/dismisses
              (Chrome won't re-fire for a while after dismissal). */}
          {canInstallApp && (
            <Row label={t ? t("lbl_install_app") : "Installer l'app"}
                 sub={t ? t("install_app_sub") : "Ajoute l'app à ton écran d'accueil pour un usage natif."}>
              <SettingsButton variant="primary" accent={C.brassHi}
                label={t ? t("btn_install") : "Installer"}
                onClick={triggerInstall} />
            </Row>
          )}
          {/* iOS-Safari fallback nudge. Safari never fires
              `beforeinstallprompt`, so the Android `canInstallApp` CTA
              above is hidden on iPhone — leaving iOS users with no
              in-app indication that the app can live on the home
              screen. We surface a short Notice with the 2-step
              instruction (Share → Add to Home Screen). Gated to: real
              iOS device + not already standalone.
              Read IS_IOS from ctx (single source of truth
              with App.tsx) instead of re-implementing the detection.
              Also added an Android-A2HS fallback Notice for users whose
              browser never fires `beforeinstallprompt` (Firefox Android,
              Samsung Internet, Chrome that previously declined). */}
          {(() => {
            const isStandalone = (navigator as any).standalone === true ||
              (typeof window.matchMedia === "function" &&
               window.matchMedia("(display-mode: standalone)").matches);
            if (isStandalone) return null;
            // iOS Safari A2HS instructions.
            if (IS_IOS) {
              return (
                <div style={{ padding: "0 16px 12px" }}>
                  <Notice tone="info">
                    <strong>{t ? t("install_ios_title") : "Installer cette app sur votre iPhone"}</strong>
                    <div style={{ marginTop: 6, fontSize: fs(15), color: C.tx2, lineHeight: 1.5 }}>
                      {t ? t("install_ios_body") : "Touchez l'icône Partager (en bas de Safari, carré + flèche), puis « Sur l'écran d'accueil »."}
                    </div>
                  </Notice>
                </div>
              );
            }
            // Android / desktop fallback when the native install prompt
            // isn't available (canInstallApp is false in those cases —
            // checked upstream via the install button render gate).
            if (typeof canInstallApp !== "undefined" && !canInstallApp) {
              return (
                <div style={{ padding: "0 16px 12px" }}>
                  <Notice tone="info">
                    <strong>{t ? t("install_android_title") : "Installer cette app"}</strong>
                    <div style={{ marginTop: 6, fontSize: fs(15), color: C.tx2, lineHeight: 1.5 }}>
                      {t ? t("install_android_body") : "Ouvrez le menu de votre navigateur (⋮ en haut à droite) puis « Ajouter à l'écran d'accueil » ou « Installer »."}
                    </div>
                  </Notice>
                </div>
              );
            }
            return null;
          })()}
          <Row label={(t ? t("app_name") : "Ma Cave à Tabac") + ` v${APP_VERSION} (${APP_BUILD})`}>
            <SettingsButton variant="ghost"
              label={t ? t("btn_check_update") : "Rafraîchir les données"}
              onClick={checkUpdate}
              disabled={updateStatus === "checking"} />
          </Row>
          {/* The check can FAIL, and its `.catch` is empty by
              necessity (a transient failure must not be noise). That made a
              PERMANENT failure — a broken deploy, a 404, a captive portal, a
              filtered network — indistinguishable from a healthy app, for
              ever, at one silent retry every 120 s. The poll runs every 2 min
              while the app is open, so this line is fresh within seconds on a
              healthy device: a stale value never means "you have not opened
              the app in a while", it always means "the check is failing right
              now", and it clears itself the moment one succeeds. */}
          {(function () {
            var stale = lastCheckOkMs == null || (Date.now() - lastCheckOkMs) > VERSION_CHECK_STALE_MS;
            if (!stale) return null;
            return (
              <Notice tone="warn" icon="diamond">
                {(t ? t("upd_check_stale") : "Impossible de vérifier les mises à jour depuis un moment — vérifiez votre connexion.")
                  + (lastCheckOkMs ? " (" + fmtDate(new Date(lastCheckOkMs).toISOString().slice(0, 10), dateFormat) + ")" : "")}
              </Notice>
            );
          })()}
          {updateStatus === "checking" && <Notice tone="info">{"⏳ " + (t ? t("upd_checking") : "Vérification...")}</Notice>}
          {updateStatus === "ok"       && <Notice tone="success">{"✓ " + (t ? t("upd_ok") : "Application à jour — rafraîchissement des données…")}</Notice>}
          {updateStatus === "error"    && <Notice tone="error">{t ? t("upd_error") : "Erreur réseau"}</Notice>}
          {/* Keyed on `newerBuild`, NOT `updateAvailable`.
              `updateAvailable` is only set on the path that shows a banner, so
              a data_only release (silent by design) rendered NOTHING here —
              and neither did a release the anti-loop latch had stood down on,
              or one whose attempt marker failed to persist. In all of those
              the app knew it was behind and no screen said so. `newerBuild` is
              recorded on every detection and gated by nothing, so this row is
              the floor: whatever the automatic paths decide, the update is one
              visible tap away. */}
          {newerBuild && !updateStatus && (
            <Notice
              /* Audit: tone="info", not "warn". `warn` renders
                 amber + the alert diamond AND sets role="alert" — an assertive
                 live region, the same ARIA class as a save failure or a full
                 disk. A new version existing is routine news. Visually and to a
                 screen reader the app was filing "there is an update" under
                 incidents, and it sat directly beside the stale-check notice
                 which IS a real warning, making the two indistinguishable. */
              tone="info"
              action={
                <SettingsButton variant="primary" accent={C.amber}
                  label={t ? t("upd_do") : "Mettre à jour"}
                  onClick={() => setUpdateStatus && setUpdateStatus(newerBuild)} />
              }>
              {(t ? t("upd_available") : "Nouvelle version disponible") + ` → v${newerBuild.version} (${newerBuild.build})`}
              {/* And WHY it has not applied by itself. Four
                  brakes can hold a detected update — an open form, a
                  postponement, the anti-loop latch, or the silent path waiting
                  for the app to close — and none of them said so, so "it is
                  available and nothing happens" was unanswerable by the user
                  AND by me. `counting`/`idle` need no line: one is visibly
                  counting down, the other is about to. */}
              {(function () {
                var DEFER_KEY: Record<string, string> = {
                  tasting: "upd_why_deferred_tasting", maint: "upd_why_deferred_maint",
                  wish: "upd_why_deferred_wish", lot: "upd_why_deferred_lot",
                  form: "upd_why_deferred_form",
                };
                var key = { deferred: DEFER_KEY[String(deferReason)] || "upd_why_deferred_form",
                  declined: "upd_why_declined",
                  suppressed: "upd_why_suppressed", silent: "upd_why_silent" }[String(pendingReason)];
                if (!key) return null;
                return <div style={{ marginTop: 6, fontSize: fs(13), opacity: 0.9 }}>{t ? t(key) : key}</div>;
              })()}
            </Notice>
          )}
          {updateStatus && typeof updateStatus === "object" && !updateStatus.warn && (
            <UpdateConfirmPanel
              updateStatus={updateStatus}
              setUpdateStatus={setUpdateStatus}
              doUpdate={doUpdate}
              t={t}
            />
          )}
          {/* UpdateWarnPanel is GONE. It claimed « Vos données
              (tabacs, pipes, notes) peuvent être perdues lors de la mise à
              jour » — VERIFIED FALSE: doUpdate touches only service workers
              and Cache Storage, never localStorage (where the whole cellar
              lives) nor IndexedDB (photos). reset.html performs the identical
              purge and help.html says of it « ne supprime pas vos données » —
              the same operation documented as safe under one name and
              destructive under the other. It was also MANDATORY on the manual
              route while the countdown, "update now" and the silent path all
              reload with no warning at all, so the app alarmed the user only
              when they deliberately asked. */}
        </Section>
        )}

        {/* 6. Sections visibility — fused into the "prefs" tab. */}
        {activeTab === "prefs" && (
        <Section title={t ? t("sec_sections") : "Sections"} accent={C.sage}>
          {/* Explanatory hint at the top so the user
              understands what these toggles do (was a bare list of
              switches without context). */}
          <div style={{
            fontSize: fs(13.5), color: C.tx3, lineHeight: 1.5,
            fontFamily: F.body, fontStyle: "italic",
            padding: "0 4px",
          }}>
            {t ? t("sections_hint") : "Ces interrupteurs affichent ou masquent les sections correspondantes dans l'app (barre du bas + écran d'accueil)."}
          </div>
          {[
            // The "stats" key used `t("nav_stats")` which
            // resolves to the 📊 emoji (the dock icon glyph). In a
            // settings list of textual toggles the emoji looked out
            // of place — explicit label here, dock still uses the
            // emoji. The other two keep their `nav_*` labels because
            // they're already plain words ("Accessoires" / "Journal").
            ["acc",     t ? t("nav_acc")     : "Accessoires"],
            ["journal", t ? t("nav_journal") : "Journal"],
            ["stats",   t ? t("sec_stats") : "Statistiques"],
          ].map(([key, label]) => {
            const on = visibleSections?.[key as string] !== false;
            return (
              <Toggle
                key={key as string}
                value={on}
                setValue={(v) => {
                  const nv = Object.assign({}, visibleSections || {});
                  nv[key as string] = v;
                  setVisibleSections && setVisibleSections(nv);
                  lsSet("cave-sections", JSON.stringify(nv));
                  if (!v && view === key) nav && nav("home");
                }}
                label={label as string}
              />
            );
          })}
        </Section>
        )}

        {/* Diagnostic panel — surfaces persisted runtime
            invariant violations so a user can spot data drift without
            opening the dev console. The counter is incremented in
            recordViolations whenever save() runs through
            assertLotInvariants. */}

        {activeTab === "app" && (
          <DiagnosticSection t={t} dateFormat={dateFormat} />
        )}

        {/* TrashSection moved out into a dedicated
            CuratorTrashModal — opened straight from the Home top-bar
            trash icon. The Settings modal stays focused on actual
            settings (preferences, Drive, AI, export, app). */}

        {/* 7. Aide & infos (liens externes) */}
        {activeTab === "help" && (
        <Section title={t ? t("sec_help_info") : "Aide & infos"} accent={C.brass}>
          {/* Open via openDocFromSettings so the doc page's back /
              X returns to THIS Settings modal, not Home. */}
          <ExtLink icon="book" label={t ? t("btn_help") : "Mode d'emploi"}
            onClick={() => { if (openDocFromSettings) openDocFromSettings("help"); else if (nav) nav("help"); }} />
          <ExtLink icon="more"      href="mailto:macaveatabac@gmail.com"
                                                            label={t ? t("btn_contact") : "Contact"} />
          <ExtLink icon="chart"     label={t ? t("btn_whats_new") : "Nouveautés"}
            onClick={() => { if (openDocFromSettings) openDocFromSettings("changelog"); else if (nav) nav("changelog"); }} />
          <ExtLink icon="check"     label={t ? t("btn_privacy") : "Confidentialité"}
            onClick={() => { if (openDocFromSettings) openDocFromSettings("privacy"); else if (nav) nav("privacy"); }} />
          <ExtLink icon="diamond"   label={t ? t("btn_licenses") : "Licence & crédits"}
            onClick={() => { if (openDocFromSettings) openDocFromSettings("licenses"); else if (nav) nav("licenses"); }} />
          {/* "Réparer l'application" link removed from
              the menu (reset.html still accessible at the direct
              URL for emergencies). The dangerous auto-repair button
              in the Diagnostic section is removed too — its logic
              operated on liveData and could wipe the trash, and it
              re-cleared session.tobaccoId / pipeId / lotId in
              violation of the immutable-sessions policy. */}
        </Section>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.rule}`,
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: F.display, fontStyle: "italic", fontSize: fs(20),
            color: C.brassHi, letterSpacing: 0.2,
          }}>{t ? t("app_name") : "Ma Cave à Tabac"}</div>
          {/* eslint-disable-next-line tabac-local/no-hardcoded-jsx-text -- "v … · build N" is a version identifier, not translatable copy; matches the app's "vX.Y · Build N" changelog convention. */}
          <Lbl color={C.tx3} size={9.5}>v {APP_VERSION} · build {APP_BUILD}</Lbl>
        </div>
      </div>
    </Modal>
    {/* Import-confirm picker renders AFTER the Settings modal
        so it stacks visually on top (same z-index, later DOM order wins).
        Lives outside the Settings Modal so closing Settings doesn't
        dismiss an in-flight import decision. */}
    {importConfirm && (
      <ImportConfirmPanel
        importConfirm={importConfirm}
        applyImport={applyImport}
        cancelImport={cancelImport}
        dateFormat={dateFormat as "fr" | "en"}
        t={t} />
    )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Import-confirm picker. Three buttons:
//   • Replace  — wipes local data and uses the imported payload (legacy
//                behaviour, kept for round-trip recoveries).
//   • Merge    — keeps existing entries, appends only items whose
//                brand+name isn't already in the local store. Sessions
//                are remapped to the corresponding local tobacco/pipe
//                ids and de-duped by (date, tobaccoId, pipeId, duration).
//   • Cancel   — abort, no data change.
// The component is purely presentational — all merge logic lives in
// `applyImport()` inside the useExportImport hook.
// ─────────────────────────────────────────────────────────────
function ImportConfirmPanel({
  importConfirm, applyImport, cancelImport, dateFormat, t,
}: {
  importConfirm: {
    parsed: any;
    imgData: Record<string, string>;
    dupCounts: { tobaccos: number; pipes: number; wishlist: number; accessories: number };
    incoming: { tobaccos: number; pipes: number; wishlist: number; accessories: number; sessions: number };
  };
  applyImport: (mode: "replace" | "merge", selection?: Set<string>) => void;
  cancelImport: () => void;
  dateFormat?: "fr" | "en";
  t?: (k: string) => string;
}) {
  const { incoming, dupCounts, parsed } = importConfirm;
  const tr = (k: string, frFallback: string) => (t ? t(k) : frFallback);
  // Optional second pane — a checkbox picker that lets
  // the user merge only a chosen subset of the imported payload.
  // Toggled by the new "Sélection" button below Merge / Replace.
  // The selection set carries "kind:id" strings, matching the
  // encoding `useImportConfirm.applyImport` expects for its
  // optional `selection` argument.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  function toggleKey(k: string) {
    setSelectedSet(function (prev) {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  function toggleSection(kind: string, items: any[]) {
    // "Tout / Aucun" toggle per section: if any item in the section
    // is currently selected, deselect them all; otherwise select them.
    setSelectedSet(function (prev) {
      const next = new Set(prev);
      const ids = items.map(it => kind + ":" + String(it.id));
      const anyOn = ids.some(k => next.has(k));
      if (anyOn) ids.forEach(k => next.delete(k));
      else ids.forEach(k => next.add(k));
      return next;
    });
  }
  function row(n: number, dup: number, label: string) {
    if (n === 0) return null;
    return (
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 10,
        padding: "5px 0", fontSize: fs(15), color: C.tx,
      }}>
        <span>{label}</span>
        <span style={{ fontFamily: F.mono, color: dup > 0 ? C.amber : C.tx2 }}>
          {n}
          {dup > 0 && (
            <span style={{ color: C.amber, marginLeft: 6 }}>
              ({dup} {tr("import_dup_short", "dupl.")})
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <Modal open={true} onClose={cancelImport} maxWidth={460}
      ariaLabel={tr("import_strategy_aria", "Stratégie d'import")}>
      <ModalHeader
        overline={t ? t("sec_import") : "Import"}
        title={tr("import_choose_title", "Comment importer ?")}
        onClose={cancelImport}
        accent={C.amber} />
      <div style={{ padding: "0 18px 18px" }}>
        <div style={{
          padding: "8px 12px", borderRadius: 8,
          background: C.bg2, border: `1px solid ${C.rule}`,
          marginBottom: 12,
        }}>
          {row(incoming.tobaccos,    dupCounts.tobaccos,    tr("nav_tobaccos",      "Tabacs"))}
          {row(incoming.pipes,       dupCounts.pipes,       tr("aria_pipes",        "Pipes"))}
          {row(incoming.wishlist,    dupCounts.wishlist,    tr("lbl_wishlist",      "Wishlist"))}
          {row(incoming.accessories, dupCounts.accessories, tr("aria_accessories",  "Accessoires"))}
          {row(incoming.sessions,    0,                     tr("stat_sessions",     "Séances"))}
        </div>

        {(dupCounts.tobaccos + dupCounts.pipes + dupCounts.wishlist + dupCounts.accessories) > 0 && (
          <div style={{
            padding: "8px 12px", marginBottom: 12, borderRadius: 8,
            background: alpha(C.amber, "1f"), border: `1px solid ${alpha(C.amber, "88")}`,
            color: C.amber, fontSize: fs(13.5), lineHeight: 1.45,
          }}>
            ⚠ {tr("import_warn_dup", "Les éléments marqués « dupl. » ont les mêmes marque + nom qu'un élément déjà présent. Fusionner les ignore ; Remplacer écrase tout.")}
          </div>
        )}

        {selectMode ? (
          /* Selection picker. Lists every importable
             entity grouped by kind, each with a checkbox. Per-section
             "Tout / Aucun" toggle. Tap "Importer la sélection"
             commits via applyImport("merge", selectedSet). Sessions
             are NOT exposed for selection — they pass through the
             merge unfiltered, and the existing dedup logic
             (date+tobId+pipeId+duration) keeps the journal clean. */
          <ImportSelectionList
            parsed={parsed}
            t={t}
            dateFormat={dateFormat}
            selectedSet={selectedSet}
            toggleKey={toggleKey}
            toggleSection={toggleSection}
            onConfirm={() => applyImport("merge", selectedSet)}
            onBack={() => { setSelectMode(false); setSelectedSet(new Set()); }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <PressCard onClick={() => applyImport("merge")} style={{
              padding: "11px 14px",
              background: alpha(C.sage, "1f"), border: `1px solid ${alpha(C.sage, "88")}`,
              borderRadius: 8, textAlign: "left",
            }}>
              <div style={{ color: C.sageHi, fontFamily: F.mono, fontSize: fs(12.5), letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>
                {tr("import_merge", "Fusionner")}
              </div>
              <div style={{ color: C.tx, fontSize: fs(15), lineHeight: 1.4 }}>
                {tr("import_merge_desc", "Rien n'est effacé. Les éléments absents sont ajoutés ; une fiche déjà présente peut recevoir les lots du fichier qui lui manquent, et voir ses informations rafraîchies si la copie importée est plus récente. Vos poids, séances et photos locales sont préservés.")}
              </div>
            </PressCard>

            {/* Third option — selective merge. The user
                picks which entities from the imported payload to
                bring in. Sessions ride with the merge as usual. */}
            <PressCard onClick={() => setSelectMode(true)} style={{
              padding: "11px 14px",
              background: alpha(C.brass, "1a"), border: `1px solid ${alpha(C.brass, "88")}`,
              borderRadius: 8, textAlign: "left",
            }}>
              <div style={{ color: C.brassHi, fontFamily: F.mono, fontSize: fs(12.5), letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>
                {tr("import_select_items", "Sélectionner les éléments")}
              </div>
              <div style={{ color: C.tx, fontSize: fs(15), lineHeight: 1.4 }}>
                {tr("import_select_desc", "Choisir lesquels des tabacs, pipes, envies, accessoires et séances du fichier à fusionner dans votre inventaire.")}
              </div>
            </PressCard>

            <PressCard onClick={() => applyImport("replace")} style={{
              padding: "11px 14px",
              background: alpha(C.oxblood, "1f"), border: `1px solid ${alpha(C.oxblood, "88")}`,
              borderRadius: 8, textAlign: "left",
            }}>
              <div style={{ color: C.oxbloodHi, fontFamily: F.mono, fontSize: fs(12.5), letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>
                {tr("import_replace", "Remplacer")}
              </div>
              <div style={{ color: C.tx, fontSize: fs(15), lineHeight: 1.4 }}>
                {tr("import_replace_desc", "Effacer les données locales et utiliser le fichier importé. À utiliser pour une restauration propre depuis une sauvegarde.")}
              </div>
            </PressCard>

            <PressCard onClick={cancelImport} style={{
              padding: "10px 12px",
              background: C.bg2, border: `1px solid ${C.rule}`,
              borderRadius: 8, textAlign: "center",
              color: C.tx, fontFamily: F.mono, fontSize: fs(13),
              letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {tr("btn_cancel", "Annuler")}
            </PressCard>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Helper sub-components
// ─────────────────────────────────────────────────────────────

// ImportSelectionList — second pane of
// ImportConfirmPanel. Lists every importable entity (tabacs / pipes /
// wishlist / accessories / sessions) grouped by kind with checkboxes.
// Per-section "Tout / Aucun" toggle. Sessions are now
// selectable too — leaving the Sessions section empty in the picker
// imports zero sessions (symmetric with the other four kinds).
// Session labels are resolved via the imported snapshot first
// (tobaccoSnapshot / pipeSnapshot — frozen at save time), falling
// back to a lookup in the imported tabacs/pipes arrays.
function ImportSelectionList({
  parsed, t, dateFormat, selectedSet, toggleKey, toggleSection, onConfirm, onBack,
}: {
  parsed: any;
  t?: ((k: string) => string) | undefined;
  dateFormat?: "fr" | "en" | undefined;
  selectedSet: Set<string>;
  toggleKey: (k: string) => void;
  toggleSection: (kind: string, items: any[]) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const tr = (k: string, frFallback: string) => (t ? t(k) : frFallback);
  const tobs = (parsed.tobaccos || []).filter((it: any) => it);
  const pipes = (parsed.pipes || []).filter((it: any) => it);
  const wishes = (parsed.wishlist || []).filter((it: any) => it);
  const accs = (parsed.accessories || []).filter((it: any) => it);
  const sessions = (parsed.sessions || []).filter((it: any) => it);
  // Map imported tobaccos / pipes by id for the session label
  // resolver (snapshot first, then lookup against the imported
  // entities — never against local data, the picker shows the
  // file's view of the world).
  const tobById: Record<string, any> = {};
  tobs.forEach((t: any) => { if (t.id !== undefined) tobById[String(t.id)] = t; });
  const pipeById: Record<string, any> = {};
  pipes.forEach((p: any) => { if (p.id !== undefined) pipeById[String(p.id)] = p; });
  function sessionLabel(s: any): string {
    const tobRef = s.tobaccoSnapshot
      ? [s.tobaccoSnapshot.brand, s.tobaccoSnapshot.name].filter(Boolean).join(" ")
      : (s.tobaccoId !== undefined && tobById[String(s.tobaccoId)]
          ? [tobById[String(s.tobaccoId)].brand, tobById[String(s.tobaccoId)].name]
              .filter(Boolean).join(" ")
          : "");
    const dateBit = s.date ? fmtDate(s.date, dateFormat) : tr("import_no_date", "sans date");
    const dur = s.duration ? ` · ${s.duration} ${tr("min_short", "min")}` : "";
    return dateBit + (tobRef ? ` · ${tobRef}` : "") + dur;
  }
  function entityRowLabel(it: any): string {
    return [it.brand, it.name].filter(Boolean).join(" — ") || "—";
  }
  const sections: { kind: string; label: string; items: any[]; accent: string;
    rowLabel: (it: any) => string }[] = [
    { kind: "tobacco",   label: tr("nav_tobaccos",         "Tabacs"),      items: tobs,    accent: C.brassHi,   rowLabel: entityRowLabel },
    { kind: "pipe",      label: tr("aria_pipes",           "Pipes"),       items: pipes,   accent: C.oxbloodHi, rowLabel: entityRowLabel },
    { kind: "wish",      label: tr("import_section_wishes", "Envies"),     items: wishes,  accent: C.oxbloodHi, rowLabel: entityRowLabel },
    { kind: "accessory", label: tr("aria_accessories",     "Accessoires"), items: accs,    accent: C.ember,     rowLabel: entityRowLabel },
    { kind: "session",   label: tr("stat_sessions",        "Séances"),     items: sessions, accent: C.sage,     rowLabel: sessionLabel },
  ].filter(s => s.items.length > 0);
  const total = selectedSet.size;
  return (
    <div>
      <div style={{
        marginBottom: 10, padding: "8px 12px", borderRadius: 8,
        background: alpha(C.brass, "12"), border: `1px solid ${alpha(C.brass, "88")}`,
        color: C.brassHi, fontSize: fs(13.5), lineHeight: 1.45,
      }}>
        {tr("import_pick_intro", "Choisissez les éléments à fusionner. Les doublons (mêmes marque + nom, ou mêmes date+tabac+pipe+durée pour les séances) sont ignorés automatiquement — cocher un doublon conserve simplement votre copie locale.")}
      </div>

      <div style={{
        maxHeight: 380, overflowY: "auto",
        border: `1px solid ${C.rule}`, borderRadius: 8,
        background: C.bg2, marginBottom: 12,
      }}>
        {sections.length === 0 ? (
          <div style={{ padding: "20px 14px", textAlign: "center", color: C.tx3, fontSize: fs(14.5) }}>
            {tr("import_pick_empty", "Rien à choisir — le fichier ne contient aucun tabac / pipe / envie / accessoire.")}
          </div>
        ) : sections.map((sec) => {
          const ids = sec.items.map(it => sec.kind + ":" + String(it.id));
          const allOn = ids.length > 0 && ids.every(k => selectedSet.has(k));
          const anyOn = ids.some(k => selectedSet.has(k));
          return (
            <div key={sec.kind}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px",
                background: CARD_BG,
                borderTop: `1px solid ${C.rule}`,
                borderBottom: `1px solid ${C.rule}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Lbl color={sec.accent} size={10}>{sec.label}</Lbl>
                  <span style={{ color: C.tx3, fontFamily: F.mono, fontSize: fs(12.5) }}>
                    {sec.items.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection(sec.kind, sec.items)}
                  style={{
                    background: "transparent", color: anyOn ? C.tx2 : C.sageHi,
                    border: `1px solid ${C.rule2}`, borderRadius: 5,
                    padding: "3px 8px", cursor: "pointer",
                    fontFamily: F.mono, fontSize: fs(11.5), fontWeight: 700,
                    letterSpacing: 1, textTransform: "uppercase",
                  }}>
                  {allOn || anyOn
                    ? tr("import_section_none", "Aucun")
                    : tr("import_section_all", "Tout")}
                </button>
              </div>
              {sec.items.map((it: any) => {
                const k = sec.kind + ":" + String(it.id);
                const checked = selectedSet.has(k);
                const label = sec.rowLabel(it);
                return (
                  <div key={k}
                    onClick={() => toggleKey(k)}
                    // The whole row is the checkbox — keyboard-operable.
                    role="checkbox"
                    tabIndex={0}
                    aria-checked={checked}
                    aria-label={tr("trash_select_aria_prefix", "Sélectionner ") + label}
                    onKeyDown={(ev: any) => {
                      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleKey(k); }
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px",
                      borderBottom: `1px solid ${C.rule}`,
                      cursor: "pointer",
                      background: checked ? alpha(C.sage, "0e") : "transparent",
                      transition: "background 120ms ease-out",
                    }}>
                    <div
                      aria-hidden="true"
                      style={{
                        flexShrink: 0, width: 20, height: 20, borderRadius: 5,
                        border: `1.5px solid ${checked ? C.sageHi : C.rule2}`,
                        background: checked ? alpha(C.sage, "44") : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: C.sageHi, transition: "all 120ms ease-out",
                      }}>
                      {checked && <Ico name="check" size={12} sw={2.4} />}
                    </div>
                    <div style={{
                      flex: 1, minWidth: 0,
                      color: C.ivory, fontFamily: F.body, fontSize: fs(15),
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "10px 16px", borderRadius: 8,
            background: "transparent", color: C.tx2,
            border: `1px solid ${C.rule2}`,
            cursor: "pointer",
            fontFamily: F.mono, fontSize: fs(13), fontWeight: 700,
            letterSpacing: 1.2, textTransform: "uppercase",
          }}>
          {tr("btn_back", "Retour")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={total === 0}
          aria-disabled={total === 0}
          style={{
            padding: "10px 16px", borderRadius: 8,
            background: total === 0 ? C.bg2 : alpha(C.sage, "22"),
            color: total === 0 ? C.tx3 : C.sageHi,
            border: `1px solid ${alpha(total === 0 ? C.rule : C.sage, "88")}`,
            cursor: total === 0 ? "not-allowed" : "pointer",
            fontFamily: F.mono, fontSize: fs(13), fontWeight: 700,
            letterSpacing: 1.2, textTransform: "uppercase",
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
          <Ico name="check" size={13} sw={1.8} />
          {`${tr("import_action_selection", "Importer la sélection")} (${total})`}
        </button>
      </div>
    </div>
  );
}


// Tab IDs + primitive. Settings is now split into four
// thematic tabs to shrink the perceived complexity (was ~8 sections
// stacked vertically). "Données" is the default — the user returns
// there most often (Drive save/restore + Export/Import + AI key).
type SettingsTabId = "data" | "prefs" | "app" | "help";

// The actual `localStorage["cave-settings-tab"]` read /
// write moved to App.tsx so external callers (update pill, export
// reminder banner) can hop on the same setter before opening
// Settings. This file consumes `settingsTab` / `setSettingsTab`
// from ctx.

function SettingsTabs({
  active, setActive, t,
}: {
  active: SettingsTabId;
  setActive: (t: SettingsTabId) => void;
  t?: ((k: string) => string) | undefined;
}) {
  const tr = (k: string, frFallback: string) => (t ? t(k) : frFallback);
  const tabs: { id: SettingsTabId; label: string; icon: IcoName }[] = [
    { id: "prefs", label: tr("tab_prefs", "Préférences"), icon: "settings" },
    { id: "data",  label: tr("tab_data",  "Données"),     icon: "cloud" },
    { id: "app",   label: tr("tab_app",   "Application"), icon: "diamond" },
    { id: "help",  label: tr("tab_help",  "Aide"),        icon: "book" },
  ];
  return (
    // Scroll horizontally instead of clipping (the four tab labels
    // don't fit at the larger "Taille du texte" steps — "Aide" got cut off).
    // Routed through the shared ScrollableChipRow so it gets the
    // same right-edge fade + chevron cue as the inventory / journal filter
    // rows. The full-width separator + marginBottom stay on this outer wrapper
    // (fixed) while the tab row scrolls inside. Buttons keep `flex: 1 0 auto`
    // so they fill evenly when they fit but never shrink below their label.
    <div style={{ borderBottom: `1px solid ${C.rule}`, marginBottom: 4 }}>
    {/* The strip keeps its scrollLeft across renders, so arriving
        from a tab further right left the ACTIVE tab clipped — reported as
        "…férences" with its underline half off-screen. Reveal the active one. */}
    <ScrollableChipRow role="tablist" pad="0 18px" gap={2}
      revealChildIndex={Math.max(0, tabs.findIndex((tb) => tb.id === active))}>
      {tabs.map((tb) => {
        const on = tb.id === active;
        return (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setActive(tb.id)}
            style={{
              flex: "1 0 auto", minHeight: 44, padding: "10px 10px",
              background: "transparent", border: "none",
              borderBottom: `2px solid ${on ? C.brass : "transparent"}`,
              color: on ? C.brassHi : C.tx2,
              fontFamily: F.body, fontSize: fs(13.5),
              fontWeight: on ? 700 : 500,
              letterSpacing: 0.2,
              cursor: "pointer",
              transition: "border-color 180ms, color 180ms",
              display: "inline-flex", alignItems: "center",
              justifyContent: "center", gap: 6,
              whiteSpace: "nowrap",
            }}>
            <Ico name={tb.icon} size={14} sw={1.7} />
            <span style={{ whiteSpace: "nowrap" }}>{tb.label}</span>
          </button>
        );
      })}
    </ScrollableChipRow>
    </div>
  );
}

// Unified Settings button. Three variants used across the
// modal so every CTA shares the same shell, padding, radius and
// border-alpha tier — no more inline <button>s with bespoke styles.
//   - primary   : accent-tinted (default brassHi) — important actions
//   - secondary : neutral bg2 + rule border — common actions
//   - ghost     : transparent + rule border — discrete actions
// Picks a single 8px radius across the board (it was previously a
// mix of 6/7/8).
function SettingsButton({
  variant = "secondary", icon, label, onClick, disabled,
  accent, fullWidth, ariaLabel, children, title,
}: {
  variant?: "primary" | "secondary" | "ghost";
  icon?: IcoName;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  accent?: string;
  fullWidth?: boolean;
  ariaLabel?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const tone = accent || C.brassHi;
  const styles: React.CSSProperties =
    variant === "primary"
      ? { background: alpha(tone, "22"), color: tone, border: `1px solid ${alpha(tone, "88")}` }
      : variant === "ghost"
      ? { background: "transparent", color: C.tx2, border: `1px solid ${C.rule}` }
      : { background: C.bg2, color: C.ivory, border: `1px solid ${C.rule}` };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      style={{
        ...styles,
        padding: "10px 14px", borderRadius: 8,
        display: "inline-flex", alignItems: "center", justifyContent: label ? "flex-start" : "center",
        gap: 10,
        fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        width: fullWidth ? "100%" : undefined,
        textAlign: "left",
      }}>
      {icon && (
        <span style={{
          color: variant === "secondary" ? tone : "inherit",
          display: "inline-flex",
        }}>
          <Ico name={icon} size={15} sw={1.7} />
        </span>
      )}
      {label && <span style={{ flex: 1 }}>{label}</span>}
      {children}
    </button>
  );
}

// `Notice` + `statusToneFromMessage` moved to
// `src/components/curator/Notice.tsx` so every inline status
// banner across the app reuses the same primitive. SettingsModal
// imports both from there now.

function Section({
  id, title, accent, children,
}: { id?: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 8px" }}>
        <span style={{
          width: 4, height: 14, background: accent, borderRadius: 1,
          boxShadow: `0 0 8px ${alpha(accent, "88")}`,
        }} />
        <span style={{
          fontFamily: F.display, fontSize: fs(20), color: C.ivory,
          fontStyle: "italic", letterSpacing: -0.2,
        }}>{title}</span>
      </div>
      {/* `minmax(0, 1fr)`, not the implicit `auto` column.
          A grid's `auto` track CANNOT shrink below its content's min-content
          width, so ONE wide row sizes the whole column and drags every other
          row in the section out with it. On the Données tab the "Clé API" row
          has a min-content of 361px (the next widest is 267), so at the "L"
          text size all five rows of the AI section rendered 361px inside a
          340px box — which made the entire tab a horizontal scroller and let
          the whole page slide left and right under a finger.
          This is the flex-item lesson one layout mode over: a flex item
          defaults to `min-width: auto`, and a grid track defaults to `auto`.
          Both need to be told they may shrink. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>{children}</div>
    </div>
  );
}

// Numeric threshold input for the "À surveiller"
// settings. Keeps the raw text in LOCAL state while typing and only
// commits (the parent clamps + persists) on blur — committing on
// every keystroke would re-fill the field the instant it's emptied
// (the prefill-race trap). The useEffect re-syncs the local
// text when the COMMITTED value changes externally (blur clamp, or
// the g↔oz unit toggle converting the stored value) — steady-state
// it's a no-op while typing, so user input never races the setter.
function WatchThresholdInput({
  value, onCommit, ariaLabel, ring,
}: {
  value: string;
  onCommit: (v: string) => void;
  ariaLabel: string;
  ring: ReturnType<typeof useFocusRing>;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="text" inputMode="decimal"
      value={local}
      aria-label={ariaLabel}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => { ring.onFocus(); caretToEnd(e); }}
      onBlur={() => { ring.onBlur(); onCommit(local); }}
      style={{
        width: 70, padding: "7px 10px",
        background: C.bg2, color: C.ivory,
        border: `1px solid ${C.rule}`, borderRadius: 8,
        fontFamily: F.mono, fontSize: fsInput(17), textAlign: "right",
        outline: "none", transition: "box-shadow 200ms, border-color 200ms",
        ...(ring.style || {}),
      }} />
  );
}

function Row({
  label, sub, children,
}: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: "10px 14px",
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, flexWrap: "wrap",
    }}>
      {/* `minWidth: 0` — a flex item defaults to `min-width: auto`,
          so the label half could not shrink and the row stayed as wide as
          label + control even when that overflowed the panel. */}
      <div style={{ minWidth: 0 }}>
        <Lbl color={C.tx2}>{label}</Lbl>
        {sub && <div style={{ fontSize: fs(14.5), color: C.tx3, marginTop: 2 }}>{sub}</div>}
      </div>
      {/* `flexShrink: 0` stays — a Segmented that shrinks clips its own labels
          (it is `overflow: hidden`). `maxWidth: 100%` is the bound that was
          missing: it may keep its width, it may not exceed the row. */}
      <div style={{ flexShrink: 0, maxWidth: "100%" }}>{children}</div>
    </div>
  );
}

function Segmented({
  value, setValue, options,
}: { value: string; setValue: (v: string) => void; options: [string, string][] }) {
  return (
    // Wrap onto a second line rather than force the row wider than
    // the panel. Six language options, or the two dated date-format labels, do
    // not fit on one line at the "L" text size on a 360px phone — and this
    // control cannot shrink instead (it is `overflow: hidden`, so shrinking
    // clips the option labels it exists to show).
    <div style={{
      display: "inline-flex", flexWrap: "wrap", maxWidth: "100%",
      border: `1px solid ${C.rule}`,
      background: C.bg, borderRadius: 8, overflow: "hidden",
    }}>
      {options.map(([id, label], i) => {
        const on = id === value;
        return (
          // Audit: the selection was conveyed by BACKGROUND COLOUR
          // alone, so a screen reader announced six identical buttons with no
          // way to tell which language / text size / theme is active. This is
          // the same defect fixed on FilterChipSimple, in the control
          // that carries every preference in Settings. aria-pressed, not
          // role=radio: these are toggle buttons already.
          <button key={id} type="button" onClick={() => setValue(id)}
            aria-pressed={on}
            style={{
              padding: "7px 14px", border: "none",
              background: on ? C.brass : "transparent",
              color: on ? C.bg : C.tx,
              cursor: "pointer", fontFamily: F.body, fontWeight: on ? 700 : 500,
              fontSize: fs(15), letterSpacing: 0.2,
              borderLeft: i > 0 ? `1px solid ${C.rule}` : "none",
              transition: "background 200ms, color 200ms",
            }}>{label}</button>
        );
      })}
    </div>
  );
}

function Toggle({
  value, setValue, label, hint,
}: { value: boolean; setValue: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div style={{
      padding: "12px 14px",
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: C.ivory, fontSize: fs(15), fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ marginTop: 3, fontSize: fs(14.5), color: C.tx3 }}>{hint}</div>}
      </div>
      {/* The switch had NO accessible name. The visible label
          is a sibling <div>, which associates it with nothing, so a screen
          reader announced six of these as "button, not pressed" and never said
          what they toggle: auto-save, accounting, maintenance reminders. Found
          while measuring the Settings tap targets (which came back clean at
          390/m and 360/L: nothing under 24, no dead zones) — the probe reports
          each control's accessible name, and these fell through to "BUTTON".
          `aria-label` rather than `aria-labelledby`: the label needs no id, and
          the hint below it must stay OUT of the name (it is the description,
          and folding it in makes the announcement a paragraph). */}
      <button type="button" onClick={() => setValue(!value)} aria-pressed={value} aria-label={label}
        style={{
          width: 46, height: 26, borderRadius: 13,
          background: value ? C.brass : C.bg3,
          border: `1px solid ${value ? C.brass : C.rule2}`,
          position: "relative", cursor: "pointer", padding: 0,
          transition: "background 200ms",
        }}>
        <span style={{
          position: "absolute", top: 2, left: value ? 22 : 2,
          width: 20, height: 20, borderRadius: "50%",
          background: value ? C.bg : C.tx2,
          transition: "left 220ms cubic-bezier(.34,1.56,.64,1), background 200ms",
        }} />
      </button>
    </div>
  );
}

// Renders the read-only multi-device sync diagnostic. Pure
// display of the data computed by useGdriveSync.runSyncDiagnostic (which
// mirrors findNewerCloudBackup's filters). Reason codes → i18n keys.
// `t` is required (always passed from ctx). Reason codes resolve through a
// switch of LITERAL t("…") calls — not a variable-keyed map — so doc:check's
// static scan sees + validates every sync_diag_* key (catches typos) instead
// of listing them as "defined but never called".
// Gated behind SHOW_DEBUG_DIAGNOSTICS at the call site (hidden by
// default) — kept intact so the debug panel can be flipped back on.
// The panel carries its OWN close button.
//
// It used to be dismissable only by re-tapping "Diagnostic multi-appareils",
// which is a toggle. "Vérifier les sauvegardes cloud" was later given the same
// panel — and that button is NOT a toggle and must not become one: re-checking
// is the whole point of it. So a panel opened from the check could not be
// closed at all; tapping the button again just re-ran the check, which is
// exactly what was reported ("je ne peux jamais le fermer… ça ne fait que
// rafraîchir les données"). A panel must not depend on the button that opened
// it for its way out. Same × as the cloud panel, which now serves both buttons.
/**
 * « Which ROW? » — the shared result panel.
 *
 * TWO RULES carry it, and both are this file's own history.
 *
 * (1) It carries its OWN close ×. The rule: a panel must not depend
 *     on the button that opened it for its way out, and neither trigger is a
 *     toggle — tapping « Vérifier » again re-runs the check, which is its
 *     purpose, and the import panel appears on its own after an import.
 *
 * (2) It NAMES ITS SCOPE, in BOTH branches. Each caller checks a few specific
 *     things and nothing else; a result reading only « aucun problème » would
 *     be read as "my file is clean", which is a claim it is not making. Same
 *     reason `plan.locked` is rendered in both branches of the bulk-apply
 *     confirm: the reassuring message is the one that most needs
 *     its limits stated. `scope` is therefore REQUIRED, not optional.
 *
 * The copy button is what makes the thing actionable rather than merely
 * informative — a phone cannot fix a spreadsheet, and thirty row numbers are
 * not something anyone transcribes by hand.
 *
 * GENERALISED because the CSV cellar import needed the identical
 * panel: two copies of a list-with-counts-and-a-copy-button is exactly the
 * drift this repo keeps paying for. Only the COPY differs, so the callers
 * supply it — the chrome keys (`issues_row` / `_more` / `_truncated` /
 * `_copy` / `_copied`) are shared and were renamed out of the `cat_audit_*`
 * family at the extraction, so a rewording of one feature cannot silently
 * reword the other.
 */
// Exported for tests: it carries a rule a source-level assertion cannot
// check — a clipboard write is a PROMISE, so a refusal (denied permission,
// insecure context, Safari without a gesture) is only visible to a render.
export function IssueListPanel({ title, ok, scope, sections, issues, truncated, t, onClose }: {
  title: string; ok: string; scope: string;
  sections: Array<{ kind: string; n: number; label: string }>;
  issues: any[]; truncated: boolean;
  t: (k: string) => string; onClose?: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const a = { issues: issues, truncated: truncated };
  const KINDS = sections.map((x) => ({ k: x.kind, n: x.n, lbl: x.label }));
  const clean = KINDS.every((x) => !x.n);
  // Every part is optional except the row: a `no-identity` line has NEITHER a
  // brand nor a name — that is what it is being reported for — so the parts are
  // filtered before joining rather than concatenated with fixed separators
  // (which rendered a dangling « Ligne 4 · », seen only by reading the panel).
  const line = (i: any) =>
    [
      String(t("issues_row")).replace("{r}", String(i.row)),
      [i.brand, i.name].filter(Boolean).join(" "),
      i.value ? "« " + i.value + " »" : "",
    ].filter(Boolean).join(" · ");
  function copy() {
    const txt = KINDS.filter((x) => x.n).map((x) =>
      x.lbl + "\n"
      + a.issues.filter((i: any) => i.kind === x.k).map((i: any) => "  " + line(i)).join("\n"),
    ).join("\n\n");
    // `writeText` returns a PROMISE, so the synchronous
    // try/catch could not see a REFUSED clipboard (denied permission, an
    // insecure context, Safari without a user gesture) — the rejection went
    // out as an unhandled one and « Copié ✓ » had already been shown for a
    // copy that never happened. Saying nothing when it fails is the right
    // amount of noise; saying it worked is not. Both sibling call sites in
    // this file and in ShoppingModal already handled the promise.
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    try {
      navigator.clipboard.writeText(txt).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }, () => { /* a refused clipboard is not worth an error banner */ });
    } catch { /* a throwing implementation is a refusal too */ }
  }
  return (
    <div style={{
      margin: "8px 0 2px", background: C.bg2, border: `1px solid ${C.rule}`,
      borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8,
    }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}>
          <button type="button" onClick={onClose} aria-label={t("btn_close")}
            style={{
              // The house target is 44 (WCAG 2.2 AA asks 24;
              // this project adopted the stricter AAA figure). These four panel
              // closes measured 30x26 — under BOTH — and they are the only way
              // out of a panel opened from a non-toggle button.
              minWidth: 44, minHeight: 44, padding: "0 9px", borderRadius: 5, lineHeight: 1,
              background: "transparent", color: C.tx3,
              border: `1px solid ${C.rule}`, cursor: "pointer",
              fontFamily: F.mono, fontSize: fs(14.5), fontWeight: 700,
            }}>×</button>
        </div>
      )}
      <Lbl color={C.tx3}>{title}</Lbl>
      {clean ? (
        <Notice tone="success">{ok}</Notice>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {KINDS.filter((x) => x.n).map((x) => (
            <div key={x.k}>
              <div style={{ fontFamily: F.body, fontSize: fs(14), color: C.amber, marginBottom: 4 }}>
                {x.lbl}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: fs(12), color: C.tx2, lineHeight: 1.7 }}>
                {a.issues.filter((i: any) => i.kind === x.k).slice(0, 12).map((i: any) => (
                  <div key={i.row + ":" + i.kind}>{line(i)}</div>
                ))}
                {a.issues.filter((i: any) => i.kind === x.k).length > 12 && (
                  <div style={{ color: C.tx3 }}>
                    {String(t("issues_more")).replace("{n}", String(a.issues.filter((i: any) => i.kind === x.k).length - 12))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {a.truncated && (
            <div style={{ fontFamily: F.body, fontSize: fs(12), color: C.tx3 }}>{t("issues_truncated")}</div>
          )}
          <ModalAction variant="secondary" onClick={copy}>
            {copied ? t("issues_copied") : t("issues_copy")}
          </ModalAction>
        </div>
      )}
      {/* The limit, stated even when nothing was found — see rule (2) above. */}
      <div style={{ fontFamily: F.body, fontSize: fs(12), color: C.tx3, lineHeight: 1.45 }}>
        {scope}
      </div>
    </div>
  );
}

// THE cloud-backup panel — what is stored, and what the app makes of it.
//
// It used to be two panels over the SAME file list, opened by two neighbouring
// buttons. "Voir mes sauvegardes" showed each file's size, the total occupied
// and a delete; this one showed each file's VERDICT — proposed, this device,
// already seen, older, unreadable date — plus the device identity the verdicts
// are computed against. Reported, and fairly: « les mêmes informations
// s'affichent ». They were not the same, but the only part a reader sees first
// is the list of filenames, which was common to both, and neither panel said
// what question it answered.
//
// So they are one panel: the files, each with its size, its verdict and its
// delete. `explainCloudBackups` already received the raw listing and simply
// dropped the size — carrying it is what made the merge free of a second fetch.
const MAX_BACKUP_ROWS = 20;

// Exported for tests: the counts line carries a rule a source-level assertion
// cannot check — every file in the TOTAL must also be in a count. The
// catalogue stream is a third kind, and it was once charged in the bytes and
// named in no count, so a 3.77 MB catalogue read as « 1 auto · 0 manuelle ·
// total 3,9 Mo »: megabytes no line accounted for, above a row the user can
// delete. That guarantee moved here with the panel merge.
export function SyncDiagView({ diag, t, lang, onClose, onDeleteEntry }: {
  diag: any;
  t: (k: string) => string;
  lang?: string | undefined;
  onClose?: (() => void) | undefined;
  /** Absent while a delete cannot be issued (no provider action wired). */
  onDeleteEntry?: ((id: string) => Promise<void> | void) | undefined;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dotColor = (s: string) => (s === "proposed" ? C.sageHi : s === "candidate" ? C.brass : C.tx3);
  function reasonLabel(reason: string): string {
    switch (reason) {
      case "proposed": return t("sync_diag_r_proposed");
      case "own_device": return t("sync_diag_r_own");
      case "own_legacy": return t("sync_diag_r_own_legacy");
      case "dismissed_name":
      case "dismissed_ts": return t("sync_diag_r_seen");
      case "older": return t("sync_diag_r_older");
      case "bad_date": return t("sync_diag_r_baddate");
      default: return t("sync_diag_r_candidate");
    }
  }
  return (
    <div style={{
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
      padding: 12, display: "flex", flexDirection: "column", gap: 8,
    }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}>
          <button type="button" onClick={onClose} aria-label={t("btn_close")}
            style={{
              // The house target is 44 (WCAG 2.2 AA asks 24;
              // this project adopted the stricter AAA figure). These four panel
              // closes measured 30x26 — under BOTH — and they are the only way
              // out of a panel opened from a non-toggle button.
              minWidth: 44, minHeight: 44, padding: "0 9px", borderRadius: 5, lineHeight: 1,
              background: "transparent", color: C.tx3,
              border: `1px solid ${C.rule}`, cursor: "pointer",
              fontFamily: F.mono, fontSize: fs(14.5), fontWeight: 700,
            }}>×</button>
        </div>
      )}
      <div style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, lineHeight: 1.7 }}>
        <div>{t("sync_diag_device")} — <span style={{ color: C.tx2 }}>{(diag.deviceName ? String(diag.deviceName) + " · " : "") + String(diag.deviceId) + " · " + String(diag.provider)}</span></div>
        <div>{t("sync_diag_lastsave")} — <span style={{ color: C.tx2 }}>{diag.localRef ? fmtDateTime(diag.localRef) : "—"}</span></div>
        <div>{t("sync_diag_lastedit")} — <span style={{ color: C.tx2 }}>{diag.localEdited ? fmtDateTime(diag.localEdited) : "—"}</span></div>
        <div>{t("sync_diag_marker")} — <span style={{ color: C.tx2 }}>{diag.dismissedName || t("sync_diag_marker_none")}</span></div>
      </div>
      {/* What is stored, and how much room it takes — the half that used to
          live in a second panel. Counted over EVERY row, not the twenty
          displayed, so the total is the real one. */}
      {diag.rows && diag.rows.length > 0 && (() => {
        const rows = diag.rows as any[];
        const n = (k: string) => rows.filter((r) => r.kind === k).length;
        const nAuto = n("auto"), nManual = n("manual"), nCat = n("catalogue");
        const bytes = rows.reduce((acc: number, r: any) => acc + (parseInt(r.size || "0", 10) || 0), 0);
        const manW = plural(nManual, t("bak_word_manual"), t("bak_word_manual_p"), lang);
        return (
          <div style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3, borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
            {`${nAuto} auto · ${nManual} ${manW}`}
            {nCat ? ` · ${nCat} ${t("bak_word_catalogue")}` : ""}
            {` · ${t("bak_word_total")} ${fmtBytes(bytes)}`}
          </div>
        );
      })()}
      {/* Per-device roll-up — one synthetic line per device that
          wrote a backup (own device / other devices / manual & legacy files). */}
      {diag.devices && diag.devices.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
          <Lbl color={C.tx3}>{t("sync_diag_by_device")}</Lbl>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            {diag.devices.map((d: any, i: number) => {
              // Two defects, both visible in one screenshot.
              //
              // (1) A FOREIGN device was labelled with `sync_diag_device`, which
              // is "Cet appareil" — the same key the header above uses for THIS
              // device. So the panel read "Cet appareil 8udtad73xz" under a
              // header saying this device is unr52hzxv1: it called two other
              // devices "this device". `sync_diag_other_device` now names them.
              //
              // (2) The name was there all along. Every backup filename carries
              // the writing device's name slug at the tail — the
              // files listed right below this roll-up literally end in
              // `-iphone.json` / `-ipad.json` — and the roll-up showed an opaque
              // id anyway. Reported: "je ne vois pas la mention du nom de
              // l'autre appareil (iPhone)". The id stays beside the name, since
              // two devices can share a name and the id is what the filters key
              // on.
              const dn = d.deviceName ? String(d.deviceName) : "";
              const label = d.isOwn
                ? (diag.deviceName ? String(diag.deviceName) : t("sync_diag_this_device"))
                : d.deviceId != null
                  ? (dn ? dn + " · " + String(d.deviceId)
                        : t("sync_diag_other_device") + " " + String(d.deviceId))
                  : dn
                    ? dn
                    : (d.kind === "manual" ? t("sync_diag_manual_files") : t("sync_diag_legacy_files"));
              const count = String(t("sync_diag_files")).replace("{n}", String(d.count));
              return (
                <div key={i} style={{ fontFamily: F.mono, fontSize: fs(12.5), color: C.tx2, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: d.isOwn ? C.sageHi : C.tx2, wordBreak: "break-all" }}>{label}</span>
                  <span style={{ color: C.tx3, flexShrink: 0, textAlign: "right" }}>
                    {(d.latestTs ? fmtDateTime(d.latestTs) : "—") + " · " + count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(!diag.rows || diag.rows.length === 0)
        ? <Lbl color={C.tx3}>{t("sync_diag_nofiles")}</Lbl>
        : diag.rows.slice(0, MAX_BACKUP_ROWS).map((r: any, i: number) => {
          const isConfirm = confirmId === r.id;
          return (
            <div key={r.id || i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              borderTop: i ? `1px solid ${C.rule}` : "none", paddingTop: i ? 8 : 0,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0, background: dotColor(r.status) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F.mono, fontSize: fs(12), color: C.tx2, wordBreak: "break-all" }}>
                  {r.kind === "auto" ? "🔄 " : r.kind === "manual" ? "💾 " : r.kind === "catalogue" ? "📖 " : ""}
                  {r.name}
                </div>
                <div style={{
                  fontFamily: F.body, fontSize: fs(13), marginTop: 2,
                  color: r.status === "proposed" ? C.sageHi : r.status === "ignored" ? C.tx3 : C.brass,
                }}>
                  {(r.ts ? fmtDateTime(r.ts) + " · " : "")
                    + reasonLabel(r.reason)
                    + (r.size ? " · " + fmtBytes(parseInt(r.size, 10) || 0) : "")}
                </div>
              </div>
              {/* Two taps to delete, and the confirmation replaces the bin
                  rather than opening a dialog: this is a list, and a modal per
                  row would bury which file is about to go. */}
              {onDeleteEntry && !isConfirm && (
                <button type="button" onClick={() => setConfirmId(r.id)}
                  aria-label={t("aria_delete_backup")}
                  style={{
                    flexShrink: 0, padding: "3px 7px", borderRadius: 5,
                    background: "transparent", color: C.oxbloodHi,
                    border: `1px solid ${alpha(C.oxblood, "88")}`, cursor: "pointer",
                    fontSize: fs(13.5),
                  }}>🗑</button>
              )}
              {onDeleteEntry && isConfirm && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button"
                    onClick={() => { setConfirmId(null); Promise.resolve(onDeleteEntry(r.id)).catch(() => {}); }}
                    aria-label={t("aria_confirm_delete")}
                    style={{
                      padding: "3px 7px", borderRadius: 5,
                      background: alpha(C.oxblood, "33"), color: C.oxbloodHi,
                      border: `1px solid ${alpha(C.oxblood, "88")}`, cursor: "pointer",
                      fontFamily: F.mono, fontSize: fs(11.5), fontWeight: 700,
                      letterSpacing: 0.5, textTransform: "uppercase",
                    }}>{t("lbl_yes")}</button>
                  <button type="button" onClick={() => setConfirmId(null)}
                    aria-label={t("btn_cancel")}
                    style={{
                      padding: "3px 7px", borderRadius: 5,
                      background: "transparent", color: C.tx3,
                      border: `1px solid ${C.rule}`, cursor: "pointer",
                      fontFamily: F.mono, fontSize: fs(11.5),
                    }}>×</button>
                </div>
              )}
            </div>
          );
        })}
      {/* No silent cap: a list that quietly stopped at twenty would read as
          "that is everything". */}
      {diag.rows && diag.rows.length > MAX_BACKUP_ROWS && (
        <div style={{ marginTop: 2, color: C.tx3, fontSize: fs(12.5) }}>
          {String(t("backup_and_more")).replace("{n}", String(diag.rows.length - MAX_BACKUP_ROWS))}
        </div>
      )}
    </div>
  );
}

// What is loaded, and what the import could not read.
//
// THREE STATES, not two. `meta` is `undefined` while the first IndexedDB read
// is in flight and `null` when nothing is stored; collapsing them would flash
// "no catalogue loaded" on every open before the real one appears, which reads
// as data loss on the one screen where the user is managing their data.
//
// The warnings are the point of the block. A catalogue that silently dropped a
// third of its rows looks exactly like one that loaded fine — so the counts
// the parser already returns are surfaced HERE, under the button that produced
// them (the action-then-feedback adjacency rule).
function CatalogueStatus({
  t, meta, busy, outcome, dateFormat,
}: {
  t?: (k: string) => string;
  meta: any; busy?: boolean; outcome: any; dateFormat?: string;
}) {
  var tr = function (k: string, fb: string) { return t ? t(k) : fb; };
  if (busy) {
    return (
      <Notice tone="info">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Spinner size={12} />{tr("lbl_loading_dots", "Chargement…")}
        </span>
      </Notice>
    );
  }
  if (outcome && outcome.kind === "parse") {
    return <Notice tone="error">{tr("cat_err_parse", "Fichier illisible.")}</Notice>;
  }
  if (outcome && outcome.kind === "write") {
    return <Notice tone="error">{tr("cat_err_write", "Impossible d'enregistrer le catalogue.")}</Notice>;
  }
  if (outcome && outcome.kind === "read") {
    return <Notice tone="error">{tr("cat_err_read", "Impossible de lire le fichier.")}</Notice>;
  }
  // Still reading: say nothing rather than "none".
  if (meta === undefined) return null;
  if (!meta) return <Notice tone="info">{tr("cat_none_hint", "Aucun catalogue chargé.")}</Notice>;

  var unknown = ([] as string[])
    .concat(meta.unknownCategories || [], meta.unknownCuts || [])
    .slice(0, 8);
  return (
    <Notice tone="success">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontWeight: 700 }}>
          {String(tr("cat_loaded_n", "{n} blends · {b} marques"))
            .replace("{n}", String(meta.blends || 0))
            .replace("{b}", String(meta.brands || 0))}
        </span>
        <span style={{ opacity: 0.85 }}>
          {String(tr("cat_loaded_on", "Chargé le {d}"))
            .replace("{d}", meta.loadedAt ? fmtDate(new Date(meta.loadedAt).toISOString().slice(0, 10), dateFormat) : "—")}
          {meta.name ? " · " + meta.name : ""}
        </span>
        {meta.skippedNoIdentity > 0 && (
          <span>{String(tr("cat_warn_skipped", "{n} ligne(s) ignorée(s).")).replace("{n}", String(meta.skippedNoIdentity))}</span>
        )}
        {meta.duplicateKeys > 0 && (
          <span>{String(tr("cat_warn_dupes", "{n} doublon(s).")).replace("{n}", String(meta.duplicateKeys))}</span>
        )}
        {unknown.length > 0 && (
          <span>{String(tr("cat_warn_unknown", "Valeurs non reconnues : {v}")).replace("{v}", unknown.join(", "))}</span>
        )}
      </div>
    </Notice>
  );
}

function ActionBtn({
  icon, label, onClick, accent = C.brassHi, disabled, small,
}: { icon: IcoName; label: string; onClick?: () => void; accent?: string; disabled?: boolean; small?: boolean }) {
  return (
    // `disabled` greys it out (opacity .5, not-allowed) — say so too.
    <PressCard onClick={disabled ? undefined : onClick} ariaDisabled={disabled} style={{
      padding: small ? "9px 12px" : "11px 14px",
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
      display: "flex", alignItems: "center", gap: 10,
      color: C.ivory, fontSize: fs(small ? 14 : 15), fontFamily: F.body, fontWeight: 500,
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
    }}>
      <span style={{ color: accent, display: "inline-flex" }}>
        <Ico name={icon} size={small ? 13 : 15} sw={1.7} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <Ico name="chevron" size={13} sw={1.7} color={C.tx3} />
    </PressCard>
  );
}

function ExtLink({
  icon, label, href, accent = C.brassHi, onClick,
}: { icon: IcoName; label: string; href?: string; accent?: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
        style={{
          width: "100%", textAlign: "left",
          padding: "11px 14px",
          background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
          display: "flex", alignItems: "center", gap: 10,
          color: C.ivory, fontSize: fs(15), fontFamily: F.body, fontWeight: 500,
          cursor: "pointer",
        }}>
        <span style={{ color: accent, display: "inline-flex" }}>
          <Ico name={icon} size={15} sw={1.7} />
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        <Ico name="chevron" size={13} sw={1.7} color={C.tx3} />
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{
        padding: "11px 14px",
        background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
        display: "flex", alignItems: "center", gap: 10,
        color: C.ivory, fontSize: fs(15), fontFamily: F.body, fontWeight: 500,
        textDecoration: "none",
      }}>
      <span style={{ color: accent, display: "inline-flex" }}>
        <Ico name={icon} size={15} sw={1.7} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <Ico name="chevron" size={13} sw={1.7} color={C.tx3} />
    </a>
  );
}

// `InfoBanner` and `StatusLine` were merged into the
// `Notice` primitive (declared earlier in this file). Single shell
// for every kind of message, tone variant picks the colour.

// Mask an API key for display: keep the provider prefix + last 4 chars.
// Examples: "sk-ant-api03-XXX…" → "sk-ant-api03…XXXX", "AIzaSyABC…XYZ" → "AIza…XYZ".
function maskApiKey(k: string): string {
  if (!k || typeof k !== "string") return "";
  if (k.length <= 8) return "•".repeat(k.length);
  const last4 = k.slice(-4);
  let prefixLen = 4;
  if (String(k).startsWith("sk-ant-api")) prefixLen = 10;
  else if (String(k).startsWith("sk-ant-")) prefixLen = 7;
  else if (String(k).startsWith("sk-")) prefixLen = 3;
  else if (String(k).startsWith("AIza")) prefixLen = 4;
  const prefix = k.slice(0, prefixLen);
  return `${prefix}…${last4}`;
}

function ApiKeyInput({
  defaultValue, placeholder, onSave, onClear, hasKey, saveLabel,
}: {
  defaultValue: string; placeholder: string;
  onSave: (v: string) => void; onClear: () => void;
  hasKey: boolean; saveLabel: string;
}) {
  const { t } = useAppCtx();
  const ref = React.useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = React.useState(false);
  const ring = useFocusRing();
  return (
    <div style={{ display: "flex", gap: 6, width: "min(240px, 100%)" }}>
      <input
        ref={ref}
        type={reveal ? "text" : "password"}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={t ? t("lbl_api_key") : "Clé API"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={{
          flex: 1, padding: "7px 10px",
          background: C.bg, color: C.ivory,
          border: `1px solid ${C.rule}`, borderRadius: 8,
          fontFamily: F.mono, fontSize: fsInput(16), letterSpacing: 0.5,
          minWidth: 0, outline: "none",
          transition: "box-shadow 200ms, border-color 200ms",
          ...(ring.style || {}),
        }}
      />
      <button type="button"
        onClick={() => setReveal(r => !r)}
        aria-label={reveal
          ? (t ? t("btn_hide") : "Masquer")
          : (t ? t("btn_show") : "Afficher")}
        style={{
          minWidth: 36, height: 36, padding: "0 8px",
          background: "transparent", border: `1px solid ${C.rule}`,
          borderRadius: 8, color: C.tx2, cursor: "pointer",
          fontFamily: F.mono, fontSize: fs(14.5),
        }}>{reveal ? "○" : "●"}</button>
      <button type="button"
        onClick={() => {
          const v = String(ref.current?.value ?? "").trim() || "";
          onSave(v);
        }}
        aria-label={saveLabel}
        title={saveLabel}
        style={{
          minWidth: 36, height: 36, padding: "0 10px",
          background: alpha(C.sage, "22"), color: C.sage,
          border: `1px solid ${alpha(C.sage, "88")}`, borderRadius: 8,
          cursor: "pointer", fontFamily: F.body, fontWeight: 700, fontSize: fs(15),
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
        <Ico name="check" size={14} sw={2} />
      </button>
      {hasKey && (
        <button type="button"
          onClick={() => {
            if (ref.current) ref.current.value = "";
            onClear();
          }}
          aria-label={t ? t("btn_clear") : "Effacer"}
          style={{
            minWidth: 36, height: 36, padding: "0 10px",
            background: "transparent", color: C.oxbloodHi,
            border: `1px solid ${alpha(C.oxblood, "44")}`, borderRadius: 8,
            cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
          <Ico name="trash" size={14} sw={1.8} />
        </button>
      )}
    </div>
  );
}

function GDriveConfirmPanel({
  gdriveConfirm, setGdriveConfirm, doGdriveConfirm, gdriveLoadOptionPayload,
  gdriveDeleteOption, data, dateFormat, t,
}: any) {
  const isDeleteMode = gdriveConfirm?.mode === "delete";
  // Pre-fetch all option payloads in parallel as soon as the picker opens.
  // On newer backups the counts are encoded in the filename and parsed up-front, so
  // we no longer pre-fetch every payload just to display counts. The
  // lazy-load path is still triggered for LEGACY files (no count suffix)
  // so the picker remains useful for old backups.
  const optionCount = gdriveConfirm?.options?.length || 0;
  React.useEffect(() => {
    if (!gdriveLoadOptionPayload || !gdriveConfirm?.options) return;
    gdriveConfirm.options.forEach((opt: any, i: number) => {
      // Skip if counts are already known from the filename.
      if (opt && opt.counts) return;
      if (opt && !opt.d && !opt._loading && !opt._loadFailed) {
        gdriveLoadOptionPayload(i);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionCount]);
  return (
    <div style={{
      background: C.cardHi, borderRadius: 8, padding: 12, marginTop: 8,
      border: `1px solid ${C.rule2}`,
    }}>
      <div style={{
        fontFamily: F.display, fontStyle: "italic", fontSize: fs(16),
        color: C.ivory, marginBottom: 8,
      }}>
        {isDeleteMode
          ? (t ? t("backup_delete_title") : "Supprimer une sauvegarde")
          : (gdriveConfirm.options.length > 1
              ? (t ? t("gdrive_pick_title") : "Choisir une sauvegarde")
              : (t ? t("gdrive_restore_confirm") : "Restaurer cette sauvegarde ?"))}
      </div>

      {(isDeleteMode || gdriveConfirm.options.length > 1) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {gdriveConfirm.options.map((opt: any, i: number) => {
            const sel = !isDeleteMode && gdriveConfirm.sel === i;
            const deleting = !!opt._deleting;
            // Counts come from 3 sources, in priority order:
            //   1. opt.counts   — parsed from the filename (newer backups)
            //   2. opt.d        — populated by lazy-load (older, count-less names)
            //   3. null         — nothing yet, display "…"
            const nT = opt.counts ? opt.counts.tobaccos
              : opt.d ? (opt.d.tobaccos || []).length : null;
            const nP = opt.counts ? opt.counts.pipes
              : opt.d ? (opt.d.pipes || []).length : null;
            const nW = opt.counts ? opt.counts.wishlist
              : opt.d ? (opt.d.wishlist || []).length : null;
            const nA = opt.counts ? opt.counts.accessories
              : opt.d ? (opt.d.accessories || []).length : null;
            const nJ = opt.counts ? opt.counts.sessions
              : opt.d ? (opt.d.sessions || []).length : null;
            return (
              <div key={i}
                onClick={isDeleteMode
                  ? undefined
                  : () => setGdriveConfirm(Object.assign({}, gdriveConfirm, { sel: i }))}
                // When selectable (not delete mode), the row is a
                // keyboard-operable radio option. In delete mode the nested
                // 🗑 button owns interactivity, so no role here.
                {...(!isDeleteMode ? {
                  role: "radio" as const,
                  tabIndex: 0,
                  "aria-checked": !!sel,
                  onKeyDown: (ev: any) => {
                    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setGdriveConfirm(Object.assign({}, gdriveConfirm, { sel: i })); }
                  },
                } : {})}
                style={{
                  display: "flex", alignItems: "stretch", gap: 6,
                  cursor: isDeleteMode ? "default" : "pointer",
                  padding: "8px 10px", borderRadius: 8,
                  background: C.bg2,
                  border: `1px solid ${sel ? C.brass : C.rule}`,
                  opacity: deleting ? 0.5 : 1,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: fs(15), color: sel ? C.brassHi : C.ivory,
                    fontWeight: sel ? 700 : 500,
                  }}>
                    {(((opt.d && opt.d._saveType) || opt.saveType) === "auto"
                      ? "🔄 " + (t ? t("lbl_autosave_prefix") : "Auto-sauvegarde")
                      : "💾 " + (t ? t("lbl_backup_prefix") : "Sauvegarde"))
                      + (!isDeleteMode && i === 0 ? " ★" : "")
                      + " — " + (opt.modifiedTime ? fmtDateTime(opt.modifiedTime, dateFormat) : (opt.ds || ""))}
                  </div>
                  {nT !== null && (
                    <div style={{
                      fontFamily: F.mono, fontSize: fs(12.5), color: C.tx3,
                      marginTop: 3, letterSpacing: 0.4,
                    }}>
                      {nT} {t ? t("icl_tabs") : "tabacs"} · {nP} {t ? t("icl_pipes_lbl") : "pipes"} · {nW} {t ? t("lbl_wishes_short") : "souhaits"} · {nA} {t ? t("lbl_acc_short") : "acc."} · {nJ} {t ? t("lbl_sessions_word") : "séances"}
                    </div>
                  )}
                </div>
                {isDeleteMode && (
                  <button
                    type="button"
                    aria-label={t ? t("aria_delete_backup") : "Supprimer cette sauvegarde"}
                    disabled={deleting}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deleting) return;
                      const msg = t ? t("backup_delete_confirm") : "Supprimer définitivement cette sauvegarde ? L'action est irréversible.";
                      if (!window.confirm(msg)) return;
                      gdriveDeleteOption && gdriveDeleteOption(i);
                    }}
                    style={{
                      flexShrink: 0, minWidth: 44, minHeight: 44,
                      padding: "0 10px", border: `1px solid ${alpha(C.oxblood, "88")}`,
                      background: alpha(C.oxblood, "22"), color: C.oxbloodHi,
                      borderRadius: 8, cursor: deleting ? "not-allowed" : "pointer",
                      fontSize: fs(17), fontFamily: F.body,
                    }}>
                    {deleting ? "…" : "🗑"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty-backup guard: counts come straight from the filename. */}
      {!isDeleteMode && (() => {
        const pickedOpt = gdriveConfirm.options[gdriveConfirm.sel];
        if (!pickedOpt || !pickedOpt.counts) return null;
        const c = pickedOpt.counts;
        const empty = c.tobaccos + c.pipes + c.accessories + c.sessions + c.wishlist === 0;
        if (!empty) return null;
        return (
          <div style={{
            marginBottom: 8, padding: "8px 12px",
            background: alpha(C.oxblood, "22"), border: `1px solid ${alpha(C.oxblood, "88")}`,
            borderRadius: 8, fontSize: fs(13.5), color: C.oxbloodHi, lineHeight: 1.45,
            fontFamily: F.body,
          }}>
            {t ? t("backup_empty_warn") : "⚠ Cette sauvegarde semble vide — la restaurer effacerait toutes vos données."}
          </div>
        );
      })()}

      {/* Backup-vs-local count mismatch warning — fires when any data type
          has fewer entries in the backup than in the current local store. */}
      {!isDeleteMode && (() => {
        const pickedOpt = gdriveConfirm.options[gdriveConfirm.sel];
        // Read counts from the filename if available (newer backups); fall back
        // to the lazy-loaded payload for older files.
        const bC = pickedOpt?.counts
          ? pickedOpt.counts
          : (pickedOpt?.d ? {
              tobaccos: (pickedOpt.d.tobaccos || []).length,
              pipes: (pickedOpt.d.pipes || []).length,
              wishlist: (pickedOpt.d.wishlist || []).length,
              accessories: (pickedOpt.d.accessories || []).length,
              sessions: (pickedOpt.d.sessions || []).length,
            } : null);
        if (!bC) return null;
        const lC = {
          tobaccos: (data?.tobaccos || []).length,
          pipes: (data?.pipes || []).length,
          wishlist: (data?.wishlist || []).length,
          accessories: (data?.accessories || []).length,
          sessions: (data?.sessions || []).length,
        };
        // Build a list of every type that LOSES entries on restore.
        // Entity labels are per-language singular/plural i18n keys so the
        // warning localizes for every UI language (was fr/en only).
        const entKeys: Record<string, [string, string]> = {
          tobaccos: ["ent_tobacco_s", "ent_tobacco_p"],
          pipes: ["ent_pipe_s", "ent_pipe_p"],
          wishlist: ["ent_wish_s", "ent_wish_p"],
          accessories: ["ent_accessory_s", "ent_accessory_p"],
          sessions: ["ent_session_s", "ent_session_p"],
        };
        const losses: { key: string; backup: number; local: number }[] = [];
        (Object.keys(lC) as Array<keyof typeof lC>).forEach((k) => {
          if ((bC as any)[k] < lC[k]) {
            losses.push({ key: k, backup: (bC as any)[k], local: lC[k] });
          }
        });
        if (losses.length === 0) return null;
        // Kept inline — heavy pluralization + interpolation
        // composing "{backup} {plural_label} (you have {local} locally)".
        const lines = losses.map((l) => {
          const [sing, plur] = entKeys[l.key] || ["", ""];
          const isPlur = l.backup > 1 || l.backup === 0;
          const label = t ? t(isPlur ? plur : sing) : "";
          return t
            ? String(t("restore_fewer_line"))
                .replace("{n}", String(l.backup))
                .replace("{label}", label)
                .replace("{local}", String(l.local))
            : `${l.backup} ${label} (${l.local})`;
        });
        return (
          <div style={{
            fontSize: fs(13.5), color: C.amber, marginBottom: 8,
            padding: "8px 12px", background: alpha(C.amber, "1c"),
            border: `1px solid ${alpha(C.amber, "44")}`, borderRadius: 5,
            fontFamily: F.body, lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {/* Kept inline — bound to the inline-string
                pluralization block above. */}
              ⚠️ {t ? t("restore_fewer_title") : "Cette sauvegarde contient moins de données que votre version locale :"}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {lines.map((line, i) => (<li key={i}>{line}</li>))}
            </ul>
          </div>
        );
      })()}

      {!isDeleteMode && (
        <div style={{ fontSize: fs(15), color: C.oxbloodHi, marginBottom: 8 }}>
          {t ? t("confirm_replace") : "Remplace tout."}
        </div>
      )}

      {isDeleteMode ? (
        <ModalAction variant="secondary" onClick={() => setGdriveConfirm(null)}
          style={{ flex: "0 1 auto", padding: "10px 14px", fontSize: fs(15) }}>
          {t ? t("btn_close") : "Fermer"}
        </ModalAction>
      ) : (() => {
        const pickedOpt = gdriveConfirm.options[gdriveConfirm.sel];
        const nT = pickedOpt?.d ? (pickedOpt.d.tobaccos || []).length : 0;
        const nP = pickedOpt?.d ? (pickedOpt.d.pipes || []).length : 0;
        const nA = pickedOpt?.d ? (pickedOpt.d.accessories || []).length : 0;
        const nJ = pickedOpt?.d ? (pickedOpt.d.sessions || []).length : 0;
        const nW = pickedOpt?.d ? (pickedOpt.d.wishlist || []).length : 0;
        const importDisabled = !!pickedOpt?.d && (nT + nP + nA + nJ + nW === 0);
        return (
          <div style={{ display: "flex", gap: 8 }}>
            <ModalAction variant="primary" disabled={importDisabled}
              onClick={doGdriveConfirm}
              style={{ padding: "10px 14px", fontSize: fs(15) }}>
              {t ? t("btn_import") : "Importer"}
            </ModalAction>
            <ModalAction variant="secondary" onClick={() => setGdriveConfirm(null)}
              style={{ padding: "10px 14px", fontSize: fs(15) }}>
              {t ? t("btn_cancel") : "Annuler"}
            </ModalAction>
          </div>
        );
      })()}
    </div>
  );
}

function UpdateConfirmPanel({
  updateStatus, setUpdateStatus, doUpdate, t,
}: any) {
  return (
    <div style={{
      background: C.cardHi, borderRadius: 8, padding: 12, marginTop: 8,
      border: `1px solid ${alpha(C.brass, "88")}`,
    }}>
      <div style={{
        fontSize: fs(15), color: C.brassHi, fontWeight: 600, marginBottom: 4,
      }}>
        {"🔄 " + (t ? t("upd_available") : "Nouvelle version disponible")
          + ` → v${updateStatus.version} (${updateStatus.build})`}
      </div>
      <div style={{ fontSize: fs(15), color: C.tx2, marginBottom: 10 }}>
        {t ? t("upd_warning") : "L'application va se retélécharger. Votre cave n'est pas touchée."}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <ModalAction variant="primary"
          onClick={doUpdate}
          style={{ padding: "10px 14px", fontSize: fs(15) }}>
          {t ? t("upd_do") : "Mettre à jour"}
        </ModalAction>
        <ModalAction variant="secondary" onClick={() => setUpdateStatus(null)}
          style={{ padding: "10px 14px", fontSize: fs(15) }}>
          {t ? t("btn_cancel") : "Annuler"}
        </ModalAction>
      </div>
    </div>
  );
}



// ─── Diagnostic helpers ──────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

// ─────────────────────────────────────────────────────────────
// TrashSection moved out into `src/views/curator/TrashModal.tsx`
// — a dedicated standalone modal opened directly from the Home top-bar
// trash icon. The visual design grew beyond what a Settings sub-section
// could carry; a full modal owns the screen and respects the curator
// charter (Modal header, icon glyphs, kind-tinted rows, etc.).

function DiagnosticSection({
  t, dateFormat,
}: {
  t?: ((k: string) => string) | undefined;
  dateFormat?: string | undefined;
}) {
  // Review fix (iOS): use the shared share-aware dlFile for the diagnostic
  // export — a raw `<a download>` is ignored by iOS Safari standalone.
  const { dlFile } = useAppCtx();
  // The auto-repair button and its preview modal were
  // removed. The helper operated on `liveData` (which already
  // filters trashed rows) so a save() of its output could wipe the
  // trash. It also re-cleared session.tobaccoId / pipeId / lotId in
  // violation of the immutable-sessions policy. The
  // Copy / Download / Clear buttons remain so power users can still
  // inspect the counter. `data` and `save` props are gone.
  const [snap, setSnap] = useState(() => getDiagnosticSnapshot());
  useEffect(() => {
    const id = setInterval(() => setSnap(getDiagnosticSnapshot()), 2000);
    return () => clearInterval(id);
  }, []);

  // Snapshot blob for copy/download.
  function buildExportPayload() {
    return {
      app: { version: APP_VERSION, build: APP_BUILD },
      generatedAt: new Date().toISOString(),
      diagnostic: snap,
    };
  }
  function onCopy() {
    try {
      const text = JSON.stringify(buildExportPayload(), null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    } catch (_e) {}
  }
  function onDownload() {
    try {
      const text = JSON.stringify(buildExportPayload(), null, 2);
      const filename = "cave-diagnostic-" + String(new Date().toISOString()).replace(/[:.]/g, "-").slice(0, 19) + ".json";
      if (dlFile) { dlFile(text, filename, "application/json"); return; }
      // Fallback (dlFile unavailable): raw anchor download.
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_e) {}
  }

  if (snap.count === 0) {
    return (
      <Section title={t ? t("sec_diagnostic") : "Diagnostic"} accent={C.sage}>
        <div style={{ fontSize: fs(13.5), color: C.tx3, fontFamily: F.body, lineHeight: 1.5 }}>
          {t ? t("diag_no_anomaly") : "Aucune anomalie détectée — la comptabilité interne est cohérente."}
        </div>
      </Section>
    );
  }
  return (
    <Section title={t ? t("sec_diagnostic") : "Diagnostic"} accent={C.oxbloodHi}>
      <div style={{ fontSize: fs(13.5), color: C.oxbloodHi, fontFamily: F.body, fontWeight: 600, marginBottom: 6 }}>
        {/* Kept inline — pluralization + interpolation. */}
        {t
          ? String(t(snap.count > 1 ? "diag_violations_many" : "diag_violations_one")).replace("{n}", String(snap.count))
          : snap.count + " violation" + (snap.count > 1 ? "s" : "") + " de cohérence détectée" + (snap.count > 1 ? "s" : "") + "."}
      </div>
      <div style={{ fontSize: fs(12.5), color: C.tx3, fontFamily: F.mono, marginBottom: 8 }}>
        {t ? t("diag_first") : "Première : "}{fmtDateTime(snap.firstSeen, dateFormat)}
        {" · "}
        {t ? t("diag_last") : "Dernière : "}{fmtDateTime(snap.lastSeen, dateFormat)}
      </div>
      <div style={{
        background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
        padding: "6px 10px", maxHeight: 200, overflowY: "auto",
        fontFamily: F.mono, fontSize: fs(12), lineHeight: 1.45,
      }}>
        {snap.recent.map(function (e, i) {
          return (
            <div key={i} style={{ padding: "3px 0", borderTop: i > 0 ? `1px dashed ${C.rule}` : "none" }}>
              <span style={{ color: C.amber }}>[{e.scope}/{e.rule}]</span>
              <span style={{ color: C.tx3 }}> {e.ref}</span>
              <div style={{ color: C.tx2 }}>{e.detail}</div>
              <div style={{ color: C.tx3, fontSize: fs(11.5) }}>{fmtDateTime(e.ts, dateFormat)}</div>
            </div>
          );
        })}
      </div>
      {/* Action row: Copy / Download / Clear. Auto-repair
          button + preview modal removed (see header comment). */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 8, marginTop: 8 }}>
        <ActionBtn icon="book"
          label={t ? t("btn_copy") : "Copier"}
          onClick={onCopy} accent={C.tx2} small />
        <ActionBtn icon="box"
          label={t ? t("btn_download") : "Télécharger"}
          onClick={onDownload} accent={C.tx2} small />
        <ActionBtn icon="close"
          label={t ? t("btn_clear_diag") : "Vider"}
          onClick={() => { clearDiagnostic(); setSnap(getDiagnosticSnapshot()); }}
          accent={C.tx2} small />
      </div>
    </Section>
  );
}

// ── Duplicates utility ──────────────────────────────────────────────
//
// The one thing that HEALS an install that already diverged. An earlier change made
// the cross-device doubling visible in the import recap; it could not merge,
// because nothing in the data separates "one row whose identity diverged" from
// "two genuinely different items". Only the user knows — so this shows the
// facts and lets them decide.
//
// Follows the rules this section learned the hard way: the panel carries its
// OWN close × (a panel must not depend on the button that opened
// it for its way out), its result renders directly under its own button,
// and the destructive action names exactly what will move before
// it runs.
const DUP_KINDS: { kind: DupKind; labelKey: string }[] = [
  { kind: "tobacco", labelKey: "nav_tobaccos" },
  { kind: "pipe", labelKey: "dock_pipes" },
  { kind: "accessory", labelKey: "nav_acc" },
  { kind: "wishlist", labelKey: "lbl_wishlist" },
];

function DupGroupRow({ g, t, dateFormat, onMerge }: {
  g: DupGroup; t: (k: string) => string; dateFormat: string;
  onMerge: (keepId: any) => void;
}) {
  const [confirmKeep, setConfirmKeep] = useState<any>(null);
  const keep = g.members.find((m) => String(m.id) === String(confirmKeep));
  const drops = g.members.filter((m) => String(m.id) !== String(confirmKeep));
  return (
    <div style={{
      borderTop: `1px solid ${C.rule}`, paddingTop: 8, marginTop: 8,
      fontFamily: F.body, fontSize: fs(13.5), color: C.tx2,
    }}>
      <div style={{ color: C.ivory, fontWeight: 600 }}>
        {g.brand}{g.brand && g.name ? " · " : ""}{g.name}
      </div>
      {g.sharedBoxNumbers.length > 0 && (
        <div style={{ color: C.amber, fontFamily: F.mono, fontSize: fs(12) }}>
          {String(t("dup_same_box")).replace("{n}", g.sharedBoxNumbers.join(", "))}
        </div>
      )}
      {g.members.map((m) => (
        <div key={String(m.id)} style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "5px 0",
        }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: F.mono, fontSize: fs(12), color: C.tx3 }}>
            {(g.kind === "tobacco"
              ? `${m.lotCount} × · ${m.weight} · ${m.sessionCount} ⌛`
              : `${m.sessionCount} ⌛`)
              + (m.boxNumbers.length ? " · n° " + m.boxNumbers.join(",") : "")
              + (m.updatedAt ? " · " + fmtDate(String(m.updatedAt).slice(0, 10), dateFormat) : "")}
          </span>
          <button type="button"
            onClick={() => setConfirmKeep(m.id)}
            style={{
              padding: "5px 10px", minHeight: 30, borderRadius: 6,
              background: "transparent", color: C.brassHi,
              border: `1px solid ${C.rule}`, cursor: "pointer",
              fontFamily: F.body, fontSize: fs(12.5),
            }}>{t("dup_keep_this")}</button>
        </div>
      ))}
      {keep && (
        <Notice tone="warn">
          <div>{String(t("dup_confirm"))
            .replace("{n}", String(drops.length))
            .replace("{lots}", String(drops.reduce((a, m) => a + m.lotCount, 0)))
            .replace("{sess}", String(drops.reduce((a, m) => a + m.sessionCount, 0)))}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <ModalAction variant="danger"
              onClick={() => { onMerge(keep.id); setConfirmKeep(null); }}>
              {t("dup_do_merge")}
            </ModalAction>
            <ModalAction variant="secondary" onClick={() => setConfirmKeep(null)}>
              {t("btn_cancel")}
            </ModalAction>
          </div>
        </Notice>
      )}
    </div>
  );
}

export function DuplicatesPanel({ data, t, dateFormat, onMerged, onClose }: {
  data: any; t: (k: string) => string; dateFormat: string;
  onMerged: (next: any, moved: { lots: number; sessions: number }) => void;
  onClose: () => void;
}) {
  const groups = DUP_KINDS.map((k) => ({ ...k, groups: findDuplicateGroups(data, k.kind) }))
    .filter((x) => x.groups.length > 0);
  return (
    <div style={{
      marginTop: 8, padding: "10px 12px", borderRadius: 8,
      background: C.bg2, border: `1px solid ${C.rule}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Lbl color={C.tx3}>{t("dup_title")}</Lbl>
        <button type="button" onClick={onClose} aria-label={t("btn_close")}
          style={{
            minWidth: 44, minHeight: 44, padding: "0 9px", borderRadius: 5, lineHeight: 1,
            background: "transparent", color: C.tx3,
            border: `1px solid ${C.rule}`, cursor: "pointer",
            fontFamily: F.mono, fontSize: fs(14.5), fontWeight: 700,
          }}>×</button>
      </div>
      {groups.length === 0
        ? <div style={{ fontFamily: F.body, fontSize: fs(13.5), color: C.tx3, marginTop: 6 }}>{t("dup_none")}</div>
        : (
          <>
            <div style={{ fontFamily: F.body, fontSize: fs(12.5), color: C.tx3, marginTop: 4, lineHeight: 1.5 }}>
              {t("dup_hint")}
            </div>
            {groups.map((k) => (
              <div key={k.kind} style={{ marginTop: 10 }}>
                <Lbl color={C.tx3}>{t(k.labelKey)}</Lbl>
                {k.groups.map((g) => (
                  <DupGroupRow key={g.key} g={g} t={t} dateFormat={dateFormat}
                    onMerge={(keepId) => {
                      const r = mergeDuplicates(data, g.kind, keepId,
                        g.members.map((m) => m.id).filter((id) => String(id) !== String(keepId)));
                      onMerged(r.data, { lots: r.lotsMoved, sessions: r.sessionsRepointed });
                    }} />
                ))}
              </div>
            ))}
          </>
        )}
    </div>
  );
}
