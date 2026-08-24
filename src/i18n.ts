// i18n registry — ENGLISH is bundled, every other language loads ON DEMAND.
//
// Originally all five dictionaries were static imports in
// one eager chunk: 78.3 KB gzip, of which a user reads ~15.7. That is 21% of the
// 303 KB cold start spent on four languages nobody is looking at, re-downloaded
// after every update (doUpdate purges every cache), and it is what made a SIXTH
// language impossible — the eager budget had ~29 KB of headroom against ~16 KB
// per dictionary.
//
// THE RULES, as decided:
//   1. The phone's language wins. `detectUiLang` already implements exactly
//      that (primary-subtag match over navigator.languages) and is unchanged.
//   2. English is the fallback — if a language does not exist, or does not
//      load, the user gets English.
//   3. Loading is ON DEMAND, not pre-warmed: a language is fetched when it is
//      actually needed (at startup for the active one, at switch time for a
//      new one). No idle prefetching of the other four.
//
// WHY ENGLISH IS THE STATIC ONE. Something must be compiled in, or a failed
// import leaves the app with no text at all — the one failure mode worse than a
// missing feature. Rule 2 names English, so English it is, and rule 2 then
// becomes the failure mode for free: offline with no German chunk cached is
// indistinguishable from "German does not exist", and both land on English,
// which is what a German speaker would want over French.
//
// OFFLINE. The service worker is cache-first and stores every chunk it fetches,
// so a language used once works offline for ever after. The only new failure is
// switching, while offline, to a language never downloaded — `ensureLang`
// resolves false, and the caller keeps the current language and says so.

import { EN } from "./i18n/en.ts";

export type Dict = typeof EN;

/** Dictionaries currently in memory. Starts with English only; `ensureLang`
 *  adds the others. Consumers keep `import { LANG } from "./i18n.ts"` and must
 *  treat a missing language as "not loaded yet", never as an error. */
// NULL-PROTOTYPE. `lang` comes from `cave-lang`, i.e. straight from storage,
// and on a plain object `LANG["__proto__"]` resolves to `Object.prototype` —
// truthy, not a dictionary — after which every lookup returns the RAW KEY and
// the whole UI renders as key names. `isLangLoaded` is an own-property test
// and closed that door; building the map null-prototype closes it at the
// source, so no reader has to remember the guard. The comment below used to
// say the lint rule "does not fire here because LANG is a var" — the rule now
// covers `var`, and this is the answer it asked for.
export var LANG: Record<string, Dict> = Object.assign(Object.create(null), { en: EN }) as Record<string, Dict>;

// ADD A LANGUAGE: drop `src/i18n/<code>.ts` exporting `<CODE>` and add the code
// to ./i18n/languages.ts. Nothing here changes — the glob below picks it up and
// Vite emits it as its own chunk. That is the whole point of this module.
const LOADERS: Record<string, () => Promise<Record<string, unknown>>> = Object.assign(
  Object.create(null),
  Object.fromEntries(
    Object.entries(
      import.meta.glob("./i18n/*.ts") as Record<string, () => Promise<Record<string, unknown>>>,
    )
      .map(([path, load]) => {
        // languages.ts is the registry, not a dictionary — the 2-3 letter
        // pattern excludes it without needing a name blacklist.
        const m = /\/([a-z]{2,3})\.ts$/.exec(path);
        return m ? ([m[1]!, load] as [string, () => Promise<Record<string, unknown>>]) : null;
      })
      .filter((e): e is [string, () => Promise<Record<string, unknown>>] => e !== null),
  ),
);

// One in-flight promise per language, so two callers racing (startup + an
// immediate switch) share a single fetch instead of two.
const inflight: Record<string, Promise<boolean>> = Object.create(null);

/**
 * How long a dictionary chunk may take before English serves.
 *
 * THIS IS THE DIFFERENCE BETWEEN A SLOW APP AND A DEAD ONE. `main.jsx` gates
 * `ReactDOM.createRoot().render()` on `ensureLang(active)` SETTLING, so anything
 * that leaves this promise pending leaves the app on its pre-mount "Chargement…"
 * shell for ever — no error, no React, no way out but the repair link.
 *
 * `.catch(() => false)` below covers a REJECTED import. It does not cover a
 * STALLED one: a dynamic import whose request hangs (a dead cellular socket, a
 * service worker that never answers, a fetch cut mid-deploy) settles neither
 * way, so `.then`, `.catch` and `.finally` all stay unrun. That is the one form
 * of "the chunk cannot be fetched" the contract claimed to handle and did not.
 *
 * 6 s: the chunk is ~16 KB gzip, so this is generous even on a poor connection,
 * while never letting the boot screen look hung. The two failure costs are not
 * symmetric — too short means a French user reads English for one launch and a
 * reload fixes it once the chunk is cached; too long means the app never opens.
 */
