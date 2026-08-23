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
  // The Journal's flame button, quoted by name in every block's tasting
  // section. Added because the body rule below matched it against the RESUME
  // label and reported a false positive: the guide was right and the registry
  // simply did not know this control. Turning a false positive into coverage
  // beats acknowledging it.
  { doc: "help", key: "tasting_title", marker: /<strong>[^<]{4,60}<\/strong>\s*\((?:Flamme|flamme|flame|llama|fiamma|chama)/ },
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

// Memoised: the near-miss rules ask for a label once per CANDIDATE, and the
// guide holds ~4000 emphasised strings, so a `readFileSync` per call meant
// ~81 000 reads and 14 s for one case. Nothing about the file changes mid-run.
const DICT_SRC: Record<string, string> = {};
function dictSrc(code: string): string {
  return (DICT_SRC[code] ||= readFileSync(`src/i18n/${code}.ts`, "utf8"));
}

function dictValue(code: string, key: string): string | null {
  const src = dictSrc(code);
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
  // A near-miss must SHARE A WHOLE WORD with the label. Without it the ratio
  // reports coincidences: English « your preferences » scores 0.88 against
  // « Preferred source » on letters alone, sharing no word at all.
  //
  // VERIFIED against all FIFTEEN real drifts found so far: every one shares at
  // least one word, which is what a drift IS — the same control, renamed by an
  // inserted article, a different verb, a truncation or a reordering. A rename
  // with no word in common is not drift, it is a different label.
  const shareAWord = (a: string, b: string) => {
    const w = (x: string) => new Set(x.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
    const [x, y] = [w(a), w(b)];
    for (const t of x) if (y.has(t)) return true;
    return false;
  };
  const wrapsLabel = (cand: string, label: string) =>
    new RegExp(`(^|\\W)${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`, "i").test(cand);
  // A quotation that IS a label the app renders is CORRECT, whichever row's
  // loop happens to be looking at it. The registry is a curated subset of the
  // dictionary, so a fuzzy rule keyed on it necessarily meets real labels it
  // does not know — and reports them against whichever registry key they most
  // resemble, which is a report about the registry rather than about the guide.
  //
  // TWO shapes made this compulsory rather than cosmetic. The German tasting
  // paragraph names BOTH sibling controls in ONE sentence, correctly
  // (« Verkostung starten » and « ▶ Verkostung fortsetzen »), so each was
  // reported as a near-miss of the OTHER — the registry accusing the guide of
  // a drift the guide does not have. And the French inventory section quotes
  // « À ne pas reprendre », the rebuy filter chip, which is a real label the
  // registry has no reason to carry.
  //
  // VERIFIED against every real drift found so far — the thirteen in the guide,
  // the seventeen in the policy and the four tasting titles below: not ONE of
  // them equals a dictionary value, because a drift is by definition a string
  // the app does not render. The residual it leaves is disclosed rather than
  // hidden: the guide could point at control A while naming control B, with B
  // real. That is a wrong CROSS-REFERENCE, not a wrong label, and no
  // string-level rule can see it.
  const LABELS: Record<string, Set<string>> = {};
  const isRealLabel = (code: string, cand: string) => {
    const set = (LABELS[code] ||= new Set(
      [...dictSrc(code).matchAll(/^\s*[A-Za-z0-9_]+:"((?:[^"\\]|\\.)*)"/gm)]
        .map((m) => bare(m[1]!.replace(/^[^\p{L}]+/u, ""))),
    ));
    return set.has(cand);
  };
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
    // `ys` is hoisted: splitting inside the scan made this O(n²) with an
    // allocation per character, and the body rule runs it ~80 000 times.
    const ys = y.split("");
    const used = new Array(ys.length).fill(false);
    for (const ch of x) {
      const i = ys.findIndex((c, j) => !used[j] && c === ch);
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
          if (row === label || wrapsLabel(row, label) || isRealLabel(code, row)) continue;
          if (sim(row, label) >= NEAR && shareAWord(row, label)) {
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
          if (q === label || wrapsLabel(q, label) || isRealLabel(code, q)) continue;
          if (sim(q, label) >= NEAR && shareAWord(q, label)) {
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

  // The residual the curated approach left open, and the last one: a control
  // quoted in the BODY of a section rather than in the settings-reference
  // list. Those are the sentences that tell you which button to tap, so a
  // wrong name there is as costly as in the reference list.
  //
  // SCOPE, measured. Scanning every emphasised string in the guide is 4044
  // candidates, and it is viable only because three exemptions between them
  // absorb the classes that would otherwise swamp it: `wrapsLabel` (prose
  // wrapping the label), `shareAWord` (pure letter coincidence) and
  // `isRealLabel` (a control the registry does not carry).
  //
  // WHAT IT FOUND, and the tally is worth keeping because the two rounds say
  // different things. The first pass reported FOUR, of which TWO were real
  // drifts in the guide, outside the reference list, invisible to every rule
  // that came before: it « Escludi le chiavi API dalle esportazioni » against
  // « …da esportazioni e backup », and pt « Verificar as cópias na nuvem »
  // against « Verificar cópias na nuvem ».
  //
  // The pt one is worth knowing about: the sweep matched it against the WRONG
  // key (the encryption toggle, which shares most of its words) and the drift
  // surfaced anyway. A fuzzy rule does not have to identify the control
  // correctly to notice that a quotation is not any of them.
  //
  // The two false positives were German « Verkostung starten » — the app's own
  // label, simply absent from the registry — and English « your preferences »,
  // which shares no word with anything. Adding `tasting_title` to the registry
  // to close the first then surfaced FOUR MORE REAL DRIFTS in one stroke: the
  // guide dropped the button's indefinite article in en, es, it and pt
  // (« Start tasting » for « Start a tasting », « Iniciar cata » for
  // « Iniciar una cata », « Avvia degustazione » for « Avvia una
  // degustazione », « Iniciar prova » for « Iniciar uma prova »), in the one
  // sentence that tells a reader which button starts a timed session. French
  // and German were right, which is what identifies it as translation drift.
  //
  // Turning a false positive into COVERAGE beats acknowledging it — and it is
  // also what produced the German cross-match `isRealLabel` exists for, since
  // the registry then held two sibling labels the same sentence names.
  it("no quotation in a section BODY is a near-miss either", () => {
    const wrong: string[] = [];
    let scanned = 0;
    let compared = 0;
    for (const { code } of LANGUAGES) {
      const blk = block("help", code)!;
      for (const m of blk.matchAll(/<(strong|em)>([^<]{4,70})<\/\1>/g)) {
        const q = bare(m[2]!);
        scanned++;
        // Hoisted out of the key loop: whether the guide named a real control
        // is a property of the QUOTATION, not of the registry row that happens
        // to resemble it.
        if (isRealLabel(code, q)) continue;
        compared++;
        for (const { key, doc } of QUOTED) {
          if ((doc || "help") !== "help") continue;
          const label = bare(dictValue(code, key) || "");
          if (!label || q === label || wrapsLabel(q, label)) continue;
          if (sim(q, label) >= NEAR && shareAWord(q, label)) {
            wrong.push(`${code}.${key}: the guide says ${JSON.stringify(q)}, the app says ${JSON.stringify(label)}`);
          }
        }
      }
    }
    expect(scanned, "no emphasised strings found — the guide's markup changed").toBeGreaterThan(500);
    // Both exemptions above can silence the whole corpus, and an empty report
    // satisfies the assertion below — the vacuity trap the policy rule already
    // records. `compared` counts what actually reached a comparison, so a rule
    // that stopped examining anything says so instead of reading as clean.
    expect(compared, "the exemptions swallowed the corpus").toBeGreaterThan(500);
    expect(wrong, "the guide quotes a control under a name the app does not use").toEqual([]);
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
