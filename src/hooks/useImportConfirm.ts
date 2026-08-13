// useImportConfirm — shared picker state for the Replace / Merge / Cancel
// flow. Originally lived inside `useExportImport`
// for the JSON file picker; now extracted so the Google Drive restore
// path can hand off to the same picker.
//
// Two consumers stage their parsed payload here:
//   • useExportImport.doImportFile (local JSON file).
//   • useGdriveSync._applyRestoredData (Drive download → user picks
//     a backup → file contents arrive).
//
// The hook is wired in App.tsx BEFORE both other hooks, so its
// `stageImport` callback can be passed down to either as a prop. The
// resulting `importConfirm` state is exposed via ctx and the picker
// modal (in SettingsModal) doesn't care which source produced it —
// the UX is identical for JSON import and Drive restore.
import { applySettings } from "../utils/appSettings.ts";
import { lsSet } from "../utils/appStorage.ts";

// One-shot marker so the "an imported API key replaced
// yours" notice survives the reload the restore path performs. Written just
// before `location.reload()`, read and cleared once at mount by App.tsx.
// Same shape as `cave-lang-auto`. Device-local, never in backups.
export var APIKEY_REPLACED_KEY = "cave-apikey-replaced";

import React from "react";
import { INIT, PIPE_MAX_EXTRA_PHOTOS } from "../constants.ts";
import { imgCache, imgMap } from "../utils/imgCache.ts";
import { isPlausibleBackup, monotonicId, newUid } from "../utils.ts";
import { tobaccoDbCanonicalKey } from "../utils/tobaccoDb.ts";

var useState = React.useState;

// Lot-level merge identity key. When a merge matches an imported
// tobacco to an existing local one (same brand+name), its NOT-yet-present lots
// are appended so re-importing a CSV/JSON updates an existing blend's lots
// instead of discarding them. Two lots are "the same purchase" when their
// acquisition identity matches — box number + purchase/production dates +
// initial weight + price + seller. Deliberately EXCLUDES the live balance
// (`weightG`) and `status`: a lot that was smoked down or promoted cellar→jar
// since the last export must NOT re-import as a duplicate.
// Recap of what a MERGE import actually changed, delivered to the
// caller via the `onMerged` callback so the import feedback can report it.
export interface MergeSummary {
  tobaccosAdded: number;    // brand-new tabacs appended
  lotsAppended: number;     // lots added onto already-present tabacs (lot-level merge)
  blendsToppedUp: number;   // distinct already-present tabacs that gained ≥1 lot
  sessionsUpdated: number;  // deduped sessions whose fields were refreshed (enrich / LWW)
  /** Sessions ADDED whose lot ref was dropped as balance-unsafe. */
  sessionsDetached?: number;
  entitiesUpdated: number;  // Dup entities (tabac/pipe/acc/wish) refreshed by newer-import LWW
  identityConflicts: number; // Added as NEW despite an existing same-brand+name row, because the two carry DIFFERENT stable uids (see mergeRefusedByUid)
  maintenanceAppended: number; // Maintenance entries brought onto a dup-matched pipe. Nothing merged these before, so a pipe smoked on two devices silently lost one device's cleanings while the recap said "1 fiche mise à jour".
  photosAppended: number;   // Extra pipe photos (pipe.photos) brought onto a dup-matched pipe, capped at PIPE_MAX_EXTRA_PHOTOS like the form.
  tobaccosMatched: number;  // Staged tabacs that MATCHED a local row (by uid or the brand|name fallback). The CSV recap used to recompute this by dupKey against live rows, which counted an ambiguity-refused row as "already present" while a full duplicate was created.
  lotsTrashedSkipped: number; // Imported LOTS left alone because the same tin (by uid, or by acquisition key for a legacy lot) is in this device's trash. Appending them was a silent duplication of a physical tin.
  trashedSkipped: number;   // Imported rows/sessions the merge left alone because the SAME entity (by uid) is in this device's trash. Not a conflict and not an addition; the row is already in the cellar, one tap from returning.
  singleTobId?: number;     // Set iff the merge touched EXACTLY one tobacco and nothing else
}

// Numeric fields are compared by VALUE, not raw string, so a CSV round-trip
// that normalises "14.90" → "14.9" (or "50" → "50") doesn't make a re-import
// look like a different lot. Non-numeric / empty stays as a trimmed string.
function _numMergePart(v: any): string {
  var s = String(v == null ? "" : v).trim();
  if (s === "") return "";
  var n = Number(s);
  return isNaN(n) ? s.toLowerCase() : String(n);
}
// Entity last-write-wins. When a MERGE matches a dup entity
// (brand+name) and BOTH copies carry `updatedAt` AND the imported one is
// strictly newer, its DESCRIPTIVE fields overwrite the local ones. Identity +
// structural + photo fields are always preserved from local (`protectedKeys`):
// brand/name (the dedup identity), id, deletedAt, imageUrl (a CSV import blanks
// it → never let LWW erase a local photo), and per-type structural fields
// (tobacco lots, pipe maintenance/photos). Legacy rows without a stamp on
// either side fall back to add-only (never clobbered). Pure + exported for tests.
export function entityLwwNewer(local: any, imported: any): boolean {
  return !!local && !!imported
    && typeof local.updatedAt === "string"
    && typeof imported.updatedAt === "string"
    && imported.updatedAt > local.updatedAt;
}
// LABEL-CONTRACT:start merge-entity-lww — see scripts/label-contracts.json
export function applyEntityLww(
  local: any,
  imported: any,
  protectedKeys: string[],
  fillOnlyKeys?: string[],
  stickyTrueKeys?: string[],
): { row: any; changed: boolean } {
// LABEL-CONTRACT:end merge-entity-lww
  if (!entityLwwNewer(local, imported)) return { row: local, changed: false };
  var patched = Object.assign({}, local, imported);
  protectedKeys.forEach(function (k) { patched[k] = local[k]; });
  // LWW WAS PER-ROW, AND THAT SILENTLY DESTROYED PROSE.
  //
  // One `updatedAt` covers the whole row, so a device that touched ONE field
  // overwrote EVERY unprotected field, including ones it never edited. The
  // reachable sequence is ordinary: iPad writes a tasting note at 10:00;
  // iPhone — whose copy of that note is a week old — changes only the rating
  // at 10:05; a merge on the iPad replaces the whole row and the note written
  // 5 minutes ago is gone. Silently: the recap counts it as "1 fiche mise à
  // jour". The user's own hand-written prose is the one thing a sync must
  // never lose.
  //
  // There are no per-field timestamps, so we cannot know who edited what. The
  // honest resolution for free prose is therefore FILL-IF-EMPTY: an imported
  // value lands only where the local one is blank (genuine new content still
  // propagates), and never replaces text the user already has. `useDbSync`
  // holds the identical line for the identical reason — tastingNotes "is the
  // user's own prose" and it refuses to touch it.
  //
  // Deliberately NOT in this set: `description`, and `rating` / `force` /
  // `category` and the other small scalars. `description` is CATALOGUE prose,
  // not the user's — `useDbSync` syncs it from the reference catalogue and
  // refuses only `tastingNotes`, "that is the user's own prose". Freezing it
  // here would contradict that line and block a catalogue correction from
  // propagating; an existing test pinned it as overwritable and was right to.
  // The scalars Those are single deliberate acts where last-write-wins is
  // the right reading, and freezing them would make a genuine correction on
  // the other device fail to propagate.
  if (fillOnlyKeys) {
    fillOnlyKeys.forEach(function (k) {
      if (!_isBlankField(local[k])) patched[k] = local[k];
    });
  }
  // STICKY: a flag that may turn ON across a merge but never
  // OFF. Neither `protectedKeys` nor LWW is right for `catalogueLock`.
  //
  // Plain LWW loses it: `false` is the TEMPLATE default (BT/BW seed it), so a
  // device that merely changed a rating carries an unlock it never decided —
  // the fill-if-empty finding above, on a different field.
  //
  // Plain PROTECT is the same defect MIRRORED, and a test caught it before it
  // shipped: local always wins, so a lock set on one device never reaches the
  // other, whose next bulk pass then overwrites the very fiche the box was
  // ticked to protect. Silently, since that device sees no lock.
  //
  // Sticky fails toward protection, and the asymmetry is affordable BECAUSE
  // the confirm modal counts locked rows (`plan.locked`): a lock you no longer
  // want is visible and one tap away, while a lock silently lost is neither.
  if (stickyTrueKeys) {
    stickyTrueKeys.forEach(function (k) {
      if (local[k]) patched[k] = true;
    });
  }
  patched.updatedAt = imported.updatedAt;
  return { row: patched, changed: true };
}
/** Blank = absent, empty/whitespace string, or empty array (tags). */
function _isBlankField(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}
// `uid` (stable cross-device identity) is LWW-protected — the local
// row's identity must never be overwritten by an import (adoption of a uid onto
// a uid-LESS local row is handled explicitly, outside LWW).
var LWW_PROTECT_TOB = ["id", "uid", "brand", "name", "deletedAt", "imageUrl", "lots"];
var LWW_PROTECT_PIPE = ["id", "uid", "brand", "name", "deletedAt", "imageUrl", "maintenance", "photos"];
var LWW_PROTECT_ACC = ["id", "uid", "brand", "name", "deletedAt", "imageUrl"];
var LWW_PROTECT_WISH = ["id", "uid", "brand", "name", "deletedAt", "imageUrl"];
// Free prose + user collections — imported only where local is blank.
// See the STICKY block in applyEntityLww. Only the two entity types
// that carry `catalogueLock` have one; pipes and accessories have no such flag.
var LWW_STICKY_TOB = ["catalogueLock"];
var LWW_STICKY_WISH = ["catalogueLock"];
var LWW_FILL_TOB = ["tastingNotes", "notes", "tags"];
var LWW_FILL_PIPE = ["notes", "tags"];
var LWW_FILL_ACC = ["notes", "tags"];
var LWW_FILL_WISH = ["tastingNotes", "notes"];

// Tier 2: resolve which LOCAL entity an imported one is, for the
// merge. A stable `uid` match is authoritative (idempotent across devices).
// Absent that, fall back to the brand|name key ONLY when it's unambiguous on
// BOTH sides — exactly one local AND one staged row carry it — otherwise return
// undefined so the caller adds the import as a NEW row. That ambiguity guard is
// what turns the worst merge defect (two same-name blends silently collapsing +
// cross-contaminating on a multi-device merge) into a visible, recoverable
// duplicate. `uidMap`: local uid → local id. `keyIds`: brand|name → [local id…]
// (LIVE rows only). `stagedKeyCount`: brand|name → count of staged rows.
// Returns { localId, byUid } or null.
export function resolveMergeMatch(
  imp: any,
  uidMap: Record<string, any>,
  keyIds: Record<string, any[]>,
  stagedKeyCount: Record<string, number>,
  idUid?: Record<string, string>,
): { localId: any; byUid: boolean } | null {
  var iu = imp && typeof imp.uid === "string" && imp.uid ? imp.uid : "";
  if (iu && Object.prototype.hasOwnProperty.call(uidMap, iu)) {
    return { localId: uidMap[iu], byUid: true };
  }
  var k = dupKey(imp);
  var ids = keyIds[k];
  if (ids && ids.length === 1 && stagedKeyCount[k] === 1) {
    // The imported entity has a uid that did NOT
    // match locally (a matching uid would have returned above). If the sole
    // brand|name candidate ALSO carries a uid, it is necessarily a DIFFERENT
    // stable identity — two distinct entities that happen to share a name
    // (e.g. a rename on the source device freed the old name for a new tin).
    // Collapsing them would silently lose one + cross-contaminate its lots/
    // sessions. Add as new instead (the entity analogue of the session
    // distinct-uid guard). Fallback still fires when the local candidate is
    // uid-LESS (legacy → adopts the imported uid) or the import has no uid.
    if (iu && idUid) {
      var localUid = idUid[String(ids[0])];
      if (typeof localUid === "string" && localUid) return null;
    }
    return { localId: ids[0], byUid: false };
  }
  return null;
}

