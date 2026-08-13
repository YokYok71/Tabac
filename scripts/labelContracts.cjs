// Label-contract gates — the truthfulness half of doc:check (extracted to its
// own module so it can be unit-tested).
//
// WHY THIS EXISTS. doc:check's older gates prove a label EXISTS in five
// languages and that its dev fallback matches `fr` byte-for-byte. None of
// them asks whether the sentence is still TRUE. Six
// user-facing claims had silently drifted from the code — one of them for
// 20 releases, and two of them inside the privacy policy, where drift means
// under-disclosing what leaves the device. These two gates close that hole
// from the two ends of what a machine can actually verify:
//
//   numeric — a claim quoting a NUMBER is compared to the constant.
//   prose   — a fingerprinted code region forces a human re-read when the
//             behaviour it describes moves.
//
// Everything here is PURE: `readFile(relPath) -> string | null` is injected,
// so the whole surface is fuzzable from a test with an in-memory registry
// (see src/__tests__/labelContracts.test.ts). scripts/doc-check.cjs is the
// thin caller that supplies the real filesystem.

const crypto = require("crypto");

// ── numeric contracts ────────────────────────────────────────────────────
// Two source shapes:
//   { source, match }              — capture group 1 of a regex over text
//   { sourceJson, jsonArrayPath }  — length of an array inside a JSON file
// Two comparison modes:
//   "exact"   (default) — the doc must contain each pattern with {n} filled
//   "atLeast"           — each pattern is a regex with one (\d+); the number
//                         found in the doc must be <= the code's value. For a
//                         FLOOR claim ("over N of something"), which stays
//                         true as the value grows but breaks if it shrinks.
//                         No live contract uses it or `sourceJson` today; both
//                         are kept because a floor claim is the one shape
//                         `exact` cannot express, and they are unit-tested.
function readContractValue(c, readFile) {
  // `sum: [term, term…]` — a DERIVED claim, e.g. "auto-ended after 95 min"
  // is really OVERTIME_THRESHOLD (90) + OVERTIME_AUTO_END (5). Reading both
  // terms means the claim breaks if EITHER constant moves; hard-coding 95
  // against one of them would silently miss a change to the other.
  if (Array.isArray(c.sum)) {
    let total = 0;
    for (const term of c.sum) {
      const got = readContractValue(term, readFile);
      if (got.error) return { error: got.error };
      total += got.value;
    }
    return { value: total };
  }
  if (c.sourceJson) {
    const raw = readFile(c.sourceJson);
    if (raw === null) return { error: `source file ${c.sourceJson} not found` };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { error: `${c.sourceJson} is not valid JSON: ${e.message}` }; }
    const arr = c.jsonArrayPath ? parsed[c.jsonArrayPath] : parsed;
    if (!arr || typeof arr !== "object") return { error: `${c.sourceJson}: "${c.jsonArrayPath}" is not a collection` };
    return { value: Array.isArray(arr) ? arr.length : Object.keys(arr).length };
  }
  const src = readFile(c.source);
  if (src === null) return { error: `source file ${c.source} not found` };
  const m = src.match(new RegExp(c.match));
  if (!m) {
    return { error: `/${c.match}/ no longer matches in ${c.source} — the constant was renamed or reshaped, update the match in scripts/label-contracts.json` };
  }
  let n = Number(m[1]);
  if (c.divide) n = n / c.divide;
  return { value: n };
}

// Names the source(s) in a failure message. A `sum` contract has no single
// source, so it lists its terms — otherwise the message reads "undefined
// says 98", which tells the reader nothing about where to look.
function sourceLabel(c) {
  if (Array.isArray(c.sum)) {
    return "the sum of " + c.sum.map((t) => t.source || t.sourceJson || "?").join(" + ");
  }
  return c.source || c.sourceJson || "?";
}

// An HTML doc is compared on its TEXT layer, not its source: a claim is
// routinely split by inline markup ("jusqu'à <strong>3</strong> sauvegardes"),
// which a source-level substring match misses even though the sentence the
// user reads is intact. Tags out, whitespace collapsed — the same normalising
// a reader's eye does. `raw: true` opts an entry back into source matching if
// it ever needs to assert markup.
function docText(content, file, raw) {
  if (raw || !/\.html?$/i.test(file || "")) return content;
  return content
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function numericContractErrors(reg, readFile) {
  const errors = [];
  for (const c of (reg && reg.numeric) || []) {
    const got = readContractValue(c, readFile);
    if (got.error) { errors.push(`label-contract "${c.id}": ${got.error}.`); continue; }
    const n = got.value;
    for (const d of c.docs || []) {
      const rawDoc = readFile(d.file);
      if (rawDoc === null) { errors.push(`label-contract "${c.id}": doc file ${d.file} not found.`); continue; }
      const doc = docText(rawDoc, d.file, d.raw);
      for (const pat of d.patterns || []) {
        if (c.mode === "atLeast") {
          // EVERY occurrence, not just the first. `doc.match`
          // without the `g` flag returns one match, so a claim repeated in six
          // languages was checked in ONE of them and the other five could say
          // anything: raising the French to a truthful figure and leaving the
          // German overstated passed the gate. Measured by probe — the number
          // was changed to 9999 in each of es/de/it/pt in turn and the gate
          // stayed green every time, because the French match came first.
          //
          // A pattern that matches NOTHING is still an error (the wording
          // moved), which is what keeps this from passing vacuously.
          const all = [...doc.matchAll(new RegExp(pat, "g"))];
          if (!all.length) {
            errors.push(`label-contract "${c.id}": ${d.file} no longer contains a claim matching /${pat}/ — the wording moved, update the pattern.`);
            continue;
          }
          for (const m of all) {
            const claimed = Number(m[1]);
            if (!(claimed <= n)) {
              errors.push(
                `label-contract "${c.id}": ${d.file} advertises ${claimed}, but the code only has ${n}.\n` +
                "    The claim is now an overstatement — lower the figure in every language\n" +
                "    (or find out why the source shrank).");
            }
          }
        } else {
          const want = pat.replace("{n}", String(n));
          if (!doc.includes(want)) {
            errors.push(
              `label-contract "${c.id}": ${sourceLabel(c)} says ${n}, but ${d.file} never says "${want}".\n` +
              "    A user-facing claim quotes this number — update the wording (every language),\n" +
              "    or adjust the pattern in scripts/label-contracts.json if only the phrasing moved.");
          }
        }
      }
    }
  }
  return errors;
}

// ── prose contracts ─────────────────────────────────────────────────────
// The region is the slice between the LABEL-CONTRACT markers, whitespace-
// collapsed so a reformat is not a false positive.
function fingerprintRegion(src, id) {
  if (src === null || src === undefined) return { error: "region file not found" };
  const start = src.indexOf(`LABEL-CONTRACT:start ${id}`);
  const end = src.indexOf(`LABEL-CONTRACT:end ${id}`);
  if (start < 0 || end < 0 || end < start) {
    return { error: `markers "LABEL-CONTRACT:start ${id}" / ":end ${id}" not found` };
  }
  const nl = src.indexOf("\n", start);
  const body = src.slice(nl < 0 ? start : nl + 1, end).replace(/\s+/g, " ").trim();
  return { hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16) };
}

