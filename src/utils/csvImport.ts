/**
 * CSV import for tobaccos + their lots.
 *
 * `parseTobaccoCsv(text)` reads the SAME per-lot CSV shape the app exports
 * (`buildCsvLines` in useExportImport) — one row per lot, the tobacco fields
 * repeated — so an export can be edited in a spreadsheet and re-imported
 * (round-trip). It also accepts a hand-built subset: columns are matched by
 * HEADER NAME (accent-/case-insensitive, units in parentheses stripped), not
 * by position, so `Marque;Nom;Poids;Prix` is enough. Only Marque + Nom are
 * required (the tobacco identity).
 *
 * Rows sharing the same brand+name (case-insensitive) collapse into ONE
 * tobacco with several lots. Every value is coerced defensively (enums snap to
 * the canonical list or "Autre", ratings clamp 0–5, dates normalise, garbage
 * numbers blank out), and the whole thing is pure + string-only so it can be
 * fuzzed. The result is a tobaccos-only payload fed to the merge import path.
 */

import { CATS, CUTS, CAT_MAP, CUT_MAP, BT, BL } from "../constants.ts";

/**
 * One entry per row the parser could not read as written.
 *
 * The counts alone are not actionable: on a 400-row cellar export « 3 valeurs
 * non reconnues » leaves the user to find them in a spreadsheet. `row` counts
 * the header as line 1, so it matches the gutter they are looking at.
 */
export interface CsvImportIssue {
  row: number;
  kind: "no-identity" | "category" | "cut" | "number";
  brand: string;
  name: string;
  /** The offending label, for the taxonomy kinds and for `number`. */
  value: string;
}

/** Detail-list cap. The COUNTS below stay exact; only the list is bounded.
 *  Separate from the catalogue's `MAX_CATALOGUE_ISSUES` on purpose: it is a
 *  display bound, not a rule the two importers must agree on. */
export var MAX_CSV_ISSUES = 500;

export interface CsvImportResult {
  tobaccos: any[];   // full Tobacco objects (id + lots) ready for the merge import
  rows: number;      // data rows read (excludes header + blank lines)
  skipped: number;   // rows dropped for missing brand+name
  lots: number;      // lots created
  headers: string[]; // canonical field keys recognised in the header
  sectioned: boolean; // true if a "=== SECTION ===" marker was hit (multi-section export CSV)
  capped: boolean;    // true if MAX_ROWS was reached and the rest was dropped
  badCategory: number; // rows whose category was snapped to "Autre" (EXACT)
  badCut: number;      // rows whose cut was snapped to "Autre" (EXACT)
  badNumber: number;   // numeric cells that held something unreadable (EXACT)
  issues: CsvImportIssue[]; // capped at MAX_CSV_ISSUES
  issuesTruncated: boolean; // the list hit the cap; the counts above did not
}

// Defence-in-depth soft cap on the number of DATA rows processed.
// FileReader already materialises the whole file as a string, so a pathological
// multi-hundred-MB import can't be prevented here, but this bounds the work +
// output size to a sane ceiling (a real cellar is hundreds of lot-rows, not
// tens of thousands) and lets the caller warn that rows were dropped rather
// than silently truncating.
export var MAX_ROWS = 50000;