/**
 * Was this import refused a match ONLY because the two rows
 * carry different stable identities?
 *
 * `migrateData` backfills a RANDOM uid, so two devices that shared a cellar
 * BEFORE uids existed mint different ones for the SAME row. The merge then
 * (correctly) refuses to collapse them and adds a duplicate — silently, counted
 * only as "N tabacs ajoutés", indistinguishable from a genuine addition. A user
 * finds their cellar doubled and has no idea why.
 *
 * The refusal itself STAYS. Face to face with two same-name rows carrying
 * different identities there are two possible worlds — one row whose identity
 * diverged, or two genuinely different items — and nothing in the data
 * separates them. The two mistakes do not cost the same: a duplicate is undone
 * by deleting one, while a wrong collapse loses a row and cross-contaminates
 * its lots and sessions, irreversibly. Duplication was chosen deliberately.
 *
 * So this does not change the decision — it makes it VISIBLE. Kept as a pure
 * predicate beside `resolveMergeMatch`, with a test asserting that whenever it
 * says true, `resolveMergeMatch` really did return null (they cannot drift).
 */
export function mergeRefusedByUid(
  imp: any,
  uidMap: Record<string, any>,
  keyIds: Record<string, any[]>,
  stagedKeyCount: Record<string, number>,
  idUid?: Record<string, string>,
): boolean {
  var iu = imp && typeof imp.uid === "string" && imp.uid ? imp.uid : "";
  if (!iu || !idUid) return false;
  if (Object.prototype.hasOwnProperty.call(uidMap, iu)) return false;
  var ids = keyIds[dupKey(imp)];
  if (!ids || ids.length !== 1 || stagedKeyCount[dupKey(imp)] !== 1) return false;
  var localUid = idUid[String(ids[0])];
  return typeof localUid === "string" && !!localUid;
}

/**
 * Is this imported row an entity this device already holds IN THE
 * TRASH? Returns that row's local id, or undefined.
 *
 * `uid` ONLY, deliberately. A `brand|name` match against a trashed row was
 * refused earlier, and rightly: two rows can share a name without being the
 * same tin, so matching on it would silently swallow a genuine addition. A uid
 * is a stable identity minted once at creation — if it is the same, it is the
 * same entity, and there is nothing to add.
 *
 * A uid-LESS trashed row (a legacy cellar migrated before uids existed) is not
 * matched, so it keeps the older behaviour: the imported copy is added live.
 * Disclosed rather than guessed at — without a shared identity nothing here can
 * tell that row from a genuinely new one.
 */
export function trashedLocalIdFor(imp: any, trashedUid?: Record<string, any>): any {
  if (!trashedUid) return undefined;
  var iu = imp && typeof imp.uid === "string" && imp.uid ? imp.uid : "";
  if (!iu) return undefined;
  return Object.prototype.hasOwnProperty.call(trashedUid, iu) ? trashedUid[iu] : undefined;
}

/**
 * The OTHER refusal, and the one nothing counted.
 *
 * `resolveMergeMatch`'s `brand|name` fallback fires only when EXACTLY ONE local
 * and ONE staged row share the key (the ambiguity guard). When several
 * do, it refuses — correctly, since it cannot tell which row this is — and the
 * import is added as a NEW row beside them. That is a visible duplicate the user
 * must resolve, and `mergeRefusedByUid` could never see it: it requires the
 * import to carry a `uid` and the local candidate to be unique. A CSV row has no
 * uid at all, so for the CSV path NOTHING was counted, and the recap went on
 * announcing "already present, no new lot" while a full duplicate was created —
 * compounding, since one duplicate pair makes every later import of that blend
 * add another copy.
 *
 * Disjoint from `mergeRefusedByUid` by construction (that one requires
 * `ids.length === 1`, this one `> 1` on one side or the other), so the two can
 * feed one counter without double-counting. A row whose name matches NOTHING is
 * an ordinary addition and is not reported.
 */
export function mergeAmbiguousName(
  imp: any,
  keyIds: Record<string, any[]>,
  stagedKeyCount: Record<string, number>,
): boolean {
  var k = dupKey(imp);
  var ids = keyIds[k];
  if (!ids || !ids.length) return false;      // nothing local shares the name
  return ids.length > 1 || (stagedKeyCount[k] || 0) > 1;
}

/**
 * Acquisition-style identity for a MAINTENANCE entry that predates
 * the `uid` field. Deliberately excludes `id` (each device mints its own from
 * the same clock) and normalises the task list so ordering cannot make one entry
 * look like two.
 */
export function maintMergeKey(m: any): string {
  var tasks = Array.isArray(m && m.tasks)
    ? m.tasks.map(function (x: any) { return String(x); }).sort().join(",")
    : "";
  return [
    String((m && m.date) || "").trim(),
    String((m && m.kind) || "").trim().toLowerCase(),
    tasks,
    String((m && m.notes) || "").trim().toLowerCase(),
  ].join("|");
}

export function lotMergeKey(l: any): string {
  return [
    String(l && l.boxNumber || "").trim().toLowerCase(),
    _numMergePart(l && l.weightInitial),
    String(l && l.datePurchased || "").trim(),
    String(l && l.dateProduction || "").trim(),
    _numMergePart(l && l.price),
    String(l && l.seller || "").trim().toLowerCase(),
  ].join("|");
}

// Case-insensitive brand+name key. Empty values are normalised to "" and
// can match each other so legacy anonymous entries don't double-up on
// repeated round-trips.
export function dupKey(it: any): string {
  var b = String(it && it.brand || "").trim().toLowerCase();
  var n = String(it && it.name || "").trim().toLowerCase();
  return b + "|" + n;
}

// The tobacco/wishlist duplicate-collision lookup, shared
// by TobaccoFormView (vs tobaccos) and WishFormView (vs wishlist THEN
// tobaccos) — once 4 hand-kept copies (conv #23). A row collides when
// its literal dupKey matches OR its DB canonical key matches (so "Solani
// 131" ≡ "Solani Red Label"). Skips trashed rows and the entity being
// edited. `tobaccoDbCanonicalKey` reads a module cache that flips once the
// catalog loads — callers keep `dbReady` in their memo deps so the check
// re-runs. Returns the first colliding row or null.
export function findDuplicateEntry(
  list: any[] | null | undefined,
  brand: string,
  name: string,
  opts?: { excludeId?: any },
): any | null {
  var b = String(brand || "").trim();
  var n = String(name || "").trim();
  if (!b || !n) return null;
  var k = dupKey({ brand: b, name: n });
  var ckey = tobaccoDbCanonicalKey(b, n);
  var excludeId = opts ? opts.excludeId : undefined;
  var hit = (Array.isArray(list) ? list : []).find(function (x: any) {
    if (!x || x.deletedAt) return false;
    if (excludeId !== undefined && x.id === excludeId) return false;
    if (dupKey(x) === k) return true;
    if (ckey && tobaccoDbCanonicalKey(x.brand, x.name) === ckey) return true;
    return false;
  });
  return hit || null;
}

export interface ImportConfirmState {
  parsed: any;
  imgData: Record<string, string>;
  dupCounts: { tobaccos: number; pipes: number; wishlist: number; accessories: number };
  incoming: { tobaccos: number; pipes: number; wishlist: number; accessories: number; sessions: number };
  source: "file" | "drive";
  // The imported API key is carried through the picker and only
  // persisted when the import is actually applied (never on cancel).
  apiKey?: string | undefined;
  apiKeyProvider?: string | undefined;
  // The backup's PREFERENCES, carried through the picker like the
  // API key and applied only if the user chooses REPLACE.
  settings?: any;
}

