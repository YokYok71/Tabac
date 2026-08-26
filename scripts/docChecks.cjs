// Pure decision logic for three more doc-check gates:
// the repository-structure tree, the privacy-domain disclosure, and the
// APP_BUILD bump gate.
//
// WHY. Same reason as scripts/i18nChecks.cjs and
// scripts/labelContracts.cjs: doc-check.cjs is the repo's widest safety net and
// had ~15 gates with no tests of its own. These three are the ones whose logic
// is fiddliest and least obvious from reading it:
//   - the tree parser tracks a directory STACK across lines and has to tell a
//     glob from a literal path and a comment continuation from an entry;
//   - the domain gate decides what counts as "disclosed", including a prose
//     mapping ("Anthropic" for api.anthropic.com) — under-disclosing means
//     under-reporting what leaves the user's device;
//   - the bump gate decides what is user-visible, and getting that wrong in
//     either direction is costly (a missed bump ships silently; a false
//     positive teaches people to reach for the skip flag).
//
// Pure: strings in, findings out. doc-check.cjs owns fs/git/reporting.

"use strict";

/**
 * Extract the concrete paths from the fenced tree under a heading in CLAUDE.md.
 *
 * Tree prefixes are 4 characters per depth level ("│   " / "    ") followed by
 * "├── " or "└── "; inline comments start at " #". Directory entries end in "/"
 * and become the parent of deeper lines, which is why a STACK is needed rather
 * than a per-line parse.
 *
 * Returns { paths: [{ rel, isDir }], errors: [string] } — `errors` covers the
 * structural problems (missing heading / fence) so the caller can report them
 * the same way it reports a missing file.
 */
function extractTreePaths(md, heading) {
  const head = heading || "## Repository Structure";
  const out = { paths: [], errors: [] };
  const structIdx = String(md).indexOf(head);
  if (structIdx < 0) {
    out.errors.push(`CLAUDE.md: '${head}' section not found`);
    return out;
  }
  const fenceStart = md.indexOf("```", structIdx);
  const fenceEnd = fenceStart < 0 ? -1 : md.indexOf("```", fenceStart + 3);
  if (fenceStart < 0 || fenceEnd < 0) {
    out.errors.push("CLAUDE.md: repository-structure code fence not found");
    return out;
  }
  const stack = [];
  for (const raw of md.slice(fenceStart + 3, fenceEnd).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line === "/") continue;
    // One indent level is 4 chars: a box-drawing bar (or a space) + 3 spaces —
    // hence the `/ 4` below. Written `{3}` because three literal spaces in a
    // regex are unreadable and miscountable (ESLint no-regex-spaces).
    const branch = line.match(/^((?:[│ ] {3})*)(?:├── |└── )(.*)$/);
    if (!branch) continue; // root line, blank, or stray prose
    const depth = Math.round(branch[1].length / 4);
    let entry = branch[2].split(/\s+#/)[0].trim();
    if (!entry || entry.startsWith("#")) continue; // comment continuation
    const isDir = entry.endsWith("/");
    if (isDir) entry = entry.slice(0, -1);
    stack[depth] = entry;
    stack.length = depth + 1;
    if (/[*{]/.test(entry)) continue; // glob / brace pattern, not a literal path
    out.paths.push({ rel: stack.join("/"), isDir });
  }
  return out;
}

/** Every `https://<host>` literal in a source text. */
function extractDomains(src) {
  const re = /https:\/\/([a-zA-Z0-9.-]+)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(String(src))) !== null) out.add(m[1]);
  return out;
}

/**
 * Is this host disclosed? Verbatim in the policy, or via a mapped prose string
 * (the policy names "Anthropic", not "api.anthropic.com").
 */
function domainDisclosed(host, policyText, evidence) {
  if (String(policyText).includes(host)) return true;
  const ev = evidence && Object.prototype.hasOwnProperty.call(evidence, host)
    ? evidence[host]
    : null;
  return !!(ev && ev.some((s) => String(policyText).includes(s)));
}

/**
 * Hosts a source tree contacts that the policy does not disclose.
 * `ignore` holds placeholders and user-tapped links (never app-driven flows).
 */
function findUndisclosedDomains(hosts, policyText, { ignore, evidence } = {}) {
  const ig = ignore instanceof Set ? ignore : new Set(ignore || []);
  return Array.from(hosts)
    .filter((h) => !ig.has(h))
    .filter((h) => !domainDisclosed(h, policyText, evidence))
    .sort();
}

/**
 * Which of these changed files are user-visible — i.e. shipping them without an
 * APP_BUILD bump means the version shown in Settings lies about what is
 * running.
 *
 * NEVER-visible WINS over visible, and that precedence is the whole subtlety:
 * `src/utils/foo.test.ts` matches `^src\/utils\//` but is a test, and
 * `src/__tests__/` sits under `src/`. Getting it backwards would fail every
 * test-only commit and teach people to reach for DOC_CHECK_SKIP_BUMP, which
 * costs more than the gate is worth.
 */
function findUserVisibleChanges(files, visible, never) {
  const vis = visible || [];
  const nev = never || [];
  return (files || []).filter(
    (f) => !nev.some((re) => re.test(f)) && vis.some((re) => re.test(f)),
  );
}

/**
 * May the caller skip the bump guard?
 *
 * WHY THIS IS A MECHANISM AND NOT A SENTENCE. The rule "use the escape hatch
 * ONLY when the batch is genuinely runtime-neutral" was written in CLAUDE.md
 * and then broken TWICE in one session, both times the same way: the gate
 * printed the offending files, the failure message offered the hatch on the
 * very next line, and the hatch was taken WITHOUT the diff ever being opened.
 * Two things made that easy, and both are addressed here rather than in prose.
 *
 *  (a) NOTHING ENFORCES THE GUARD. Both workflows set DOC_CHECK_SKIP_BUMP=1
 *      unconditionally — legitimately, for a DIFFERENT reason: on a branch that
 *      has not bumped, comparing against the last bump commit is meaningless,
 *      and CI clones are shallow. So the guard is enforced by a human running
 *      it locally, and by nothing else. `=1` is therefore accepted only when
 *      `CI` is set; a human must say more than "1".
 *
 *  (b) THE HATCH COST NOTHING TO REACH FOR. It now costs reading the list:
 *      the caller must NAME the files, and the names must match the computed
 *      set EXACTLY. You cannot produce that list without having looked at the
 *      one the gate just printed, which is precisely the step that was skipped.
 *      It is not a correctness check — it cannot know whether a diff is really
 *      runtime-neutral — it is an ACKNOWLEDGEMENT, the same shape as
 *      `// scope-ok:` and `// lang-axis-ok:`.
 *
 * An EMPTY offender set short-circuits to skip with no complaint: there is
 * nothing to guard, so failing over a stale or redundant flag would be the
 * over-strict mistake this repo keeps recording.
 *
 * @param {object} opts
 * @param {string|undefined} opts.raw        DOC_CHECK_SKIP_BUMP, verbatim.
 * @param {boolean} opts.isCI                Whether this is an automated run.
 * @param {string[]} opts.offenders          User-visible files the gate found.
 * @returns {{skip: boolean, error: string|null}}
 */
function resolveBumpSkip(opts) {
  const o = opts || {};
  const raw = String(o.raw == null ? "" : o.raw).trim();
  const offenders = Array.isArray(o.offenders) ? o.offenders.filter(Boolean) : [];

  if (!raw) return { skip: false, error: null };
  // Nothing accumulated — the flag is inert, whatever it says.
  if (offenders.length === 0) return { skip: true, error: null };
  if (raw === "1") {
    if (o.isCI) return { skip: true, error: null };
    return {
      skip: false,
      error:
        "DOC_CHECK_SKIP_BUMP=1 is refused outside CI. This guard is enforced " +
        "nowhere else — both workflows skip it — so locally it is the only " +
        "thing between a user-visible change and a build number that never " +
        "moves (checkVersion never fires, and the dictionaries ship in " +
        "content-hashed chunks, so nobody receives the change).\n" +
        "    To take it, DIFF each file below and then name them:\n" +
        "      DOC_CHECK_SKIP_BUMP='" + offenders.join(",") + "' npm run doc:check\n" +
        "    Naming them is the point. It is an acknowledgement that you read " +
        "the list, not a claim that the batch is neutral — that judgement is " +
        "still yours, and the honest default is to bump.",
    };
  }

  const listed = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const want = new Set(offenders);
  const got = new Set(listed);
  const missing = offenders.filter((f) => !got.has(f));
  const extra = listed.filter((f) => !want.has(f));
  if (missing.length === 0 && extra.length === 0) return { skip: true, error: null };

  const parts = [];
  if (missing.length) parts.push("not acknowledged: " + missing.join(", "));
  if (extra.length) parts.push("named but not flagged: " + extra.join(", "));
  return {
    skip: false,
    error:
      "DOC_CHECK_SKIP_BUMP does not match the files the guard flagged (" +
      parts.join("; ") + ").\n" +
      "    The list must be exactly:\n" +
      "      DOC_CHECK_SKIP_BUMP='" + offenders.join(",") + "'\n" +
      "    A stale list means the diff moved since you read it — re-read it.",
  };
}


