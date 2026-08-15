// When the guide QUOTES a control, it must quote the label
// the app actually renders.
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
// NOTE the deliberate asymmetry: a language whose guide does not mention the
// control at all is SKIPPED, not failed. The guide is editorial and each
// language may cover a different amount; what must never happen is quoting a
// label that is not the app's.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.ts";

// key -> the marker that identifies the sentence quoting it, per language.
// The marker is a distinctive PREFIX of the quotation, so the test can tell
// "the guide quotes this and got it wrong" from "the guide never mentions it".
const QUOTED: Array<{ key: string; marker: RegExp }> = [
  // The Home CTA. Its wording diverged in four languages at once.
  { key: "tasting_resume_home", marker: /<strong>▶ [^<]{0,40}<\/strong>/ },
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
  // The catalogue check, quoted in the file-format note of all six
  // blocks. The marker keys on the sentence's own subject — the LINE NUMBER —
  // because that is what the button is being recommended for, and it is
  // <strong> in every language.
  { key: "cat_audit_btn", marker: /<strong>[^<]{0,40}<\/strong>[^<]{0,140}<strong>(numéro de ligne|line number|número de fila|Zeilennummer|numero di riga|número da linha)<\/strong>/ },
];

const HELP = readFileSync("public/help.html", "utf8");

function block(code: string): string | null {
  const opens = [...HELP.matchAll(/<div id="sec-([a-z-]+)"/g)];
  const i = opens.findIndex((m) => m[1] === code);
  if (i < 0) return null;
  const start = opens[i]!.index!;
  const end = i + 1 < opens.length ? opens[i + 1]!.index! : HELP.length;
  return HELP.slice(start, end);
}

function dictValue(code: string, key: string): string | null {
  const src = readFileSync(`src/i18n/${code}.ts`, "utf8");
  const m = new RegExp(`^\\s*${key}:"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(src);
  return m ? m[1]! : null;
}

describe("the guide quotes the app's own labels", () => {
  it("finds the blocks and the keys, so it cannot pass vacuously", () => {
    expect(LANGUAGES.length).toBeGreaterThan(1);
    for (const { code } of LANGUAGES) {
      expect(block(code), `no sec-${code} block`).toBeTruthy();
      for (const { key } of QUOTED) {
        expect(dictValue(code, key), `${code}.${key} missing`).toBeTruthy();
      }
    }
  });

  for (const { key, marker } of QUOTED) {
    it(`${key} — every language that quotes it, quotes it right`, () => {
      const wrong: string[] = [];
      let quotedSomewhere = 0;
      for (const { code } of LANGUAGES) {
        const blk = block(code)!;
        const val = dictValue(code, key)!;
        if (blk.indexOf(val) >= 0) { quotedSomewhere++; continue; }
        // The guide does not carry the app's label. Is that because it never
        // mentions the control (fine), or because it quotes it wrongly?
        const m = marker.exec(blk);
        if (m) wrong.push(`${code}: guide says ${JSON.stringify(m[0])}, app says ${JSON.stringify(val)}`);
      }
      expect(wrong, "the guide names a control the app does not have").toEqual([]);
      expect(quotedSomewhere, `no language quotes ${key} — the marker has rotted`).toBeGreaterThan(0);
    });
  }

  // The Italian lot status, which was wrong ten times. Asserted as an ABSENCE
  // because the defect was a word, not a missing quotation: the dictionary has
  // no `termin*` value for the lot status (every one of them is about ending a
  // TASTING or about permanent deletion), so the guide must not use one either.
  it("the Italian guide does not call the finished lot status 'Terminato'", () => {
    const blk = block("it")!;
    expect(dictValue("it", "lot_finished_lbl")).toBe("Finito");
    expect(blk).toContain("Finito");
    expect(blk, "the app's own word for this status is Finito").not.toContain("Terminato");
  });
});
