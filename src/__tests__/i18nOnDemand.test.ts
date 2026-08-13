/**
 * On-demand dictionaries.
 *
 * English is compiled in; the other four are separate chunks fetched when
 * needed. That took the cold start from 303.2 KB to 240.4 gzip and left ~92 KB
 * of budget headroom where there had been ~29 — the reason a sixth language was
 * previously impossible.
 *
 * THE THREE RULES, each pinned below:
 *   1. the phone's language wins       — detectUiLang, unchanged
 *   2. English is the fallback         — unknown OR unloaded language
 *   3. loading is on demand            — nothing pre-warmed
 *
 * NOTE ON THE SETUP FILE: `src/__tests__/setup.ts` loads every dictionary
 * before the suite, because ~47 existing tests read `LANG.fr` synchronously.
 * That makes "is it loaded?" untestable through the public registry here, so
 * the cases below test the DECISIONS (fallback target, unknown-code handling,
 * idempotence, no rejection) plus the SOURCE-level invariants that the setup
 * file cannot paper over.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANG, translate, ensureLang, isLangLoaded, isKnownLang } from "../i18n";
import { LANGUAGES } from "../i18n/languages";
import { detectUiLang } from "../utils";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("i18n on-demand loading", () => {
  it("English is the only STATICALLY imported dictionary", () => {
    // The load-bearing property: something must be compiled in or a failed
    // import leaves the app with no text at all. If a second static import
    // creeps back, the cold-start saving silently halves and the sixth-language
    // headroom goes with it.
    const s = src("../i18n.ts");
    const staticImports = [...s.matchAll(/^import\s*\{\s*([A-Z]{2,3})\s*\}\s*from\s*"\.\/i18n\/([a-z]{2,3})\.ts"/gm)];
    expect(staticImports.map((m) => m[2])).toEqual(["en"]);
  });

  it("the others are reached by glob, so adding a language needs no code here", () => {
    // The user's stated goal for this change. A switch statement would work but
    // would have to be edited per language — exactly the wiring this removes.
    expect(src("../i18n.ts")).toMatch(/import\.meta\.glob\(\s*"\.\/i18n\/\*\.ts"\s*\)/);
  });

  it("every registered language has a dictionary file to load", () => {
    // The registry and the files are two lists; this is the join. A code in
    // LANGUAGES with no file would offer a language that can only ever fail.
    for (const l of LANGUAGES) {
      expect(() => src(`../i18n/${l.code}.ts`), `no dictionary for "${l.code}"`).not.toThrow();
    }
  });

  it("rule 2: an unknown language resolves through English, not French", () => {
    expect(translate("zz", "aroma_vanilla")).toBe(LANG.en!.aroma_vanilla);
  });

  it("rule 1: detectUiLang picks the phone's language, else English", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(detectUiLang(["de-CH", "fr"], codes)).toBe("de");   // primary subtag
    // A code chosen so this fixture does not break the day a sixth language is
    // added: `pt-BR` was the original example and would have collided with
    // Portuguese. Asserted to be genuinely absent rather than assumed.
    expect(codes).not.toContain("ja");
    expect(detectUiLang(["ja-JP", "it"], codes)).toBe("it");   // skips unsupported
    expect(detectUiLang(["ja", "ko"], codes)).toBe("en");      // none match
    expect(detectUiLang([], codes)).toBe("en");
    expect(detectUiLang(undefined, codes)).toBe("en");
  });

  it("ensureLang resolves FALSE for an unknown code and never rejects", async () => {
    // The offline path resolves false too. Both callers (mount, switch) treat
    // false the same way, which is why this must not reject: an unhandled
    // rejection at mount would be worse than any missing translation.
    await expect(ensureLang("zz")).resolves.toBe(false);
    await expect(ensureLang("")).resolves.toBe(false);
  });

  it("ensureLang is idempotent and reports what is loaded", async () => {
    expect(isLangLoaded("en")).toBe(true);
    await expect(ensureLang("en")).resolves.toBe(true);
    await expect(ensureLang("fr")).resolves.toBe(true);
    await expect(ensureLang("fr")).resolves.toBe(true);
    expect(isLangLoaded("zz")).toBe(false);
  });

  it("concurrent calls for the same language share one load", async () => {
    // Startup and an immediate switch can race. Without the in-flight map they
    // would each trigger a fetch; both must still resolve true.
    const [a, b, c] = await Promise.all([ensureLang("es"), ensureLang("es"), ensureLang("es")]);
    expect([a, b, c]).toEqual([true, true, true]);
  });

  it("mounting waits for the active dictionary", () => {
    // `t()` is synchronous, so the dictionary must be in memory before the first
    // render — otherwise the app paints one frame of English for a French user.
    // Asserted on the source because main.jsx has no importable seam.
    const m = src("../main.jsx");
    expect(m).toMatch(/ensureLang\(\s*active\s*\)/);
    // Asserted on the ORDER, not on the exact call shape. It used to pin
    // `.then(mount, mount)` byte-for-byte, which made the fix (correct
    // `<html lang>` back to "en" when the chunk never arrived) look like a
    // regression when it is the same guarantee with one more statement in the
    // continuation. What must hold is that mount() runs AFTER the load settles.
    const at = m.indexOf("ensureLang(active)");
    expect(at).toBeGreaterThan(0);
    expect(m.slice(at), "mount must be the continuation of ensureLang")
      .toMatch(/\.then\([\s\S]*\bmount\b/);
    expect(m.slice(0, at), "nothing may mount before the dictionary is settled")
      .not.toMatch(/^\s*mount\(\)/m);
  });

  it("the language switch waits too, and keeps the current language on failure", () => {
    const a = src("../App.tsx");
    expect(a).toMatch(/ensureLang\(l\)\.then/);
    // The failure branch must NOT call setLang — dropping a German user to
    // English for a switch that did not happen is the thing to avoid.
    const block = /if \(!ok\) \{ setLangErr\(l\); return; \}/;
    expect(a, "failed switch must return before setLang").toMatch(block);
  });

  it("the offline notice exists in every language", () => {
    // It renders in the language the user still HAS — the only loaded one — so
    // a missing translation would show a raw key at exactly the wrong moment.
    for (const l of LANGUAGES) {
      const d = src(`../i18n/${l.code}.ts`);
      expect(d, `lang_offline_err missing from ${l.code}`).toMatch(/^\s*lang_offline_err:"/m);
      expect(d, `lang_offline_reload missing from ${l.code}`).toMatch(/^\s*lang_offline_reload:"/m);
      expect(d, `lang_loading missing from ${l.code}`).toMatch(/^\s*lang_loading:"/m);
    }
  });

  it("the dictionaries are not forced back into one chunk", () => {
    // A manualChunks group is emitted as ONE file, so grouping them would make
    // importing any one language pull all five — undoing the whole change while
    // every test here still passed.
    const v = readFileSync(resolve(__dirname, "../../vite.config.js"), "utf8");
    expect(v).not.toMatch(/return\s*'i18n'/);
  });
});

/**
 * The four defects a follow-up audit found in the mechanics.
 * Each is asserted at the level it actually lives at; three of them are
 * source-level because the failure mode is a fallback branch that a passing
 * render never enters.
 */
