// Compare two or three blends side by side.
//
// ── WHY THIS IS A PURE MODULE ───────────────────────────────────────────────
// The comparison's whole value is that the columns are commensurable: the same
// question asked of each blend, answered from the same place. That is a data
// shape, not a rendering concern, and it is the part worth asserting.
//
// ── THE COLUMNS ARE NOT SYMMETRIC, AND THAT IS THE POINT ────────────────────
// You can compare a blend you OWN against one you do not — a catalogue entry, or
// a wishlist item. That is the most useful case (« est-ce que j'achète celui-là
// plutôt que celui que j'ai déjà ? ») and it means one column can answer
// questions the other cannot:
//
//   FACTUAL   category, cut, composition, strength, room note, taste, ageing,
//             description — a catalogue entry carries all of these, so both
//             sides answer and this is where a purchase decision is made.
//   EXPERIENCE your rating, stock, oldest lot, sessions, average session rating,
//             cost per bowl, aromas you perceived — these exist only for what
//             you own. A catalogue or wishlist column reports `null` here.
//
// So a comparison reads "what this blend IS" against "what that blend is AND
// what it gave me". Not a limitation — the shape of the question.
//
// ── EVERY UNKNOWN IS `null`, NEVER 0 ────────────────────────────────────────
// A Force that was never filled in must not read as "very mild", and a blend
// with no sessions must not read as "rated 0". The view renders `null` as "—".
// This is the one rule a caller can get wrong and it is asserted below, because
// 0 and "unknown" are the same byte in the stored data (`BT` seeds force: 0).

import { effectiveAgingMax, daysSince } from "../utils.ts";
import { FAMILY_AGING_MAX } from "../utils.ts";
import { computeAromaProfile } from "./stats.ts";
import { pickLang } from "./docPage.ts";

/** How many columns fit before the layout stops being readable at 390 px. */
export const COMPARE_MAX = 3;

export type CompareSource = "cellar" | "catalogue" | "wish";

export interface CompareItem {
  /** Stable pick id: "<source>:<id-or-key>". */
  key: string;
  source: CompareSource;
  brand: string;
  name: string;
  // ── factual: both sides can answer ──
  category: string | null;
  cut: string | null;
  blend: string | null;
  force: number | null;
  roomNote: number | null;
  taste: number | null;
  agingMax: string | null;
  description: string | null;
  // ── experience: only what you own ──
  rating: number | null;
  stockG: number | null;
  oldestLotDays: number | null;
  sessions: number | null;
  avgSessionRating: number | null;
  costPerSession: number | null;
  aromas: string[];
}

/** A 0-5 score that was never filled in is UNKNOWN, not "zero". */
function score(v: any): number | null {
  var n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: any): string | null {
  var s = String(v == null ? "" : v).trim();
  return s ? s : null;
}

/** The ageing figure the app would actually SHOW: own value, else family default. */
function agingFor(agingMax: any, category: any): string | null {
  var own = String(agingMax == null ? "" : agingMax).trim();
  if (own) return own;
  var fam = FAMILY_AGING_MAX[String(category || "")];
  return fam ? fam : null;
}

/**
 * One of YOUR tobaccos. `sessions` is the whole live journal; `costIndex` maps
 * a tobacco id to its cost-per-bowl (from `computeCostPerSession`), injected so
 * this module never re-derives an aggregate that already has a home.
 */
