// gdriveApi.ts — pure, React-free Drive wire-level helpers.
//
// Step 1 of the useGdriveSync split (CLAUDE.md "Drive
// refactor" plan). This module hosts everything that needs NO React
// state and NO closure over the hook: backup naming/parsing, the
// fetch-with-timeout wrapper, and the rotation pruner. The OAuth/auth
// family (tkGet/tkSet/tkClear, hint*, pkce*) deliberately stays in
// useGdriveSync.ts — it moves in step 2 (useGdriveAuth) so each step
// stays small and independently verifiable.
//
// Everything here is unit-tested in src/__tests__/gdriveApi.test.ts.

import {
  GDRIVE_FILE_PREFIX,
  GDRIVE_AUTO_FILENAME,
  GDRIVE_AUTO_PREFIX,
  GDRIVE_CATALOGUE_PREFIX,
} from "../constants.ts";

// Encode top-level data counts directly in the filename so the picker
// can show them WITHOUT downloading the file. Format:
//   manual: cave-tabac-YYYYMMDD-HHMMSS-t12-p5-w3-a4-j87.json
//   auto:   cave-tabac-auto-YYYYMMDD-HHMMSS-t12-p5-w3-a4-j87.json   (legacy, no device id)
//   auto:   cave-tabac-auto-<deviceId>-YYYYMMDD-HHMMSS-t12-…-j87.json
// Letters: t=tobaccos, p=pipes, w=wishlist, a=accessories, j=journal/sessions.
//
// The optional `deviceId` (lowercase alphanumeric token,
// no dashes) is woven into AUTO filenames only. It lets each device own
// its single auto file: gdriveSaveQuiet sweeps every auto file carrying
// THIS device's id (plus legacy unstamped ones) except the one it just
// wrote, while NEVER touching another device's stamped auto file. This
// is what fixes the "14 auto saves instead of 1" bug — see
// useGdriveSync.gdriveSaveQuiet. Manual names are unchanged (manual
// backups intentionally rotate over GDRIVE_MAX_MANUAL).
// LABEL-CONTRACT:start backup-filename-device-name — see scripts/label-contracts.json
export function makeBackupName(
  data: any,
  type: "manual" | "auto",
  deviceId?: string,
  deviceName?: string,
): string {
  var d = new Date();
  function pad(n: number) { return String(n).padStart(2, "0"); }
  var ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
           "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  var nT = ((data && data.tobaccos) || []).length;
  var nP = ((data && data.pipes) || []).length;
  var nW = ((data && data.wishlist) || []).length;
  var nA = ((data && data.accessories) || []).length;
  var nJ = ((data && data.sessions) || []).length;
  var counts = "-t" + nT + "-p" + nP + "-w" + nW + "-a" + nA + "-j" + nJ;
  var prefix = type === "auto" ? GDRIVE_AUTO_PREFIX : GDRIVE_FILE_PREFIX;
  // Sanitise the device id to the [0-9a-z] charset autoFileDeviceId
  // parses back, so a tampered value can't smuggle dashes/dots that
  // would corrupt the timestamp/counts parsing.
  var didSeg = "";
  if (type === "auto" && deviceId) {
    var clean = String(deviceId).toLowerCase().replace(/[^0-9a-z]/g, "");
    if (clean) didSeg = clean + "-";
  }
  // Append the user's device NAME as a human-readable slug at the
  // END (after the counts, before `.json`) so a backup is identifiable at a
  // glance in Drive / Dropbox / the "Voir mes sauvegardes" panel. Sanitised to
  // [a-z0-9] (accents folded, everything else dropped) + capped, so it can't
  // smuggle a dash/dot that would corrupt the front-of-name deviceId parse
  // (autoFileDeviceId) — and it's parsed AROUND by parseBackupCounts' optional
  // trailing group. The NAME is display-only; the opaque `deviceId` remains the
  // convergence identity. Placed at the tail (not the prefix) so a device named
  // "auto" can't flip classifyBackup.
  var nameSeg = "";
  if (deviceName) {
    // Cap the raw string BEFORE normalize() so a tampered
    // multi-MB `cave-device-name` can't force an O(n) NFD pass on every save.
    var ns = String(deviceName).slice(0, 64).toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 16);
    if (ns) nameSeg = "-" + ns;
  }
  return prefix + didSeg + ts + counts + nameSeg + ".json";
}
// LABEL-CONTRACT:end backup-filename-device-name

