// Storage for the USER'S reference catalogue.
//
// The app is ceasing to ship a catalogue; each user loads their own CSV. This
// module is where it lives between sessions.
//
// ── WHY IndexedDB, AND WHY BOTH FORMS ───────────────────────────────────────
// A real catalogue measured 3.77 MB of CSV, so localStorage is out — the app
// already warns at 80 % of that quota and the cellar itself lives there.
//
// Two records are kept, and the duplication is deliberate:
//
//   • the RAW CSV — the user's own file. It is what a backup carries, what
//     "export my catalogue" hands back, and the only thing that makes a
//     re-parse possible when the normalisation changes.
//   • the PARSED catalogue — a cache, stamped with `CATALOGUE_PARSER_VERSION`.
//     MEASURED: parsing 1594 rows takes 0.5-1.2 s on a desktop, several times
//     that on a phone. Paying it on every catalogue surface would be a visible
//     hang, so it is paid ONCE, at load.
//
// They are separate KEYS rather than one record so the hot path never drags
// the 3.77 MB of CSV into memory just to read a cache.
//
// ── THE `put` CONTRACT, WHICH HAS BITTEN TWICE ──────────────────────────────
// `IDBTransaction` failure is NOT a rejection: a quota-exceeded write aborts,
// and depending on the engine that surfaces as `abort` rather than `error`. So
// every write here RESOLVES a boolean and callers must inspect it — cover
// photos were lost exactly this way (`.then` ran with `ok === false` and the
// key was confirmed for a blob that never persisted), and imported photos were
// lost again later on the other side of the same mistake.

import type { TobaccoDb } from "./tobaccoDb.ts";
import {
  parseCatalogueCsv, CATALOGUE_PARSER_VERSION,
  type CatalogueParseResult,
} from "./userCatalogue.ts";

var DB_NAME = "cave-catalogue";
var STORE = "c";
var K_CSV = "csv";
var K_PARSED = "parsed";
var K_META = "meta";

/** What the UI needs to describe what is loaded, without reading 3.77 MB. */
export interface CatalogueMeta {
  /** The file the user picked, for display only. */
  name: string;
  /** ms epoch — INJECTED by the caller, so this module stays clock-free. */
  loadedAt: number;
  blends: number;
  brands: number;
  langs: string[];
  /** Carried so the UI can still surface what the import could not read. */
  skippedNoIdentity: number;
  duplicateKeys: number;
  unknownCategories: string[];
  unknownCuts: string[];
  /** Which parser produced the cache; a mismatch forces a re-parse. */
  parserVersion: number;
  /** Raw CSV length in bytes-ish, for the storage line in Settings. */
  csvChars: number;
}

var _db: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise(function (ok, no) {
    if (_db) { ok(_db); return; }
    if (typeof indexedDB === "undefined") { no(new Error("indexedDB not available")); return; }
    var r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = function (e) {
      var d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    r.onsuccess = function (e) { _db = (e.target as IDBOpenDBRequest).result; ok(_db); };
    r.onerror = function () { no(new Error("indexedDB open failed")); };
  });
}

/** Resolves FALSE on any write failure — never rejects. See the header. */
function put(pairs: Array<[string, any]>): Promise<boolean> {
  return open().then(function (db) {
    return new Promise<boolean>(function (ok) {
      var t = db.transaction(STORE, "readwrite");
      var s = t.objectStore(STORE);
      for (var i = 0; i < pairs.length; i++) s.put(pairs[i]![1], pairs[i]![0]);
      t.oncomplete = function () { ok(true); };
      t.onerror = function () { ok(false); };
      t.onabort = function () { ok(false); };
    });
  }).catch(function () { return false; });
}

function get<T>(key: string): Promise<T | null> {
  return open().then(function (db) {
    return new Promise<T | null>(function (ok) {
      var t = db.transaction(STORE, "readonly");
      var r = t.objectStore(STORE).get(key);
      r.onsuccess = function () { ok((r.result as T) || null); };
      r.onerror = function () { ok(null); };
      t.onabort = function () { ok(null); };
    });
  }).catch(function () { return null; });
}

function del(keys: string[]): Promise<boolean> {
  return open().then(function (db) {
    return new Promise<boolean>(function (ok) {
      var t = db.transaction(STORE, "readwrite");
      var s = t.objectStore(STORE);
      for (var i = 0; i < keys.length; i++) s.delete(keys[i]!);
      t.oncomplete = function () { ok(true); };
      t.onerror = function () { ok(false); };
      t.onabort = function () { ok(false); };
    });
  }).catch(function () { return false; });
}

