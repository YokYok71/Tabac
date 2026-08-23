import type { Tobacco, Lot, Pipe, Accessory } from "./types";
import { LANG } from "./i18n.ts";
import { sanitizeAromas } from "./utils/aromas.ts";
import { sanitizeTags as _sanitizeTags } from "./utils/tags.ts";
import { lsSet } from "./utils/appStorage.ts";
import { PIPE_MAX_EXTRA_PHOTOS } from "./constants.ts";
import { isLocalPhotoRef } from "./utils/imgCache.ts";

// LOCAL calendar date, not UTC. The old
// `toISOString().slice(0,10)` returned the UTC day, so a western-hemisphere
// user logging an evening session/lot (e.g. 17:00 PST = 01:00 UTC next day)
// got TOMORROW's date — landing the entry on the wrong calendar/heatmap cell
// and the wrong month/year spend bucket, and disagreeing with the tasting-end
// path (which already builds the date from local components). All the calendar
// / heatmap / stat consumers key on LOCAL day keys, so this makes `today()`
// agree with them. Mirrors the tasting-end derivation exactly.
export var today = function (): string {
  var d = new Date();
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
};

/** The LOCAL wall clock as "HH:MM" — the companion of `today()`, and the
 *  prefill for every form field that records when something happened.
 *
 *  Extracted rather than written twice: the session "+" computed this inline,
 *  and the maintenance form needed the same value the day an entry gained a
 *  time. Two copies of a clock is how the session log and the maintenance log
 *  would come to disagree about what "now" means — and those two are compared
 *  against each other by the reminder counter, which is precisely where a
 *  disagreement would be invisible and wrong. */
export var nowTime = function (): string {
  var d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

// Convert a DISPLAY-unit weight string between g and
// oz for the Settings unit toggle (sessDefaultWeight + watchLowWeight, both
// stored in the user's display unit). Returns `null` — meaning LEAVE THE STORED
// VALUE UNTOUCHED — when the input isn't a finite number (empty / garbage, so
// the read-site display default keeps applying) or when `fromUnit === toUnit`.
// Finite-guarded so a legitimate 0 converts (never substituted by a fallback),
// and oz is rounded to 2 dp so a sub-1.4 g value survives the round-trip instead
// of collapsing to "0" (the corruption this replaced: 1 g default → "0" → 85 g;
// watchLowWeight 1 g → 1418 g). Accepts a comma decimal.
export function convertWeightUnit(raw: any, fromUnit: string, toUnit: string): string | null {
  var v = parseFloat(String(raw == null ? "" : raw).replace(",", "."));
  if (!Number.isFinite(v)) return null;
  if (toUnit === "oz" && fromUnit === "g") return String(Math.round((v / 28.35) * 100) / 100);
  if (toUnit === "g" && fromUnit === "oz") return String(Math.round(v * 28.35 * 10) / 10);
  return null;
}

// Parse a stored date-only "YYYY-MM-DD" as LOCAL
// midnight (not UTC midnight). `new Date("2026-07-22")` is UTC, which — when
// diffed against a local `Date.now()` — gives a timezone-dependent off-by-one
// in day-since / pipe-rest math for users west of UTC. Appending a local time
// component anchors it to the user's wall clock. A string that already carries
// a time is parsed as-is. Returns NaN for empty/garbage.
export function parseLocalDate(d: any): number {
  var s = String(d == null ? "" : d);
  if (!s) return NaN;
  var iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s;
  return new Date(iso).getTime();
}

// Monotonic time-based id generator for entity SUB-records that
// aren't keyed by a data counter (nxT/nxP/…) — lots and pipe-maintenance
// entries, both stamped with a Date.now() id at creation. Two created in the
// same millisecond would collide on a bare Date.now(); a collision then makes
// update/remove (which match on id) hit EVERY colliding record at once. This
// returns a strictly increasing, unique value per JS context, closing that
// door. (The lot-id-unique / maintenance-id-unique invariants catch a slip.)
var _lastMonoId = 0;
export function monotonicId(): number {
  var t = Date.now();
  if (t <= _lastMonoId) t = _lastMonoId + 1;
  _lastMonoId = t;
  return t;
}
// Test-only: reset the monotonic counter so a suite asserting exact ids or
// mocking Date.now isn't perturbed by module state left over from a prior test.
export function _resetMonotonicIdForTests(): void { _lastMonoId = 0; }

// A strictly-positive integer id, or null. Non-integer strings ("T1") and
// 0 / negatives / NaN all yield null. Used to seed dedupeIds' counter above
// any existing valid numeric id.
function _idNum(x: any): number | null {
  if (typeof x === "number") return (isFinite(x) && x > 0 && Math.floor(x) === x) ? x : null;
  if (typeof x === "string" && /^\d+$/.test(x)) {
    var n = parseInt(x, 10);
    return n > 0 ? n : null;
  }
  return null;
}

// Re-stamp broken ids in `arr` IN PLACE so every record is uniquely
// identifiable. An id is "bad" — missing / empty / a non-positive number (the
// id:0 corruption class) / or a DUPLICATE of an id already kept — and gets a
// fresh id from a counter seeded above max(startAt-1, max valid id present).
// The FIRST occurrence of each valid id is kept (so a referenced primary keeps
// its links; the shadow duplicate becomes a fresh record). A unique
// non-numeric id ("T1") is left untouched. Deterministic (array order) +
// idempotent (a clean array is a no-op). Returns the next free counter so a
// caller threading a global counter (nxT…) can write it back. This is the
// generalisation of the maintenance-id repair — used for lots (per
// tobacco), maintenance (per pipe), and the five top-level collections.
export function dedupeIds(arr: any[], startAt?: number): number {
  var base = (typeof startAt === "number" && startAt > 0) ? Math.floor(startAt) : 1;
  if (!Array.isArray(arr)) return base;
  var maxId = base - 1;
  for (var i = 0; i < arr.length; i++) {
    var n = _idNum(arr[i] && arr[i].id);
    if (n !== null && n > maxId) maxId = n;
  }
  var counter = maxId + 1;
  var seen: Record<string, boolean> = Object.create(null);
  for (var j = 0; j < arr.length; j++) {
    var r = arr[j];
    if (!r || typeof r !== "object") continue;
    var raw = r.id;
    var missing = (raw === undefined || raw === null || raw === "");
    // A number ≤ 0 (or a numeric string ≤ 0) is invalid — the id:0 class.
    var asNum = (typeof raw === "number")
      ? raw
      : (typeof raw === "string" && /^-?\d+$/.test(raw) ? parseInt(raw, 10) : NaN);
    var nonPositive = !isNaN(asNum) && asNum <= 0;
    var key = String(raw);
    if (missing || nonPositive || seen[key]) {
      r.id = counter++;
      seen[String(r.id)] = true;
    } else {
      seen[key] = true;
    }
  }
  return counter;
}

// The next box number for a new lot = the largest STRICTLY-NUMERIC
// box number across every tobacco's lots + 1. Returns "" when no lot carries a
// numeric box number (the user doesn't number their boxes — don't impose one).
// Non-numeric box labels ("B-2017-12") are ignored. Shared by LotFormModal's
// add-lot prefill and addTobacco's starter lot so both paths number in lock-step.
export function nextBoxNumber(tobaccos: any[]): string {
  var mx = 0;
  var uses = false;
  (tobaccos || []).forEach(function (tb: any) {
    if (!tb || tb.deletedAt) return;
    (tb.lots || []).forEach(function (l: any) {
      if (!l || l.deletedAt) return;
      var raw = (l.boxNumber != null) ? String(l.boxNumber).trim() : "";
      if (raw === "") return;
      var nn = parseInt(raw, 10);
      if (!isNaN(nn) && String(nn) === raw) {
        uses = true;
        if (nn > mx) mx = nn;
      }
    });
  });
  return uses ? String(mx + 1) : "";
}

// First-launch UI-language detection. Maps the browser's
// preferred languages (navigator.languages, ordered by preference) to one of
// the app's supported codes, matching on the PRIMARY subtag so "fr-FR" → "fr"
// and "en-US" → "en". Falls back to English when nothing matches (per the
// product decision — en is the safe international default; fr stays canonical
// but is only auto-selected for francophone browsers). Pure + testable; the
// caller passes navigator.languages and the LANGUAGES codes.
export function detectUiLang(
  preferred: readonly string[] | undefined,
  supported: readonly string[],
): string {
  var list = preferred || [];
  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    if (!raw) continue;
    var primary = String(raw).toLowerCase().split("-")[0];
    if (primary && supported.indexOf(primary) !== -1) return primary;
  }
  return "en";
}

// Language-aware plural picker. Retires the scattered
// `n > 1 ? "s" : ""` and `lang === "fr" ? "s" : ""` suffixes that either
// appended a French "s" to every language or only pluralized French.
// French treats 0 AND 1 as singular ("0 pot", "1 pot", "2 pots"); en/es/de/it
// use the singular only for exactly 1. Callers pass the two already-translated
// forms (e.g. t("unit_lot"), t("unit_lots")).
export function plural(n: number, one: string, other: string, lang?: string): string {
  var isSingular = lang === "fr" ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return isSingular ? one : other;
}

/**
 * Compact lot age for a chip or a list line: "12j" → "3mo" → "1a 4m"
 * (moved out of InventoryDetailView so the list card and the
 * fiche render the SAME string; it used to exist only on the fiche).
 * Months are capped at 11 so 729 days can't read "1 an 12 mois".
 */
export function fmtLotAge(d: number | null | undefined, t: (k: string) => string): string {
  if (d === null || d === undefined) return "—";
  if (d < 30) return d + t("age_d");
  if (d < 365) return Math.floor(d / 30) + t("age_mo");
  var y = Math.floor(d / 365);
  var mo = Math.min(11, Math.floor((d % 365) / 30));
  return mo > 0 ? y + t("age_y") + " " + mo + t("age_m") : y + t("age_y");
}

