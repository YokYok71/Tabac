// The most destructive button in the app must call itself the
// same thing its own confirmation calls it.
//
// MEASURED, and the measurement corrected the diagnosis twice. It was first
// reported (by me) as a Portuguese wording divergence; laying all six side by
// side showed FIVE of six diverged and French — the canonical language — was
// the only one that agreed. Checking git then showed all six diverged BEFORE
// the reset rewrite, which had fixed French alone.
//
// WHY IT MATTERS, and it is not consistency for its own sake: the softer word
// was on the BUTTON and the strong one in the DIALOG. German « Alle Daten
// zurücksetzen » and English "Reset all data" both read as RECOVERABLE — and
// this action now erases the cloud connection, the API keys and every
// preference as well as the cellar. A gentle verb eases the user into an
// irreversible act whose own dialog then says « löschen » / "Erase".
//
// Direction: the BUTTON was aligned to the CONFIRMATION, never the reverse.
// The confirmation is the longer, deliberately-reviewed text, and
// in es/de/it/pt its verb is also the app's ordinary delete verb, so the button
// now agrees with the rest of the app too.
//
// FRENCH WAS LEFT ALONE — it already agreed. Rewriting correct work to satisfy
// a sweep is the mistake recorded elsewhere in this repo.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";

/** The destruction verb each language uses for this action, lower-cased.
 * Null-prototype per `tabac-local/no-dynamic-index-plain-map`:
 *  the key comes from the LANGUAGES registry rather than from user data, so
 *  it is not forgeable here — but the rule is deliberately dumb about that
 *  distinction, and satisfying it costs one call. */
const VERB: Record<string, RegExp> = Object.assign(Object.create(null), {
  fr: /effacer/i,
  en: /erase/i,
  es: /eliminar/i,
  de: /löschen/i,
  it: /elimin/i,     // "Elimina" (button, imperative) / "Eliminare" (dialog, infinitive)
  pt: /eliminar/i,
});

function val(code: string, key: string): string {
  const src = readFileSync(`src/i18n/${code}.ts`, "utf8");
  const m = src.match(new RegExp(`\\s${key}:"((?:[^"\\\\]|\\\\.)*)"`));
  expect(m, `${code}.ts is missing ${key}`).toBeTruthy();
  return m![1]!;
}

describe("the reset button and its confirmation speak the same language", () => {
  it("covers every shipped language — no frozen list", () => {
    // A literal list here would silently stop covering the seventh language,
    // which is the failure shape this repo has recorded five times.
    expect(LANGUAGES.length).toBeGreaterThan(1);
    for (const l of LANGUAGES) {
      expect(VERB[l.code], `no expected verb recorded for "${l.code}"`).toBeTruthy();
    }
  });

  for (const l of LANGUAGES) {
    it(`${l.code}: button and confirmation use the same verb`, () => {
      const button = val(l.code, "btn_reset_all_data");
      const confirm = val(l.code, "confirm_reset");
      const verb = VERB[l.code]!;
      expect(verb.test(button), `button reads "${button}"`).toBe(true);
      expect(verb.test(confirm), `confirmation reads "${confirm.slice(0, 60)}…"`).toBe(true);
    });
  }

  it("no language softens the BUTTON into sounding recoverable", () => {
    // The specific words that were there before, and why they were wrong:
    // "Reset" / "zurücksetzen" / "Azzera" all describe returning something to
    // a starting state, which is not what this does.
    const soft = /\breset\b|zurücksetzen|\bazzera\b/i;
    for (const l of LANGUAGES) {
      const button = val(l.code, "btn_reset_all_data");
      expect(soft.test(button), `${l.code} button reads "${button}"`).toBe(false);
    }
  });

  it("the confirmation still names what is destroyed, in every language", () => {
    // The substance, guarded here so a later wording pass cannot
    // quietly drop it: the dialog must mention the cloud connection and the
    // API keys, not just "all data".
    const CLOUD = /nuvem|nube|cloud|Drive|Dropbox/i;
    const KEYS = /API/i;
    for (const l of LANGUAGES) {
      const c = val(l.code, "confirm_reset");
      expect(CLOUD.test(c), `${l.code} confirmation omits the cloud connection`).toBe(true);
      expect(KEYS.test(c), `${l.code} confirmation omits the API keys`).toBe(true);
    }
  });
});