export interface CatalogueSaveResult {
  ok: boolean;
  /** Why it did not land. `parse` = the file is not a usable catalogue;
   *  `write` = storage refused it (quota, private mode). */
  reason: null | "parse" | "write";
  parsed: CatalogueParseResult;
  meta: CatalogueMeta | null;
}

/**
 * Validate a CSV and store it. `nowMs` is injected so this module has no clock
 * (the `applyCataloguePlan` / `parseTobaccoCsv` convention).
 *
 * NOTHING is written when the parse yields no blends: replacing a working
 * catalogue with an empty one because the user picked the wrong file is the
 * failure this guard exists for.
 */
export function catalogueSave(csvText: string, name: string, nowMs: number): Promise<CatalogueSaveResult> {
  var parsed = parseCatalogueCsv(csvText);
  if (!parsed.db || parsed.blends === 0) {
    return Promise.resolve({ ok: false, reason: "parse" as const, parsed, meta: null });
  }
  var meta: CatalogueMeta = {
    name: String(name || "").slice(0, 120),
    loadedAt: nowMs,
    blends: parsed.blends,
    brands: parsed.brands,
    langs: parsed.langs,
    skippedNoIdentity: parsed.skippedNoIdentity,
    duplicateKeys: parsed.duplicateKeys,
    unknownCategories: parsed.unknownCategories,
    unknownCuts: parsed.unknownCuts,
    parserVersion: CATALOGUE_PARSER_VERSION,
    csvChars: String(csvText || "").length,
  };
  // The CSV first: it is the source of truth, and a cache without it cannot be
  // re-parsed. One transaction, so a partial write is not possible.
  return put([[K_CSV, String(csvText)], [K_PARSED, parsed.db], [K_META, meta]])
    .then(function (wrote) {
      return wrote
        ? { ok: true, reason: null, parsed, meta }
        : { ok: false, reason: "write" as const, parsed, meta: null };
    });
}

/** The status line in Settings. Cheap — never touches the CSV or the cache. */
export function catalogueGetMeta(): Promise<CatalogueMeta | null> {
  return get<CatalogueMeta>(K_META);
}

/** The user's own file back, for re-export and for the backup payload. */
export function catalogueGetCsv(): Promise<string | null> {
  return get<string>(K_CSV);
}

/**
 * The catalogue itself, ready to serve.
 *
 * Re-parses from the stored CSV when the cache was produced by a DIFFERENT
 * parser version — otherwise a normalisation fix would never reach a catalogue
 * already loaded, and the app would go on serving a mapping the current code
 * does not agree with. The refreshed cache is written back best-effort: a
 * failure there costs a re-parse next session, never correctness.
 */
export function catalogueLoad(): Promise<TobaccoDb | null> {
  return catalogueGetMeta().then(function (meta) {
    if (!meta) return null;
    if (meta.parserVersion === CATALOGUE_PARSER_VERSION) {
      return get<TobaccoDb>(K_PARSED).then(function (db) {
        if (db && db.blends && Object.keys(db.blends).length) return db;
        // A meta with no usable cache: fall through and rebuild from the CSV.
        return reparse(meta);
      });
    }
    return reparse(meta);
  }).catch(function () { return null; });
}

function reparse(meta: CatalogueMeta): Promise<TobaccoDb | null> {
  return catalogueGetCsv().then(function (csv) {
    if (!csv) return null;
    var parsed = parseCatalogueCsv(csv);
    if (!parsed.db || !parsed.blends) return null;
    var next: CatalogueMeta = Object.assign({}, meta, {
      blends: parsed.blends,
      brands: parsed.brands,
      langs: parsed.langs,
      skippedNoIdentity: parsed.skippedNoIdentity,
      duplicateKeys: parsed.duplicateKeys,
      unknownCategories: parsed.unknownCategories,
      unknownCuts: parsed.unknownCuts,
      parserVersion: CATALOGUE_PARSER_VERSION,
    });
    // Best-effort: the catalogue is already usable in memory.
    return put([[K_PARSED, parsed.db], [K_META, next]]).then(function () { return parsed.db; });
  }).catch(function () { return null; });
}

/** Remove the user's catalogue entirely. Resolves false if storage refused. */
export function catalogueClear(): Promise<boolean> {
  return del([K_CSV, K_PARSED, K_META]);
}

/** Test-only — drops the cached connection so a fresh fake-IDB can be used. */
export function _resetCatalogueStoreForTests(): void { _db = null; }
