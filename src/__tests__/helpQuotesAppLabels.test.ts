// When a shipped DOC quotes a control, it must quote the label the app
// actually renders. Two documents are covered: the user guide and the PRIVACY
// POLICY.
//
// Gate 23 covers enum VALUES, and nothing covered anything else. So the guide
// told an Italian reader to tap « ▶ Riprendi sessione », « Cifra i backup nel
// cloud », « DB locale » and the « Acc. » tab, none of which exist — the app
// says « ▶ Riprendi degustazione », « Cripta i backup cloud », « Database
// locale » and « Access. ». It also called the finished lot status
// « Terminato » ten times, in a language whose dictionary is unanimous on
// « Finito ».
//
// Found by comparing the guide against the dictionaries rather than by reading
// it — and the comparison then found FIVE more in four other languages, which
// is the argument for a check instead of a proofread: the English guide said
// « ▶ Resume session » against the app's « ▶ Resume tasting », Spanish
// « ▶ Reanudar sesión » against « ▶ Reanudar cata », German « ▶ Sitzung
// fortsetzen » against « ▶ Verkostung fortsetzen », and Portuguese quoted the
// encryption toggle with the wrong VERB (« Cifrar » where the app says
// « Encriptar »).
//
// SCOPE, and why it is a curated table rather than a sweep: only the caller
// knows which help sentences are QUOTING a control as opposed to describing it
// in prose. A sweep over every dictionary value would flag the ordinary word
// « Finito » wherever it appeared and would be silent about a control the
// guide never mentions — noise in one direction and nothing in the other.
// So the registry names the controls the guide points at, and the check is
// mechanical from there. Add a row when the guide starts quoting a new one.
//
// NOTE the deliberate asymmetry: a language whose doc does not mention the
// control at all is SKIPPED, not failed. Both documents are editorial and each
// language may cover a different amount; what must never happen is quoting a
// label that is not the app's.
//
// PRIVACY.HTML WAS ADDED AFTER THE SAME CLASS WAS FOUND THERE, WORSE. Nothing
// had ever compared that file to the dictionaries, and a sweep of it turned up
// SEVENTEEN wrong quotations across the six languages — every one of the six
// truncated the API-key toggle, every one of the six invented a name for the
// ZIP export button (« Backup ZIP », « ZIP-Sicherung », « Copia de seguridad
// ZIP », where the app says « Exporter ZIP » in all six), three named the wrong
// verb on the erase button, and two got the AI section heading wrong. An audit
// had reported FOUR; the sweep is what found the rest, which is the whole
// argument for a mechanical check over a reading.
//
// It matters more here than in the guide: this is the page a Google OAuth
// reviewer reads, and a policy that sends someone to a control by a name the
// app does not use is a policy they cannot verify.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";

