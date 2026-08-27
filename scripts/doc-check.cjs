#!/usr/bin/env node
/**
 * Cross-check the live code against CLAUDE.md to catch drift.
 *
 * Usage: `npm run doc:check` (added in package.json scripts).
 *
 * Verifies:
 *   1. APP_VERSION (constants.ts) === version.json.version === package.json.version
 *   2. APP_BUILD (constants.ts) === version.json.build
 *   3. The most-recent <h2><span class="tag">Build N</span> entry in
 *      changelog.html (FR section) matches APP_BUILD.
 *   4. Every file under src/utils/ is mentioned in CLAUDE.md.
 *   5. Every hook in src/hooks/ is mentioned in CLAUDE.md.
 *   6. Every localStorage key used in src/ outside tests is listed in
 *      the CLAUDE.md "localStorage Keys Reference" table.
 *   7. help.html section integrity — every section h2 id present + nested
 *      inside its language wrapper, for EVERY language present (fr/en
 *      mandatory; es/de/it… validated when their sec-<code> wrapper
 *      exists, so a malformed translated section is caught).
 *   8. APP_BUILD must be bumped if user-visible files have
 *      changed since the previous bump commit. `DOC_CHECK_SKIP_BUMP=1`
 *      is accepted only in CI; a human must NAME the files instead
 *      (`DOC_CHECK_SKIP_BUMP='a.ts,b.ts'`), and the names must match
 *      the flagged set exactly — see docChecks.resolveBumpSkip.
 *   9. i18n integrity: auto-discovers every src/i18n/<code>.ts dictionary
 *      and verifies each has the same key set as the `fr` reference
 *      (parity), and that every key passed to t("…") in src/ outside
 *      tests exists in ALL of them. Adding a language extends the check
 *      automatically. Unused keys are reported as warnings only.
 *  10. i18n quality (warnings only):
 *      (a) Identical reference/translation values not allowlisted for that language →
 *          likely forgotten translation. Allowlist covers emojis,
 *          single-char codes, and English/French cognates that are
 *          legitimately spelled the same (Notes, Description, …).
 *      (b) EN string > 1.4× FR string length (FR ≥ 3 chars) → may
 *          overflow card / button layouts. Surfaces a copy-tightening
 *          opportunity, not a hard error.
 *  11. Privacy disclosure — every third-party domain the app
 *      sends requests to (extracted from https:// literals in src/,
 *      minus placeholder + user-initiated-link domains) must be
 *      disclosed in public/privacy.html, either verbatim or via a
 *      mapped evidence string ("Anthropic" for api.anthropic.com…).
 *      Catches the class of gap where corsproxy.io /
 *      allorigins.win were live in code but absent from the policy.
 *  12. CLAUDE.md repository-structure tree — every concrete
 *      path listed in the ``` tree under "## Repository Structure"
 *      must exist on disk. Glob entries (*, {…}) are skipped. Catches
 *      ghost files (the historical LotDetailModal) and renames that
 *      forgot the doc.
 *
 * Exit 0 on success, 1 on any drift detected (CI-friendly).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
// The i18n gate DECISIONS live in their own pure module so they can
// be unit-tested (src/__tests__/i18nChecks.test.ts).
const i18nChecks = require("./i18nChecks.cjs");
// The tree / privacy-domain / bump-gate decisions live here, pure and
// unit-tested (src/__tests__/docChecks.test.ts) — same split as above.
const docChecks = require("./docChecks.cjs");

const ROOT = path.resolve(__dirname, "..");

// THE PROJECT DOCUMENT IS SEVEN FILES, AND EVERY GATE BELOW READS ALL OF THEM.
// The list is `docChecks.DOC_FILES` (see the comment there for why the split
// happened and why the list lives in the pure module rather than here). What
// matters at this call site: `CLAUDE` is the CONCATENATION, so gates 2/3/4
// grep the whole document and gate 9 still finds "## Repository Structure"
// wherever that section now lives.
const CLAUDE = docChecks.DOC_FILES
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n");
const CONSTANTS = fs.readFileSync(path.join(ROOT, "src/constants.ts"), "utf8");
const VERSION_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "public/version.json"), "utf8"));
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const CHANGELOG = fs.readFileSync(path.join(ROOT, "public/changelog.html"), "utf8");

const errors = [];
function err(msg) { errors.push(msg); }
// Gate 12 runs early (it needs CHANGELOG, already read above) but its
// warnings can only be emitted once `warnings` exists further down. No
// initialiser: assigning one here is dead, because the gate always writes it
// before anything reads it (`no-useless-assignment` flags exactly that).
let changelogWarnings;

// ── 1. Versions ────────────────────────────────────────────────────────
// Decision logic in scripts/docChecks.cjs (tested); this owns the reading.
docChecks.checkVersions({
  constants: CONSTANTS, versionJson: VERSION_JSON,
  packageJson: PACKAGE_JSON, changelog: CHANGELOG,
}).forEach(err);

// ── 2. utils/ files mentioned in CLAUDE.md ─────────────────────────────
docChecks.findUndocumentedModules(
  fs.readdirSync(path.join(ROOT, "src/utils")), CLAUDE, "src/utils").forEach(err);

// ── 3. hooks/ files mentioned in CLAUDE.md ─────────────────────────────
docChecks.findUndocumentedModules(
  fs.readdirSync(path.join(ROOT, "src/hooks")), CLAUDE, "src/hooks").forEach(err);

// ── 4. localStorage keys ───────────────────────────────────────────────
function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "dist") return;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full);
    }
  });
}
const srcFiles = [];
walk(path.join(ROOT, "src"), srcFiles);
docChecks.findUndocumentedStorageKeys(
  docChecks.extractStorageKeys(srcFiles.map((f) => fs.readFileSync(f, "utf8"))),
  CLAUDE,
).forEach(err);

// ── 5. help.html section integrity ─────────────────────────────────────
// The in-app HelpView (src/views/curator/HelpView.tsx) expects every
// FR/EN section h2 to be present in public/help.html, with its id and
// title intact. A stray </div> once auto-closed <div id="sec-fr">
// and ejected the last 4 h2s into <body>, so they rendered as empty
// title-less cards. The parser is now source-order-robust, but we
// still want to catch broken HTML here so a future edit doesn't
// silently lose a section. We additionally enforce that every h2 sits
// inside its language wrapper — that's the structural contract the
// help.html source must respect.
const HELP_HTML_PATH = path.join(ROOT, "public/help.html");
const HELP_SECTION_IDS = [
  { key: "install",         ids: { fr: "fr-install",    en: "en-install",         es: "es-install",         de: "de-install",         it: "it-install", pt: "pt-install" } },
  { key: "concepts",        ids: { fr: "fr-concepts",   en: "en-concepts",        es: "es-concepts",        de: "de-concepts",        it: "it-concepts", pt: "pt-concepts" } },
  { key: "cycle",           ids: { fr: "fr-cycle",      en: "en-cycle",           es: "es-cycle",           de: "de-cycle",           it: "it-cycle", pt: "pt-cycle" } },
  { key: "catalogue",       ids: { fr: "fr-catalogue",  en: "en-catalogue",       es: "es-catalogue",       de: "de-catalogue",       it: "it-catalogue", pt: "pt-catalogue" } },
  { key: "tobacco",         ids: { fr: "fr-tabac",      en: "en-tobacco",         es: "es-tobacco",         de: "de-tobacco",         it: "it-tobacco", pt: "pt-tobacco" } },
  { key: "lots",            ids: { fr: "fr-lots",       en: "en-lots",            es: "es-lots",            de: "de-lots",            it: "it-lots", pt: "pt-lots" } },
  { key: "inventory",       ids: { fr: "fr-inventaire", en: "en-inventory",       es: "es-inventory",       de: "de-inventory",       it: "it-inventory", pt: "pt-inventory" } },
  { key: "pipes",           ids: { fr: "fr-pipes",      en: "en-pipes",           es: "es-pipes",           de: "de-pipes",           it: "it-pipes", pt: "pt-pipes" } },
  { key: "wishlist",        ids: { fr: "fr-wishlist",   en: "en-wishlist",        es: "es-wishlist",        de: "de-wishlist",        it: "it-wishlist", pt: "pt-wishlist" } },
  { key: "acc",             ids: { fr: "fr-acc",        en: "en-acc",             es: "es-acc",             de: "de-acc",             it: "it-acc", pt: "pt-acc" } },
  { key: "journal",         ids: { fr: "fr-journal",    en: "en-journal",         es: "es-journal",         de: "de-journal",         it: "it-journal", pt: "pt-journal" } },
  { key: "ai",              ids: { fr: "fr-ia",         en: "en-ai",              es: "es-ai",              de: "de-ai",              it: "it-ai", pt: "pt-ai" } },
  { key: "stats",           ids: { fr: "fr-stats",      en: "en-stats",           es: "es-stats",           de: "de-stats",           it: "it-stats", pt: "pt-stats" } },
  { key: "backup",          ids: { fr: "fr-sauvegarde", en: "en-backup",          es: "es-backup",          de: "de-backup",          it: "it-backup", pt: "pt-backup" } },
  { key: "updates",         ids: { fr: "fr-maj",        en: "en-updates",         es: "es-updates",         de: "de-updates",         it: "it-updates", pt: "pt-updates" } },
  { key: "troubleshooting", ids: { fr: "fr-depannage",  en: "en-troubleshooting", es: "es-troubleshooting", de: "de-troubleshooting", it: "it-troubleshooting", pt: "pt-troubleshooting" } },
  { key: "trash",           ids: { fr: "fr-corbeille",  en: "en-trash",           es: "es-trash",           de: "de-trash",           it: "it-trash", pt: "pt-trash" } },
  { key: "settings",        ids: { fr: "fr-parametres", en: "en-settings",        es: "es-settings",        de: "de-settings",        it: "it-settings", pt: "pt-settings" } },
];
try {
  const { JSDOM } = require("jsdom");
  const html = fs.readFileSync(HELP_HTML_PATH, "utf8");
  const doc = new JSDOM(html).window.document;
  // Discover which language wrappers are present. fr + en are mandatory;
  // any other sec-<code> present (es/de/it…) is validated too, so a
  // malformed translated section is caught. A language with no wrapper is
  // simply skipped (not yet translated).
  docChecks.checkHelpAnchors(doc, HELP_SECTION_IDS).forEach(err);
  // Gate 22: the guide's "Type" and "Cut" tables must list the real
  // enums. They are PROSE, so nothing had ever read an enum out of them, and
  // all six had sat three categories behind the app for a long stretch —
  // found by hand, which is the method this file keeps recording
  // as the one that does not scale.
  {
    const enumOf = (name) => {
      const m = new RegExp("var " + name + "\\s*=\\s*\\[([^\\]]*)\\]").exec(CONSTANTS);
      return m ? m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
    };
    docChecks.checkHelpEnumTables(html, enumOf("CATS"), enumOf("CUTS")).forEach(err);
    // Gate 23: the other EIGHT enums, and the translated LABEL
    // rather than a count. Gate 22 checks cardinality for the five non-French
    // languages, which is blind to the guide naming a value the dropdown does
    // not show — see checkHelpEnumLabels for what that had cost.
    const mapOf = (name) => {
      const m = new RegExp("var " + name + "\\s*:\\s*Record<string, string>\\s*=\\s*\\{([^}]*)\\}").exec(CONSTANTS);
      if (!m) return {};
      const o = {};
      for (const p2 of m[1].matchAll(/"?([^",:{]+)"?\s*:\s*"((?:[^"\\]|\\.)*)"/g)) o[p2[1].trim()] = p2[2];
      return o;
    };
    const LANGS = ["fr", "en", "es", "de", "it", "pt"];
    const NAMES = ["CATS", "CUTS", "SHAPES", "BENDS", "FILTERS", "BOWL_MATS",
                   "STEM_MATS", "FINISHES", "ACC_TYPES", "LIGHTER_FUELS"];
    const enums = {}, maps = {};
    for (const n of NAMES) {
      enums[n] = enumOf(n);
      maps[n] = {};
      for (const c of LANGS) maps[n][c] = c === "fr" ? {} : mapOf(n + "_" + c.toUpperCase());
    }
    docChecks.checkHelpEnumLabels(html, enums, maps).forEach(err);
  }
} catch (e) {
  err("help.html: failed to parse — " + (e && e.message ? e.message : String(e)));
}

// ── 5b. Changelog carries FUNCTIONAL changes only ──────────────────────
// The rule ("features and important changes only — never simple bug fixes")
// long predates this gate and was enforced by prose alone, which is
// the state in which a rule silently stops being true. See
// docChecks.checkChangelogIsFunctional for why one signal fails and the other
// only warns. Warnings are collected here and printed with the rest below.
{
  const cl = docChecks.checkChangelogIsFunctional(CHANGELOG, VERSION_JSON.version);
  cl.errors.forEach(err);
  changelogWarnings = cl.warnings;
}

// ── 5b. Changelog per-entry language parity (gate 25) ──────────────────
// Gate 1 reads the latest build number out of the FRENCH section only, so an
// entry missing from — or duplicated in — any other language was invisible.
// Proven, not theorised: a duplicated Portuguese block passed the whole gate
// set and was caught by reading the file.
//
// The language list is DERIVED from the shipped dictionaries, never a literal:
// a frozen list here would silently stop covering the next language added,
// which is the exact failure shape this repo has recorded five times.
{
  const clLangs = fs.readdirSync(path.join(ROOT, "src/i18n"))
    .filter((f) => /^[a-z]{2,3}\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
  docChecks.checkChangelogLanguageParity(CHANGELOG, VERSION_JSON.version, clLangs).forEach(err);
}

// ── 6. APP_BUILD bump guard ────────────────────────────────────────────
// Goal: catch the "shipped 11 commits worth of user-visible changes
// without a single APP_BUILD bump" failure mode. Algorithm:
//   1. Find the latest commit that modified the APP_BUILD constant.
//   2. List every file changed between that commit (exclusive) and
//      HEAD (inclusive).
//   3. If any of those files matches a user-visible pattern, fail
//      and tell the developer to bump APP_BUILD + version.json before
//      pushing. A changelog entry is NOT demanded — most builds add
//      none, and the version gate lets the latest entry lag.
//
// Escape hatch: `DOC_CHECK_SKIP_BUMP`. A bare `1` is accepted only in
// CI; locally the caller must NAME the flagged files and the names must
// match exactly. The reasoning — including the two occasions the hatch
// was taken without the diff being opened — is on
// docChecks.resolveBumpSkip, which owns the decision.
//
// User-visible patterns (touched ⇒ ship-worthy):
//   - src/views/, src/hooks/, src/utils/, src/components/
//   - src/App.tsx, src/CuratorApp.tsx, src/AppContext.tsx
//   - src/i18n.ts (strings), src/theme-curator.ts (colors/fonts)
//   - src/constants.ts (enums + templates — APP_BUILD bumps land here
//     too, but the diff excludes the bump commit itself)
//   - src/types.ts (data shape impacts persisted storage)
//   - public/sw.js, public/manifest.json, public/icon-*.png
//   - index.html
//
// NOT user-visible (touched freely without a bump):
//   - any *.test.{ts,tsx}, src/__tests__/, e2e/
//   - eslint-rules/, eslint.config.js, scripts/, tsconfig*.json
//   - playwright.config.ts, vite.config.*
//   - package.json, package-lock.json
//   - public/changelog.html (doc), public/help.html (doc), public/privacy.html
//   - public/licenses.html, public/reset.html, public/version.json (auto-bumped)
//   - .github/, .gitignore, CLAUDE.md, README.md, SECURITY.md, LICENSE
const USER_VISIBLE_RE = [
  /^src\/views\//,
  /^src\/hooks\//,
  /^src\/utils\//,
  /^src\/components\//,
  /^src\/App\.tsx$/,
  /^src\/CuratorApp\.tsx$/,
  /^src\/AppContext\.tsx$/,
  /^src\/i18n\.ts$/,
  // The DICTIONARIES, not just the registry above. `^src/i18n\.ts$` is
  // anchored, so it matches the loader and nothing under `src/i18n/` — which
  // is where every visible string in the app actually lives. A translation fix
  // could therefore ship with no APP_BUILD bump: version.json stays put,
  // checkVersion never fires, and nobody receives the corrected text. Unlike
  // public/help.html — excluded on purpose below, because it is served
  // network-first and reaches users without a build — the dictionaries are
  // BUNDLED into content-hashed chunks, so a bump is the only delivery path.
  /^src\/i18n\//,
  /^src\/theme-curator\.ts$/,
  /^src\/constants\.ts$/,
  /^src\/types\.ts$/,
  /^public\/sw\.js$/,
  /^public\/manifest\.json$/,
  /^public\/icon-.*\.(png|svg)$/,
  /^index\.html$/,
];
const NEVER_VISIBLE_RE = [
  /^src\/__tests__\//,
  /\.test\.(ts|tsx|js|jsx)$/,
  /^src\/main\.jsx$/,
  /^src\/globals\.d\.ts$/,
];

function isUserVisible(p) {
  return docChecks.findUserVisibleChanges([p], USER_VISIBLE_RE, NEVER_VISIBLE_RE).length > 0;
}

function gitCmd(args) {
  try {
    return execSync("git " + args, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_e) {
    return null;
  }
}

if (gitCmd("rev-parse --is-inside-work-tree") === "true") {
  // Find the LATEST commit that touched the `APP_BUILD = "…"` line.
  // The `-G` flag matches the regex against the diff, so we hit exactly
  // the commits that changed the value (not commits that merely touched
  // the surrounding constants.ts).
  const lastBumpSha = gitCmd(
    'log -G "APP_BUILD\\s*=\\s*\\"" -1 --pretty=format:%H -- src/constants.ts',
  );
  const headSha = gitCmd("rev-parse HEAD");
  if (!lastBumpSha) {
    // No bump commit ever — first run on a fresh repo. Skip.
  } else if (lastBumpSha === headSha) {
    // HEAD itself is the bump commit. Nothing accumulated yet.
  } else {
    // List files changed between lastBumpSha (exclusive) and HEAD.
    const diffOut = gitCmd(`diff --name-only ${lastBumpSha} HEAD`);
    const offenders = diffOut
      ? diffOut.split("\n").filter(Boolean).filter(isUserVisible)
      : [];
    // The skip is resolved AFTER the offenders are known, because taking it
    // now requires naming them — see docChecks.resolveBumpSkip for why the
    // rule is a mechanism rather than a sentence.
    const skip = docChecks.resolveBumpSkip({
      raw: process.env.DOC_CHECK_SKIP_BUMP,
      isCI: !!process.env.CI,
      offenders,
    });
    if (skip.error) {
      err(skip.error);
    } else if (skip.skip && offenders.length > 0) {
      console.log(
        "doc:check — APP_BUILD bump guard skipped, " + offenders.length +
        " user-visible file(s) acknowledged.",
      );
    } else if (!skip.skip && offenders.length > 0) {
      const shortSha = lastBumpSha.slice(0, 7);
      err(
        "APP_BUILD has not been bumped since commit " + shortSha +
        ", but " + offenders.length + " user-visible file(s) changed since:\n      • " +
        offenders.slice(0, 12).join("\n      • ") +
        (offenders.length > 12 ? "\n      • …and " + (offenders.length - 12) + " more" : "") +
        "\n    Bump APP_BUILD in src/constants.ts + public/version.json. A changelog\n" +
        "    entry is NOT required — most builds add none, and the version gate\n" +
        "    deliberately lets the latest entry lag behind APP_BUILD.\n" +
        "    The escape hatch exists but is not a shortcut: it requires diffing\n" +
        "    each file above and naming them. See docChecks.resolveBumpSkip.",
      );
    }
  }
}

// ── 7. i18n parity ─────────────────────────────────────────────────────
// Goal: future-proof the codebase for adding a new language. Two checks:
//   (a) Every key passed to t("…") in src/ outside tests must exist in
//       BOTH the fr and en blocks of src/i18n.ts.
//   (b) The fr and en blocks must have the same key set — adding a key
//       to one and forgetting the other is the most common i18n bug.
// Unused keys (defined but never called as t("…")) are surfaced as
// warnings only — they may be referenced indirectly (xl, dynamic
// lookups) or be legitimately dormant. Don't fail CI on them.
const warnings = [];
function warn(msg) { warnings.push(msg); }
(changelogWarnings || []).forEach(warn);

// Allowlist for the "identical fr/en values" sub-check, loaded from
// scripts/doc-check.allowlist.json. Each entry is a key whose fr and
// en values are genuinely identical by design (emoji, brand name,
// cognate spelled the same in both languages). When you add a new key
// whose FR and EN match by design, append it to the JSON so the warning
// stays actionable signal. Loaded once at startup — a malformed JSON
// fails doc:check fast with a clear message.
const I18N_ALLOWLIST_PATH = path.join(ROOT, "scripts/doc-check.allowlist.json");
let I18N_IDENTICAL_ALLOWLIST;
// Keys that ARE live but built dynamically (t(prefix+var), a map,
// or L.<key> property access) — doc:check can't see those, so they'd show as
// "unused". These suppress the unused warning so it stays a real signal.
let I18N_DYNAMIC_PREFIXES = [];
let I18N_DYNAMIC_KEYS = new Set();
const isDynamicKey = (k) =>
  I18N_DYNAMIC_KEYS.has(k) || I18N_DYNAMIC_PREFIXES.some((p) => k.startsWith(p));
// Is this key's value legitimately identical to the reference in THIS language?
// Per-language: an entry lists the languages the match is by
// design in ("*" = all), so one cognate can't silence three other pairs. The
// predicate itself lives in i18nChecks.identicalAllowed and is called from
// findSuspiciousIdentical — the dead local wrapper left over from that
// extraction was deleted (first thing linting this directory found).
try {
  const raw = JSON.parse(fs.readFileSync(I18N_ALLOWLIST_PATH, "utf8"));
  I18N_IDENTICAL_ALLOWLIST = i18nChecks.parseIdenticalAllowlist(raw.identical);
  I18N_DYNAMIC_PREFIXES = Array.isArray(raw.dynamicKeyPrefixes) ? raw.dynamicKeyPrefixes : [];
  I18N_DYNAMIC_KEYS = new Set(Array.isArray(raw.dynamicKeys) ? raw.dynamicKeys : []);
} catch (e) {
  err("scripts/doc-check.allowlist.json: failed to load — " + (e && e.message ? e.message : String(e)));
  I18N_IDENTICAL_ALLOWLIST = new Map();
}

// The per-language dictionaries live in src/i18n/<code>.ts (fr, en, and
// any future language). They are AUTO-DISCOVERED here so adding a
// language extends parity automatically — no edit to this check. French
// is the reference/canonical key set (stored enum values are French too).
const I18N_DIR = path.join(ROOT, "src/i18n");
const I18N_REF = "fr";
try {
  // Robust extraction: directly parse key:"value" pairs. The string
  // literal regex tolerates escaped quotes (\") inside values.
  const parseBlock = i18nChecks.parseDictSource;
  const dictFiles = fs.readdirSync(I18N_DIR)
    .filter((f) => /^[a-z]{2,3}\.ts$/.test(f))
    .sort();
  const dicts = {};      // code -> { key: value }
  const dictPaths = {};  // code -> absolute path
  for (const f of dictFiles) {
    const code = f.replace(/\.ts$/, "");
    dictPaths[code] = path.join(I18N_DIR, f);
    dicts[code] = parseBlock(fs.readFileSync(dictPaths[code], "utf8"));
  }
  const codes = Object.keys(dicts);
  // Gate 13: a discovered dictionary must also carry a complete
  // LANG_ASSETS row, or that language silently falls back to English months,
  // the English number locale and English AI output.
  docChecks.checkLangAssets(
    fs.readFileSync(path.join(I18N_DIR, "languages.ts"), "utf8"), codes,
  ).forEach(err);
  // Gate 14: and its enum labels, or that language reads the stored
  // French on every card, fiche and filter chip.
  docChecks.checkEnumTranslations(CONSTANTS, codes).forEach(err);
  // Gate 21: an internal anchor must stay inside its own language
  // block. Adding Portuguese shipped all 30 of its help links pointing at
  // #en-* — invisible to reading, fatal to navigation.
  for (const page of ["help.html", "changelog.html", "privacy.html"]) {
    const f = path.join(ROOT, "public", page);
    if (fs.existsSync(f)) docChecks.checkAnchorLanguage(fs.readFileSync(f, "utf8"), "public/" + page).forEach(err);
  }
  // Gate 16: gate 14 checks the ROW names the language; an override
  // map is deliberately SPARSE, so an EMPTY one passes it while every enum
  // value renders in stored French. Measured with a trial seventh language:
  // ten `= {}` maps, gate 14 silent, doc:check green.
  docChecks.checkEnumCoverage(CONSTANTS, codes).forEach(err);
  // Gate 15: gates 13 and 14 each guard ONE known map. This one
  // guards the SHAPE — any flat per-language literal in production source must
  // cover every registry code. Adding Portuguese found three uncovered axes
  // (geo.ts's country table, HelpView.SECTION_IDS, this file's own
  // HELP_SECTION_IDS) that all failed silently.
  {
    const roots = [path.join(ROOT, "src"), path.join(ROOT, "scripts"), path.join(ROOT, "eslint-rules")];
    const files = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        // Tests are excluded: their fixtures legitimately name a subset of
        // languages, and the two that mattered are now derived from the
        // registry and asserted by their own suites.
        if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(abs); continue; }
        if (!/\.(ts|tsx|js|jsx|cjs)$/.test(e.name)) continue;
        if (/\.test\./.test(e.name)) continue;
        // The dictionaries' own keys are i18n keys, not language codes.
        if (/[\\/]i18n[\\/][a-z]{2,3}\.ts$/.test(abs)) continue;
        files.push({ path: path.relative(ROOT, abs), source: fs.readFileSync(abs, "utf8") });
      }
    };
    roots.forEach(walk);
    docChecks.findLanguageAxisGaps(files, codes).forEach(err);
  }
  // Gate 19: a dictionary that is a COPY of en.ts. The identical-
  // value gate below compares each language to FRENCH, so an English copy
  // differs from the reference nearly everywhere and passes in silence.
  docChecks.findEnglishCopyDicts(dicts).forEach(err);
  // Gate 17: the numeric label contracts name each dictionary by
  // PATH, an axis gate 15 structurally cannot see (it reads literals of
  // language codes in source, not JSON arrays of file names).
  {
    const CPATH = path.join(ROOT, "scripts/label-contracts.json");
    if (fs.existsSync(CPATH)) {
      let reg = null;
      try { reg = JSON.parse(fs.readFileSync(CPATH, "utf8")); } catch { reg = null; }
      if (reg) docChecks.checkContractLanguageCoverage(reg, codes).forEach(err);
    }
  }
  // Gate 18: a doc page with no block for a language renders in
  // ANOTHER language via extractLangSection's fallback — invisibly. Graded by
  // what the block costs to write: privacy.html is one page and legally
  // meaningful, so it fails; changelog.html is ~80 historical entries, so a
  // hard gate would only ever be satisfied by pasting the English text, which
  // is what the fallback already does — it warns instead.
  {
    const readDoc = (f) => ({ file: f, source: fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), "utf8") : "" });
    for (const row of docChecks.findMissingDocLangBlocks([readDoc("public/privacy.html")], codes)) {
      err(`${row.file}: no <div id="sec-…"> block for ${row.missing.join(", ")} — those readers silently get another language's privacy policy.`);
    }
    for (const row of docChecks.findMissingDocLangBlocks([readDoc("public/changelog.html")], codes)) {
      warn(`${row.file}: no <div id="sec-…"> block for ${row.missing.join(", ")} — those readers fall back to English.`);
    }
  }
  // Gate 20 is GONE: it warned when a UI language had
  // no `tobacco-db.desc-<lang>.json`, i.e. when the app's own bundled
  // catalogue prose lagged a newly-added language. The app ships no catalogue,
  // so there is no prose of ours to lag — a user's CSV carries its own
  // languages inline and `pickLang` resolves them.
  if (!dicts[I18N_REF]) {
    err("src/i18n/" + I18N_REF + ".ts: reference dictionary not found (needed for i18n parity).");
  } else {
    const refMap = dicts[I18N_REF];
    const refKeys = new Set(Object.keys(refMap));

    // (a) Every language must carry EXACTLY the reference key set.
    // The comparison itself is i18nChecks.findParityGaps — which was exported
    // and unit-tested from the moment it was extracted, while this gate quietly kept its own
    // inline copy. So the tested function guarded nothing and the running gate
    // had no test: the two halves of the same mistake, and exactly the shape
    // this file's other gates exist to catch elsewhere.
    for (const code of codes) {
      if (code === I18N_REF) continue;
      const { missing: refOnly, extra: codeOnly } =
        i18nChecks.findParityGaps(refMap, dicts[code]);
      if (refOnly.length > 0) {
        err(
          "src/i18n/" + code + ".ts: " + refOnly.length + " key(s) in " + I18N_REF + " but missing in " + code + ":\n      • " +
          refOnly.slice(0, 12).join("\n      • ") +
          (refOnly.length > 12 ? "\n      • …and " + (refOnly.length - 12) + " more" : ""),
        );
      }
      if (codeOnly.length > 0) {
        err(
          "src/i18n/" + code + ".ts: " + codeOnly.length + " key(s) in " + code + " but missing in " + I18N_REF + ":\n      • " +
          codeOnly.slice(0, 12).join("\n      • ") +
          (codeOnly.length > 12 ? "\n      • …and " + (codeOnly.length - 12) + " more" : ""),
        );
      }
    }

    // (b) Keys used in code must exist in EVERY language block.
    //   t("key") / tr("key", "…") — the canonical + per-component wrapper;
    //   LANG[lng]?.key           — direct lookup in class components / save
    //                              handlers that can't reach React context.
    const i18nSelfFiles = new Set([
      path.join(ROOT, "src/i18n.ts"),
      path.join(ROOT, "src/i18n/languages.ts"),
    ]);
    for (const code of codes) i18nSelfFiles.add(dictPaths[code]);
    const usedKeys = new Set(docChecks.extractTKeys(
      srcFiles
        .filter((f) => !i18nSelfFiles.has(f) && !/\.test\.(ts|tsx|js|jsx)$/.test(f))
        .map((f) => fs.readFileSync(f, "utf8")),
    ));
    for (const code of codes) {
      const missing = docChecks
        .findMissingTKeys([...usedKeys], Object.keys(dicts[code]), code)
        .map((m) => m.replace(/^i18n: t\("/, "").replace(/"\).*$/, ""));
      if (missing.length > 0) {
        err(
          "i18n: " + missing.length + " key(s) called via t() but missing in the " + code + " block:\n      • " +
          missing.slice(0, 12).join("\n      • ") +
          (missing.length > 12 ? "\n      • …and " + (missing.length - 12) + " more" : ""),
        );
      }
    }

    // (b.2) Dev-fallback parity — a `t ? t("key") : "literal"`
    // fallback must EQUAL the fr value. The literal never renders in
    // production (t is always present), but a drifted fallback is misleading
    // and would show wrong text in any t-less render path / test. Enforced
    // after a one-time sweep reconciled 129 pre-existing divergences; the
    // gate keeps the class dead. Compares the raw (escaped) forms, which is
    // exactly how parseBlock stores refMap — apples-to-apples.
    const fbMismatch = [];
    srcFiles.forEach((f) => {
      if (i18nSelfFiles.has(f)) return;
      if (/\.test\.(ts|tsx|js|jsx)$/.test(f)) return;
      for (const m of docChecks.findFallbackMismatches(
        fs.readFileSync(f, "utf8"), refMap, path.relative(ROOT, f))) {
        fbMismatch.push(m.message);
      }
    });
    if (fbMismatch.length > 0) {
      err(
        "i18n: " + fbMismatch.length + ' dev-fallback literal(s) diverge from their fr value (t ? t("k") : "…"). Make each fallback equal fr[k]:\n      • ' +
        fbMismatch.slice(0, 12).join("\n      • ") +
        (fbMismatch.length > 12 ? "\n      • …and " + (fbMismatch.length - 12) + " more" : ""),
      );
    }

    // (c) Unused keys — in the reference set but never called as t("key")
    // (nor via LANG[..]?.key). Keys built dynamically (t(prefix+var),
    // a map, or read as L.<key> in class components) are allowlisted by prefix
    // in doc-check.allowlist.json so this warning stays a real signal — a
    // genuinely-new dead key shows up instead of drowning in 150 false hits.
    // Warning only: the remainder may still be referenced indirectly.
    const unused = docChecks.findUnusedTKeys([...refKeys], usedKeys, isDynamicKey);
    if (unused.length > 0) {
      warn(
        "i18n: " + unused.length + " key(s) defined but never called as t(\"…\"):\n      • " +
        unused.slice(0, 12).join("\n      • ") +
        (unused.length > 12 ? "\n      • …and " + (unused.length - 12) + " more" : "") +
        "\n    These may be referenced indirectly (add a prefix to doc-check.allowlist.json `dynamicKeyPrefixes`), or genuinely unused — then drop them from src/i18n/*.ts.",
      );
    }

    // (d) Identical reference/translation values — likely forgotten
    // translation. Runs per non-reference language against the reference.
    // (The letter test lives in i18nChecks; the dead local copy was removed.)
    for (const code of codes) {
      if (code === I18N_REF) continue;
      const tMap = dicts[code];
      const suspiciousIdentical = i18nChecks.findSuspiciousIdentical(
        refMap, tMap, code, I18N_IDENTICAL_ALLOWLIST);
      if (suspiciousIdentical.length > 0) {
        warn(
          "i18n: " + suspiciousIdentical.length + " key(s) have identical " + I18N_REF + "/" + code +
          " values outside the allowlist — possibly a forgotten translation:\n      • " +
          suspiciousIdentical.slice(0, 12).map((x) => x.k + " = " + JSON.stringify(x.v)).join("\n      • ") +
          (suspiciousIdentical.length > 12 ? "\n      • …and " + (suspiciousIdentical.length - 12) + " more" : "") +
          "\n    If the match is by design (cognate, brand), add \"" + code + "\" to that key's languages in scripts/doc-check.allowlist.json.",
        );
      }
    }

    // (d.2) GATE 24 — the `*_FAMILIES` group labels, against ENGLISH.
    //
    // Gate (d) above compares every language to FRENCH, so a value left in
    // ENGLISH is structurally invisible to it. That blind spot shipped two
    // Portuguese defects: `cat_fam_english` read "English & Latakia" while
    // `CATS_PT["Anglais"]` says "Ingl\u00eas", and `bowlmat_fam_wood` read "Urze e
    // madeira" against `BOWL_MATS_PT["Bruy\u00e8re"] = "Briar"` \u2014 the word the
    // Portuguese trade research settled on and rejected. In both cases the group HEADER contradicted the
    // option it groups, in the dropdown, on screen.
    //
    // Why this is scoped to the ~23 group labels and not run over the whole
    // dictionary: MEASURED, a full English-reference pass yields 35 candidates
    // of which ONE is real \u2014 "Chocolate", "Status", "Privacy", "Passphrase"
    // and friends are genuine cognates. 1-in-35 is the precision that got the
    // cut\u2194prose axis rejected as a check, and an advisory list nobody reads
    // is worse than no list. Restricted to this table the precision is ~1:1,
    // because it is a hand-maintained per-language axis (CLAUDE.md's note on
    // the shape-family group labels says so in as many words: "nothing checks THAT").
    //
    // The allowlist is the existing one and needs no new mechanism \u2014 but note
    // its language codes mean "legitimately equals the FRENCH reference", so
    // for an ENGLISH reference the reference language itself (fr) has to be
    // listed too on the proper nouns. Gate (d) skips `code === I18N_REF`, so a
    // "fr" entry is inert there and cannot loosen it.
    const groupLabelKeys = docChecks.extractGroupLabelKeys(CONSTANTS);
    if (groupLabelKeys.length === 0) {
      // A parse that degrades to nothing makes every check below pass in
      // silence, which is the worst outcome and not the safest \u2014 the same
      // non-vacuity guard the catalogue importer needed.
      err("doc-check: could not extract any *_FAMILIES labelKey from src/constants.ts \u2014 gate 24 would pass vacuously.");
    } else if (dicts.en) {
      const pick = (m) => Object.fromEntries(
        groupLabelKeys.filter((k) => k in m).map((k) => [k, m[k]]));
      const enMap = pick(dicts.en);
      for (const code of codes) {
        if (code === "en") continue;
        const hits = i18nChecks.findSuspiciousIdentical(
          enMap, pick(dicts[code]), code, I18N_IDENTICAL_ALLOWLIST);
        if (hits.length > 0) {
          err(
            "src/i18n/" + code + ".ts: " + hits.length + " group label(s) still byte-identical to ENGLISH:\n      \u2022 " +
            hits.map((x) => x.k + " = " + JSON.stringify(x.v)).join("\n      \u2022 ") +
            "\n    A group header must speak the language of the options it groups. If the match is a proper noun " +
            "(Burley, Calabash), add \"" + code + "\" to that key in scripts/doc-check.allowlist.json.",
          );
        }
      }
    }

    // (e) Long-string visual audit — a translation > 1.4× the reference
    // length can overflow tight layouts. Per non-reference language.
    const RATIO_THRESHOLD = i18nChecks.RATIO_THRESHOLD;
    for (const code of codes) {
      if (code === I18N_REF) continue;
      const tMap = dicts[code];
      const longRatio = i18nChecks.findLengthOutliers(refMap, tMap, code, RATIO_THRESHOLD);
      if (longRatio.length > 0) {
        warn(
          "i18n: " + longRatio.length + " key(s) where " + code + " is > " + RATIO_THRESHOLD +
          "× the " + I18N_REF + " length — may overflow tight layouts:\n      • " +
          longRatio.slice(0, 10).map((x) =>
            x.k + "  " + I18N_REF + "=" + x.lf + ", " + code + "=" + x.lt + " (×" + x.ratio.toFixed(2) + ")  " +
            JSON.stringify(tMap[x.k])
          ).join("\n      • ") +
          (longRatio.length > 10 ? "\n      • …and " + (longRatio.length - 10) + " more" : "") +
          "\n    Tighten the " + code + " copy or verify the surface (button width, card chip) absorbs it.",
        );
      }
    }
  }
} catch (e) {
  err("src/i18n/*.ts: failed to parse — " + (e && e.message ? e.message : String(e)));
}

// ── 8. Privacy disclosure — third-party domains ────────────────────────
// Every domain the app actually sends requests to must be disclosed in
// public/privacy.html. The audit that motivated it found corsproxy.io and
// api.allorigins.win live in the image pipeline but absent from the
// policy — this check makes that class of omission impossible to ship.
//
// Mechanism: extract every `https://<host>` literal from src/ (tests
// excluded, comments included — a domain in a comment next to a fetch
// is cheap noise vs. the risk of missing one), drop placeholder and
// user-initiated-link hosts, then require each remaining host to appear
// in privacy.html — verbatim, or via a mapped evidence string for hosts
// the policy names in prose ("Anthropic" for api.anthropic.com).
// A brand-new fetch target with no disclosure and no mapping FAILS, so
// adding a provider forces a privacy edit in the same commit.
const PRIVACY_HTML = fs.readFileSync(path.join(ROOT, "public/privacy.html"), "utf8");
// Hosts that never carry user data flows:
const DOMAIN_IGNORE = new Set([
  "t-cellar.app",            // the app's own domain (links, docs)
  "example.com",             // placeholder in comments / JSDoc
  "evil.example.com",        // security-test fixtures in comments
  "cdn.example.com",         // same
  "x.test",                  // same
  "app",                     // truncated match from a template literal
  "x",                       // same
  "i.imgur.com",             // sample URL in a comment
  "upload.wikimedia.org",    // sample URL in a comment
  "developers.google.com",   // doc link in a comment
  "www.google.com",          // user-initiated window.open (image search) — a
                             // tapped link, not an app-driven data flow
]);
// Hosts disclosed in prose rather than verbatim — host → strings of
// which at least ONE must appear in privacy.html:
const DOMAIN_EVIDENCE = {
  "api.anthropic.com": ["Anthropic"],
  "api.openai.com": ["OpenAI"],
  "generativelanguage.googleapis.com": ["Gemini"],
  "www.googleapis.com": ["Google Drive"],
  "oauth2.googleapis.com": ["OAuth"],
  "accounts.google.com": ["OAuth", "Google"],
};
const foundDomains = new Set();
srcFiles.forEach((f) => {
  if (/\.test\.(ts|tsx|js|jsx)$/.test(f)) return;
  for (const h of docChecks.extractDomains(fs.readFileSync(f, "utf8"))) foundDomains.add(h);
});
for (const host of docChecks.findUndisclosedDomains(foundDomains, PRIVACY_HTML, {
  ignore: DOMAIN_IGNORE, evidence: DOMAIN_EVIDENCE,
})) {
  err(
    `privacy: src/ sends requests to "${host}" but public/privacy.html does not disclose it.\n` +
    "    Either add the domain (or its service name) to the policy, map it in\n" +
    "    DOMAIN_EVIDENCE, or — if it is a placeholder / user-tapped link — add it\n" +
    "    to DOMAIN_IGNORE in scripts/doc-check.cjs with a comment saying why.",
  );
}

// ── 9. CLAUDE.md repository-structure tree ─────────────────────────────
// Every concrete path in the fenced tree under "## Repository Structure"
// must exist on disk. Tree-drawing prefixes are 4 chars per depth level
// ("│   " / "    " then "├── " / "└── "); inline comments start at " #".
// Entries containing * or { are glob patterns — skipped. Continuation
// lines (comment-only, no entry) are skipped.
(function checkStructureTree() {
  const parsed = docChecks.extractTreePaths(CLAUDE, "## Repository Structure");
  for (const e of parsed.errors) err(e);
  if (parsed.errors.length) return;
  const missing = parsed.paths
    .filter((p) => !fs.existsSync(path.join(ROOT, p.rel)))
    .map((p) => p.rel + (p.isDir ? "/" : ""));
  if (missing.length > 0) {
    err(
      "CLAUDE.md: " + missing.length + " path(s) in the Repository Structure tree do not exist on disk:\n      • " +
      missing.slice(0, 12).join("\n      • ") +
      (missing.length > 12 ? "\n      • …and " + (missing.length - 12) + " more" : "") +
      "\n    Update the tree (file renamed/removed?) or fix the path.",
    );
  }
})();

// ── 12. (removed) ──────────────────────────────────────────────────────
// This step ran `validate-tobacco-db.cjs` so a malformed
// src/data/tobacco-db.json could not ship to main. Both the data and the
// validator are gone: the catalogue is now each user's own file, validated by
// `parseCatalogueCsv` at load time and reported to them in Réglages → Données.

// ── 13. Test-count freshness ───────────────────────────────────────────
// The "~N tests across ~M source files" figures in CLAUDE.md (Tech Stack
// table + Key Conventions #5) go stale every few builds — nobody updates a
// hand-maintained approximation. Derive the real counts and WARN (never
// fail — it's an approximate "~" figure) when the documented number has
// drifted past a generous tolerance, so it's a nudge to refresh the line.
// The test-FILE count is the reliable anchor (deterministic); the
// test-CASE count is a static it()/test() grep that necessarily UNDER-counts
// vs Vitest (`.each` / property tests expand at runtime), hence the wider band.
(function () {
  const testFiles = [];
  (function walkTests(dir) {
    fs.readdirSync(dir).forEach(name => {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== "dist") walkTests(full);
      } else if (/\.test\.(ts|tsx|js|jsx)$/.test(name)) {
        testFiles.push(full);
      }
    });
  })(path.join(ROOT, "src"));
  const cases = docChecks.countTestCases(testFiles.map((f) => fs.readFileSync(f, "utf8")));
  docChecks.checkTestCountFreshness(CLAUDE, testFiles.length, cases).warnings.forEach(warn);
})();

// ── 11. Label contracts — truthfulness, not just parity ────────────────
// Gates 1-10 verify that labels EXIST, that every language carries the
// same keys, and that dev fallbacks match `fr` byte-for-byte. None of them
// asks whether a sentence is still TRUE. Six claims had drifted
// (merge description, privacy photos + AI paragraphs, device-name hint,
// diagnostic "repair", two lot hints) — every one a case of code moving
// while prose stood still.
//
// The gate logic lives in scripts/labelContracts.cjs (pure, unit-tested by
// src/__tests__/labelContracts.test.ts); this is the filesystem caller. The
// registry and the full rationale live in scripts/label-contracts.json.
(function checkLabelContracts() {
  const LC = require("./labelContracts.cjs");
  const REG_PATH = path.join(ROOT, "scripts/label-contracts.json");
  if (!fs.existsSync(REG_PATH)) { err("scripts/label-contracts.json is missing — the label-contract gates cannot run."); return; }
  let reg;
  try { reg = JSON.parse(fs.readFileSync(REG_PATH, "utf8")); }
  catch (e) { err("scripts/label-contracts.json is not valid JSON: " + e.message); return; }

  const readFile = (rel) => {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };

  // An empty registry would make both gates vacuously green — the classic
  // way a guard rots into decoration. Fail loudly instead.
  if (!(reg.numeric || []).length) err("label-contracts: the `numeric` list is empty — the numeric gate would pass vacuously.");
  if (!(reg.prose || []).length) err("label-contracts: the `prose` list is empty — the prose gate would pass vacuously.");

  LC.numericContractErrors(reg, readFile).forEach(err);
  // Gate 8 (privacy disclosure) proves every outbound host is DISCLOSED;
  // this proves every one is also COUPLED, so a later behaviour change
  // forces the paragraph to be re-read. Reuses gate 8's own host set.
  LC.domainCoverageErrors(reg, foundDomains, DOMAIN_IGNORE).forEach(err);

  const accept = LC.parseAcceptFlags(process.argv.slice(2));
  const res = LC.proseContractResults(reg, readFile, accept, (id, hash) => {
    console.log(`label-contract "${id}": fingerprint recorded (${hash}).`);
  });
  res.errors.forEach(err);
  if (res.updated) fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + "\n", "utf8");
})();

// ── Report ─────────────────────────────────────────────────────────────
if (warnings.length > 0) {
  console.warn("doc:check — " + warnings.length + " warning(s):");
  warnings.forEach(w => console.warn("  ⚠ " + w));
}
if (errors.length === 0) {
  console.log("doc:check OK — CLAUDE.md is in sync with the code.");
  process.exit(0);
}
console.error("doc:check found " + errors.length + " drift(s):");
errors.forEach(e => console.error("  • " + e));
process.exit(1);