// ── Version / changelog cross-checks (gate 1) ───────────────────────────────
/**
 * The four version numbers must agree, and the changelog must not overshoot.
 * Takes the raw texts so it can be exercised without touching disk.
 *
 * The changelog rule is deliberately ASYMMETRIC: an entry may LAG behind
 * APP_BUILD (a fix-only bump must not be forced to invent a changelog entry —
 * CLAUDE.md forbids logging simple bug fixes, so requiring one per bump would
 * manufacture noise) but may never EXCEED it (no time travel). The tag's
 * "vX.Y · " prefix is optional because build numbers reset each minor version.
 */
function checkVersions({ constants, versionJson, packageJson, changelog }) {
  const out = [];
  const v = String(constants).match(/APP_VERSION\s*=\s*"([^"]+)"/);
  const b = String(constants).match(/APP_BUILD\s*=\s*"([^"]+)"/);
  if (!v || !b) return ["Could not parse APP_VERSION / APP_BUILD from constants.ts"];
  const version = v[1], build = b[1];
  if (versionJson.version !== version) {
    out.push(`version.json.version (${versionJson.version}) !== APP_VERSION (${version})`);
  }
  if (versionJson.build !== build) {
    out.push(`version.json.build (${versionJson.build}) !== APP_BUILD (${build})`);
  }
  // The GENERATION is the epoch that lets the version be renumbered
  // DOWNWARD one day; `isRemoteNewer` compares it before version and build. A
  // version.json whose generation disagrees with the bundle's would either
  // never offer an update or offer one on every poll, so the two are pinned
  // together here — the same place every other version-vs-version.json
  // disagreement is caught, at the moment someone bumps a build.
  const g = String(constants).match(/APP_GENERATION\s*=\s*(\d+)/);
  if (!g) {
    out.push("Could not parse APP_GENERATION from constants.ts");
  } else if (Number(versionJson.generation) !== Number(g[1])) {
    out.push(`version.json.generation (${versionJson.generation}) !== APP_GENERATION (${g[1]})`);
  }
  if (packageJson.version !== version + ".0" && packageJson.version !== version) {
    out.push(`package.json.version (${packageJson.version}) is not aligned with APP_VERSION (${version})`);
  }
  const cl = String(changelog).match(/<h2><span class="tag">(?:v[\d.]+ · )?Build (\d+)<\/span>/);
  if (!cl) {
    out.push('Could not find latest changelog <h2><span class="tag">[vX.Y · ]Build N</span>');
  } else if (parseInt(cl[1], 10) > parseInt(build, 10)) {
    out.push(`changelog.html latest entry is Build ${cl[1]} but APP_BUILD is ${build} — entries can lag behind a bump but never overshoot it.`);
  }
  return out;
}

// ── help.html anchors (gate 5) ──────────────────────────────────────────────
/**
 * Every section anchor must exist, be an <h2>, carry text, and live INSIDE its
 * language wrapper. That last one is the interesting check: a malformed tag
 * earlier in the file auto-closes `<div id="sec-fr">`, which ejects every later
 * h2 to body level — the in-app HelpView then renders those sections as empty,
 * title-less cards. That is the real bug this gate was written for.
 *
 * `doc` is any DOM Document (jsdom in doc-check, jsdom in the tests).
 * fr + en are mandatory; a language with no wrapper is simply not translated
 * yet and is skipped rather than reported.
 */
function checkHelpAnchors(doc, sectionIds) {
  const out = [];
  const codes = [...new Set((sectionIds || []).flatMap((s) => Object.keys(s.ids)))];
  const roots = Object.create(null);
  for (const code of codes) roots[code] = doc.getElementById("sec-" + code);
  if (!roots.fr) out.push('help.html: <div id="sec-fr"> wrapper is missing');
  if (!roots.en) out.push('help.html: <div id="sec-en"> wrapper is missing');
  for (const { ids } of sectionIds || []) {
    for (const code of Object.keys(ids)) {
      const root = roots[code];
      if (!root) continue; // language not on the page → not translated yet
      const id = ids[code];
      const h2 = doc.getElementById(id);
      if (!h2) out.push(`help.html: ${code} h2 id="${id}" is missing`);
      else if (h2.tagName !== "H2") out.push(`help.html: id="${id}" exists but is a <${h2.tagName}>, expected <h2>`);
      else if (!(h2.textContent || "").trim()) out.push(`help.html: ${code} h2 id="${id}" has no text`);
      else if (!root.contains(h2)) {
        out.push(`help.html: ${code} h2 id="${id}" landed outside <div id="sec-${code}"> — a malformed tag auto-closed the wrapper; the in-app HelpView would render this section as an empty title-less card.`);
      }
    }
  }
  return out;
}

// ── Dev-fallback parity (gate b.2) ──────────────────────────────────────────
/**
 * `t ? t("key") : "literal"` — the literal never renders in production (t is
 * always present), but a drifted one is misleading and WOULD show wrong text in
 * a t-less render path or test. Each must equal fr[key].
 *
 * Compares the RAW (escaped) forms, which is exactly how the dictionary parser
 * stores values — apples to apples. A key absent from the reference is left to
 * the key-existence gate.
 */
function findFallbackMismatches(fileText, refMap, label) {
  const re = /\bt\(\s*"([A-Za-z0-9_]+)"\s*\)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(String(fileText))) !== null) {
    const k = m[1], lit = m[2];
    if (!(k in refMap)) continue;
    if (refMap[k] !== lit) {
      out.push({
        key: k, literal: lit, ref: refMap[k],
        message: `${label || "file"}: t("${k}") fallback ${JSON.stringify(lit)} ≠ fr ${JSON.stringify(refMap[k])}`,
      });
    }
  }
  return out;
}


// ── Changelog per-entry language parity (gate 25) ───────────────────────────
/**
 * CLAUDE.md has said since the changelog gained its second language that
 * "every entry must appear in ALL language sections", and NOTHING checked it.
 * Gate 1 reads the latest build number out of the FRENCH section only, so a
 * missing, duplicated or extra entry in any other language was invisible.
 *
 * The gap is not hypothetical: while writing one release's entries I inserted
 * a DUPLICATE Portuguese block, ran the full gate set, and everything passed —
 * it was caught by reading the file, which is exactly the way that does not
 * scale. A duplicate is the more embarrassing half: the changelog is the one
 * document a user reads to find out what changed, and it silently told
 * Portuguese readers the same thing twice.
 *
 * Checks BOTH directions per build number, which matters because they fail
 * differently: a MISSING entry means a language never learns about a change,
 * and an EXTRA one means the section disagrees with itself. Counting also
 * catches the duplicate, which a presence test cannot.
 *
 * Scoped to the CURRENT version, like gate 12: older sections are frozen
 * history, and several predate the sixth language, so demanding parity there
 * would fail permanently on entries nobody should retro-translate.
 *
 * The reference is the language with the MOST entries rather than a fixed one:
 * keying on French would report five "missing" lines for one French-only
 * mistake, pointing every reader at the wrong five files.
 */