export function compareItemFromTobacco(
  tob: any,
  sessions: any[] | null | undefined,
  costIndex?: Record<string, number> | null,
): CompareItem {
  var own = (sessions || []).filter(function (s: any) {
    return s && !s.deletedAt && String(s.tobaccoId) === String(tob && tob.id);
  });
  var rated = own.filter(function (s: any) { return Number(s.rating) > 0; });
  var lots = ((tob && tob.lots) || []).filter(function (l: any) {
    return l && !l.deletedAt && l.status !== "finished";
  });
  var stock = lots.reduce(function (n: number, l: any) {
    var w = Number(l.weightG);
    return n + (Number.isFinite(w) ? w : 0);
  }, 0);
  // Oldest ACTIVE lot, by the date the app itself ages a lot from.
  var oldest: number | null = null;
  lots.forEach(function (l: any) {
    var d = l.dateProduction || l.datePurchased;
    if (!d) return;
    // daysSince returns null on an unparseable date — a lot with a
    // garbage date must not read as "0 days old".
    var days = daysSince(d);
    if (days === null || !Number.isFinite(days)) return;
    if (oldest === null || days > (oldest as number)) oldest = days;
  });
  var cost = costIndex ? costIndex[String(tob && tob.id)] : undefined;
  var aro = computeAromaProfile(own, 4);
  return {
    key: "cellar:" + String(tob && tob.id),
    source: "cellar",
    brand: String((tob && tob.brand) || ""),
    name: String((tob && tob.name) || ""),
    category: str(tob && tob.category),
    cut: str(tob && tob.cut),
    blend: str(tob && tob.blend),
    force: score(tob && tob.force),
    roomNote: score(tob && tob.roomNote),
    taste: score(tob && tob.taste),
    agingMax: str(effectiveAgingMax(tob)),
    description: str(tob && tob.description),
    rating: score(tob && tob.rating),
    stockG: stock > 0 ? stock : null,
    oldestLotDays: oldest,
    sessions: own.length,
    avgSessionRating: rated.length
      ? rated.reduce(function (n: number, s: any) { return n + Number(s.rating); }, 0) / rated.length
      : null,
    costPerSession: (typeof cost === "number" && cost > 0) ? cost : null,
    aromas: aro.items.map(function (i: any) { return String(i.key); }),
  };
}

/**
 * A catalogue blend you do NOT own. Everything under "experience" is null by
 * construction — see the header. `key` is the catalogue's own canonical
 * "<brand_key>|<name>", so a pick survives a re-render without a lookup.
 */
export function compareItemFromCatalogue(
  blendKey: string,
  entry: any,
  lang: string,
  brandDisplay?: string,
): CompareItem {
  return {
    key: "catalogue:" + String(blendKey),
    source: "catalogue",
    brand: String(brandDisplay || (entry && entry.brandDisplay) || String(blendKey).split("|")[0] || ""),
    name: String((entry && entry.name) || ""),
    category: str(entry && entry.category),
    cut: str(entry && entry.cut),
    blend: str(entry && entry.blend),
    force: score(entry && entry.force),
    roomNote: score(entry && entry.roomNote),
    taste: score(entry && entry.taste),
    agingMax: agingFor(entry && entry.agingMax, entry && entry.category),
    description: str(entry && entry.description ? pickLang(entry.description, lang) : ""),
    rating: null,
    stockG: null,
    oldestLotDays: null,
    sessions: null,
    avgSessionRating: null,
    costPerSession: null,
    aromas: [],
  };
}

/** A wishlist item: the same shape as a catalogue entry — factual, no history. */
export function compareItemFromWish(w: any): CompareItem {
  return {
    key: "wish:" + String(w && w.id),
    source: "wish",
    brand: String((w && w.brand) || ""),
    name: String((w && w.name) || ""),
    category: str(w && w.category),
    cut: str(w && w.cut),
    blend: str(w && w.blend),
    force: score(w && w.force),
    roomNote: score(w && w.roomNote),
    taste: score(w && w.taste),
    agingMax: agingFor(w && w.agingMax, w && w.category),
    description: str(w && w.description),
    rating: null,
    stockG: null,
    oldestLotDays: null,
    sessions: null,
    avgSessionRating: null,
    costPerSession: null,
    aromas: [],
  };
}

export type CompareRowKind = "enum" | "score" | "text" | "weight" | "age" | "count" | "money" | "stars" | "aromas";

