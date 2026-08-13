// Pure i18n check logic, extracted from doc-check.cjs.
//
// WHY THIS EXISTS. doc-check.cjs is ~15 gates and had no tests of its own,
// while the label-contract logic it calls was extracted into its own module
// precisely so it COULD be tested. The identical-value gate was rewritten
// (flat allowlist → per-language) and verified only by two manual
// probes — a gate whose own correctness is unverified reports "OK" just as
// confidently when it has stopped checking anything, which is the failure mode
// that matters most for a guard.
//
// Everything here is pure: strings in, findings out. No fs, no process, no
// console — doc-check.cjs owns the reading and the reporting, this module owns
// the decisions, and src/__tests__/i18nChecks.test.ts owns proving them.

"use strict";

/** Ratio at which a translation is flagged as possibly overflowing. */
const RATIO_THRESHOLD = 1.4;
/** Below this many characters the reference string is too short for the ratio
 *  to mean anything ("Pot" → "Barattolo" is 3× and perfectly fine). */
const MIN_REF_LEN = 3;
/** A value this short is a code or a unit, not prose worth translating. */
const MAX_TRIVIAL_LEN = 3;
const HAS_LETTER = /\p{L}/u;

/**
 * Parse a dictionary source file into { key: value }.
 * Tolerates escaped quotes inside values; requires the repo's one-key-per-line
 * `key:"value"` shape (no space after the colon), which doc:check enforces.
 */
function parseDictSource(src) {
  const out = Object.create(null);
  const re = /([a-zA-Z_][a-zA-Z0-9_]*):"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(String(src))) !== null) out[m[1]] = m[2];
  return out;
}

/**
 * Validate + normalise the `identical` allowlist.
 *
 * Current shape: { "<key>": ["en", …] | "*" }. The LEGACY flat ARRAY silenced
 * a key for every language pair at once — allowlisting `catalog_title` because
 * French and English share the word also hid a future Italian left as
 * "Catalogue" — so it is rejected outright rather than honoured silently.
 * Throws on any invalid shape; returns a Map.
 */
function parseIdenticalAllowlist(raw) {
  if (Array.isArray(raw)) {
    throw new Error(
      "`identical` is the LEGACY flat array — it must now map each key to " +
      'the languages where the match is by design, e.g. {"catalog_title": ["en"]} ' +
      '(or "*" for every language).',
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new Error('expected an `identical: { "<key>": ["en", …] | "*" }` object');
  }
  const map = new Map();
  for (const [k, v] of Object.entries(raw)) {
    if (v !== "*" && !Array.isArray(v)) {
      throw new Error(`identical["${k}"]: expected an array of language codes or "*"`);
    }
    if (Array.isArray(v) && v.some((c) => typeof c !== "string")) {
      throw new Error(`identical["${k}"]: language codes must be strings`);
    }
    map.set(k, v);
  }
  return map;
}

/** Is this key's value legitimately identical to the reference in `code`? */
function identicalAllowed(allowlist, key, code) {
  const v = allowlist instanceof Map ? allowlist.get(key) : undefined;
  if (!v) return false;
  if (v === "*") return true;
  return Array.isArray(v) && v.indexOf(code) !== -1;
}

/**
 * Keys whose translation is byte-identical to the reference and not allowlisted
 * for THIS language — i.e. probably never translated.
 *
 * Skips: keys absent from the translation (the parity gate owns those), values
 * with no letter at all (emoji, "—"), and values of ≤ 3 characters (codes and
 * units like "min" / "lot" legitimately coincide).
 */
function findSuspiciousIdentical(refMap, tMap, code, allowlist) {
  const out = [];
  for (const k of Object.keys(refMap)) {
    if (!(k in tMap)) continue;
    if (identicalAllowed(allowlist, k, code)) continue;
    if (refMap[k] !== tMap[k]) continue;
    if (!HAS_LETTER.test(refMap[k])) continue;
    if (refMap[k].length <= MAX_TRIVIAL_LEN) continue;
    out.push({ k, v: refMap[k] });
  }
  return out;
}

/**
 * Keys whose translation is more than `ratio`× the reference length — a hint
 * that a tight surface may overflow. Advisory only: whether it actually breaks
 * is answered by rendering (see scripts/i18n-layout.cjs), not by counting
 * characters. Sorted worst-first.
 */
function findLengthOutliers(refMap, tMap, code, ratio) {
  const threshold = typeof ratio === "number" ? ratio : RATIO_THRESHOLD;
  const out = [];
  for (const k of Object.keys(refMap)) {
    if (!(k in tMap)) continue;
    const lf = refMap[k].length;
    const lt = tMap[k].length;
    if (lf < MIN_REF_LEN) continue;
    if (lt <= lf * threshold) continue;
    out.push({ k, lf, lt, ratio: lt / lf });
  }
  out.sort((a, b) => b.ratio - a.ratio);
  return out;
}

/** Keys present in the reference but missing from / extra in a translation. */
function findParityGaps(refMap, tMap) {
  const refKeys = Object.keys(refMap);
  const missing = refKeys.filter((k) => !(k in tMap));
  const extra = Object.keys(tMap).filter((k) => !(k in refMap));
  return { missing, extra };
}

module.exports = {
  RATIO_THRESHOLD,
  MIN_REF_LEN,
  MAX_TRIVIAL_LEN,
  parseDictSource,
  parseIdenticalAllowlist,
  identicalAllowed,
  findSuspiciousIdentical,
  findLengthOutliers,
  findParityGaps,
};
