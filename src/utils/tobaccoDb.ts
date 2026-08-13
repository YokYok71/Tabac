// Tobacco reference catalogue — the LOOKUP half. The user's own file is the
// only source; `catalogueStore.ts` owns where it lives and `userCatalogue.ts`
// owns how a CSV becomes this shape.
//
// THE APP NO LONGER SHIPS A CATALOGUE. It shipped one for a long time
// (1594 blends by the end), as a
// content-hashed JS chunk plus one lazy prose chunk per language. That
// catalogue was the author's own research and is not general-purpose data, so
// it left the repo with its tooling; what stays is the MECHANISM — Réglages →
// Données offers a template, loads a CSV, and stores it in IndexedDB.
//
// The consequence every caller must respect: `loadTobaccoDb()` resolving null
// is now the ORDINARY state of a fresh install, not a failure. Surfaces that
// need a catalogue say so and point at Réglages → Données; nothing offers a
// "retry", because there is nothing to re-download.
//
// Schema (mirrors what `parseCatalogueCsv` produces):
//   { brands: { [key]: BrandMeta }, blends: { [key]: BlendEntry } }
// where key = "<brand>|<name>" lowercased — same convention as `dupKey`
// in src/hooks/useImportConfirm.ts (used everywhere else for matching).
//
// Lookup contract: caller provides brand + name + ui language. Returns a
// normalised result with only the factual attributes the AI auto-fill
// also produces — categories / cuts come from the same enums the app uses
// internally, descriptions resolved per language by `pickLang`.
//
// SSR safety: every function tolerates the absence of IndexedDB / `window`
// and returns null. The hook integration treats null as "no catalogue" and
// falls through to the existing AI flow.

// Shared language-resolution policy (requested → en → fr → first present)
// — the SAME one the in-app doc pages use, so the catalogue behaves like the
// rest of the app when a language is added.
import { pickLang } from "./docPage.ts";
// The user's own catalogue. `catalogueLoad` never rejects (no IndexedDB → a
// null resolution), so no caller has to handle a throw.
import { catalogueLoad } from "./catalogueStore.ts";

export interface BlendEntry {
  name: string;
  category: string;
  cut: string;
  blend: string;
  force: number;
  roomNote: number;
  taste: number;
  agingMax: string;
  // Per-language description prose. `fr`/`en` always present; extra
  // language codes (es, de…) added when the catalog is regenerated with
  // a `description_<code>` column. Resolved via pickLang at lookup time.
  description: Record<string, string>;
  /** Optional list of alternate names users might type
   *  to look the blend up (catalog numbers, marketed-name variants…).
   *  Matched after the exact lookup misses. Each alias is compared
   *  with the same normalisation as the main key (lowercased, then
   *  punctuation-stripped for the punctuation-tolerant pass). */
  aliases?: string[];
}

export interface BrandMeta {
  displayName: string;
  country: string;
  tier: number;
  status: string;
  note_fr?: string;
  note_en?: string;
  /** Alternate names for the brand itself (e.g.
   *  "Robert McConnell" for McConnell, "Ogden's of Liverpool" for
   *  Ogden's). Consulted by `resolveCanonicalBrand` AFTER the
   *  exact / punctuation / substring strategies, and contributed
   *  to the search blob by `tobaccoDbSearchMatch`. Comparison
   *  uses the same tight-normalisation pass as the canonical
   *  brand key so casing + punctuation don't matter. */
  aliases?: string[];
}

export interface TobaccoDb {
  version?: number;
  updatedAt?: string;
  brands: Record<string, BrandMeta>;
  blends: Record<string, BlendEntry>;
}

export interface LookupResult {
  name: string;
  brandDisplay: string;
  category: string;
  cut: string;
  blend: string;
  force: number;
  roomNote: number;
  taste: number;
  agingMax: string;
  description: string;
}

// ─── module-level cache + in-flight promise ───
let cache: TobaccoDb | null = null;
let inFlight: Promise<TobaccoDb | null> | null = null;

/**
 * Forget the in-memory catalogue so the next load re-resolves it.
 *
 * Called after the user loads or clears their own: the module caches for the
 * whole session, so without this the app would go on serving the previous
 * catalogue until a reload, and the user would conclude the import had not
 * worked.
 */