/**
 * THE delimiter every CSV this app WRITES uses — and the reason is a
 * spreadsheet, not a parser.
 *
 * Reading is delimiter-agnostic: `detectDelim` sniffs the header line, so a
 * comma file, a semicolon file and a tab file all import identically, and every
 * catalogue already loaded goes on reading exactly as before. What differs is
 * what happens when someone DOUBLE-CLICKS the file — which is the whole point
 * of a template, and the ordinary way an export gets looked at.
 *
 * Excel picks its delimiter from the system list separator, and in every
 * comma-decimal locale that separator is `;`. Five of the app's six UI
 * languages are comma-decimal (fr, es, de, it, pt), so a comma file opens as
 * ONE column for most users — a template nobody can fill in.
 *
 * It is not merely preferable for the cellar export, it is the coherent
 * choice: the app stores weights and prices AS THE USER TYPED THEM, so a French
 * cellar legitimately holds `2,5`. `csvEsc` quotes every cell, so a comma
 * decimal survives either way — but a file whose delimiter and whose decimal
 * mark are the same character is one editing mistake away from splitting.
 *
 * The residual, stated rather than hidden: in an English locale Excel expects
 * `,`, so an English user gets the one-column open instead. A `sep=;` preamble
 * would fix both — Excel and LibreOffice honour it — and is deliberately NOT
 * used: Numbers does not, and it would show a stray first row on the platform
 * this app is built for first. One rule, five languages of six.
 *
 * WRITERS ONLY. Never feed this to a reader: `detectDelim` is what decides how
 * an incoming file is split, and hardcoding a delimiter there would refuse the
 * comma files this app itself emitted for years.
 */
export var CSV_DELIM = ";";

// ── low-level CSV tokeniser ──────────────────────────────────────────────────

// EXPORTED so the catalogue importer (`utils/userCatalogue.ts`)
// can reuse them. Both read a CSV a human may have edited in a spreadsheet, so
// they need the same delimiter sniffing and the same RFC-4180 handling of
// quoted fields, "" escapes and embedded newlines. Writing that a second time
// is the failure this repo keeps paying for — the tag predicate lived in four
// copies before it was shared. What differs between the two importers is the COLUMN
// contract, which is where each one keeps its own code.
export function detectDelim(headerLineRaw: string): string {
  var headerLine = String(headerLineRaw);
  var counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  var inQ = false;
  for (var i = 0; i < headerLine.length; i++) {
    var ch = headerLine.charAt(i);
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch] = (counts[ch] || 0) + 1;
  }
  var best = ";", bestN = -1;
  Object.keys(counts).forEach(function (d) {
    if ((counts[d] || 0) > bestN) { bestN = counts[d] || 0; best = d; }
  });
  return best;
}

// Full RFC-4180-ish tokeniser: handles quoted fields, "" escapes, quoted
// newlines, CRLF/LF. Returns an array of rows, each an array of string cells.
export function tokenize(textRaw: string, delim: string): string[][] {
  var text = String(textRaw);
  var rows: string[][] = [];
  var row: string[] = [];
  var field = "";
  var inQ = false;
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  // flush last field/row
  row.push(field);
  rows.push(row);
  return rows;
}

// ── header mapping ───────────────────────────────────────────────────────────

function fold(s: any): string {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")   // strip "(g)" / "(€)" units
    .replace(/\s+/g, " ")
    .trim().toLowerCase();
}

// Reverse the export's CSV formula-injection guard. `csvEsc`
// (useExportImport) prepends a single "'" to any cell whose first char is a
// formula metacharacter [= + - @ tab CR |]. Without undoing it on import, a
// brand / name legitimately starting with those chars accretes a permanent "'"
// on every round-trip — corrupting the value AND breaking the dupKey match so
// the merge duplicates the blend instead of topping up its lots. Strip exactly
// the guard apostrophe (one leading "'" followed by a metachar); a genuine
// leading "'" NOT followed by a metachar (e.g. "'twas") is left untouched. The
// guard isn't perfectly injective — a real "'=x" also collapses to "=x" — but
// that is vanishingly rare next to the common leading -/+/@/= brand case.
var _CSV_FORMULA_META = /^[=+\-@\t\r|]/;
function unescapeFormulaGuard(v: string): string {
  var s = String(v == null ? "" : v);
  if (s.charAt(0) === "'" && _CSV_FORMULA_META.test(s.slice(1))) return s.slice(1);
  return s;
}