/**
 * The name of a CATALOGUE file in the cloud.
 *
 * `cave-tabac-catalogue-YYYYMMDD-HHMMSS[-slug].csv`, and every part of that is
 * a decision:
 *
 *  • the PREFIX is what `classifyBackup` keys on, so the file is excluded from
 *    the manual rotation, the auto sweep, the multi-device guard and the
 *    restore picker. Without it three cellar saves would DELETE
 *    the user's catalogue.
 *  • NO device id. A cellar auto-file is per-device because two devices
 *    converging on one file is the data-loss bug three separate releases were
 *    spent on; a catalogue is the opposite — one reference document for the account,
 *    which is the whole point of putting it in the cloud. It is also why the
 *    slug goes at the TAIL: `autoFileDeviceId` parses the FRONT of a name, and
 *    a slug there could be read as a device id.
 *  • the slug is the user's own file name, sanitised the way the device name
 *    is (accents folded, `[a-z0-9]` only, capped), so a tampered value cannot
 *    smuggle a dash or a dot into the timestamp.
 *  • `.csv`, not `.json`: what travels is the RAW file the user loaded, so a
 *    re-parse on the other device runs the CURRENT parser rather than
 *    replaying a cache built by an older one.
 */
export function makeCatalogueName(fileName?: string): string {
  var d = new Date();
  function pad(n: number) { return String(n).padStart(2, "0"); }
  var ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
           "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  var slug = "";
  if (fileName) {
    var ns = String(fileName).slice(0, 64).toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 16);
    if (ns) slug = "-" + ns;
  }
  return GDRIVE_CATALOGUE_PREFIX + ts + slug + ".csv";
}

// Extract the device id from an AUTO backup filename.
// Returns the id for a stamped name, or null for a legacy unstamped
// auto file (or any non-auto / malformed name). The launch-time
// multi-device guard and the auto-file sweep both branch on this.
export function autoFileDeviceId(name: string): string | null {
  if (!name || name.indexOf(GDRIVE_AUTO_PREFIX) !== 0) return null;
  var rest = name.slice(GDRIVE_AUTO_PREFIX.length);
  // Legacy: the timestamp (YYYYMMDD-HHMMSS) follows the prefix directly.
  if (/^\d{8}-\d{6}-/.test(rest)) return null;
  var m = rest.match(/^([0-9a-z]+)-\d{8}-\d{6}-/);
  return m && m[1] ? m[1] : null;
}

// The device-scoped convergence
// decisions, extracted from useGdriveSync's gdriveSaveQuiet / gdriveSave
// so the riskiest backup logic is pure + unit-testable in isolation.
// Behaviour-identical to the inline versions they replace.

// The subset of `autoFiles` (already filtered to classifyBackup === "auto")
// that THIS device may reuse or sweep: its own stamped files (matching
// deviceId) plus legacy unstamped files (adopted-and-drained). Foreign
// devices' stamped files are excluded. Input order is preserved, so the
// caller's listing order (newest-first) carries through — `[0]` is newest.
export function ownAutoFiles(autoFiles: any[], deviceId: string): any[] {
  return (autoFiles || []).filter(function (f: any) {
    if (!f) return false;
    var did = autoFileDeviceId(f.name);
    return did === deviceId || did === null;
  });
}

// Pick the auto file id this device should reuse (PATCH/overwrite) on the
// next save: the tracked `storedFid` when it still points at one of THIS
// device's OWN (or legacy-unstamped) auto files, else this device's newest
// own/legacy auto file. null → POST a fresh one.
//
// Hardened (review fix): `storedFid` is matched against `ownAutoFiles`, NOT
// the full listing. Opening the restore/manage picker can leave AUTO_FID_KEY
// pointing at a FOREIGN device's auto file (the picker sorts device-agnostic
// and used to stamp the newest); trusting that here would make the next quiet
// save overwrite another device's backup — the exact multi-device-safety
// invariant this must never break.
export function chooseAutoSaveTarget(
  autoFiles: any[], storedFid: string | null, deviceId: string,
): string | null {
  var own = ownAutoFiles(autoFiles || [], deviceId);
  var matched = storedFid && own.find(function (f: any) { return f && f.id === storedFid; });
  if (matched) return storedFid;
  return (own[0] && own[0].id) || null;
}