export interface CompareRow {
  field: string;
  labelKey: string;
  kind: CompareRowKind;
  /** One cell per item, in the order given. `null` = unknown → the view shows "—". */
  values: any[];
  /** True when the cells are not all equal — what a comparison is FOR. */
  differs: boolean;
  /** True for the rows only an owned blend can answer. */
  experience: boolean;
}

// The row order IS the reading order: identity first, then what decides a
// purchase, then what only your own history can say.
//
// EVERY labelKey HERE MUST EXIST IN EVERY DICTIONARY, and the
// test at the bottom of compareBlends.test.ts is what makes that true.
// `lbl_category` and `lbl_rating` did not exist and shipped as the raw keys
// LBL_CATEGORY / LBL_RATING on screen — the first row of the table among them.
// This is the invented-i18n-key defect verbatim, and CompareModal's own header warns
// about it ("a built key is invisible to doc:check's gate and a missing one
// renders the RAW KEY"): that warning was applied to the SOURCE labels, which
// got an explicit table, while these fourteen were assumed to exist because
// they read like generic names. A table is not the guarantee — checking it is.
// The two are now the keys the FORMS already use for the same two fields, so
// the comparison speaks the app's vocabulary rather than a private synonym.
const ROWS: Array<[string, string, CompareRowKind, boolean]> = [
  ["category", "lbl_type", "enum", false],
  ["cut", "lbl_cut", "enum", false],
  ["blend", "lbl_blend", "text", false],
  ["force", "lbl_force", "score", false],
  ["roomNote", "lbl_room_note", "score", false],
  ["taste", "lbl_taste", "score", false],
  ["agingMax", "lbl_aging_max", "age", false],
  ["rating", "lbl_rating_lbl", "stars", true],
  ["stockG", "lbl_in_stock", "weight", true],
  ["oldestLotDays", "cmp_oldest_lot", "count", true],
  ["sessions", "cmp_sessions", "count", true],
  ["avgSessionRating", "cmp_avg_session", "stars", true],
  ["costPerSession", "cmp_cost_bowl", "money", true],
  ["aromas", "cmp_aromas", "aromas", true],
];

function sameValue(a: any, b: any): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    var xa = Array.isArray(a) ? a : [];
    var xb = Array.isArray(b) ? b : [];
    return xa.length === xb.length && xa.every(function (v, i) { return v === xb[i]; });
  }
  return a === b;
}

/**
 * Turn the picked items into rows. Pure: the view decides how to draw a cell,
 * this decides WHICH cells there are and whether they disagree.
 *
 * A row where EVERY column is unknown is dropped — an all-"—" line is noise, and
 * on a two-catalogue-column comparison that would be the whole experience block.
 */
export function buildComparison(items: CompareItem[]): CompareRow[] {
  var list = (items || []).slice(0, COMPARE_MAX);
  if (list.length < 2) return [];
  var out: CompareRow[] = [];
  ROWS.forEach(function (spec) {
    var field = spec[0];
    var values = list.map(function (it: any) {
      var v = it ? it[field] : null;
      return v === undefined ? null : v;
    });
    var known = values.filter(function (v) {
      return v !== null && !(Array.isArray(v) && v.length === 0);
    });
    if (!known.length) return;                       // nothing to compare
    var first = values[0];
    var differs = values.some(function (v) { return !sameValue(v, first); });
    out.push({
      field: field,
      labelKey: spec[1],
      kind: spec[2],
      values: values,
      differs: differs,
      experience: spec[3],
    });
  });
  return out;
}

/**
 * True when at least one column can answer the experience rows — i.e. the user
 * owns at least one of the picks. The view uses it to explain the empty half
 * instead of letting a column of "—" look like a bug.
 */
export function hasExperienceColumn(items: CompareItem[]): boolean {
  return (items || []).some(function (i) { return i && i.source === "cellar"; });
}
