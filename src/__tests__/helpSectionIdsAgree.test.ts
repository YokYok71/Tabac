// The guide's section ids are hand-maintained in THREE places, and only two
// of the three edges were ever checked.
//
// `HelpView.SECTION_IDS` is what the VIEW slices the fetched document with;
// `HELP_SECTION_IDS` in `scripts/doc-check.cjs` is what the GATE validates the
// anchors against; `public/help.html` carries the literal `<h2 id="…">` tags.
// doc:check holds the gate↔html edge. Nothing held the view↔anything edge.
//
// PROBED before this file existed: renaming one id in `HelpView.SECTION_IDS`
// (`fr-catalogue` → `fr-katalog`) left 169 tests and doc:check all green. On
// screen that is a section card with no title and no body — the exact symptom
// CLAUDE.md records from the day a stray `</div>` ejected four sections, and
// the reason those three lists are documented as "must stay aligned" in the
// first place. A sentence asking a human to keep two lists in step is not a
// mechanism; this file is.
//
// SOURCE-LEVEL on purpose. Importing `SECTION_IDS` is not possible — it is a
// module-private const inside a view that pulls in the whole curator theme —
// and what rots here is the DATA, not a behaviour a render could exercise.
// Comments are blanked first: this repo has been bitten repeatedly by a check
// satisfied by the comment explaining the fix, and the paragraph above names
// several of these very ids.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";

const blank = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

/** Parse a `[{ key: "…", ids: { fr: "…", … } }]` table out of a source file. */
function parseTable(source: string, name: string): Array<{ key: string; ids: Record<string, string> }> {
  const src = blank(source);
  const at = src.indexOf(name);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const open = src.indexOf("[", at);
  const close = src.indexOf("\n];", open);
  expect(close, `${name} is not a bracketed table`).toBeGreaterThan(open);
  const body = src.slice(open, close);
  const rows: Array<{ key: string; ids: Record<string, string> }> = [];
  for (const m of body.matchAll(/\{\s*key:\s*"([^"]+)",\s*ids:\s*\{([^}]*)\}/g)) {
    const ids: Record<string, string> = {};
    for (const p of m[2]!.matchAll(/([a-z]{2,3}):\s*"([^"]+)"/g)) ids[p[1]!] = p[2]!;
    rows.push({ key: m[1]!, ids });
  }
  return rows;
}

const VIEW = parseTable(readFileSync("src/views/curator/HelpView.tsx", "utf8"), "SECTION_IDS");
const GATE = parseTable(readFileSync("scripts/doc-check.cjs", "utf8"), "HELP_SECTION_IDS");
const HELP = readFileSync("public/help.html", "utf8");
const ANCHORS = new Set([...HELP.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]!));

describe("the guide's three section-id lists agree", () => {
  it("both tables parse to something, so nothing below passes vacuously", () => {
    expect(VIEW.length).toBeGreaterThan(10);
    expect(ANCHORS.size).toBeGreaterThan(10);
    expect(GATE.length).toBe(VIEW.length);
  });

  it("the view and the gate name the same sections, in the same order", () => {
    // Order matters as well as membership: the view renders the cards in this
    // order, so a section moved in one list and not the other reorders the
    // guide against its own table of contents.
    expect(VIEW.map((r) => r.key)).toEqual(GATE.map((r) => r.key));
  });

  it("the view and the gate map every section to the SAME id", () => {
    const wrong: string[] = [];
    for (let i = 0; i < VIEW.length; i++) {
      const v = VIEW[i]!, g = GATE[i]!;
      for (const code of Object.keys(v.ids)) {
        if (v.ids[code] !== g.ids[code]) {
          wrong.push(`${v.key}.${code}: view "${v.ids[code]}" vs gate "${g.ids[code]}"`);
        }
      }
      for (const code of Object.keys(g.ids)) {
        if (!(code in v.ids)) wrong.push(`${g.key}.${code}: missing from the view's table`);
      }
    }
    expect(wrong, "the two hand-maintained tables have drifted").toEqual([]);
  });

  it("every id the VIEW slices with is an anchor help.html actually carries", () => {
    // The edge nothing held. doc:check validates the GATE's table against the
    // document; the view uses its own, so it could point at an id that exists
    // nowhere and render an empty card with every check green.
    const missing: string[] = [];
    for (const { key, ids } of VIEW) {
      for (const code of Object.keys(ids)) {
        if (!ANCHORS.has(ids[code]!)) missing.push(`${key}.${code} → "${ids[code]}"`);
      }
    }
    expect(missing, "HelpView points at anchors the guide does not have").toEqual([]);
  });

  it("every registry language is covered by every section", () => {
    // Gate 15 already refuses a table that lists five of six codes, but it
    // reads ONE literal at a time and these rows are many. Asserted per row so
    // a section added with a language missing names itself.
    const codes = LANGUAGES.map((l) => l.code);
    const gaps: string[] = [];
    for (const { key, ids } of VIEW) {
      for (const c of codes) if (!ids[c]) gaps.push(`${key} has no ${c} id`);
    }
    expect(gaps).toEqual([]);
  });
});
