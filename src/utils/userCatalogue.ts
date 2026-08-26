// User-supplied reference catalogue — CSV → the shape the app already speaks.
//
// The app ships NO catalogue. Each user loads their own CSV (Réglages →
// Données → Catalogue de référence) and this module turns it into the shape
// the rest of the app already speaks.
//
// ── IT MUST NORMALISE THE TAXONOMY, NOT JUST READ IT ────────────────────────
// A catalogue whose `category` says "Cigar" instead of "Cigare", or whose
// `cut` says "Navy Cut" instead of "Flake", is a catalogue the app only
// HALF-understands: the value misses `CUT_DENSITY` (so the session bowl-weight
// estimate silently falls back), has no `xl()` translation (so it renders in
// French to every language), has no `FAMILY_AGING_MAX` (so the blend loses its
// maturity band), and matches no option in the form's fixed dropdown — so
// opening and saving that tobacco REWRITES the user's cut. `CAT_MAP` / `CUT_MAP`
// in `src/constants.ts` are what prevent that, and they are the single
// definition (see `enumMapsSingleSource.test.ts`).
//
// ── WHAT IT REFUSES, AND WHAT IT MERELY REPORTS ─────────────────────────────
// The input is a file a person filled in by hand, in a spreadsheet, probably a
// few columns at a time. Refusing every row that is not complete in six
// languages would make the feature useless on the first try and give no clue
// why. So only IDENTITY is required — brand key, brand name, blend name — the
// rest takes neutral defaults, and an unrecognised taxonomy label is kept
// VERBATIM and REPORTED rather than silently rewritten or dropped. The user
// finds out from the app (Réglages → « Vérifier mon catalogue »), not from an
// empty catalogue.
//
// Descriptions are optional and per-language: `pickLang` already resolves
// requested → en → fr → first present, so a French-only catalogue works, and
// an English reader sees the French prose rather than nothing.

import { CATS, CUTS, mapCategory, mapCut } from "../constants.ts";
import { FAMILY_AGING_MAX } from "../utils.ts";
import { LANGUAGES } from "../i18n/languages.ts";
import { detectDelim, tokenize, CSV_DELIM } from "./csvImport.ts";
import type { TobaccoDb, BlendEntry, BrandMeta } from "./tobaccoDb.ts";

/** The column order of the master CSV. The template ships this header, so a
 *  file exported from the app reloads unchanged. Columns are matched BY NAME
 *  (below), so the order here is a convenience, not a contract. */
export var CATALOGUE_COLUMNS = [
  "brand_key", "brand_name", "blend_name", "category", "cut",
  "force", "roomNote", "taste", "agingMax", "blend",
  "description_fr", "description_en", "brand_aliases", "blend_aliases",
  "lastReviewed", "reviewValidated",
  "description_de", "description_it", "description_es", "description_pt",
] as const;

/** Rows above this are refused outright. A catalogue is reference data the
 *  whole app queries synchronously; a pathological file must not be able to
 *  wedge it. Mirrors `csvImport.MAX_ROWS`. */
export var MAX_CATALOGUE_ROWS = 20000;

/**
 * Bump when the NORMALISATION changes — a new `CAT_MAP` / `CUT_MAP` entry, a
 * different default, a fix like the camelCase header-lookup one.
 *
 * A stored catalogue is kept as the user's raw CSV plus a PARSED cache, because
 * parsing 1594 rows measured **0.5-1.2 s on a desktop** and that is far too
 * slow to pay on every catalogue surface. The cache is therefore stale by
 * construction the day the parser changes: this stamp is what lets
 * `catalogueStore` notice and re-parse from the CSV it kept, instead of serving
 * a catalogue normalised by a version of the code that no longer exists.
 *
 * The alternative — dropping the CSV and keeping only the parsed object — would
 * make that impossible AND take away the user's own file, which they can
 * re-export precisely because it is still there.
 */
export var CATALOGUE_PARSER_VERSION = 1;