function checkChangelogLanguageParity(changelogHtml, version, langs) {
  const errors = [];
  const src = String(changelogHtml || "");
  const codes = (langs || []).filter(Boolean);
  if (!codes.length) return ["changelog parity: no languages supplied — the gate would pass vacuously"];

  // Slice each <div id="sec-XX"> block. Sections are siblings, so a section
  // runs to the start of the next one (or end of file for the last).
  const starts = [];
  const re = /<div id="sec-([a-z]{2,3})"/g;
  let m;
  while ((m = re.exec(src)) !== null) starts.push({ code: m[1], at: m.index });
  if (!starts.length) return ["changelog parity: no <div id=\"sec-XX\"> sections found — the gate cannot see the file"];

  const tag = `v${version} · Build `;
  const perLang = new Map();
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    const block = src.slice(s.at, end);
    const builds = [];
    const er = /<h2><span class="tag">([^<]*)<\/span>/g;
    let e;
    while ((e = er.exec(block)) !== null) {
      const label = e[1].trim();
      if (label.startsWith(tag)) builds.push(label.slice(tag.length).trim());
    }
    perLang.set(s.code, builds);
  });

  for (const code of codes) {
    if (!perLang.has(code)) errors.push(`changelog has no <div id="sec-${code}"> section`);
  }

  // DUPLICATES are reported first and on their own terms. A build listed twice
  // in one section is a defect whatever the other sections say, and folding it
  // into the parity comparison produced the worse message: the duplicated
  // section became the "richest" and therefore the reference, so one mistake in
  // Portuguese was reported as five lines blaming every other language for
  // having a single copy.
  const dupes = new Set();
  for (const code of codes) {
    const got = perLang.get(code);
    if (!got) continue;
    for (const b of new Set(got)) {
      const n = got.filter((x) => x === b).length;
      if (n > 1) {
        dupes.add(b);
        errors.push(`changelog Build ${b}: appears ${n}x in the "${code}" section — one entry per language, no duplicates.`);
      }
    }
  }

  // Reference = the section with the most DISTINCT entries, so a duplicate
  // cannot promote a section to reference. Not a fixed language: keying on
  // French would report five "missing" lines for one French-only mistake and
  // point every reader at the wrong five files.
  const distinct = (code) => new Set(perLang.get(code) || []);
  let ref = null;
  for (const code of codes) {
    if (!perLang.has(code)) continue;
    if (!ref || distinct(code).size > distinct(ref).size) ref = code;
  }
  if (!ref) return errors;

  for (const code of codes) {
    if (!perLang.has(code) || code === ref) continue;
    for (const b of distinct(ref)) {
      if (dupes.has(b)) continue;                 // already reported, once
      if (!distinct(code).has(b)) {
        errors.push(`changelog Build ${b}: present in "${ref}" but MISSING from "${code}" — every entry must appear in every language section.`);
      }
    }
    for (const b of distinct(code)) {
      if (!distinct(ref).has(b)) {
        errors.push(`changelog Build ${b}: present in "${code}" but absent from "${ref}" — an entry no other language carries.`);
      }
    }
  }
  return errors;
}

// ── Changelog content: functional only (gate 12) ────────────────────────────
/**
 * CLAUDE.md has always said the changelog carries "features and important
 * changes only — never simple bug fixes", and doc:check has always checked the
 * changelog's build NUMBER and never its CONTENT. So the rule was the last
 * significant convention in the repo enforced purely by prose, and it decayed
 * exactly the way `prune`'s "zero warnings" baseline did: 15 of the 25 entries in the current version's section were display polish,
 * internal refactors or plain fixes — including five consecutive entries
 * narrating the same photo-frame decision being made and unmade.
 *
 * Two signals, deliberately at different severities, because they differ in how
 * certain they are:
 *
 *   FAIL  — the entry's own <h3> announces it as a fix ("Correction", "Fix",
 *           "Corrección", "Behoben", "Correzione"). There is no judgement to
 *           make: the rule names bug fixes as the thing to exclude, and the
 *           entry has already classified itself. Six of the fifteen removed
 *           when this gate shipped were literally sub-titled "Correction".
 *
 *   WARN  — the entry's prose is dense in DISPLAY or IMPLEMENTATION vocabulary
 *           (contrast, padding, chunk, bundle, refactor…). This is a judgement
 *           call, so it must not fail: a genuine feature can legitimately talk
 *           about colour (the theme picker does). It needs TWO distinct terms
 *           to fire, so one incidental mention is not enough, and it reports
 *           rather than blocks — an over-strict guard gets correct prose
 *           deleted, which this repo has already done once.
 *
 * Scoped to the CURRENT version's entries only. Older sections are frozen
 * history; re-litigating them would produce noise nobody can act on.
 */
const FIX_HEADINGS = [
  "correction", "corrections", "correctif", "correctifs",
  "fix", "fixes", "bugfix", "bug fix", "bug fixes",
  "corrección", "correcciones",
  "behoben", "fehlerbehebung", "fehlerbehebungen",
  "correzione", "correzioni",
];

// Words a user has no concept of (implementation) or cannot act on (pure
// display). Kept narrow on purpose — every term here is one whose presence in
// user-facing copy is genuinely suspicious.
const NON_FUNCTIONAL_TERMS = [
  // display / cosmetic
  "contraste", "contrast", "kontrast", "contrasto",
  "lisibilité", "readability", "lesbarkeit", "leggibilità", "legibilidad",
  "pixel", "opacité", "opacity", "opazität", "opacidad", "opacità",
  "cadre", "liseré", "bordure", "border", "rahmen", "cornice",
  "police de caractères", "font size", "taille de texte",
  "alignement", "alignment", "ausrichtung", "allineamento", "alineación",
  "seuil aa", "wcag",
  // implementation
  "refactor", "chunk", "bundle", "gzip", "lint", "eslint", "typecheck",
  "kilo-octet", "ko de moins", "module", "cache-buster",
  "test unitaire", "unit test", "régression interne",
];

/**
 * @param {string} changelogHtml  public/changelog.html
 * @param {string} version        APP_VERSION, e.g. "1.5"
 * @returns {{errors: string[], warnings: string[]}}
 */
function checkChangelogIsFunctional(changelogHtml, version) {
  const errors = [], warnings = [];
  const src = String(changelogHtml || "");
  const tag = `v${version} · Build `;
  // One entry = an <h2> and everything up to the next <h2> (or the section end).
  const re = /<h2><span class="tag">([^<]*)<\/span>([\s\S]*?)(?=<h2>|<\/div>|$)/g;
  const seenFail = new Set(), seenWarn = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const label = m[1].trim();
    if (!label.startsWith(tag)) continue;          // current version only
    const build = label.slice(tag.length).trim();
    const body = m[2];

    for (const h of body.match(/<h3>([^<]*)<\/h3>/g) || []) {
      const txt = h.replace(/<\/?h3>/g, "").trim().toLowerCase();
      if (FIX_HEADINGS.includes(txt) && !seenFail.has(build)) {
        seenFail.add(build);
        errors.push(
          `changelog Build ${build}: the entry is sub-titled "${h.replace(/<\/?h3>/g, "").trim()}" — ` +
          "the changelog carries features and behaviour changes only, never bug fixes. " +
          "Delete the entry in EVERY language section; an entry may lag behind APP_BUILD, " +
          "so a fix-only build needs no entry at all.");
      }
    }

    const plain = body.replace(/<[^>]+>/g, " ").toLowerCase();
    // "Two DISTINCT terms" has to mean two distinct WORDS. Several entries in
    // the list are substrings of others across languages ("contrast" inside the
    // Spanish "contraste", "opacity" inside nothing but "border" inside…), so a
    // single word could satisfy the two-term threshold on its own and warn
    // about copy that mentioned one thing once. Caught by the gate firing on
    // its own release's entry, where the Spanish "el contraste con la IA" — a
    // cross-CHECK, not a colour ratio — matched both "contraste" and
    // "contrast". Drop any hit that is a substring of another hit.
    const raw = NON_FUNCTIONAL_TERMS.filter((w) => plain.includes(w));
    const hits = raw.filter((w) => !raw.some((o) => o !== w && o.includes(w)));
    if (hits.length >= 2 && !seenWarn.has(build)) {
      seenWarn.add(build);
      warnings.push(
        `changelog Build ${build}: reads like display or implementation work (${hits.slice(0, 4).join(", ")}) — ` +
        "is this something a user would notice AND act on? If not, delete the entry in every language.");
    }
  }
  return { errors, warnings };
}


// ── Per-language locale data is complete (gate 13) ──────────────────────────
/**
 * The DICTIONARY is additive — drop `src/i18n/<code>.ts` and the
 * glob finds it. An audit that actually added a sixth language found six OTHER
 * sites hardcoding the five current codes, every one of them falling back
 * SILENTLY: a Portuguese user got French number formatting, French place names
 * from Nominatim, English months and weekday initials, and AI descriptions in
 * English — with typecheck, lint, doc:check and 3569 of 3571 tests green.
 *
 * Those maps are now one `LANG_ASSETS` row per language. This gate is the other
 * half: a dictionary with no row, or a row missing a field, FAILS. The point is
 * not that the data is hard to write — it is five short values — but that
 * forgetting it produced no signal at all, and a half-translated app reads as
 * unfinished rather than broken.
 *
 * Parsed rather than imported because doc-check.cjs is CommonJS and the module
 * is TypeScript ESM. The shape it expects is the one the file already has:
 * `code: { field: …, … },` inside `export var LANG_ASSETS = { … };`.
 */
const LANG_ASSET_FIELDS = ["numberLocale", "nominatim", "monthsShort", "dayInitials", "aiPromptName"];