const LANG_LOAD_TIMEOUT_MS = 6000;

/**
 * Resolve `false` if `p` has not settled within `ms`. NEVER rejects — every
 * caller's response to a failure is identical, so a rejection here would only
 * invite an unhandled one (the reasoning `ensureLang` already rests on).
 *
 * The underlying load is NOT cancelled: a dictionary that arrives late is still
 * installed into `LANG`, so the next render or language switch has it. Losing a
 * chunk that did arrive would be a second bug on top of the first.
 */
export function settleWithin(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => finish(false), ms);
    p.then((v) => finish(v), () => finish(false));
  });
}

/** True when `code`'s dictionary is in memory and `translate` will use it. */
export function isLangLoaded(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANG, code);
}

/**
 * True when `code` is a language this app HAS — i.e. one `ensureLang` could
 * load. Distinct from `isLangLoaded`, which asks whether it is in memory NOW.
 *
 * The on-demand rewrite collapsed two different failures into one boolean,
 * deliberately and correctly for the question "which language do we SHOW" — an unknown code and
 * a chunk that will not download both land on English. They are NOT the same
 * for the question "what do we TELL the user": rendered on screen, a
 * `cave-lang` of "xx" (or "constructor", or a JSON blob) produced the amber
 * "this language must be downloaded once — reconnect, then reload the app"
 * notice on the terms gate AND in Settings, permanently, on every launch. There
 * is nothing to download, the network is irrelevant, and reloading changes
 * nothing. `ensureLang` already tells the two apart (`LOADERS[code]` absent
 * versus a loader that rejected); this exposes that distinction to the callers
 * that need to word a message.
 */
export function isKnownLang(code: string): boolean {
  return !!code && (isLangLoaded(code) || LOADERS[code] !== undefined);
}

/**
 * Load `code`'s dictionary if it is not already in memory.
 * Resolves TRUE when the language is usable, FALSE when it is unknown or the
 * chunk could not be fetched (offline, stale cache mid-deploy). NEVER rejects:
 * every caller's correct response to failure is the same — stay on English, or
 * on the current language — so rejecting would only invite an unhandled one.
 */
// LABEL-CONTRACT:start ui-language-on-demand — see scripts/label-contracts.json
export function ensureLang(code: string): Promise<boolean> {
  if (!code || isLangLoaded(code)) return Promise.resolve(isLangLoaded(code));
  const load = LOADERS[code];
  if (!load) return Promise.resolve(false);
  const pending = inflight[code];
  // Each caller races its OWN timeout against the shared load, so a second
  // caller arriving after a first one timed out is not handed an already-
  // settled `false` — it gets a fresh window on the same in-flight fetch.
  if (pending) return settleWithin(pending, LANG_LOAD_TIMEOUT_MS);
  const p = load()
    .then((mod) => {
      // Each dictionary exports one const named for its uppercased code (FR,
      // DE…). Falling back to the first exported object means a future file
      // that names it differently still works rather than failing silently.
      const dict = (mod[String(code).toUpperCase()] ?? Object.values(mod)[0]) as Dict | undefined;
      if (!dict || typeof dict !== "object") return false;
      LANG[code] = dict;
      return true;
    })
    .catch(() => false)
    .finally(() => { delete inflight[code]; });
  inflight[code] = p;
  return settleWithin(p, LANG_LOAD_TIMEOUT_MS);
}
// LABEL-CONTRACT:end ui-language-on-demand

// Pure key → string lookup shared by App.tsx's t(). Falls back to ENGLISH when
// the language is unknown OR not loaded yet (it was French, which
// only made sense while every dictionary was guaranteed present), then to the
// raw key ONLY when the key is truly absent. CRITICAL: an intentional
// empty-string value ("" — e.g. tasting_upcoming_pre in fr /
// tasting_upcoming_post elsewhere) must return "" and NOT the raw key.
// `dict[k] || k` gets this wrong because "" is falsy — hence the explicit
// nullish check. Regression: the tasting setup title rendered
// "tasting_upcoming_pre" on screen.
export function translate(lang: string, k: string): string {
  // `LANG.en!` — English is assigned at module init and never removed, but the
  // Record index signature plus noUncheckedIndexedAccess cannot know that.
  // `isLangLoaded`, not a bare `LANG[lang]`: `lang` comes from
  // localStorage, so a corrupt `cave-lang` of "constructor" / "toString" used
  // to resolve to an Object.prototype member — truthy, not a dictionary — and
  // every lookup on it then returned the RAW KEY, rendering the whole UI as key
  // names. Same class as the `no-dynamic-index-plain-map` rule, which does not
  // fire here because `LANG` is a `var`.
  var dict = (isLangLoaded(lang) ? LANG[lang]! : LANG.en!);
  var val = dict[k as keyof Dict] as string | undefined;
  return (val === undefined || val === null) ? k : val;
}