// The FIXED set of section markers buildCsvLines emits (post-apostrophe-strip).
// Matching the exact set — instead of any "=== …" prefix — means a user brand
// that happens to start with "===" is parsed as a tobacco instead of silently
// triggering the section-stop and dropping that row + every row after it. FR
// export strings plus the EN aliases an older/foreign export might carry.
var _CSV_SECTION_MARKERS = [
  "=== PIPES ===", "=== WISHLIST ===", "=== ACCESSOIRES ===",
  "=== ACCESSORIES ===", "=== SEANCES ===", "=== JOURNAL ===",
];

var HEADER_ALIASES: Record<string, string> = {
  "marque": "brand", "brand": "brand",
  "nom": "name", "name": "name",
  "categorie": "category", "category": "category", "famille": "category",
  "composition": "blend", "blend": "blend", "melange": "blend",
  "coupe": "cut", "cut": "cut",
  "force": "force", "strength": "force",
  "room note": "roomNote", "roomnote": "roomNote",
  "gout": "taste", "taste": "taste", "gout taste": "taste",
  "description": "description",
  "note": "rating", "rating": "rating", "note perso": "rating",
  "a reprendre": "rebuy", "reprendre": "rebuy", "rebuy": "rebuy", "a racheter": "rebuy",
  "notes degustation": "tastingNotes", "tasting notes": "tastingNotes", "degustation": "tastingNotes",
  "age max cave": "agingMax", "age max": "agingMax", "vieillissement": "agingMax", "aging max": "agingMax", "aging": "agingMax",
  "statut": "status", "status": "status",
  "elimine": "disposed", "disposed": "disposed", "jete": "disposed",
  "poids": "weightG", "weight": "weightG", "poids actuel": "weightG",
  "poids initial": "weightInitial", "weight initial": "weightInitial", "initial weight": "weightInitial", "poids depart": "weightInitial",
  "statut origine": "originalStatus", "original status": "originalStatus",
  "date achat": "datePurchased", "achat": "datePurchased", "purchase date": "datePurchased", "date purchased": "datePurchased",
  "date production": "dateProduction", "production": "dateProduction", "production date": "dateProduction",
  "date mise en pot": "dateOpened", "mise en pot": "dateOpened", "date opened": "dateOpened", "opened": "dateOpened",
  "date fin": "dateFinished", "fin": "dateFinished", "date finished": "dateFinished", "finished date": "dateFinished",
  "no boite": "boxNumber", "boite": "boxNumber", "box": "boxNumber", "box number": "boxNumber",
  "lieu de stockage": "storageLocation", "stockage": "storageLocation", "storage": "storageLocation", "storage location": "storageLocation", "lieu": "storageLocation",
  "prix": "price", "price": "price",
  "vendeur": "seller", "seller": "seller",
  "site vendeur": "sellerUrl", "url vendeur": "sellerUrl", "seller url": "sellerUrl", "site du vendeur": "sellerUrl",
  "image url": "imageUrl", "image": "imageUrl",
  // "age" (computed display column) intentionally has NO mapping — ignored.
};

// ── value coercion ───────────────────────────────────────────────────────────

function clamp05(v: any): number {
  var n = parseInt(String(v == null ? "" : v).trim(), 10);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 5 ? 5 : n;
}

/**
 * The IMPORT CONTRACT applies here too.
 *
 * `CAT_MAP` / `CUT_MAP` are the trade labels a source may write (`Navy Cut`,
 * `Cigar`, `Krumble Kake`) mapped onto the app's canonical value. They existed
 * for the catalogue importer and this one never consulted them: a cellar CSV
 * saying `Navy Cut` became `Autre` while the same word in a catalogue becomes
 * `Flake`. That was an oversight, not a decision — a hand-typed cellar CSV is
 * at least as likely to carry a trade label as a curated delivery is, since it
 * is copied off the tin or exported from another app.
 *
 * FOLDED index, unlike the catalogue's exact `mapCut`: that one answers "is
 * this a trade label the contract knows?" and must not turn a typo into a
 * match, whereas this file is hand-typed — and this module has always been accent- and
 * case-tolerant against `CATS`/`CUTS`, so tolerating the same on the map is
 * the module's own contract rather than a new invention. Precomputed once:
 * per-row folding of a few dozen keys × MAX_ROWS would be real work.
 */