/**
 * @param {string} languagesTs   src/i18n/languages.ts
 * @param {string[]} dictCodes   codes discovered from src/i18n/<code>.ts
 * @returns {string[]} errors
 */
function checkLangAssets(languagesTs, dictCodes) {
  const out = [];
  const src = String(languagesTs || "");
  const open = src.indexOf("LANG_ASSETS");
  if (open === -1) {
    out.push("src/i18n/languages.ts: LANG_ASSETS not found — gate 13 cannot verify per-language locale data.");
    return out;
  }
  const body = src.slice(open);
  const rows = Object.create(null);
  // Each row: `<code>: { … },` at one indent level inside the object literal.
  const re = /\n\s{2}([a-z]{2,3}):\s*\{([\s\S]*?)\n\s{2}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) rows[m[1]] = m[2];

  for (const code of dictCodes) {
    const row = rows[code];
    if (!row) {
      out.push(
        `src/i18n/languages.ts: no LANG_ASSETS row for "${code}" — that language would silently fall back to ` +
        "English months/weekdays and the English number locale, and the AI would write its descriptions in English. " +
        "Add a row (numberLocale, nominatim, monthsShort, dayInitials, aiPromptName).");
      continue;
    }
    const missing = LANG_ASSET_FIELDS.filter((f) => !new RegExp(`\\b${f}\\s*:`).test(row));
    if (missing.length) {
      out.push(`src/i18n/languages.ts: LANG_ASSETS["${code}"] is missing ${missing.join(", ")}.`);
    }
    const months = /monthsShort:\s*\[([^\]]*)\]/.exec(row);
    if (months && (months[1].match(/"/g) || []).length !== 24) {
      out.push(`src/i18n/languages.ts: LANG_ASSETS["${code}"].monthsShort must hold exactly 12 names.`);
    }
    const days = /dayInitials:\s*\[([^\]]*)\]/.exec(row);
    if (days && (days[1].match(/"/g) || []).length !== 14) {
      out.push(`src/i18n/languages.ts: LANG_ASSETS["${code}"].dayInitials must hold exactly 7 entries (Monday first; the odd slots are empty strings).`);
    }
  }
  // A row for a language with no dictionary is stale bookkeeping.
  for (const code of Object.keys(rows)) {
    if (!dictCodes.includes(code)) {
      out.push(`src/i18n/languages.ts: LANG_ASSETS has a row for "${code}" but there is no src/i18n/${code}.ts.`);
    }
  }
  return out;
}


// ── Enum labels exist for every language (gate 14) ──────────────────────────
/**
 * Companion to gate 13, and the last silent fallback in the "add a language"
 * path. Enum VALUES (category, cut, shape, materials, finish, accessory type,
 * fuel) are STORED canonical French and localised at render by `xl()`, which
 * reads `ENUM_TRANSLATIONS`. A language absent from those rows silently gets
 * the stored French — measured with a trial Portuguese dictionary: **130 enum
 * values rendered in French** across cards, fiches, filters and chart
 * aria-labels, with every gate green.
 *
 * The checklist has always listed this step; nothing enforced it. Parsed from
 * source for the same reason as gate 13 (CommonJS reading TypeScript ESM).
 */
function checkEnumTranslations(constantsTs, dictCodes) {
  const out = [];
  const src = String(constantsTs || "");
  const open = src.indexOf("ENUM_TRANSLATIONS");
  if (open === -1) {
    out.push("src/constants.ts: ENUM_TRANSLATIONS not found — gate 14 cannot verify enum labels.");
    return out;
  }
  const end = src.indexOf("]);", open);
  const body = src.slice(open, end === -1 ? undefined : end);
  const rows = [...body.matchAll(/\[\s*([A-Z_0-9]+_EN)\s*,\s*\{([^}]*)\}\s*\]/g)];
  if (!rows.length) {
    out.push("src/constants.ts: ENUM_TRANSLATIONS has no parseable rows — gate 14 cannot verify enum labels.");
    return out;
  }
  // `fr` is the canonical stored form and is deliberately absent from the rows
  // (xl returns the value unchanged), so it is never required here.
  const needed = dictCodes.filter((c) => c !== "fr");
  for (const [, mapName, row] of rows) {
    const missing = needed.filter((c) => !new RegExp(`\\b${c}\\s*:`).test(row));
    if (missing.length) {
      out.push(
        `src/constants.ts: ENUM_TRANSLATIONS row for ${mapName} has no ${missing.join(", ")} entry — ` +
        "those readers would see the stored FRENCH enum value on every card, fiche, filter chip and chart label. " +
        `Add the _${missing[0].toUpperCase()} map and the row entry.`);
    }
  }
  return out;
}

// ── Enum maps COVER their values (gate 16) ──────────────────────────────────
/**
 * Gate 14 verifies the ENUM_TRANSLATIONS ROW names a language. It does not
 * verify the map behind that name contains anything — and an `_XX` override map
 * is deliberately SPARSE (it lists only the values that differ), so an EMPTY one
 * is indistinguishable from a complete one by row inspection alone.
 *
 * MEASURED: wiring a trial seventh language with ten `= {}` maps left gate 14
 * reporting nothing and the whole of doc:check green, while every category, cut,
 * shape, bend, filter, material, finish, accessory type and fuel would render in
 * stored FRENCH on every card, fiche, filter chip and chart aria-label. That is
 * the same silent-fallback class gates 13-15 exist for, one level deeper.
 *
 * THE RULE — and why it needs no per-value judgement. The EN map is the honest
 * oracle: pipe jargon (Flake, Billiard, Latakia, Meerschaum, Cumberland) is
 * language-neutral and English leaves it alone, so a value ABSENT from the EN
 * map is absent by design and no language needs it. A value English had to
 * TRANSLATE (`Anglais` -> `English`, `Bruyère` -> `Briar`) is by definition not
 * neutral, so every other language needs it too or it renders as French. An
 * identity override in EN (`Bruyère: "Bruyère"`) is an explicit "this word
 * travels" and is skipped for the same reason.
 *
 * So the check is: for each ENUM_TRANSLATIONS row, every value the EN map maps
 * to something DIFFERENT must appear in each other language's map.
 */
function parseEnumMap(src, name) {
  const re = new RegExp("export var " + name + "\\s*:[^=]*=\\s*\\{([\\s\\S]*?)\\};", "m");
  const m = src.match(re);
  if (!m) return null;
  const out = Object.create(null);
  const kv = /(?:"((?:[^"\\]|\\.)*)"|([A-Za-zÀ-ÿ0-9_]+))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let k;
  while ((k = kv.exec(m[1]))) out[k[1] !== undefined ? k[1] : k[2]] = k[3];
  return out;
}
function checkEnumCoverage(constantsTs, dictCodes) {
  const out = [];
  const src = String(constantsTs || "");
  const open = src.indexOf("ENUM_TRANSLATIONS");
  if (open === -1) return out; // gate 14 already reports this
  const end = src.indexOf("]);", open);
  const body = src.slice(open, end === -1 ? undefined : end);
  const rows = [...body.matchAll(/\[\s*([A-Z_0-9]+)_EN\s*,\s*\{([^}]*)\}\s*\]/g)];
  const needed = dictCodes.filter((c) => c !== "fr" && c !== "en");
  for (const [, base] of rows) {
    const en = parseEnumMap(src, base + "_EN");
    if (!en) {
      out.push(`src/constants.ts: ${base}_EN not parseable — gate 16 cannot verify enum coverage.`);
      continue;
    }
    // Only values EN actually TRANSLATED are language-bearing (see above).
    const bearing = Object.keys(en).filter((v) => en[v] !== v);
    if (!bearing.length) continue;
    for (const code of needed) {
      const name = base + "_" + code.toUpperCase();
      const map = parseEnumMap(src, name);
      if (!map) {
        out.push(`src/constants.ts: ${name} not found — ${code} readers would see the stored FRENCH value for every ${base} value.`);
        continue;
      }
      const missing = bearing.filter((v) => !(v in map));
      if (missing.length) {
        out.push(
          `src/constants.ts: ${name} is missing ${missing.length} value(s) that EN had to translate ` +
          `(${missing.slice(0, 4).map((v) => JSON.stringify(v)).join(", ")}${missing.length > 4 ? ", …" : ""}) — ` +
          `${code} readers see the stored FRENCH on every card, fiche, filter chip and chart label.`);
      }
    }
  }
  return out;
}