// Returns { errors, updated } and MUTATES reg.prose[].fingerprint for the
// entries that were (re)recorded, so the caller can persist the registry.
// An entry is recorded when it has no fingerprint yet (first run) or when
// its id is explicitly accepted — never silently on drift, which is the
// whole point.
function proseContractResults(reg, readFile, accept, onRecord) {
  const errors = [];
  let updated = false;
  const accepted = (id) => (accept || []).includes(id) || (accept || []).includes("all");
  for (const c of (reg && reg.prose) || []) {
    const fp = fingerprintRegion(readFile(c.region), c.id);
    if (fp.error) { errors.push(`label-contract "${c.id}": ${fp.error} in ${c.region}.`); continue; }
    if (!c.fingerprint || accepted(c.id)) {
      c.fingerprint = fp.hash;
      updated = true;
      if (onRecord) onRecord(c.id, fp.hash);
      continue;
    }
    if (c.fingerprint !== fp.hash) {
      errors.push(
        `label-contract "${c.id}": the code it documents changed (${c.fingerprint} → ${fp.hash}).\n` +
        `    ${c.why || ""}\n` +
        "    Re-read:\n" +
        (c.labels || []).map((l) => "      - " + l).join("\n") + "\n" +
        `    Still accurate? Acknowledge with:  node scripts/doc-check.cjs --accept ${c.id}`);
    }
  }
  return { errors, updated };
}

// ── domain coverage ─────────────────────────────────────────────────────
// The last blind spot of the scheme: nothing forced anyone to CREATE a
// contract. A new outbound endpoint could ship with a dutiful privacy-policy
// line and no coupling at all, so the next time its behaviour moved, no gate
// would ask anyone to re-read that line. doc:check's older gate already
// knows every host src/ talks to (it makes the policy disclose them), so we
// reuse that list from the other side: every request target must ALSO be
// claimed by a prose contract, via `domains: [...]` on the entry.
//
// `ignore` is the caller's placeholder/tapped-link set — hosts that are not
// app-driven data flows and therefore need no coupling.
function domainCoverageErrors(reg, domains, ignore) {
  const errors = [];
  const claimed = new Map(); // host → contract id
  for (const c of (reg && reg.prose) || []) {
    for (const d of c.domains || []) {
      if (claimed.has(d)) {
        errors.push(`label-contracts: "${d}" is claimed by two prose contracts ("${claimed.get(d)}" and "${c.id}") — one owner per host, so the failure names the right region.`);
      }
      claimed.set(d, c.id);
    }
  }
  for (const host of Array.from(domains || []).sort()) {
    if (ignore && ignore.has(host)) continue;
    if (claimed.has(host)) continue;
    errors.push(
      `label-contracts: src/ sends requests to "${host}" but no prose contract claims it.\n` +
      "    A new outbound endpoint must be coupled to the paragraph that discloses it,\n" +
      "    or the next time its behaviour moves nothing will ask anyone to re-read that\n" +
      "    paragraph. Add the host to a prose entry's `domains` in\n" +
      "    scripts/label-contracts.json (marking a new region if none fits), or — if it\n" +
      "    is a placeholder / user-tapped link rather than a data flow — add it to\n" +
      "    DOMAIN_IGNORE in scripts/doc-check.cjs with a comment saying why.");
  }
  // A host coupled but no longer contacted is stale bookkeeping, not a risk.
  for (const [host, id] of claimed) {
    if (!(domains || new Set()).has(host)) {
      errors.push(`label-contracts: prose contract "${id}" claims "${host}", but src/ no longer contacts it — drop the host (and re-read the paragraph: it may now over-disclose).`);
    }
  }
  return errors;
}

// Parses `--accept <id>` (repeatable) / `--accept all` out of an argv slice.
function parseAcceptFlags(argv) {
  const out = [];
  (argv || []).forEach((a, i) => { if (a === "--accept" && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

module.exports = {
  readContractValue,
  sourceLabel,
  docText,
  numericContractErrors,
  fingerprintRegion,
  proseContractResults,
  domainCoverageErrors,
  parseAcceptFlags,
};