// Pick the single auto file id this device keeps when tidying (manual save
// + the quiet sweep's keepId): its newest own/legacy auto file, or null.
export function pickKeepAuto(autoFiles: any[], deviceId: string): string | null {
  var own = ownAutoFiles(autoFiles, deviceId);
  return (own[0] && own[0].id) || null;
}

// Extract counts encoded in a backup filename. Returns null if the name
// has no count suffix (legacy files written before this format).
// The human-readable device-name slug `makeBackupName` appends
// at the TAIL of every backup filename. It is the ONLY way another
// device's name can reach this one — the name itself is device-local
// (`cave-device-name`, never in the payload) — so the sync diagnostic and the
// backups list read it from here to label a foreign device instead of showing
// an opaque id. Display-only: the id stays the convergence identity.
//
// Deliberately mirrors parseBackupCounts' trailing group so the two can't
// disagree about where the counts end and the name begins. Returns "" when the
// file carries no slug (a legacy backup, or one written before the device was
// named) — never a guess.
export function backupDeviceName(name: string): string {
  if (!name) return "";
  var m = String(name).match(/-t\d+-p\d+-w\d+-a\d+-j\d+-([a-z0-9]+)\.json$/);
  return m && m[1] ? m[1] : "";
}

export function parseBackupCounts(name: string): null | {
  tobaccos: number; pipes: number; wishlist: number;
  accessories: number; sessions: number;
} {
  if (!name) return null;
  // Tolerate an optional trailing device-name slug (`-<a-z0-9…>`)
  // between the `-jN` counts and `.json` (see makeBackupName). `-j(\d+)` still
  // stops at the first non-digit, so the counts parse is unchanged.
  var m = String(name).match(/-t(\d+)-p(\d+)-w(\d+)-a(\d+)-j(\d+)(?:-[a-z0-9]+)?\.json$/);
  if (!m) return null;
  // Cap each count at 1M. A forged filename like
  // `cave-tabac-t99999999999999999999-p0-…` would otherwise round
  // through Number → `Infinity` and break the picker UI. The cap
  // is well above any realistic inventory (a maxed-out user has
  // ≤ a few thousand of any kind).
  function cap(s: string): number {
    var n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000) : 0;
  }
  return {
    tobaccos: cap(m[1] || ""), pipes: cap(m[2] || ""), wishlist: cap(m[3] || ""),
    accessories: cap(m[4] || ""), sessions: cap(m[5] || ""),
  };
}

// Classify a backup filename. Drives the per-type rotation caps and the
// picker's 🔄 / 💾 badging.
/**
 * Which STREAM a cloud file belongs to.
 *
 * The `"catalogue"` case is load-bearing rather
 * than descriptive. Before it, this function returned `"manual"` for anything
 * not starting with the auto prefix — so a catalogue file would have been
 * swept by `pruneByType(files, "manual", …)`, i.e. **the user's catalogue
 * would have been deleted from the cloud by their own cellar saves**, silently,
 * after three. Order matters: the catalogue test comes FIRST, because its
 * prefix must never fall through to the manual default.
 */
export function classifyBackup(name: string): "auto" | "manual" | "catalogue" {
  if (!name) return "manual";
  if (name.indexOf(GDRIVE_CATALOGUE_PREFIX) === 0) return "catalogue";
  if (name === GDRIVE_AUTO_FILENAME) return "auto";
  if (name.indexOf(GDRIVE_AUTO_PREFIX) === 0) return "auto";
  return "manual";
}

