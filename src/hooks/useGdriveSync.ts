import React from "react";
import { collectSettings } from "../utils/appSettings.ts";
import {
  SK,
  GDRIVE_CLIENT_ID,
  GDRIVE_SCOPE,
  GDRIVE_MAX_MANUAL,
  SCHEMA_VERSION,
} from "../constants.ts";
import { imgCache } from "../utils/imgCache.ts";
import { isPlausibleBackup, latestEditMs } from "../utils.ts";
import { recordOAuthEvent } from "../utils/oauthDiag.ts";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedEnvelopeJSON,
  verifyPassphrase,
  makeEncryptionVerifier,
} from "../utils/cryptoBackup.ts";
import {
  makeBackupName,
  makeCatalogueName,
  parseBackupCounts,
  classifyBackup,
  pruneByType,
  findNewerCloudBackup,
  explainCloudBackups,
  summariseCloudDevices,
  autoFileDeviceId,
  chooseAutoSaveTarget,
  pickKeepAuto,
} from "../utils/gdriveApi.ts";
import type { CloudBackupDiag, CloudDeviceSummary } from "../utils/gdriveApi.ts";
import {
  useGdriveAuth,
  IS_IOS_STANDALONE,
  tkGet,
  tkSet,
  tkClear,
  hintGet,
  captureAccountHint,
} from "./useGdriveAuth.ts";
import { gdriveProvider, dropboxProvider } from "../utils/cloudProvider.ts";
import { lsSet, lsRemove } from "../utils/appStorage.ts";
import { safeJsonParse } from "../utils/safeJson.ts";
import { catalogueGetCsv, catalogueGetMeta, catalogueSave } from "../utils/catalogueStore.ts";
import { tobaccoDbInvalidate } from "../utils/tobaccoDb.ts";
import { useDropboxAuth } from "./useDropboxAuth.ts";
// Defense-in-depth scrub for the diagnostic
// detail. The detail is always a provider error code/count today (verified
// secret-free), but routing it through the shared redactor guarantees a
// future provider that echoes a token/key can't leak it into the
// device-local `cave-autosave-diag` slot. Pure regex helper, no cycle
// (useAiAutoFill never imports this module).
import { redactApiKeys } from "./useAiAutoFill.ts";

var useState = React.useState,
  useEffect = React.useEffect,
  useRef = React.useRef;

// Reference timestamp for the
// multi-device "newer cloud backup" guard = THIS device's last CLOUD save on
// the active provider. It deliberately EXCLUDES `cave-last-export-ts`, which is
// ALSO bumped by purely-local JSON/CSV/ZIP exports (markExported) — a local
// export does NOT reconcile another device's cloud data, so folding it in here
// made a local backup count as "reconciled" and silently suppressed a
// genuinely-newer backup from another device (the export-reminder banner still
// uses that key). Single source so the three guard sites (launch check /
// manual re-check / sync diagnostic) can't drift out of agreement.
export function cloudGuardLocalRef(isDbx: boolean): number {
  try {
    return parseInt(
      localStorage.getItem("cave-autosave-ts-" + (isDbx ? "dropbox" : "gdrive")) || "0", 10,
    ) || 0;
  } catch { return 0; }
}

// The DISMISSED markers are per-provider too — the other half
// of the per-provider fix above, left global for seven releases.
//
// The reference (`cloudGuardLocalRef`) is scoped to the active provider, and
// the file list is the active provider's. The two "déjà vu" markers were not,
// so a dismissal on one provider suppressed the OTHER provider's banner:
// dismiss a Dropbox backup at ts=100, switch to Drive, and a genuinely-newer
// Drive backup at ts=90 — newer than this device's last Drive save of 50 — is
// below the global floor and silenced FOR EVER. That is the same
// permanent-silence shape as the never-engaged launch check, through a
// different door, and the
// comment two paragraphs up had already reasoned it out for the timestamp
// while these two keys sat right beside it.
//
// MIGRATION: the legacy global pair is adopted ONCE, by whichever provider
// reads first — i.e. the active one, which is the one the user has been using
// and so the likeliest author of it — and then deleted. Attributing it to the
// wrong provider is no worse than today (today it binds BOTH), while the other
// provider is freed, so the migration cannot make anything worse. Read before
// clear, as everywhere in this file.
export function cloudDismissKeys(isDbx: boolean): { ts: string; name: string } {
  var p = isDbx ? "dropbox" : "gdrive";
  return {
    ts: "cave-cloud-newer-dismissed-" + p,
    name: "cave-cloud-newer-dismissed-name-" + p,
  };
}

export function readCloudDismissed(isDbx: boolean): { ts: number; name: string | null } {
  var k = cloudDismissKeys(isDbx);
  try {
    var rawTs = localStorage.getItem(k.ts);
    var rawName = localStorage.getItem(k.name);
    if (rawTs === null && rawName === null) {
      var gTs = localStorage.getItem("cave-cloud-newer-dismissed");
      var gName = localStorage.getItem("cave-cloud-newer-dismissed-name");
      if (gTs !== null || gName !== null) {
        if (gTs !== null) lsSet(k.ts, gTs);
        if (gName !== null) lsSet(k.name, gName);
        lsRemove("cave-cloud-newer-dismissed");
        lsRemove("cave-cloud-newer-dismissed-name");
        rawTs = gTs; rawName = gName;
      }
    }
    return { ts: parseInt(rawTs || "0", 10) || 0, name: rawName || null };
  } catch { return { ts: 0, name: null }; }
}

export function writeCloudDismissed(isDbx: boolean, ts: number, name: string): void {
  var k = cloudDismissKeys(isDbx);
  // The by-name marker is the primary skew-proof dedup; the ts is the
  // secondary floor. Never write a wall-clock here (see ackCloudNewerBackup).
  if (ts > 0) lsSet(k.ts, String(ts));
  if (name) lsSet(k.name, String(name));
}

export function clearCloudDismissed(isDbx: boolean): void {
  var k = cloudDismissKeys(isDbx);
  lsRemove(k.ts);
  lsRemove(k.name);
  // The legacy globals too: an explicit "check my backups" means the user
  // wants everything reconsidered, and leaving them would let a legacy value
  // be adopted by the next provider that reads.
  lsRemove("cave-cloud-newer-dismissed");
  lsRemove("cave-cloud-newer-dismissed-name");
}

// The auth domain (lastUserGestureTs gesture tracking,
// IS_IOS_STANDALONE, tkGet/tkSet/tkClear, hint*, captureAccountHint,
// spaRoot, pkceGenerateVerifier) moved to src/hooks/useGdriveAuth.ts —
// step 2 of the useGdriveSync split. The storage helpers are imported
// back below because the sync-domain 401/403 retry paths still need
// them.

// MakeBackupName / parseBackupCounts / classifyBackup /
// fetchWithTimeout / pruneByType moved to src/utils/gdriveApi.ts —
// step 1 of the useGdriveSync split. They are pure (no React, no
// closure over hook state) and now unit-tested in isolation.

// Stable per-device id, generated once and persisted in
// localStorage. Woven into every AUTO backup filename (see
// makeBackupName) so the auto-save sweep can converge each device to a
// single auto file WITHOUT deleting other devices' auto files. Returns
// a short lowercase-alphanumeric token. Falls back to a constant on
// storage failure (private-mode quota) — worst case the device shares
// the fallback id with other storage-blocked devices, which only means
// they'd co-own one auto file; still far better than the 14-file pile.
/**
 * The id `getDeviceId` falls back to when storage is unavailable (Safari
 * private mode, blocked site data). It is a CONSTANT, so every storage-blocked
 * device shares it — which is fine for the auto-file sweep (they co-own one
 * file) but NOT for the multi-device guard: two such devices would each read
 * the other's auto files as their OWN and go mutually silent, for ever. The
 * guard call sites therefore pass "" instead, so an unstable id never suppresses
 * anything. Nagging a storage-blocked device is recoverable; silence is not.
 */
export var DEVICE_ID_FALLBACK = "device";

/** The device id, or "" when it is the shared fallback — for the guard only. */
export function stableDeviceIdForGuard(): string {
  var id = getDeviceId();
  return id === DEVICE_ID_FALLBACK ? "" : id;
}

/**
 * The moment this device first wrote a device-stamped auto file, or 0.
 *
 * `cave-auto-stamped` used to hold "1". A boolean cannot answer the
 * question the guard actually needs — "could this unstamped file be MINE?" —
 * because a device that has LOST its id writes legacy-shaped names today. The
 * marker is a timestamp now; a legacy "1" is migrated to the current moment on
 * first read, so genuinely-old leftovers stay suppressed while anything written
 * from now on is judged on its date.
 */
export function ownStampedSince(): number {
  try {
    var raw = localStorage.getItem("cave-auto-stamped");
    if (!raw) return 0;
    var n = parseInt(raw, 10);
    if (!isNaN(n) && n > 100000000000) return n;
    var now = Date.now();
    lsSet("cave-auto-stamped", String(now));
    return now;
  } catch (_e) { return 0; }
}

export function getDeviceId(): string {
  try {
    var id = localStorage.getItem("cave-device-id");
    if (!id || !/^[0-9a-z]+$/.test(id)) {
      id =
        Math.random().toString(36).slice(2, 8) +
        Math.random().toString(36).slice(2, 6);
      lsSet("cave-device-id", id);
    }
    return id;
  } catch (_e) {
    return DEVICE_ID_FALLBACK;
  }
}

// The user's friendly device name (cave-device-name),
// appended to every backup filename as a readable slug (see makeBackupName).
// "" when unset — makeBackupName then omits the segment. Read-only + crash-safe.
export function getDeviceName(): string {
  try {
    return localStorage.getItem("cave-device-name") || "";
  } catch (_e) {
    return "";
  }
}

// Visible auto-save diagnostic. The auto-save path
// (gdriveSaveQuiet) is deliberately SILENT — every failure is swallowed
// so it never interrupts the user. That made a genuinely-broken auto-save
// indistinguishable from "nothing to save" from the outside. This records
// the outcome of the LAST auto-save attempt to localStorage so Settings
// can surface it ("✓ sauvegardé · ménage 15 supprimés" / "✗ jeton
// indisponible" / "✗ envoi refusé 429" …) and the user/maintainer can see
// WHY a save didn't land. One slot, last-write-wins. Never in backups.
export function recordAutosaveDiag(stage: string, detail?: string): void {
  lsSet(
    "cave-autosave-diag",
    JSON.stringify({ ts: Date.now(), stage: stage, detail: detail ? redactApiKeys(detail) : "" }),
  );
}

// Monotonic auto-save attempt counter. Each
// gdriveSaveQuiet bumps it at "saving-start" and captures the value; the
// DETACHED cleanup sweep (the lock is released before the sweep
// runs) only writes its terminal `ok`/`swept-partial` diagnostic if no
// NEWER attempt has started since. Without this, a slow sweep from save A
// could land an `ok` over the slot AFTER a newer save B already recorded
// a real failure — making Settings → Données show a healthy sync when the
// latest attempt actually failed (the exact thing this diagnostic exists to
// expose). Module-scope so it survives across the hook's closures.
// One-shot markers that survive the iOS OAuth redirect and tell
// the shared "list" return branch WHICH button issued it. Without them the
// dispatcher can only route on the OAuth action, and two buttons that both need
// a plain read token were reusing an action that means something else.
export var BACKUP_DELETE_PENDING_KEY = "cave-backup-delete-pending";
export var CLOUD_CHECK_PENDING_KEY = "cave-cloud-check-pending";
/** A resume marker is only honoured while fresh — a stale one must never act. */
export var PENDING_RESUME_MAX_MS = 120000;

var autosaveAttemptSeq = 0;
export function nextAutosaveAttempt(): number { autosaveAttemptSeq += 1; return autosaveAttemptSeq; }
export function currentAutosaveAttempt(): number { return autosaveAttemptSeq; }

/**
 * Why the launch-time multi-device check did what it did.
 *
 * Every exit of that check was silent: not engaged, no token, a list error, a
 * rejected promise, or simply nothing newer — all indistinguishable from
 * "everything is fine". So a user whose second device never announced newer
 * cloud data had no way to tell whether it had looked and found nothing, or
 * never looked at all. That is the same disease fixed on the
 * update path, one subsystem over: the mechanism may refuse to act, but it
 * must say so.
 *
 * Stages: not-engaged / no-drive-token / no-token / list-error / error / none
 * / found. Surfaced in Settings → Données beside the auto-save diagnostic.
 */
export function recordCloudCheckDiag(stage: string): void {
  lsSet("cave-cloudcheck-diag", JSON.stringify({ ts: Date.now(), stage: stage }));
}
export function readCloudCheckDiag(): { ts: number; stage: string } | null {
  try {
    var raw = localStorage.getItem("cave-cloudcheck-diag");
    if (!raw) return null;
    var v = JSON.parse(raw);
    if (v && typeof v.stage === "string") return v;
  } catch (_e) {}
  return null;
}

export function readAutosaveDiag(): { ts: number; stage: string; detail: string } | null {
  try {
    var raw = localStorage.getItem("cave-autosave-diag");
    if (!raw) return null;
    var v = JSON.parse(raw);
    if (v && typeof v.stage === "string") return v;
  } catch (_e) {}
  return null;
}

// Device-scoped auto-file sweep, shared by the auto-save
// (gdriveSaveQuiet) AND the manual save (gdriveSave). Deletes every auto
// file that belongs to THIS device (matching device id) or is legacy /
// unstamped (adopted-and-drained once), except `keepId`. Auto files
// stamped with a DIFFERENT device id are foreign and never touched.
//
// This started out on the auto-save path only. But on iOS standalone
// the silent auto-save often can't refresh an expired token, so the
// pile never got cleaned there — and a manual save (the obvious "tidy
// up now" action, token-fresh on every platform) deliberately skipped
// auto files. The same sweep is wired into the manual save so the
// user always has a deterministic, cross-platform way to converge their
// auto backups to one. `cloud` + `token` are passed in so the helper
// stays free of hook-closure assumptions and is unit-testable.
export function sweepOwnAutoStragglers(
  cloud: { remove: (tk: string, id: string) => Promise<any> },
  token: string,
  autoFiles: any[],
  myDeviceId: string,
  keepId: string | null,
): Promise<{ deleted: number; failed: number }> {
  var toDelete = (autoFiles || []).filter(function (f: any) {
    if (!f || !f.id || f.id === keepId) return false;
    var did = autoFileDeviceId(f.name);
    return did === myDeviceId || did === null;
  });
  // The Dropbox "deletes never happened" bug: delete
  // SEQUENTIALLY, not concurrently. Drive tolerates parallel DELETEs, but
  // Dropbox SERIALIZES writes per namespace and rejects concurrent
  // writes with HTTP 429 `too_many_write_operations`. The original
  // sweep fired ~15 `files/delete_v2` calls at once via forEach +
  // fire-and-forget `.catch()`; Dropbox 429'd all but maybe one and the
  // errors were swallowed, so the straggler pile never shrank (the user
  // saw 16 auto files keep growing, including duplicate device-stamped
  // files because even the overwrite's own old-file delete collided).
  // Chaining the removes one-at-a-time removes the contention. Also
  // track per-delete outcome (r.ok works for BOTH providers — Drive
  // returns the raw Response, dropboxProvider.remove returns a WireResponse
  // whose ok is false on failure) so the caller can surface a diagnostic.
  var deleted = 0, failed = 0;
  return toDelete.reduce(function (chain: Promise<void>, f: any) {
    return chain.then(function () {
      return cloud.remove(token, f.id).then(function (r: any) {
        // An "already gone" delete is a SUCCESS
        // for a convergence sweep — the file we wanted removed is removed.
        // Under the detached sweep two overlapping saves can race to
        // delete the same straggler; the loser gets 404 (Drive not-found)
        // or 409 (Dropbox path_lookup/not_found) and used to be counted as
        // `failed`, surfacing a bogus "swept-partial / cleanup failing"
        // diagnostic. Treat those statuses as deleted; only a genuine
        // error (auth, 429-after-retry, network) counts as failed.
        if (!r || r.ok !== false) { deleted++; return; }
        if (r.status === 404 || r.status === 409) { deleted++; return; }
        failed++;
      }, function () { failed++; });
    });
  }, Promise.resolve()).then(function () {
    return { deleted: deleted, failed: failed };
  });
}
// The field mask for every listing that feeds `buildSyncDiag`.
//
// NAMED, because it was written out three times and all three forgot `size` —
// Drive applies the mask VERBATIM, so `f.size` came back `undefined` and the
// merged panel showed every row sizeless with a "—" total. Dropbox's adapter
// ignores the mask and worked throughout, which is how the gap survived a
// reading. One constant means a fourth diagnostic listing cannot forget it;
// listings that only need identity (the auto-file sweep, the newer-backup
// check) deliberately keep their own narrower mask.
var SYNC_DIAG_FIELDS = "files(id,name,size,modifiedTime)";