// ── Every per-language MAP covers every language (gate 15) ──────────────────
/**
 * The generalisation of gates 13 and 14, and the reason it exists: each of
 * those gates guards ONE known map. Adding Portuguese found three
 * more per-language axes that no gate enumerated — `geo.ts`'s 79-row country
 * table, `HelpView.SECTION_IDS`, and `doc-check.cjs`'s own `HELP_SECTION_IDS`
 * — plus a test file that hardcoded the five codes. Every one failed the same
 * way: SILENTLY, with the sixth language reading English and nothing red.
 *
 * So this gate looks for the SHAPE rather than for named maps. Any flat object
 * literal in production source whose keys already include two or more registry
 * codes is a per-language axis, and it must include them all. Two is the
 * threshold on purpose: a `{ fr, en }` pair left behind by an older release is
 * exactly the dangerous case, while a single-code literal is usually a default
 * or a static import (`LANG = { en: EN }` in i18n.ts, which must NOT be
 * flagged and is the reason the threshold is not one).
 *
 * DELIBERATE SUBSETS get an acknowledgement, not an exception list: put
 * `// lang-axis-ok: <reason>` on the literal's own line, in the comment block
 * above it, or in the comment block above the DECLARATION containing it —
 * that last scope is what lets one line cover a table of rows (the ten
 * ENUM_TRANSLATIONS rows are ten literals inside one statement). It mirrors
 * the `scope-ok` idiom no-unscoped-lot-read established: force a conscious
 * re-read, because an unexplained exception invites the next sweep to
 * "complete" it and reintroduce the bug.
 *
 * NESTED literals are out of scope (the brace scan is flat), which is why
 * `LANG_ASSETS` still needs gate 13 — one row per language, each a sub-object.
 *
 * @param {{path: string, source: string}[]} files
 * @param {string[]} codes   registry codes (LANGUAGES)
 * @returns {string[]} errors
 */
function ackAbove(lines, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("*/")) return false;
    if (/lang-axis-ok/.test(t)) return true;
  }
  return false;
}

function findLanguageAxisGaps(files, codes) {
  const out = [];
  const known = (codes || []).filter((c) => /^[a-z]{2,3}$/.test(c));
  if (known.length < 2) return out;
  const key = (c) => new RegExp(`(?:^|[{,\\s])["']?${c}["']?\\s*:`);

  for (const { path, source } of files || []) {
    const raw = String(source || "");
    // Comments are BLANKED (length-preserving, so every offset and line number
    // below still points at the real file). A prose example is not data: the
    // agent auditing this gate had its own comment quoting `["es","de","it"]`
    // reported back at it. A false positive here is not benign — it gets
    // correct code rewritten to please the guard, which is the failure mode
    // this whole family of gates is written to avoid.
    const src = blankComments(raw);
    const lines = raw.split("\n");
    // Flat literals only: no nested braces inside, so the span is unambiguous.
    const literals = [
      // lang-axis-ok: an illustration in a comment, not data.
      // { fr: …, en: … } — a keyed map.
      ...[...src.matchAll(/\{[^{}]*\}/g)].map((m) => ({ m, keyed: true })),
      // ["fr", "en", …] — a list of codes, the shape that froze six guards.
      ...[...src.matchAll(/\[[^[\]]*\]/g)].map((m) => ({ m, keyed: false })),
    ];
    for (const { m, keyed } of literals) {
      const lit = m[0];
      const present = keyed
        ? known.filter((c) => key(c).test(lit))
        // A list must be codes and NOTHING else, or every array holding two
        // short strings would be read as a language axis.
        : (() => {
            const items = lit.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, ""));
            if (!items.length || items.some((x) => !/^[a-z]{2,3}$/.test(x))) return [];
            return known.filter((c) => items.includes(c));
          })();
      if (present.length < 2) continue;
      const missing = known.filter((c) => !present.includes(c));
      if (!missing.length) continue;

      const line = src.slice(0, m.index).split("\n").length;
      // The acknowledgement may sit on any line the literal spans (it can be
      // multi-line) or on the contiguous comment block just above it.
      const last = line + lit.split("\n").length - 1;
      let ack = false;
      for (let i = line - 1; i < last && i < lines.length; i++) {
        if (/lang-axis-ok/.test(lines[i])) ack = true;
      }
      // …or on the comment block above the literal, …
      if (!ack) ack = ackAbove(lines, line - 1);
      // …or on the comment block above the DECLARATION that contains it, which
      // is what lets one acknowledgement cover a table of rows (the ten
      // ENUM_TRANSLATIONS rows are ten separate literals in one statement).
      if (!ack) {
        for (let i = line - 2; i >= 0; i--) {
          const t = lines[i].trim();
          if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
          const decl = /^(?:export\s+)?(?:const|var|let|function|async)\s/.test(t);
          // The enclosing declaration must be an UNCLOSED one. A declaration
          // that finishes on its own line (`const OTHER = 1;`) is a SIBLING,
          // not a container — accepting it would let one acknowledgement leak
          // to every literal further down the file, which is the failure this
          // walk exists to avoid rather than cause.
          if (decl && !t.endsWith(";")) { ack = ackAbove(lines, i); break; }
          if (t.endsWith(";")) break;
        }
      }
      if (ack) continue;

      out.push(
        `${path}:${line}: a per-language map lists ${present.join(", ")} but not ${missing.join(", ")} — ` +
        `those readers fall back silently. Add them, or write "// lang-axis-ok: <reason>" if the subset is deliberate.`);
    }
  }
  return out;
}


/**
 * Gate 17 — the label contracts' language axis.
 *
 * `scripts/label-contracts.json` checks a quoted number against each shipped
 * dictionary by listing one `docs[]` entry per file, `src/i18n/<code>.ts`. That
 * is a per-language axis expressed as file PATHS, which is precisely the shape
 * gate 15 cannot see: it looks for flat literals of language CODES in source,
 * and a JSON array of paths is neither. So a seventh language would simply not
 * be checked by any numeric contract, silently, while doc:check stayed green.
 *
 * Scoped to contracts that ALREADY check at least one dictionary — a contract
 * whose claim lives only in help.html has no dictionary axis to be incomplete
 * about. Coverage was 100% when the gate was written, so it locks a true state
 * rather than reporting a backlog.
 */
function checkContractLanguageCoverage(contracts, dictCodes) {
  const out = [];
  const numeric = (contracts && contracts.numeric) || [];
  const codes = (dictCodes || []).slice();
  for (const entry of numeric) {
    const docs = (entry && entry.docs) || [];
    const covered = [];
    for (const d of docs) {
      const m = /^src\/i18n\/([a-z]{2,3})\.ts$/.exec(String(d && d.file || ""));
      if (m) covered.push(m[1]);
    }
    if (!covered.length) continue; // help-only contract: no dictionary axis
    const missing = codes.filter((c) => !covered.includes(c));
    if (!missing.length) continue;
    out.push(
      `scripts/label-contracts.json: contract "${entry.id}" checks ${covered.join(", ")} ` +
      `but not ${missing.join(", ")} — that language's copy could quote a stale number ` +
      `with nothing to catch it. Add a docs entry per missing dictionary.`);
  }
  return out;
}

/**
 * Gate 18 — a shipped doc page with no block for a language.
 *
 * `extractLangSection` falls back requested -> en -> fr, so a missing
 * `<div id="sec-xx">` is INVISIBLE: the page renders, in another language, and
 * whoever added the language never learns. help.html is already covered by the
 * anchor gate; this covers the other two multilingual pages.
 *
 * Returns one row per file so the caller can grade the response — the cost of
 * authoring a block differs by an order of magnitude between the two pages.
 */
function findMissingDocLangBlocks(docs, dictCodes) {
  const out = [];
  for (const d of docs || []) {
    const src = String(d && d.source || "");
    const missing = (dictCodes || []).filter((c) => !src.includes(`id="sec-${c}"`));
    if (missing.length) out.push({ file: d.file, missing });
  }
  return out;
}

/**
 * Gate 19 — a dictionary that is a copy of English.
 *
 * The identical-value gate compares every language against FRENCH, so a file
 * created by copying `en.ts` differs from the reference nearly everywhere and
 * passes in silence — the app then ships an English UI under another language's
 * name. Deliberately whole-file, not per-key: individual English values are
 * legitimate (jargon, cognates, emoji) and flagging them would drown the real
 * signal. Measured at the time of writing, the highest legitimate overlap with
 * English is 7.3% (fr); the threshold sits far above every real value so the
 * gate can only fire on an actual copy-paste.
 */
