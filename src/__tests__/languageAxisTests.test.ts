/**
 * A test suite must not quietly stop covering a language.
 *
 * doc:check gate 15 guards production source. This is its counterpart for the
 * suite itself, and it exists because the suite was the WORSE half: adding
 * Portuguese left SIX guards frozen on five languages — doc
 * parity (so a changelog entry present in five sections and missing from the
 * sixth would not have been caught), the help-catalogue brand check, the
 * layout harness's marker parity, the shipped-dictionary rules, the label
 * contracts, and `detectUiLang`'s supported set. Every one of them reported
 * success on the languages it happened to look at.
 *
 * That is worse than an unguarded production site, because a green suite is
 * exactly what stops anyone looking further — the same reason an audit found
 * `prune` had been failing for nine releases while CLAUDE.md asserted a clean
 * baseline, and another found six silent per-language fallbacks with 3569 of
 * 3571 tests passing.
 *
 * DELIBERATELY NARROW, so it stays worth having. It looks only at a
 * MODULE-SCOPE list of bare language codes — the shape that drives a whole
 * suite. A two-language fixture passed to a pure function is a different
 * animal and is none of this test's business; bringing those into scope was
 * tried in the same build and reported ~30 sites needing an acknowledgement
 * apiece, which is how a guard becomes something people learn to silence.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";

const DIR = "src/__tests__";
const CODES = LANGUAGES.map((l) => l.code);

/** Module-scope `const NAME = ["xx", "yy", …]` holding ONLY language codes. */
function moduleScopeLangLists(source: string) {
  const out: { name: string; codes: string[]; line: number; ack: boolean }[] = [];
  const lines = source.split("\n");
  // Indent zero is the discriminator: a list at column 0 is the file's own
  // axis, while a fixture lives inside a describe/it body and is indented.
  const re = /^const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const items = String(m[2] || "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    if (!items.length || items.some((x) => !/^[a-z]{2,3}$/.test(x))) continue;
    const hits = items.filter((x) => CODES.includes(x));
    if (hits.length < 2) continue;
    const line = source.slice(0, m.index).split("\n").length;
    const above = lines[line - 2] || "";
    out.push({ name: m[1]!, codes: items, line, ack: /lang-axis-ok/.test(above) || /lang-axis-ok/.test(lines[line - 1] || "") });
  }
  return out;
}

describe("no test suite silently covers a subset of the languages", () => {
  const files = readdirSync(DIR).filter((f) => /\.test\.tsx?$/.test(f));

  it("finds test files to inspect at all", () => {
    // Non-vacuity: a broken glob would make every assertion below pass by
    // examining nothing, which is the failure this whole file is about.
    expect(files.length).toBeGreaterThan(100);
  });

  it("every module-scope language list covers the registry", () => {
    const gaps: string[] = [];
    for (const f of files) {
      for (const l of moduleScopeLangLists(readFileSync(`${DIR}/${f}`, "utf8"))) {
        if (l.ack) continue;
        const missing = CODES.filter((c) => !l.codes.includes(c));
        if (missing.length) {
          gaps.push(`${f}:${l.line} ${l.name} omits ${missing.join(", ")} — derive it from LANGUAGES, ` +
                    `or write "// lang-axis-ok: <reason>" above it if the subset is deliberate.`);
        }
      }
    }
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("recognises the shape it is meant to catch", () => {
    // Probed rather than assumed: the detector must fire on the literal five
    // codes and stand down once the list is derived. Both halves matter — a
    // detector that never fires reads exactly like a clean codebase.
    const frozen = moduleScopeLangLists('const LANGS = ["fr", "en", "es", "de", "it"];');
    expect(frozen.length).toBe(1);
    expect(frozen[0]!.codes).not.toContain("pt");

    expect(moduleScopeLangLists('const LANGS = LANGUAGES.map((l) => l.code);')).toEqual([]);
    // A fixture inside a test body is indented, and out of scope by design.
    expect(moduleScopeLangLists('  const SUB = ["fr", "en"];')).toEqual([]);
    // A list of ordinary short strings is not a language axis.
    expect(moduleScopeLangLists('const X = ["up", "dn"];').length).toBe(0);
  });
});