/**
 * A row the parser could not take at face value.
 *
 * The COUNTS were reported from the start and are what the Settings
 * panel shows; what was missing is WHICH row. On a 1594-row catalogue
 * « valeurs non reconnues : Krumble Kake » is a fact the user cannot act on —
 * they have to find the offending lines in a spreadsheet, and nothing told
 * them where. `row` is the 1-based line number in the file, header counted,
 * so it matches what a spreadsheet shows in its gutter.
 *
 * Only the two classes the format contract actually constrains are collected:
 * the MANDATORY identity pair, and the two columns whose values are IMPOSED.
 * Prose, lengths and per-language coverage are deliberately out of scope —
 * A Node checker judged those on a DELIVERED master, and is gone; with the
 * catalogue now being the user's own file there is no delivery to judge, and
 * the in-app report is the whole answer. Historical note, kept because it is a
 * different job from "is my file loadable and understood".
 */
export interface CatalogueIssue {
  /** 1-based line in the CSV, header counted — matches a spreadsheet gutter. */
  row: number;
  kind: "no-identity" | "duplicate" | "category" | "cut";
  brand: string;
  name: string;
  /** The offending label, for the two taxonomy kinds. */
  value: string;
}

/**
 * Detail cap. The COUNTS stay exact — only the list is bounded, because a
 * pathological file must not be able to build a 50 000-entry array on a phone
 * and because nobody reads past a few hundred. The caller reports the total
 * alongside, so a truncated list can never read as a complete one (the
 * no-silent-caps rule).
 */
export var MAX_CATALOGUE_ISSUES = 500;

export interface CatalogueParseResult {
  /** Null when nothing usable was found — the caller must not store it. */
  db: TobaccoDb | null;
  /** Blends actually indexed. */
  blends: number;
  brands: number;
  /** Data rows seen (header excluded). */
  rows: number;
  /** Rows skipped for want of brand_key / brand_name / blend_name. */
  skippedNoIdentity: number;
  /** Rows whose (brand, blend) pair had already been seen — first wins. */
  duplicateKeys: number;
  /** Enum labels that are neither canonical nor mapped, deduped. These are
   *  REPORTED, never coerced: silently rewriting a user's vocabulary is how a
   *  catalogue starts disagreeing with the file it came from. */
  unknownCategories: string[];
  unknownCuts: string[];
  /** Language codes for which at least one description was found. */
  langs: string[];
  /** A hard failure: the file is not a catalogue CSV at all. */
  error: null | "empty" | "no-header" | "too-many-rows";
  /** Rows whose category / cut label was not recognised. EXACT — unlike
   *  `issues`, which is capped. Deriving them by filtering that capped list
   *  (as the hook once did) makes a file with more than
   *  MAX_CATALOGUE_ISSUES defects UNDER-report, and a file whose cap is
   *  filled early by no-identity rows report ZERO bad categories — the
   *  reassuring number, on the panel whose whole job is to say what is wrong.
   *  The cellar importer got this right first; same rule here. */
  badCategory: number;
  badCut: number;
  /** Per-row detail for the counts above, capped at MAX_CATALOGUE_ISSUES. */
  issues: CatalogueIssue[];
}

