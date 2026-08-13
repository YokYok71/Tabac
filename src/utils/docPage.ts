// Language-agnostic extraction for the shipped in-app doc pages
// (changelog / privacy / licenses — HelpView keeps its own richer
// section parser). Every bilingual page wraps each language in a
// `<div id="sec-XX">` block (XX = a 2-3 letter language code: sec-fr,
// sec-en, and tomorrow sec-es / sec-de …). Monolingual pages (e.g. the
// English-only licenses) put their content straight in <body>.
//
// ADDING A LANGUAGE is intentionally a content-only task: author a
// `<div id="sec-<code>">` block in each public/*.html page and a matching
// `src/i18n/<code>.ts` dictionary. NOTHING here changes — the doc views
// resolve `sec-<lang>` dynamically and fall back through DOC_LANG_FALLBACKS
// (English, then French, then whatever section exists) when a page hasn't
// been translated into the active UI language yet.

// Tried in order AFTER the requested language: keep the user in a
// readable page even before a given page is translated.
// lang-axis-ok: a fallback CHAIN, not a coverage list — the order to try
// AFTER the requested language, which is why it holds two and not six.
export const DOC_LANG_FALLBACKS: ReadonlyArray<string> = ["en", "fr"];

// Shared language resolver for any per-language map (help section titles /
// bodies, and anything else). Requested lang → DOC_LANG_FALLBACKS → the
// first entry present. Returns null only when the map is empty. Keeping
// this in ONE place means every integrated page falls back identically,
// so adding a language behaves the same everywhere.
export function pickLang<T>(byLang: Record<string, T>, lang: string): T | null {
  for (const code of [String(lang || "").toLowerCase(), ...DOC_LANG_FALLBACKS]) {
    const v = byLang[code];
    if (v != null) return v;
  }
  const keys = Object.keys(byLang);
  return keys.length ? (byLang[keys[0]!] as T) : null;
}

interface Sec { code: string; start: number; }

function findSections(html: string): Sec[] {
  const re = /<div\b[^>]*\bid=["']sec-([a-z]{2,3})["'][^>]*>/gi;
  const out: Sec[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ code: String(m[1] || "").toLowerCase(), start: m.index });
  }
  return out;
}

// Slice the `<div id="sec-<lang>">` block for the requested language
// (falling back through DOC_LANG_FALLBACKS, then the first section
// present). Returns null when the page carries no `sec-*` wrapper at all
// (monolingual page → caller uses extractBody instead).
export function extractLangSection(html: string, lang: string): string | null {
  const secs = findSections(html);
  if (!secs.length) return null;
  const bodyClose = html.indexOf("</body>");
  const endAll = bodyClose >= 0 ? bodyClose : html.length;
  const prefs = [String(lang || "").toLowerCase(), ...DOC_LANG_FALLBACKS];
  let chosen: Sec | null = null;
  for (const code of prefs) {
    const s = secs.find(x => x.code === code);
    if (s) { chosen = s; break; }
  }
  if (!chosen) chosen = secs[0]!;
  // The block runs until the next language section (document order) or
  // </body>.
  let end = endAll;
  for (const s of secs) {
    if (s.start > chosen.start && s.start < end) end = s.start;
  }
  return String(html).substring(chosen.start, end);
}

// Whole-<body> content, for monolingual pages with no sec-* wrapper.
export function extractBody(html: string): string | null {
  const bodyMatch = /<body\b[^>]*>/i.exec(html);
  if (!bodyMatch) return null;
  const afterBody = bodyMatch.index + bodyMatch[0].length;
  const bodyClose = html.indexOf("</body>", afterBody);
  return String(html).substring(afterBody, bodyClose >= 0 ? bodyClose : html.length);
}

// Drop the standalone-page chrome so only the readable content remains:
// the `<div id="sec-XX">` wrapper, any <script>, the back link, the
// language-toggle button, and the leading <h1> (the in-app view supplies its
// own TopBar + PageTitle).
//
// Parsed with the DOM (browser + jsdom) instead of regex tag-filtering. A
// regex HTML filter is fragile — CodeQL flags this exact pattern as
// js/bad-tag-filter + js/incomplete-multi-character-sanitization (a crafted
// `<scr<script>ipt>` survives a single-pass strip) — and it's unnecessary
// here: the DOM parser removes chrome robustly in one pass. The input is our
// OWN public/*.html and is rendered via innerHTML (where <script> never
// executes anyway), so this is correctness + static-analysis hygiene, not a
// trust boundary.
export function stripDocChrome(html: string): string {
  if (typeof DOMParser === "undefined") return String(html).trim(); // non-DOM env (unreached in app/test)
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return String(html).trim();
  // Bilingual pages arrive wrapped in <div id="sec-XX"> — unwrap to its
  // content. Monolingual pages have no wrapper → keep the whole body.
  const wrapper = body.querySelector('div[id^="sec-"]');
  const root: Element = wrapper || body;
  root.querySelectorAll("script, a.back, button.lang-btn").forEach((el) => el.remove());
  const h1 = root.querySelector("h1"); // drop only the leading page title
  if (h1) h1.remove();
  return String(root.innerHTML).trim();
}

// One-shot: language-resolved, chrome-stripped content for a shipped doc
// page. Bilingual pages resolve `sec-<lang>`; monolingual pages fall back
// to the whole <body>. Returns null if nothing usable was found.
export function extractDocContent(html: string, lang: string): string | null {
  const region = extractLangSection(html, lang) ?? extractBody(html);
  if (region == null) return null;
  const cleaned = stripDocChrome(region);
  return cleaned || null;
}
