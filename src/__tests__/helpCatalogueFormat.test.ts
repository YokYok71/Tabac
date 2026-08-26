// The guide must document the catalogue CSV contract.
//
// WHY IT NEEDED WRITING AT ALL. The catalogue is the user's own
// file, so the format is the single most important thing the guide can carry —
// and it carried none of it. It said "download the template, fill it in" and
// stopped: it never named the two MANDATORY columns, and it never said that
// `category` and `cut` must use the app's OWN taxonomy.
//
// That last one is what the user asked for, and the reason it matters is that
// an unrecognised value is NOT rejected. `parseCatalogueCsv` keeps it verbatim
// and reports it (deliberately — silently rewriting someone's vocabulary is
// worse), so the row loads and the blend is then half understood: no
// `CUT_DENSITY` for the bowl-weight estimate, no `xl()` translation, no
// matching option in the form's dropdown — so opening and saving that tobacco
// REWRITES the user's cut. Nothing in the app can warn about that at load
// time without guessing; the guide is the only place it can be said.
//
// WHAT THIS FILE LOCKS, and why each half is here:
//   (a) every column of `CATALOGUE_COLUMNS` is named in every language block —
//       so adding a 21st column and forgetting the guide turns this red rather
//       than shipping a documented format that is missing a field;
//   (b) `brand_key` / `blend_name` are marked as the required pair, and
//       `category` / `cut` carry the taxonomy warning, in all six.
//
// It is source-level on purpose: the guide is fetched at runtime and rendered
// through `dangerouslySetInnerHTML`, so what rots here is the PROSE, not any
// component. Structural markers (<strong>, <a href="#...">) are used instead of
// per-language words wherever possible, since the words legitimately differ.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGUE_COLUMNS, buildCatalogueTemplateCsv } from "../utils/userCatalogue.ts";
import { LANGUAGES } from "../i18n/languages.ts";

const HELP = readFileSync("public/help.html", "utf8");