// Wrap fetch with an AbortController that aborts after
// `timeoutMs` (default 20s). Without this, a fetch on a slow or
// captive network can hang for 60+ seconds, blocking the PWA main
// thread. Returns a promise that rejects with an AbortError when
// the timeout fires. Use everywhere except the two long-running
// download paths (180s / 30s explicit timeouts) which already have
// their own AbortController. Falls back to bare fetch if
// AbortController is unavailable (vanishingly rare).
export function fetchWithTimeout(url: any, opts: any, timeoutMs: number = 20000): Promise<Response> {
  var ctrl: AbortController | null = null;
  try { ctrl = new AbortController(); } catch (_e) {}
  if (!ctrl) return fetch(url, opts || {});
  var timer: ReturnType<typeof setTimeout> | null = setTimeout(function () {
    try { ctrl!.abort(); } catch (_e) {}
    timer = null;
  }, timeoutMs);
  var merged = Object.assign({}, opts || {}, { signal: ctrl.signal });
  return fetch(url, merged).finally(function () {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}

// Network retry wrapper: re-attempts a failed fetch up to `n` times
// with a 1.5s pause. Rationale: it uses fetchWithTimeout
// so retried fetches inherit the 20s guard — without it a network that's
// both lossy AND slow would loop through retry x hanging-fetch for
// minutes. (Moved here from useGdriveSync.ts.)
export function fetchRetry(url: any, opts: any, n: any): any {
  return fetchWithTimeout(url, opts).catch(function (e) {
    if ((n || 0) > 0)
      return new Promise(function (r) {
        setTimeout(r, 1500);
      }).then(function () {
        return fetchRetry(url, opts, (n || 0) - 1);
      });
    throw e;
  });
}

// Multi-device guard. Given the provider's file listing,
// decide whether a cloud backup exists that is meaningfully NEWER than
// anything this device has saved or acknowledged. Pure so the decision
// table is unit-testable:
//   - localRefTs   = max(last auto-save ts, last manual export ts) on
//                    THIS device — 0 when the device never saved.
//   - dismissedTs  = the backup ts the user last dismissed (or the ts
//                    written after a successful restore). A backup must
//                    be strictly newer than this to resurface.
//   - marginMs     = clock-skew / same-save tolerance. A backup written
//                    by this very device lands within seconds of
//                    localRefTs; the margin keeps it from self-flagging.
//   - ownDeviceId  = THIS device's id. Auto files stamped
//                    with it are this device's OWN backups and must never
//                    be flagged as "newer cloud backup" — even when the
//                    local last-save timestamp failed to advance (e.g. an
//                    auto-save whose upload succeeded but whose success
//                    path was interrupted). Without this, a device's own
//                    auto file appeared "newer than my last save" and the
//                    multi-device banner fired on a single-device setup.
//                    Foreign-stamped files always qualify normally.
//   - ownStampedSince = this WAS a boolean `ownStamped`, and that
//                    made the guard SILENT FOR EVER on a whole class of live
//                    device. The predicate "unstamped AUTO file" cannot tell
//                    OUR OWN legacy file from ANOTHER device that has lost its
//                    `cave-device-id` (ITP eviction, site-data clear, a storage
//                    error) and is therefore writing legacy-shaped names TODAY.
//                    Once this device had stamped even once, every such file was
//                    dropped — so a second device that lost its id could save
//                    all week and never be announced. The header below framed it
//                    as self-correcting "when the foreign device updates"; a
//                    live device that simply lost its id never corrects.
//                    Now a TIMESTAMP: the moment this device started stamping.
//                    An unstamped auto file OLDER than that moment can be our
//                    own pre-stamping leftover, so it is still skipped; one
//                    NEWER than it cannot be — we have been stamping since —
//                    so it is a foreign device and must be surfaced. 0 /
//                    undefined = never stamped, skip nothing.
//   - (historical)  = when true (this device has
//                    written at least one device-stamped auto file —
//                    `cave-auto-stamped`), ALSO skip this device's own
//                    LEGACY (unstamped) AUTO files. A stamped device drains
//                    its own legacy autos on every save, so a leftover
//                    unstamped auto file it sees at launch is almost always
//                    its own not-yet-drained file after a clock skew —
//                    skipping it stops a single-device user being nagged to
//                    "restore" their own data. MANUAL backups (also
//                    deviceId-less) are NEVER skipped — only files that
//                    classify as `auto`. The small cost is that a foreign
//                    device still on a pre-device-id release won't trip the
//                    banner until it updates and re-saves a stamped file
//                    (self-correcting, no data loss).
// Returns the newest qualifying file ({name, modifiedTime, ts}) or null.
export function findNewerCloudBackup(
  files: any[] | null | undefined,
  localRefTs: number,
  dismissedTs: number,
  marginMs: number = 120000,
  dismissedName?: string | null,
  ownDeviceId?: string | null,
  ownStampedSince?: number,
): { id: string; name: string; modifiedTime: string; ts: number } | null {
  // `id` is the provider file handle so the caller can
  // fetch the payload directly when the user accepts the Home banner
  // (one-tap auto-restore — see `restoreCloudNewerBackup`).
  // `dismissedName` is the SKEW-PROOF dedup key. A file
  // whose name matches the last dismissed one is skipped regardless of
  // ts — protects against clock-skew banner spam on multi-device setups.
  var best: { id: string; name: string; modifiedTime: string; ts: number } | null = null;
  (files || []).forEach(function (f: any) {
    if (!f || !f.name || !f.modifiedTime) return;
    if (dismissedName && String(f.name) === dismissedName) return;
    // The CATALOGUE stream is not a cellar backup and must
    // never be offered as one. Without this the launch banner would propose
    // restoring a CSV, and its « Restaurer » button stages an import of the
    // whole cellar. `stageImport` would refuse the payload, so the
    // user would get a banner that cannot do what it says — which is why this
    // is an exclusion here rather than a rejection downstream.
    if (classifyBackup(f.name) === "catalogue") return;
    // Never flag this device's own stamped auto file.
    if (ownDeviceId && autoFileDeviceId(f.name) === ownDeviceId) return;
    // Once stamped, also skip our own legacy
    // unstamped AUTO files (not manual backups).
    var ts = new Date(f.modifiedTime).getTime();
    if (isNaN(ts)) return;
    // Only a file OLDER than the moment we started stamping can be
    // our own pre-stamping leftover. See the ownStampedSince note above.
    if (ownStampedSince && classifyBackup(f.name) === "auto"
        && autoFileDeviceId(f.name) === null && ts <= ownStampedSince) return;
    if (ts <= (localRefTs || 0) + marginMs) return;
    if (ts <= (dismissedTs || 0)) return;
    if (!best || ts > best.ts) {
      best = {
        id: String(f.id || ""),
        name: String(f.name),
        modifiedTime: String(f.modifiedTime),
        ts: ts,
      };
    }
  });
  return best;
}

// Read-only diagnostic. Explains, for EVERY cloud file, why
// the multi-device launch banner would propose or ignore it — mirroring
// findNewerCloudBackup's filter ladder exactly so the two stay in lock-step
// (locked by a consistency test: the `proposed` row === findNewerCloudBackup's
// hit for the same inputs). Powers the Settings → Diagnostic sync panel so a
// multi-device banner mystery is self-diagnosable on-device instead of by
// guesswork. Reason codes are stable identifiers the view maps to i18n.
export interface CloudBackupDiag {
  id: string;
  name: string;
  modifiedTime: string;
  ts: number;                 // 0 when the date is unparseable
  deviceId: string | null;    // autoFileDeviceId(name)
  // The human-readable slug from the filename tail, "" when absent.
  deviceName: string;
  // "catalogue" is the user's own reference catalogue,
  // a separate stream that the cellar guard must ignore.
  kind: "auto" | "manual" | "catalogue";
  /** Byte count as the provider reported it, "" when it reported none. */
  size: string;
  counts: ReturnType<typeof parseBackupCounts>;
  status: "proposed" | "candidate" | "ignored";
  // proposed | candidate | own_device | own_legacy | dismissed_name
  //  | dismissed_ts | older | bad_date | catalogue
  reason: string;
}

// Per-DEVICE roll-up of the diagnostic rows. Instead of a raw
// file-by-file list, group the cloud backups by the device that wrote them
// (`autoFileDeviceId`) and report each device's newest save + file count — so
// "appareil A a sauvegardé le …" reads at a glance. Unstamped files (manual
// backups + legacy pre-device-id auto files) are grouped by KIND under the
// null bucket so a manual pile doesn't merge with legacy auto files. Sorted
// newest-first. Pure — derived from the same rows the panel already has.
export interface CloudDeviceSummary {
  deviceId: string | null;   // null = unstamped (manual / legacy auto)
  // The name that device wrote into its filenames, "" when it has
  // never named itself. This is the ONLY channel by which a foreign device's
  // name reaches this one — the name is device-local and never in the payload.
  deviceName: string;
  isOwn: boolean;
  kind: "auto" | "manual" | "catalogue" | "mixed";
  count: number;
  latestTs: number;          // 0 when no parseable date
}
export function summariseCloudDevices(
  rows: CloudBackupDiag[] | null | undefined,
  ownDeviceId?: string | null,
): CloudDeviceSummary[] {
  var by: Record<string, CloudDeviceSummary> = Object.create(null);
  (rows || []).forEach(function (r) {
    if (!r) return;
    var dev = r.deviceId != null ? r.deviceId : null;
    var nm = r.deviceName || "";
    // An UNSTAMPED file (every manual backup — only auto names
    // carry a device id) still says which device wrote it, in the name slug.
    // Bucket those by name so "3 sauvegardes manuelles" stops hiding that two
    // of them are the iPhone's and one is the iPad's — precisely the question
    // this panel exists to answer. Nameless unstamped files keep the old
    // group-by-kind bucket. The NUL prefix keeps that bucket in a namespace no
    // user string can collide with.
    var key = dev != null ? "dev:" + dev
      : nm ? "nm:" + nm
      : " " + (r.kind || "unknown");
    var e = by[key];
    if (!e) {
      e = by[key] = {
        deviceId: dev,
        deviceName: nm,
        isOwn: dev != null && !!ownDeviceId && dev === ownDeviceId,
        kind: r.kind || "auto",
        count: 0,
        latestTs: 0,
      };
    } else if (e.kind !== r.kind) {
      e.kind = "mixed";
    }
    e.count++;
    // Prefer the name from the NEWEST file — a renamed device should read under
    // its current name, not the one it had a year ago.
    if (nm && r.ts >= e.latestTs) e.deviceName = nm;
    if (r.ts > e.latestTs) e.latestTs = r.ts;
  });
  return Object.keys(by).map(function (k) { return by[k]!; })
    .sort(function (a, b) { return b.latestTs - a.latestTs; });
}

export function explainCloudBackups(
  files: any[] | null | undefined,
  localRefTs: number,
  dismissedTs: number,
  marginMs: number = 120000,
  dismissedName?: string | null,
  ownDeviceId?: string | null,
  ownStampedSince?: number,
): CloudBackupDiag[] {
  var rows: CloudBackupDiag[] = [];
  (files || []).forEach(function (f: any) {
    if (!f || !f.name) return;
    var name = String(f.name);
    var mt = f.modifiedTime ? String(f.modifiedTime) : "";
    var parsed = mt ? new Date(mt).getTime() : NaN;
    var did = autoFileDeviceId(name);
    var kind = classifyBackup(name);
    function mk(status: CloudBackupDiag["status"], reason: string): CloudBackupDiag {
      return {
        id: String(f.id || ""), name: name, modifiedTime: mt,
        ts: isNaN(parsed) ? 0 : parsed, deviceId: did,
        deviceName: backupDeviceName(name), kind: kind,
        // Carried so ONE panel can both explain a verdict and manage the
        // files.
        //
        // The sentence that stood here — "the listing has always had it; this
        // row simply dropped it" — was FALSE, and corrected in place because
        // it sent the next reader looking in the wrong file. Drive applies the
        // `fields` mask VERBATIM, and the three listings that feed this
        // function asked for `files(id,name,modifiedTime)`: the size was never
        // requested, so `f.size` was `undefined` and every Drive row rendered
        // sizeless with a "—" total. Dropbox worked throughout, its adapter
        // ignoring the mask — which is exactly how a wiring gap survives a
        // reading. The masks now ask for `size`; the fixtures that build rows
        // by hand could never have caught this.
        // "" when the provider omits it (Drive does on some folder entries).
        size: f.size === undefined || f.size === null ? "" : String(f.size),
        counts: parseBackupCounts(name), status: status, reason: reason,
      };
    }
    // Same order as findNewerCloudBackup — keep in sync.
    if (!mt || isNaN(parsed)) { rows.push(mk("ignored", "bad_date")); return; }
    if (dismissedName && name === dismissedName) { rows.push(mk("ignored", "dismissed_name")); return; }
    // Mirror findNewerCloudBackup's catalogue exclusion. The whole
    // value of this diagnostic is that it reproduces that ladder exactly; a
    // rung missing here would explain a decision the guard did not make.
    if (kind === "catalogue") { rows.push(mk("ignored", "catalogue")); return; }
    if (ownDeviceId && did === ownDeviceId) { rows.push(mk("ignored", "own_device")); return; }
    if (ownStampedSince && kind === "auto" && did === null
        && !isNaN(parsed) && parsed <= ownStampedSince) { rows.push(mk("ignored", "own_legacy")); return; }
    if (parsed <= (localRefTs || 0) + marginMs) { rows.push(mk("ignored", "older")); return; }
    if (parsed <= (dismissedTs || 0)) { rows.push(mk("ignored", "dismissed_ts")); return; }
    rows.push(mk("candidate", "candidate"));
  });
  // The newest eligible candidate is what the banner would actually propose.
  var bestIdx = -1, bestTs = -1;
  rows.forEach(function (r, i) {
    if (r.status === "candidate" && r.ts > bestTs) { bestTs = r.ts; bestIdx = i; }
  });
  var winner = bestIdx >= 0 ? rows[bestIdx] : null;
  if (winner) { winner.status = "proposed"; winner.reason = "proposed"; }
  var rank: Record<string, number> = { proposed: 0, candidate: 1, ignored: 2 };
  rows.sort(function (a, b) {
    return ((rank[a.status] ?? 3) - (rank[b.status] ?? 3)) || (b.ts - a.ts);
  });
  return rows;
}

// Rotation pruner: keep the newest `keep` files of `keepType`, fire
// best-effort DELETEs for the rest. Sorting is defensive — Drive
// listings already use orderBy=createdTime desc, but the caller may
// not have requested it. Token is an explicit argument (no closure
// over hook state), which is what makes this function extractable.
// Provider-aware + sequential. This used to hard-code the
// Google Drive DELETE URL and fired all deletes concurrently with
// `.catch()`. Two bugs surfaced on Dropbox: (1) the deletes hit
// `googleapis.com` with a DROPBOX token → always failed → manual files
// never rotated; (2) even on Drive, concurrent deletes are fine but
// Dropbox 429s `too_many_write_operations` on parallel writes. The fix:
// take the provider's `remove(token, id)` (passed in to keep this module
// free of a cloudProvider import / circular dep) and chain the deletes
// one at a time. Returns a promise so the caller can serialise the auto
// sweep after it.
export function pruneByType(
  files: any[],
  keepType: "auto" | "manual" | "catalogue",
  keep: number,
  token: string,
  remove: (token: string, id: string) => Promise<any>,
): Promise<void> {
  var sameType = (files || []).filter(function (f: any) {
    return classifyBackup(f.name) === keepType;
  });
  sameType.sort(function (a: any, b: any) {
    var da = a.createdTime ? new Date(a.createdTime).getTime() : 0;
    var db = b.createdTime ? new Date(b.createdTime).getTime() : 0;
    return db - da;
  });
  var toDelete = sameType.slice(Math.max(0, keep));
  return toDelete.reduce(function (chain: Promise<void>, old: any) {
    return chain.then(function () {
      if (!old || !old.id) return;
      return remove(token, old.id).then(function () {}, function () {});
    });
  }, Promise.resolve());
}