export function useImportConfirm({
  data,
  save,
  migrateData,
  saveApiKey,
  setImgLocal,
  setImportModal,
  nav,
  t,
  setImportRecap,
  setPhotoErr,
}: {
  data: any;
  save: (d: any) => void;
  migrateData: (d: any) => any;
  saveApiKey: (k: any, provider?: string) => void;
  setImgLocal: (fn: any) => void;
  setImportModal: (v: boolean) => void;
  nav: (v: string, opts?: any) => void;
  t?: (k: string) => string;
  // Non-blocking recap sink — App passes its setImportRecap so the
  // merge outcome shows as a Notice toast instead of a native window.alert.
  // The recap carries an optional `view` so the toast can deep-link
  // to the affected list (inventory / journal).
  setImportRecap?: (r: { msg: string; view?: string; tobId?: number }) => void;
  // The app-wide photo-problem channel (App's `photoErr` →
  // CuratorPhotoErrorBanner). An import that could not persist its photos must
  // say so — see the write block in _runImport.
  // The app clears this banner with "" (not null) — see handlePhotoUpload.
  setPhotoErr?: (m: string) => void;
}) {
  var _ic = useState<null | ImportConfirmState>(null),
    importConfirm = _ic[0],
    setImportConfirm = _ic[1];

  function countDup(localArr: any[], incomingArr: any[]): number {
    var local = new Set<string>();
    (localArr || []).forEach(function (it: any) { local.add(dupKey(it)); });
    var c = 0;
    (incomingArr || []).forEach(function (it: any) {
      if (local.has(dupKey(it))) c++;
    });
    return c;
  }

  // Shape-coerce the top-level arrays so a forged JSON with
  // `tobaccos: "oops"` or `lots: null` can't crash the merge engine
  // (and the downstream renders, `migrateData`, the stats memo…).
  // `migrateData` plus the INIT defaults already cover the absence
  // case, but `Object.assign({}, INIT, staged)` lets a non-array
  // staged value override the INIT default — hence this pre-pass.
  // Nested `lots` arrays inside tobaccos get the same treatment so
  // a tobaccos[].lots = "string" can't blow up later `.forEach`.
  function sanitizeImportShape(staged: any): void {
    if (!staged) return;
    ["tobaccos", "pipes", "wishlist", "accessories", "sessions"].forEach(
      function (k) {
        if (!Array.isArray(staged[k])) staged[k] = [];
      },
    );
    staged.tobaccos.forEach(function (t: any) {
      if (t && !Array.isArray(t.lots)) t.lots = [];
    });
  }

  // Strip server-only fields from the parsed payload and stage the
  // picker. Both callers (JSON import + Drive restore) pre-parse the
  // JSON themselves and feed the canonical object in. `_apiKey` is
  // applied immediately (it's not surfaced in the picker — the user
  // already committed to that piece by picking the file/backup).
  //
  // Optional `autoApply` short-circuits the picker
  // entirely — used by the Home cloud-newer banner where the user has
  // already committed by tapping "Restaurer" and the destination of
  // the action is unambiguous (replace local with the cloud copy).
  // The Replace / Merge picker would just add an extra confirm step
  // with no useful choice — there's no other reasonable interpretation
  // of "my other device is more recent, sync me up". Merge is also
  // available as `autoApply: "merge"` for the rare caller that wants
  // a silent additive sync.
  function stageImport(
    parsed: any,
    source: "file" | "drive",
    options?: {
      autoApply?: "replace" | "merge";
      onMerged?: (summary: MergeSummary) => void;
      /** Leave the Settings modal OPEN after an auto-applied
       *  import. Default false — the historical behaviour. See `_runImport`. */
      keepModalOpen?: boolean;
    },
  ) {
    // Fail-closed front door. A payload that doesn't even look
    // like a backup (random JSON, a Drive {error}, a truthy-but-non-array
    // `tobaccos`) is refused outright instead of being silently coerced to
    // an empty import. The callers pre-check too, but this is the last line
    // of defence for any future caller that forgets.
    if (!isPlausibleBackup(parsed)) {
      // SAY SO. This returned silently, so a corrupt or wrong-shaped
      // file (a Drive `{error}` body, random JSON, a truthy-but-non-array
      // `tobaccos`) closed the picker and did nothing at all — indistinguishable,
      // from the outside, from an import that worked.
      try { window.alert(t ? t("err_import_invalid") : "Fichier invalide : ce n'est pas une sauvegarde de Ma Cave à Tabac."); } catch (_e) { /* noop */ }
      return;
    }
    // Validate `_apiKey` before persisting. A forged JSON
    // could otherwise write an arbitrary multi-MB string to the
    // localStorage key for the active AI provider. Real provider keys
    // are short ASCII tokens (Anthropic ≤ ~110, OpenAI ≤ ~60, Gemini
    // ≤ ~40); cap at 200 to leave headroom while blocking abuse.
    // Do NOT persist the API key here — stageImport
    // runs the instant a file is picked, before the user confirms. Writing it
    // now clobbered the stored key even if the user then pressed Cancel.
    // Extract + validate it, carry it through the picker / autoApply, and only
    // persist it in _runImport when the import is actually applied.
    var pendingApiKey: string | undefined;
    var pendingApiKeyProvider: string | undefined;
    if (
      parsed &&
      typeof parsed._apiKey === "string" &&
      parsed._apiKey.length > 0 &&
      parsed._apiKey.length <= 200
    ) {
      pendingApiKey = parsed._apiKey;
      // Forward the source provider (if the export recorded one)
      // so the key lands in the matching slot, not the active one.
      pendingApiKeyProvider = typeof parsed._apiKeyProvider === "string"
        ? parsed._apiKeyProvider
        : undefined;
    }
    var staged: any = Object.assign({}, parsed);
    delete staged._apiKey;
    delete staged._apiKeyProvider;
    delete staged._savedAt;
    delete staged._saveType;
    // Drop the schema-version stamp before merging so it
    // doesn't bleed into the saved data structure. Future migrations
    // will consume it here before stripping; for the current schema
    // (v6) it's informational only.
    delete staged._schemaVersion;
    // The app's PREFERENCES, carried by every export and backup.
    // Extracted here so they never bleed into the saved data structure, and
    // applied only on REPLACE — see _runImport.
    var pendingSettings: any = staged._settings;
    delete staged._settings;
    var imgData: Record<string, string> = staged._imageData || {};
    delete staged._imageData;
    // Legacy JSON exports inline base64 photos directly
    // into `imageUrl` (no `_imageData` map — that path was added later
    // for Drive). Detect those, move the blobs into `imgData` under a
    // fresh `local-photo-*` key, and replace the entity's `imageUrl`
    // with that key. Without this, the merged data hits localStorage
    // with megabytes of base64 in one row, triggers QuotaExceeded,
    // and falls back to the legacy "photos déplacées" banner — pure
    // false positive since we already know how to handle these.
    var nowSeed = Date.now();
    var seq = 0;
    function migrateInline(arr: any) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (it: any) {
        if (!it || typeof it.imageUrl !== "string") return;
        if (!/^data:image\/(jpeg|jpg|png|webp|gif);/.test(it.imageUrl)) return;
        var key = "local-photo-" + (nowSeed + (seq++));
        imgData[key] = it.imageUrl;
        it.imageUrl = key;
      });
    }
    sanitizeImportShape(staged);
    migrateInline(staged.tobaccos);
    migrateInline(staged.pipes);
    migrateInline(staged.wishlist);
    migrateInline(staged.accessories);
    var have: any = data || {};
    var dupCounts = {
      tobaccos: countDup(have.tobaccos || [], staged.tobaccos || []),
      pipes: countDup(have.pipes || [], staged.pipes || []),
      wishlist: countDup(have.wishlist || [], staged.wishlist || []),
      accessories: countDup(have.accessories || [], staged.accessories || []),
    };
    var incoming = {
      tobaccos: (staged.tobaccos || []).length,
      pipes: (staged.pipes || []).length,
      wishlist: (staged.wishlist || []).length,
      accessories: (staged.accessories || []).length,
      sessions: (staged.sessions || []).length,
    };
    if (options && options.autoApply) {
      // Refuse to silently REPLACE local data with an
      // empty staged payload. Without it, a forged backup file (all arrays
      // empty) hit the autoReplace path and wiped the cellar without a
      // word. The picker path is unchanged — the counts ARE rendered so
      // a human can see "0 tabacs" before confirming. autoApply has no
      // human in the loop here, so the guard is necessary.
      if (options.autoApply === "replace") {
        var isEmpty =
          (staged.tobaccos || []).length === 0 &&
          (staged.pipes || []).length === 0 &&
          (staged.wishlist || []).length === 0 &&
          (staged.accessories || []).length === 0 &&
          (staged.sessions || []).length === 0;
        // Count wishlist + accessories too — a user
        // whose only local data is wishes/accessories would otherwise have
        // hasLocal===false and get silently wiped by an empty replace.
        var hasLocal =
          ((data && data.tobaccos) || []).length > 0 ||
          ((data && data.pipes) || []).length > 0 ||
          ((data && data.sessions) || []).length > 0 ||
          ((data && data.wishlist) || []).length > 0 ||
          ((data && data.accessories) || []).length > 0;
        if (isEmpty && hasLocal) {
          // Surface a save-error banner via the standard channel and bail.
          try { window.alert(t ? t("alert_invalid_file") : "Fichier invalide"); } catch (_e) {}
          return;
        }
      }
      _runImport(staged, imgData, source, options.autoApply, undefined, pendingApiKey, pendingApiKeyProvider, options.onMerged, pendingSettings, !!options.keepModalOpen);
      return;
    }
    setImportConfirm({
      parsed: staged,
      imgData: imgData,
      dupCounts: dupCounts,
      incoming: incoming,
      source: source,
      apiKey: pendingApiKey,
      apiKeyProvider: pendingApiKeyProvider,
          settings: pendingSettings,
    });
  }

  function cancelImport() {
    setImportConfirm(null);
  }

  // Apply the staged import. `mode === "replace"` mirrors the legacy
  // behaviour (wipe + use imported). `mode === "merge"` keeps existing
  // tobaccos/pipes/wishlist/accessories untouched and only appends
  // entities whose brand+name key isn't already present locally.
  // Sessions are remapped via an id table — sessions referencing a
  // duplicate tobacco/pipe are rewired to the kept local id; sessions
  // referencing a newly-added tobacco/pipe get the new local id. A
  // duplicate session (same date + tobaccoId + pipeId + duration) is
  // skipped to avoid inflating the journal on round-trips.
  // Post-merge recap for the picker path — surfaces the lot-level
  // merge + session-update outcome the pre-confirm dup counts can't show.
  // Silent when nothing new landed on an existing tabac (the picker already
  // reported new tabacs/pipes/etc. before the user confirmed).
  function _mergeRecapAlert(summary: MergeSummary) {
    if (summary.lotsAppended <= 0 && summary.sessionsUpdated <= 0 && summary.entitiesUpdated <= 0
        && (summary.identityConflicts || 0) <= 0 && (summary.trashedSkipped || 0) <= 0
        && (summary.lotsTrashedSkipped || 0) <= 0
        && (summary.sessionsDetached || 0) <= 0
        && (summary.maintenanceAppended || 0) <= 0 && (summary.photosAppended || 0) <= 0) return;
    var lines: string[] = [];
    if (summary.lotsAppended > 0) {
      lines.push(String(t ? t("merge_recap_lots") : "{l} nouveau(x) lot(s) ajouté(s) à {m} tabac(s) déjà présent(s).")
        .replace("{l}", String(summary.lotsAppended))
        .replace("{m}", String(summary.blendsToppedUp)));
    }
    if (summary.entitiesUpdated > 0) {
      lines.push(String(t ? t("merge_recap_entities") : "{n} fiche(s) mise(s) à jour (version plus récente).")
        .replace("{n}", String(summary.entitiesUpdated)));
    }
    if (summary.sessionsUpdated > 0) {
      lines.push(String(t ? t("merge_recap_sessions") : "{s} séance(s) mise(s) à jour.")
        .replace("{s}", String(summary.sessionsUpdated)));
    }
    // The SILENT doubling. A same-brand+name row was added as
    // NEW because the two copies carry different stable identities — the
    // ordinary outcome for two devices that shared a cellar before uids
    // existed, since migrateData backfills a RANDOM one per device. The merge
    // is right to refuse (collapsing would lose a row irreversibly), but
    // reporting it only as "N tabacs ajoutés" is how a user finds their cellar
    // doubled months later with no explanation.
    if ((summary.identityConflicts || 0) > 0) {
      lines.push(String(t ? t("merge_recap_identity") : "{n} fiche(s) portent le même nom qu'une fiche existante sans pouvoir y être rattachées : ajoutée(s) séparément, à fusionner à la main si besoin.")
        .replace("{n}", String(summary.identityConflicts)));
    }
    // Sessions that arrived attached to a lot and had to be
    // detached. The rule doing the detaching is right — keeping a
    // reference to a lot whose local weight was never reduced for that bowl
    // overflows the balance and double-counts the stock — but it was SILENT,
    // so the other device's consumption showed up in the journal while the
    // cellar quietly stopped adding up, with nothing anywhere to explain it.
    // The line states the CONSEQUENCE (the grams are not deducted), not the
    // mechanism, because the consequence is the part the user can act on.
    if ((summary.sessionsDetached || 0) > 0) {
      lines.push(String(t ? t("merge_recap_detached") : "{n} séance(s) importée(s) ne sont rattachées à aucun lot : leur grammage n'est pas déduit de votre stock.")
        .replace("{n}", String(summary.sessionsDetached)));
    }
    // A dup pipe's maintenance log / extra photos brought over. One
    // line for both, because "what came across for my pipes" is one question.
    if ((summary.maintenanceAppended || 0) > 0 || (summary.photosAppended || 0) > 0) {
      lines.push(String(t ? t("merge_recap_pipe_detail") : "{e} entrée(s) d'entretien et {p} photo(s) de pipe ajoutées.")
        .replace("{e}", String(summary.maintenanceAppended || 0))
        .replace("{p}", String(summary.photosAppended || 0)));
    }
    // Rows the merge left alone because the same entity is in the
    // trash. Silent, this reads as "my backup did not restore my blend" — and
    // the remedy is one tap away in a place the user may not think to look.
    if ((summary.lotsTrashedSkipped || 0) > 0) {
      // A lot-level skip is not a fiche-level one — saying
      // "N éléments" for a tin the user deleted would send them looking for a
      // blend that is not in the trash.
      lines.push(String(t ? t("merge_recap_trashed_lots") : "{n} lot(s) sont déjà dans votre corbeille : rien n'a été ajouté, pour ne pas dupliquer la même boîte.")
        .replace("{n}", String(summary.lotsTrashedSkipped)));
    }
    if ((summary.trashedSkipped || 0) > 0) {
      lines.push(String(t ? t("merge_recap_trashed") : "{n} élément(s) sont déjà dans votre corbeille : rien n'a été ajouté. Restaurez-les depuis la corbeille si vous les voulez de nouveau.")
        .replace("{n}", String(summary.trashedSkipped)));
    }
    var msg = lines.join("\n");
    // Deep-link the toast to the most affected list — inventory when
    // lots/entities changed, else the journal when only sessions were updated.
    var view = (summary.lotsAppended > 0 || summary.entitiesUpdated > 0 || summary.tobaccosAdded > 0
      || (summary.identityConflicts || 0) > 0)
      ? "inv"
      : (summary.sessionsUpdated > 0 ? "journal" : undefined);
    // Prefer the non-blocking Notice toast; fall back to a native
    // alert only when no sink was wired (older callers / tests).
    if (setImportRecap) {
      // A merge concerning exactly one blend deep-links to its fiche.
      if (view) setImportRecap(summary.singleTobId != null ? { msg, view, tobId: summary.singleTobId } : { msg, view });
      else setImportRecap({ msg });
    } else try { window.alert(msg); } catch (_e) { /* alert unavailable */ }
  }

  function applyImport(mode: "replace" | "merge", selection?: Set<string>) {
    if (!importConfirm) return;
    // A hand-edited backup could THROW inside _runImport — a `null`
    // element in any staged array, or an `_imageData` that is a string — and this
    // runs in a click handler, so the exception went nowhere: nothing was
    // written, the modal simply did not respond, and no message appeared. A
    // corrupt file is now named as one. Nothing has been saved at that point
    // (`save` is the last step), so failing here is safe as well as honest.
    try {
      _runImportGuarded(mode, selection);
    } catch (_e) {
      try { window.alert(t ? t("err_import_crash") : "Import impossible : le fichier semble corrompu."); } catch (_e2) { /* noop */ }
      setImportConfirm(null);
      if (importConfirm.source === "file") setImportModal(false);
    }
  }

  function _runImportGuarded(mode: "replace" | "merge", selection?: Set<string>) {
    if (!importConfirm) return;
    _runImport(
      importConfirm.parsed,
      importConfirm.imgData,
      importConfirm.source,
      mode,
      selection,
      importConfirm.apiKey,
      importConfirm.apiKeyProvider,
      mode === "merge" ? _mergeRecapAlert : undefined,
      importConfirm.settings,
    );
  }

  // Pure mutation worker — `applyImport` is the
  // closure-over-state entry, `stageImport(..., {autoApply})` is the
  // bypass-the-picker entry. Both flow through here so the replace /
  // merge engine has a single canonical implementation.
  function _runImport(
    staged: any,
    imgData: Record<string, string>,
    source: "file" | "drive",
    mode: "replace" | "merge",
    selection?: Set<string>,
    apiKey?: string,
    apiKeyProvider?: string,
    onMerged?: (summary: MergeSummary) => void,
    settings?: any,
    keepModalOpen?: boolean,
  ) {
    // Selective restore. When `selection` is provided
    // (a Set of "kind:id" strings — same encoding as the trash
    // modal), filter the staged tobaccos / pipes / wishlist /
    // accessories / sessions arrays to keep only the picked rows
    // before the merge runs. Sessions are selectable
    // too — leaving the Sessions section empty in the picker
    // imports zero sessions (symmetric with the other four kinds).
    // A session whose referenced tabac / pipe wasn't selected ends
    // up with a dangling ref — fine under the dangling-ref policy, the
    // session's snapshot carries the brand/name/imageUrl. The
    // "replace" mode + a selection set is not meaningful (replace
    // wipes everything, so picking a subset is contradictory);
    // in that case we silently ignore the selection.
    // NOTE: an EMPTY selection Set is DELIBERATELY treated
    // as "no selection → full merge" — an intentional
    // design decision locked by the "empty selection set behaves like a
    // normal merge" test. A latent-bug audit flagged it as a possible
    // footgun, but changing it would break that documented contract, so it
    // stays. (The confirm UI is the guard against an accidental empty pick.)
    if (mode === "merge" && selection && selection.size > 0) {
      function pick(kind: string, arr: any[]) {
        return (arr || []).filter(function (it: any) {
          return it && selection!.has(kind + ":" + String(it.id));
        });
      }
      staged = Object.assign({}, staged, {
        tobaccos:    pick("tobacco",   staged.tobaccos),
        pipes:       pick("pipe",      staged.pipes),
        wishlist:    pick("wish",      staged.wishlist),
        accessories: pick("accessory", staged.accessories),
        sessions:    pick("session",   staged.sessions),
      });
    }
    var next: any;
    var mergeSummary: MergeSummary | null = null;
    // How many preferences the restore wrote (0 on a merge, and on
    // any older backup that carries no _settings block).
    var settingsApplied = 0;
    // Resolves when every imported photo has finished being written (or failed).
    // The post-restore reload waits on it — see the tail of this function.
    var photoWrites: Promise<any> = Promise.resolve();

    if (mode === "replace") {
      next = migrateData(Object.assign({}, INIT, staged));
      // A REPLACE adopts the backup's preferences — the user asked
      // to make this device look like that backup, and the cellar is being
      // wiped anyway. A MERGE deliberately does NOT: combining two cellars is
      // no reason to inherit the other device's language, theme and units.
      // Several of these are read once pre-mount (cave-lang, cave-theme), so
      // they take effect on the reload the restore path already performs.
      settingsApplied = settings ? applySettings(settings) : 0;
    } else {
      var have: any = migrateData(Object.assign({}, INIT, data || {}));
      next = Object.assign({}, have);
      var counters = {
        nxT: parseInt(have.nxT) || 1,
        nxW: parseInt(have.nxW) || 1,
        nxP: parseInt(have.nxP) || 1,
        nxA: parseInt(have.nxA) || 1,
        nxJ: parseInt(have.nxJ) || 1,
      };
      // Build the dedup maps from LIVE local rows
      // only — a soft-deleted (trashed) local row must NOT count as an
      // existing entity, else an imported live copy with the same brand|name
      // is silently dropped and its sessions get remapped onto the invisible
      // trashed row. Trashed rows are still preserved in the result arrays
      // (`newTobs`/etc. start from the full `have.*`).
      // Prototype-safe maps (Object.create(null)) — several
      // are keyed on the RAW entity id, and a forged import with a non-numeric
      // id like "__proto__" survives dedupeIds and would otherwise set the map's
      // prototype instead of an own property. Matches the codebase discipline.
      // Tier 2: per-collection identity maps for `resolveMergeMatch`.
      //   uidMap : local uid → local id (authoritative cross-device match)
      //   keyIds : brand|name → [local id…] (LIVE rows; length > 1 ⇒ ambiguous)
      // plus a staged-side brand|name count so the resolver only falls back to
      // the name key when it's unambiguous on BOTH sides. Trashed local rows are
      // excluded but still preserved in the result arrays.
      function buildLocalMaps(rows: any[]) {
        var uidMap: Record<string, any> = Object.create(null);
        var keyIds: Record<string, any[]> = Object.create(null);
        // Local id → its uid ("" when uid-less). Lets the brand|name
        // fallback refuse to collapse a staged entity onto a local row that
        // carries a DIFFERENT stable uid.
        var idUid: Record<string, string> = Object.create(null);
        // Uid → local id for the rows this map deliberately skips —
        // the TRASHED ones. `uidMap` must keep excluding them (an
        // imported LIVE copy must not be merged into, and shadowed by, an
        // invisible trashed row), but excluding them from the identity decision
        // ENTIRELY meant the backup's copy of a row you had just deleted found
        // nothing to match and was added as new, CARRYING THE SAME uid. Two rows,
        // one identity; `uidMap` is last-wins, so every later merge matched one
        // arbitrarily and left the other permanently stale.
        var trashedUid: Record<string, any> = Object.create(null);
        (rows || []).forEach(function (r: any) {
          if (!r) return;
          if (r.deletedAt) {
            if (typeof r.uid === "string" && r.uid && trashedUid[r.uid] === undefined) trashedUid[r.uid] = r.id;
            return;
          }
          if (typeof r.uid === "string" && r.uid) { uidMap[r.uid] = r.id; idUid[String(r.id)] = r.uid; }
          var k = dupKey(r);
          (keyIds[k] || (keyIds[k] = [])).push(r.id);
        });
        return { uidMap: uidMap, keyIds: keyIds, idUid: idUid, trashedUid: trashedUid };
      }
      function stagedKeyCounts(rows: any[]) {
        var c: Record<string, number> = Object.create(null);
        (rows || []).forEach(function (r: any) { var k = dupKey(r); c[k] = (c[k] || 0) + 1; });
        return c;
      }
      var tobMaps = buildLocalMaps(have.tobaccos);
      var tobStagedCount = stagedKeyCounts(staged.tobaccos);
      var pipeMaps = buildLocalMaps(have.pipes);
      var pipeStagedCount = stagedKeyCounts(staged.pipes);
      var wishMaps = buildLocalMaps(have.wishlist);
      var wishStagedCount = stagedKeyCounts(staged.wishlist);
      var accMaps = buildLocalMaps(have.accessories);
      var accStagedCount = stagedKeyCounts(staged.accessories);
      var incomingTobMap: Record<string, any> = Object.create(null);
      var incomingPipeMap: Record<string, any> = Object.create(null);
      // Imported lot id → newly-appended local lot id, keyed by
      // `<localTobId>:<importedLotId>`, so a merged session's `lotId` can be
      // re-linked to the lot that was actually appended (see the session block).
      var incomingLotMap: Record<string, any> = Object.create(null);
      // Local ids of tobaccos that were
      // ADDED wholesale this import (NOT dup-matched). An added tobacco carries
      // its imported lots + sessions as a balance-consistent unit, so those
      // sessions' lotIds are safe to keep. For a DUP-matched tobacco, a
      // session's lotId is only safe when it was re-linked to an APPENDED lot
      // (incomingLotMap); a shared/deduped lot id (the normal post-restore
      // state, hasLot === true) must be cleared to a safe orphan — otherwise
      // the foreign session's grams attribute to a local lot whose weightG was
      // never reduced → lot-balance-overflow + double-counted stock.
      var addedTobLocalIds: Record<string, true> = Object.create(null);
      // Merge recap counters — surfaced to the caller via `onMerged`
      // so the CSV/JSON import feedback can say "N nouveaux lots ajoutés à M
      // tabacs déjà présents" (the older add-only message was misleading).
      var lotsAppendedCount = 0;
      var blendsToppedUpCount = 0;
      var tobaccosAddedCount = 0;
      var sessionsUpdatedCount = 0;
      // Sessions ADDED whose lot reference had to be dropped.
      // The rule that drops it is CORRECT and is not changing —
      // keeping a lotId that points at a lot whose local weight was never
      // reduced for that bowl overflows the lot balance and double-counts
      // stock. What was wrong is that it happened SILENTLY: the other device's
      // consumption arrives in the journal but never touches your stock, and
      // the recap said nothing at all, so a cellar that quietly stops adding
      // up has no explanation anywhere.
      var sessionsDetachedCount = 0;
      var entitiesUpdatedCount = 0;
      var identityConflicts = 0;
      // Rows the import skipped because the SAME entity (by uid) is
      // sitting in this device's trash. Not a conflict and not an addition — a
      // no-op the user deserves to be told about.
      var trashedSkipped = 0;
      // Lot-level twin of `trashedSkipped` (see the lot dedup).
      var lotsTrashedSkipped = 0;
      // Staged tabacs that MATCHED a local row. Reported so the CSV
      // recap can stop recomputing "already present" by dupKey — a computation
      // that had no idea what the merge actually did.
      var tobaccosMatchedCount = 0;
      // A dup pipe's maintenance entries / extra photos brought over.
      var maintenanceAppendedCount = 0;
      var photosAppendedCount = 0;
      // Track which LOCAL tobaccos the merge touched (lots appended,
      // LWW-updated, or newly added) + whether anything NON-tobacco changed, so
      // a merge that concerns exactly ONE blend can deep-link the recap toast
      // straight to its fiche instead of the inventory list.
      var affectedTobIds: Record<string, true> = Object.create(null);
      var otherChanged = false;

      var newTobs = (have.tobaccos || []).slice();

      // The lot `uid` sets are GLOBAL, and that is not a
      // widening for its own sake: it is the scope every other consumer of a
      // lot uid already uses. `lot-uid-unique` is explicitly
      // "scoped GLOBALLY, not per tobacco, because the tins it protects can
      // end up under different rows (a merge moves them)", and
      // `restoreAllFromTrash` walks every tobacco for the same reason. The
      // dedup below was the one place that looked at ONE row's lots.
      //
      // What moves a lot between rows is `mergeDuplicates` — the app's own
      // healing tool for the cross-device doubling. It carries the `uid` onto the
      // kept row and soft-deletes the source copy. So:
      //
      //   A and B both hold the pre-uid doubling (T1 and T2, same brand|name,
      //   distinct entity uids, the tin's lot uid "u" living under T2).
      //   A merges T2 into T1  ->  "u" is live under T1, trashed under T2.
      //   A backs up. B imports it and MERGES.
      //     staged T1 matches B's T1 by uid; B's T1 has no lots, so the
      //     per-row seen-set is EMPTY and "u" is APPENDED.
      //     staged T2 matches B's T2; its lots are all deletedAt and skipped,
      //     and `deletedAt` is LWW-protected, so B's T2 keeps its live "u".
      //   B now holds the same physical tin twice — 200 g where there is 100.
      //
      // `lot-balance-overflow` cannot see it (deliberately one-sided; this is
      // an underflow) and the recap reported it as an ordinary
      // `merge_recap_lots`. `lot-uid-unique` DOES fire, which is the only
      // reason it was not silent — a post-hoc diagnostic, not a guard.
      //
      // `lotMergeKey` deliberately STAYS per-tobacco: acquisition identity
      // (box + price + dates) only means anything within one blend, and two
      // different blends bought the same day at the same price are not the
      // same tin. Only the uid is an identity.
      var globalLotUid: Record<string, true> = Object.create(null);
      var globalTrashedLotUid: Record<string, true> = Object.create(null);
      var _registerLots = function (lots: any) {
        if (!Array.isArray(lots)) return;
        lots.forEach(function (l: any) {
          if (!l || typeof l.uid !== "string" || !l.uid) return;
          if (l.deletedAt) globalTrashedLotUid[l.uid] = true;
          else globalLotUid[l.uid] = true;
        });
      };
      newTobs.forEach(function (tt: any) { if (tt) _registerLots(tt.lots); });

      (staged.tobaccos || []).forEach(function (tb: any) {
        var tobMatch = resolveMergeMatch(tb, tobMaps.uidMap, tobMaps.keyIds, tobStagedCount, tobMaps.idUid);
        if (!tobMatch && (mergeRefusedByUid(tb, tobMaps.uidMap, tobMaps.keyIds, tobStagedCount, tobMaps.idUid)
            || mergeAmbiguousName(tb, tobMaps.keyIds, tobStagedCount))) identityConflicts++;
        if (tobMatch) {
          tobaccosMatchedCount++;
          var localTobId = tobMatch.localId;
          incomingTobMap[String(tb.id)] = localTobId;
          // Adoption — a legacy uid-LESS local row matched by
          // brand|name adopts the imported uid so future syncs match by the
          // stable id (identity converges). A uid match needs no adoption.
          if (!tobMatch.byUid && typeof tb.uid === "string" && tb.uid) {
            for (var adi = 0; adi < newTobs.length; adi++) {
              if (newTobs[adi] && String(newTobs[adi].id) === String(localTobId) && !newTobs[adi].uid) {
                newTobs[adi] = Object.assign({}, newTobs[adi], { uid: tb.uid });
                break;
              }
            }
          }
          // Lot-level merge. Append the imported blend's lots that
          // aren't already present on the matched local blend (dedup by
          // `lotMergeKey`), re-stamping each with a fresh monotonic id so it
          // can't collide with a local lot id. Soft-deleted imported lots are
          // skipped. New lots carry zero local sessions (Σ=0), so appending
          // them can never break the per-lot balance invariant; a merged
          // session that referenced an APPENDED lot is re-linked below via
          // `incomingLotMap`, preserving Σ = weightInitial − weightG exactly.
          // NOTE: a session that referenced a DEDUPED lot
          // (an imported lot matching a local one by acquisition identity, so
          // NOT appended) is deliberately NOT re-linked — the two devices track
          // the same physical lot with DIVERGENT weightG, so attributing the
          // foreign session's grams to the local copy would push Σ above the
          // local weightInitial − weightG (overflow). Such a session's lotId is
          // cleared in the validation block below (a safe orphan), by design.
          if (Array.isArray(tb.lots) && tb.lots.length) {
            var lidx = -1;
            for (var li = 0; li < newTobs.length; li++) {
              if (newTobs[li] && String(newTobs[li].id) === String(localTobId)) { lidx = li; break; }
            }
            if (lidx !== -1) {
              var lt = newTobs[lidx];
              var mergedLots = (lt.lots || []).slice();
              // Uid-FIRST lot dedup. A lot's `uid`
              // identifies the SAME physical tin across devices; `lotMergeKey`
              // (acquisition identity) is the fallback for uid-LESS legacy lots
              // ONLY. Two genuinely-different tins with identical acquisition
              // data (same unnumbered box + price + dates) now carry DISTINCT
              // uids, so a device with an EXTRA such tin no longer has it
              // silently dropped on merge (the import stock-loss gap).
              // TRASHED local lots count as SEEN, and this is
              // the entity-level trashed-row fix arriving one level down.
              //
              // These sets were built from LIVE lots only, so an imported lot
              // whose twin sits in this device's trash matched nothing and was
              // APPENDED: two lots, one `uid`. Restore the trashed one and the
              // same physical tin is in the cellar twice — measured at 16 % of
              // 400 randomised two-device merges, ~123 g of ghost stock each,
              // and INVISIBLE to every net in the app (there was no
              // `lot-uid-unique` rule until it was added, and the balance
              // invariant is deliberately overflow-only while this is an
              // underflow).
              //
              // The reachable sequence is entirely ordinary: delete a lot on
              // one phone (it goes to the 30-day trash), then merge the other
              // phone's backup — or tap the cloud-newer banner's « Restaurer ».
              //
              // WHY SKIP RATHER THAN RESURRECT, exactly as was decided
              // for entities: the trashed lot IS this tin, so adding a copy
              // duplicates it, while un-deleting it would overrule a deletion
              // the user made deliberately and possibly weeks ago. It is
              // COUNTED instead, because silence here reads as "my backup did
              // not bring my tin back" while the remedy is one tap away.
              //
              // A uid-LESS trashed lot (from before lot uids) still matches only on
              // `lotMergeKey`, which is the acquisition identity and the
              // legacy fallback — disclosed, not guessed at.
              // The uid sets are the GLOBAL ones (see their
              // construction above); only the acquisition-key sets are
              // per-tobacco, which is the scope that word means.
              var seenLotKey: Record<string, true> = Object.create(null);
              var trashedLotKey: Record<string, true> = Object.create(null);
              mergedLots.forEach(function (l: any) {
                if (!l) return;
                if (l.deletedAt) { trashedLotKey[lotMergeKey(l)] = true; return; }
                seenLotKey[lotMergeKey(l)] = true;
              });
              var addedHere = 0;
              tb.lots.forEach(function (l: any) {
                if (!l || l.deletedAt) return;
                var impUid = (typeof l.uid === "string" && l.uid) ? l.uid : "";
                // Dedup decision:
                //  - imported lot HAS a uid → match by uid ONLY. Not present
                //    locally ⇒ a genuinely-NEW tin ⇒ APPEND (even if its
                //    acquisition key collides with a local lot). Present ⇒ same
                //    physical lot ⇒ skip.
                //  - imported lot is uid-LESS (pre-feature backup) ⇒ match by
                //    acquisition key (the legacy behaviour).
                if (impUid) {
                  if (globalLotUid[impUid]) return;
                  if (globalTrashedLotUid[impUid]) { lotsTrashedSkipped++; return; }
                } else {
                  if (seenLotKey[lotMergeKey(l)]) return;
                  if (trashedLotKey[lotMergeKey(l)]) { lotsTrashedSkipped++; return; }
                }
                var nlid = monotonicId();
                // Keep the imported uid so a RE-import dedups by uid (idempotent);
                // mint one for a uid-less imported lot (its identity going fwd).
                var nUid = impUid || newUid();
                if (l.id !== undefined && l.id !== "") {
                  incomingLotMap[String(localTobId) + ":" + String(l.id)] = nlid;
                }
                globalLotUid[nUid] = true;   // Keep the global set live
                mergedLots.push(Object.assign({}, l, { id: nlid, uid: nUid }));
                seenLotKey[lotMergeKey(l)] = true;
                addedHere++;
              });
              if (addedHere > 0) {
                newTobs[lidx] = Object.assign({}, lt, { lots: mergedLots });
                lotsAppendedCount += addedHere;
                blendsToppedUpCount++;
                affectedTobIds[String(localTobId)] = true;
              }
            }
          }
          // Entity LWW — refresh the local blend's descriptive
          // fields from a strictly-newer imported copy (lots/photo/identity
          // preserved). Runs AFTER the lot merge so the merged `lots` survive.
          for (var tli = 0; tli < newTobs.length; tli++) {
            if (newTobs[tli] && String(newTobs[tli].id) === String(localTobId)) {
              var tres = applyEntityLww(newTobs[tli], tb, LWW_PROTECT_TOB, LWW_FILL_TOB, LWW_STICKY_TOB);
              if (tres.changed) { newTobs[tli] = tres.row; entitiesUpdatedCount++; affectedTobIds[String(localTobId)] = true; }
              break;
            }
          }
          return;
        }
        // The imported row IS a row you have in the trash. Adding it
        // would mint a second row with the same `uid`; resurrecting it would
        // override a deliberate deletion from a backup that may be a month old.
        // So: add nothing, touch nothing, and MAP to the trashed row so this
        // blend's imported sessions attach to the right entity instead of being
        // cleared to a fantôme. Counted, so the recap can say so — the row is
        // already in the cellar, one tap from returning.
        var trashedTobId = trashedLocalIdFor(tb, tobMaps.trashedUid);
        if (trashedTobId !== undefined) {
          incomingTobMap[String(tb.id)] = trashedTobId;
          trashedSkipped++;
          return;
        }
        var nid = counters.nxT++;
        incomingTobMap[String(tb.id)] = nid;
        addedTobLocalIds[String(nid)] = true; // Added-wholesale marker
        // RE-STAMP THE LOTS. Minting a fresh tobacco id and carrying
        // the lots verbatim left the added row sharing lot ids with the local
        // twin it had just refused to match — and lot ids must be unique
        // GLOBALLY (`lot-id-unique-global`), because `useTrashOps` and
        // the 30-day sweep both delete / orphan BY LOT ID ACROSS EVERY TOBACCO.
        // Consequence: purging the duplicate took the original's LIVE lot, or
        // the sweep orphaned the survivor's session with no user action at all.
        //
        // The two sibling paths already did this — the CSV importer re-stamps
        // every lot (useExportImport, under a comment describing this
        // exact damage) and the lot-level merge above re-stamps each appended
        // lot — so this was the one path that was missed. `migrateData`'s
        // `dedupeIds` does NOT cover it: its lot pass is per-TOBACCO.
        //
        // Trashed lots are re-stamped too, deliberately: a soft-deleted
        // imported lot is exactly what the user purges from the trash, and
        // `permanentlyDelete("lot", id)` is the operation that walks every
        // tobacco. `uid` is preserved — it identifies the same physical tin, so
        // a RE-import still dedups by uid and stays idempotent.
        //
        // A PIPE's `maintenance` ids deliberately get NO equivalent treatment,
        // so nobody "completes" this fix on the pipes branch below: every
        // maintenance mutation is scoped to one pipe (`_mutatePipeMaint` returns
        // `p` untouched unless `p.id === pipeId`) and neither `useTrashOps` nor
        // the 30-day sweep touches maintenance at all. A cross-pipe duplicate
        // maintenance id is therefore inert. What made lot ids dangerous was
        // never the duplication — it was the operations that filter by lot id
        // across every tobacco.
        var addedLots = Array.isArray(tb.lots)
          ? tb.lots.map(function (l: any) {
            if (!l) return l;
            var nlid = monotonicId();
            if (l.id !== undefined && l.id !== "") {
              // So this row's own sessions follow their lot to the new id.
              incomingLotMap[String(nid) + ":" + String(l.id)] = nlid;
            }
            return Object.assign({}, l, { id: nlid });
          })
          : tb.lots;
        // An added-wholesale row's lots join the global uid set
        // too, so a later staged row carrying the same tin cannot append it a
        // second time. (`staged.tobaccos` is walked in one pass, so a row
        // processed EARLIER is already registered.)
        _registerLots(addedLots);
        newTobs.push(Object.assign({}, tb, { id: nid, lots: addedLots }));
        tobaccosAddedCount++;
        affectedTobIds[String(nid)] = true;
      });
      next.tobaccos = newTobs;

      var newPipes = (have.pipes || []).slice();
      (staged.pipes || []).forEach(function (p: any) {
        var pipeMatch = resolveMergeMatch(p, pipeMaps.uidMap, pipeMaps.keyIds, pipeStagedCount, pipeMaps.idUid);
        if (!pipeMatch && (mergeRefusedByUid(p, pipeMaps.uidMap, pipeMaps.keyIds, pipeStagedCount, pipeMaps.idUid)
            || mergeAmbiguousName(p, pipeMaps.keyIds, pipeStagedCount))) identityConflicts++;
        if (pipeMatch) {
          var localPipeId = pipeMatch.localId;
          incomingPipeMap[String(p.id)] = localPipeId;
          // Adopt the imported uid onto a legacy uid-less local pipe.
          if (!pipeMatch.byUid && typeof p.uid === "string" && p.uid) {
            for (var pad = 0; pad < newPipes.length; pad++) {
              if (newPipes[pad] && String(newPipes[pad].id) === String(localPipeId) && !newPipes[pad].uid) {
                newPipes[pad] = Object.assign({}, newPipes[pad], { uid: p.uid });
                break;
              }
            }
          }
          // MERGE the pipe's maintenance log and its extra photos.
          //
          // `LWW_PROTECT_PIPE` shields both from being OVERWRITTEN — right, since
          // a whole-row overwrite would drop whatever the local device logged —
          // but nothing ever merged them, so a dup-matched pipe silently kept
          // only the local set while the recap said « 1 fiche mise à jour », which
          // a user reads as "this pipe is now current". A pipe smoked on two
          // devices loses one device's cleanings outright. Same shape as the lot
          // gap the lot-level merge closed, one entity over.
          //
          // Maintenance dedups by `uid` and falls back to a CONTENT
          // key for pre-uid entries, so re-importing is idempotent either way;
          // each appended entry is re-stamped with `monotonicId()` because
          // `maintenance-id-unique` is per-pipe and the two devices mint ids from
          // the same clock. Photos dedup by the key string itself — the blob
          // travels in `_imageData` — and the union respects the same
          // `PIPE_MAX_EXTRA_PHOTOS` cap the form enforces.
          //
          // Be exact about what that cap buys, because two probes on it were
          // VACUOUS before I checked: `migrateData` ALSO caps `pipe.photos`, on
          // the staged payload AND on the merged result, so the stored gallery is
          // bounded either way. What the check here earns is a TRUTHFUL COUNT —
          // without it the recap announces 6 photos added when only 2 survived
          // the trim. That is the property the test asserts.
          for (var pmi = 0; pmi < newPipes.length; pmi++) {
            if (!newPipes[pmi] || String(newPipes[pmi].id) !== String(localPipeId)) continue;
            var lp = newPipes[pmi];
            var pPatch: any = null;

            var impMaint = Array.isArray(p.maintenance) ? p.maintenance : [];
            if (impMaint.length) {
              var mList = Array.isArray(lp.maintenance) ? lp.maintenance.slice() : [];
              var seenMUid: Record<string, true> = Object.create(null);
              var seenMKey: Record<string, true> = Object.create(null);
              mList.forEach(function (m: any) {
                if (!m) return;
                if (typeof m.uid === "string" && m.uid) seenMUid[m.uid] = true;
                seenMKey[maintMergeKey(m)] = true;
              });
              var addedM = 0;
              impMaint.forEach(function (m: any) {
                if (!m) return;
                var mu = (typeof m.uid === "string" && m.uid) ? m.uid : "";
                if (mu) { if (seenMUid[mu]) return; } else if (seenMKey[maintMergeKey(m)]) return;
                mList.push(Object.assign({}, m, { id: monotonicId() }));
                if (mu) seenMUid[mu] = true;
                seenMKey[maintMergeKey(m)] = true;
                addedM++;
              });
              if (addedM > 0) {
                pPatch = Object.assign(pPatch || {}, { maintenance: mList });
                maintenanceAppendedCount += addedM;
              }
            }

            var impPhotos = Array.isArray(p.photos) ? p.photos : [];
            if (impPhotos.length) {
              var phList = (Array.isArray(lp.photos) ? lp.photos : []).slice();
              var addedP = 0;
              impPhotos.forEach(function (k: any) {
                if (typeof k !== "string" || !k) return;
                if (phList.length >= PIPE_MAX_EXTRA_PHOTOS) return;
                if (phList.indexOf(k) !== -1) return;
                phList.push(k);
                addedP++;
              });
              if (addedP > 0) {
                pPatch = Object.assign(pPatch || {}, { photos: phList });
                photosAppendedCount += addedP;
              }
            }

            if (pPatch) { newPipes[pmi] = Object.assign({}, lp, pPatch); otherChanged = true; }
            break;
          }
          // Entity LWW for a dup pipe (maintenance/photos/identity preserved).
          for (var pi = 0; pi < newPipes.length; pi++) {
            if (newPipes[pi] && String(newPipes[pi].id) === String(localPipeId)) {
              var pres = applyEntityLww(newPipes[pi], p, LWW_PROTECT_PIPE, LWW_FILL_PIPE);
              if (pres.changed) { newPipes[pi] = pres.row; entitiesUpdatedCount++; otherChanged = true; }
              break;
            }
          }
          return;
        }
        var trashedPipeId = trashedLocalIdFor(p, pipeMaps.trashedUid);
        if (trashedPipeId !== undefined) {
          incomingPipeMap[String(p.id)] = trashedPipeId;
          trashedSkipped++;
          return;
        }
        var nid = counters.nxP++;
        incomingPipeMap[String(p.id)] = nid;
        newPipes.push(Object.assign({}, p, { id: nid }));
        otherChanged = true;
      });
      next.pipes = newPipes;

      var newWish = (have.wishlist || []).slice();
      (staged.wishlist || []).forEach(function (w: any) {
        var wishMatch = resolveMergeMatch(w, wishMaps.uidMap, wishMaps.keyIds, wishStagedCount, wishMaps.idUid);
        if (!wishMatch && (mergeRefusedByUid(w, wishMaps.uidMap, wishMaps.keyIds, wishStagedCount, wishMaps.idUid)
            || mergeAmbiguousName(w, wishMaps.keyIds, wishStagedCount))) identityConflicts++;
        if (wishMatch) {
          var localWishId = wishMatch.localId;
          // Adopt the imported uid onto a legacy uid-less local wish.
          if (!wishMatch.byUid && typeof w.uid === "string" && w.uid) {
            for (var wad = 0; wad < newWish.length; wad++) {
              if (newWish[wad] && String(newWish[wad].id) === String(localWishId) && !newWish[wad].uid) {
                newWish[wad] = Object.assign({}, newWish[wad], { uid: w.uid });
                break;
              }
            }
          }
          // Entity LWW for a dup wishlist item.
          for (var wi = 0; wi < newWish.length; wi++) {
            if (newWish[wi] && String(newWish[wi].id) === String(localWishId)) {
              var wres = applyEntityLww(newWish[wi], w, LWW_PROTECT_WISH, LWW_FILL_WISH, LWW_STICKY_WISH);
              if (wres.changed) { newWish[wi] = wres.row; entitiesUpdatedCount++; otherChanged = true; }
              break;
            }
          }
          return;
        }
        var trashedWishId = trashedLocalIdFor(w, wishMaps.trashedUid);
        if (trashedWishId !== undefined) { trashedSkipped++; return; }
        newWish.push(Object.assign({}, w, { id: counters.nxW++ }));
        otherChanged = true;
      });
      next.wishlist = newWish;

      var newAcc = (have.accessories || []).slice();
      (staged.accessories || []).forEach(function (a: any) {
        var accMatch = resolveMergeMatch(a, accMaps.uidMap, accMaps.keyIds, accStagedCount, accMaps.idUid);
        if (!accMatch && (mergeRefusedByUid(a, accMaps.uidMap, accMaps.keyIds, accStagedCount, accMaps.idUid)
            || mergeAmbiguousName(a, accMaps.keyIds, accStagedCount))) identityConflicts++;
        if (accMatch) {
          var localAccId = accMatch.localId;
          // Adopt the imported uid onto a legacy uid-less local accessory.
          if (!accMatch.byUid && typeof a.uid === "string" && a.uid) {
            for (var aad = 0; aad < newAcc.length; aad++) {
              if (newAcc[aad] && String(newAcc[aad].id) === String(localAccId) && !newAcc[aad].uid) {
                newAcc[aad] = Object.assign({}, newAcc[aad], { uid: a.uid });
                break;
              }
            }
          }
          // Entity LWW for a dup accessory.
          for (var ai = 0; ai < newAcc.length; ai++) {
            if (newAcc[ai] && String(newAcc[ai].id) === String(localAccId)) {
              var ares = applyEntityLww(newAcc[ai], a, LWW_PROTECT_ACC, LWW_FILL_ACC);
              if (ares.changed) { newAcc[ai] = ares.row; entitiesUpdatedCount++; otherChanged = true; }
              break;
            }
          }
          return;
        }
        var trashedAccId = trashedLocalIdFor(a, accMaps.trashedUid);
        if (trashedAccId !== undefined) { trashedSkipped++; return; }
        newAcc.push(Object.assign({}, a, { id: counters.nxA++ }));
        otherChanged = true;
      });
      next.accessories = newAcc;

      // Latent-bug fix: include `time` in the dedup key. Without
      // it, two genuinely distinct same-day sessions with the same tobacco,
      // pipe and duration (e.g. a morning and an evening bowl) collided and
      // the second was silently dropped on merge/re-import. `time` (the
      // HH:MM start) disambiguates them; legacy untimed sessions keep "".
      var sessKey = function (s: any) {
        return [s.date || "", s.time || "", s.tobaccoId || "", s.pipeId || "", s.duration || ""].join("|");
      };
      // Build an index of local sessions by key so a
      // dedup hit can ENRICH the local copy with optional fields the
      // imported copy carries (lat/lng, notes, rating). Without it, the
      // first device to log a session "won" — if it didn't have geo
      // and the imported copy did, the geo was silently dropped.
      var localSessByKey: Record<string, number> = Object.create(null);
      // Also index by stable uid. A uid match is authoritative; the
      // sessKey is the legacy fallback. Two sessions that BOTH carry a distinct
      // uid are never collapsed by a sessKey collision (fixes the dedup defect
      // where two real same-day/same-tob/same-pipe/same-duration bowls lost
      // one on re-import).
      var localSessByUid: Record<string, number> = Object.create(null);
      var localSessTrashedUid: Record<string, number> = Object.create(null);
      (have.sessions || []).forEach(function (s: any, i: number) {
        if (s && s.deletedAt) {
          // Same reasoning as the entities — a trashed session is
          // still the SAME session, so its backup copy must not be added again.
          // It used to be, with the same uid, so the trash accumulated one
          // duplicate per merge and "Tout restaurer" then logged the bowl twice.
          if (typeof s.uid === "string" && s.uid && localSessTrashedUid[s.uid] === undefined) {
            localSessTrashedUid[s.uid] = i;
          }
          return; // Don't dedup against a trashed session
        }
        localSessByKey[sessKey(s)] = i;
        if (s && typeof s.uid === "string" && s.uid) localSessByUid[s.uid] = i;
      });
      // Latent-bug fix: index the MERGED tobaccos + their lot ids
      // so a session's refs can be validated after remapping. See the
      // remap-or-clear block below.
      var mergedTobById: Record<string, any> = Object.create(null);
      (next.tobaccos || []).forEach(function (tb: any) {
        if (tb && tb.id !== undefined) mergedTobById[String(tb.id)] = tb;
      });
      var mergedPipeIds: Record<string, true> = Object.create(null);
      (next.pipes || []).forEach(function (p: any) {
        if (p && p.id !== undefined) mergedPipeIds[String(p.id)] = true;
      });
      var newSess = (have.sessions || []).slice();
      (staged.sessions || []).forEach(function (s: any) {
        var remapped = Object.assign({}, s);
        // Latent-bug fix: remap-or-CLEAR. A session ref is only
        // meaningful if its entity was in the import (incomingTobMap /
        // incomingPipeMap). A "fantôme" ref — the entity was permanently
        // deleted before the backup, so it's absent from the import (build-
        // 165 keeps such sessions) — MUST be cleared, NOT kept as the raw
        // imported id: both devices assign ids from 1, so that raw id
        // collides with an unrelated LOCAL entity of the same integer and
        // the session gets silently mis-attributed (wrong blend/pipe shown,
        // wrong lot debited on edit). Cleared → the session renders via its
        // stored snapshot (brand/name/imageUrl) and weight ops no-op.
        if (s.tobaccoId !== undefined && s.tobaccoId !== "") {
          remapped.tobaccoId = incomingTobMap[String(s.tobaccoId)] !== undefined
            ? incomingTobMap[String(s.tobaccoId)]
            : "";
          if (remapped.tobaccoId === "") remapped.lotId = "";
        }
        if (s.pipeId !== undefined && s.pipeId !== "") {
          remapped.pipeId = incomingPipeMap[String(s.pipeId)] !== undefined
            ? incomingPipeMap[String(s.pipeId)]
            : "";
        }
        // On a DUP-matched tobacco whose imported lots were
        // lot-level-merged, re-link the session to the freshly-appended local
        // lot id so the smoked weight stays attributed (and the per-lot
        // balance stays exact). Runs BEFORE the validation below, which then
        // finds the lot and keeps the ref.
        // Did this session arrive attached to a lot and end up
        // detached? Set below at the two clearing sites; COUNTED only if the
        // session is then ADDED — a session that dedups into a local one keeps
        // the local row untouched, so nothing was detached.
        var sessDetached = false;
        if (s.lotId !== undefined && s.lotId !== "" && remapped.lotId === "") sessDetached = true;
        var lotRelinked = false;
        if (remapped.tobaccoId !== "" && remapped.tobaccoId !== undefined
            && s.lotId !== undefined && s.lotId !== "") {
          var mappedLot = incomingLotMap[String(remapped.tobaccoId) + ":" + String(s.lotId)];
          if (mappedLot !== undefined) { remapped.lotId = mappedLot; lotRelinked = true; }
        }
        // Validate the lotId against the resolved tobacco's ACTUAL lots and its
        // BALANCE SAFETY. Clear it (→ safe orphan) unless it is provably
        // balance-safe. Two safe cases:
        //   (a) the tobacco was ADDED wholesale — its imported lots + sessions
        //       arrived as a consistent unit (Σ = weightInitial − weightG);
        //   (b) the lotId was re-linked to a freshly-APPENDED lot
        //       (incomingLotMap) — that lot carries Σlocal = 0, so attributing this
        //       session keeps the per-lot balance exact.
        // Everything else on a DUP-matched tobacco — a deduped/shared lot id
        // (the normal post-restore multi-device state, hasLot === true, whose
        // local weightG was NOT reduced for this foreign session) or a dangling
        // ref — is cleared. Earlier only
        // `!hasLot` cleared, so a shared lot id kept the ref and overflowed the
        // lot balance + double-counted stock. Fantôme pipe refs cleared above.
        if (remapped.tobaccoId !== "" && remapped.tobaccoId !== undefined
            && remapped.lotId !== undefined && remapped.lotId !== "") {
          var rtob = mergedTobById[String(remapped.tobaccoId)];
          var hasLot = !!(rtob && (rtob.lots || []).some(function (l: any) {
            return l && String(l.id) === String(remapped.lotId);
          }));
          var lotSafe = lotRelinked || addedTobLocalIds[String(remapped.tobaccoId)] === true;
          if (!hasLot || !lotSafe) { remapped.lotId = ""; sessDetached = true; }
        }
        var k = sessKey(remapped);
        // Resolve the dup — uid first (same session across devices),
        // then the sessKey fallback. But a sessKey collision is only a dup when
        // we CAN'T prove the two are distinct: if BOTH the import and the local
        // colliding session carry a uid and they differ, they are genuinely
        // different bowls → add as new (the session ambiguity guard).
        var su = (typeof remapped.uid === "string" && remapped.uid) ? remapped.uid : "";
        var existingIdx: number | undefined;
        if (su && localSessByUid[su] !== undefined) {
          existingIdx = localSessByUid[su];
        } else {
          var cand = localSessByKey[k];
          if (cand !== undefined) {
            var localCand = newSess[cand];
            if (su && localCand && typeof localCand.uid === "string" && localCand.uid && localCand.uid !== su) {
              existingIdx = undefined; // both stamped + distinct → not the same session
            } else {
              existingIdx = cand;
            }
          } else {
            existingIdx = undefined;
          }
        }
        if (existingIdx !== undefined) {
          // Enrich-on-dup: fill in lat/lng/notes/rating/location/aromas when
          // the local copy doesn't already have them.
          //
          // Last-write-wins for genuine multi-device EDITS. When
          // BOTH copies carry an `updatedAt` stamp AND the imported one is
          // strictly newer, the imported value OVERWRITES the local one even
          // if the local field is non-empty — so an edit made on another
          // device propagates on re-import. Guards keep it safe:
          //   • Only fires when both stamps are present → legacy sessions (no
          //     stamp on either side) keep the old fill-if-empty behaviour, so
          //     a stale backup can never clobber a pre-feature local edit.
          //   • Only the NON-KEY, NON-BALANCE optional fields are touched
          //     (notes / rating / geo / aromas). `date`/`time`/`tobaccoId`/
          //     `pipeId`/`duration` are the dedup key; `weightG`/`lotId` are
          //     accounting-linked (enriching them without re-debiting the lot
          //     would break Σsessions ≤ weightInitial−weightG). Those stay
          //     local-authoritative always.
          var local = newSess[existingIdx];
          var enriched = Object.assign({}, local);
          var hadEnrichment = false;
          var lww = typeof local.updatedAt === "string"
            && typeof remapped.updatedAt === "string"
            && remapped.updatedAt > local.updatedAt;
          if ((typeof local.lat !== "number" && typeof remapped.lat === "number")
              || (lww && typeof remapped.lat === "number" && remapped.lat !== local.lat)) {
            enriched.lat = remapped.lat; hadEnrichment = true;
          }
          if ((typeof local.lng !== "number" && typeof remapped.lng === "number")
              || (lww && typeof remapped.lng === "number" && remapped.lng !== local.lng)) {
            enriched.lng = remapped.lng; hadEnrichment = true;
          }
          if ((!local.notes && remapped.notes)
              || (lww && remapped.notes && remapped.notes !== local.notes)) {
            enriched.notes = remapped.notes; hadEnrichment = true;
          }
          if ((!local.rating && remapped.rating)
              || (lww && remapped.rating && remapped.rating !== local.rating)) {
            enriched.rating = remapped.rating; hadEnrichment = true;
          }
          // Carry the reverse-geocoded place parts (spot /
          // commune / country) across a merge when the local copy lacks them.
          if ((!local.locationName && remapped.locationName)
              || (lww && remapped.locationName && remapped.locationName !== local.locationName)) {
            enriched.locationName = remapped.locationName; hadEnrichment = true;
          }
          if ((!local.locationCity && remapped.locationCity)
              || (lww && remapped.locationCity && remapped.locationCity !== local.locationCity)) {
            enriched.locationCity = remapped.locationCity; hadEnrichment = true;
          }
          if ((!local.locationCountry && remapped.locationCountry)
              || (lww && remapped.locationCountry && remapped.locationCountry !== local.locationCountry)) {
            enriched.locationCountry = remapped.locationCountry; hadEnrichment = true;
          }
          // Carry the tasting-wheel aromas across a merge
          // when the local copy has none (or, under LWW, when the newer imported
          // copy carries a set — arrays are cheapest to overwrite wholesale).
          var localHasAromas = Array.isArray(local.aromas) && local.aromas.length > 0;
          var impHasAromas = Array.isArray(remapped.aromas) && remapped.aromas.length > 0;
          if ((!localHasAromas && impHasAromas) || (lww && impHasAromas)) {
            enriched.aromas = remapped.aromas.slice(); hadEnrichment = true;
          }
          if (hadEnrichment) {
            // Carry the newer stamp so a third device merging later keeps LWW
            // converging on the freshest edit.
            if (lww) enriched.updatedAt = remapped.updatedAt;
            newSess[existingIdx] = enriched;
            sessionsUpdatedCount++;
            otherChanged = true;
          }
          return;
        }
        if (trashedLocalIdFor(remapped, localSessTrashedUid) !== undefined) {
          trashedSkipped++;
          return;
        }
        remapped.id = counters.nxJ++;
        if (sessDetached) sessionsDetachedCount++;
        newSess.push(remapped);
        localSessByKey[k] = newSess.length - 1;
        // Index the freshly-added session by uid too so a later
        // staged session with the same uid (duplicate within one import) dedups.
        if (su) localSessByUid[su] = newSess.length - 1;
        otherChanged = true;
      });
      next.sessions = newSess;

      next.nxT = counters.nxT;
      next.nxW = counters.nxW;
      next.nxP = counters.nxP;
      next.nxA = counters.nxA;
      next.nxJ = counters.nxJ;
      next = migrateData(next);
      // Hand the caller a recap of what the merge changed
      // (new tabacs, lots appended to existing tabacs, sessions refreshed) so
      // the import feedback can report it accurately.
      var affectedTobList = Object.keys(affectedTobIds);
      var singleTob = (!otherChanged && affectedTobList.length === 1)
        ? Number(affectedTobList[0])
        : undefined;
      mergeSummary = {
        identityConflicts: identityConflicts,
        trashedSkipped: trashedSkipped,
        lotsTrashedSkipped: lotsTrashedSkipped,
        tobaccosMatched: tobaccosMatchedCount,
        maintenanceAppended: maintenanceAppendedCount,
        photosAppended: photosAppendedCount,
        tobaccosAdded: tobaccosAddedCount,
        lotsAppended: lotsAppendedCount,
        blendsToppedUp: blendsToppedUpCount,
        sessionsUpdated: sessionsUpdatedCount,
        sessionsDetached: sessionsDetachedCount,
        entitiesUpdated: entitiesUpdatedCount,
        ...(singleTob != null && !isNaN(singleTob) ? { singleTobId: singleTob } : {}),
      };
    }

    save(next);
    if (mergeSummary && onMerged) onMerged(mergeSummary);

    // Persist the imported API key ONLY here, at the
    // moment the import is actually applied — never at stage/selection time,
    // so a cancelled import can't clobber the stored key. Targets the source
    // provider's slot (from the export), not the active one.
    // REPLACE ONLY, never on a merge.
    //
    // The key is excluded from exports by default (`cave-exclude-apikey`, an
    // opt-OUT), so a backup carrying one required a deliberate act from
    // whoever exported it. But the writing was mode-blind, and MERGE is
    // precisely how you accept a file from SOMEONE ELSE — combining their
    // cellar with yours. Their key then became yours: your auto-fill calls
    // billed to their account, visible in their provider console, and your own
    // key overwritten with nothing on the device to recover it from. It was
    // made to announce itself, which helps, but the notice arrives after the
    // write and reads as information rather than as something to undo.
    //
    // The split is NOT invented here — it is the rule already made
    // for `_settings`, one storey up and for the same question: a REPLACE
    // adopts the backup's device configuration (you asked to make this device
    // look like that backup, and the cellar is being wiped anyway) while a
    // MERGE does not, because combining two cellars is no reason to inherit
    // the other device's language, theme and units. An API key is the same
    // class of thing, with money and a billing account attached.
    var apiKeyReplaced = false;
    if (apiKey && saveApiKey && mode === "replace") {
      saveApiKey(apiKey, apiKeyProvider);
      apiKeyReplaced = true;
      // Say so. The key is excluded from exports by DEFAULT, so a
      // backup that carries one is unusual — and it silently replaced whatever
      // this device had, which is a setting the user chose and pays for.
      if (setImportRecap) {
        setImportRecap({ msg: String(t ? t("import_apikey_replaced") : "La clé API du fichier a remplacé celle de cet appareil (Paramètres → Données → IA).") });
      }
    }

    // Per-image byte cap. A regex-valid but multi-hundred-MB
    // base64 blob in a forged/oversized backup would otherwise be written to
    // IndexedDB and could exhaust the quota, evicting real photos. Uploaded
    // photos are canvas-resized to ~800px JPEG (well under 3 MB); 15 MB leaves
    // generous headroom for legacy full-res inline photos while bounding abuse.
    var IMG_MAX_BYTES = 15 * 1024 * 1024;
    var iKeys = Object.keys(imgData).filter(function (k) {
      return (
        k.indexOf("local-photo-") === 0 &&
        typeof imgData[k] === "string" &&
        (imgData[k] as string).length <= IMG_MAX_BYTES &&
        /^data:image\/(jpeg|jpg|png|webp|gif);/.test(imgData[k] as string)
      );
    });
    if (iKeys.length) {
      setImgLocal(function (prev: any) {
        var n = imgMap(prev);
        iKeys.forEach(function (k) {
          n[k] = imgData[k];
        });
        return n;
      });
      // COUNT the write failures and say so.
      //
      // `imgCache.put` RESOLVES `false` on a transaction error or abort (quota
      // exceeded, private mode) — it only REJECTS when `open()` fails. So a
      // `.catch` alone sees almost nothing, which is the rule CLAUDE.md
      // states and this caller did not follow: it inspected the
      // resolution not at all.
      //
      // Why that was the worst possible shape: `save(next)` has ALREADY run, so
      // every row now points at a `local-photo-*` key, and the in-memory
      // `imgLocal` map above serves those photos for the rest of the session.
      // The restore therefore looked perfect until the next launch, at which
      // point every photo was a placeholder — permanently, with the import
      // having reported success.
      //
      // Failures are still swallowed per-photo (one bad blob must not surface as
      // an unhandled rejection mid-import, the original reason for the .catch);
      // what changes is that the TOTAL is reported.
      var imgFailed = 0;
      var writes = iKeys.map(function (k) {
        try {
          return Promise.resolve(imgCache.put(k, imgData[k]))
            .then(function (ok: any) { if (ok === false) imgFailed++; })
            .catch(function () { imgFailed++; });
        } catch (_e) { imgFailed++; return Promise.resolve(); }
      });
      photoWrites = Promise.all(writes).then(function () {
        if (imgFailed > 0 && setPhotoErr) {
          setPhotoErr(String(t ? t("err_photo_import_failed") : "{n} photo(s) n'ont pas pu être enregistrées — l'espace de stockage est peut-être plein. Les fiches sont importées, mais ces photos manqueront au prochain démarrage.")
            .replace("{n}", String(imgFailed)));
        }
      });
    }
    setImportConfirm(null);
    if (source === "file" && !keepModalOpen) {
      setImportModal(false);
    }
    // Why an import may now leave Settings open.
    //
    // A CSV cellar import auto-merges with no picker, and it renders its
    // row-level report as a PANEL under the button that produced it. Closing
    // the modal made that panel unreachable: the user tapped « Importer
    // tabacs », the tab shut, and the only thing left was a self-dismissing
    // toast saying how many rows were lost without saying which. Found by
    // driving the real file picker in a browser — no test could see it,
    // because the panel renders perfectly in isolation.
    //
    // The caller decides, and only for the case that needs it: a clean import
    // still closes (the toast's "Voir" chip takes you to your tobaccos, which
    // is where you want to be), and the JSON paths are untouched.
    // A REPLACE that adopted the backup's preferences RELOADS.
    //
    // An earlier comment claimed "they take effect on the reload the restore
    // path already performs" — and no import or restore path reloaded, anywhere. So after a
    // replace-restore the language, theme, light/dark mode, text size, currency,
    // date format and accounting toggle sat in localStorage while the running
    // React state kept the OLD values: the app looked unrestored until the next
    // launch. Worse, `saveWeightUnit` converts the two unit-scoped weights from
    // REACT STATE, so the next unit toggle silently discarded the restored
    // values and rewrote `cave-weight-unit` from the pre-restore state.
    //
    // WHY A RELOAD RATHER THAN THE APP SETTERS: `applySettings` writes the
    // backup's raw values, which are already consistent with each other
    // (`cave-weight-unit: "oz"` beside a default weight expressed in oz).
    // Feeding those through `saveWeightUnit` would CONVERT them a second time.
    // Routing ~20 setters while suppressing the conversions is a manual reload
    // with more ways to be wrong; four of these keys are read pre-mount
    // (main.jsx) and cannot be applied any other way at all.
    //
    // It waits for `photoWrites`: those writes are asynchronous, and reloading
    // over them would lose exactly the photos the sibling photo fix exists to
    // account for. Gated on preferences having actually LANDED, so an older
    // backup (no `_settings`) restores with no restart.
    if (settingsApplied > 0) {
      // The notice above could NEVER be seen on
      // this path, and the two conditions coincide by construction:
      // `settingsApplied` is non-zero only on a REPLACE, which is the same
      // branch that writes the key, and `collectSettings()` returns a
      // non-empty block on essentially every device (`cave-lang` is seeded
      // pre-mount on first launch), so every backup that carries `_settings`
      // carries one. `importRecap` is plain React state and the reload is scheduled in
      // a microtask, so the toast never painted.
      //
      // That mattered because the replace-only rule was then the ONLY
      // live protection on an imported key: the user's auto-fill queries — and
      // via « Scanner la boîte » their tin photos — go to the file author's
      // provider account, and their own key is overwritten with nothing on the
      // device to recover it from.
      //
      // A one-shot marker consumed at mount, exactly like `cave-lang-auto`
      // does for the language toast. Deliberately NOT a confirm:
      // the user chose this file and chose Replace, and the standing rule says
      // a replace adopts the backup's device configuration — what was broken
      // is only that the app said so where nobody could read it.
      if (apiKeyReplaced) lsSet(APIKEY_REPLACED_KEY, "1");
      Promise.resolve(photoWrites).then(function () {
        try { window.location.reload(); } catch (_e) { /* nothing sensible to do */ }
      });
      return;
    }
    // Land on Home after an import/restore. Previously navved to
    // "inv", so a restore launched from the Home cloud-newer banner moved the
    // user AWAY to the inventory — they never "returned" to Home. Home is the
    // natural post-restore landing (whole-cellar dashboard).
    nav("home");
  }

  return { importConfirm, stageImport, applyImport, cancelImport };
}