// key -> the marker that identifies the sentence quoting it, per language.
// The marker is a distinctive PREFIX of the quotation, so the test can tell
// "the doc quotes this and got it wrong" from "the doc never mentions it".
// `doc` names which shipped file the row is about; it defaults to the guide.
type Doc = "help" | "privacy";
// The settings-reference row shape. Used as the marker for the rows below and,
// more importantly, as the scan target for the NEAR-MISS rule at the bottom of
// this file — the shape is a NAME slot by convention, which is what makes a
// fuzzy comparison against it low-noise instead of a guessing game.
const REF_ROW = /<li><strong>[^<]{4,70}<\/strong>\s*(?:—|–)/;
const QUOTED: Array<{ key: string; marker: RegExp; doc?: Doc }> = [
  // The Home CTA. Its wording diverged in four languages at once.
  { key: "tasting_resume_home", marker: /<strong>▶ [^<]{0,40}<\/strong>/ },
  // The word the Home puts beside a pipe chosen because it ACCORDS with
  // tonight's family. It carries a gender trap that makes drift likely rather
  // than hypothetical: the pipe is feminine in fr/es/it and MASCULINE in pt
  // (o cachimbo), so the six values are not translations of one another and
  // cannot be checked by eye.
  // Anchored on the DEDICATION clause rather than on the noun introducing the
  // quotation ("mention" / "tag" / "Hinweis" …): English puts that noun AFTER
  // the <em> and Spanish spells it "mención", so a noun-first marker went
  // silent in two languages out of six — found by probing each language
  // separately, which is the only way to see a marker that skips rather than
  // fails.
  {
    key: "home_pair_accord",
    marker: /(dédiée à la famille|dedicated to|dedicada a la familia|gewidmet|dedicata alla famiglia|dedicado à família)[\s\S]{0,320}<em>[^<]{0,40}<\/em>/,
  },
  // The Settings toggle, quoted in <strong> in every language's backup section.
  { key: "enc_toggle_label", marker: /<strong>[^<]{0,60}<\/strong>[^<]{0,20}(protège|protects|protege|schützt|protegge)/ },
  // The auto-fill source option.
  { key: "autofill_src_local", marker: /<strong>[^<]{0,30}<\/strong>\s*\(/ },
  // The setting that option lives under, quoted in the catalogue section of all
  // six blocks. Portuguese said « Fonte preferida » — the Italian label,
  // translated — against the app's « Fonte prioritária »; every other language
  // was right, which is what identifies it as translation drift rather than a
  // stale guide. The marker keys on the CLAUSE that follows the quotation,
  // since the label itself is what may be wrong.
  { key: "lbl_autofill_source", marker: /<em>[^<]{0,40}<\/em>[^<]{0,40}(permet d'inverser|lets you reverse|permite invertir|lässt sich diese Reihenfolge|permette di invertire|permite inverter)/ },
  // The accounting toggle, quoted in <strong> by every block. German said
  // « Buchhaltung » — seven times, heading and breadcrumb included — where the
  // app says « Abrechnung ». Nothing could see it: the label is prose, not an
  // enum value, so gate 23 does not reach it, and the German guide was
  // internally consistent, which is what makes this kind of drift read as
  // correct until you put it beside the dictionary.
  { key: "sec_accounting", marker: /<h3>[^<]{0,40}\((Mengenerfassung|déduction|deduction|deducción|deduzione|dedução)[^<]{0,40}<\/h3>/ },
  // The fiche's "show all lots" override, quoted in the "À point" paragraph of
  // all six blocks once that row started opening the fiche on a lot slice. The
  // sentence exists to tell the reader how to get the hidden lots back, so a
  // label that is not the app's makes it useless rather than merely inexact.
  { key: "btn_show_all_lots", marker: /(offre|offers|ofrece|oferece|bietet|propose)\s*[«„"][^«„"»“]{0,30}[»“"]/ },
  // The catalogue check, quoted in the file-format note of all six
  // blocks. The marker keys on the sentence's own subject — the LINE NUMBER —
  // because that is what the button is being recommended for, and it is
  // <strong> in every language.
  { key: "cat_audit_btn", marker: /<strong>[^<]{0,40}<\/strong>[^<]{0,140}<strong>(numéro de ligne|line number|número de fila|Zeilennummer|numero di riga|número da linha)<\/strong>/ },
  // ── public/privacy.html ────────────────────────────────────────────────
  // Four controls the policy points the reader at. Each was wrong in at least
  // two languages before this check existed; the API-key toggle and the ZIP
  // export were wrong in all six.
  //
  // The markers key on the BREADCRUMB around the quotation rather than on the
  // quotation itself, which is the half that may be wrong — the arrow and the
  // gear are what every language shares.
  {
    doc: "privacy", key: "lbl_excl_apikey",
    // The sentence that tells you how to put the key back INTO backups.
    marker: /(désactivez l'option|turn off|desactiva|deaktiviere|disattiva|desative)\s*<strong>[^<]{0,90}<\/strong>/,
  },
  {
    doc: "privacy", key: "btn_export_zip",
    // The "export regularly" advice, where the ZIP button sits beside the JSON
    // one inside the same breadcrumb.
    marker: /<em>[^<]{0,30}JSON[^<]{0,30}<\/em>\s*(?:ou|or|o|oder)\s*<em>[^<]{0,40}<\/em>/,
  },
  {
    doc: "privacy", key: "btn_reset_all_data",
    // Opens the credentials-wipe paragraph. es/it/pt each used a different
    // verb from the button's.
    marker: /<p><strong>[^<]{0,50}<\/strong> \((?:Paramètres|Settings|Ajustes|Einstellungen|Impostazioni|Definições)/,
  },
  {
    doc: "privacy", key: "sec_ai",
    // The Settings SECTION the API-key toggle lives in. es and pt both wrote
    // "Asistente DE IA" / "Assistente DE IA" against the app's article-less
    // heading. The policy correctly drops the 🤖, so the comparison is on the
    // trimmed value — see `dictValue`.
    marker: /(section|sección|secção|sezione|Abschnitt)\s*<em>[^<]{0,40}<\/em>/,
  },
  // ── The SETTINGS REFERENCE list ────────────────────────────────────────
  // Five controls the guide lists BY NAME in its settings reference, each of
  // which had drifted in at least one language and in one language only —
  // the signature of translation drift rather than a stale guide.
  //
  // The marker is the reference row's own shape (`<li><strong>NAME</strong> —
  // description`), which is a NAME slot by convention: that list exists so a
  // reader can look a control up.
  { doc: "help", key: "lbl_watch_low_weight", marker: REF_ROW },
  { doc: "help", key: "trash_empty_btn", marker: REF_ROW },
  { doc: "help", key: "lbl_default_grouping", marker: REF_ROW },
  { doc: "help", key: "lbl_sess_default_weight", marker: REF_ROW },
  { doc: "help", key: "lbl_date_format", marker: REF_ROW },
];

const DOCS: Record<Doc, string> = {
  help: readFileSync("public/help.html", "utf8"),
  privacy: readFileSync("public/privacy.html", "utf8"),
};

function block(doc: Doc, code: string): string | null {
  const src = DOCS[doc];
  const opens = [...src.matchAll(/<div id="sec-([a-z-]+)"/g)];
  const i = opens.findIndex((m) => m[1] === code);
  if (i < 0) return null;
  const start = opens[i]!.index!;
  const end = i + 1 < opens.length ? opens[i + 1]!.index! : src.length;
  return src.slice(start, end);
}

function dictValue(code: string, key: string): string | null {
  const src = readFileSync(`src/i18n/${code}.ts`, "utf8");
  const m = new RegExp(`^\\s*${key}:"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(src);
  if (!m) return null;
  // A Settings SECTION heading carries a leading emoji ("🤖 Assistant IA") that
  // prose has no reason to reproduce — the reader is looking for the WORDS.
  // Trimming it here keeps the comparison on the part that can actually drift,
  // and is deliberately narrow: only a leading non-letter run is dropped, so a
  // label that IS an emoji would still be compared whole.
  return m[1]!.replace(/^[^\p{L}]+/u, "");
}

describe("the shipped docs quote the app's own labels", () => {
  it("finds the blocks and the keys, so it cannot pass vacuously", () => {
    expect(LANGUAGES.length).toBeGreaterThan(1);
    // BOTH documents must carry a block per registry language — the privacy
    // policy is not a lesser document here, and a missing block would make
    // every row below skip in silence.
    for (const doc of ["help", "privacy"] as Doc[]) {
      for (const { code } of LANGUAGES) {
        expect(block(doc, code), `no sec-${code} block in ${doc}.html`).toBeTruthy();
      }
    }
    for (const { code } of LANGUAGES) {
      for (const { key } of QUOTED) {
        expect(dictValue(code, key), `${code}.${key} missing`).toBeTruthy();
      }
    }
  });

  for (const { key, marker, doc } of QUOTED) {
    const which: Doc = doc || "help";
    it(`${which}: ${key} — every language that quotes it, quotes it right`, () => {
      const wrong: string[] = [];
      let quotedSomewhere = 0;
      for (const { code } of LANGUAGES) {
        const blk = block(which, code)!;
        const val = dictValue(code, key)!;
        if (blk.indexOf(val) >= 0) { quotedSomewhere++; continue; }
        // The doc does not carry the app's label. Is that because it never
        // mentions the control (fine), or because it quotes it wrongly?
        const m = marker.exec(blk);
        if (m) wrong.push(`${code}: ${which} says ${JSON.stringify(m[0])}, app says ${JSON.stringify(val)}`);
      }
      expect(wrong, `${which}.html names a control the app does not have`).toEqual([]);
      expect(quotedSomewhere, `no language quotes ${key} — the marker has rotted`).toBeGreaterThan(0);
    });
  }

  // ── THE MASKING GAP, closed ────────────────────────────────────────────
  //
  // The rule above asks "does the block contain the app's label ANYWHERE", so
  // a doc that quotes a control correctly in one place and WRONGLY in another
  // passes. That is not hypothetical: a full sweep of the guide found TWELVE
  // drifts and this check was green on every one of them, because each block
  // also carried a correct mention elsewhere.
  //
  // SCOPE, and it is what makes the rule usable: only the settings-reference
  // rows are scanned, and only against the registry's own keys. MEASURED — the
  // `<li><strong>X</strong> —` shape holds 561 rows across the six languages
  // and 258 of them (45%) match no dictionary value at all, because the shape
  // is also used for glossary terms, concept names and step headings. A gate
  // over ALL of them would need 258 acknowledgements and would rot; over the
  // ~19 curated keys it reports ZERO false positives.
  //
  // A leading emoji is stripped from BOTH sides, for the same reason
  // `dictValue` strips it: the guide reproduces "📦 Exporter ZIP" for a button
  // whose label carries the icon, and drops the "🤖" from a section heading.
  // Without that, this rule reports 12 hits, all of them that difference.
  const NEAR = 0.85;
  const bare = (x: string) => x.replace(/^[^\w«(]+/, "").trim();
  // Prose that WRAPS the label rather than mis-naming it: "ships no
  // catalogue", "the reference catalogue", "Destination cloud". The label is
  // present, whole and word-bounded, with a qualifier around it — the reader
  // still finds the control.
  //
  // VERIFIED against all thirteen real drifts before it was added: not one has
  // this shape, because a drift changes the label's OWN words (an inserted
  // "de", a different verb, a reordering) rather than adding to it. A
  // truncation is unaffected too — there the CANDIDATE is the shorter string,
  // so the label is not contained in it.
  const wrapsLabel = (cand: string, label: string) =>
    new RegExp(`(^|\\W)${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`, "i").test(cand);
  const sim = (a: string, b: string) => {
    // A CHARACTER-OVERLAP ratio (Sørensen-Dice over the multiset of letters),
    // NOT the longest-common-subsequence shape difflib uses — and the
    // difference earned its keep immediately. The Python sweep this rule was
    // derived from scored the Italian « Peso di sessione predefinito » below
    // its threshold against « Peso predefinito sessione » because the words
    // are REORDERED; a character ratio is order-blind and caught it. That was
    // a real thirteenth drift, found by the gate rather than by the sweep.
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    if (x === y) return 1;
    let common = 0;
    const used = new Array(y.length).fill(false);
    for (const ch of x) {
      const i = y.split("").findIndex((c, j) => !used[j] && c === ch);
      if (i >= 0) { used[i] = true; common++; }
    }
    return (2 * common) / (x.length + y.length);
  };

  it("no settings-reference row is a near-miss of a control the registry names", () => {
    const wrong: string[] = [];
    for (const { key, doc } of QUOTED) {
      if ((doc || "help") !== "help") continue;
      for (const { code } of LANGUAGES) {
        const label = bare(dictValue(code, key) || "");
        if (!label) continue;
        const blk = block("help", code)!;
        for (const m of blk.matchAll(/<li><strong>([^<]{4,70})<\/strong>\s*(?:—|–)/g)) {
          const row = bare(m[1]!);
          if (row === label || wrapsLabel(row, label)) continue;
          if (sim(row, label) >= NEAR) {
            wrong.push(`${code}.${key}: the reference row says ${JSON.stringify(row)}, the app says ${JSON.stringify(label)}`);
          }
        }
      }
    }
    expect(wrong, "the guide lists a control under a name the app does not use").toEqual([]);
  });

  // The same gap, on the POLICY. It has no settings-reference list, so the
  // rule above has nothing to scan there — but the masking is identical: a
  // block naming a control correctly once masks a second, wrong mention.
  //
  // SCOPE, measured rather than allowlisted. Scanning every emphasised string
  // in the policy means 197 candidates and TWO false positives, both the same
  // prose turn in two languages ("lors d'un export ZIP" / "a ZIP export" —
  // naming the ACTION, not the button). Requiring a Settings BREADCRUMB (an
  // arrow or the gear) within 200 characters cuts that to 76 candidates and
  // ZERO, and it is a principled cut rather than a list of exceptions: the
  // policy quotes a control precisely when it is telling the reader where to
  // find it, and that is where the breadcrumb is.
  //
  // The English false positive is instructive about the ratio: "ZIP export"
  // scores a PERFECT 1.00 against "Export ZIP", because a character overlap is
  // order-blind. That is the property that caught the reordered Italian drift;
  // here it is the same property misfiring, which is why the SCOPE has to do
  // the work rather than the threshold.
  it("no breadcrumbed quotation in the POLICY is a near-miss either", () => {
    const wrong: string[] = [];
    let scanned = 0;
    for (const { key } of QUOTED) {
      for (const { code } of LANGUAGES) {
        const label = bare(dictValue(code, key) || "");
        if (!label) continue;
        const blk = block("privacy", code)!;
        for (const m of blk.matchAll(/<(strong|em)>([^<]{4,70})<\/\1>/g)) {
          const ctx = blk.slice(Math.max(0, m.index! - 200), m.index! + m[0].length + 200);
          if (ctx.indexOf("\u2192") < 0 && ctx.indexOf("\u2699") < 0) continue;
          scanned++;
          const q = bare(m[2]!);
          if (q === label || wrapsLabel(q, label)) continue;
          if (sim(q, label) >= NEAR) {
            wrong.push(`${code}.${key}: the policy says ${JSON.stringify(q)}, the app says ${JSON.stringify(label)}`);
          }
        }
      }
    }
    // NON-VACUITY, and it exists because a probe taught me the case could not
    // fail vacuously-safe: neutering `wrapsLabel` to always-true silenced
    // everything and left this GREEN, since an empty report satisfies the
    // assertion. A check that examines nothing must say so.
    expect(scanned, "the breadcrumb window matched nothing — the scope has rotted").toBeGreaterThan(20);
    expect(wrong, "the policy names a control under a name the app does not use").toEqual([]);
  });

  // The Italian lot status, which was wrong ten times. Asserted as an ABSENCE
  // because the defect was a word, not a missing quotation: the dictionary has
  // no `termin*` value for the lot status (every one of them is about ending a
  // TASTING or about permanent deletion), so the guide must not use one either.
  it("the Italian guide does not call the finished lot status 'Terminato'", () => {
    const blk = block("help", "it")!;
    expect(dictValue("it", "lot_finished_lbl")).toBe("Finito");
    expect(blk).toContain("Finito");
    expect(blk, "the app's own word for this status is Finito").not.toContain("Terminato");
  });
});