function foldIndex(map: Record<string, string>): Record<string, string> {
  var out: Record<string, string> = Object.create(null);
  for (var k in map) out[fold(k)] = map[k] as string;
  return out;
}
var _CAT_FOLD = foldIndex(CAT_MAP as unknown as Record<string, string>);
var _CUT_FOLD = foldIndex(CUT_MAP as unknown as Record<string, string>);

function canonEnum(v: any, list: readonly string[], map?: Record<string, string>): string {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return "";
  var f = fold(raw);
  for (var i = 0; i < list.length; i++) {
    if (fold(list[i]) === f) return list[i] as string;
  }
  if (map) {
    var mapped = map[f];
    // The target is re-checked against the list rather than trusted. It cannot
    // fail today (`enumMapsSingleSource.test.ts` asserts every map target is
    // canonical), and the check keeps this function total if that ever slips:
    // a bad target falls through to "Autre", the older behaviour.
    if (mapped) {
      var mf = fold(mapped);
      for (var j = 0; j < list.length; j++) {
        if (fold(list[j]) === mf) return list[j] as string;
      }
    }
  }
  // Coerced, NOT kept verbatim — and that is the opposite of what the
  // catalogue parser does, deliberately. A cellar fiche is edited in a form
  // whose dropdown is fixed, so an unrecognised value would be silently
  // rewritten the first time the user opens and saves it.
  // Snapping at import is deterministic; the caller REPORTS it.
  return list.indexOf("Autre") >= 0 ? "Autre" : "";
}

function parseRebuy(v: any): boolean | null {
  var f = fold(v);
  if (f === "oui" || f === "yes" || f === "y" || f === "true" || f === "1" || f === "o") return true;
  if (f === "non" || f === "no" || f === "n" || f === "false" || f === "0") return false;
  return null;
}

function parseBool(v: any): boolean {
  var f = fold(v);
  return f === "oui" || f === "yes" || f === "y" || f === "true" || f === "1" || f === "o";
}

function normStatus(v: any): string {
  var f = fold(v);
  if (f === "jar" || f === "pot" || f === "en pot" || f === "ouvert" || f === "ouverte") return "jar";
  if (f === "finished" || f === "fini" || f === "finie" || f === "termine" || f === "termine e" || f === "terminee") return "finished";
  if (f === "cellar" || f === "cave" || f === "en cave" || f === "scelle" || f === "scellee") return "cellar";
  return "";
}

/** Group separators a spreadsheet emits: ASCII space, NBSP, narrow NBSP, thin
 *  space, and the Swiss apostrophe (straight and typographic). */
var GROUP_SEP_RE = /[ \u00A0\u202F\u2009'\u2019]/g;
/** A plain decimal, once grouping is stripped and the decimal mark is a dot.
 *  Deliberately STRICTER than `parseFloat`, which stops at the first character
 *  it cannot read and reports nothing — that silence is the defect. */
var PLAIN_NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** The same decimal followed by a UNIT — a trailing run holding no digit.
 *
 *  Strictness against `parseFloat` is right for `1 234,5` → 1, where the answer
 *  is silently wrong by three orders of magnitude. It is WRONG for `50g`, where
 *  `parseFloat` returns 50, i.e. the correct answer: refusing that cell fixes
 *  no defect and destroys a weight this parser had always read. A tin is sold
 *  as "50g" or "2oz", so a hand-built file is likely to carry one, and this
 *  module's contract is tolerance everywhere else (accent-insensitive headers,
 *  FR+EN aliases, `dd.mm.yyyy`, EN-locale dates).
 *
 *  A suffix with no digit in it can only name the unit the column already
 *  names, so the number is unambiguous. A leading word (`env. 12` — an
 *  approximation) or a second number (`12abc34`) is refused and REPORTED,
 *  which is the half that was genuinely missing. */