export function daysSince(d: string): number | null {
  if (!d) return null;
  // Guard against unparseable inputs. `new Date("garbage").getTime()`
  // returns NaN; `Math.floor((Date.now() - NaN) / 864e5)` is NaN;
  // `Math.max(0, NaN)` is NaN. The function's signature is
  // `number | null` but callers assume null on parse failure — NaN
  // breaks downstream arithmetic silently. Discovered via the
  // format-helper property fuzz.
  var t = new Date(d).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

// Lang-aware date display. ISO YYYY-MM-DD strings (the storage
// format used by every `<input type="date">`) are rendered as `dd.mm.yyyy`
// in FR and `Mon D, YYYY` (English short form) in EN. Anything that
// doesn't look like an ISO date (`"inconnu"`, free text imported from
// legacy data, etc.) passes through unchanged so we never mangle user
// input. Empty string → em-dash.
var _EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(d: string, lang?: string): string {
  if (!d) return "—";
  // Tolerate non-string inputs. The signature says `string`
  // but real callers can land here with a number (e.g. a date field
  // imported as numeric, an AI auto-fill that returned a raw int) and
  // the subsequent `.split` would crash with "split is not a function".
  // Coerce to string — display behaviour stays sensible (numbers
  // pass through as their stringified form).
  if (typeof d !== "string") d = String(d);
  var p = String(d).split("-");
  if (p.length === 3) {
    var p0 = p[0] || "", p1 = p[1] || "", p2 = p[2] || "";
    if (/^\d{4}$/.test(p0) && /^\d{1,2}$/.test(p1) && /^\d{1,2}$/.test(p2)) {
      if (lang === "en") {
        var mi = parseInt(p1) - 1;
        if (mi >= 0 && mi < 12) {
          var monthName = _EN_MONTHS_SHORT[mi] || "";
          return monthName + " " + parseInt(p2) + ", " + p0;
        }
      }
      return p2 + "." + p1 + "." + p0;
    }
  }
  // MONTH precision, formatted rather than passed through raw.
  //
  // A lot's PRODUCTION date is a free-precision field on purpose — a tin is
  // often stamped 09/2017 with no day, which is why the form offers a text
  // input and `2017-09` as its placeholder, and why `daysSince` parses it. But
  // only the three-part form was ever FORMATTED, so someone who took the
  // placeholder's advice saw the raw ISO string on the fiche, directly under a
  // purchase date reading "23.03.2026" — and in English, "2017-09" beside
  // "Mar 23, 2026". The field invited a precision the display could not render.
  //
  // Reported as "why show the day at all?", which is the sharper way to put it:
  // a day now appears if and only if a day was recorded.
  if (p.length === 2) {
    var q0 = p[0] || "", q1 = p[1] || "";
    if (/^\d{4}$/.test(q0) && /^\d{1,2}$/.test(q1)) {
      var qi = parseInt(q1) - 1;
      if (qi >= 0 && qi < 12) {
        if (lang === "en") return (_EN_MONTHS_SHORT[qi] || "") + " " + q0;
        return String(q1).padStart(2, "0") + "." + q0;
      }
    }
  }
  // A bare year already reads as a year in every language, and anything else
  // is free text the user typed ("septembre 2017" — which `daysSince` still
  // dates correctly). Both pass through untouched.
  return d;
}

// Lang-aware timestamp display. Accepts a millisecond ts,
// an ISO string (the form `new Date().toISOString()` produces, used by
// the diagnostic store), or a Date object. Returns "dd.mm.yyyy HH:MM"
// in FR / "Mon D, YYYY HH:MM" in EN — i.e. fmtDate format + 24h time.
// Falls back to em-dash for null / undefined / empty / invalid inputs.
export function fmtDateTime(ts: number | string | Date | null | undefined, lang?: string): string {
  if (ts === null || ts === undefined || ts === "") return "—";
  var d = ts instanceof Date ? ts : new Date(ts);
  var t = d.getTime();
  if (isNaN(t)) return "—";
  var iso = d.getFullYear() + "-"
    + String(d.getMonth() + 1).padStart(2, "0") + "-"
    + String(d.getDate()).padStart(2, "0");
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  return fmtDate(iso, lang) + " " + hh + ":" + mm;
}

// One-shot migration helper for the `cave-date-format`
// localStorage key. Returns the value to use for
// the App's `dateFormat` state.
//   1. If `cave-date-format` is already set → return it verbatim (the
//      user's explicit choice is sacred).
//   2. Otherwise → seed it from `cave-lang` ("en" → "en", everything
//      else → "fr") and persist so the migration runs at most once.
// This lets a user upgrading from a release that predates the key avoid
// seeing their EN UI suddenly render French-style dates: their existing UI
// language picks the matching date format automatically.
export function initDateFormat(): string {
  try {
    var stored = localStorage.getItem("cave-date-format");
    if (stored === "fr" || stored === "en") return stored;
    var lang = localStorage.getItem("cave-lang");
    var seed = lang === "en" ? "en" : "fr";
    lsSet("cave-date-format", seed);
    return seed;
  } catch (_e) {
    return "fr";
  }
}

// Locale-aware numeric display. Normalises both "." and ","
// decimal inputs (the app stores user-typed strings — a user typing
// "2,5" or "2.5" should render correctly either way). Returns the
// canonical string for the active locale:
//   EN                → dot decimal ("2.5")
//   FR/ES/DE/IT/other → comma decimal ("2,5")
// Comma is the decimal separator in fr/es/de/it (and the
// default), so only English gets the dot. Originally only "fr" got the comma,
// which showed es/de/it users a dot ("2.5") where their locale expects a
// comma ("2,5"). Input normalisation already accepts both separators, so
// this is a display-only change with no round-trip risk.
// Empty / null / non-numeric inputs pass through unchanged so the
// caller never has to special-case "" or legacy free text.
export function fmtNum(v: any, lang?: string): string {
  if (v === null || v === undefined || v === "") return "";
  var s = String(v).trim();
  if (!s) return "";
  // parseFloat would silently truncate "2,5" → 2; normalise first.
  var normalized = s.replace(",", ".");
  var n = parseFloat(normalized);
  if (isNaN(n)) return s;
  var out;
  if (typeof v === "number") {
    // A COMPUTED number (e.g. a summed category stock) carries
    // floating-point accumulation noise — 2714.1 lands as 2714.1000000000001
    // and `n.toString()` would render every noise digit ("2714,1000000000…").
    // There's no user-typed precision to honour, so round to 4 dp (weights /
    // prices never need more) and drop trailing zeros. EPSILON nudge fixes the
    // classic X.5 half-even edge.
    out = String(Math.round((n + Number.EPSILON) * 1e4) / 1e4);
  } else {
    // A user-typed STRING: preserve the typed precision (trailing zeros).
    // `n.toString()` collapses "2.50" → "2.5"; honour the original trailing
    // zeros by checking the source string.
    out = n.toString();
    var mDot = normalized.match(/\.(\d+)$/);
    var dotGroup = mDot && mDot[1] ? mDot[1] : "";
    if (dotGroup.length > (String(out).split(".")[1] || "").length) {
      out = Number(n).toFixed(dotGroup.length);
    }
  }
  return lang === "en" ? out : String(out).replace(".", ",");
}

export function lotAge(l: Lot): number | null {
  return daysSince(l.dateProduction || l.datePurchased);
}

export function oldestAge(t: Tobacco): number | null {
  if (!t.lots || !t.lots.length) return null;
  var ages = t.lots
    .filter(function (l) {
      return l.status !== "finished";
    })
    .map(lotAge)
    .filter(function (a): a is number {
      return a !== null;
    });
  return ages.length ? Math.max.apply(null, ages) : null;
}

export function countByStatus(t: Tobacco, st: Lot["status"]): number {
  return (t.lots || []).filter(function (l) {
    return l.status === st;
  }).length;
}

export function countActive(t: Tobacco): number {
  return (t.lots || []).filter(function (l) {
    return l.status !== "finished";
  }).length;
}

export function hasActive(t: Tobacco): boolean {
  return (t.lots || []).some(function (l) {
    return l.status !== "finished";
  });
}

export function pipeIsActive(p: Pipe): boolean {
  return (p.status || "active") !== "finished";
}

export function accIsActive(a: Accessory): boolean {
  return (a.status || "active") !== "retired";
}

// ─── Entity helpers ───────────────────────────────────────────────────
// Extracted from dozens of drifted inline copies across App.tsx, the
// stores and the views. Each is a pure function so it stays testable and
// so the "one definition" guarantee replaces copy-paste discipline.

// String-coerced id lookup. The ~20 inline `find(x => String(x.id) ===
// String(id))` copies risked a future `===`-without-String variant that
// silently mismatches numeric-vs-string imported ids.
export function findById<T extends { id?: any }>(
  arr: T[] | null | undefined,
  id: any,
): T | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr.find(function (x) {
    return x != null && String((x as any).id) === String(id);
  });
}

// Human display label for a tobacco / pipe / accessory / wish.
// `[brand, name].filter(Boolean).join(" — ")` with an em-dash fallback.
export function entityLabel(e: any, dash: string = "—"): string {
  if (!e) return dash;
  return [e.brand, e.name].filter(Boolean).join(" — ") || dash;
}

// Label for a session's tobacco / pipe, preferring the live entity and
// falling back to the stored snapshot when it was trashed
// or hard-deleted — so the journal never renders a bare "—" for a removed
// entity that still has a snapshot.
export function sessionEntityLabel(entity: any, snapshot: any, dash: string = "—"): string {
  if (entity) return entityLabel(entity, dash);
  if (snapshot) return entityLabel(snapshot, dash);
  return dash;
}

// Frozen display snapshot captured from an entity — the shape stored on
// sessions so the journal photo + label survive the entity's deletion.
export function entitySnapshot(e: any): { brand: string; name: string; imageUrl: string } {
  return {
    brand: (e && e.brand) || "",
    name: (e && e.name) || "",
    imageUrl: (e && e.imageUrl) || "",
  };
}

// Case-insensitive brand-then-name comparator (the session/tasting
// dropdowns must list entities in the same order).
export function compareByBrandName(a: any, b: any): number {
  var ab = String((a && a.brand) || "").toLowerCase();
  var bb = String((b && b.brand) || "").toLowerCase();
  if (ab !== bb) return ab < bb ? -1 : 1;
  var an = String((a && a.name) || "").toLowerCase();
  var bn = String((b && b.name) || "").toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

// Distinct non-empty brands from a collection, sorted case-insensitively
// — feeds the brand-filter dropdowns (pipes / accessories).
export function distinctSortedBrands(list: any[] | null | undefined): string[] {
  var set = new Set<string>();
  (Array.isArray(list) ? list : []).forEach(function (x) {
    if (x && x.brand) set.add(String(x.brand));
  });
  return Array.from(set).sort(function (a, b) {
    return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
  });
}

// True when `sinceMs` (a stored ms timestamp) is within the last `days`.
// Shared by the export-reminder + storage-quota dismissal windows.
export function isWithinDays(sinceMs: number, days: number): boolean {
  if (!sinceMs || sinceMs <= 0) return false;
  return Date.now() - sinceMs < days * 24 * 3600 * 1000;
}

// A short random suffix for `local-photo-<Date.now()>-<suffix>`
// keys so two photo writes in the same millisecond can't mint the same key and
// clobber each other's blob. Prefers crypto.randomUUID (like the legacy
// QuotaExceeded migration), falls back to a base36 random. The leading
// `Date.now()` digits are preserved so gcOrphans' `^local-photo-(\d+)` age
// guard still matches.
export function newPhotoSuffix(): string {
  try {
    var c: any = (typeof crypto !== "undefined") ? crypto : null;
    if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 8);
  } catch (_e) { /* fall through */ }
  return Math.floor(Math.random() * 1e12).toString(36);
}

// A stable, globally-unique entity id minted ONCE at creation and
// carried in every backup — the cross-device merge identity (Tier 2). Unlike
// the per-device numeric `id` (nxT/nxP/… counters, meaningless across devices),
// a `uid` lets the import/merge engine recognise "this imported tobacco IS this
// local one" without falling back to the ambiguous brand|name key (which
// collapsed two same-name blends). Prefers
// crypto.randomUUID; base36-random fallback (2 segments) for old engines/tests.
export function newUid(): string {
  try {
    var c: any = (typeof crypto !== "undefined") ? crypto : null;
    if (c && typeof c.randomUUID === "function") return String(c.randomUUID());
  } catch (_e) { /* fall through */ }
  return "u-" + Math.floor(Math.random() * 1e12).toString(36) + Math.floor(Math.random() * 1e12).toString(36);
}

// THE "most recent first" order for sessions, in one place.
//
// It lived inline in JournalView's `sortBy === "date"` branch, then the lot
// fiche's session list needed the same order. Writing it a second
// time is the failure this repo keeps paying for (the tag predicate lived in
// four copies, `FAMILY_AGING_MAX` was mirrored into the
// importer), so it was extracted instead — and the ordering is NOT
// obvious enough to re-derive correctly by hand, which is the real argument:
//
//   date DESC, then TIMED sessions before untimed ones within the same day,
//   then time DESC, then `id` DESC.
//
// Two of those four rungs are load-bearing and were paid for. Timed-before-
// untimed is handled EXPLICITLY rather than by string comparison because
// locale collation does not rank punctuation against digits predictably, so
// an empty `time` cannot be trusted to sort last on its own. And the final
// `id` tie-break (nxJ = save order, DESCENDING) is what keeps two same-minute
// or all-untimed sessions in a stable, meaningful order after a Drive/Dropbox
// restore or an import merge has scrambled the raw `data.sessions` array.
export function compareSessionsRecent(a: any, b: any): number {
  var hasTime = function (s: any) { return /^\d/.test(String((s && s.time) || "")); };
  var d = String((b && b.date) || "").localeCompare(String((a && a.date) || ""));
  if (d !== 0) return d;
  var aHas = hasTime(a), bHas = hasTime(b);
  if (aHas !== bHas) return aHas ? -1 : 1; // timed first, untimed at the day's bottom
  if (aHas && bHas) {
    var tt = String(b.time).localeCompare(String(a.time));
    if (tt !== 0) return tt; // latest start time first
  }
  return (Number(b && b.id) || 0) - (Number(a && a.id) || 0); // newest entry first
}