function norm(h: string): string {
  return String(h || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function pipeList(v: string): string[] {
  return String(v || "")
    .split("|")
    .map((s) => String(s).trim())
    .filter(Boolean);
}

function intOrZero(v: string): number {
  var n = parseInt(String(v || "").trim(), 10);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
}

/** The redundant-aging rule, applied at IMPORT rather than to the data: a catalogue
 *  stores an `agingMax` only for a category the app has NO family default for.
 *  Otherwise `effectiveAgingMax` re-derives it, and QuickAdd would copy a
 *  frozen constant into the user's cellar. The Node importer carried this for
 *  exactly the same reason; the browser has to agree. */
function dropRedundantAging(cat: string, aging: string): string {
  if (!aging || !cat) return aging;
  return FAMILY_AGING_MAX[cat] ? "" : aging;
}

/**
 * Parse a catalogue CSV into the in-memory shape `tobaccoDb.ts` serves.
 *
 * Pure and string-only: no clock, no storage, no DOM — so it is fuzzable and
 * unit-testable, like `parseTobaccoCsv` beside it.
 */
export function parseCatalogueCsv(textRaw: string): CatalogueParseResult {
  var empty: CatalogueParseResult = {
    db: null, blends: 0, brands: 0, rows: 0,
    skippedNoIdentity: 0, duplicateKeys: 0,
    unknownCategories: [], unknownCuts: [], langs: [], error: "empty",
    badCategory: 0, badCut: 0, issues: [],
  };
  var text = String(textRaw || "").replace(/^\uFEFF/, "");
  if (!text.trim()) return empty;

  var firstNl = text.indexOf("\n");
  var headerLine = firstNl >= 0 ? text.slice(0, firstNl) : text;
  var rows = tokenize(text, detectDelim(headerLine));
  if (!rows.length) return empty;

  // ── header → column index, by NAME ────────────────────────────────────────
  // Position would break the moment a spreadsheet reorders or a column is
  // added, and the file is meant to be edited by hand.
  var header = rows[0] || [];
  var col: Record<string, number> = Object.create(null);
  for (var i = 0; i < header.length; i++) {
    var h = norm(header[i] || "");
    if (h && col[h] === undefined) col[h] = i;
  }
  if (col["brand_key"] === undefined || col["blend_name"] === undefined) {
    return Object.assign({}, empty, { error: "no-header" as const });
  }

  // Each kept row carries its TRUE grid line. Blank rows are
  // still dropped, but reporting the index of the FILTERED array made the row
  // number drift on any file padded with empties — and a row number is the
  // whole point of this panel: the reviewer opens the spreadsheet at it, so a
  // number that is quietly wrong is worse than none. The comment on `ri + 2`
  // used to state the drift rather than fix it. Header is line 1.
  var body: { r: string[]; line: number }[] = [];
  for (var bi = 1; bi < rows.length; bi++) {
    var rr = rows[bi]!;
    if (!rr.some((c) => String(c || "").trim() !== "")) continue;
    body.push({ r: rr, line: bi + 1 });
  }
  if (body.length > MAX_CATALOGUE_ROWS) {
    return Object.assign({}, empty, { error: "too-many-rows" as const, rows: body.length });
  }

  // Description columns present in THIS file, keyed by language code. Derived
  // from the registry rather than a literal list — the sixth language was
  // silently skipped by six frozen lists once, and this would have
  // been a seventh.
  var descCol: Record<string, number> = Object.create(null);
  for (var li = 0; li < LANGUAGES.length; li++) {
    var code = LANGUAGES[li]!.code;
    var idx = col["description_" + code];
    if (idx !== undefined) descCol[code] = idx;
  }

  var brands: Record<string, BrandMeta & { _aliases?: Set<string> }> = Object.create(null);
  var blends: Record<string, BlendEntry> = Object.create(null);
  var skippedNoIdentity = 0;
  var duplicateKeys = 0;
  var unknownCat: Record<string, true> = Object.create(null);
  var unknownCut: Record<string, true> = Object.create(null);
  var issues: CatalogueIssue[] = [];
  // Bounded, and the totals are reported separately — see MAX_CATALOGUE_ISSUES.
  var note = (row: number, kind: CatalogueIssue["kind"], brand: string, name: string, value: string) => {
    if (issues.length < MAX_CATALOGUE_ISSUES) issues.push({ row, kind, brand, name, value });
  };
  var langsSeen: Record<string, true> = Object.create(null);

  // `col` is keyed on the NORMALISED header, so the lookup must normalise too
  // — otherwise the camelCase columns (`roomNote`, `agingMax`) miss and read
  // as empty while every lowercase one works. Found by cross-checking the real
  // master against the Node importer's output: `roomNote` came back 0 on all
  // 1594 rows, and `agingMax` was wrong on none of them ONLY because this
  // catalogue's every agingMax is dropped by the family rule anyway — a defect
  // the data happened to hide.
  var cell = (r: string[], name: string): string => {
    var k = col[norm(name)];
    return k === undefined ? "" : String(r[k] || "").trim();
  };

  var badCategory = 0, badCut = 0;
  for (var ri = 0; ri < body.length; ri++) {
    var r = body[ri]!.r;
    var line = body[ri]!.line;
    var brandKeyRaw = cell(r, "brand_key");
    var blendName = cell(r, "blend_name");
    // brand_name is optional: a user who only fills brand_key still gets a
    // usable brand, displayed under the key they typed.
    var brandName = cell(r, "brand_name") || brandKeyRaw;
    if (!brandKeyRaw || !blendName) {
      skippedNoIdentity++;
      note(line, "no-identity", brandKeyRaw, blendName, "");
      continue;
    }

    var bkLower = String(brandKeyRaw).toLowerCase();
    if (!brands[bkLower]) {
      brands[bkLower] = {
        displayName: brandName, country: "?", tier: 3, status: "active",
        _aliases: new Set<string>(),
      };
    }
    var brandAliases = pipeList(cell(r, "brand_aliases"));
    for (var ai = 0; ai < brandAliases.length; ai++) {
      brands[bkLower]!._aliases!.add(brandAliases[ai]!);
    }

    var blendKey = bkLower + "|" + String(blendName).toLowerCase();
    if (blends[blendKey]) {
      duplicateKeys++;
      note(line, "duplicate", brandKeyRaw, blendName, "");
      continue;
    }

    var rawCat = cell(r, "category");
    var category = rawCat ? mapCategory(rawCat) : "";
    if (category && !(CATS as readonly string[]).includes(category)) {
      unknownCat[rawCat] = true;
      badCategory++;
      note(line, "category", brandKeyRaw, blendName, rawCat);
    }
    var rawCut = cell(r, "cut");
    var cut = rawCut ? mapCut(rawCut) : "";
    if (cut && !(CUTS as readonly string[]).includes(cut)) {
      unknownCut[rawCut] = true;
      badCut++;
      note(line, "cut", brandKeyRaw, blendName, rawCut);
    }

    var description: Record<string, string> = {};
    for (var dc in descCol) {
      var v = String(r[descCol[dc]!] || "").trim();
      if (v) { description[dc] = v; langsSeen[dc] = true; }
    }

    var blendAliases = pipeList(cell(r, "blend_aliases"));
    blends[blendKey] = Object.assign({
      name: blendName,
      category,
      cut,
      blend: cell(r, "blend"),
      force: intOrZero(cell(r, "force")),
      roomNote: intOrZero(cell(r, "roomNote")),
      taste: intOrZero(cell(r, "taste")),
      agingMax: dropRedundantAging(category, cell(r, "agingMax")),
      description,
    }, blendAliases.length ? { aliases: blendAliases } : {});
  }

  var brandOut: Record<string, BrandMeta> = Object.create(null);
  for (var bk in brands) {
    var b = brands[bk]!;
    var set = b._aliases;
    delete b._aliases;
    if (set && set.size) (b as BrandMeta).aliases = Array.from(set).sort();
    brandOut[bk] = b as BrandMeta;
  }

  var nBlends = Object.keys(blends).length;
  return {
    db: nBlends ? ({ brands: brandOut, blends } as TobaccoDb) : null,
    blends: nBlends,
    brands: Object.keys(brandOut).length,
    rows: body.length,
    skippedNoIdentity,
    duplicateKeys,
    badCategory: badCategory,
    badCut: badCut,
    unknownCategories: Object.keys(unknownCat).sort(),
    unknownCuts: Object.keys(unknownCut).sort(),
    langs: Object.keys(langsSeen).sort(),
    error: nBlends ? null : "empty",
    issues,
  };
}

/** One CSV cell, quoted only when it has to be. Mirrors the export side's
 *  rules so a template round-trips through a spreadsheet unchanged. */
/** Le séparateur du modèle — voir le bloc au-dessus de
 * `buildCatalogueTemplateCsv` pour pourquoi il vaut `;` et non `,`. */

function esc(v: string): string {
  var s = String(v == null ? "" : v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * LE SÉPARATEUR EST `;`, COMME CELUI DE LA CAVE — et l'unification est une
 * décision de convention, pas une correction de bug.
 *
 * Ce modèle sortait en `,` tandis que le modèle et l'export de la CAVE sortent
 * en `;`. Ce n'était pas un défaut de correction : `detectDelim` renifle la
 * ligne d'en-tête et les deux lecteurs acceptent les deux, donc aucun fichier
 * n'a jamais été mal lu. Ce qui divergeait est le comportement dans un
 * TABLEUR — et c'est là que le coût est réel : dans une locale où la virgule
 * est le séparateur DÉCIMAL (fr, es, de, it, pt — cinq des six langues de
 * l'application), Excel ouvre un fichier séparé par des virgules en UNE SEULE
 * colonne. Le modèle sert précisément à être ouvert dans un tableur et rempli
 * à la main, donc la locale de l'utilisateur est le critère.
 *
 * `;` PLUTÔT QUE `,` ET NON L'INVERSE, pour trois raisons cumulées : la cave
 * l'utilise déjà et c'est le plus gros des deux formats ; cinq langues sur six
 * y gagnent ; et `esc` ci-dessus cite DÉJÀ sur `;` (sa classe est
 * `[",;\n\r]`), donc le changement ne peut pas casser une prose contenant un
 * point-virgule — la seule façon dont ce basculement aurait pu mal tourner.
 *
 * AUCUN CATALOGUE EXISTANT NE CASSE : `parseCatalogueCsv` détecte le
 * séparateur, donc un fichier en virgules déjà chargé, sauvegardé dans le
 * cloud ou exporté continue de se relire à l'identique. C'est asserté.
 *
 * The fill-in template: the exact header the app reads, plus two example rows
 * that DEMONSTRATE the two things people get wrong — the pipe-separated alias
 * lists, and that a description column exists per language.
 *
 * The header is the master's, so a catalogue exported from elsewhere in this
 * format loads with no conversion.
 */
export function buildCatalogueTemplateCsv(): string {
  var head = CATALOGUE_COLUMNS.slice() as unknown as string[];
  var byName: Record<string, string> = Object.create(null);

  function row(vals: Record<string, string>): string {
    for (var k in byName) delete byName[k];
    for (var k2 in vals) byName[k2] = vals[k2]!;
    return head.map((h) => esc(byName[h] || "")).join(CSV_DELIM);
  }

  var lines = [head.join(CSV_DELIM)];
  lines.push(row({
    brand_key: "Halvorsen",
    brand_name: "Halvorsen",
    blend_name: "Duskfall",
    category: "Anglais",
    cut: "Ribbon",
    force: "4",
    roomNote: "3",
    taste: "4",
    blend: "Virginia, Cyprian Latakia, Turkish Oriental, Perique",
    description_fr: "Exemple : décrivez ici le blend en une ou deux phrases, dans votre langue.",
    description_en: "Example: describe the blend here in a sentence or two, in your language.",
    brand_aliases: "Halvorsen of Bergen|Halvorsen & Son",
    blend_aliases: "Dusk Fall",
  }));
  lines.push(row({
    brand_key: "Quillon",
    brand_name: "Quillon",
    blend_name: "Slate Harbour",
    category: "Dark Fired",
    cut: "Ready Rubbed",
    force: "4",
    roomNote: "3",
    taste: "4",
    blend: "Dark Fired Kentucky, Virginia",
    // Le point-virgule de cette phrase n'est PAS un hasard : il est le
    // séparateur du fichier, donc cette cellule est ce qui DÉMONTRE la citation
    // — pour le lecteur humain qui ouvre le modèle, et pour le test qui fait
    // l'aller-retour. Sans elle, retirer `;` de la classe de `esc` ne faisait
    // rougir aucun cas (sondé).
    description_fr: "Deuxième exemple : cette colonne est facultative ; laissez-la vide si besoin.",
    description_en: "Second example: this column is optional — leave it empty if you prefer.",
  }));
  return lines.join("\n") + "\n";
}