var NUM_WITH_UNIT_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[^\d]*$/;

/**
 * Read a numeric cell.
 *
 * `value` is the canonical decimal string, or "" when the cell is empty OR
 * unreadable — the caller stores "" either way, and the app already reads an
 * absent weight as "untracked" rather than as zero. `bad` carries the raw text
 * when the cell held SOMETHING the parser could not read, so the caller can
 * report it; an EMPTY cell is never `bad`, because an absence is not a defect.
 *
 * It used to be `String(v).trim().replace(",", ".")` then `parseFloat` — ONE
 * comma, no other separator, and a parse that stops at the first character it
 * cannot read while reporting nothing. So `1 234,5` (what a fr/de spreadsheet
 * emits) imported as **1** and `1,234.56` as **1.234**: three orders of
 * magnitude of stock, on a module whose stated contract is that an export
 * edited in a spreadsheet round-trips, with the row neither `skipped` nor
 * listed in `issues`.
 */
function readNum(v: any): { value: string; bad: string } {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return { value: "", bad: "" };
  var s = raw.replace(GROUP_SEP_RE, "");
  var lastComma = s.lastIndexOf(",");
  var lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both marks present: the LAST one is the decimal, the other is grouping.
    // `1.234,56` and `1,234.56` are the same number written two ways.
    if (lastComma > lastDot) s = String(s).replace(/\./g, "").replace(",", ".");
    else s = String(s).replace(/,/g, "");
  } else if (lastComma >= 0) {
    // A SINGLE comma stays a DECIMAL mark — that is what this parser has always
    // done and what a French spreadsheet emits, so `2,000` reads as 2 and not
    // as 2000. Genuinely ambiguous, and changing it would silently multiply
    // every fr-locale weight by a thousand. SEVERAL commas can only be grouping.
    if (s.indexOf(",") === lastComma) s = String(s).replace(",", ".");
    else s = String(s).replace(/,/g, "");
  }
  if (!PLAIN_NUM_RE.test(s)) {
    var unit = NUM_WITH_UNIT_RE.exec(s);
    if (!unit) return { value: "", bad: raw };
    s = unit[1] as string;
  }
  var n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return { value: "", bad: raw };
  return { value: String(n), bad: "" };
}

var EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function _pad2(n: number): string { return (n < 10 ? "0" : "") + n; }

function normDate(v: any): string {
  var raw = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Keep a partial `YYYY-MM` production date verbatim. It's
  // a valid lot date (fmtDate passes it through unchanged), so blanking it here
  // made the CSV round-trip non-idempotent — the lot's `lotMergeKey` changed and
  // a re-import appended it as a duplicate.
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}$/.test(raw)) return raw;
  // dd.mm.yyyy or dd/mm/yyyy → yyyy-mm-dd
  var m = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  // mm.yyyy → yyyy-mm. The FR export of a MONTH-precision production date,
  // which `fmtDate` now formats instead of emitting raw ISO. Without this the
  // export would round-trip to "" and the lot would silently lose its
  // production date — and `lotMergeKey` would change, so a re-import would
  // append it as a duplicate. Unambiguous against the rule above: that one
  // needs three groups, this one two.
  var mm = raw.match(/^(\d{2})[./](\d{4})$/);
  if (mm) {
    var mmi = parseInt(String(mm[1]), 10);
    if (mmi >= 1 && mmi <= 12) return mm[2] + "-" + mm[1];
  }
  // EN-locale export dates ("Mar 15, 2024" — fmtDate en-mode output)
  // → ISO, so a CSV exported with the English date format round-trips its lot
  // dates instead of silently blanking them.
  var me = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (me) {
    var mon = EN_MONTHS.indexOf(String(me[1]).slice(0, 3).toLowerCase());
    var day = parseInt(String(me[2]), 10);
    if (mon >= 0 && day >= 1 && day <= 31) return me[3] + "-" + _pad2(mon + 1) + "-" + _pad2(day);
  }
  // "Sep 2017" — the EN-locale export of the same month-precision date. The
  // rule above requires a day, so this one cannot shadow it.
  var mey = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (mey) {
    var mony = EN_MONTHS.indexOf(String(mey[1]).slice(0, 3).toLowerCase());
    if (mony >= 0) return mey[2] + "-" + _pad2(mony + 1);
  }
  return "";
}