// The LIVE sessions charged against one lot, most recent
// first. `lotId` is stored as a string on the session and the lot `id` is
// numeric, so the comparison is String()-ed on both sides — a `===` between
// the two raw values silently matches nothing, which would render an empty
// list on a lot that has been smoked. Soft-deleted sessions are excluded: a
// trashed session has already had its weight credited back to the lot
// (`deleteSession`), so listing it would show grams the lot no longer owes.
export function sessionsForLot(sessions: any[], lotId: any): any[] {
  var want = String(lotId == null ? "" : lotId);
  if (!want) return [];
  return (sessions || [])
    .filter(function (s: any) { return s && !s.deletedAt && String(s.lotId || "") === want; })
    .sort(compareSessionsRecent);
}

// The initial collapsed-group state for the journal so ONLY the
// month of the MOST RECENT session starts EXPANDED — everything else stays
// collapsed by default. This is the current month when it has sessions, else
// the last month that actually has any (an earlier version keyed on the
// calendar current month, which expanded nothing when that month was empty). Keys match
// JournalView's grouping (`y:YYYY` / `m:YYYY-MM`); `false` = "expanded" in the
// inverted collapse convention (absent = collapsed). Seeded once (a store
// effect, when sessions first load); the normal toggle takes over after.
// The most recent edit timestamp (ms) across ALL entities +
// sessions carrying an `updatedAt`. Used by the sync
// diagnostic to show "when was this device's data last edited" — a fresh
// signal for reasoning about multi-device sync direction, independent of the
// last CLOUD-SAVE time. Returns 0 when nothing carries a stamp (legacy data).
export function latestEditMs(data: any): number {
  if (!data) return 0;
  var max = 0;
  var scan = function (arr: any) {
    (arr || []).forEach(function (it: any) {
      if (it && typeof it.updatedAt === "string") {
        var ms = Date.parse(it.updatedAt);
        if (!isNaN(ms) && ms > max) max = ms;
      }
    });
  };
  scan(data.sessions); scan(data.tobaccos); scan(data.pipes);
  scan(data.accessories); scan(data.wishlist);
  return max;
}

export function latestSessionMonthSeed(sessions: any): Record<string, false> {
  var maxDate = "";
  (Array.isArray(sessions) ? sessions : []).forEach(function (s: any) {
    if (!s || s.deletedAt) return;
    var d = typeof s.date === "string" ? s.date : "";
    // ISO YYYY-MM-DD sorts lexically, so string compare finds the latest.
    if (d && d > maxDate) maxDate = d;
  });
  if (!maxDate) return {};
  var seed: Record<string, false> = {};
  seed["y:" + maxDate.slice(0, 4)] = false;
  seed["m:" + maxDate.slice(0, 7)] = false;
  return seed;
}

// Default list-grouping preference (`cave-default-grouped`): absent or
// anything ≠ "0" → grouped. Read at init by all 5 list stores (was 5
// inline try/catch copies of the raw literal key + `!== "0"` sense).
export function readDefaultGrouped(): boolean {
  try {
    return localStorage.getItem("cave-default-grouped") !== "0";
  } catch (_e) {
    return true;
  }
}

// Inverted-collapse toggle for the grouping UI: an ABSENT key means
// collapsed (default), `false` means explicitly expanded. Extracted from
// the 5 byte-identical `toggleXxxGroup` bodies (one per list store).
export function toggleCollapseKey(
  prev: Record<string, any>,
  key: string,
): Record<string, any> {
  // Null-prototype so a group whose KEY is a prototype member
  // ("__proto__", "constructor" — a brand or type literally named that) can
  // still be toggled. On a plain object `n["__proto__"] = false` sets the
  // internal [[Prototype]] (ignored for a non-object value) instead of
  // creating an own property, so such a group's expand/collapse was a silent
  // no-op; a null-proto map makes it a normal own key.
  var n = Object.assign(Object.create(null), prev);
  if (n[key] === false) delete n[key];
  else n[key] = false;
  return n;
}

// ─── Soft-delete boundary (single-sourced) ───────────────────────────
// A row is TRASHED when it carries a `deletedAt` stamp. `stripDeleted`
// keeps the "live" rows and is the single definition behind `liveData`,
// the 30-day purge and the export filters — matching the historical
// `!it || !it.deletedAt` predicate (a null/undefined slot is treated as
// live, never as trash). `isTrashed` is the inverse used to build purge
// lists + skip trashed rows in a forEach.
export function isTrashed(row: any): boolean {
  return !!row && !!row.deletedAt;
}
export function stripDeleted<T>(arr: T[] | null | undefined): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(function (it: any) { return !it || !it.deletedAt; });
}

// Infinity-hardened non-negative number coercion. `parseFloat
// || 0` catches NaN but lets `Infinity` slip through (Infinity is truthy) — a
// forged `weightG:"Infinity"` would then poison caps / sort orders. Single
// definition behind lotUtils' safeW, useSessionStore's safeW and stats'
// safeNonNeg. Returns 0 for anything not a finite, >= 0 number.
export function safeWeight(v: any): number {
  var n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// "the user never weighed this lot" is an ABSENCE of data,
// not a zero. `lotInvariants` has long drawn that distinction and
// exempts such lots from every weight rule; `isUsableLot` did not, and
// `safeWeight("")` is 0, so an OPENED JAR the user never weighed vanished
// from the session tobacco picker — reported from the app.
//
// It lived as an inline expression inside `checkLotInvariants`. One notion,
// two readers, so it moves here rather than being written a second time —
// the copy this repo keeps paying for (the tag predicate lived in four,
// FAMILY_AGING_MAX was mirrored into the importer, CATS into the validator).
export function isUntrackedWeight(v: any): boolean {
  return v === "" || v === undefined || v === null;
}

// The single "does this look like a real backup?" gate for
// every import/restore entry point (JSON file import + both Drive restore
// paths). A genuine Tabac backup serialises the whole `data` object, which
// ALWAYS carries `tobaccos` as an array (empty or not) — so the gate is a
// plain object with `Array.isArray(parsed.tobaccos)`. That accepts every
// real backup (incl. an empty-inventory one, `tobaccos:[]`), while rejecting
// a random JSON value / number / string / array, a Drive `{error}` payload,
// a truthy-but-non-array `tobaccos:"hax"`, AND — a later review fix — a
// foreign/partial file that lacks `tobaccos` but happens to carry another
// collection (e.g. `{pipes:[…]}`): the earlier "any of the five" form let
// such a file reach the interactive Replace picker, where confirming would
// wipe the tobacco inventory. This restores the original `!d.tobaccos` strict-
// ness while keeping the `tobaccos:"hax"` hole closed. Fields are still
// sanitised downstream (sanitizeImportShape, migrateData).
export function isPlausibleBackup(parsed: any): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return Array.isArray(parsed.tobaccos);
}

// The session/tasting lot-picker option label, shared by
// SessionFormView (SelectField option) and TastingView (<option>) so the
// two pickers render identical text. The i18n fn + display prefs are
// passed in so the helper stays pure. `fmtDate`'s 2nd arg is the date
// format selector (callers pass `dateFormat`, not a language).
/**
 * How a lot's weight READS, in one place.
 *
 * An unweighed lot is a legitimate state (an absence of data,
 * not an empty tin) and the app rendered it three different ways: `0g` on the
 * lot row — which states a quantity the user never gave — `—` in the lot detail
 * modal, and a hole in the picker label (`Pot ·  g`). Three readings of one
 * state, on three screens a user moves between in a single flow.
 *
 * `—` wins: it is the one that says "not recorded" instead of asserting a
 * figure. `0g` is now reserved for a lot genuinely weighed at zero, which the
 * pickers refuse — so the two states stay distinguishable on screen, which is
 * the whole point of that distinction.
 */
export function fmtLotWeight(v: any, lang?: string, weightUnit?: string): string {
  if (isUntrackedWeight(v)) return "—";
  return fmtNum(v, lang) + (weightUnit || "");
}

export function lotPickerLabel(
  l: any,
  opts: { t?: (k: string) => string; lang?: string; weightUnit?: string; dateFormat?: string },
): string {
  var t = opts.t;
  var tag = l.status === "cellar"
    ? (t ? t("lot_cellar") : "Cave")
    : (t ? t("lot_jar") : "Pot");
  var dateBit = l.status === "jar" && l.dateOpened
    ? " · " + (t ? t("lbl_opened") : "ouvert") + " " + fmtDate(l.dateOpened, opts.dateFormat)
    : l.status === "cellar" && l.datePurchased
      ? " · " + (t ? t("lbl_purchased_short") : "acheté") + " " + fmtDate(l.datePurchased, opts.dateFormat)
      : "";
  return tag + " · " + fmtLotWeight(l.weightG, opts.lang, opts.weightUnit)
    + dateBit
    + (l.boxNumber ? " · n°" + l.boxNumber : "");
}

// `sanitizeSessionRefs` helper was removed.
// The user's policy is that permanent delete of a tabac/pipe must
// NOT mutate any session field — sessions keep their id refs (now
// "fantôme") and the journal renders via the snapshot. The three
// `session-*-exists` invariants were dropped at the same time so
// dangling refs don't inflate the diagnostic counter either.

/**
 * Refresh `tobaccoSnapshot` / `pipeSnapshot` on every
 * session that points at one of the given tabacs / pipes — used by
 * every removal path so the snapshot reflects the entity's current
 * state (brand, name, imageUrl) the moment it leaves the live view.
 *
 * Extracted from App.tsx into utils.ts so the stores'
 * SOFT-delete path can call it too. Why: as soon as a tabac or pipe
 * is soft-deleted, it falls out of `liveData`, and the journal's
 * `tobOf(id)` / `pipeOf(id)` lookup returns undefined → the entry
 * falls back to the snapshot. If the user had renamed or re-imaged
 * the entity between session save and deletion, the snapshot
 * captured at session save time is stale. Refreshing it on soft-
 * delete locks in the latest state the user actually saw.
 *
 * The helper is a pure function (no React, no state) so it stays
 * testable in isolation. Returns the original sessions ref when
 * nothing needed refreshing (cheap no-op).
 */
export function refreshSnapshotsForRemoval(
  sessions: any[],
  deletedTobs: any[],
  deletedPipes: any[],
): any[] {
  if (!Array.isArray(sessions) || sessions.length === 0) return sessions;
  // Object.create(null) — defense against forged imports
  // where an id field is a string matching an Object.prototype key.
  var tobMap: Record<string, any> = Object.create(null);
  (deletedTobs || []).forEach(function (t: any) {
    if (t && t.id !== undefined) tobMap[String(t.id)] = t;
  });
  var pipeMap: Record<string, any> = Object.create(null);
  (deletedPipes || []).forEach(function (p: any) {
    if (p && p.id !== undefined) pipeMap[String(p.id)] = p;
  });
  if (Object.keys(tobMap).length === 0 && Object.keys(pipeMap).length === 0) {
    return sessions;
  }
  var changed = false;
  var next = sessions.map(function (s: any) {
    if (!s) return s;
    var patch: any = null;
    if (s.tobaccoId && tobMap[String(s.tobaccoId)]) {
      patch = patch || {};
      patch.tobaccoSnapshot = entitySnapshot(tobMap[String(s.tobaccoId)]);
      changed = true;
    }
    if (s.pipeId && pipeMap[String(s.pipeId)]) {
      patch = patch || {};
      patch.pipeSnapshot = entitySnapshot(pipeMap[String(s.pipeId)]);
      changed = true;
    }
    return patch ? Object.assign({}, s, patch) : s;
  });
  return changed ? next : sessions;
}