describe("on-demand fallbacks and failure states", () => {
  it("translate() rejects a prototype key instead of serving Object.prototype", () => {
    // `lang` comes from localStorage. `LANG[lang]` on a plain object made
    // "constructor" resolve to a truthy non-dictionary, so EVERY lookup fell
    // through to the raw key — a corrupt cave-lang rendered the whole UI as key
    // names. Probed: reverting to `LANG[lang] || LANG.en` fails these.
    for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(translate(bad, "aroma_vanilla"), `${bad} escaped the guard`)
        .toBe(LANG.en!.aroma_vanilla);
    }
  });

  it("the error boundary falls back to ENGLISH, not French", () => {
    // EB is the one component that renders when a chunk failed to load — the
    // exact case where the active dictionary is absent. `LANG.fr` is undefined
    // unless French happened to load, which collapsed its string
    // table to {} and dropped every label to a hardcoded French literal.
    const e = src("../components/EB.tsx");
    expect(e, "EB still falls back to LANG.fr").not.toMatch(/LANG as any\)\.fr/);
    expect(e).toMatch(/LANG as any\)\.en/);
    expect(e, 'EB still defaults cave-lang to "fr"').toMatch(/"cave-lang"\)\s*\|\|\s*"en"/);
  });

  it("a language that failed to load at STARTUP is not shown as active", () => {
    // main.jsx mounts whether or not ensureLang succeeded, so `lang` used to
    // stay on the stored code while translate served English: English UI, DE
    // highlighted in Settings, no explanation anywhere.
    const a = src("../App.tsx");
    expect(a).toMatch(/useState\(_langUsable\(_storedLng\) \? _storedLng : "en"\)/);
    // A later release NARROWS this, and the narrowing is recorded here so it is not
    // "fixed" back: the notice must fire for a language that failed to ARRIVE,
    // and must NOT fire for a stored code that is not a language at all — see
    // the isKnownLang block below for what that produced on screen.
    expect(a, "the startup failure must raise the same notice as a failed switch")
      .toMatch(/_langUsable\(_storedLng\) \|\| !isKnownLang\(_storedLng\)\) \? "" : _storedLng/);
    // "pseudo" has no dictionary but IS usable — t() builds it from
    // EN at call time. Guarding on isLangLoaded alone silently disabled
    // pseudo-localisation for three releases while CLAUDE.md kept recommending
    // it as the way to find un-t()-ed strings. Measured: 0 of 938 marked
    // nodes before the fix, 1706 of 3650 after.
    expect(a, "pseudo-loc must survive the loaded-language guard")
      .toMatch(/_langUsable = \(c: string\) => c === "pseudo" \|\| isLangLoaded\(c\)/);
  });

  it("concurrent switches resolve by tap order, not by network timing", () => {
    // Tap DE (slow) then IT (fast): without a generation guard the DE response
    // lands last and wins, leaving the app in a language the user did not pick
    // last. The guard also stops the first resolution clearing the spinner.
    const a = src("../App.tsx");
    expect(a).toMatch(/var gen = \+\+langGenRef\.current;/);
    expect(a).toMatch(/if \(gen !== langGenRef\.current\) return;/);
  });

  it("the offline copy does not promise a retry the browser cannot perform", () => {
    // A failed dynamic import is cached AS A FAILURE in the module map, so
    // re-importing the same URL re-throws with no network request — MEASURED in
    // Chromium: offline tap -> reconnect -> tap again = 1 request total, both
    // attempts fail; only a reload clears it. The old copy said "reconnect and
    // try again", which is the one thing that cannot work.
    // Per language, not one fuzzy alternation: a regex loose enough to cover
    // five languages is loose enough to pass on copy that says nothing.
    // A language with no pattern here is SKIPPED, not failed. The map
    // is an assertion about wording we have verified, and a sixth language
    // should not turn this test red for a reason unrelated to what it checks —
    // that is exactly what happened when Portuguese was trialled. The
    // non-vacuity check below keeps the skip from hollowing the test out.
    const RELOAD: Record<string, RegExp> = {
      fr: /recharge/i, en: /reload/i, es: /recarga/i,
      de: /neu\b[^"]*\blad|\blad[^"]*\bneu/i, it: /ricarica/i, pt: /recarreg/i,
    };
    let checked = 0;
    for (const l of LANGUAGES) {
      const d = src(`../i18n/${l.code}.ts`);
      const line = d.split("\n").find((x) => x.trim().startsWith("lang_offline_err:")) || "";
      expect(line.length, `no lang_offline_err in ${l.code}`).toBeGreaterThan(0);
      const re = RELOAD[l.code];
      if (!re) continue;
      expect(line, `${l.code} does not tell the user to reload`).toMatch(re);
      checked++;
    }
    expect(checked, "no language was actually checked").toBeGreaterThanOrEqual(5);
    // …and the notice actually offers the reload, rather than leaving the user
    // to find it.
    expect(src("../views/curator/SettingsModal.tsx")).toMatch(/lang_offline_reload/);
    expect(src("../views/curator/SettingsModal.tsx")).toMatch(/window\.location\.reload\(\)/);
  });

  // ── A code that is not a language is not a network failure ─────
  //
  // RENDERED, not reasoned about: with `cave-lang` set to "xx" — or
  // "constructor", or a JSON blob — the app correctly served English, and then
  // told the user, in amber, on the terms gate AND in Settings, on every single
  // launch: "this language must be downloaded once. Reconnect, then reload the
  // app." There is nothing to download and reloading changes nothing. The on-demand
  // loader collapsed "unknown" and "failed to load" into one boolean, which is right
  // for choosing WHICH language to show and wrong for choosing WHAT TO SAY.
  it("tells a download failure apart from a code that is not a language", () => {
    expect(isKnownLang("en"), "English is compiled in").toBe(true);
    for (const l of LANGUAGES) {
      expect(isKnownLang(l.code), `${l.code} is in the registry and has a loader`).toBe(true);
    }
    // The shapes actually observed in a corrupt / carried-over cave-lang.
    for (const bad of ["xx", "constructor", "__proto__", "toString", '{"a":1}', ""]) {
      expect(isKnownLang(bad), `${JSON.stringify(bad)} must not read as a language`).toBe(false);
    }
    // …and it must NOT be the same question as "is it in memory": a language
    // that exists but has not been fetched is exactly the case that DOES
    // deserve the offline notice.
    const s = src("../i18n.ts");
    expect(s, "isKnownLang must consult the loaders, not just what is loaded")
      .toMatch(/isKnownLang[\s\S]{0,300}LOADERS\[code\]/);
  });

  it("does not write a non-language into <html lang>", () => {
    // The attribute is there for screen readers, so `lang="constructor"` (an
    // invalid BCP-47 tag) is worse than leaving the document's own value. And
    // when a real language fails to arrive the UI is English, so the attribute
    // must say English rather than announce English prose as German.
    const m = src("../main.jsx");
    expect(m, "the stored code must be checked against the registry first")
      .toMatch(/LANGUAGES\.some\(\(l\) => l\.code === lng\)[\s\S]{0,60}documentElement\.lang = lng/);
    expect(m, "a failed load must correct the attribute back to English")
      .toMatch(/if \(!ok\) \{[\s\S]{0,120}documentElement\.lang = 'en'/);
  });

  it("the terms gate surfaces a failed language switch", () => {
    // The gate calls saveLang but rendered neither langPending nor langErr, so
    // tapping FR offline produced no visible change whatsoever — and it is the
    // first screen a new user ever sees.
    const g = src("../views/curator/TermsGate.tsx");
    expect(g).toMatch(/langPending, langErr/);
    expect(g).toMatch(/lang_offline_err/);
    expect(g).toMatch(/lang_loading/);
  });
});