export function useGdriveSync({
  data,
  loading,
  t,
  setImportModal,
  pendingSync,
  setPendingSync,
  excludeApiKey,
  apiKey,
  aiProvider,
  stageImport,
  markExported,
  driveEncryptionEnabled,
  drivePassphrase,
  setDrivePassphrase,
  requestDrivePassphrase,
  cloudProviderId,
}: {
  data: any;
  // App's cold-start loading flag. `data`
  // is INIT (empty, truthy) until load() resolves, so the OAuth-return
  // dispatcher can't tell "loaded, genuinely empty" from "not loaded yet".
  // A `save`/`autosave` action fired on the INIT closure would upload an
  // EMPTY cellar over the cloud backup. Gating the write actions on
  // `loading === false` closes that data-loss window.
  loading?: boolean;
  stageImport: (
    parsed: any,
    source: "file" | "drive",
    options?: { autoApply?: "replace" | "merge" },
  ) => void;
  markExported?: () => void;
  t: (k: string) => string;
  setImportModal: (v: boolean) => void;
  pendingSync: boolean;
  setPendingSync: (v: boolean) => void;
  excludeApiKey: boolean;
  apiKey: string;
  aiProvider: string;
  // Optional Drive encryption (Phase 1). All four are
  // optional — when undefined the hook behaves identically to the
  // pre-encryption code path (plaintext upload / download).
  driveEncryptionEnabled?: boolean;
  drivePassphrase?: string | null;
  setDrivePassphrase?: (pw: string | null) => void;
  requestDrivePassphrase?: (mode: "setup" | "unlock") => Promise<string | null>;
  // Active backup destination — "gdrive" (default) or
  // "dropbox". Owned by App.tsx (cave-cloud-provider localStorage).
  cloudProviderId?: "gdrive" | "dropbox";
}) {
  var _gd = useState<string | null>(null),
    gdriveStatus = _gd[0],
    setGdriveStatus = _gd[1];
  // Schedule the "clear the transient status banner
  // after N ms" timer through a SINGLE tracked ref (only one status shows at a
  // time, so a new schedule cancels the previous) and clear it on unmount. The
  // ~13 raw `setTimeout(() => setGdriveStatus(null), N)` calls left real timers
  // pending; in the test env one fired AFTER jsdom teardown → setState →
  // `window is not defined` → vitest "1 unhandled error" → CI red → deploy
  // skipped. The unmount cleanup (RTL auto-unmount between tests) drains them.
  var statusClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleStatusClear(ms: number) {
    if (statusClearRef.current) clearTimeout(statusClearRef.current);
    statusClearRef.current = setTimeout(function () {
      statusClearRef.current = null;
      setGdriveStatus(null);
    }, ms);
  }
  useEffect(function () {
    return function () { if (statusClearRef.current) clearTimeout(statusClearRef.current); };
  }, []);

  // The CATALOGUE cloud actions get their own status slot.
  //
  // They shipped writing to the shared `gdriveStatus`, whose
  // Notice is pinned under the CELLAR save button (deliberately) — a
  // different Section, ABOVE the catalogue one. So tapping « Sauvegarder le
  // catalogue dans le cloud » printed the answer several rows further up the
  // scroll, off screen on a phone. Reported from the app with a screenshot.
  //
  // This repeats the sync-check defect verbatim, immediately after that entry
  // was written down: *"it wrote
  // to the SHARED gdriveStatus … so the answer appeared where the user was not
  // looking."* Worse, the comment at the call site in SettingsModal NAMED the
  // conflict and then shipped anyway, explaining the feature in a hint instead
  // of moving the message — a hint about what a button does is not an answer
  // to what it just did.
  //
  // A separate slot rather than a shared one with a source tag (the
  // `syncDiagSource` shape) because these two live in a different Section from
  // every other cloud action: there is no ambiguity about which button a
  // catalogue message belongs to, so the simpler mechanism is enough.
  var _ccs = useState<string | null>(null);
  var catalogueCloudStatus = _ccs[0], setCatalogueCloudStatus = _ccs[1];
  var catClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setCatCloudStatus(m: string | null) { setCatalogueCloudStatus(m); }
  function scheduleCatCloudClear(ms: number) {
    if (catClearRef.current) clearTimeout(catClearRef.current);
    catClearRef.current = setTimeout(function () {
      catClearRef.current = null;
      setCatalogueCloudStatus(null);
    }, ms);
  }
  useEffect(function () {
    return function () { if (catClearRef.current) clearTimeout(catClearRef.current); };
  }, []);
  // `mode?: "restore" | "delete"` was dropped with `gdriveManageBackups` —
  // this picker only ever restores now.
  var _gdc = useState<{ options: any[]; sel: number } | null>(null),
    gdriveConfirm = _gdc[0],
    setGdriveConfirm = _gdc[1];
  var _asd = useState(localStorage.getItem("cave-autosave") === "1"),
    autoSaveDrive = _asd[0],
    setAutoSaveDrive = _asd[1];
  // The "last save" timestamp is PER-PROVIDER. Each
  // destination (Drive / Dropbox) keeps its own files, so a single global
  // `cave-autosave-ts` made Settings show the same date under both
  // destinations even though the user hadn't saved one of them in days.
  // On first launch after this change the per-provider key is absent, so
  // we seed the ACTIVE provider's display from the legacy global value
  // (its last save was almost certainly to the active provider) — the
  // OTHER provider then correctly shows "—" until its next save.
  var _lat = useState<number | null>(
      (function () {
        var _p = cloudProviderId === "dropbox" ? "dropbox" : "gdrive";
        var raw = localStorage.getItem("cave-autosave-ts-" + _p)
          || localStorage.getItem("cave-autosave-ts");
        return raw ? parseInt(raw, 10) : null;
      })(),
    ),
    lastAutoSaveTs = _lat[0],
    setLastAutoSaveTs = _lat[1];
  // (`backupsMeta` lived here — a second listing of the same cloud files,
  // feeding a second Settings panel beside the multi-device diagnostic. The two
  // were merged into one panel fed by `syncDiag`, so this state, its fetch pair
  // and the optimistic writes that maintained it all went with it. One listing,
  // one panel: the delete now updates the rows the user is looking at.)
  // Auth domain composed in — useGdriveAuth owns the token
  // ref, the OAuth capture (pendingOAuth), gdriveGetToken, reconnect
  // and the iOS save-tap reauth. The DISPATCHER effect below stays
  // here because it calls sync-domain functions (gdriveSave/Restore/
  // SaveQuiet/_gdriveListBackupsMeta).
  var auth = useGdriveAuth({ t: t, setGdriveStatus: setGdriveStatus, setImportModal: setImportModal });
  var driveTokenRef = auth.driveTokenRef;
  var pendingOAuth = auth.pendingOAuth;
  var setPendingOAuth = auth.setPendingOAuth;
  var gdriveGetToken = auth.gdriveGetToken;
  var gdriveReconnect = auth.gdriveReconnect;
  var triggerIosAutosaveReauthGdrive = auth.triggerIosAutosaveReauth;
  var quietSaveInProgressRef = useRef(false);

  // ── Provider routing ───────────────────────────────────────────────
  // Dropbox auth is composed unconditionally (hook-order rule) but only
  // consulted when the user selected Dropbox in Settings.
  var dbx = useDropboxAuth({ setDropboxStatus: setGdriveStatus, t: t });
  var isDbx = cloudProviderId === "dropbox";
  var cloud = isDbx ? dropboxProvider : gdriveProvider;
  // Per-provider file-id namespaces so switching destinations never
  // cross-pollinates the auto-save PATCH target.
  var FID_KEY = isDbx ? "dropbox-fid" : "gdrive-fid";
  var AUTO_FID_KEY = isDbx ? "dropbox-auto-fid" : "gdrive-auto-fid";
  // Transient in-memory carry for the Dropbox access token inside the
  // quiet-save pipeline (separate from driveTokenRef — a Google token
  // must never leak into a Dropbox call after a provider switch).
  var dbxTokenRef = useRef<string | null>(null);
  function getCloudToken(action: any, forceInteractive?: boolean): Promise<any> {
    return isDbx ? dbx.getToken(action) : gdriveGetToken(action, forceInteractive);
  }
  function cloudTokenPersist(token: string) {
    if (isDbx) { dbxTokenRef.current = token; return; } // dbx hook caches storage-side itself
    driveTokenRef.current = token;
    try { tkSet(JSON.stringify({ t: token, x: Date.now() + 3500000 })); } catch (_e) {}
  }
  // Cached-token reader for the post-picker paths
  // (doGdriveConfirm download, lazy payload peek, delete). Pre-fix these
  // read driveTokenRef/tkGet DIRECTLY — in Dropbox mode that handed a
  // stale GOOGLE token to content.dropboxapi.com, which answered
  // HTTP 400 (invalid authorization). Routes per provider and checks
  // the same 60s expiry margin as before.
  function getCachedCloudToken(): string | null {
    if (isDbx) {
      var dtk = dbxTokenRef.current;
      if (dtk) return dtk;
      try {
        var _dls = JSON.parse(localStorage.getItem("dropbox-tk") || "null");
        if (_dls && _dls.t && _dls.x > Date.now() + 60000) return _dls.t;
      } catch (_e) {}
      return null;
    }
    var gtk = driveTokenRef.current;
    if (gtk) return gtk;
    try {
      var _gls = JSON.parse(tkGet() || "null");
      if (_gls && _gls.x > Date.now() + 60000) return _gls.t;
    } catch (_e) {}
    return null;
  }
  function cloudTokenInvalidate() {
    if (isDbx) {
      dbxTokenRef.current = null;
      // Drop only the short-lived access token — the refresh token
      // stays, so the next attempt renews silently.
      // eslint-disable-next-line tabac-local/no-raw-storage-write -- OAuth/token key keeps its dedicated guarded path (read-before-clear)
      try { localStorage.removeItem("dropbox-tk"); } catch (_e) {}
      return;
    }
    driveTokenRef.current = null;
    tkClear();
  }
  // The iOS save-tap reauth piggyback is a Google-implicit-grant
  // workaround; Dropbox renews via the refresh grant (plain fetch,
  // every platform) so the redirect dance is pointless there.
  function triggerIosAutosaveReauth(): void {
    if (isDbx) return;
    triggerIosAutosaveReauthGdrive();
  }

  // Drop every provider-scoped surface when the user switches provider: the
  // file lists are not interchangeable (Drive and Dropbox ids and counts
  // differ), so anything built from provider A is misleading — or worse,
  // executes A's opaque file ids against B. Skip the first render so an
  // initial cloudProviderId set at mount doesn't wipe a fresh panel.
  var prevCloudProviderId = useRef(cloudProviderId);
  useEffect(function () {
    if (prevCloudProviderId.current === cloudProviderId) return;
    prevCloudProviderId.current = cloudProviderId;
    // Every OTHER provider-scoped surface must go too.
    //
    // Only `backupsMeta` was cleared, so a restore picker, a newer-backup
    // offer and a sync panel built from provider A survived the switch and
    // then executed A's opaque FILE IDS against provider B: `doGdriveConfirm`
    // and `restoreCloudNewerBackup` both read `getCachedCloudToken()` at call
    // time, which is now B's token. A Drive id sent to Dropbox comes back as
    // "Erreur : HTTP 409" for a backup the user can see listed in front of
    // them. `gdriveConfirm` additionally disables Sauvegarder + Restaurer
    // (SettingsModal), so a forgotten picker greys out two buttons with no
    // stated reason, indefinitely.
    setGdriveConfirm(null);
    setCloudNewerBackup(null);
    setSyncDiag(null);
    setSyncDiagErr(null);
    setGdriveStatus(null);
    // The "last save" timestamp is per-provider — re-read it for
    // the newly-selected destination. NO global fallback here: the global
    // key belongs to whichever provider saved last, and surfacing it under
    // the OTHER destination is exactly the bug this fixes (so a never-saved
    // destination correctly shows "—").
    var raw = localStorage.getItem("cave-autosave-ts-" + (cloudProviderId === "dropbox" ? "dropbox" : "gdrive"));
    setLastAutoSaveTs(raw ? parseInt(raw, 10) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudProviderId]);

  // ── Multi-device guard ─────────────────────────────────────────────
  // Detect, once per app launch, whether the cloud holds a backup
  // meaningfully NEWER than anything this device has saved or
  // acknowledged — the "I edited on my phone yesterday, now I'm on the
  // tablet" scenario. Strictly best-effort and strictly silent:
  //   - only runs when the user has engaged with cloud backup at all
  //     (auto-save flag or a stored fid);
  //   - Drive: uses a CACHED token only — never triggers a popup or a
  //     redirect from an unattended mount path;
  //   - Dropbox: the refresh grant is a plain silent fetch on every
  //     platform, so a renewal attempt is acceptable;
  //   - any failure (offline, expired token, malformed listing) means
  //     "no banner", never an error surface.
  // The 4.5s delay lets useGdriveAuth's silent token-refresh effect
  // (2.5s post-mount when an auto-save fid exists) land first.
  var _cnb = useState<{
    id: string; name: string; modifiedTime: string; ts: number;
    counts: ReturnType<typeof parseBackupCounts>;
  } | null>(null);
  var cloudNewerBackup = _cnb[0];
  var setCloudNewerBackup = _cnb[1];
  // In-flight flag for the Home / Overlay banner. The
  // global gdriveStatus is only visible inside Settings → Drive, so a
  // user tapping "Restaurer" on the banner got no signal at all — the
  // download/decrypt/import worked in the background while they kept
  // tapping. This flag drives a spinner + disabled state directly on
  // the banner buttons.
  var _crb = useState(false);
  var cloudRestoreBusy = _crb[0];
  var setCloudRestoreBusy = _crb[1];
  var cloudCheckRanRef = useRef(false);
  useEffect(function () {
    if (cloudCheckRanRef.current) return;
    cloudCheckRanRef.current = true;
    var timer = setTimeout(function () {
      // BEING AUTHENTICATED IS ENGAGEMENT.
      //
      // This gate used to read only `cave-autosave` and the two fid keys, and
      // the paths that write those fids are the SAVES (gdriveSave /
      // gdriveSaveQuiet) plus the backup LISTING — never a restore that
      // reaches this device by any other route.
      //
      // So a device you set up by RESTORING from the cloud, and on which you
      // never turned auto-save on, was judged "not engaged" and the
      // multi-device check never ran — silently, for ever. That is exactly the
      // device that needs it most: the one you pick up after a week away and
      // want to be told is stale. Reported from the app: "I switched devices
      // and it does not tell me newer data is on Dropbox, and I have not
      // touched this one in a week."
      //
      // Holding a Dropbox refresh token, or a Drive account hint, means the
      // user has connected THIS device to THAT provider. There is no reading
      // of that which is not engagement.
      var engaged = false;
      try {
        engaged = localStorage.getItem("cave-autosave") === "1"
          || !!localStorage.getItem(FID_KEY)
          || !!localStorage.getItem(AUTO_FID_KEY)
          || (isDbx ? !!localStorage.getItem("dropbox-rt")
                    : !!localStorage.getItem("gdrive-account-hint"));
      } catch (_e) { /* storage blocked → stay silent */ }
      if (!engaged) { recordCloudCheckDiag("not-engaged"); return; }
      var cached = getCachedCloudToken();
      var tokenPromise: Promise<string | null>;
      if (cached) tokenPromise = Promise.resolve(cached);
      else if (isDbx) tokenPromise = dbx.getTokenSilent().catch(function () { return null; });
      else { recordCloudCheckDiag("no-drive-token"); return; } // no popups from mount
      tokenPromise.then(function (tk) {
        if (!tk) { recordCloudCheckDiag("no-token"); return; }
        return cloud.list(tk, {
          fields: SYNC_DIAG_FIELDS,
          orderBy: "modifiedTime+desc",
        })
          .then(function (r) { return r.json(); })
          .then(function (list: any) {
            if (!list || list.error) { recordCloudCheckDiag("list-error"); return; }
            // The multi-device guard compares against THIS
            // provider's last save (per-provider ts) — the launch check
            // lists the active provider's files, so the reference must be
            // provider-scoped.
            // Latent-bug fix: NO global `cave-autosave-ts`
            // fallback here. The global key belongs to whichever provider
            // saved last; resurrecting it on a provider this device has
            // NEVER saved to (per-provider key absent) compared foreign
            // backups against the OTHER provider's timestamp and silently
            // hid genuinely-newer backups → the two devices diverged. Absent
            // per-provider key ⇒ 0 ⇒ any cloud backup on this provider is
            // correctly seen as newer. Mirrors the display path (provider-
            // switch effect above). Cost: a legacy install that hasn't saved
            // since the per-provider upgrade may get one harmless self-correcting
            // nag for its own backup — far better than a silent divergence.
            // Cloud-save ts only (see cloudGuardLocalRef).
            var localRef = cloudGuardLocalRef(isDbx);
            // Name-based dedup is skew-proof — see
            // findNewerCloudBackup comment. Per-provider.
            var dis = readCloudDismissed(isDbx);
            var dismissed = dis.ts;
            var dismissedName = dis.name;
            var hit = findNewerCloudBackup(
              list.files || [], localRef, dismissed, 120000, dismissedName,
              stableDeviceIdForGuard(), ownStampedSince(),
            );
            recordCloudCheckDiag(hit ? "found" : "none");
            if (hit) {
              setCloudNewerBackup({
                id: hit.id,
                name: hit.name,
                modifiedTime: hit.modifiedTime,
                ts: hit.ts,
                counts: parseBackupCounts(hit.name),
              });
            }
          });
      }).catch(function () { recordCloudCheckDiag("error"); });
    }, 4500);
    return function () { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Manual re-check trigger. The launch effect runs
  // once per app session, uses cached tokens only on Drive, and is
  // suppressed by the "déjà vu" markers (per-provider —
  // `cave-cloud-newer-dismissed-<provider>` + `…-name-<provider>`,
  // see cloudDismissKeys). All three legitimate, but
  // they leave the user stuck when an OTHER device just saved and
  // the silent path didn't pick it up. The Settings button gives
  // them an explicit re-check that:
  //   - clears both dismissed markers so the picker sees the fresh
  //     cloud state regardless of prior dismissals;
  //   - on Drive, escalates to interactive token fetch if no cached
  //     token (the user is actively asking, so a popup / iOS redirect
  //     is OK — unlike the silent mount-time check).
  //
  // IT USED TO ANSWER SOMEWHERE ELSE, AND ONLY "OK".
  //
  // Two defects, both reported from the app ("quand je clique sur vérifier
  // les sauvegardes il ne se passait rien… ensuite il me dit juste ok, avant
  // je voyais le détail par device").
  //
  // (a) It wrote to the SHARED `gdriveStatus`, whose Notice is pinned under
  // the SAVE button (deliberately) — three rows above. So tapping
  // "Vérifier" printed "✓ OK" somewhere the user was not looking. Worse, the
  // button was `disabled={!!gdriveStatus}`: that guard exists to stop the
  // status row shifting the save/restore pair under a finger, and applying it
  // here meant ANY lingering cloud status (3-4 s after a save, an error, a
  // disconnect — including this button's OWN success message) left the button
  // silently dead. That is what "nothing happened until I named the device"
  // really was: naming it took a few seconds, the stale status expired, and
  // the next tap worked. The name has nothing to do with it.
  //
  // (b) "OK" is the wrong answer to "check my backups". Finding nothing is
  // exactly when you want to know WHAT was looked at — the per-device
  // roll-up the "Diagnostic multi-appareils" button already renders. It costs
  // no extra request: this function has the same file list in hand. So the
  // check now populates the SAME panel, right under its own button.
  function checkCloudNewerNow(preTk?: string) {
    setSyncDiagBusy(true);
    setSyncDiagErr(null);
    setSyncDiag(null);
    setSyncDiagSource("check");
    var tokenPromise: Promise<string | null>;
    var cached = preTk || getCachedCloudToken();
    if (cached) tokenPromise = Promise.resolve(cached);
    else if (isDbx) tokenPromise = dbx.getTokenSilent().catch(function () { return null; });
    else {
      // On iOS standalone this REDIRECTS and the promise never
      // settles. The dispatcher can only route on the OAuth action, and "list"
      // is shared with "Voir mes sauvegardes" — so without a marker the user
      // tapped "Vérifier les sauvegardes cloud", left for Google, and came back
      // to the BACKUPS LIST, with the check never having run. Same disambiguation
      // as the sync diagnostic.
      lsSet(CLOUD_CHECK_PENDING_KEY, String(Date.now()));
      tokenPromise = gdriveGetToken("list") as Promise<string | null>;
    }
    tokenPromise
      .then(function (tk) {
        lsRemove(CLOUD_CHECK_PENDING_KEY);
        if (!tk) throw new Error(t("err_drive_expired"));
        // The dismissed markers are cleared HERE, not before the
        // token fetch. They used to be wiped first, so an iOS redirect that
        // never came back (or a failed token) left the user with no markers AND
        // no check — a previously-silenced backup could then re-nag with nothing
        // having been verified. Clearing is part of the check, so it belongs
        // with the check.
        try {
          clearCloudDismissed(isDbx);   // Per-provider
        } catch (_e) {}
        return cloud.list(tk, {
          fields: SYNC_DIAG_FIELDS,
          orderBy: "modifiedTime+desc",
        });
      })
      .then(function (r: any) { return r.json(); })
      .then(function (list: any) {
        if (!list || list.error) throw new Error((list && list.error && list.error.message) || "list failed");
        var files = list.files || [];
        // Per-provider last-save reference (see launch check).
        // No global fallback — see the launch-check rationale.
        // Cloud-save ts only (see cloudGuardLocalRef).
        var localRef = cloudGuardLocalRef(isDbx);
        // dismissed markers were cleared above — pass 0 / null so any
        // legitimately-newer cloud backup surfaces. Still skip
        // THIS device's own stamped auto file.
        var hit = findNewerCloudBackup(files, localRef, 0, 120000, null,
          stableDeviceIdForGuard(), ownStampedSince());
        if (hit) {
          setCloudNewerBackup({
            id: hit.id,
            name: hit.name,
            modifiedTime: hit.modifiedTime,
            ts: hit.ts,
            counts: parseBackupCounts(hit.name),
          });
        }
        // Always report in place — a hit ALSO gets the panel, because the
        // restore banner is fixed to the top of the screen and says nothing
        // about what else is up there.
        setSyncDiag(buildSyncDiag(files));
        setSyncDiagBusy(false);
      })
      .catch(function (e: any) {
        setSyncDiagErr(String((e && e.message) || e).substring(0, 150));
        setSyncDiagBusy(false);
      });
  }
  // Read-only multi-device diagnostic. Lists the cloud files
  // and explains, per file, whether the launch banner would propose or
  // ignore it and WHY. Unlike checkCloudNewerNow it does NOT clear the
  // dismissed markers — it reports the CURRENT state (so a "muted by seen
  // marker" file is shown as such). Powers Settings → Diagnostic sync.
  var _syncDiag = useState<{
    deviceId: string; deviceName: string; provider: string; localRef: number; localEdited: number;
    dismissedTs: number; dismissedName: string | null; rows: CloudBackupDiag[];
    devices: CloudDeviceSummary[];
  } | null>(null);
  var syncDiag = _syncDiag[0];
  var setSyncDiag = _syncDiag[1];
  var _syncDiagBusy = useState(false);
  var syncDiagBusy = _syncDiagBusy[0];
  var setSyncDiagBusy = _syncDiagBusy[1];
  var _syncDiagErr = useState<string | null>(null);
  var syncDiagErr = _syncDiagErr[0];
  var setSyncDiagErr = _syncDiagErr[1];
  // WHICH button produced the panel — "check" or "diag". Both
  // write the same result, and Settings renders it under whichever one was
  // tapped. Feedback belongs next to its trigger; a single
  // render site would put the answer several rows away from half the taps.
  var _syncDiagSource = useState<"check" | "diag">("diag");
  var syncDiagSource = _syncDiagSource[0];
  var setSyncDiagSource = _syncDiagSource[1];

  // The per-device / per-file explanation, from a file list already
  // in hand. Shared by runSyncDiagnostic and checkCloudNewerNow so the two can
  // NEVER disagree — the diagnostic's whole value is that it mirrors the
  // launch check's filter ladder exactly, and two copies of that mapping is
  // how it would stop doing so.
  function buildSyncDiag(files: any[]) {
    var localRef = cloudGuardLocalRef(isDbx);
    var _dis = readCloudDismissed(isDbx);   // Per-provider
    var dismissedTs = _dis.ts;
    var dismissedName = _dis.name;
    var rows = explainCloudBackups(
      files, localRef, dismissedTs, 120000, dismissedName,
      stableDeviceIdForGuard(), ownStampedSince(),
    );
    return {
      deviceId: getDeviceId(),
      // The user-chosen friendly name for this device (if any).
      deviceName: localStorage.getItem("cave-device-name") || "",
      provider: isDbx ? "dropbox" : "gdrive",
      localRef: localRef,
      // This device's most recent DATA edit (max updatedAt),
      // distinct from the last cloud-save time above.
      localEdited: latestEditMs(data),
      dismissedTs: dismissedTs,
      dismissedName: dismissedName,
      rows: rows,
      // Per-device roll-up (newest save + count per device).
      devices: summariseCloudDevices(rows, getDeviceId()),
    };
  }
  // Clear the sync-diagnostic result + error so the Settings
  // button can act as a toggle (tap to open, tap to close) — mirrors the
  // "Voir mes sauvegardes" panel. Without a clear path the read-only panel
  // stayed open forever (each tap merely re-ran the diagnostic).
  function dismissSyncDiag() {
    setSyncDiag(null);
    setSyncDiagErr(null);
  }
  function runSyncDiagnostic(preTk?: string) {
    setSyncDiagBusy(true);
    setSyncDiagErr(null);
    setSyncDiagSource("diag");
    var tokenPromise: Promise<string | null>;
    if (preTk) {
      // Resumed from the iOS OAuth-return dispatcher with a captured token.
      tokenPromise = Promise.resolve(preTk);
    } else {
      var cached = getCachedCloudToken();
      if (cached) tokenPromise = Promise.resolve(cached);
      // `.catch`, not `.then` — a rejection here surfaced the
      // raw English "no refresh token" as « Erreur : no refresh token » in
      // every UI language. Falling to null gives the translated
      // `err_drive_expired` below, which is also the actionable message.
      else if (isDbx) tokenPromise = dbx.getTokenSilent().catch(function () { return null; });
      else {
        // Drive without a cached token → interactive. On iOS standalone this
        // REDIRECTS (the page navigates away, so the promise below never
        // settles). Stamp a fresh flag so the OAuth-return "list" dispatcher
        // re-runs the diagnostic with the captured token instead of opening
        // the "View my backups" panel. Reuses the already-whitelisted "list"
        // action — no new OAuth action to whitelist.
        lsSet("cave-sync-diag-pending", String(Date.now()));
        tokenPromise = gdriveGetToken("list") as Promise<string | null>;
      }
    }
    tokenPromise
      .then(function (tk) {
        // Popup / cached path completed inline — consume the flag so a later
        // "View my backups" return isn't mis-routed to the diagnostic.
        lsRemove("cave-sync-diag-pending");
        if (!tk) throw new Error(t("err_drive_expired"));
        return cloud.list(tk, { fields: SYNC_DIAG_FIELDS, orderBy: "modifiedTime+desc" });
      })
      .then(function (r: any) { return r.json(); })
      .then(function (list: any) {
        if (!list || list.error) throw new Error((list && list.error && list.error.message) || "list failed");
        // No global fallback — the diagnostic must mirror the
        // launch check's per-provider reference exactly (see rationale there).
        // Cloud-save ts only (see cloudGuardLocalRef).
        // That mirroring now lives in the shared buildSyncDiag.
        setSyncDiag(buildSyncDiag(list.files || []));
        setSyncDiagBusy(false);
      })
      .catch(function (e: any) {
        setSyncDiagErr(String((e && e.message) || e).substring(0, 150));
        setSyncDiagBusy(false);
      });
  }
  // User tapped × on the banner: remember the dismissed backup's NAME so
  // only a different cloud save can resurface the banner.
  //
  // Switched from ts to name. A device with clock skew >
  // 2 min (margin) was producing two failure modes against the previous
  // ts-based marker: (a) banner spam in a loop after every save (skewed
  // device's local-save ts < cloud ts < device's "now"), (b) silent
  // overwrites when a device in advance treated its skewed local ts as
  // newer than any cloud copy. The backup name is unique-per-save
  // (timestamp granularity to the second + counts), so dedup by name is
  // skew-agnostic. Also stamp the ts as a secondary marker for legacy
  // installs migrating from build < 25.
  function dismissCloudNewerBackup() {
    setCloudNewerBackup(function (prev: any) {
      if (prev) {
        try {
          writeCloudDismissed(isDbx, prev.ts, String(prev.name || ""));
        } catch (_e) {}
      }
      return null;
    });
  }
  // User committed to a restore from the picker: same marker semantics
  // (they've seen and acted on the newer backup — stop nagging).
  // Multi-device regression fix. Records the ts + NAME of
  // the backup that was actually acknowledged/restored, so
  // findNewerCloudBackup only mutes THAT file (by name) and files
  // at-or-older-than it (by ts). Pass the restored file's info from the
  // picker; the Home banner path falls back to `cloudNewerBackup`.
  //
  // The bug this fixes: the old code wrote `Date.now()` (the wall-clock
  // restore moment) as the ts floor. Since every existing cloud file's
  // modifiedTime is necessarily OLDER than "now", restoring ONE backup
  // muted EVERY OTHER device's backup present at that moment — including a
  // SECOND device's genuinely-newer-than-this-device backup. The launch
  // banner then stayed silent (only the manual "check cloud backups", which
  // clears the markers, surfaced it). Never write Date.now() here.
  function ackCloudNewerBackup(ackedTs?: number, ackedName?: string) {
    try {
      var prev = (cloudNewerBackup as any);
      var ts = (typeof ackedTs === "number" && ackedTs > 0)
        ? ackedTs
        : (prev && typeof prev.ts === "number" ? prev.ts : 0);
      var name = ackedName || (prev && prev.name) || "";
      // The by-name marker is the primary skew-proof dedup; write it whenever
      // we know the file. The ts floor is secondary — only write a real
      // file ts, never the restore wall-clock.
      writeCloudDismissed(isDbx, ts, String(name || ""));
    } catch (_e) {}
    setCloudNewerBackup(null);
  }
  // One-tap restore from the Home banner. Skips the
  // full Settings → Restore → Picker chain — the user has already
  // committed to this specific backup by tapping "Restaurer".
  // The Replace / Merge / Cancel picker still appears at the end (via
  // stageImport) so the destructive default is never silent.
  // Extracted from restoreCloudNewerBackup so the iOS
  // OAuth-return dispatcher can resume the SAME flow with a token it
  // captured post-redirect — without depending on cloudNewerBackup
  // state (which is null at app-mount and only set ~4.5s later by the
  // launch check). The function takes the file id explicitly, so the
  // pre-redirect persistence in localStorage drives the resumed call.
  // Latent-bug fix: the acked file's ts + name are now passed
  // EXPLICITLY. On the iOS OAuth-return path the app has just remounted, so
  // `cloudNewerBackup` state is null (the launch check repopulates it ~4.5s
  // later) — the old no-args `ackCloudNewerBackup()` fell back to that null
  // state, wrote NO dismissed markers, and the just-restored backup could
  // re-nag on the next launch. Callers thread the file metadata through
  // (direct paths from banner state; redirect path via the persisted
  // `cave-cloud-newer-pending-ack` payload read back by the dispatcher).
  function _executeCloudNewerRestore(tk: string, fileId: string, ackTs?: number, ackName?: string) {
    setCloudRestoreBusy(true);
    setGdriveStatus(t("st_downloading"));
    function finishBusy() { setCloudRestoreBusy(false); }
    cloud.download(tk, fileId, 180000)
      .then(function (r: any) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (txt: string) { return maybeDecryptText(txt); })
      .then(function (jsonText: string | null) {
        if (jsonText === null) {
          setGdriveStatus(t("enc_err_decrypt"));
          scheduleStatusClear(4000);
          finishBusy();
          return;
        }
        var d: any;
        try { d = JSON.parse(jsonText); }
        // eslint-disable-next-line preserve-caught-error -- TS target predates Error(cause).
        catch (_parseErr) { throw new Error(t("alert_invalid_file")); }
        if (d.error || !isPlausibleBackup(d)) throw new Error(t("alert_invalid_file"));
        setGdriveStatus(null);
        ackCloudNewerBackup(ackTs, ackName);
        // The banner's « Restaurer » goes through the
        // Replace/Merge PICKER now, on the user's decision.
        //
        // It used to pass `{ autoApply: "replace" }`, the app's only such call
        // site, on the reasoning recorded in `useImportConfirm`: "the picker
        // would just add an extra confirm step with no useful choice — there's
        // no other reasonable interpretation". There IS another one, MERGE,
        // and this is exactly where it matters: `findNewerCloudBackup`
        // compares the cloud file against this device's last CLOUD SAVE, not
        // its last local edit, so the banner appears precisely when there is
        // unsynced local work — which a replace destroys with no diff and no
        // undo. The banner's TEXT was made honest about that first; this makes
        // the action answerable.
        //
        // `setImportModal(true)` is REQUIRED, not decoration: the picker is
        // rendered by `SettingsModal`, which `CuratorApp` only mounts while
        // `importModal` is set — so staging without opening it would leave the
        // import pending with NOTHING on screen, a worse defect than the one
        // being fixed. Verified in CuratorApp's mount gate.
        setImportModal(true);
        stageImport(d, "drive");
        finishBusy();
      })
      .catch(function (e: any) {
        setGdriveStatus(t("err_prefix") + ": " + String((e && e.message) || e).substring(0, 150));
        scheduleStatusClear(5000);
        finishBusy();
      });
  }

  function restoreCloudNewerBackup() {
    var hit = cloudNewerBackup;
    if (!hit || !hit.id) return;
    // Hard re-entrancy guard. The banner button once
    // had no visible busy state, so the user often tapped two or three
    // times thinking nothing was happening — each tap kicked off a
    // parallel restore. Bail straight away if one's already in flight.
    if (cloudRestoreBusy) return;
    var fileId = hit.id;
    var ackTs: number | undefined = typeof (hit as any).ts === "number" ? (hit as any).ts : undefined;
    var ackName: string | undefined = (hit as any).name || undefined;
    // Try the cached token first — on desktop + Android (popup) and
    // when iOS still has a valid token the restore fires immediately.
    var cached = getCachedCloudToken();
    if (cached) {
      _executeCloudNewerRestore(cached, fileId, ackTs, ackName);
      return;
    }
    // No cached token. On iOS standalone Drive that means a REDIRECT
    // is about to fire — the page navigates away, the Promise from
    // gdriveGetToken never resolves on this side. Persist the fileId
    // so the post-OAuth dispatcher (using the new "restore-cnb"
    // action) can resume the direct restore by id, without going
    // through the full backup picker (which is what the old
    // "restore" action triggers).
    // Also persist the acked file's ts + name — the dispatcher
    // resumes on a fresh mount where `cloudNewerBackup` state is null, so
    // without this payload ackCloudNewerBackup wrote no dismissed markers
    // and the restored backup re-nagged on the next launch.
    try {
      lsSet("cave-cloud-newer-pending-id", fileId);
      lsSet("cave-cloud-newer-pending-ack",
        JSON.stringify({ ts: ackTs || 0, name: ackName || "" }));
    } catch (_e) {}
    setCloudRestoreBusy(true);
    setGdriveStatus(t("st_downloading"));
    var tokenPromise: Promise<string | null>;
    if (isDbx) tokenPromise = dbx.getToken("restore-cnb") as Promise<string | null>;
    else tokenPromise = gdriveGetToken("restore-cnb") as Promise<string | null>;
    tokenPromise
      .then(function (tk) {
        // On iOS, this branch never runs — the page redirected before
        // the Promise could resolve, and the dispatcher takes over on
        // return. On desktop popup the Promise resolves cleanly.
        if (!tk) throw new Error(t("err_drive_expired"));
        try {
          lsRemove("cave-cloud-newer-pending-id");
          lsRemove("cave-cloud-newer-pending-ack");
        } catch (_e) {}
        _executeCloudNewerRestore(tk, fileId, ackTs, ackName);
      })
      .catch(function (e: any) {
        try {
          lsRemove("cave-cloud-newer-pending-id");
          lsRemove("cave-cloud-newer-pending-ack");
        } catch (_e) {}
        setGdriveStatus(t("err_prefix") + ": " + String((e && e.message) || e).substring(0, 150));
        scheduleStatusClear(5000);
        setCloudRestoreBusy(false);
      });
  }

  // Optional Drive backup encryption (Phase 1).
  // Wraps the JSON in an AES-GCM envelope before upload IF the user
  // opted in. Returns the plaintext untouched otherwise — so the upload
  // path stays a single code path.
  //
  // Passphrase precedence:
  //   1. cached in memory (drivePassphrase prop)
  //   2. prompted via requestDrivePassphrase("unlock") — modal blocks
  //      until the user enters one or cancels
  //   3. user cancelled → throw so the calling Promise rejects and the
  //      caller surfaces the error to the user
  function maybeEncryptPayload(plaintext: string): Promise<string> {
    if (!driveEncryptionEnabled) return Promise.resolve(plaintext);
    var existing = drivePassphrase || null;
    var pwPromise: Promise<string | null> = existing
      ? Promise.resolve(existing)
      : (requestDrivePassphrase ? requestDrivePassphrase("unlock") : Promise.resolve(null));
    return pwPromise.then(function (pw) {
      if (!pw) throw new Error(t("enc_err_cancelled"));
      // If the passphrase was just PROMPTED (not cached) and
      // a setup-time verifier exists, reject a mismatch — a typo here would
      // otherwise silently encrypt this backup under a passphrase the user
      // doesn't know (permanently unrecoverable). Legacy installs with no
      // verifier keep the old lenient behaviour.
      var marker: string | null = null;
      if (!existing) { try { marker = localStorage.getItem("cave-drive-enc-verifier"); } catch (_e) {} }
      if (marker) {
        return verifyPassphrase(marker, pw).then(function (okPw) {
          if (!okPw) throw new Error(t("enc_err_wrong_passphrase"));
          if (setDrivePassphrase) setDrivePassphrase(pw);
          return encryptBackup(plaintext, pw);
        });
      }
      // Cache for subsequent saves in the same session.
      if (!existing && setDrivePassphrase) setDrivePassphrase(pw);
      return encryptBackup(plaintext, pw);
    });
  }

  // Mirror of maybeEncryptPayload for the AUTO-save path (gdriveSaveQuiet).
  // Difference: never prompts. If encryption is on but the passphrase
  // isn't cached, the auto-save is skipped (returns null), the next
  // manual save will prompt and recover. This avoids surprising the
  // user with an auto-popup in the middle of editing.
  function maybeEncryptQuiet(plaintext: string): string | null {
    if (!driveEncryptionEnabled) return plaintext;
    if (!drivePassphrase) return null;
    // The encryption is async but we return a sync result for this
    // helper signature — caller is expected to await encryptBackup
    // separately when the synchronous null check passes.
    return drivePassphrase;
  }
  // Auto-save async variant: returns a Promise<string|null>. Null
  // means "skip the auto-save, encryption is on but locked".
  function maybeEncryptPayloadQuiet(plaintext: string): Promise<string | null> {
    var pw = maybeEncryptQuiet(plaintext);
    if (pw === null) return Promise.resolve(null);
    if (pw === plaintext) return Promise.resolve(plaintext);
    return encryptBackup(plaintext, pw);
  }

  // Matching decrypt helper for the restore path. Detects an
  // encrypted envelope, prompts for passphrase if needed, returns the
  // decrypted JSON text. Returns null if the user cancels or decryption
  // fails — caller is responsible for aborting the restore silently.
  // Plaintext backups (envelope absent) pass through unchanged so old
  // saves stay restorable forever.
  function maybeDecryptText(txt: string): Promise<string | null> {
    if (!isEncryptedEnvelopeJSON(txt)) return Promise.resolve(txt);
    var existing = drivePassphrase || null;
    var pwPromise: Promise<string | null> = existing
      ? Promise.resolve(existing)
      : (requestDrivePassphrase ? requestDrivePassphrase("unlock") : Promise.resolve(null));
    return pwPromise.then(function (pw) {
      if (!pw) return null;
      return decryptBackup(txt, pw).then(function (plain) {
        if (!existing && setDrivePassphrase) setDrivePassphrase(pw);
        // A successful decrypt PROVES `pw` is
        // the correct passphrase. Backfill the verifier for legacy
        // encryption users who never got one at setup, so a later typo can't
        // silently mint an unrecoverable backup (the exact risk the verifier
        // closes). Only when encryption is on + no verifier exists yet;
        // best-effort, never blocks the restore.
        if (driveEncryptionEnabled) {
          var hasVerifier = false;
          try { hasVerifier = !!localStorage.getItem("cave-drive-enc-verifier"); } catch (_e) { /* noop */ }
          if (!hasVerifier) {
            makeEncryptionVerifier(pw)
              .then(function (m) { lsSet("cave-drive-enc-verifier", m); })
              .catch(function () { /* noop */ });
          }
        }
        return plain;
      }).catch(function (e) {
        // Wrong passphrase / tampered ciphertext: forget the bad
        // passphrase if it was the cached one, so the next attempt
        // re-prompts.
        if (existing && setDrivePassphrase) setDrivePassphrase(null);
        throw new Error(t("enc_err_decrypt") + " (" + String((e && e.message) || e).slice(0, 80) + ")");
      });
    });
  }

  // Enforce per-type rotation. Pass the listing of existing files (the same
  // payload we used to look up the cached fid), the type we just wrote, and
  // how many of THAT type to keep (typically cap - 1, since the new file
  // isn't in `files` yet — it was just POSTed). Sorted by createdTime desc.
  // Deletes are fire-and-forget; a failure leaves the quota slightly above
  // the cap but the next save will catch up.
  // PruneByType moved to src/utils/gdriveApi.ts (no closure
  // over hook state — token is an explicit argument).
  // PendingOAuth capture + gesture listener moved to
  // useGdriveAuth. The dispatcher effect below consumes
  // auth.pendingOAuth and stays here (it calls sync-domain fns).
  useEffect(
    function () {
      if (!pendingOAuth || !data) return;
      // Do NOT consume the OAuth return until the
      // real cellar has loaded. `data` is INIT (empty but
      // truthy) during cold start, so a redirect that lands before load()
      // resolves would run gdriveSave/gdriveSaveQuiet against the empty INIT
      // closure and OVERWRITE the cloud backup with nothing. `loading===false`
      // is the "load() finished" signal; leave pendingOAuth set so this
      // effect re-fires (deps include `loading`) once the data is real.
      if (loading) return;
      var tk = pendingOAuth.tk,
        ac = pendingOAuth.ac;
      setPendingOAuth(null);
      // Persist the token for the "reconnect" action explicitly —
      // gdriveSave / gdriveRestore call tkSet themselves later in
      // their own bodies, but a pure reconnect just
      // refreshes the OAuth token without performing any
      // subsequent Drive operation.
      if (ac === "reconnect") {
        driveTokenRef.current = tk;
        try {
          tkSet(JSON.stringify({ t: tk, x: Date.now() + 3500000 }));
        } catch (_e) {}
        // Defensively wipe the legacy escalation
        // cookie if it lingers from a previous install — harmless either
        // way, but keeps localStorage clean.
        try {
          // eslint-disable-next-line tabac-local/no-raw-storage-write -- OAuth/token key keeps its dedicated guarded path (read-before-clear)
          localStorage.removeItem("gdrive-reconnect-ts");
        } catch (_e) {}
        recordOAuthEvent("token-stored", "reconnect");
        return;
      }
      // The CATALOGUE stream, resumed after an iOS redirect. Its own actions
      // rather than a marker on a cellar one: see OAUTH_ACTIONS in
      // oauthReturn.ts. Placed before every cellar branch so no fall-through
      // can reach `gdriveSave` / `runSyncDiagnostic` with a catalogue intent.
      if (ac === "cat-save" || ac === "cat-restore") {
        driveTokenRef.current = tk;
        try {
          tkSet(JSON.stringify({ t: tk, x: Date.now() + 3500000 }));
        } catch (_e) {}
        recordOAuthEvent("token-stored", ac);
        if (ac === "cat-save") catalogueCloudSave(tk);
        else catalogueCloudRestore(tk);
        return;
      }
      if (ac === "autosave") {
        // The iOS auto-save workaround. Token came back from
        // the silent (no-prompt) redirect triggered by a form-save tap
        // — persist it and kick off the deferred auto-save. NO modal,
        // NO status banner: the user just saved their form, the Drive
        // sync happens in the background.
        // Defensive null-token guard. If Google bounced
        // back without a valid access_token (silent flow needed UI,
        // state mismatch, network blip…), tk arrives as null/empty.
        // Persisting `{t:null,x:future}` would poison the cache so the
        // next save can't even attempt a fresh OAuth — bail cleanly so
        // the user's NEXT save retries the round-trip from scratch.
        if (typeof tk !== "string" || !tk) {
          return;
        }
        driveTokenRef.current = tk;
        try {
          tkSet(JSON.stringify({ t: tk, x: Date.now() + 3500000 }));
        } catch (_e) {}
        recordOAuthEvent("token-stored", "autosave");
        // gdriveSaveQuiet self-guards on cave-autosave === "1"; even if
        // the user toggled auto-save off between the redirect and the
        // return, this is a no-op.
        gdriveSaveQuiet();
        return;
      }
      if (ac === "list") {
        // "View my backups" round-trip on iOS. Persist the token and
        // run the metadata fetch — we explicitly DO NOT trigger the
        // restore picker (that's what the user dodged by tapping
        // "View my backups" instead of "Restore Drive").
        driveTokenRef.current = tk;
        try {
          tkSet(JSON.stringify({ t: tk, x: Date.now() + 3500000 }));
        } catch (_e) {}
        // The "list" redirect may have been issued by the
        // sync diagnostic (iOS Drive, no cached token) rather than "View my
        // backups". A fresh flag disambiguates — resume the diagnostic with
        // the captured token instead of opening the backups panel.
        // FOUR buttons can now issue a "list" redirect —
        // "Voir mes sauvegardes", the sync diagnostic, "Vérifier les
        // sauvegardes cloud" and deleting one backup. The action alone cannot
        // tell them apart, so each of the three non-default ones leaves a fresh
        // one-shot marker. Read-before-clear on every one (the invariant the
        // `no-storage-read-after-remove` rule exists for), and the DELETE is
        // checked first: it is the only one that mutates, so a stale-by-a-
        // millisecond ordering must never let a read path swallow it.
        var delPend: string | null = null;
        try {
          delPend = localStorage.getItem(BACKUP_DELETE_PENDING_KEY);
          if (delPend) lsRemove(BACKUP_DELETE_PENDING_KEY);
        } catch (_e) {}
        var delJob = delPend ? safeJsonParse<any>(delPend, null) : null;
        if (delJob && delJob.id && Date.now() - (delJob.ts || 0) < PENDING_RESUME_MAX_MS) {
          // The user tapped 🗑 and confirmed BEFORE the redirect, so resuming is
          // honouring an explicit intent — bounded by a single file id and by
          // freshness. This used to arrive under `ac === "restore"` and opened
          // the destructive restore picker instead.
          setGdriveStatus(t("st_connecting"));
          gdriveDeleteBackupById(String(delJob.id))
            .then(function () { setGdriveStatus(null); })
            .catch(function (e: any) {
              setGdriveStatus(t("err_prefix") + ": " + String((e && e.message) || e).substring(0, 150));
              scheduleStatusClear(4000);
            });
          return;
        }
        var checkPend: string | null = null;
        try {
          checkPend = localStorage.getItem(CLOUD_CHECK_PENDING_KEY);
          if (checkPend) lsRemove(CLOUD_CHECK_PENDING_KEY);
        } catch (_e) {}
        if (checkPend && Date.now() - (parseInt(checkPend, 10) || 0) < PENDING_RESUME_MAX_MS) {
          checkCloudNewerNow(tk);
          return;
        }
        var diagPend: string | null = null;
        try {
          diagPend = localStorage.getItem("cave-sync-diag-pending");
          if (diagPend) lsRemove("cave-sync-diag-pending");
        } catch (_e) {}
        if (diagPend && Date.now() - (parseInt(diagPend, 10) || 0) < PENDING_RESUME_MAX_MS) {
          runSyncDiagnostic(tk);
          return;
        }
        // The "list" action had two possible panels behind it and now has
        // one: "Voir mes sauvegardes" and the multi-device diagnostic were
        // merged, so every resumption of this action lands on the same view.
        runSyncDiagnostic(tk);
        return;
      }
      // Banner-driven restore-by-id. The user tapped
      // "Restaurer" on the cloud-newer banner, no token was cached,
      // gdriveGetToken("restore-cnb") issued a redirect — we're now
      // back with a token. Pull the persisted file id and resume
      // the direct restore (NO picker). Falls through to the picker
      // if the id is missing (defensive — shouldn't happen).
      if (ac === "restore-cnb") {
        driveTokenRef.current = tk;
        try {
          tkSet(JSON.stringify({ t: tk, x: Date.now() + 3500000 }));
        } catch (_e) {}
        var pendingCnbId: string | null = null;
        var pendingCnbAckTs: number | undefined;
        var pendingCnbAckName: string | undefined;
        try {
          pendingCnbId = localStorage.getItem("cave-cloud-newer-pending-id");
          // Read the acked file's ts + name persisted pre-redirect
          // (read-before-clear) — cloudNewerBackup state is null on this
          // fresh mount, so this payload is the only source for the
          // dismissed markers ackCloudNewerBackup must write post-restore.
          var _ackRaw = localStorage.getItem("cave-cloud-newer-pending-ack");
          if (_ackRaw) {
            // SafeJsonParse (null fallback) so a corrupt marker
            // doesn't throw past the lsRemove cleanup below — the pending
            // markers then still get wiped and self-heal on the next launch.
            var _ack = safeJsonParse(_ackRaw, null) as any;
            if (_ack && typeof _ack.ts === "number" && _ack.ts > 0) pendingCnbAckTs = _ack.ts;
            if (_ack && _ack.name) pendingCnbAckName = String(_ack.name);
          }
          lsRemove("cave-cloud-newer-pending-id");
          lsRemove("cave-cloud-newer-pending-ack");
        } catch (_e) {}
        if (pendingCnbId) {
          setTimeout(function () {
            _executeCloudNewerRestore(tk, pendingCnbId as string, pendingCnbAckTs, pendingCnbAckName);
          }, IS_IOS_STANDALONE ? 700 : 0);
          return;
        }
        // Defensive fallback: no id persisted → behave like the legacy
        // "restore" action so the user still ends up somewhere useful.
      }
      setTimeout(
        function () {
          if (ac === "save") gdriveSave(tk);
          else if (ac === "restore" || ac === "restore-cnb") gdriveRestore(tk);
        },
        IS_IOS_STANDALONE ? 700 : 0,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingOAuth, data, loading],
  );

  // Dropbox OAuth-return dispatcher. The auth hook has
  // already exchanged the code and cached both tokens by the time
  // pendingDropbox is set — getCloudToken resolves from cache, so the
  // standard entry points are called WITHOUT a preToken.
  useEffect(
    function () {
      if (!dbx.pendingDropbox || !data) return;
      // Provider parity with the Google dispatcher —
      // don't consume the OAuth return (which can fire save/autosave) until
      // the real cellar has loaded, else the INIT closure overwrites the
      // cloud with an empty cellar. Leave pendingDropbox set so this re-fires
      // once loading flips false (deps include `loading`).
      if (loading) return;
      var ac = dbx.pendingDropbox.ac;
      dbx.setPendingDropbox(null);
      if (!isDbx) return; // user flipped back to Drive mid-redirect — drop it
      if (ac === "reconnect" || ac === "autosave") {
        // Token is stored; autosave additionally kicks the quiet save.
        if (ac === "autosave") gdriveSaveQuiet();
        return;
      }
      // Kept in lock-step with the Google dispatcher. A Dropbox refresh-token
      // grant rarely redirects, so this branch is the edge case where the
      // refresh token had expired — but a catalogue button must not resume as
      // a cellar operation on EITHER provider.
      if (ac === "cat-save" || ac === "cat-restore") {
        if (ac === "cat-save") catalogueCloudSave();
        else catalogueCloudRestore();
        return;
      }
      if (ac === "list") {
        runSyncDiagnostic();
        return;
      }
      // Banner-driven restore-by-id (Dropbox parity with
      // Google). In practice Dropbox refresh-token grants don't redirect
      // so this branch rarely fires — but keep it in lock-step with the
      // Google dispatcher for the edge case where the refresh token
      // expired and the user had to re-auth via the full OAuth round.
      if (ac === "restore-cnb") {
        var pendingCnbIdDbx: string | null = null;
        var pendingCnbAckTsDbx: number | undefined;
        var pendingCnbAckNameDbx: string | undefined;
        try {
          pendingCnbIdDbx = localStorage.getItem("cave-cloud-newer-pending-id");
          // See the Google branch — same ack payload, same
          // read-before-clear.
          var _ackRawDbx = localStorage.getItem("cave-cloud-newer-pending-ack");
          if (_ackRawDbx) {
            // See the Google branch — safeJsonParse so a corrupt
            // marker still gets cleaned up below instead of throwing past it.
            var _ackDbx = safeJsonParse(_ackRawDbx, null) as any;
            if (_ackDbx && typeof _ackDbx.ts === "number" && _ackDbx.ts > 0) pendingCnbAckTsDbx = _ackDbx.ts;
            if (_ackDbx && _ackDbx.name) pendingCnbAckNameDbx = String(_ackDbx.name);
          }
          lsRemove("cave-cloud-newer-pending-id");
          lsRemove("cave-cloud-newer-pending-ack");
        } catch (_e) {}
        var tk = getCachedCloudToken();
        if (pendingCnbIdDbx && tk) {
          setTimeout(function () {
            _executeCloudNewerRestore(tk as string, pendingCnbIdDbx as string, pendingCnbAckTsDbx, pendingCnbAckNameDbx);
          }, 0);
          return;
        }
        // Defensive fallback: open the picker.
      }
      // save / restore: open Settings (parity with the Google capture
      // path) so the user sees the status line / picker.
      setImportModal(true);
      setTimeout(function () {
        if (ac === "save") gdriveSave();
        else if (ac === "restore" || ac === "restore-cnb") gdriveRestore();
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbx.pendingDropbox, data, loading],
  );

  // Auto-save on pendingSync (Option 3a). Depends on
  // `autoSaveDrive` so toggling OFF during the 3 s timer window
  // re-runs the effect, the cleanup fires, and the pending save is
  // cancelled before it can hit gdriveSaveQuiet.
  useEffect(
    function () {
      if (!data || !pendingSync || !autoSaveDrive)
        return;
      // 1.2 s (was 3 s). The debounce still coalesces a burst of
      // edits into one save (each change resets the timer), but a discrete
      // terminal action — finishing a session / tasting — now uploads ~1.8 s
      // sooner, shrinking the window where iOS suspends the PWA's JS (screen
      // lock / app switch right after "Terminer") before the upload lands.
      var _at = setTimeout(gdriveSaveQuiet, 1200);
      return function () {
        clearTimeout(_at);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, pendingSync, autoSaveDrive],
  );

  // visibilitychange auto-save
  useEffect(
    function () {
      function onHide() {
        if (
          document.hidden &&
          localStorage.getItem("cave-autosave") === "1" &&
          pendingSync
        )
          gdriveSaveQuiet();
      }
      document.addEventListener("visibilitychange", onHide);
      return function () {
        document.removeEventListener("visibilitychange", onHide);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingSync],
  );

  // Startup silent token refresh moved to useGdriveAuth.

  // GdriveGetToken moved to useGdriveAuth.

  // FetchRetry moved to src/utils/gdriveApi.ts.

  // LABEL-CONTRACT:start photos-in-backups — see scripts/label-contracts.json
  function gatherLocalImages(dat: any): any {
    var keys: string[] = [];
    function addK(k: any) {
      if (k && k.indexOf("local-photo-") === 0 && keys.indexOf(k) < 0)
        keys.push(k);
    }
    (dat.tobaccos || []).forEach(function (t: any) {
      addK(t.imageUrl);
    });
    (dat.pipes || []).forEach(function (p: any) {
      addK(p.imageUrl);
      // Additional pipe photos — include their blobs so a backup /
      // restore is self-contained.
      if (p && Array.isArray(p.photos)) p.photos.forEach(addK);
    });
    (dat.wishlist || []).forEach(function (w: any) {
      addK(w.imageUrl);
    });
    (dat.accessories || []).forEach(function (a: any) {
      addK(a.imageUrl);
    });
    // Also include session snapshots. The journal
    // renders via tobaccoSnapshot.imageUrl / pipeSnapshot.imageUrl
    // when the live entity is gone — but if its `local-photo-*` blob
    // isn't in `_imageData` on a fresh-device restore, the snapshot
    // displays a placeholder forever. Walking the snapshots here makes
    // backups self-contained.
    (dat.sessions || []).forEach(function (s: any) {
      if (s && s.tobaccoSnapshot) addK(s.tobaccoSnapshot.imageUrl);
      if (s && s.pipeSnapshot) addK(s.pipeSnapshot.imageUrl);
    });
    if (!keys.length) return Promise.resolve({});
    var result: Record<string, any> = {};
    var pending = keys.length;
    // REJECT when the store gave us nothing at all.
    //
    // Every per-key failure was swallowed and the promise ALWAYS resolved, with
    // whatever subset it managed to read — so `doExport`'s guard, whose own
    // comment says "gatherLocalImages can reject on a broken IndexedDB (private
    // mode, evicted storage) — without this the user believed the export succeeded",
    // could not fire for the failure it names. A device with an unreadable
    // IndexedDB produced a JSON / ZIP / cloud backup with the photos missing,
    // reported success, and called markExported(). The loss only surfaced when
    // that backup was restored on another device.
    //
    // TWO thresholds, and getting them apart is the whole judgement here.
    //
    // A read that RESOLVES EMPTY means the key is not in the store — the photo
    // is already gone (an eviction, or the orphan-GC bug that really did wipe
    // users' blobs). Rejecting on that would stop such a user exporting their
    // CELLAR at all, which is far worse than a backup without photos they no
    // longer have. So it does not count.
    //
    // A read that THROWS means the store itself would not answer. Rejecting only
    // when EVERY read threw is the unambiguous broken-store case,
    // and it leaves a partial read alone: aborting a backup because ONE blob is
    // unreadable would turn a recoverable partial export into no export.
    var errored = 0;
    return new Promise(function (ok, fail) {
      var settle = function () {
        if (pending > 0) return;
        if (errored === keys.length) {
          // A CODE, never prose. `e.message` is rendered to the
          // user (doExport's alert appends it), and the no-prose guard exists
          // because English prose in a thrown Error reaches a French reader
          // verbatim. The caller maps this code to a translated sentence.
          var err: any = new Error("photo-store-unreadable");
          err.failedCount = errored;
          fail(err);
          return;
        }
        ok(result);
      };
      keys.forEach(function (k) {
        imgCache
          .get(k)
          .then(function (b) {
            if (b) result[k] = b;
            pending--;
            settle();
          })
          .catch(function () {
            errored++;
            pending--;
            settle();
          });
      });
    });
  }
  // LABEL-CONTRACT:end photos-in-backups

  function withPhotos(dat: any) {
    return gatherLocalImages(dat).then(function (m: any) {
      if (!Object.keys(m).length) return dat;
      function fix(a: any) {
        return (a || []).map(function (o: any) {
          return o && o.imageUrl && m[o.imageUrl]
            ? Object.assign({}, o, { imageUrl: m[o.imageUrl] })
            : o;
        });
      }
      return Object.assign({}, dat, {
        tobaccos: fix(dat.tobaccos),
        pipes: fix(dat.pipes),
        accessories: fix(dat.accessories),
        wishlist: fix(dat.wishlist),
        // Data-loss fix: `fix` only inlines the COVER `imageUrl` of
        // the four entity kinds. The additional pipe photos (`pipe.photos[]`)
        // and session-snapshot photos are left as bare
        // `local-photo-*` keys with no blob → they render as placeholders after
        // a JSON/ZIP export → import on a fresh device. Attaching the FULL image
        // map here (which walks photos[] + snapshots) makes JSON export + ZIP
        // self-contained, matching what Drive/Dropbox already did via
        // `_imageData`. The import (`_runImport`) already ingests `_imageData`
        // (validated: local-photo- prefix + data-URI + ≤15 MB). The cover blob
        // is redundant with the inlined imageUrl (harmless — orphan-GC'd).
        _imageData: m,
      });
    });
  }

  function gdriveSave(preToken?: any, _retried?: any) {
    setGdriveStatus(t("st_connecting"));
    (typeof preToken === "string"
      ? Promise.resolve(preToken)
      : getCloudToken("save")
    )
      .then(function (token: any) {
        cloudTokenPersist(token as string);
        return cloud.list(token, {
          fields: "files(id,name,createdTime)",
          orderBy: "createdTime+desc",
          retries: 2,
        })
          .then(function (r: any) {
            return r.json();
          })
          .then(function (list: any) {
            if (list.error) {
              if (list.error.code === 401 || list.error.code === 403) {
                cloudTokenInvalidate();
                if (!_retried) throw { __retry__: true };
              }
              throw new Error(list.error.message || "Drive error");
            }
            var existingFiles = list.files || [];
            var bkBase = Object.assign({}, data, {
              _apiKey: excludeApiKey ? "" : apiKey || "",
              // See useImportConfirm._apiKeyProvider.
              _apiKeyProvider: excludeApiKey ? "" : aiProvider || "",
              _savedAt: new Date().toISOString(),
              _saveType: "manual",
              _schemaVersion: SCHEMA_VERSION,
              // Preferences ride along (allowlist — utils/appSettings).
              _settings: collectSettings(),
            });
            // The MANUAL cloud save is attended but it is still the
            // safety net, not an archive file — so it degrades like the auto
            // save rather than aborting: losing the whole backup because the
            // photo store is broken would be the worse outcome.
            //
            // BUT IT MUST SAY SO WHERE THE USER CAN READ IT, and for a long
            // time it did not. The warning was set here and OVERWRITTEN one
            // microtask later by `st_saving`, then by `st_done` — so the user
            // saw « Sauvegarde… » then « ✓ OK », a backup with no
            // `_imageData` went up, and `markExported()` disarmed the
            // "you have not backed up" reminder for 30 days. The comment that
            // used to sit here promised the opposite ("says so in the status
            // line the user is already watching"), which is worse than no
            // comment at all.
            //
            // So the failure is REMEMBERED and reported at the END, where
            // nothing paints over it. The auto path was already correct
            // (`recordAutosaveDiag("photos-unreadable")` persists); it was the
            // ATTENDED path that was silent.
            var _photosUnreadable = false;
            return gatherLocalImages(bkBase).catch(function () {
              _photosUnreadable = true;
              return {};
            }).then(function (imgMap: any) {
              var bk = Object.keys(imgMap as object).length
                ? Object.assign({}, bkBase, { _imageData: imgMap })
                : bkBase;
              var plaintext = JSON.stringify(bk, null, 2);
              // Encrypt the JSON before upload if the user
              // opted in. The passphrase is fetched on-demand: cached
              // in memory across consecutive saves, prompted via the
              // PassphrasePromptModal when missing (post-reload).
              return maybeEncryptPayload(plaintext).then(function (payload) {
                var blob = new Blob([payload], {
                  type: "application/json",
                });
                setGdriveStatus(t("st_saving"));
                // Freeze the persisted snapshot reference
                // so the success path can detect an edit that lands DURING
                // this upload (mirrors the quiet-save re-check).
                var _manualRawSnap: string | null = null;
                try { _manualRawSnap = localStorage.getItem(SK); } catch (_e) {}
                // Multipart construction + 60s upload timeout
                // live in the provider now.
                return cloud.uploadNew(token, makeBackupName(data, "manual", undefined, getDeviceName()), blob)
                .then(function (r) {
                  return r.json();
                })
                .then(function (f) {
                  if (f.error) {
                    if (f.error.code === 401 || f.error.code === 403) {
                      cloudTokenInvalidate();
                      if (!_retried) throw { __retry__: true };
                    }
                    throw new Error(f.error.message);
                  }
                  if (f.id) lsSet(FID_KEY, f.id);
                  var _ts = Date.now();
                  setLastAutoSaveTs(_ts);
                  lsSet("cave-autosave-ts", String(_ts));
                  lsSet("cave-autosave-ts-" + (isDbx ? "dropbox" : "gdrive"), String(_ts));
                  // Record that the last save on this provider was
                  // MANUAL so Settings can label the "last save" line
                  // correctly (auto vs manual). Per-provider, read in render.
                  lsSet("cave-last-save-type-" + (isDbx ? "dropbox" : "gdrive"), "manual");
                  // Only declare "synced" if the data hasn't
                  // moved since we froze the upload payload. An edit that landed
                  // mid-upload leaves the cloud holding the stale snapshot — keep
                  // the dirty flag and let the auto-save effect (or the next
                  // manual save) flush the newer state.
                  var _stillCurrentManual;
                  try { _stillCurrentManual = localStorage.getItem(SK) === _manualRawSnap; } catch (_e) { _stillCurrentManual = true; }
                  if (_stillCurrentManual) {
                    setPendingSync(false);
                    lsRemove("cave-pending-sync");
                  }
                  if (markExported) markExported();
                  // The cellar DID reach the cloud, so the reminder is
                  // legitimately disarmed — but a bare ✓ would let the user
                  // believe their photos went with it. Longer on screen than
                  // a plain success, like every other degraded message here.
                  if (_photosUnreadable) {
                    setGdriveStatus(t ? t("err_photos_unreadable") : "Sauvegarde faite, mais les photos n'ont pas pu être lues.");
                    scheduleStatusClear(6000);
                  } else {
                    setGdriveStatus(t("st_done"));
                    scheduleStatusClear(3000);
                  }
                  // Prune to GDRIVE_MAX_MANUAL manual files total (including
                  // the one we just wrote). pruneByType also
                  // deletes sequentially (Dropbox 429 on concurrent
                  // writes — see its definition).
                  var _pruneManual = pruneByType(existingFiles, "manual", GDRIVE_MAX_MANUAL - 1, token, cloud.remove);
                  // Also converge THIS device's auto files
                  // to one. A manual save is the deterministic, token-fresh,
                  // every-platform "tidy up now" action — on iOS the silent
                  // auto-save often can't refresh an expired token, so this
                  // is the user's reliable way to collapse a straggler pile
                  // (the user-reported 14 auto files). We keep this device's
                  // newest own/legacy auto file and sweep the rest; foreign
                  // devices' stamped auto files are left intact.
                  var _autoFiles = existingFiles.filter(function (f: any) {
                    return classifyBackup(f.name) === "auto";
                  });
                  var _myDeviceId = getDeviceId();
                  // existingFiles is ordered createdTime+desc, so the kept
                  // file is this device's newest own/legacy auto (via the
                  // pure helper, once inline here).
                  var _keepAuto = pickKeepAuto(_autoFiles, _myDeviceId);
                  // Run the manual prune AND the auto sweep
                  // SEQUENTIALLY (manual deletes first, then autos) and
                  // RETURN the combined promise so the whole cleanup is
                  // serialised — no two delete batches race on Dropbox's
                  // per-namespace write lock.
                  // Review fix (concern #4): if a quiet auto-save is mid-flight
                  // (fresh cross-tab lock), SKIP the auto-straggler sweep — it
                  // owns auto convergence; running our sweep from this (now
                  // possibly stale) listing could delete/keep a different auto
                  // file than the one it's tracking. The manual POST + manual
                  // prune still run; the autos converge on the next quiet save.
                  var _qLk = 0;
                  try { _qLk = parseInt(localStorage.getItem("cave-autosave-lock") || "0", 10) || 0; } catch (_e) {}
                  var _quietBusy = _qLk && (Date.now() - _qLk) < 12000;
                  return Promise.resolve(_pruneManual).then(function () {
                    if (_quietBusy) return;
                    return sweepOwnAutoStragglers(cloud, token, _autoFiles, _myDeviceId, _keepAuto);
                  });
                });
              });
            });
          });
      })
      .catch(function (e) {
        if (e && e.__retry__) {
          gdriveSave(null, true);
          return;
        }
        setGdriveStatus(
          t("err_prefix") + ": " + String(e.message || e).substring(0, 150),
        );
        scheduleStatusClear(5000);
      });
  }

  // `gdriveManageBackups` — the sibling that opened this same picker in a
  // "delete" mode — was REMOVED, and with it the whole `mode` parameter.
  //
  // It lost its entry point when « Voir mes sauvegardes » and the multi-device
  // diagnostic were merged into ONE panel: the merged panel has its own
  // per-row bin (`gdriveDeleteBackupById`), so nothing called this any more.
  // Nothing in the hook called it either, and the OAuth `"list"` return branch
  // resolves to `runSyncDiagnostic` on BOTH providers — so `mode: "delete"`
  // had exactly one producer, that producer had zero callers, and every
  // `isDeleteMode` branch in the picker was unreachable. `gdriveDeleteOption`,
  // reachable only from inside those branches, went with it.
  //
  // It read as live because its own unit test called it, the same blind spot
  // that kept `tobaccoHasTag` and `OrnRule` alive: knip counts a test file as
  // a consumer.
  function gdriveRestore(preToken?: any, _retried?: any) {
    _gdriveListBackups(preToken, _retried);
  }

  function _gdriveListBackups(
    preToken?: any,
    _retried?: any,
  ) {
    setGdriveStatus(t("st_connecting"));
    (typeof preToken === "string"
      ? Promise.resolve(preToken)
      : getCloudToken("restore")
    )
      .then(function (token: any) {
        cloudTokenPersist(token as string);
        return cloud.list(token, {
          fields: "files(id,name,modifiedTime)",
          orderBy: "createdTime+desc",
          retries: 2,
        })
          .then(function (r: any) {
            return r.json();
          })
          .then(function (list: any) {
            if (list.error) {
              if (list.error.code === 401 || list.error.code === 403) {
                cloudTokenInvalidate();
                if (!_retried) throw { __retry__: true };
              }
              throw new Error(list.error.message || "Drive error");
            }
            // The CATALOGUE stream is not a cellar backup.
            // Offering it here would put a CSV in the "restore a backup"
            // picker; picking it downloads the file and `stageImport` then
            // refuses the payload, so the user gets an option that
            // cannot do what the screen says. Filtered BEFORE the emptiness
            // check, so an account holding only catalogue files reports "no
            // backup" rather than a picker of unusable rows.
            var cellarFiles = ((list.files || []) as any[]).filter(function (fi: any) {
              return fi && classifyBackup(fi.name) !== "catalogue";
            });
            if (!cellarFiles.length)
              throw new Error(t("st_no_backup"));
            // Build picker entries from the listing alone — DO NOT download
            // every file's contents up-front. With 5+ backups potentially
            // carrying tens of MB of embedded photos each, parallel
            // downloads saturate slow networks and sequential ones make
            // the user wait several minutes just to see the picker. The
            // actual content is fetched on demand in doGdriveConfirm when
            // the user confirms their selection.
            var options = cellarFiles.map(function (fi: any) {
              var dsRaw = fi.modifiedTime;
              var ds = dsRaw ? new Date(dsRaw).toLocaleString("fr-FR") : "";
              var saveType = classifyBackup(fi.name);
              // Pre-populate counts straight from the filename so the picker
              // can show tabacs/pipes/etc without downloading the file.
              var counts = parseBackupCounts(fi.name);
              return {
                d: null, ds: ds, name: fi.name, id: fi.id, saveType: saveType,
                modifiedTime: dsRaw, counts: counts,
              };
            });
            options.sort(function (a: any, b: any) {
              var da = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
              var db = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
              return db - da;
            });
            // Review fix (multi-device data loss): this read-only picker must
            // NOT stamp AUTO_FID_KEY with a FOREIGN device's auto file — doing
            // so made the next quiet save PATCH-overwrite another device's
            // backup. Only adopt the newest auto file that is THIS device's own
            // (matching deviceId) or legacy-unstamped (null). Foreign auto files
            // are left untracked; chooseAutoSaveTarget also re-validates.
            var _myDid = getDeviceId();
            var _autoOpt = options.find(function (o: any) {
              if (o.saveType !== "auto") return false;
              var did = autoFileDeviceId(o.name);
              return did === _myDid || did === null;
            });
            var _manOpt = options.find(function (o: any) { return o.saveType === "manual"; });
            if (_autoOpt) lsSet(AUTO_FID_KEY, _autoOpt.id);
            if (_manOpt) lsSet(FID_KEY, _manOpt.id);
            setGdriveStatus(null);
            setGdriveConfirm({ options: options, sel: 0 });
          });
      })
      .catch(function (e) {
        if (e && e.__retry__) {
          _gdriveListBackups(null, true);
          return;
        }
        setGdriveStatus(
          t("err_prefix") + ": " + String(e.message || e).substring(0, 150),
        );
        scheduleStatusClear(5000);
      });
  }

  function gdriveSaveQuiet(_retried?: boolean) {
    // Defense-in-depth — every caller is already supposed
    // to check `localStorage["cave-autosave"] === "1"` before invoking
    // this, but a missed guard (or a 3 s setTimeout window where the
    // user toggles auto-save OFF) would still let the silent save
    // fire. Re-check here so the function is safe to call anywhere.
    if (localStorage.getItem("cave-autosave") !== "1") return;
    // The in-progress ref has NO TTL of its own, so a prior save that died
    // without reaching releaseQuietLock() would leave it true and wedge
    // auto-save for the ENTIRE session (every call bails here). Self-heal:
    // honour the in-progress guard only while the companion localStorage lock
    // is FRESH. A stale or absent lock means the prior save is dead → reset the
    // ref and proceed, recording a diagnostic so a genuinely-concurrent
    // (healthy) skip stays visible and a stuck-then-reset is traceable.
    //
    // THE TTL IS 12 s AND THE LOCK COVERS ONLY THE LIST + UPLOAD — it is
    // released the instant the upload lands, and the device-id sweep runs
    // DETACHED afterwards. Holding it across that sweep is what wedged this
    // before: Dropbox serialises writes, so a sequential delete of a straggler
    // pile takes 20-30 s, and every auto-save the user triggered in that window
    // bailed with "skip-locked" while the last-save timestamp froze.
    var LOCK_TTL = 12000;
    if (quietSaveInProgressRef.current) {
      var _lk = 0;
      try { _lk = parseInt(localStorage.getItem("cave-autosave-lock") || "0", 10) || 0; } catch (_e) {}
      if (_lk && Date.now() - _lk < LOCK_TTL) { recordAutosaveDiag("skip-inprogress"); return; }
      quietSaveInProgressRef.current = false;
      recordAutosaveDiag("ref-reset-stale");
    }
    // Cross-tab lock. Without this, two tabs with auto-
    // save on PATCH the same `gdrive-auto-fid` in parallel — both have
    // read `localStorage[SK]` with their respective in-flight deltas
    // before either persisted; the slower upload silently overwrites
    // the faster one. A lock present while THIS tab's ref is
    // free (single-tab PWA is the norm) is almost always a GHOST from a
    // prior save whose removeItem didn't stick — honour it only while
    // genuinely fresh, then clear and proceed so a ghost can never wedge.
    var LOCK_KEY = "cave-autosave-lock";
    var now = Date.now();
    try {
      var raw = localStorage.getItem(LOCK_KEY);
      var lockTs = raw ? parseInt(raw, 10) || 0 : 0;
      if (lockTs && now - lockTs < LOCK_TTL) { recordAutosaveDiag("skip-locked"); return; }
      lsSet(LOCK_KEY, String(now));
    } catch (_e) { /* storage blocked — proceed without the lock */ }
    var _saveAttempt = nextAutosaveAttempt();
    recordAutosaveDiag("saving-start", isDbx ? "dropbox" : "drive");
    function releaseQuietLock() {
      try {
        // Review fix (concern #5): only release if THIS attempt still owns the
        // lock. After the early release, the detached sweep releases
        // again — by then a newer save may have re-acquired the lock (its own
        // `now`) and set the ref; clearing either would let a third save race
        // in (or drop the newer save's in-progress guard).
        if ((localStorage.getItem(LOCK_KEY) || "") === String(now)) {
          quietSaveInProgressRef.current = false;
          lsRemove(LOCK_KEY);
        }
      } catch (_e2) { quietSaveInProgressRef.current = false; }
    }
    quietSaveInProgressRef.current = true;
    // Dropbox path — make sure a fresh access token sits in
    // dbxTokenRef, renewing silently via the refresh grant if needed
    // (works on every platform; no GSI, no redirect). Then re-enter.
    if (isDbx && !dbxTokenRef.current) {
      releaseQuietLock();
      dbx.getTokenSilent().then(function (t) {
        dbxTokenRef.current = t;
        gdriveSaveQuiet(_retried);
      }).catch(function (e: any) {
        // The Dropbox silent refresh failed (no/expired refresh
        // token, network, revoked app). This is THE common reason an
        // auto-save silently never happens — record it so Settings shows
        // "jeton Dropbox indisponible" instead of nothing.
        recordAutosaveDiag("dropbox-token-failed", String((e && e.message) || e || "").slice(0, 80));
      });
      return;
    }
    var tk = isDbx ? dbxTokenRef.current : driveTokenRef.current;
    if (!tk) {
      try {
        var _st = JSON.parse(tkGet() || "null");
        if (_st && _st.x > Date.now()) tk = _st.t;
      } catch (_e) {}
    }
    if (!tk) {
      if (
        !IS_IOS_STANDALONE &&
        localStorage.getItem(AUTO_FID_KEY) &&
        window.google &&
        window.google.accounts &&
        window.google.accounts.oauth2
      ) {
        try {
          var _hint = hintGet();
          var _cl = window.google.accounts.oauth2.initTokenClient(Object.assign({
            client_id: GDRIVE_CLIENT_ID,
            scope: GDRIVE_SCOPE,
            callback: function (r: any) {
              if (!r.error && r.access_token) {
                driveTokenRef.current = r.access_token;
                try {
                  tkSet(
                    JSON.stringify({
                      t: r.access_token,
                      x: Date.now() + 3500000,
                    }),
                  );
                } catch (_e) {}
                captureAccountHint(r.access_token);
                gdriveSaveQuiet();
              }
            },
            error_callback: function () {},
          }, _hint ? { hint: _hint } : {}));
          _cl.requestAccessToken({ prompt: "" });
        } catch (_e) {}
      }
      // No usable token and no silent path to get one (iOS
      // standalone Drive, or Drive without a cached token + no GSI).
      recordAutosaveDiag("no-token", isDbx ? "dropbox" : "drive");
      releaseQuietLock();
      return;
    }
    var rawSnap = localStorage.getItem(SK);
    if (!rawSnap) { releaseQuietLock(); return; }
    var snap: any;
    try {
      snap = JSON.parse(rawSnap);
    } catch (_e) {
      releaseQuietLock();
      return;
    }
    var excluded = localStorage.getItem("cave-exclude-apikey") !== "0";
    var activeProvider = localStorage.getItem("ai-provider") || "anthropic";
    var ak = excluded ? "" : (localStorage.getItem(activeProvider + "-api-key") || "");
    // See useImportConfirm._apiKeyProvider.
    var akProvider = excluded ? "" : activeProvider;
    // Auto-save now overwrites a single Drive file in place.
    // The previous rotation pattern (GDRIVE_MAX_AUTO timestamped files)
    // was confusing and wasteful — the user only ever cares about the
    // latest auto-save, and the manual rotation already covers
    // historical recovery. We track the file via `gdrive-auto-fid` and
    // PATCH it; if that ID is stale we list and reuse the most recent
    // auto file; if none exists we POST a fresh one. Any leftover
    // legacy auto files (from the old rotation scheme) are deleted so the
    // appDataFolder converges to one auto file total.
    // `gatherLocalImages` can now REJECT (a photo store that would
    // not answer at all). THE RULE, applied in two directions on purpose:
    //   • an interactive ONE-SHOT artifact (JSON export, ZIP) fails loudly —
    //     the user asked for a complete-backup file and keeps it as their
    //     archive, so a silently photo-less one is the thing that bites years
    //     later. That path propagates to doExport's catch.
    //   • a CONTINUOUS UNATTENDED net degrades and records. Stopping the cloud
    //     auto-save because IndexedDB is broken would cost the user every
    //     backup, which is a far bigger loss than a backup without photos they
    //     may no longer have anyway.
    // Hence: swallow to an empty map here, and record it so Settings → Données
    // shows the reason instead of the save appearing to do nothing.
    gatherLocalImages(snap).catch(function () {
      recordAutosaveDiag("photos-unreadable");
      return {};
    }).then(function (imgMap: any) {
      var bk = Object.assign({}, snap, {
        _apiKey: ak,
        _apiKeyProvider: akProvider,
        _savedAt: new Date().toISOString(),
        _saveType: "auto",
        _schemaVersion: SCHEMA_VERSION,
        // Preferences ride along (allowlist — utils/appSettings).
        _settings: collectSettings(),
      });
      if (Object.keys(imgMap as object).length)
        bk = Object.assign({}, bk, { _imageData: imgMap });
      var plainJson = JSON.stringify(bk);
      // Encryption-aware auto-save. Three cases:
      //   1. Encryption OFF → plain JSON, current behaviour.
      //   2. Encryption ON, passphrase cached → encrypt then upload.
      //   3. Encryption ON, passphrase NOT cached → SKIP the auto-save
      //      silently. Surfaces in Settings via the lock indicator. The
      //      next manual save prompts and recovers.
      if (driveEncryptionEnabled && !drivePassphrase) {
        releaseQuietLock();
        return;
      }
      maybeEncryptPayloadQuiet(plainJson).then(function (jsonMaybe) {
        if (jsonMaybe === null) {
          releaseQuietLock();
          return;
        }
        // Narrow `json` to non-null for the nested closures below
        // (postNew, patchExisting) — TS doesn't follow the narrowing
        // across function boundaries.
        var json: string = jsonMaybe;
      var listingTk = tk as string;
      function _onSuccess() {
        var ts = Date.now();
        setLastAutoSaveTs(ts);
        lsSet("cave-autosave-ts", String(ts));
        lsSet("cave-autosave-ts-" + (isDbx ? "dropbox" : "gdrive"), String(ts));
        // Record that the last save on this provider was AUTO.
        lsSet("cave-last-save-type-" + (isDbx ? "dropbox" : "gdrive"), "auto");
        // The uploaded body is `rawSnap`, frozen
        // at the start of this quiet save. An edit may have landed DURING the
        // upload (a save(S2) while S1 was in flight, whose own quiet save hit
        // the in-progress skip and never rescheduled). If localStorage has
        // advanced since, we must NOT clear pendingSync / declare "synced" —
        // the cloud still holds the stale S1. Keep the dirty flag and re-arm a
        // follow-up save so S2 reaches the cloud (and the multi-device guard
        // compares against the right reference). Only clear when still current.
        var _stillCurrent;
        try { _stillCurrent = localStorage.getItem(SK) === rawSnap; } catch (_e) { _stillCurrent = true; }
        if (_stillCurrent) {
          setPendingSync(false);
          lsRemove("cave-pending-sync");
        } else {
          // Data moved on mid-upload — flush the newer snapshot shortly (the
          // lock is released just below, so this re-armed save runs cleanly).
          try { setTimeout(function () { gdriveSaveQuiet(); }, 800); } catch (_e) {}
        }
        if (markExported) markExported();
        // Mark that THIS device has written a
        // device-stamped auto file. Once stamped, the launch-time
        // newer-cloud guard also skips this device's own LEGACY (unstamped)
        // auto files — they're drained by the sweep on save anyway, and
        // skipping them stops a single-device user from being nagged to
        // "restore" their own pre-device-id file after a clock skew.
        lsSet("cave-auto-stamped", String(Date.now()));
        // Upload landed. The sweep result is appended next.
        recordAutosaveDiag("uploaded");
        // Release the lock NOW (upload done) so the cleanup
        // sweep runs DETACHED and a follow-up save isn't blocked for the
        // whole sequential-delete window. Idempotent with the outer
        // chain's releaseQuietLock.
        releaseQuietLock();
      }
      var myDeviceId = getDeviceId();
      var newName = makeBackupName(snap, "auto", myDeviceId, getDeviceName());

      // Multipart construction lives in the provider.

      // Device-scoped sweep — converge THIS device to a
      // single auto file while never touching another device's auto file.
      //
      // History: the sweep was once narrowed to "only delete the single
      // `oldFid` this device previously tracked" to stop device A from
      // deleting device B's auto file on a multi-device account. But that
      // made the cleanup unable to self-heal: once N>1 auto files for the
      // SAME device piled up (a lost `auto-fid`, a Dropbox overwrite whose
      // fire-and-forget delete failed, a clock-skew POST…), each cycle
      // only ever removed one of them, so the pile stayed at N forever.
      // The user saw 14 auto files instead of 1.
      //
      // The fix: every auto filename now carries a stable device id
      // (makeBackupName). On each save this device deletes every
      // auto file that is EITHER its own (matching device id) OR legacy
      // (unstamped — adopted-and-drained once during the transition),
      // except the file it just wrote (keepId). Auto files stamped with a
      // DIFFERENT device id are foreign and left untouched, so the
      // multi-device guarantee that narrowing bought still holds: the account may
      // hold one auto file per active device, and the launch-time
      // newer-cloud guard still sees foreign files.
      function sweepOwnAutoFiles(autoFilesList: any[], keepId: string | null) {
        return sweepOwnAutoStragglers(cloud, listingTk, autoFilesList, myDeviceId, keepId)
          .then(function (res) {
            // Surface the cleanup result alongside the upload
            // success so Settings can show "✓ sauvegardé · ménage 15
            // supprimés" or flag "✗ ménage: 0 supprimés, 15 échecs".
            // The sweep is DETACHED — only write the
            // terminal diagnostic if no newer save has started since this
            // one's "saving-start", so a slow sweep can't bury a newer
            // save's real outcome under a stale "ok".
            if (currentAutosaveAttempt() === _saveAttempt) {
              recordAutosaveDiag(
                res.failed > 0 ? "swept-partial" : "ok",
                "deleted " + res.deleted + ", failed " + res.failed,
              );
            }
            return res;
          });
      }

      function postNew(autoFilesForCleanup: any[]) {
        // 60s timeout for multipart upload.
        return cloud.uploadNew(listingTk, newName, json)
          .then(function (r) { return r.json(); })
          .then(function (f: any) {
            if (f && !f.error) {
              if (f.id) lsSet(AUTO_FID_KEY, f.id);
              _onSuccess();
              // Even on a fresh POST, sweep this device's
              // own (and legacy unstamped) auto stragglers from the prior
              // listing — that's exactly the "lost auto-fid → new file
              // every time" path that let the pile grow. keepId = the file
              // we just posted (not in the prior listing, so never swept).
              // Run the sweep DETACHED (don't return it).
              // The lock was already released in _onSuccess, so a follow-up
              // save isn't blocked for the whole delete window. Dropbox
              // delete↔upload collisions are absorbed by the per-op 429
              // retries (dropboxProvider.remove + dbxUpload).
              sweepOwnAutoFiles(autoFilesForCleanup, f.id || null);
              return;
            } else if (f && f.error && (f.error.code === 401 || f.error.code === 403)) {
              recordAutosaveDiag("upload-auth-error", "POST " + f.error.code);
              cloudTokenInvalidate();
              // Silent in-place retry on Android/desktop
              // (gated to one attempt). On iOS the no-token branch can't
              // re-auth silently, so we no-op — the form-save trigger
              // covers that platform separately.
              if (!_retried && (isDbx || !IS_IOS_STANDALONE)) {
                releaseQuietLock();
                setTimeout(function () { gdriveSaveQuiet(true); }, 100);
              }
            } else if (f && f.error) {
              recordAutosaveDiag("upload-error", "POST " + (f.error.code || "") + " " + String(f.error.message || "").slice(0, 60));
            }
          });
      }

      function patchExisting(fid: string, autoFilesForCleanup: any[]) {
        // 60s timeout for multipart upload.
        // PATCH (no `parents` — read-only there) + rename to
        // refresh the count suffix, via the provider.
        return cloud.overwrite(listingTk, fid, newName, json)
          .then(function (r) { return r.json(); })
          .then(function (f: any) {
            if (f && !f.error) {
              // Prefer the id RETURNED by the provider.
              // For Drive, overwrite is a PATCH on the same fid → f.id ===
              // fid. For Dropbox, overwrite is "upload new + delete old"
              // → f.id is a NEW id and `fid` is the soon-to-be-stale one.
              // We used to store `fid` (the old one), which (a) broke the
              // next save's matchedStored lookup, and (b) made
              // deleteLegacyAutos keep the wrong file when the Dropbox
              // fire-and-forget delete had failed silently — accumulating
              // ghost auto files until the user noticed (e.g. 2 auto-saves
              // in Settings → "Voir mes sauvegardes" — see screenshot).
              // `f` is already guaranteed truthy by the enclosing
              // `if (f && !f.error)` on line 1235 — drop the redundant
              // `f &&` guard to close CodeQL #35 (js/trivial-conditional).
              var keepId = f.id || fid;
              lsSet(AUTO_FID_KEY, keepId);
              _onSuccess();
              // Sweep this device's own + legacy auto
              // stragglers, keeping only the file we just wrote (keepId).
              // For Drive, keepId === fid (PATCH in place) so the target
              // is skipped; for Dropbox keepId is the NEW id and the old
              // `fid` is swept here (its device id matches ours).
              // Sweep DETACHED (see postNew).
              sweepOwnAutoFiles(autoFilesForCleanup, keepId);
              return;
            }
            // Stale fid (404 / file deleted manually) → fall back to a
            // POST so the user's auto-save chain isn't broken.
            if (f && f.error && (f.error.code === 404 || f.error.code === 400)) {
              lsRemove(AUTO_FID_KEY);
              return postNew(autoFilesForCleanup);
            }
            if (f && f.error && (f.error.code === 401 || f.error.code === 403)) {
              recordAutosaveDiag("upload-auth-error", "PATCH " + f.error.code);
              cloudTokenInvalidate();
              // See postNew 401 branch above.
              if (!_retried && (isDbx || !IS_IOS_STANDALONE)) {
                releaseQuietLock();
                setTimeout(function () { gdriveSaveQuiet(true); }, 100);
              }
            } else if (f && f.error && f.error.code !== 404 && f.error.code !== 400) {
              recordAutosaveDiag("upload-error", "PATCH " + (f.error.code || "") + " " + String(f.error.message || "").slice(0, 60));
            }
          });
      }

      // Step 1: list all auto files so we can either reuse one or
      // clean up legacy rotations. We could skip this when
      // gdrive-auto-fid is set, but listing is cheap and lets us
      // delete leftovers from the old rotation pattern.
      cloud.list(listingTk, {
        fields: "files(id,name,createdTime,modifiedTime)",
        orderBy: "modifiedTime+desc",
      })
        .then(function (r) { return r.json(); })
        .then(function (list: any) {
          if (list && list.error) {
            if (list.error.code === 401 || list.error.code === 403) {
              recordAutosaveDiag("list-auth-error", String(list.error.code));
              cloudTokenInvalidate();
              // Silent in-place retry on Android/desktop.
              // The throw below still propagates so the .catch terminates
              // the in-flight pipeline; the retry path runs independently
              // after a short delay so the cleared cache triggers the
              // no-token silent re-auth branch.
              if (!_retried && (isDbx || !IS_IOS_STANDALONE)) {
                setTimeout(function () { gdriveSaveQuiet(true); }, 100);
              }
            } else {
              recordAutosaveDiag("list-error", String(list.error.code || "") + " " + String(list.error.message || "").slice(0, 60));
            }
            throw list.error;
          }
          var allFiles = (list && list.files) || [];
          var autoFiles = allFiles.filter(function (f: any) {
            return classifyBackup(f.name) === "auto";
          });
          // Only ever reuse (PATCH/overwrite) an auto file
          // that belongs to THIS device or is a legacy unstamped one —
          // never hijack another device's stamped auto file. The tracked
          // fid wins when it still points at a listed auto file, else the
          // newest own/legacy auto; on miss we POST a fresh device-stamped
          // file. The subsequent sweepOwnAutoFiles drains the rest. Build
          // 78: extracted to the pure `chooseAutoSaveTarget` (was inline).
          var storedFid = localStorage.getItem(AUTO_FID_KEY);
          var targetFid = chooseAutoSaveTarget(autoFiles, storedFid, myDeviceId);
          if (targetFid) {
            return patchExisting(targetFid, autoFiles);
          }
          return postNew(autoFiles);
        })
        .then(function () { releaseQuietLock(); })
        .catch(function () { releaseQuietLock(); });
      }).catch(function () { releaseQuietLock(); });
    }).catch(function () { releaseQuietLock(); });
  }

  function doGdriveConfirm() {
    var gc = gdriveConfirm;
    if (!gc) return;
    var opt = gc.options[gc.sel];
    // Lazy download — gdriveRestore only listed the files. The actual
    // contents are fetched here, when the user has committed to one
    // specific backup. Saves bandwidth and stops the entire restore from
    // hanging on a single large/slow file.
    if (!opt.d) {
      setGdriveConfirm(null);
      setGdriveStatus(t("st_downloading"));
      var tk = getCachedCloudToken();
      if (!tk) {
        setGdriveStatus(t("err_prefix") + ": " + t("err_drive_expired"));
        scheduleStatusClear(4000);
        return;
      }
      // 180s download timeout (full payloads with embedded
      // photos) — AbortController plumbing lives in the provider now.
      cloud.download(tk, opt.id, 180000)
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (txt) {
          // Optional decryption step. Plaintext envelopes
          // pass through unchanged; encrypted envelopes block on a
          // passphrase prompt before yielding the decrypted JSON.
          return maybeDecryptText(txt);
        })
        .then(function (jsonText) {
          if (jsonText === null) {
            // Surface a transient hint instead of a
            // fully silent abort. The user who cancelled the
            // passphrase prompt saw nothing and assumed the button
            // was broken; now they see why the restore stopped.
            setGdriveStatus(t("enc_err_decrypt"));
            scheduleStatusClear(4000);
            return;
          }
          var d;
          try { d = JSON.parse(jsonText); } catch (parseErr) {
            // T(), not a French literal — the catch below renders
            // e.message verbatim after t("err_prefix"), so a German user
            // restoring a corrupt backup read "Fehler: Fichier corrompu".
            // Four lines down the same failure class already used t().
            var err = new Error(t("alert_invalid_file"));
            (err as any).cause = parseErr;
            throw err;
          }
          if (d.error || !isPlausibleBackup(d)) throw new Error(t("alert_invalid_file"));
          setGdriveStatus(null);
          // Hand off to the shared import-confirm picker
          // instead of saving directly. The user gets the Merge /
          // Replace / Cancel choice via the same UI as the JSON file
          // import — keeps the two restore paths consistent.
          // Restoring counts as acknowledging the newer
          // cloud backup — silence the multi-device banner.
          ackCloudNewerBackup(opt && opt.modifiedTime ? new Date(opt.modifiedTime).getTime() : undefined, opt && opt.name);
          stageImport(d, "drive");
        })
        .catch(function (e) {
          setGdriveStatus(t("err_prefix") + ": " + String((e && e.message) || e).substring(0, 150));
          scheduleStatusClear(5000);
        });
      return;
    }
    // Review fix: the pre-loaded branch used to stage `opt.d` without the
    // validity check the lazy-download branch has — a malformed-but-parseable
    // backup chosen via Replace could then wipe live data. Guard it the same way.
    if (!opt.d || (opt.d as any).error || !(opt.d as any).tobaccos) {
      setGdriveStatus(t("err_prefix") + ": " + t("alert_invalid_file"));
      scheduleStatusClear(5000);
      return;
    }
    setGdriveConfirm(null);
    // See comment in the lazy-download branch above —
    // the staged payload flows through useImportConfirm's picker.
    // See ackCloudNewerBackup note above.
    ackCloudNewerBackup(opt && opt.modifiedTime ? new Date(opt.modifiedTime).getTime() : undefined, opt && opt.name);
    stageImport(opt.d, "drive");
  }

  // Lazy-load the payload of a single picker option (without restoring) so the
  // UI can display tabacs/pipes/wishes counts before the user confirms.
  function gdriveLoadOptionPayload(idx: number) {
    // Atomic guard inside the setter to avoid a useEffect race: two ticks
    // could both see _loading=false before either flush.
    var shouldFetch = false;
    var tk: string | null = getCachedCloudToken();
    if (!tk) return;
    var fileId: string | null = null;
    setGdriveConfirm(function (prev: any) {
      if (!prev) return prev;
      var cur = prev.options && prev.options[idx];
      if (!cur || cur.d || cur._loading || cur._loadFailed) return prev;
      shouldFetch = true;
      fileId = cur.id;
      var next = Object.assign({}, prev);
      next.options = prev.options.slice();
      next.options[idx] = Object.assign({}, cur, { _loading: true });
      return next;
    });
    if (!shouldFetch) return;
    if (!fileId) {
      // We optimistically flipped _loading=true above; reset it so the slot
      // isn't wedged forever showing "Chargement…" on a malformed listing.
      setGdriveConfirm(function (prev: any) {
        if (!prev) return prev;
        var next = Object.assign({}, prev);
        next.options = prev.options.slice();
        next.options[idx] = Object.assign({}, prev.options[idx], { _loading: false, _loadFailed: true });
        return next;
      });
      return;
    }
    // Abort the fetch after 30s so a hung Drive endpoint doesn't keep the
    // "Chargement…" UI stuck forever or pile up connections.
    cloud.download(tk, fileId, 30000)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (txt) {
        var d: any;
        try { d = JSON.parse(txt); } catch (_e) { d = null; }
        if (!d) throw new Error(t("alert_invalid_file"));
        setGdriveConfirm(function (prev: any) {
          if (!prev) return prev;
          var next = Object.assign({}, prev);
          next.options = prev.options.slice();
          next.options[idx] = Object.assign({}, prev.options[idx], { d: d, _loading: false });
          return next;
        });
      })
      .catch(function () {
        // Mark _loadFailed so the picker's useEffect won't immediately re-trigger
        // a doomed retry on every render.
        setGdriveConfirm(function (prev: any) {
          if (!prev) return prev;
          var next = Object.assign({}, prev);
          next.options = prev.options.slice();
          next.options[idx] = Object.assign({}, prev.options[idx], { _loading: false, _loadFailed: true });
          return next;
        });
      });
  }

  // `gdriveDeleteOption(idx)` — the picker's per-row delete — was REMOVED with
  // the delete mode it was the only content of. It was rendered exclusively
  // inside `isDeleteMode`, which nothing could set (see `gdriveRestore`
  // above), so no tap could ever reach it. The per-file delete users DO have
  // is `gdriveDeleteBackupById`, in the merged cloud panel, and that one keeps
  // the same two guards this had: it clears a cached fid pointing at the
  // deleted file, and it checks `r.ok`.

  // GdriveReconnect moved to useGdriveAuth.

  // TriggerIosAutosaveReauth moved to useGdriveAuth.

  // List all backups read-only and refresh the metadata
  // store. Powers the Settings "Voir mes sauvegardes" panel. Reuses
  // the existing prefix query (no user-visible status banner, no
  // picker dispatch).
  // DELETING A BACKUP ASKED FOR A TOKEN UNDER "restore".
  //
  // On iOS standalone with no cached Drive token that is a full redirect, and
  // the OAuth-return dispatcher routes on the action: `ac === "restore"` opens
  // the RESTORE PICKER — a destructive "Remplace tout." screen. So tapping 🗑
  // on a backup, confirming, and coming back from Google landed the user in
  // front of the most dangerous screen in the app, with the file still there
  // and nothing saying the delete had not happened.
  //
  // The action is now "list", whose return branch is read-only, plus a fresh
  // marker carrying the file id so the delete the user explicitly confirmed is
  // resumed rather than lost. Same shape as `cave-sync-diag-pending`
  // — no new OAuth action, so the fail-closed whitelist is untouched.
  function gdriveDeleteBackupById(fileId: string) {
    if (!fileId) return Promise.resolve();
    // Use the CACHED token when there is one. This went
    // straight to `getCloudToken`, which on desktop/Android always opens a
    // Google popup — so deleting three backups meant three consent popups even
    // with a perfectly valid token in hand. Every sibling read path
    // (checkCloudNewerNow, runSyncDiagnostic, the launch check) tries the cache
    // first; this one never did.
    var _delCached = getCachedCloudToken();
    var _delToken: Promise<any>;
    if (_delCached) {
      _delToken = Promise.resolve(_delCached);
    } else {
      // Only the interactive path can redirect, so only it needs the marker.
      try {
        lsSet(BACKUP_DELETE_PENDING_KEY, JSON.stringify({ id: fileId, ts: Date.now() }));
      } catch (_e) {}
      _delToken = getCloudToken("list");
    }
    return _delToken.then(function (tk: any) {
      // Popup path completed inline — consume the marker so a later
      // "Voir mes sauvegardes" return isn't mis-routed into a delete.
      lsRemove(BACKUP_DELETE_PENDING_KEY);
      var token = tk as string;
      cloudTokenPersist(token);
      return cloud.remove(token, fileId).then(function (r: any) {
        // A non-2xx that RESOLVES used to run the optimistic
        // update anyway, so a refused delete (403, 404, a Dropbox
        // path_lookup/not_found) removed the row while the file stayed in the
        // cloud — and re-opening the panel resurrected it with no explanation.
        // The picker's own delete had always checked it; this sibling never
        // did (that picker path has since been removed — see gdriveRestore).
        if (r && !r.ok && r.status !== 204) {
          throw new Error("HTTP " + String(r.status));
        }
        // Optimistic update: drop the entry locally so the UI reflects
        // immediately; recompute total + auto pointer. If Drive
        // accepted the DELETE, the next refresh confirms; if it
        // didn't, the user can re-open the panel to re-sync.
        // Keyed on `syncDiag` now that the file list and the multi-device
        // diagnostic are ONE panel — the counts, the total and the per-device
        // roll-up are all derived from these rows, so dropping the row updates
        // every one of them at once.
        setSyncDiag(function (prev: any) {
          if (!prev || !prev.rows) return prev;
          var rows = prev.rows.filter(function (r: any) { return r.id !== fileId; });
          return Object.assign({}, prev, {
            rows: rows,
            devices: summariseCloudDevices(rows, getDeviceId()),
          });
        });
        // Functional, not cosmetic: if the file just deleted is the auto file
        // THIS device tracks, drop the fid so the next quiet save posts a
        // fresh one instead of PATCHing a file that no longer exists. Read
        // straight from storage rather than from a panel's state, which is
        // what it always meant.
        try {
          if (localStorage.getItem(AUTO_FID_KEY) === fileId) lsRemove(AUTO_FID_KEY);
        } catch (_e) { /* private mode — the next save recovers via POST */ }
      });
    });
  }


  // ── The CATALOGUE stream ──────────────────────────────────────────────────
  //
  // The catalogue has its own filename prefix and every
  // cellar mechanism ignores it; these two functions are what put a file in
  // that stream. Without them the exclusions guard something that never
  // exists, which is the dead machinery this repo keeps deleting.
  //
  // WHY IT IS A SEPARATE STREAM, restated where the write happens: a real
  // catalogue measured 3.77 MB, and the cellar backup is written on every
  // change (the auto-save debounces 1.2 s after any edit) while a catalogue
  // changes only when the user loads one. Embedding it would upload 3.77 MB of
  // unmoved data every time a session is logged; this pays it once per load.
  //
  // WHAT TRAVELS IS THE RAW CSV, not the parsed cache — so the other device
  // runs the CURRENT parser over the user's own file rather than replaying a
  // cache built by an older one. That is also why the restore goes through
  // `catalogueSave`, the same function the file picker uses: one parse path,
  // one set of counts, one set of warnings.
  //
  // ONE FILE PER ACCOUNT. A cellar auto-file is per-device (two devices
  // converging on one file is the data-loss bug three separate releases were
  // spent on); a catalogue is one reference document for the account, so a save
  // sweeps the older ones. `pruneByType` does the sweep because it already
  // deletes SEQUENTIALLY — Dropbox serialises writes per namespace and 429s a
  // parallel batch, and a second sweep would have to learn that
  // again.
  function catalogueCloudSave(preToken?: any, _retried?: any): Promise<boolean> {
    setCatCloudStatus(t("st_connecting"));
    return Promise.all([catalogueGetCsv(), catalogueGetMeta()]).then(function (r) {
      var csv: string = String(r[0] || "");
      var meta = r[1];
      if (!csv) {
        // Nothing to send. Said out loud rather than silently succeeding: a
        // no-op that reports success is how a user concludes their catalogue
        // is safe in the cloud when it is not.
        setCatCloudStatus(t("cat_cloud_none"));
        scheduleCatCloudClear(4000);
        return false;
      }
      // "cat-save", NOT "save". On iOS standalone a missing token means a
      // REDIRECT, and the return dispatcher routes on the action string
      // alone — under "save" this button resumed as `gdriveSave`, i.e. a full
      // CELLAR backup, with "✓ OK" shown under the other button and the
      // catalogue never uploaded.
      return (typeof preToken === "string" ? Promise.resolve(preToken) : getCloudToken("cat-save"))
        .then(function (token: any) {
          cloudTokenPersist(token as string);
          setCatCloudStatus(t("st_saving"));
          var blob = new Blob([csv], { type: "text/csv" });
          return cloud.uploadNew(token, makeCatalogueName((meta && meta.name) || undefined), blob)
            .then(function (resp: any) { return resp.json(); })
            .then(function (f: any) {
              if (f.error) {
                if (f.error.code === 401 || f.error.code === 403) {
                  cloudTokenInvalidate();
                  if (!_retried) throw { __retry__: true };
                }
                throw new Error(f.error.message || "upload failed");
              }
              // Sweep the older catalogue files — keep exactly the one just
              // written. Failure here is not the user's problem: the new file
              // is up, and a leftover is swept by the next save.
              return cloud.list(token, {
                fields: "files(id,name,createdTime)",
                orderBy: "createdTime+desc",
                retries: 2,
              })
                .then(function (resp: any) { return resp.json(); })
                .then(function (list: any) {
                  var files = (list && list.files) || [];
                  return pruneByType(files, "catalogue", 1, token, cloud.remove);
                })
                .catch(function () { /* the save itself succeeded */ })
                .then(function () {
                  setCatCloudStatus(t("cat_cloud_saved"));
                  scheduleCatCloudClear(4000);
                  return true;
                });
            });
        });
    }).catch(function (e: any) {
      if (e && e.__retry__ && !_retried) return catalogueCloudSave(undefined, true);
      var msg = (e && (e.message || e.error)) || t("err_prefix");
      setCatCloudStatus(t("err_prefix") + ": " + String(msg).substring(0, 150));
      scheduleCatCloudClear(5000);
      return false;
    });
  }

  function catalogueCloudRestore(preToken?: any, _retried?: any): Promise<boolean> {
    setCatCloudStatus(t("st_connecting"));
    // "cat-restore", NOT "list". Under "list" this button was the FIFTH
    // producer of that action and the only one leaving no one-shot marker, so
    // a redirect fell through to `runSyncDiagnostic` — the backups panel —
    // with the catalogue never fetched.
    return (typeof preToken === "string" ? Promise.resolve(preToken) : getCloudToken("cat-restore"))
      .then(function (token: any) {
        cloudTokenPersist(token as string);
        return cloud.list(token, {
          fields: "files(id,name,modifiedTime)",
          orderBy: "modifiedTime+desc",
          retries: 2,
        })
          .then(function (resp: any) { return resp.json(); })
          .then(function (list: any) {
            if (list && list.error) {
              if (list.error.code === 401 || list.error.code === 403) {
                cloudTokenInvalidate();
                if (!_retried) throw { __retry__: true };
              }
              throw new Error(list.error.message || "list failed");
            }
            var cats = ((list && list.files) || []).filter(function (f: any) {
              return classifyBackup(f && f.name) === "catalogue";
            });
            cats.sort(function (a: any, b: any) {
              var da = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
              var db2 = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
              return db2 - da;
            });
            var newest = cats[0];
            if (!newest) {
              setCatCloudStatus(t("cat_cloud_none_remote"));
              scheduleCatCloudClear(4000);
              return false;
            }
            setCatCloudStatus(t("st_downloading"));
            return cloud.download(token, newest.id, 180000)
              .then(function (resp: any) { return resp.text(); })
              .then(function (csv: string) {
                // Through `catalogueSave` deliberately: it re-parses with the
                // CURRENT parser, refuses a file that yields zero blends
                // (replacing a working catalogue with an empty one because the
                // wrong file was picked is the failure that guard exists for),
                // and writes the same three records the file picker does.
                return catalogueSave(String(csv || ""), String(newest.name || ""), Date.now());
              })
              .then(function (res: any) {
                if (!res || !res.ok) {
                  setCatCloudStatus(t(res && res.reason === "parse" ? "cat_err_parse" : "cat_err_write"));
                  scheduleCatCloudClear(5000);
                  return false;
                }
                // Without this the app answers from the previous catalogue for
                // the rest of the session and the user concludes the restore
                // did not work.
                tobaccoDbInvalidate();
                setCatCloudStatus(t("cat_cloud_restored"));
                scheduleCatCloudClear(4000);
                return true;
              });
          });
      })
      .catch(function (e: any) {
        if (e && e.__retry__ && !_retried) return catalogueCloudRestore(undefined, true);
        var msg = (e && (e.message || e.error)) || t("err_prefix");
        setCatCloudStatus(t("err_prefix") + ": " + String(msg).substring(0, 150));
        scheduleCatCloudClear(5000);
        return false;
      });
  }

  return {
    gdriveStatus,
    setGdriveStatus,
    gdriveConfirm,
    setGdriveConfirm,
    autoSaveDrive,
    setAutoSaveDrive,
    lastAutoSaveTs,
    gdriveSave,
    gdriveRestore,
    gdriveSaveQuiet,
    doGdriveConfirm,
    gdriveLoadOptionPayload,
    gatherLocalImages,
    withPhotos,
    tkClear,
    tkGet,
    // Full Dropbox sign-out — wipes both tokens and the
    // per-provider file ids so a re-connect starts clean.
    dropboxDisconnect: function () {
      dbx.dbxAuthClear();
      dbxTokenRef.current = null;
      lsRemove("dropbox-fid");
      lsRemove("dropbox-auto-fid");
    },
    gdriveDeleteBackupById,
    // The catalogue's own cloud stream (it is excluded
    // from every cellar mechanism; these are what write to it).
    catalogueCloudSave,
    catalogueCloudRestore,
    catalogueCloudStatus,
    gdriveReconnect,
    triggerIosAutosaveReauth,
    // Multi-device guard — newest cloud backup that's
    // newer than anything this device saved/acknowledged, or null.
    cloudNewerBackup,
    dismissCloudNewerBackup,
    // One-tap restore from the Home banner — downloads
    // the cloudNewerBackup file directly and hands off to the
    // Replace / Merge picker (one final destructive-default confirm).
    restoreCloudNewerBackup,
    // In-flight flag so the banner buttons can show a
    // spinner + disabled state. Without it the user gets zero visible
    // feedback at the click site (the global status line lives inside
    // Settings → Drive) and assumes the button is dead.
    cloudRestoreBusy,
    // Explicit re-check exposed to Settings → Drive so
    // the user can override the silent-launch-check's "dismissed" memory
    // when a remote save was missed.
    checkCloudNewerNow,
    // Read-only multi-device diagnostic (Settings → Diagnostic sync).
    runSyncDiagnostic,
    dismissSyncDiag,
    syncDiag,
    syncDiagBusy,
    syncDiagErr,
    syncDiagSource,
  };
}