// Pure 30-day-Trash retention sweep, extracted from App.tsx's
// startup cleanup effect so the purge logic is unit-testable (the effect
// itself only handles the loading-gate + deferred scheduling). Given a data
// snapshot and a cutoff timestamp, returns { changed, next }: every top-level
// row and every lot whose `deletedAt` is at/older than `cutoffMs` is dropped,
// sessions that referenced a purged lot get `lotId=""` (orphanised like
// permanentlyDelete("lot")), and sessions referencing a purged tobacco/pipe
// keep a refreshed snapshot so the journal still shows the entity. `changed`
// is false (and `next === snap`) when nothing aged past the window.
export function sweepExpiredTrash(
  snap: any,
  cutoffMs: number,
): { changed: boolean; next: any } {
  var s = snap || {};
  function fresh(it: any) {
    if (!it || !it.deletedAt) return true;
    var t = Date.parse(it.deletedAt);
    if (!isFinite(t)) return true;
    return t > cutoffMs;
  }
  var lotPurgeIds: Record<string, true> = Object.create(null);
  var tobsAfterLotPurge = (s.tobaccos || []).map(function (t: any) {
    if (!t || !Array.isArray(t.lots)) return t;
    var newLots = t.lots.filter(function (l: any) {
      if (l && l.deletedAt) {
        var lt = Date.parse(l.deletedAt);
        if (isFinite(lt) && lt <= cutoffMs) {
          if (l.id !== undefined && l.id !== null && l.id !== "") lotPurgeIds[String(l.id)] = true;
          return false;
        }
      }
      return true;
    });
    if (newLots.length === t.lots.length) return t;
    return Object.assign({}, t, { lots: newLots });
  });
  // A whole trashed tobacco being purged takes its
  // ride-along lots (which carry no deletedAt of their own) with it. Collect
  // THOSE lot ids too so referencing sessions get lotId cleared below — parity
  // with emptyTrash + permanentlyDelete("tobacco"). Without this the 30-day
  // auto-sweep was the odd path out and left a dangling session.lotId.
  (s.tobaccos || []).forEach(function (t: any) {
    if (!t || !t.deletedAt) return;
    var tt = Date.parse(t.deletedAt);
    if (!(isFinite(tt) && tt <= cutoffMs)) return;
    ((t.lots || []) as any[]).forEach(function (l: any) {
      if (l && l.id !== undefined && l.id !== null && l.id !== "") lotPurgeIds[String(l.id)] = true;
    });
  });
  var nextTobs = tobsAfterLotPurge.filter(fresh);
  var nextPipes = (s.pipes || []).filter(fresh);
  var nextWish = (s.wishlist || []).filter(fresh);
  var nextAcc = (s.accessories || []).filter(fresh);
  var nextSess = (s.sessions || []).filter(fresh).map(function (se: any) {
    if (!se || !se.lotId) return se;
    if (!lotPurgeIds[String(se.lotId)]) return se;
    return Object.assign({}, se, { lotId: "" });
  });
  var lotPurgeCount = Object.keys(lotPurgeIds).length;
  var changed =
    nextTobs.length !== (s.tobaccos || []).length ||
    nextPipes.length !== (s.pipes || []).length ||
    nextWish.length !== (s.wishlist || []).length ||
    nextAcc.length !== (s.accessories || []).length ||
    nextSess.length !== (s.sessions || []).length ||
    lotPurgeCount > 0;
  if (!changed) return { changed: false, next: snap };
  var purgedT = (s.tobaccos || []).filter(function (it: any) {
    if (!it || !it.deletedAt) return false;
    var pt = Date.parse(it.deletedAt);
    return isFinite(pt) && pt <= cutoffMs;
  });
  var purgedP = (s.pipes || []).filter(function (it: any) {
    if (!it || !it.deletedAt) return false;
    var pt2 = Date.parse(it.deletedAt);
    return isFinite(pt2) && pt2 <= cutoffMs;
  });
  var nextSessSnap = refreshSnapshotsForRemoval(nextSess, purgedT, purgedP);
  return {
    changed: true,
    next: Object.assign({}, s, {
      tobaccos: nextTobs,
      pipes: nextPipes,
      wishlist: nextWish,
      accessories: nextAcc,
      sessions: nextSessSnap,
    }),
  };
}