export function tobaccoDbInvalidate(): void {
  cache = null;
  inFlight = null;
}

/**
 * The catalogue in memory, or null when the user has not loaded one.
 *
 * THE ONLY SOURCE IS THE USER'S OWN FILE. Every trace of the
 * bundled chunk is gone: the `import("../data/tobacco-db.json")` fallback, the
 * per-language `tobacco-db.desc-*.json` chunks and the whole failure-kind
 * apparatus (`isChunkFailure` / `tobaccoDbFailKind` / `tobaccoDbRetry`) that
 * existed to tell an offline chunk fetch from a corrupt one.
 *
 * That apparatus was not merely unused — it was MISLEADING. `null` used to
 * mean "the download failed"; it now means "you have not loaded a catalogue",
 * which is the ordinary state of every fresh install. Keeping a "Retry"
 * button on a screen whose real remedy is Réglages → Données would send the
 * user back to a control that cannot help them. `catalogueLoad` never rejects
 * (no IndexedDB → null), so this resolves null rather than throwing, in every
 * environment jsdom included.
 */
export async function loadTobaccoDb(): Promise<TobaccoDb | null> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = catalogueLoad()
    .then((userDb) => {
      if (userDb && userDb.blends && Object.keys(userDb.blends).length) {
        cache = userDb;
        return cache;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Reset the cache. Test-only — never call from app code. */
export function _resetTobaccoDbForTests(): void {
  cache = null;
  inFlight = null;
}

function formatLookupResult(
  e: BlendEntry,
  brandKey: string,
  brandFallback: string,
  nameFallback: string,
  lang: string,
): LookupResult {
  const brandMeta = cache && cache.brands[brandKey];
  return {
    name: e.name || nameFallback || "",
    brandDisplay: (brandMeta && brandMeta.displayName) || brandFallback || "",
    category: e.category,
    cut: e.cut,
    blend: e.blend,
    force: e.force,
    roomNote: e.roomNote,
    taste: e.taste,
    agingMax: e.agingMax,
    description: (e.description && pickLang(e.description, lang)) || "",
  };
}

// ASCII-fold diacritics + common ligatures BEFORE
// every tight-norm / brand-norm / blob-comparison. The earlier
// behaviour was to STRIP non-[a-z0-9] characters wholesale, which
// turned "Vieux Carré" into "vieuxcarr" and "Jubilæums" into
// "jubilums" — those didn't match the ASCII spellings users actually
// type. NFD decomposes precomposed characters into base + combining
// marks (covers é, ñ, ü, ô…); we then strip the combining marks.
// Ligatures (æ, œ, ß, ø, đ, ł) don't decompose under NFD so we map
// them manually — small list, covers the European brand names that
// appear in the master CSV (Winsløw, Jubilæums, Schöne…).
function foldDiacritics(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ß/gi, "ss")
    .replace(/ø/gi, "o")
    .replace(/đ/gi, "d")
    .replace(/ł/gi, "l");
}

// Strip everything except a-z 0-9 — used for the punctuation-tolerant
// pass so "Solani 131" matches an alias "131" and "Solani's Blue" matches
// "Solanis Blue" etc. ASCII-folds first so "Vieux Carre"
// matches "Vieux Carré".
function tightNorm(s: string): string {
  return String(foldDiacritics(s)).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Brand-only normalization that also collapses "&" → "and"
// so "Cornell & Diehl" matches "Cornell and Diehl" (both end up as
// "cornellanddiehl"). Applied to the typed brand AND each canonical
// brand key before comparison. ASCII-folds first.
function normBrandKey(s: string): string {
  return String(foldDiacritics(s)).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

// Tiny Levenshtein for short strings — capped at 4 to
// short-circuit the inner loop once the threshold is blown. Brand
// names are 4-30 chars typically, so the O(n*m) cost is negligible.
function levenshteinCapped(a: string, b: string, cap: number): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= n; j++) {
      const cost = String(a).charCodeAt(i - 1) === String(b).charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,         // deletion
        curr[j - 1]! + 1,     // insertion
        prev[j - 1]! + cost,  // substitution
      );
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > cap) return cap + 1; // every value in this row is over budget
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

// Resolve a typed brand to its canonical DB key. Tries,
// in order: exact lowercase → punctuation-stripped exact (handles
// "MacBaren" vs "Mac Baren", "G L Pease" vs "G. L. Pease") →
// brand alias ("Robert McConnell" → "mcconnell") →
// substring match (longest first) → Levenshtein ≤ 2 (typos like
// "Capstain" → "Capstan", "Sutlif" → "Sutliff"). Returns null if
// nothing matches confidently.
function resolveCanonicalBrand(typed: string): string | null {
  if (!cache) return null;
  const typedLower = String(typed || "").trim().toLowerCase();
  if (!typedLower) return null;
  // HasOwnProperty guard — `cache.brands` is a plain
  // JSON-parsed object, and `typedLower` is a raw user-typed brand. A typed
  // "__proto__"/"constructor" would otherwise resolve to a truthy
  // Object.prototype member and return a bogus canonical brand instead of null.
  if (Object.prototype.hasOwnProperty.call(cache.brands, typedLower)) return typedLower; // exact lowercase

  const typedTight = normBrandKey(typed);
  if (typedTight.length < 3) return null; // too short to fuzzy safely

  let bestSub: string | null = null;
  let bestSubDiff = Infinity;
  let bestLev: string | null = null;
  let bestLevDist = Infinity;

  const brandKeys = Object.keys(cache.brands);

  /*
   * THREE PASSES, because one loop made the answer depend on the
   * ORDER of the brand keys.
   *
   * The catalogue records a blend's MANUFACTURER in `brand_aliases` (the
   * `brand_key` is the name on the tin: Captain Earle's stays Captain Earle's
   * even though Cornell & Diehl makes it). That is correct and useful — but the
   * single loop returned on the FIRST hit of either kind, so an alias on an
   * early brand beat the real brand further down the list. Measured on the
   * shipped catalogue: typing « Cornell & Diehl » resolved to `captain earle's`
   * (#18 before #26), « Lane Limited » to `captain black`, and « Mac Baren » to
   * `caporal` — that last one had been wrong BEFORE this delivery and nothing
   * reported it, because no test ever typed the catalogue's most common brand.
   *
   * It is not a cosmetic mis-resolution: `resolveCanonicalBrand` feeds the
   * auto-fill, the catalogue offer on the entry forms, `tobaccoDbCanonicalKey`
   * (hence the owned/wished badge and duplicate detection) and the search.
   *
   * A brand that IS the typed name must win over a brand that merely lists it,
   * whatever the key order — so the exact-key test gets its own complete pass.
   * Two further sites were latent, waiting only for a reordering of the JSON
   * (`wessex` lists Chacom and Kohlhase & Kopp, and sits last today).
   */
  for (const bk of brandKeys) {
    if (normBrandKey(bk) === typedTight) return bk; // punctuation-only difference
  }

  // Brand alias hit — exact (after tight-norm) wins immediately.
  // Aliases are curated, so an exact match is strong signal. Loose substring /
  // Levenshtein over aliases would overfit ("Black" matches every alias
  // containing "Black") so we keep the alias pass strict.
  for (const bk of brandKeys) {
    const brandMeta = cache.brands[bk];
    if (brandMeta && brandMeta.aliases) {
      for (const a of brandMeta.aliases) {
        if (typeof a === "string" && normBrandKey(a) === typedTight) return bk;
      }
    }
  }

  for (const bk of brandKeys) {
    const bkTight = normBrandKey(bk);
    // Substring (either direction) — captures "Mac" → "mac baren" only when
    // the user typed enough chars to be unambiguous.
    if (bkTight.length >= 4 && typedTight.length >= 4) {
      if (bkTight.includes(typedTight) || typedTight.includes(bkTight)) {
        const diff = Math.abs(bkTight.length - typedTight.length);
        if (diff < bestSubDiff) { bestSub = bk; bestSubDiff = diff; }
      }
    }

    // Levenshtein ≤ 2 (only when both strings are long enough that a
    // 2-edit window can't bridge unrelated brands).
    if (typedTight.length >= 5 && bkTight.length >= 5) {
      const lev = levenshteinCapped(typedTight, bkTight, 2);
      if (lev <= 2 && lev < bestLevDist) { bestLev = bk; bestLevDist = lev; }
    }
  }

  // Prefer the cleaner substring hit, then fall back to Levenshtein.
  return bestSub || bestLev;
}

// Extracted from approximateLookupSync — returns the
// matched DB key (string) or null. tobaccoDbLookupSync uses it then
// formats the result; tobaccoDbCanonicalKey exposes it directly so
// duplicate-detection callers can compare two user entries by
// canonical key (e.g. "Solani 131" and "Solani Red Label" both
// resolve to "solani|red label" → same blend).
function approximateKeySync(bk: string, nq: string): string | null {
  if (!cache) return null;
  const nqClean = tightNorm(nq);
  if (nqClean.length < 2) return null;

  const brandPrefix = bk + "|";
  const candidates: { key: string; nameClean: string }[] = [];
  for (const k of Object.keys(cache.blends)) {
    if (!String(k).startsWith(brandPrefix)) continue;
    candidates.push({ key: k, nameClean: tightNorm(k.slice(brandPrefix.length)) });
  }
  if (candidates.length === 0) return null;

  // 1. Alias
  for (const c of candidates) {
    const blend = cache.blends[c.key];
    if (!blend || !blend.aliases) continue;
    for (const alias of blend.aliases) {
      if (typeof alias === "string" && tightNorm(alias) === nqClean) return c.key;
    }
  }
  // 2. Substring (unique under brand)
  const subHits = candidates.filter((c) => c.nameClean.length > 0 && c.nameClean.includes(nqClean));
  if (subHits.length === 1) return subHits[0]!.key;
  // 3. Reverse substring (unique under brand)
  const revHits = candidates.filter((c) => c.nameClean.length >= 3 && nqClean.includes(c.nameClean));
  if (revHits.length === 1) return revHits[0]!.key;
  return null;
}

/**
 * The aliases WORTH SHOWING on a catalogue fiche.
 *
 * The search has always matched aliases (they are part of the blob),
 * so a tin labelled "PDT" already finds Pennsylvania Dutch Treat. What was
 * missing is the fiche saying WHY it matched: the strongest case is the
 * merged row, where `Jubilee Pipe Tobacco` carries "50th Anniversary" —
 * someone holding a tin labelled that way lands on a differently-titled fiche
 * with nothing on screen explaining it.
 *
 * But the raw list must NOT be printed. Measured over the shipped catalogue,
 * roughly half the alias strings are already contained in "brand + name"
 * (`Boswells Best` under a fiche titled *Boswell — Boswell's Best*, `Apple
 * Streudel` under *Apple Strudel*): as SEARCH keys those spellings earn their
 * place, on screen they read as a bug rather than as information. Filtering on
 * "not already visible in the title" leaves the genuinely different names
 * (`PDT`, `M586`, `Balkan Sobranie 759`, `Caledonian No. 10`) and empties the
 * line entirely on the fiches where it would only have echoed the title.
 *
 * Uses `tightNorm`, the module's own normalisation, so the comparison ignores
 * punctuation and case exactly like every other name comparison here.
 * Order is preserved; duplicates that normalise alike are dropped once.
 */
export function displayAliases(
  entry: Pick<BlendEntry, "name" | "aliases"> | null | undefined,
  brandDisplay?: string | null,
): string[] {
  const aliases = entry && Array.isArray(entry.aliases) ? entry.aliases : [];
  if (aliases.length === 0) return [];
  const title = tightNorm(String(brandDisplay || "") + String((entry && entry.name) || ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    if (typeof a !== "string") continue;
    const t = tightNorm(a);
    if (!t || seen.has(t)) continue;
    if (title.includes(t)) continue;   // already on screen in the heading
    seen.add(t);
    out.push(String(a).trim());
  }
  return out;
}

// Returns the canonical "brand_key|name" string for a
// typed brand+name, going through the same brand-fuzzy + name-fuzzy
// ladder as tobaccoDbLookupSync. Used by the tobacco / wishlist forms
// to detect that two differently-typed entries are the same blend
// (e.g. "Solani 131" ≡ "Solani Red Label").
export function tobaccoDbCanonicalKey(
  brand: string | undefined | null,
  name: string | undefined | null,
): string | null {
  if (!cache) return null;
  const b = String(brand || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!b || !n) return null;
  if (cache.blends[b + "|" + n]) return b + "|" + n;
  const canonical = resolveCanonicalBrand(brand || "");
  if (!canonical) return null;
  if (canonical !== b && cache.blends[canonical + "|" + n]) return canonical + "|" + n;
  return approximateKeySync(canonical, n);
}

// Approximate brand+name lookup. Fired only when the
// exact key miss. Strategies in order — first hit wins:
//   1. Alias match — blend.aliases[] contains a value equal to the
//      query (lowercased + punctuation-stripped). Lets the user type
//      a catalog number ("Solani 131" → Red Label) or a marketed
//      name variant ("Sweet Mystery" → 369 Blue Label).
//   2. Substring match — the query, normalised, is a substring of the
//      blend-name segment. Only fires when EXACTLY ONE blend matches
//      under the same brand — ambiguous matches return null so the
//      AI flow takes over. Lets the user type a shorter form
//      ("Solani Red" → Red Label, "Peterson Sherlock" → Sherlock Holmes).
//   3. Reverse substring — the blend name is a substring of the query.
//      Same uniqueness gate. Lets the user type "Solani Red Label 50g"
//      and still find Red Label.
// Brand fuzzy is now also supported via resolveCanonicalBrand
// upstream of this function.
function approximateLookupSync(
  bk: string,
  nq: string,
  brandFallback: string,
  nameFallback: string,
  lang: string,
): LookupResult | null {
  if (!cache) return null;
  const k = approximateKeySync(bk, nq);
  if (!k) return null;
  const blend = cache.blends[k];
  if (!blend) return null;
  return formatLookupResult(blend, bk, brandFallback, nameFallback, lang);
}

/** Synchronous brand+name lookup. Returns null if cache isn't ready yet
 *  (caller must have triggered `loadTobaccoDb` and waited, or use the
 *  async wrapper below). Exact match first, then falls
 *  through to approximate matching (alias / substring) for tolerance
 *  to catalog numbers and shorter typed forms. */
export function tobaccoDbLookupSync(
  brand: string | undefined | null,
  name: string | undefined | null,
  lang: string,
): LookupResult | null {
  if (!cache) return null;
  const b = String(brand || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!b || !n) return null;
  // 1. Fast path: exact match on the typed brand + name.
  const exact = cache.blends[b + "|" + n];
  if (exact) return formatLookupResult(exact, b, brand || "", name || "", lang);
  // 2. Brand fuzzy — punctuation-stripped, then Levenshtein.
  const canonical = resolveCanonicalBrand(brand || "");
  if (!canonical) return null;
  // 2a. If the canonical brand differs from the typed one, retry the
  //     exact name lookup under the canonical brand before falling
  //     through to the approximate name search.
  if (canonical !== b) {
    const exactUnderCanon = cache.blends[canonical + "|" + n];
    if (exactUnderCanon) return formatLookupResult(exactUnderCanon, canonical, brand || "", name || "", lang);
  }
  // 3. Approximate name lookup under the canonical brand.
  return approximateLookupSync(canonical, n, brand || "", name || "", lang);
}

// Tokenized search matcher for the Catalogue list view.
// The original filter used a plain `blob.includes(query)` substring
// — which broke on two common patterns:
//   1. Word reordering. The DB stores Capstan's blue blend as
//      "capstan|flake blue"; a user typing "capstan blue" (the
//      everyday English ordering) gets nothing because "capstan blue"
//      isn't a contiguous substring of "capstan flake blue ...".
//   2. Brand typos. Capstan vs Capitan, Sutliff vs Sutlif — same
//      class of errors the AI auto-fill tolerates via Levenshtein at
//      lookup time, but the catalog browser ignored entirely.
// The new matcher tokenizes the query on whitespace and applies
// AND-match semantics: every token must match somewhere in the blob,
// either via plain substring OR via Levenshtein against any blob
// word. The cap scales with token length so short tokens stay strict
// (2-3 chars: substring only — Lev-1 on a 3-letter token false-
// positives everything), medium tokens get cap 1, long tokens get
// cap 2. The blob includes the brand DISPLAY name + the brand key
// + the name + composition + category + cut + aliases — same
// surfaces the user can see in the row card.
export function tobaccoDbSearchMatch(
  blendKey: string,
  entry: BlendEntry,
  query: string,
): boolean {
  // Fold diacritics on BOTH sides so "vieux carre" matches
  // "Vieux Carré", "jubilaeums" matches "Jubilæums", etc. — the most
  // common reason a user-typed query missed a catalog row was the
  // accent / ligature mismatch (the blob used to carry the
  // accented form, the query was raw-typed ASCII, indexOf returned
  // -1). Folding both sides through the same helper makes the
  // comparison ASCII-only without losing information visible to the
  // user (the displayed catalog row keeps the original accents).
  const q = String(foldDiacritics(String(query || "").trim())).toLowerCase();
  if (!q) return true;
  const brandKey = String(blendKey).split("|")[0] || "";
  const brandMeta = cache && cache.brands[brandKey];
  const brandDisplay = (brandMeta && brandMeta.displayName) || brandKey;
  // Brand aliases (when present in the brand row) contribute
  // to the blob so a search for "Robert McConnell heather" hits every
  // McConnell blend without the user having to know the catalog spells
  // it "McConnell".
  const brandAliases = brandMeta && brandMeta.aliases && brandMeta.aliases.length
    ? " " + brandMeta.aliases.join(" ")
    : "";
  const blendAliases = entry.aliases && entry.aliases.length ? " " + entry.aliases.join(" ") : "";
  const blob = String(foldDiacritics(
    brandDisplay + " " + brandKey + " " + entry.name + " " +
    entry.blend + " " + entry.category + " " + entry.cut +
    brandAliases + blendAliases,
  )).toLowerCase();
  if (blob.indexOf(q) !== -1) return true;
  // Tokenize for AND-match. Each token must match somewhere — either
  // as a substring of the whole blob (handles partial words) or as a
  // word-level Levenshtein match (handles typos).
  const tokens = q.split(/\s+/).filter((s) => s.length > 0);
  if (tokens.length === 0) return false;
  // Split the blob into individual words for the Levenshtein pass.
  // Separators reflect punctuation that appears in blend names /
  // composition strings: spaces, commas, slashes, hyphens, parens.
  const words = blob.split(/[\s,/\-()'.]+/).filter((w) => w.length >= 3);
  for (const tok of tokens) {
    if (blob.indexOf(tok) !== -1) continue;
    // Per-token Levenshtein cap: stays strict on short queries.
    // <4 chars → substring only (no fuzzy — too easy to overshoot).
    // 4-5 chars → cap 1 (one typo / transposition).
    // ≥6 chars → cap 2 (two-edit tolerance, matches the brand-fuzzy
    //   rule already used by tobaccoDbLookupSync).
    let cap = 0;
    if (tok.length >= 6) cap = 2;
    else if (tok.length >= 4) cap = 1;
    if (cap === 0) return false;
    let matched = false;
    for (const w of words) {
      if (Math.abs(w.length - tok.length) > cap) continue;
      if (levenshteinCapped(tok, w, cap) <= cap) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

/** Async lookup that loads the DB first if needed. */
export async function tobaccoDbLookup(
  brand: string | undefined | null,
  name: string | undefined | null,
  lang: string,
): Promise<LookupResult | null> {
  // One load, one shape. A user catalogue carries every
  // language INLINE (one CSV, one file), so the old two-phase dance —
  // resolve the hit on specs, then pull that language's prose chunk — has
  // nothing left to fetch and is gone with the chunks.
  await loadTobaccoDb();
  return tobaccoDbLookupSync(brand, name, lang);
}

/** True if the cache is ready for synchronous lookups. */
export function isTobaccoDbReady(): boolean {
  return cache !== null;
}

/** Total blend count (0 if not loaded). Useful for UX hints + tests. */
export function tobaccoDbSize(): number {
  return cache ? Object.keys(cache.blends).length : 0;
}