function findEnglishCopyDicts(dicts, threshold) {
  const out = [];
  const lim = typeof threshold === "number" ? threshold : 0.5;
  const en = (dicts || {}).en;
  if (!en) return out;
  for (const code of Object.keys(dicts || {})) {
    if (code === "en") continue;
    const d = dicts[code];
    const keys = Object.keys(d || {});
    if (keys.length < 50) continue; // too small to judge
    let same = 0;
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(en, k) && en[k] === d[k]) same++;
    const ratio = same / keys.length;
    if (ratio < lim) continue;
    out.push(
      `src/i18n/${code}.ts: ${(ratio * 100).toFixed(0)}% of values are byte-identical to en.ts — ` +
      `this looks like a copy of the English dictionary, which ships an English UI under the ${code} name.`);
  }
  return out;
}

// ── Internal anchors stay inside their own language block (gate 21) ─────────
/**
 * A `<a href="#en-tobacco">` inside `<div id="sec-pt">` sends a Portuguese
 * reader to the ENGLISH section — or nowhere, since the in-app HelpView slices
 * one language block at a time and the target does not exist in it.
 *
 * Adding Portuguese shipped exactly that: **all 30 internal links of its help
 * block, table of contents included, pointed at `#en-*`.** The translation
 * prompt said to change the `<h2>` id prefixes and said nothing about hrefs, so
 * the anchors were faithfully copied. Nothing could see it — the prose reads
 * perfectly, every id it names exists somewhere in the file, doc:check's anchor
 * gate checks that the h2 ids are present and inside their wrapper, and a human
 * proof-reader follows the words rather than the link targets.
 *
 * Mechanically trivial once stated, which is the argument for the gate: the
 * defect class is "correct-looking text pointing at the wrong place", and
 * reading is the one method guaranteed not to catch it.
 *
 * @param {string} html  a doc page with `<div id="sec-<code>">` blocks
 * @param {string} file  path, for the message
 * @returns {string[]} errors
 */
function checkAnchorLanguage(html, file) {
  const out = [];
  const src = String(html || "");
  const opens = [...src.matchAll(/<div id="sec-([a-z-]+)"/g)].map((m) => ({ code: m[1], at: m.index }));
  if (!opens.length) return out;
  for (let i = 0; i < opens.length; i++) {
    const from = opens[i].at;
    const to = i + 1 < opens.length ? opens[i + 1].at : src.length;
    const seen = new Set();
    for (const a of src.slice(from, to).matchAll(/href="#([a-z]{2,3})-([a-z0-9-]+)"/g)) {
      if (a[1] === opens[i].code || seen.has(a[1])) continue;
      seen.add(a[1]);
      out.push(
        `${file}: the "${opens[i].code}" block links to #${a[1]}-${a[2]} — an anchor in ANOTHER language's ` +
        `section. HelpView renders one block at a time, so that target does not exist for this reader.`);
    }
  }
  return out;
}

/**
 * Gate 22: help.html's enum TABLES must list the real enums.
 *
 * WHY. Each language block of the user guide carries a "Type" row and a "Cut"
 * row enumerating the categories and cuts the entry form offers. They are
 * PROSE — no check has ever read an enum out of them — and they had silently
 * gone stale: `Américain`, `Cigare` and `Virginia/Latakia` were added to the
 * enum and all six lists stayed at fifteen values for thirty releases. Found
 * while editing the row by hand, which is exactly the method this file
 * keeps recording as the one that does not scale.
 *
 * TWO STRENGTHS, on purpose, because the six blocks do NOT follow one
 * convention. Cuts are English jargon everywhere, so every language lists the
 * SAME values and only the trailing "other" word differs — that half is checked
 * for exact equality. Categories are rendered differently per language
 * (`Aromatique` / `Aromatic` / `Aromático`, and a gloss in parentheses for
 * some), so asserting a spelling would be asserting an editorial convention the
 * prose does not follow mechanically; the CARDINALITY is checked instead, plus
 * exact equality for FRENCH, which is the canonical list. Cardinality is what
 * catches the real defect — a value added to the enum and not to the guide.
 *
 * Rows are found by CONTENT, not position: the cut row is the one naming
 * `Broken Flake` and `Ready Rubbed`, the category row the one naming `VaPer`
 * and `Virginia/Burley` — values no language translates, so the anchor holds in
 * all six. Parentheticals are stripped before splitting so a gloss cannot count
 * as an extra item.
 *
 * @param {string} html   public/help.html
 * @param {string[]} cats CATS, canonical order
 * @param {string[]} cuts CUTS, canonical order
 * @returns {string[]} errors
 */
function checkHelpEnumTables(html, cats, cuts) {
  const out = [];
  const src = String(html || "");
  const CATS = cats || [], CUTS = cuts || [];
  if (!CATS.length || !CUTS.length) {
    // Non-vacuity: an unreadable enum would make every check below pass while
    // comparing against nothing — the failure mode the catalogue importer wrote down.
    out.push("help.html enum tables: the CATS/CUTS enums could not be read — the gate would pass vacuously");
    return out;
  }
  const opens = [...src.matchAll(/<div id="sec-([a-z-]+)"/g)].map((m) => ({ code: m[1], at: m.index }));
  if (!opens.length) {
    out.push('help.html: no <div id="sec-…"> language block found — the enum tables cannot be located');
    return out;
  }
  const items = (cell) => String(cell)
    .replace(/\([^)]*\)/g, "")        // drop the "(English)" glosses
    .split(",").map((x) => x.trim()).filter(Boolean);

  for (let i = 0; i < opens.length; i++) {
    const code = opens[i].code;
    const from = opens[i].at;
    const to = i + 1 < opens.length ? opens[i + 1].at : src.length;
    const chunk = src.slice(from, to);
    const cells = [...chunk.matchAll(/<tr><td>[^<]*<\/td><td>([^<]*)<\/td><\/tr>/g)].map((m) => m[1]);

    const cutCell = cells.find((c) => c.includes("Broken Flake") && c.includes("Ready Rubbed"));
    if (!cutCell) {
      out.push(`help.html (${code}): no cut table found — expected a row naming "Broken Flake" and "Ready Rubbed".`);
    } else {
      const got = items(cutCell);
      // Every value but the trailing "Autre", which each language renders in
      // its own word (Other / Otro / Andere / Altro / Outro).
      const want = CUTS.slice(0, -1);
      const head = got.slice(0, want.length);
      if (got.length !== CUTS.length || head.join("|") !== want.join("|")) {
        const missing = want.filter((v) => !got.includes(v));
        out.push(
          `help.html (${code}): the cut table lists ${got.length} values, the CUTS enum has ${CUTS.length}` +
          (missing.length ? ` — missing ${missing.join(", ")}` : " — order or spelling differs") +
          ". Cuts are English jargon, so every language must list the same values.");
      }
    }

    const catCell = cells.find((c) => c.includes("VaPer") && c.includes("Virginia/Burley"));
    if (!catCell) {
      out.push(`help.html (${code}): no category table found — expected a row naming "VaPer" and "Virginia/Burley".`);
      continue;
    }
    const got = items(catCell);
    if (got.length !== CATS.length) {
      out.push(
        `help.html (${code}): the category table lists ${got.length} values, the CATS enum has ${CATS.length}. ` +
        "A family was added to the app and not to the guide.");
    } else if (code === "fr" && got.join("|") !== CATS.join("|")) {
      // French is the canonical list, so here the SPELLING is checkable too.
      const missing = CATS.filter((v) => !got.includes(v));
      out.push(
        "help.html (fr): the category table does not match CATS exactly" +
        (missing.length ? ` — missing ${missing.join(", ")}` : " — order differs") +
        ". The French guide lists the canonical values verbatim.");
    }
  }
  return out;
}

// ═══ The last seven inline gates, extracted ════════════════════════════════
/**
 * An audit of every gate found the remaining third had its DECISION
 * written inline in doc-check.cjs: gates 2, 3, 4, 9, 11 and 26. All of them
 * bite today — that was probed — but nothing protects their LOGIC. The wiring
 * test stops a call site being DELETED; it cannot notice a
 * regex quietly narrowed, a filter inverted, or a tolerance widened until the
 * gate reports nothing.
 *
 * This is the same extraction argument as the earlier gates: strings in,
 * findings out, doc-check.cjs owns fs/git/reporting. The functions are small
 * because the decisions are small — which is exactly why they were left inline
 * for so long, and exactly why an unnoticed edit to one is plausible.
 */

/**
 * Gates 2 and 3 — every module under a directory is named in CLAUDE.md.
 *
 * The check is a bare substring of the BASENAME, deliberately: it asks "does
 * the documentation know this file exists", not "is it described correctly".
 * A stricter form (a path, a heading) would fire on every legitimate way the
 * file is discussed and get itself disabled.
 *
 * @param {string[]} files   file names in the directory (e.g. ["utils.ts"])
 * @param {string} claudeMd
 * @param {string} label     directory shown in the message ("src/utils")
 * @returns {string[]} errors
 */