export function parseAgingMax(v: any): { min: number; max: number } {
  if (!v) return { min: 0, max: 0 };
  var s = String(v).trim();
  // Accept hyphen-minus (-), en-dash (–) AND em-dash (—) as the
  // range separator. iOS smart-dashes / pasted review-site text can carry an
  // em-dash; without it, "10—15" fell through to parseInt → {10,10}, silently
  // collapsing a range to a single value and flipping the aging badge.
  var m = s.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (m && m[1] && m[2]) {
    var a = parseInt(m[1]),
      b = parseInt(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  var n = parseInt(s) || 0;
  return { min: n, max: n };
}

// Storage-blocked error message helper. Returns the platform-
// specific path the user has to follow to unblock localStorage. Lives
// here (not inline in App.tsx) so the iOS↔Android parity contract is
// enforced at the helper level — adding a third platform means touching
// one place, never four. Mirrors the breadcrumbs documented in
// `public/help.html` section 14 ("Dépannage").
export function getStorageBlockedHint(lang: string, isIos: boolean): string {
  // English fallback — the only dictionary compiled in, so the only
  // one guaranteed present now that the rest load on demand.
  var dict = (LANG as any)[lang || "en"] || LANG.en;
  var key = isIos ? "storage_hint_ios" : "storage_hint_android";
  return dict[key] || (LANG.en as any)[key] || "";
}

// Returns the aging alert level for a lot given its tobacco's agingMax.
//  - "overaged" : age in years > max
//  - "approaching" : age inside the peak window for a range, OR within the
//                    last year before the peak for a single value
//  - null : no alert (finished lot, no agingMax set, or not close enough)
// LABEL-CONTRACT:start aging-cellar-only — see scripts/label-contracts.json
export function lotAgingStatus(lot: Lot, agingMax: any): "overaged" | "approaching" | null {
  // Aging alerts ("pic proche" / "trop âgé") are a CELLAR-only
  // concept — a sealed tin matures over years. A lot "en pot" is OPENED (per
  // the user's model, even if physically still in its tin), so it's no longer
  // cellaring: opened jars get a separate "ouvert depuis N" signal, never an
  // over-aged alert. Finished lots were already excluded; now jars are too.
  if (!lot || lot.status !== "cellar") return null;
  var ag = parseAgingMax(agingMax);
  if (ag.max <= 0) return null;
  var days = lotAge(lot);
  if (days === null) return null;
  var ageY = days / 365.25;
  if (ageY > ag.max) return "overaged";
  if (ag.min !== ag.max) {
    if (ageY > ag.min) return "approaching";
  } else {
    if (ageY > ag.max - 1) return "approaching";
  }
  return null;
}
// LABEL-CONTRACT:end aging-cellar-only

// Typical max cellaring age (years, or a range) by tobacco family.
// Used ONLY as a fallback when a tobacco carries no explicit agingMax, so the
// maturity engine still reflects the blend type (an Aromatic peaks years before
// a Virginia). A user-entered agingMax ALWAYS wins over this table. Mirrors the
// family-default table in the AI auto-fill prompt so the two stay in agreement.
// Categories absent from the table (e.g. "Autre") get no default → treated as
// "no aging target set" exactly like before.
// Per-family cellaring-max defaults revised after a sourced review
// (smokingpipes aging guide, pipestud "Latakia Aging", pipe-club aging FAQ,
// pipesandcigars FAQ, tobaccoreviews). Rationale: Virginias/Perique age the
// longest; Latakia FADES (smoky note past ~5-8 y) so it was clearly overstated;
// straight Burley gains little long-term; aromatics/Cavendish are best fresh.
export var FAMILY_AGING_MAX: Record<string, string> = {
  "Virginia": "15-25",
  "VaPer": "15-20",
  "Virginia/Burley": "10-15",
  // Virginia/Latakia se cale sur Balkan (meme trio Va + Latakia +
  // orientaux) ; Americain sur Burley (style codger, Burley-mene, casing leger).
  "Virginia/Latakia": "8-12",
  "Américain": "5-10",
  // Feuille de cigare deja longuement fermentee avant hachage —
  // elle evolue peu en boite scellee et perd ses notes terreuses au-dela de 10 ans.
  "Cigare": "7-10",
  "Anglais": "6-10",
  "Balkan": "8-12",
  "Écossais": "8-12", "Lakeland": "5-10",
  // Anglais aromatique — REASONED, pas calibre. Deux composants
  // volatils partent en premier : le nappage (les top notes s'estompent en
  // quelques annees) et un Latakia souvent leger, qui peut disparaitre tout a
  // fait. Il ne peut donc pas prendre le 5-8 du Latakia pur, et reste au-dessus
  // du 3 d'un aromatique danois : il garde une vraie structure de feuille
  // (Virginia + Burley + Cavendish) qui continue de se marier.
  "Anglais aromatique": "3-6",
  "Burley": "5-10",
  "Latakia": "5-8",
  "Dark Fired": "7-10",
  "Perique": "10-15",
  "Oriental": "6-10",
  "Turkish": "6-10",
  "Aromatique": "3",
  "Cavendish": "3",
};

// THE single resolver for the aging target used by every maturity /
// aging classification in the app. Returns the tobacco's own agingMax when it
// parses to a positive value, else the family default (FAMILY_AGING_MAX keyed
// by category), else "". Every call site that classifies a lot's maturity MUST
// go through this — passing a raw `tob.agingMax` bypasses the family fallback
// and reintroduces the "the bar and the card disagree" class of bug.
export function effectiveAgingMax(tob: any): string {
  if (!tob) return "";
  var own = parseAgingMax(tob.agingMax);
  if (own.max > 0) return String(tob.agingMax);
  // HasOwnProperty guard so a forged category equal to a
  // prototype member ("toString"…) can't make this return a FUNCTION instead of
  // a string (downstream String()-wraps it, so no crash — but keep the contract).
  var cat = String(tob.category || "");
  return Object.prototype.hasOwnProperty.call(FAMILY_AGING_MAX, cat) ? FAMILY_AGING_MAX[cat]! : "";
}

// Removed unused `topTobaccosForPipe` / `topPipesForTobacco` /
// `_topByAvgRating` / `PairingEntry` exports. The views (PipesDetailView,
// InventoryDetailView) compute their "top pairings" inline as IIFEs;
// these helpers were left over from an earlier refactor and consumed
// only by tests.

// Shared scroll-restore helper. The naive
// `requestAnimationFrame(() => window.scrollTo(0, targetY))` pattern
// races with React's render — when a list view re-mounts after a
// detail/form closes, the first paint shows an empty page and
// `scrollTo` gets clamped to the current (tiny) `scrollHeight`. We
// retry across up to `maxAttempts` animation frames until the
// document is tall enough to honour the saved Y. Capped so we don't
// loop forever if the list is legitimately shorter (item deleted,
// filter changed).
// Normalise a user-typed seller/site URL into a SAFE href for a
// clickable link, or "" if it can't be made safe. Prepends https:// when no
// scheme is present, and only ever returns an http(s) URL (blocks javascript:,
// data:, etc.). Pure; tested in safeSellerHref.test.ts.
export function safeSellerHref(raw: any): string {
  var u = String(raw == null ? "" : raw).trim();
  if (!u) return "";
  // If the string declares a URL scheme (a run of scheme chars — NO dots, so
  // "example.com:8080" reads as host:port, not a scheme — followed by ":"), it
  // MUST be http(s). This blocks javascript:/data:/ftp: etc. from ever being
  // re-prefixed into a linkable URL.
  var sm = u.match(/^([a-z][a-z0-9+-]*):/i);
  var candidate = sm ? (/^https?$/i.test(sm[1]!) ? u : "") : "https://" + u;
  if (!candidate) return "";
  try {
    var p = new URL(candidate);
    if (p.protocol === "http:" || p.protocol === "https:") return p.href;
  } catch (_e) { /* malformed → not linkable */ }
  return "";
}

export function restoreScrollY(targetY: number, maxAttempts: number = 20): void {
  // Guard against `NaN` and ±Infinity slipping in. `NaN <= 0`
  // returns false in JS (all NaN comparisons do), so the previous early
  // return didn't fire — a stale `scrollSaveRef.current[key]` of NaN
  // would have looped through every rAF and then called `window.scrollTo`
  // with a meaningless target. Discovered by the property fuzz.
  if (!Number.isFinite(targetY) || targetY <= 0) return;
  var attempts = 0;
  function tick() {
    attempts++;
    var docH = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    );
    var viewportH = window.innerHeight || 0;
    var maxY = Math.max(0, docH - viewportH);
    if (maxY >= targetY || attempts >= maxAttempts) {
      window.scrollTo(0, Math.min(targetY, maxY));
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Shared HTML/markup stripper used by every code path that
// touches AI-provided text. Lives here (not in useAiAutoFill) so
// `migrateData` can scrub legacy data stored before the fix existed.
// Behaviour: removes HTML-like tags (`<tag…>` and `</tag>`, anything
// where the first character after `<` is an ASCII letter — so user
// text like "2 < 3" is left intact) but keeps the inner content; decodes
// the common HTML entities; collapses whitespace introduced by the
// strip.
//
// Implementation notes (post code-scan hardening):
// - Tag stripping loops to a fixed-point (CodeQL
//   js/incomplete-multi-character-sanitization). A pathological input
//   like "<<script>script>" would slip past a single pass — first
//   replace gives "<script>", second pass strips it. Bounded by an
//   iteration cap so a degenerate regex can never spin forever.
// - Entity decoding does named entities AND numeric entities (decimal
//   `&#NN;` + hex `&#xNN;`) in ONE pass (regex with a callback), then
//   `&amp;` last. This avoids the "double escaping" alert
//   (js/double-escaping): the previous code decoded `&amp;` first, so
//   `&amp;lt;` became `&lt;` then `<`. The single-pass callback ignores
//   already-decoded `&` because it operates on the original string
//   left-to-right with no rescan.
// NOTE: an audit flagged that decoding entities AFTER
// stripping tags can emit a live tag (`&lt;img onerror=x&gt;` → `<img …>`).
// This was CONSIDERED and deliberately NOT changed: decoding `&lt;`/`&gt;` to
// `<`/`>` is an intentional DISPLAY choice (see the "2 < 3" + "&lt;tag&gt;"
// tests) and re-stripping would destroy legitimate content like "note: <see
// tin>". XSS safety here comes from downstream escaping — every render path is
// a React text node (auto-escaped) or `esc()` in the export report; the only
// innerHTML sinks render static shipped doc HTML, never AI/user fields. If a
// future feature ever renders these fields via innerHTML, THAT sink must
// sanitize — not this display-normalization helper.
export function stripMarkupFromString(s: any): string {
  if (typeof s !== "string") return s;
  var t = s;
  for (var i = 0; i < 8; i++) {
    var next = String(t).replace(/<\/?[a-z][^>]*>/gi, "");
    if (next === t) break;
    t = next;
  }
  t = String(t).replace(/&(?:#([0-9]+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, function (match, dec, hex, name) {
    if (dec) {
      var n = parseInt(dec, 10);
      return isNaN(n) || n < 0 || n > 0x10FFFF ? match : String.fromCodePoint(n);
    }
    if (hex) {
      var h = parseInt(hex, 16);
      return isNaN(h) || h < 0 || h > 0x10FFFF ? match : String.fromCodePoint(h);
    }
    var key = String(name).toLowerCase();
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return "\"";
    if (key === "apos") return "'";
    if (key === "amp") return "&";
    return match;
  });
  // NOTE (considered + rejected): a re-strip pass after the
  // entity decode would remove tags that materialise from `&#60;…&#62;`, but it
  // is DELIBERATELY not done — decoded entities are kept as literal text (see
  // the "&lt;tag&gt; → <tag>" test). There is no XSS: every AI-filled field
  // renders React-escaped, and the only dangerouslySetInnerHTML sinks are
  // bundled static docs. Stripping here would corrupt legitimate text a user
  // typed as escaped markup for no security gain.
  t = String(t).replace(/\s{2,}/g, " ");
  return t === s ? s : t;
}

// Walks a data object and strips markup from every user-visible text
// field that an AI auto-fill can populate. Called from migrateData so
// the cleanup applies to existing localStorage data on load — anyone
// who ran the AI on builds < 205 ends up with clean text on the next
// open without having to re-run the AI or edit by hand.
function _scrubAiMarkup(d: any): void {
  function clean(obj: any, keys: string[]) {
    if (!obj) return;
    keys.forEach(function (k) {
      if (typeof obj[k] === "string") {
        var cleaned = stripMarkupFromString(obj[k]);
        if (cleaned !== obj[k]) obj[k] = cleaned;
      }
    });
  }
  var tobKeys = ["name", "brand", "blend", "description", "tastingNotes"];
  var pipeKeys = ["name", "brand", "description", "notes"];
  var wishKeys = ["name", "brand", "blend", "description", "tastingNotes", "notes"];
  var accKeys = ["name", "brand", "notes"];
  var sessKeys = ["notes"];
  (d.tobaccos || []).forEach(function (t: any) { clean(t, tobKeys); });
  (d.pipes || []).forEach(function (p: any) { clean(p, pipeKeys); });
  (d.wishlist || []).forEach(function (w: any) { clean(w, wishKeys); });
  (d.accessories || []).forEach(function (a: any) { clean(a, accKeys); });
  (d.sessions || []).forEach(function (s: any) { clean(s, sessKeys); });
}

// The app is local-photos-only — the external-URL image feature
// was fully removed (URL entry first, then the network fetch/proxy). This is the
// permanent guard-rail: any `imageUrl` that is still an external http(s) URL
// (an old record, or a RESTORE from a legacy backup / JSON import) is cleared
// to "". Runs from migrateData, which fires on load AND on every import /
// restore path — so a restored backup can never reintroduce a URL image. Pure,
// synchronous, no network. Covers entities + frozen session snapshots. Blank
// imageUrl is a normal "no photo" state; imageUrl is never an identity key, so
// clearing it can't break any reference.
// This was `_clearExternalUrlImages` and it anchored on
// `^https?://`, which is the losing side of the question: a
// PROTOCOL-RELATIVE `//evil.com/x.png` and a `data:image/svg+xml` both walked
// straight past it, and the form's photo preview is a bare `<img src>`. The
// rule is now an ALLOWLIST — see `isLocalPhotoRef` for the two legitimate
// shapes and for why enumerating what is bad could not work. An empty value
// is left alone (it is already absent, not foreign).
function _clearForeignImageRefs(d: any): void {
  function fix(o: any) {
    if (o && o.imageUrl && !isLocalPhotoRef(o.imageUrl)) o.imageUrl = "";
  }
  (d.tobaccos || []).forEach(fix);
  (d.pipes || []).forEach(fix);
  (d.wishlist || []).forEach(fix);
  (d.accessories || []).forEach(fix);
  (d.sessions || []).forEach(function (s: any) {
    if (s && s.tobaccoSnapshot) fix(s.tobaccoSnapshot);
    if (s && s.pipeSnapshot) fix(s.pipeSnapshot);
  });
}

// Defensive shape normalisation. Coerces every value at
// `keys` of `obj` that's a non-string primitive (number / boolean) to
// its String() representation. Leaves undefined / null / objects /
// already-strings untouched. Used by `migrateData` to guarantee that
// every text / date / numeric-string field exposes `.localeCompare`
// and friends, so the views can sort / compare without `String()`
// wrapping every call site. (We still keep the view-level coercions
// as defence-in-depth — see the lot picker sort in SessionFormView
// for the canonical example.)
function _coerceStringFields(obj: any, keys: string[]): boolean {
  if (!obj) return false;
  var changed = false;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k) continue;
    var v = obj[k];
    if (v === undefined || v === null) continue;
    var typ = typeof v;
    if (typ === "string") continue;
    if (typ === "number" || typ === "boolean") {
      obj[k] = String(v);
      changed = true;
    }
  }
  return changed;
}

// In-place migration that reduces full ISO date
// strings (`YYYY-MM-DD`, `YYYY-MM`) to year-only (`YYYY`) on the
// listed keys. Used for `Pipe.datePurchased`, `Pipe.dateProduction`
// and `Accessory.datePurchased` where the day / month granularity
// is rarely known and almost never useful. The rule: extract the
// leading 4-digit run if present; otherwise keep the value as-is
// (so `""`, `"2017"`, `"vintage"` stay untouched). Idempotent —
// already-truncated values are no-ops.
function _truncateToYear(obj: any, keys: string[]): void {
  if (!obj) return;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k) continue;
    var v = obj[k];
    if (typeof v !== "string" || v.length <= 4) continue;
    var m = String(v).match(/^(\d{4})/);
    if (m) obj[k] = m[1] || "";
  }
}

// Field lists kept in module scope so they're not re-allocated on
// every migrateData pass. Mirrors the schema in src/types.ts +
// constants.ts (BT / BL / BP / BA / BJ templates).
var _TOB_STR_FIELDS = ["name","brand","category","blend","cut","tastingNotes","description","imageUrl","agingMax"];
var _LOT_STR_FIELDS = ["weightG","weightInitial","datePurchased","dateProduction","dateOpened","dateFinished","boxNumber","price","seller","status","originalStatus"];
var _PIPE_STR_FIELDS = ["name","brand","shape","courbure","length","weight","filterType","chamberDiameter","chamberDepth","bowlMaterial","stemMaterial","finish","datePurchased","dateProduction","price","seller","description","notes","imageUrl","status"];
var _ACC_STR_FIELDS = ["name","brand","type","fuel","datePurchased","price","seller","notes","imageUrl","status"];
var _SESS_STR_FIELDS = ["date","duration","weightG","notes"];
var _WISH_STR_FIELDS = ["name","brand","category","blend","cut","tastingNotes","description","imageUrl","notes","priority","agingMax"];

// Reconcile an id counter PAST the max id
// already present in its collection. The clamp above only guarantees `>= 1`;
// a loaded or restored dataset whose counter drifted below an existing id
// (an old export, a forged backup, a counter reset by a buggy tool) would
// make the very next add() mint an id that's ALREADY in use — two rows share
// one id, and every later update/delete keyed on that id hits the wrong row.
// This was silent for tobaccos / wishlist / sessions (no uniqueness invariant
// existed for them at the time — they are in lotInvariants.ts now).
export function bumpCounterPastMaxId(counter: number, arr: any): number {
  if (!Array.isArray(arr)) return counter;
  var maxId = 0;
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (!it) continue;
    // Lots use Date.now() ids that don't feed these counters; top-level ids
    // are the app-assigned integers the counters mint, so parseInt is exact.
    var id = parseInt(it.id);
    if (!isNaN(id) && id > maxId) maxId = id;
  }
  return Math.max(counter, maxId + 1);
}