/** The guide's per-language blocks, keyed by code. */
function sections(): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const parts = HELP.split(/(?=<div id="sec-)/);
  for (const p of parts) {
    const m = /^<div id="sec-([a-z]{2,3})"/.exec(p);
    if (m && m[1]) out[m[1]] = p;
  }
  return out;
}

/** The "file format" block: from its own <h3> to the next <h3>. */
function formatBlock(sec: string): string {
  // Anchored on the table's header row rather than on a translated heading —
  // the heading is different in each language, the column names are not.
  const i = sec.indexOf("brand_key");
  if (i < 0) return "";
  const start = sec.lastIndexOf("<h3>", i);
  const end = sec.indexOf("<h3>", i);
  return sec.slice(start < 0 ? 0 : start, end < 0 ? sec.length : end);
}

// The four middle description columns are covered by the ellipsis form
// "description_fr … description_pt" rather than listed one by one: six near
// identical rows would be noise in a table a human reads. Listed here so that
// the exemption is a DECISION rather than an accident — a new column joining
// the file does not get one for free.
const ELLIDED = ["description_en", "description_de", "description_it", "description_es"];

describe("the guide documents the catalogue CSV contract", () => {
  const secs = sections();
  const codes = LANGUAGES.map((l) => l.code);

  it("every UI language has a file-format block", () => {
    expect(codes.length, "the registry is non-empty").toBeGreaterThan(1);
    for (const c of codes) {
      expect(secs[c], `no sec-${c} block in help.html`).toBeTruthy();
      expect(formatBlock(secs[c]!).length, `${c}: no file-format block`).toBeGreaterThan(400);
    }
  });

  it("names EVERY column the parser reads", () => {
    // The anti-drift half: a column renamed or added in `CATALOGUE_COLUMNS`
    // must reach the guide, or the documented format silently stops matching
    // the file the app actually parses.
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      const missing = CATALOGUE_COLUMNS.filter(
        (col) => !ELLIDED.includes(col) && block.indexOf(col) < 0,
      );
      expect(missing, `${c}: columns absent from the guide`).toEqual([]);
      expect(block, `${c}: the description columns are covered by the ellipsis form`)
        .toContain("description_fr");
      expect(block, `${c}: …and its far end`).toContain("description_pt");
    }
  });

  const rowFor = (block: string, col: string) => {
    const i = block.indexOf("<li><strong>" + col + "</strong>");
    return i < 0 ? "" : block.slice(i, block.indexOf("</li>", i));
  };

  it("marks brand_key and blend_name as the required pair", () => {
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      for (const col of ["brand_key", "blend_name"]) {
        // Structural, not lexical: the required lead-in is emphasised, and the
        // word for "required" differs across the six.
        expect(rowFor(block, col), `${c}: ${col} is not marked required`)
          .toMatch(/<\/strong> — <strong>/);
      }
    }
  });

  it("does NOT claim category or cut are required — they are optional but constrained", () => {
    // An earlier release caught exactly this by READING the generated table: converting
    // it from three columns to two, the branch that adds the "required" lead-in
    // fired on `Non — <strong>taxonomie imposée</strong>` because that cell
    // also contains a <strong>, and two OPTIONAL columns were relabelled
    // mandatory in all six languages. A factual error in the one block whose
    // whole purpose is stating the contract.
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      const requiredLead = rowFor(block, "brand_key").match(/<\/strong> — <strong>([^<]+)<\/strong>/);
      expect(requiredLead, `${c}: no required lead-in to compare against`).toBeTruthy();
      for (const col of ["category", "cut"]) {
        expect(rowFor(block, col), `${c}: ${col} must not carry the "required" wording`)
          .not.toContain("<strong>" + requiredLead![1] + "</strong>");
      }
    }
  });

  it("is a LIST, not a table — a table cannot fit the long identifiers", () => {
    // MEASURED at 360 px in German at the "L" text size: as a table the block
    // was 446 px inside a 334 px `.help-body` and could not fit even at
    // min-content, because the first column holds unbreakable identifiers
    // (`description_fr … description_pt` alone measures 252 px). Two rounds of
    // narrowing it — three columns to two — took the overflow from 169 px to
    // 57 px and no further. A <li> is normal-flow text: it wraps, it has no
    // column to squeeze, and it cannot overflow. Asserted so nobody restores
    // the table for the sake of the other five in the guide, whose left-hand
    // terms are ordinary words.
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      expect(block, `${c}: the format block must not use a table`).not.toContain("<table>");
      expect((block.match(/<li>/g) || []).length, `${c}: one <li> per column group`)
        .toBeGreaterThanOrEqual(11);
    }
  });

  it("nomme le BON séparateur d'alias, dans les six langues", () => {
    // DÉFAUT RÉEL, pré-existant, trouvé en unifiant le séparateur de CHAMPS :
    // les six blocs disaient « séparés par un point-virgule » alors que
    // `pipeList` découpe sur `|` et que le modèle le démontre
    // (`Halvorsen of Bergen|Halvorsen & Son`). Longtemps ce n'était « que »
    // faux — un alias écrit `A;B` ne se découpait pas. Depuis que `;` est le
    // séparateur de CHAMPS, suivre le guide DÉCALE toutes les colonnes
    // suivantes de la ligne. Une instruction fausse devenue destructrice.
    //
    // La barre est LUE dans le modèle plutôt que réécrite ici : la garde doit
    // suivre le code, pas une seconde copie de la règle.
    const tpl = buildCatalogueTemplateCsv();
    expect(tpl, "le modèle ne démontre plus la barre verticale").toContain("|");
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      const alias = (block.match(/<li><strong>brand_aliases[^<]*<\/strong>[^<]*(?:<code>[^<]*<\/code>[^<]*)*/) || [])[0] || "";
      expect(alias, `${c}: la ligne des alias est introuvable`).toBeTruthy();
      expect(alias, `${c}: le guide ne nomme pas la barre verticale`).toContain("|");
      expect(alias.toLowerCase(),
        `${c}: le guide dit encore point-virgule — suivre l'instruction décale les colonnes`)
        .not.toMatch(/point-virgule|semicolon|punto y coma|semikolon|punto e virgola|ponto e vírgula/);
    }
  });

  it("tells the reader to READ the load report", () => {
    // A catalogue that silently dropped a third of its rows looks exactly like
    // one that loaded fine — the reason `useUserCatalogue` keeps the counts at
    // all. Saying so is the other half of that decision.
    for (const c of codes) {
      const block = formatBlock(secs[c]!);
      expect(block, `${c}: no note about the load report`).toContain('class="note"');
    }
  });
});
