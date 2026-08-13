// Single source of truth for the UI languages offered in Settings.
// Order = display order in the language switcher.
//
// `fr` is the CANONICAL language: stored enum values (categories, cuts,
// shapes, materials…) are French, and xl() returns them as-is for fr.
//
// ── ADD A LANGUAGE (e.g. Spanish "es") ────────────────────────────────
//   1. Add `{ code: "es", label: "ES" }` to LANGUAGES below.
//   2. Create src/i18n/es.ts (`export var ES = {…}`) with the SAME key
//      set as fr.ts/en.ts. NOTHING to wire: only English is statically
//      imported by src/i18n.ts; every other dictionary is picked up by
//      `import.meta.glob("./i18n/*.ts")` and fetched on demand by
//      `ensureLang(code)`. Do NOT add a static import — that would put the
//      whole dictionary back in the eager bundle, which is exactly the cost
//      the split removed.
//   3. constants.ts: add the `_ES` enum maps + an `es:` entry in each
//      ENUM_TRANSLATIONS row (that's the ONLY place enum labels wire in).
//   4. Author `<div id="sec-es">…</div>` in public/{changelog,privacy}.html
//      and the `es-…` <h2> anchors in public/help.html (+ es ids in
//      HelpView.SECTION_IDS + HELP_SECTION_IDS in doc-check).
//   5. Fill in a LANG_ASSETS row below (see the block comment there).
//
// WHAT THIS LIST IS NOT. It once ended with a promise that the rest of the app
// "picks the new language up with NO further code changes", and that was FALSE:
// an audit that actually added Portuguese found SIX further sites hardcoding
// the current codes — number formatting, Nominatim place names, month names,
// weekday initials, catalogue prose and the AI's output language — every one
// falling back SILENTLY, with typecheck, lint, doc:check and the whole suite
// green. Step 5 is the remnant of that, and `doc:check` gate 13 FAILS when it
// is missing rather than shipping French numbers to a Portuguese reader.
// If you add a seventh site that varies by language, put its data in
// LANG_ASSETS — do not start another map.
//
// The Settings switcher, doc:check parity (auto-discovers src/i18n/*.ts), the
// dictionary loader (glob, see i18n.ts) and the in-app doc views (resolve
// sec-<lang> dynamically) need no edit at all.
export interface UiLanguage { code: string; label: string; }

export var LANGUAGES: UiLanguage[] = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "de", label: "DE" },
  { code: "it", label: "IT" },
  { code: "pt", label: "PT" },
];

/**
 * Per-language LOCALE DATA.
 *
 * WHY THIS EXISTS. The on-demand rewrite made the dictionary itself purely
 * additive: drop
 * `src/i18n/<code>.ts` and the glob in `i18n.ts` finds it. But an audit that
 * actually ADDED a sixth language (Portuguese) found six OTHER sites that each
 * hardcoded the five current codes and each **fell back silently**: a `pt` user
 * got French number formatting, French place names from Nominatim, English
 * month ticks and weekday initials, and AI-written descriptions in English —
 * with typecheck, lint, doc:check and 3569 of 3571 tests all green. A silent
 * fallback is the worst failure shape available: nothing tells you, and the
 * result looks merely half-finished rather than broken.
 *
 * So the scattered maps are now ONE row per language, and `doc:check` gate 13
 * asserts a complete row exists for every `src/i18n/*.ts` it discovers. Adding
 * a language is still additive — but a MISSING row now fails the build instead
 * of shipping French numbers to a Portuguese reader.
 *
 * Consumers: `AnimNum` (primitives.tsx), `nominatimReverseUrl` (geo.ts),
 * `monthsShort` / `heatmapDayInitials` (constants.ts), `LANG_PROMPT_NAME`
 * (useAiAutoFill.ts). The catalogue-prose chunks are discovered by glob in
 * tobaccoDb.ts and need no entry.
 */
export interface LangAssets {
  /** BCP-47 tag for Intl / toLocaleString — decimal + thousands separators. */
  numberLocale: string;
  /** `accept-language` sent to Nominatim so place names come back localised. */
  nominatim: string;
  /** 12 short month names, Jan-first — chart axes and both calendars. */
  monthsShort: readonly string[];
  /** 7 weekday initials, MONDAY-first. The heatmap renders indices 0/2/4 only,
   *  so the odd slots are deliberately empty strings. */
  dayInitials: readonly string[];
  /** The language's name IN ENGLISH, used inside AI prompts to tell the model
   *  which language to write the description in. */
  aiPromptName: string;
}

export var LANG_ASSETS: Record<string, LangAssets> = {
  fr: {
    numberLocale: "fr-FR", nominatim: "fr", aiPromptName: "French",
    monthsShort: ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"],
    dayInitials: ["L","","M","","V","",""],
  },
  en: {
    numberLocale: "en-US", nominatim: "en", aiPromptName: "English",
    monthsShort: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    dayInitials: ["M","","W","","F","",""],
  },
  es: {
    numberLocale: "es-ES", nominatim: "es", aiPromptName: "Spanish",
    monthsShort: ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"],
    dayInitials: ["L","","X","","V","",""],
  },
  de: {
    numberLocale: "de-DE", nominatim: "de", aiPromptName: "German",
    monthsShort: ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],
    dayInitials: ["M","","M","","F","",""],
  },
  it: {
    numberLocale: "it-IT", nominatim: "it", aiPromptName: "Italian",
    monthsShort: ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"],
    dayInitials: ["L","","M","","V","",""],
  },
  // EUROPEAN Portuguese, not Brazilian: pt-PT for numbers (space thousands,
  // comma decimal) and `pt` to Nominatim. Weekday initials are Segunda /
  // Quarta / Sexta — the heatmap renders indices 0/2/4 only.
  pt: {
    numberLocale: "pt-PT", nominatim: "pt", aiPromptName: "European Portuguese",
    monthsShort: ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"],
    dayInitials: ["S","","Q","","S","",""],
  },
};

/** The row for `code`, or English's. English is the app-wide fallback and is
 *  the one language guaranteed to be compiled in (see src/i18n.ts). */
export function langAssets(code?: string): LangAssets {
  return (code && Object.prototype.hasOwnProperty.call(LANG_ASSETS, code))
    ? LANG_ASSETS[code]! : LANG_ASSETS.en!;
}