export function migrateData(d: any): any {
  // Degrade to an empty cellar instead of
  // throwing when localStorage holds a non-object (a bare JSON number/string,
  // or an array). `d.accessories = []` on a primitive throws, the load
  // .catch fires, and the app boots empty anyway — but doing it explicitly
  // keeps migrateData total and lets a forged import be sanitised, not crash.
  if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
  // Default ALL five collections to arrays (was accessories +
  // sessions only) so a bare-primitive / partial payload yields a totally
  // shaped object — every downstream consumer + the dedup pass below can rely
  // on the arrays existing.
  if (!Array.isArray(d.tobaccos)) d.tobaccos = [];
  if (!Array.isArray(d.pipes)) d.pipes = [];
  if (!Array.isArray(d.wishlist)) d.wishlist = [];
  if (!Array.isArray(d.accessories)) d.accessories = [];
  if (!Array.isArray(d.sessions)) d.sessions = [];
  // And every ELEMENT must be an object, not just the array.
  // A forged or corrupt payload holding a primitive inside `pipes` made
  // migrateData THROW, and the consequence is the whole point: on the load
  // path the .catch fires and the app boots empty, then the first save
  // overwrites the intact blob (a known shape, different door); on the
  // cloud-restore path `stageImport(…, {autoApply:"replace"})` calls this with
  // no guard at all, so the tap on « Restaurer » in the cloud-newer banner
  // simply died.
  //
  // REPRODUCED before fixing, on all five collections and three primitive
  // kinds: only `pipes` threw — `TypeError: Cannot create property
  // 'maintenance' on number '5'`, and for a string `Cannot assign to read only
  // property 'length'`, since `length` is in `_PIPE_STR_FIELDS` and assigning
  // any property of a primitive throws in strict mode (ES modules are strict).
  // The other four SURVIVED, and that is luck rather than design: they happen
  // to write nothing unconditionally today, so the next field added to any of
  // them re-opens the hole. Hence one rule at the top for all five, rather
  // than a guard bolted onto the pipe loop.
  //
  // DROP rather than coerce: `{}` would mint an id-less ghost row that
  // `dedupeIds` then stamps and the user sees as a blank entry they never
  // created. A primitive carries nothing to recover.
  // IN PLACE, not `.filter()`: migrateData mutates `d` everywhere else, and
  // two pre-existing cases assert the collections keep their ARRAY IDENTITY
  // ("does not overwrite existing accessories array"). `.filter()` returns a
  // new array and broke both — the assertions were right and the first
  // implementation was the thing to adjust.
  var _keepObj = function (x: any) { return !!x && typeof x === "object" && !Array.isArray(x); };
  var _pruneRows = function (arr: any[]) {
    for (var i = arr.length - 1; i >= 0; i--) if (!_keepObj(arr[i])) arr.splice(i, 1);
  };
  _pruneRows(d.tobaccos);
  _pruneRows(d.pipes);
  _pruneRows(d.wishlist);
  _pruneRows(d.accessories);
  _pruneRows(d.sessions);
  d.nxT = Math.max(1, parseInt(d.nxT) || 1);
  d.nxW = Math.max(1, parseInt(d.nxW) || 1);
  d.nxP = Math.max(1, parseInt(d.nxP) || 1);
  d.nxA = Math.max(1, parseInt(d.nxA) || 1);
  d.nxJ = Math.max(1, parseInt(d.nxJ) || 1);
  // Reconcile each counter past the max existing id of its collection so the
  // next add() can never reuse a live id (see bumpCounterPastMaxId above).
  d.nxT = bumpCounterPastMaxId(d.nxT, d.tobaccos);
  d.nxW = bumpCounterPastMaxId(d.nxW, d.wishlist);
  d.nxP = bumpCounterPastMaxId(d.nxP, d.pipes);
  d.nxA = bumpCounterPastMaxId(d.nxA, d.accessories);
  d.nxJ = bumpCounterPastMaxId(d.nxJ, d.sessions);
  // Data repair: bumpCounterPastMaxId only advances the COUNTER
  // (prevents a FUTURE add() from colliding); it never repairs rows that
  // ALREADY share an id. A dataset corrupted before the counter reconciliation
  // landed (a drifted counter on an old release, a forged import) can hold two top-level rows with
  // the same id — update/delete match by id and hit BOTH, and the id-unique
  // invariant fires on every save() with no way to stand down. dedupeIds
  // re-stamps any missing / zero / duplicate id from the reconciled counter
  // (keeping the first occurrence + its inbound refs) and returns the advanced
  // counter to write back. Idempotent on clean data. Sessions are leaf nodes
  // (nothing references a session id), so their repair is fully safe; for the
  // referenced kinds it is best-effort recovery of an already-corrupt state.
  d.nxT = dedupeIds(d.tobaccos, d.nxT);
  d.nxW = dedupeIds(d.wishlist, d.nxW);
  d.nxP = dedupeIds(d.pipes, d.nxP);
  d.nxA = dedupeIds(d.accessories, d.nxA);
  d.nxJ = dedupeIds(d.sessions, d.nxJ);
  // Tier 2: backfill a stable cross-device `uid` on every TOP-LEVEL
  // entity that lacks one, so existing cellars join the identity scheme. This is
  // REQUIRED (not cosmetic): the merge's ambiguity guard needs uids to keep two
  // same-name blends distinct — without a uid, re-importing your own backup of
  // two identically-named tobaccos would DUPLICATE them (the guard can't tell
  // them apart by brand|name). Gated on `!uid`, so `migrateData∘migrateData`
  // stays idempotent (the second pass sees the uid and leaves it). SESSIONS are
  // DELIBERATELY excluded: a legacy session backfilled to DIFFERENT uids on two
  // devices would be split by the merge's distinct-uid guard, so they stay
  // uid-less and dedup by the (date|time|tob|pipe|duration) key. `newUid` is
  // random, but the invariant that matters — idempotency — holds via the guard.
  function _backfillUid(arr: any[]) {
    if (!Array.isArray(arr)) return;
    for (var bi = 0; bi < arr.length; bi++) {
      var br = arr[bi];
      if (br && typeof br === "object" && !(typeof br.uid === "string" && br.uid)) br.uid = newUid();
    }
  }
  _backfillUid(d.tobaccos);
  _backfillUid(d.pipes);
  _backfillUid(d.accessories);
  _backfillUid(d.wishlist);
  // Backfill the stable uid on the SUB-records too — LOTS (per
  // tobacco) and MAINTENANCE entries (per pipe). Gated on !uid (via
  // _backfillUid) so migrateData∘migrateData stays idempotent. Lots use
  // uid-first merge (see useImportConfirm); a lot that existed on two devices
  // BEFORE this feature gets independent backfilled uids and falls back to
  // lotMergeKey dedup — the same disclosed legacy limitation as entities.
  if (Array.isArray(d.tobaccos)) {
    for (var _luT = 0; _luT < d.tobaccos.length; _luT++) {
      var _luTob = d.tobaccos[_luT];
      if (_luTob && Array.isArray(_luTob.lots)) _backfillUid(_luTob.lots);
    }
  }
  if (Array.isArray(d.pipes)) {
    for (var _muP = 0; _muP < d.pipes.length; _muP++) {
      var _muPipe = d.pipes[_muP];
      if (_muPipe && Array.isArray(_muPipe.maintenance)) _backfillUid(_muPipe.maintenance);
    }
  }
  // Walk every collection and normalise the documented
  // string-typed fields in place. Cheap (single pass per entity), runs
  // before any of the more specific migrations below so they can rely
  // on the cleaned shape.
  if (Array.isArray(d.tobaccos)) {
    for (var ti = 0; ti < d.tobaccos.length; ti++) {
      _coerceStringFields(d.tobaccos[ti], _TOB_STR_FIELDS);
      // Normalise user tags (drops garbage from a forged import,
      // trims, dedups, caps). Leaves legacy tobaccos without `tags` untouched.
      var _tob = d.tobaccos[ti];
      if (_tob && _tob.tags !== undefined) _tob.tags = _sanitizeTags(_tob.tags);
      // `catalogueLock` is a strict boolean on the wire.
      // `=== true` rather than `!!`, and the difference is the whole point: a
      // hand-edited backup carrying `"no"` is TRUTHY, so `!!` would read it as
      // locked. Only the literal survives. The key is left ABSENT on rows that
      // never had it — absent and false mean the same thing to the catalogue
      // pass, and adding it everywhere would rewrite every row for nothing.
      if (_tob && _tob.catalogueLock !== undefined) _tob.catalogueLock = _tob.catalogueLock === true;
      // Coerce a non-array `lots` to [] — parity with the
      // pipes maintenance/photos normalisation below. isPlausibleBackup only
      // checks Array.isArray(tobaccos), so a forged/quota-corrupt payload with
      // `lots:"hax"` loads; every migrateData read guards on Array.isArray, but
      // useTobaccoStore.addLotToTobacco does `tob.lots.push(...)` → throws on a
      // string the moment the user adds a lot to that fiche.
      if (_tob && _tob.lots !== undefined && !Array.isArray(_tob.lots)) _tob.lots = [];
      var lots = _tob && _tob.lots;
      if (Array.isArray(lots)) {
        for (var li2 = 0; li2 < lots.length; li2++) {
          _coerceStringFields(lots[li2], _LOT_STR_FIELDS);
        }
      }
    }
  }
  if (Array.isArray(d.pipes)) {
    for (var pi = 0; pi < d.pipes.length; pi++) {
      _coerceStringFields(d.pipes[pi], _PIPE_STR_FIELDS);
      // Additional pipe photos. Normalise a forged/imported value to
      // a clean string[] of local-photo-* keys (dedup, capped at
      // PIPE_MAX_EXTRA_PHOTOS — this replaced a literal 6, the THIRD
      // copy of that cap, found because a probe showed this trim was silently
      // making a merge test vacuous) so every consumer
      // (gatherLocalImages / orphan GC / the on-demand galleries / lightbox) can
      // trust the shape — a non-string element would throw on `.indexOf`.
      var _pph = d.pipes[pi];
      if (_pph && _pph.photos !== undefined) {
        if (!Array.isArray(_pph.photos)) { _pph.photos = []; }
        else {
          var _outPh: string[] = [];
          for (var _phi = 0; _phi < _pph.photos.length && _outPh.length < PIPE_MAX_EXTRA_PHOTOS; _phi++) {
            var _ph = _pph.photos[_phi];
            if (typeof _ph === "string" && _ph.indexOf("local-photo-") === 0 && _outPh.indexOf(_ph) < 0) _outPh.push(_ph);
          }
          _pph.photos = _outPh;
        }
      }
      // User tags on pipes (same boundary sanitisation as tobaccos).
      if (_pph && _pph.tags !== undefined) _pph.tags = _sanitizeTags(_pph.tags);
    }
  }
  // Every pipe carries a maintenance log array. Legacy pipes
  // (and forged imports where it's missing / not an array) get an empty [].
  // Reshape each entry from the old single `type` field to the new
  // { kind, tasks } model. The legacy map keeps every migrated entry on a
  // COUNTING kind (light/full) so no pipe becomes retroactively "overdue".
  var _MAINT_LEGACY_MAP: Record<string, { kind: string; tasks: string[] }> = {
    "Nettoyage":    { kind: "light", tasks: [] },
    "Alcool + sel": { kind: "full",  tasks: ["saltalcohol"] },
    "Alésage":      { kind: "full",  tasks: ["ream"] },
    "Cire":         { kind: "light", tasks: ["wax"] },
    "Réparation":   { kind: "light", tasks: ["repair"] },
    "Autre":        { kind: "light", tasks: [] },
  };
  var _MAINT_TASK_KEYS = ["swab","bowl","ream","saltalcohol","stem","wax","repair","rest","other"];
  if (Array.isArray(d.pipes)) {
    for (var pmi = 0; pmi < d.pipes.length; pmi++) {
      var _pp = d.pipes[pmi];
      if (!_pp) continue;
      // The short-lived per-pipe `smokeWeight` field was
      // replaced by session-time chamber×cut estimation — drop any stored value.
      if (typeof _pp.smokeWeight !== "undefined") delete _pp.smokeWeight;
      if (!Array.isArray(_pp.maintenance)) { _pp.maintenance = []; continue; }
      for (var mei = 0; mei < _pp.maintenance.length; mei++) {
        var _me = _pp.maintenance[mei];
        if (!_me || typeof _me !== "object") continue;
        // Legacy entry: had `type`, no `kind`.
        if (_me.kind === undefined && typeof _me.type === "string") {
          // HasOwnProperty guard — a forged legacy
          // `type` matching an Object.prototype member ("toString",
          // "constructor", "valueOf"…) used to resolve THROUGH the prototype
          // chain to a truthy function, so `|| {…}` was skipped and the next
          // line's `_mapped.tasks.slice()` threw (tasks undefined) → migrateData
          // throws → the whole cellar loads EMPTY (load .catch → setData(INIT),
          // then the first save overwrites the intact blob). The same throw
          // crashed every forged-backup import path. Parity with csvImport's
          // header-alias hasOwnProperty guard.
          var _mapped = Object.prototype.hasOwnProperty.call(_MAINT_LEGACY_MAP, _me.type)
            ? _MAINT_LEGACY_MAP[_me.type]!
            : { kind: "light", tasks: [] };
          _me.kind = _mapped.kind;
          if (!Array.isArray(_me.tasks)) _me.tasks = _mapped.tasks.slice();
        }
        if (_me.kind !== "light" && _me.kind !== "full" && _me.kind !== "none") _me.kind = "light";
        // The optional cleaning TIME. Anything that is not a literal "HH:MM" is
        // DROPPED rather than coerced: the field feeds `sessionStartMs`, which
        // builds `date + "T" + time` and yields NaN on a malformed value — and
        // a NaN cleaning moment silently counts ZERO sessions since, i.e. the
        // pipe leaves the reminders. That is the exact defect this field was
        // added to fix, so a hand-edited backup must not be able to reproduce
        // it. Deleting the key falls back to noon, which is the documented
        // meaning of "no time" on both sides of the comparison.
        if (typeof _me.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(_me.time)) {
          if (typeof _me.time !== "undefined") delete _me.time;
        }
        _me.tasks = Array.isArray(_me.tasks)
          ? _me.tasks.filter(function (x: any) { return _MAINT_TASK_KEYS.indexOf(x) >= 0; })
          : [];
        if (typeof _me.type !== "undefined") delete _me.type;
      }
      // Data repair (via the shared dedupeIds): re-stamp
      // broken maintenance ids. An old addMaintenance bug wrote `id: 0`
      // on EVERY entry, so pipes with 2+ entries hold duplicate id:0 — flagged
      // by the maintenance-id-unique invariant but never repaired, so it fired
      // on every save(). dedupeIds gives any missing / zero / duplicate id a
      // fresh unique id (per pipe), restoring uniqueness so update/remove
      // target one entry again. Idempotent.
      dedupeIds(_pp.maintenance);
    }
  }
  if (Array.isArray(d.accessories)) {
    for (var ai = 0; ai < d.accessories.length; ai++) {
      _coerceStringFields(d.accessories[ai], _ACC_STR_FIELDS);
      // User tags on accessories.
      var _acc = d.accessories[ai];
      if (_acc && _acc.tags !== undefined) _acc.tags = _sanitizeTags(_acc.tags);
    }
  }
  // Pipes and accessories store purchase / production
  // dates as year-only strings (`YYYY`) instead of full ISO dates.
  // Existing data (full `YYYY-MM-DD`) is truncated in place to keep
  // the YYYY prefix. Idempotent — re-runs on already-trimmed strings
  // are no-ops. Format other than 4+ leading digits is cleared
  // (`"foo"` or empty stays empty; `"2024-03-12"` → `"2024"`;
  // `"2017-09"` → `"2017"`; `"2017"` stays as-is).
  if (Array.isArray(d.pipes)) {
    for (var pyi = 0; pyi < d.pipes.length; pyi++) {
      _truncateToYear(d.pipes[pyi], ["datePurchased", "dateProduction"]);
    }
  }
  if (Array.isArray(d.accessories)) {
    for (var ayi = 0; ayi < d.accessories.length; ayi++) {
      _truncateToYear(d.accessories[ayi], ["datePurchased"]);
    }
  }
  if (Array.isArray(d.sessions)) {
    for (var si = 0; si < d.sessions.length; si++) {
      _coerceStringFields(d.sessions[si], _SESS_STR_FIELDS);
      // Keep only known aroma keys (drops garbage from a forged
      // import) and normalise to wheel order. Leaves legacy sessions (no
      // `aromas`) untouched.
      var _s = d.sessions[si];
      if (_s && _s.aromas !== undefined) _s.aromas = sanitizeAromas(_s.aromas);
    }
  }
  if (Array.isArray(d.wishlist)) {
    for (var wi = 0; wi < d.wishlist.length; wi++) {
      _coerceStringFields(d.wishlist[wi], _WISH_STR_FIELDS);
      // See the tobacco loop above — strict boolean, `=== true`.
      var _w = d.wishlist[wi];
      if (_w && _w.catalogueLock !== undefined) _w.catalogueLock = _w.catalogueLock === true;
    }
  }
  // Back-fill session.tobaccoSnapshot / pipeSnapshot for
  // existing sessions that pre-date the field. Looks up the referenced
  // entity once at load time and freezes (brand, name) on the session
  // so the journal stays readable if the tobacco / pipe is hard-deleted
  // later. Only sets the snapshot when it's absent — never overwrites a
  // user-edited or freshly-stamped one.
  //
  // Extension: the snapshot also carries `imageUrl`. We
  // back-fill that field on existing snapshots when it's missing (so
  // an older snapshot built by the legacy-photo migration gets its
  // image filled in on the next launch). Only writes when the
  // referenced entity is still around — if it's gone, we can't
  // recover the image; the snapshot stays brand+name only.
  if (Array.isArray(d.sessions) && Array.isArray(d.tobaccos) && Array.isArray(d.pipes)) {
    // Object.create(null) — forged ids could otherwise alias prototype methods.
    var tobIndex: Record<string, any> = Object.create(null);
    d.tobaccos.forEach(function (t: any) { if (t && t.id !== undefined) tobIndex[String(t.id)] = t; });
    var pipeIndex: Record<string, any> = Object.create(null);
    d.pipes.forEach(function (p: any) { if (p && p.id !== undefined) pipeIndex[String(p.id)] = p; });
    // Only reassign d.sessions when a snapshot was actually
    // back-filled — otherwise keep the same array reference (avoids needless
    // churn now that the collections are always arrays, so this block always
    // runs). `_anySnap` tracks whether any session changed.
    var _anySnap = false;
    var _mappedSessions = d.sessions.map(function (s: any) {
      if (!s) return s;
      var patch: any = {};
      if (s.tobaccoId !== undefined && s.tobaccoId !== "") {
        var t = tobIndex[String(s.tobaccoId)];
        if (t) {
          if (!s.tobaccoSnapshot) {
            patch.tobaccoSnapshot = {
              brand: t.brand || "",
              name: t.name || "",
              imageUrl: t.imageUrl || "",
            };
          } else if (s.tobaccoSnapshot.imageUrl === undefined) {
            patch.tobaccoSnapshot = Object.assign({}, s.tobaccoSnapshot, {
              imageUrl: t.imageUrl || "",
            });
          }
        }
      }
      if (s.pipeId !== undefined && s.pipeId !== "") {
        var p = pipeIndex[String(s.pipeId)];
        if (p) {
          if (!s.pipeSnapshot) {
            patch.pipeSnapshot = {
              brand: p.brand || "",
              name: p.name || "",
              imageUrl: p.imageUrl || "",
            };
          } else if (s.pipeSnapshot.imageUrl === undefined) {
            patch.pipeSnapshot = Object.assign({}, s.pipeSnapshot, {
              imageUrl: p.imageUrl || "",
            });
          }
        }
      }
      if (Object.keys(patch).length) { _anySnap = true; return Object.assign({}, s, patch); }
      return s;
    });
    if (_anySnap) d.sessions = _mappedSessions;
  }
  // Back-fill + REPAIR lot ids. Old data (and the auto-created starter lot
  // in an early release) left lots without an `id`, which made every lot map to
  // <option value="undefined"> in the session lot picker (iOS Safari could not
  // distinguish them). The old index-based lot mutation
  // ALSO produced real DUPLICATE lot ids in user data (documented in CLAUDE.md
  // §Primary-key invariant) — update/remove/changeLotStatus match by id and
  // would then hit BOTH colliding lots, and the lot-id-unique invariant fired
  // on every save() with no way to stand down (no UI edits a lot id). The
  // shared `dedupeIds` (deterministic, idempotent, seeded above the max valid
  // id present) re-stamps any missing / zero / duplicate lot id PER TOBACCO,
  // keeping the first occurrence's id + its session links. Replaces the old
  // Date.now()-seeded (non-deterministic) missing-only back-fill.
  //
  // THE COUNTER IS SEEDED FROM THE GLOBAL MAX AND THREADED, while the
  // DUPLICATE TEST STAYS PER TOBACCO — and that split is the whole decision.
  //
  // What was actually broken: `dedupeIds` seeds its counter from the array it
  // is handed, so calling it per tobacco with no shared counter made two
  // id-less lots under two different tobaccos BOTH become `1`. A freshly
  // minted id could collide with an id another tobacco already carries, and
  // `useTrashOps.permanentlyDelete("lot", id)` + `sweepExpiredTrash` both
  // filter BY LOT ID ACROSS EVERY TOBACCO — so purging one tobacco's trashed
  // lot hard-deletes another's LIVE lot and clears `lotId` on its sessions.
  // Threading a globally-seeded counter closes that: a MINTED id clears every
  // lot id anywhere in the cellar.
  //
  // What must NOT be "repaired": an id that two tobaccos ALREADY share.
  // Flattening every lot into one array and deduping it was tried and is a
  // data-loss bug of its own — re-stamping an existing, valid lot id ORPHANS
  // every session referencing it (`session.lotId` is matched by value), and
  // those sessions are the user's own history. A pre-existing test pinned
  // exactly this and was right. The balance invariant keys on
  // `tobaccoId|lotId`, so a cross-tobacco pair is unambiguous where it
  // matters; the residual is disclosed rather than fixed destructively — the
  // trash ops can still reach a same-id lot under another tobacco, and the
  // remedy for that belongs at those call sites, not in a migration that
  // rewrites ids nobody asked it to touch.
  if (Array.isArray(d.tobaccos)) {
    var _lotMax = 0;
    for (var _tdi = 0; _tdi < d.tobaccos.length; _tdi++) {
      var _tob = d.tobaccos[_tdi];
      if (!_tob || !Array.isArray(_tob.lots)) continue;
      for (var _lj = 0; _lj < _tob.lots.length; _lj++) {
        var _ln = _idNum(_tob.lots[_lj] && _tob.lots[_lj].id);
        if (_ln !== null && _ln > _lotMax) _lotMax = _ln;
      }
    }
    var _lotNext = _lotMax + 1;
    for (var _tdk = 0; _tdk < d.tobaccos.length; _tdk++) {
      var _tob2 = d.tobaccos[_tdk];
      if (!_tob2 || !Array.isArray(_tob2.lots)) continue;
      _lotNext = dedupeIds(_tob2.lots, _lotNext);
    }
  }
  // Index Σ(sessions.weight) per lotId so the weightInitial back-fill
  // can reconstruct an accurate initial value rather than aliasing the
  // current weight. A lot legacy partially consumed
  // would otherwise see weightInitial = current weight, making the
  // auto-revert rule misfire on subsequent restoration.
  // Object.create(null) — lotId is user-controlled (forged import).
  var smokedByLot: Record<string, number> = Object.create(null);
  if (Array.isArray(d.sessions)) {
    d.sessions.forEach(function (s: any) {
      if (!s || !s.lotId) return;
      // Skip soft-deleted sessions. deleteSession already restored
      // their weightG into the lot balance, so counting them here would
      // double-count and inflate the back-filled weightInitial.
      if (s.deletedAt) return;
      var w = parseFloat(s.weightG);
      if (isNaN(w) || w <= 0) return;
      smokedByLot[String(s.lotId)] = (smokedByLot[String(s.lotId)] || 0) + w;
    });
  }
  if (Array.isArray(d.tobaccos)) {
    d.tobaccos = d.tobaccos.map(function (tb: any) {
      if (!tb || !Array.isArray(tb.lots)) return tb;
      var anyLotChanged = false;
      var newLots = tb.lots.map(function (l: any) {
        var upd: any = {};
        // Lot ids are already present + unique here (dedupeIds ran
        // in the pre-pass above), so no missing-id back-fill is needed.
        // Back-fill the initial-weight field (refined 96).
        // Reconstruct from `weightG + Σ(sessions on this lot)` so a
        // partially-consumed legacy lot ends up with the historically
        // accurate initial. Falls back to `weightG` alone when no sessions
        // reference the lot.
        if (l && (l.weightInitial === undefined
                  || l.weightInitial === null
                  || l.weightInitial === "")) {
          var cur = parseFloat(l.weightG);
          var idKey = l && l.id;
          var smoked = idKey !== undefined && idKey !== null && idKey !== ""
            ? (smokedByLot[String(idKey)] || 0)
            : 0;
          if (!isNaN(cur)) {
            upd.weightInitial = String(Math.round((cur + smoked) * 10) / 10);
          } else {
            upd.weightInitial = "";
          }
        }
        // Back-fill `originalStatus` — separates the lot's
        // recorded original state from heuristic weight-based guessing.
        // Heuristic for legacy lots:
        //   - jar / finished with no `dateOpened` → started as jar
        //     (a jar-from-start lot never had an opening date filled).
        //   - everything else (incl. status === "cellar") → started
        //     as cellar (sealed tin or opened-from-sealed, both rooted
        //     in the cellar lifecycle).
        if (l && (l.originalStatus === undefined
                  || l.originalStatus === null
                  || l.originalStatus === "")) {
          var startedAsJar = (l.status === "jar" || l.status === "finished")
            && !l.dateOpened;
          upd.originalStatus = startedAsJar ? "jar" : "cellar";
        }
        // An earlier boxNumber-only coercion was superseded by the
        // global `_coerceStringFields(_LOT_STR_FIELDS)` pass earlier in
        // migrateData. boxNumber + the rest of the lot string fields
        // are guaranteed strings by the time we reach this branch.
        if (Object.keys(upd).length) {
          anyLotChanged = true;
          return Object.assign({}, l, upd);
        }
        return l;
      });
      return anyLotChanged ? Object.assign({}, tb, { lots: newLots }) : tb;
    });
  }
  // Clean up any leftover HTML-like markup (e.g. <cite>
  // citation tags from web-search-augmented AI responses) that landed
  // in stored strings before the sanitisation was in place.
  // Mutates in place — only the changed strings are replaced.
  _scrubAiMarkup(d);
  // Guard-rail — clear any legacy/imported external-URL imageUrl.
  _clearForeignImageRefs(d);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeStats — pure aggregate used by Home + Stats views.
//
// CORRECTED, because this paragraph asserted the opposite of the code for
// several releases: `cellar` / `jars` / `lotsFinished` / `lotsOveraged` /
// `lotsApproaching` count LOTS, not tobaccos. They WERE tobacco counts once —
// which is what this said, and why it read as current — and were changed back
// on the user's preference ("just count all the boxes in cellar, all the jars
// in use"); see the comment at the loop itself, which has been right all
// along. It also named an `aging` counter this function does not return.
// `activeRefs` is the tobacco count.
//
// The distinction is not academic: the Home "À fumer rapidement" tile sums two
// of these, so it speaks in LOTS and agrees with the maturity bar above it,
// while the list it opens shows TOBACCOS. Reading this comment instead of the
// loop is how one would "fix" that gap in the wrong direction.
//
// Other aggregates are unchanged: `wt` (active weight), `tobVal` (active
// price total), `avg` (rating average), per-category and per-brand counts.
// ─────────────────────────────────────────────────────────────────────────────
export function computeStats(data: any) {
  if (!data) return {};
  var all = (data.tobaccos || []) as Tobacco[];
  // Post-fuzz: coerce monetary / weight reads to non-negative
  // finite numbers. `parseFloat(x) || 0` only catches NaN — a forged
  // import with `weightG: "-1e-45"` or `price: -0.001` would slip a
  // negative value into the accumulator and the home tile would show
  // a negative weight or value. Caught by the computeStats
  // property fuzz.
  function nonNeg(v: any): number {
    var n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  var aLots: Lot[] = [];
  all.forEach(function (t) {
    (t.lots || []).forEach(function (l) {
      if (l.status !== "finished") aLots.push(l);
    });
  });
  var wt = aLots.reduce(function (s, l) {
    return s + nonNeg(l.weightG);
  }, 0);
  // Home tile counters — total LOTS in each status (boxes / jars / done /
  // aging). These were briefly tobacco-based; the user prefers the
  // raw lot total ("just count all the boxes in cellar / all the jars in
  // use"). The "Tabacs" mini-stat above the tile row is a tabac count
  // (`activeRefs`) — Home cleanly splits the two semantics: refs at the
  // top, lots in the tiles.
  var cellarLots = 0, jarLots = 0, finishedLots = 0;
  var approachingLots = 0, overagedLots = 0;
  all.forEach(function (t: any) {
    var lots = t.lots || [];
    for (var li = 0; li < lots.length; li++) {
      var l = lots[li];
      if (l.status === "cellar") cellarLots++;
      else if (l.status === "jar") jarLots++;
      else if (l.status === "finished" && !l.disposed) finishedLots++;
      var st = lotAgingStatus(l, effectiveAgingMax(t));
      if (st === "overaged") overagedLots++;
      else if (st === "approaching") approachingLots++;
    }
  });
  var aRefs = all.filter(hasActive).length;
  // Post-CI: `Object.create(null)` instead of `{}` so a
  // user-controlled key like "toString" / "constructor" / "valueOf"
  // doesn't resolve through Object.prototype. Without this guard,
  // `(cats["toString"] || 0) + 1` reads the inherited
  // `Object.prototype.toString` function and the `+ 1` becomes a
  // string concat, poisoning the aggregate. Caught by the
  // stats property fuzz on the parallel `computeChartStats` helper.
  var cats: Record<string, number> = Object.create(null);
  all.forEach(function (t) {
    if (t.category && hasActive(t))
      cats[t.category] = (cats[t.category] || 0) + 1;
  });
  var brands: Record<string, number> = Object.create(null);
  all.forEach(function (t) {
    if (t.brand && hasActive(t))
      brands[t.brand] = (brands[t.brand] || 0) + 1;
  });
  var rated = all.filter(function (t) {
    return t.rating > 0 && hasActive(t);
  });
  var avg = rated.length
    ? (rated.reduce(function (s, t) { return s + t.rating; }, 0) / rated.length).toFixed(1)
    : "—";
  var aP = ((data.pipes || []) as Pipe[]).filter(pipeIsActive);
  var fP = ((data.pipes || []) as Pipe[]).filter(function (p) { return !pipeIsActive(p); });
  var pVal = aP.reduce(function (s, p) { return s + nonNeg(p.price); }, 0);
  var pBr: Record<string, number> = Object.create(null);
  aP.forEach(function (p) { if (p.brand) pBr[p.brand] = (pBr[p.brand] || 0) + 1; });
  var pSh: Record<string, number> = Object.create(null);
  aP.forEach(function (p) { if (p.shape) pSh[p.shape] = (pSh[p.shape] || 0) + 1; });
  var pRa = aP.filter(function (p) { return p.rating > 0; });
  var pAv = pRa.length
    ? (pRa.reduce(function (s, p) { return s + p.rating; }, 0) / pRa.length).toFixed(1)
    : "—";
  var tobVal = 0;
  all.forEach(function (t) {
    (t.lots || []).forEach(function (l) {
      if (l.status !== "finished" && l.price) tobVal += nonNeg(l.price);
    });
  });
  var pipeOldest: number | null = null;
  aP.forEach(function (p) {
    var d = p.dateProduction || p.datePurchased;
    if (d) {
      var days = daysSince(d);
      // Post-fuzz: clamp to ≥ 0. A future date (forged
      // import, system clock skew) would otherwise produce a negative
      // "oldest" value.
      if (typeof days === "number" && Number.isFinite(days) && days >= 0) {
        if (pipeOldest === null || days > pipeOldest) pipeOldest = days;
      }
    }
  });
  var pFlt: Record<string, number> = Object.create(null);
  var pNoFilter = 0;
  aP.forEach(function (p) {
    if (p.filterType) pFlt[p.filterType] = (pFlt[p.filterType] || 0) + 1;
    else pNoFilter++;
  });
  return {
    total: all.length,
    activeRefs: aRefs,
    cellar: cellarLots,
    jars: jarLots,
    lotsFinished: finishedLots,
    lotsOveraged: overagedLots,
    lotsApproaching: approachingLots,
    wt: wt,
    avg: avg,
    cats: Object.entries(cats).sort(function (a, b) { return (b[1] as number) - (a[1] as number); }),
    brands: Object.entries(brands).sort(function (a, b) { return (b[1] as number) - (a[1] as number); }),
    pipesActive: aP.length,
    pipesFinished: fP.length,
    pipeVal: pVal,
    pipeAvg: pAv,
    pipeBrands: Object.entries(pBr).sort(function (a, b) { return (b[1] as number) - (a[1] as number); }),
    pipeShapes: Object.entries(pSh).sort(function (a, b) { return (b[1] as number) - (a[1] as number); }),
    pipeFilters: Object.entries(pFlt).sort(function (a, b) { return (b[1] as number) - (a[1] as number); }),
    pipeNoFilter: pNoFilter,
    pipeOldest: pipeOldest,
    tobVal: tobVal,
    wish: (data.wishlist || []).length,
  };
}

// Insert a ZERO-WIDTH SPACE after each slash so a compound
// label wraps at the slash rather than mid-word.
//
// The one that reported it: the Home "Familles" list renders category names in
// an 81px column, and "Virginia/Burley" needs 88px at the default text size and
// 98px at "L" — so it MUST wrap, and the only question is where. The column
// carries `overflow-wrap: anywhere` (to stop the label being clipped
// outright), and "anywhere" means literally anywhere: it broke as
// "Virginia/Burle" + "y".
//
// `break-word` is not the alternative — "/" is UAX #14 class SY and is not a
// break opportunity on its own, so the label would overflow instead. U+200B IS
// one, and it is ignored by screen readers, by copy/paste and by search.
//
// Display-only. Never store the result: it would poison every comparison the
// app makes on a category value.
export function softBreakSlashes(s: string): string {
  return String(s == null ? "" : s).replace(/\//g, "/​");
}