function findUndocumentedModules(files, claudeMd, label) {
  const doc = String(claudeMd || "");
  return (files || [])
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !doc.includes(f.replace(/\.ts$/, "")))
    .map((f) => `${label}/${f} not mentioned in CLAUDE.md`);
}

/** Every literal localStorage/sessionStorage key a source touches. */
function extractStorageKeys(sources) {
  const re = /localStorage\.(?:getItem|setItem|removeItem)\s*\(\s*["']([^"']+)["']/g;
  const out = new Set();
  for (const src of sources || []) {
    for (const m of String(src || "").matchAll(re)) out.add(m[1]);
  }
  return [...out];
}

/**
 * Gate 4 — a literal storage key must appear in CLAUDE.md's keys table.
 *
 * TEMPLATED keys are skipped (`"cave-autosave-ts-" + provider` reaches this as
 * a fragment): the table documents the FAMILY, and demanding the fragment
 * would force a fake row. That exclusion is why the pattern is anchored on
 * `[a-zA-Z0-9_-]+` and not on "anything between quotes".
 *
 * @returns {string[]} errors
 */
function findUndocumentedStorageKeys(keys, claudeMd) {
  const doc = String(claudeMd || "");
  return (keys || [])
    .filter((k) => /^[a-zA-Z0-9_-]+$/.test(k))
    .filter((k) => !new RegExp("`" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`").test(doc))
    .map((k) => `localStorage key "${k}" used in src/ but not listed in CLAUDE.md keys table`);
}

/** Every key a source passes to t()/tr(), plus the LANG[x]?.key direct form. */
/**
 * Blank every comment, length-preserving (so offsets and line numbers still
 * point at the real file).
 *
 * A PROSE EXAMPLE IS NOT DATA. Gate 15 learned this by reporting its own
 * explanatory comment back at itself; gate 9 learned it the same way one
 * release later, flagging a comment that spelled out `t("prio_" + v)` to say
 * why the code deliberately does NOT do that. A false positive here is not
 * benign — it gets correct code, or correct prose, rewritten to please the
 * guard, which is the failure this whole family of gates exists to avoid.
 *
 * Shared rather than copied: it was written for gate 15 and needed verbatim by
 * gate 9, and two copies of one rule is the drift this repo keeps paying for.
 *
 * IT USES THE REAL PARSER, AND THE HAND-ROLLED VERSION IT REPLACES IS WHY.
 * That one was two regexes — blank `/*…*\/`, blank `//…` — and this repo's own
 * allowlist had already written down what they cost: «  a naive stripper blanks
 * a live `t("ai_scan_btn")` call in AICard.tsx … doing it properly needs a real
 * tokeniser ». It was shipped anyway, and the note was exactly right. The
 * mechanism is one attribute: `accept="image/*"` — a `/*` inside a STRING opens
 * a block comment that runs to the next `*\/`, swallowing ~29 lines of live JSX
 * with it. MEASURED over `src/`: six call sites vanished, five of them
 * legitimately (the key really was only in prose) and one, `ai_scan_btn`, a
 * real call.
 *
 * THE COST IS NOT THE WARN-ONLY GATE 11. Gate 9 — every key a source calls must
 * exist in the reference dictionary — is an ERROR gate riding on the same
 * extraction, so a swallowed region is a region where a mistyped key ships
 * unchecked. A guard that silently stops looking is worse than no guard.
 *
 * TypeScript is already a devDependency (`tsc` is the canonical gate) and
 * `doc-check.cjs` already hard-requires `jsdom`, so this adds no dependency and
 * matches the script's existing shape: if the package is missing it FAILS
 * rather than degrading, because the degradation is precisely the silent
 * half-blindness above.
 *
 * Parsed as TSX unconditionally: MEASURED over all 434 files in `src/`, the
 * single mode loses no call site, so the callers need not thread a filename
 * through. VALIDATED against AST ground truth (a CallExpression cannot be in a
 * comment) — ZERO live calls blanked, and every comment blanked in production
 * source. RESIDUAL, stated rather than discovered later: a `t("…")` written
 * inside a STRING LITERAL is still seen by the caller's regex. That is not a
 * comment, it is only ever a test fixture asserting on source text, and
 * `extractTKeys` excludes tests — closing it would mean extracting from the AST
 * instead of from text, which the line-number-reporting callers cannot use.
 */
let _tsLib;
function tsLib() {
  if (_tsLib === undefined) {
    try {
      _tsLib = require("typescript");
    } catch {
      _tsLib = null;
    }
  }
  return _tsLib;
}

const _blankCache = new Map();

function blankComments(source) {
  const s = String(source || "");
  if (!s) return s;
  const hit = _blankCache.get(s);
  if (hit !== undefined) return hit;

  const ts = tsLib();
  if (!ts) {
    throw new Error(
      "blankComments needs the `typescript` package (a devDependency). Run `npm ci`. " +
        "It is NOT allowed to fall back to a regex: the naive stripper reads `/*` " +
        "inside a string as a comment opener and silently blinds gate 9.",
    );
  }

  const sf = ts.createSourceFile("x.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = s.split("");
  const seen = new Set();
  const blank = (r) => {
    const k = r.pos + ":" + r.end;
    if (seen.has(k)) return;
    seen.add(k);
    for (let i = r.pos; i < r.end; i++) if (out[i] !== "\n") out[i] = " ";
  };
  (function walk(n) {
    const lead = ts.getLeadingCommentRanges(s, n.pos);
    if (lead) lead.forEach(blank);
    const trail = ts.getTrailingCommentRanges(s, n.end);
    if (trail) trail.forEach(blank);
    ts.forEachChild(n, walk);
  })(sf);

  const res = out.join("");
  // Short-lived process; the cap is only so a pathological caller cannot grow
  // this without bound.
  if (_blankCache.size < 2000) _blankCache.set(s, res);
  return res;
}

function extractTKeys(sources) {
  const call = /\bt[rR]?\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  const direct = /\bLANG\b[^?]*?\?\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const out = new Set();
  for (const src of sources || []) {
    // Comments blanked: see `blankComments`. A `t("…")` written in prose to
    // EXPLAIN something is not a call site, and treating it as one made this
    // gate demand a dictionary entry for a key the code never asks for.
    const c = blankComments(src);
    for (const m of c.matchAll(call)) out.add(m[1]);
    for (const m of c.matchAll(direct)) out.add(m[1]);
  }
  return [...out];
}

/**
 * Gate 9 — a key the code CALLS must exist in every dictionary. This is the
 * one that fails loudly at runtime (the raw key renders on screen), so it is
 * an error and not a warning.
 */
function findMissingTKeys(usedKeys, dictKeys, code) {
  const have = new Set(dictKeys || []);
  return (usedKeys || []).filter((k) => !have.has(k))
    .map((k) => `i18n: t("${k}") has no entry in src/i18n/${code}.ts`);
}

/**
 * Gate 11 — a key DEFINED but never called. Warning only, because a key can
 * legitimately be reached through a dynamic prefix; `isDynamic` is the
 * allowlist predicate that keeps the signal usable (~150 false hits without).
 */
function findUnusedTKeys(refKeys, usedKeys, isDynamic) {
  const used = new Set(usedKeys || []);
  const dyn = typeof isDynamic === "function" ? isDynamic : () => false;
  return (refKeys || []).filter((k) => !used.has(k) && !dyn(k));
}

/** Static it()/test() count. UNDER-counts vs Vitest — `.each` expands at run time. */
function countTestCases(sources) {
  const re = /\b(?:it|test)(?:\.\w+)?\s*\(/g;
  let n = 0;
  for (const src of sources || []) n += (String(src || "").match(re) || []).length;
  return n;
}

const TEST_FIGURE_RE = /~?([\d,]+)\s*tests?\s+across\s+~?([\d,]+)\s*source/gi;
const TEST_FILE_TOL = 0.10;   // deterministic count — tight band
const TEST_CASE_TOL = 0.20;   // static grep under-counts — wider band

/**
 * Gate 26 — the "~N tests across ~M source files" figures have drifted.
 *
 * WARN, never fail: they are approximations, and a hard gate on a "~" number
 * would be edited to satisfy the gate rather than to be true. The zero-match
 * branch matters as much as the drift ones — a reworded sentence would
 * otherwise make this gate silently examine nothing, which is the vacuity
 * failure that audit went looking for.
 *
 * @returns {{warnings: string[]}}
 */
function checkTestCountFreshness(claudeMd, fileCount, caseCount) {
  const out = [];
  const num = (x) => parseInt(String(x).replace(/,/g, ""), 10);
  const re = new RegExp(TEST_FIGURE_RE.source, TEST_FIGURE_RE.flags);
  let m, matched = 0;
  while ((m = re.exec(String(claudeMd || ""))) !== null) {
    matched++;
    const docTests = num(m[1]), docFiles = num(m[2]);
    if (docFiles && fileCount && Math.abs(docFiles - fileCount) / fileCount > TEST_FILE_TOL) {
      out.push(`CLAUDE.md test-file figure "~${docFiles}" drifted from the actual ${fileCount} — refresh the "~N tests across ~M source files" line.`);
    }
    if (docTests && caseCount && Math.abs(docTests - caseCount) / caseCount > TEST_CASE_TOL) {
      out.push(`CLAUDE.md test-count figure "~${docTests}" drifted from ~${caseCount} static it()/test() cases (Vitest counts a bit more) — refresh the "~N tests" line.`);
    }
  }
  if (matched === 0) {
    out.push('No "~N tests across ~M source files" figure found in CLAUDE.md to verify — the test-count freshness check was skipped.');
  }
  return { warnings: out };
}

/**
 * GATE 23 — every enum VALUE the app can show must be NAMED in
 * the guide, in the language that shows it.
 *
 * Gate 22 guards two tables (Type, Cut) and, for the five non-French languages,
 * only their CARDINALITY. That leaves two holes, and a sweep of all ten
 * enumerations found both, in quantity:
 *
 *   - Eight enums nobody checked at all. `FINISHES` was the worst: the pipe
 *     form has long offered a Finition field and the guide has
 *     never had a row for it, in any language — not a missing value, a missing
 *     FIELD.
 *   - The label the guide prints drifting from the one the dropdown shows.
 *     The material and fuel lists had been translated BY HAND from the French
 *     table and then diverged from the `_XX` maps: the German guide said
 *     "Flüssigbrennstoff" where the app says "Benzin", the Portuguese said
 *     "Charuto" where it says "Cigarro", four languages kept the French
 *     "Ivoirite" against the app's "Ivorite". Cardinality is blind to all of
 *     it — the count was right every time.
 *
 * WHAT IS CHECKED, and why it is presence rather than a table shape: the
 * translated value must appear SOMEWHERE in that language's block. It does not
 * assert order, count, separator or which row carries it, because those are
 * editorial and vary by language (`·` here, `,` there, a gloss in
 * parentheses) — asserting them would get correct prose rewritten to please
 * the guard, the mistake this file keeps recording. What it does assert is the
 * one thing that is never a matter of taste: a value the user can pick has a
 * name in the guide, and it is the name they will see.
 *
 * SIBLING MASKING — the gate's own KNOWN LIMIT bit, and the
 * value it swallowed was one a recent enum addition had just created. The test is a
 * SUBSTRING, and `CATS_DE` holds BOTH `Aromatisch` and `Englisch-Aromatisch`,
 * so the German guide could print the English gloss `Aromatic` — a label the
 * German dropdown never shows, exactly the class this gate exists for — and
 * still pass, because the compound satisfied the search. MEASURED: the German
 * block contains "Aromatisch" exactly ONCE, inside "Englisch-Aromatisch".
 *
 * The fix is EXACT and self-derived: before searching for a label, blank out
 * every occurrence of a LONGER label of the SAME enum in the same language.
 * No vocabulary, no heuristic — the enum knows which of its own values contain
 * which. Deliberately NOT a word boundary: the comment this paragraph replaces
 * was right that `Gas`, `Os` and `Bois` would then match ordinary prose, which
 * is the over-strict failure that gets correct prose rewritten.
 *
 * The blast radius is why this is a gate change and not a one-line data fix:
 * 74 label pairs across the ten enums are swallowed this way (every language's
 * `Virginia` inside `Virginia/Burley`, every `Flake` inside `Broken Flake`,
 * every `Apple` inside `Bent Apple`, `Gas` inside Spanish `Gasolina`…), so 74
 * values could vanish from the guide with the gate green. Masking reports
 * exactly ONE finding on the real files — the German row above — which is what
 * makes it a strengthening rather than a rewrite.
 *
 * The residual limit stands: a label that drifts by ACCRETION into a word that
 * is not another enum value ("Glatt" -> "Glatt2") still matches.
 *
 * @param {string} html    public/help.html
 * @param {Record<string,string[]>} enums   name -> canonical values
 * @param {Record<string,Record<string,Record<string,string>>>} maps
 *        name -> lang -> {canonical: translated}; a missing entry means the
 *        canonical value is shown as-is (the sparse-map rule).
 * @returns {string[]} errors
 */
function checkHelpEnumLabels(html, enums, maps) {
  const out = [];
  const src = String(html || "");
  const names = Object.keys(enums || {});
  if (!names.length) {
    out.push("help.html enum labels: no enum was supplied — the gate would pass vacuously");
    return out;
  }
  const opens = [...src.matchAll(/<div id="sec-([a-z-]+)"/g)].map((m) => ({ code: m[1], at: m.index }));
  if (!opens.length) {
    out.push('help.html: no <div id="sec-…"> block found — enum labels cannot be located');
    return out;
  }
  for (let i = 0; i < opens.length; i++) {
    const code = opens[i].code;
    const chunk = src.slice(opens[i].at, i + 1 < opens.length ? opens[i + 1].at : src.length);
    for (const n of names) {
      const vals = enums[n] || [];
      if (!vals.length) { out.push(`help.html: the ${n} enum could not be read — the gate would pass vacuously`); continue; }
      const m = (maps && maps[n] && maps[n][code]) || {};
      const labels = vals.map((v) => m[v] || v);
      const missing = vals.filter((v, k) => {
        const me = labels[k];
        // Blank the LONGER siblings that contain this label, so a compound
        // value cannot answer for a value the guide never names. Equal-length
        // labels are skipped: two enum values with the same rendered label are
        // indistinguishable in prose, and masking one would fail the other.
        let hay = chunk;
        for (let j = 0; j < labels.length; j++) {
          const other = labels[j];
          if (j === k || other.length <= me.length || other.indexOf(me) < 0) continue;
          hay = hay.split(other).join(" ".repeat(other.length));
        }
        return hay.indexOf(me) < 0;
      });
      if (missing.length) {
        out.push(`help.html (${code}): ${n} values the guide never names — ` +
          missing.map((v) => m[v] || v).join(", ") +
          ". The user can pick them in the form; add them to the matching table.");
      }
    }
  }
  return out;
}

/**
 * The i18n keys behind the `*_FAMILIES` group headers in src/constants.ts.
 *
 * Two shapes, and the second is the reason this is a parse and not a list:
 * most tables carry the key in a `labelKey: "…"` field, but SHAPE_FAMILIES
 * does not store one at all — the views BUILD it (`"shape_family_" + f.key`),
 * so a reader of constants.ts sees no i18n key there to check. Both are
 * collected here so gate 24 covers the table where it is least visible.
 *
 * Returns a sorted, de-duplicated list. An empty result means the parse
 * degraded and the CALLER must fail rather than pass vacuously.
 */
function extractGroupLabelKeys(constantsSource) {
  const src = String(constantsSource || "");
  const keys = new Set();
  for (const m of src.matchAll(/labelKey:\s*"([a-z0-9_]+)"/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\{\s*key:\s*"([a-z0-9_]+)",\s*shapes:/g)) {
    keys.add("shape_family_" + m[1]);
  }
  return [...keys].sort();
}

module.exports = {
  checkHelpEnumTables,
  checkHelpEnumLabels,
  checkVersions,
  checkContractLanguageCoverage,
  findMissingDocLangBlocks,
  findEnglishCopyDicts,
  checkHelpAnchors,
  findFallbackMismatches,
  extractTreePaths,
  extractDomains,
  domainDisclosed,
  findUndisclosedDomains,
  findUserVisibleChanges,
  resolveBumpSkip,
  checkChangelogIsFunctional,
  checkChangelogLanguageParity,
  checkLangAssets,
  checkEnumTranslations,
  checkEnumCoverage,
  checkAnchorLanguage,
  findUndocumentedModules,
  extractStorageKeys,
  findUndocumentedStorageKeys,
  blankComments,
  extractTKeys,
  findMissingTKeys,
  findUnusedTKeys,
  countTestCases,
  checkTestCountFreshness,
  findLanguageAxisGaps,
  extractGroupLabelKeys,
  LANG_ASSET_FIELDS,
  FIX_HEADINGS,
  NON_FUNCTIONAL_TERMS,
};