function normAging(v: any): string {
  var raw = String(v == null ? "" : v).trim();
  if (/^\d+$/.test(raw)) return raw;
  if (/^\d+\s*-\s*\d+$/.test(raw)) return raw.replace(/\s+/g, "");
  return "";
}

// ── main ─────────────────────────────────────────────────────────────────────

var LOT_FIELDS = ["status", "weightG", "weightInitial", "originalStatus", "datePurchased",
  "dateProduction", "dateOpened", "dateFinished", "boxNumber", "storageLocation",
  "price", "seller", "sellerUrl", "disposed"];

export function parseTobaccoCsv(
  text: string,
  opts?: { idBase?: number; todayIso?: string },
): CsvImportResult {
  var empty: CsvImportResult = { tobaccos: [], rows: 0, skipped: 0, lots: 0, headers: [], sectioned: false, capped: false, badCategory: 0, badCut: 0, badNumber: 0, issues: [], issuesTruncated: false };
  if (typeof text !== "string") return empty;
  var clean = String(text).replace(/^\uFEFF/, "");
  if (!clean.trim()) return empty;

  var firstNl = clean.indexOf("\n");
  var headerLine = firstNl >= 0 ? clean.substring(0, firstNl) : clean;
  var delim = detectDelim(headerLine);
  var grid = tokenize(clean, delim);
  if (grid.length < 1) return empty;

  var headerCells = grid[0] || [];
  var colKey: (string | null)[] = headerCells.map(function (h) {
    // hasOwnProperty guard: a column literally named "__proto__" or
    // "constructor" would otherwise resolve to Object.prototype / the
    // Object function via prototype-chain lookup (both truthy), leaking a
    // non-string into `colKey` / the returned `headers: string[]` and
    // producing a junk `rec` write-key. Only genuine own-property aliases map.
    var f = fold(h);
    return Object.prototype.hasOwnProperty.call(HEADER_ALIASES, f) ? HEADER_ALIASES[f]! : null;
  });
  var recognised = colKey.filter(function (k): k is string { return !!k; });
  if (recognised.indexOf("brand") < 0 || recognised.indexOf("name") < 0) {
    // Without a brand + name column there's nothing to key on.
    return Object.assign({}, empty, { headers: recognised });
  }

  var idBase = (opts && typeof opts.idBase === "number" && Number.isFinite(opts.idBase))
    ? opts.idBase : 1;
  // The caller's clock, injected — see the lifecycle back-fill below.
  var today = normDate((opts && opts.todayIso) || "") || "";
  var lotSeq = 0;

  var order: string[] = [];
  var groups: Record<string, any> = Object.create(null);
  var dataRows = 0, skipped = 0, lotCount = 0;
  var sectioned = false, capped = false;
  var badCategory = 0, badCut = 0, badNumber = 0;
  var issues: CsvImportIssue[] = [];
  var note = function (row: number, kind: CsvImportIssue["kind"], b: string, n: string, value: string) {
    if (issues.length < MAX_CSV_ISSUES) issues.push({ row: row, kind: kind, brand: b, name: n, value: value });
  };

  for (var r = 1; r < grid.length; r++) {
    var cells = grid[r] || [];
    // The full CSV EXPORT (buildCsvLines) is multi-section: the tobacco block
    // is followed by "=== PIPES ===" / "=== ACCESSOIRES ===" / "=== JOURNAL ==="
    // separators + rows with different columns. STOP at the first section
    // marker so those rows aren't misread as tobaccos (which used to mint a
    // junk tobacco named "=== PIPES ==="). The tobacco block round-trips; the
    // caller warns that only tabacs were imported.
    var firstCell = String(cells[0] == null ? "" : cells[0]).trim();
    // The export's `csvEsc` prefixes a "'" to any cell starting with "=" (CSV
    // formula-injection guard), so the real section marker arrives as
    // "'=== PIPES ===". Strip the guard apostrophe before the marker check —
    // otherwise the section-stop is silently defeated and the
    // PIPES/ACCESSOIRES/JOURNAL rows get misread as tobaccos.
    firstCell = unescapeFormulaGuard(firstCell);
    // Match the EXACT known markers, not any "===" prefix,
    // so a user brand like "=== rare ===" is parsed as a tobacco instead of
    // triggering the section-stop and dropping that row + everything after.
    if (_CSV_SECTION_MARKERS.indexOf(firstCell) >= 0) { sectioned = true; break; }
    // skip a fully-empty line
    var anyVal = cells.some(function (c) { return String(c == null ? "" : c).trim() !== ""; });
    if (!anyVal) continue;
    if (dataRows >= MAX_ROWS) { capped = true; break; }
    dataRows++;

    var rec: Record<string, string> = Object.create(null);
    for (var c = 0; c < cells.length; c++) {
      var key = colKey[c];
      if (!key) continue;
      // Undo the export's formula-guard apostrophe so a
      // brand/name/field starting with = + - @ | round-trips cleanly.
      var val = unescapeFormulaGuard(String(cells[c] == null ? "" : cells[c]).trim());
      if (rec[key] === undefined || rec[key] === "") rec[key] = val;
    }

    var brand = String(rec["brand"] || "").trim();
    var name = String(rec["name"] || "").trim();
    // `r` indexes the token GRID, whose row 0 is the header — so `r + 1` is
    // the 1-based line the user sees in a spreadsheet. (A quoted newline
    // inside a cell shifts the physical line; the logical row is what the
    // parser and the reader agree on, and it is what the catalogue side
    // reports too.)
    var lineNo = r + 1;
    if (!brand && !name) { skipped++; note(lineNo, "no-identity", "", "", ""); continue; }

    var gk = fold(brand) + "|" + fold(name);
    var tob = groups[gk];
    if (!tob) {
      // The enum values are read from the FIRST row of a brand+name group —
      // later rows of the same group only contribute lots — so a coercion is
      // reported against the row it was actually read from.
      var rawCat = String(rec["category"] || "").trim();
      var rawCut = String(rec["cut"] || "").trim();
      var canonCat = canonEnum(rawCat, CATS, _CAT_FOLD);
      var canonCut = canonEnum(rawCut, CUTS, _CUT_FOLD);
      // A row that literally says "Autre" was understood; only a value the
      // parser could not place counts as a coercion.
      if (rawCat && canonCat === "Autre" && fold(rawCat) !== "autre") {
        badCategory++; note(lineNo, "category", brand, name, rawCat);
      }
      if (rawCut && canonCut === "Autre" && fold(rawCut) !== "autre") {
        badCut++; note(lineNo, "cut", brand, name, rawCut);
      }
      tob = Object.assign({}, BT, {
        id: idBase + order.length,
        brand: brand, name: name,
        category: canonCat,
        blend: rec["blend"] || "",
        cut: canonCut,
        force: clamp05(rec["force"]),
        roomNote: clamp05(rec["roomNote"]),
        taste: clamp05(rec["taste"]),
        rating: clamp05(rec["rating"]),
        rebuy: parseRebuy(rec["rebuy"]),
        tastingNotes: rec["tastingNotes"] || "",
        description: rec["description"] || "",
        agingMax: normAging(rec["agingMax"]),
        imageUrl: "",   // external URLs are cleared by migrateData; local keys never come via CSV
        lots: [],
      });
      groups[gk] = tob;
      order.push(gk);
    }

    // A lot is created when the row carries any lot-level data.
    var hasLot = LOT_FIELDS.some(function (f) { return String(rec[f] || "").trim() !== ""; });
    if (hasLot) {
      // A numeric cell the parser could not read is BLANKED (as it always was)
      // and now REPORTED — the silence was the costly half of the defect, since
      // a truncated `1 234,5` looked exactly like a clean import.
      var readCell = function (field: string): string {
        var res = readNum(rec[field]);
        if (res.bad) { badNumber++; note(lineNo, "number", brand, name, res.bad); }
        return res.value;
      };
      var wG = readCell("weightG");
      var wInit = readCell("weightInitial") || wG;
      // A smoked-down lot can never have
      // current weight > initial. A hand-edited spreadsheet row with weightG >
      // weightInitial would otherwise persist a balance-overflow lot (the
      // invariants flag it, but it's still stored). Clamp the initial up to the
      // current so the imported lot is coherent (treated as full / unsmoked).
      var _wGn = parseFloat(wG), _wIn = parseFloat(wInit);
      if (Number.isFinite(_wGn) && Number.isFinite(_wIn) && _wGn > _wIn) wInit = wG;
      var status = normStatus(rec["status"]) || "cellar";
      lotSeq++;
      var lot = Object.assign({}, BL, {
        id: idBase + 100000 + lotSeq,
        status: status,
        originalStatus: normStatus(rec["originalStatus"]) || (status === "finished" ? "cellar" : status),
        weightG: wG,
        weightInitial: wInit,
        datePurchased: normDate(rec["datePurchased"]),
        dateProduction: normDate(rec["dateProduction"]),
        dateOpened: normDate(rec["dateOpened"]),
        dateFinished: normDate(rec["dateFinished"]),
        // (these two are back-filled below — see fillLifecycleDate.)
        boxNumber: rec["boxNumber"] || "",
        storageLocation: rec["storageLocation"] || "",
        price: readCell("price"),
        seller: rec["seller"] || "",
        sellerUrl: rec["sellerUrl"] || "",
        disposed: parseBool(rec["disposed"]),
      });
      // A status IMPLIES a date, so back-fill the one it implies.
      //
      // The shipped CSV template had a `Statut = Pot` example row and no "Date
      // mise en pot" column, so importing the app's OWN template turned the
      // Settings → Diagnostic panel red (`jar-has-dateOpened`,
      // `finished-has-dateFinished`) on the exact path the help documents:
      // download the template, fill it, import it. The EXPORT emits both columns
      // and the parser reads them, so an export round-trip was always clean —
      // this only ever bit a template or hand-built file.
      //
      // Fixing it in the PARSER rather than only in the template is the point:
      // any hand-built CSV can say "Pot" without a date, and the app fabricates
      // this date everywhere else on purpose (`applyLifecycleDates` stamps today
      // when the user promotes a lot in the form). The guess here is the
      // narrowest one available — a tin cannot have been opened before it was
      // bought — falling back to the import date, which is exactly the form's
      // guess. `todayIso` is INJECTED so this module stays pure and fuzzable.
      if (lot.status === "jar" && !lot.dateOpened) {
        lot.dateOpened = lot.datePurchased || today;
      }
      if (lot.status === "finished" && !lot.dateFinished) {
        lot.dateFinished = lot.dateOpened || lot.datePurchased || today;
      }
      tob.lots.push(lot);
      lotCount++;
    }
  }

  var tobaccos = order.map(function (k) { return groups[k]; });
  return { tobaccos: tobaccos, rows: dataRows, skipped: skipped, lots: lotCount, headers: recognised, sectioned: sectioned, capped: capped, badCategory: badCategory, badCut: badCut, badNumber: badNumber, issues: issues, issuesTruncated: issues.length >= MAX_CSV_ISSUES };
}
