// In-app help view. Fetches the existing public/help.html
// at runtime, parses out the 16 FR/EN sections via DOMParser, and renders
// each as a collapsible card with a sticky search bar + expand/collapse
// controls. The help.html file remains the source of truth for content
// (still editable directly on GitHub), but the user never lands there —
// the link in Settings → Help now opens this view.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { fs, fsInput, C, F, CARD_BG } from "../../theme-curator.ts";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  Lbl, IconBtn, ScreenWash, TopBar, PageTitle, useEnter,
} from "../../components/curator/primitives.tsx";
import { Ico, Orn } from "../../components/curator/icons.tsx";
import { pickLang } from "../../utils/docPage.ts";
import { APP_VERSION } from "../../constants.ts";

// Per-section language → h2-anchor-id map. help.html carries a localized
// id per language (the suffix isn't uniform — "fr-tabac" vs "en-tobacco"),
// so each section lists its ids explicitly. ADDING A LANGUAGE is
// content-only: add a `<code>: "<code>-…"` entry to each section here,
// author the matching `<h2 id="…">` anchors in help.html, extend
// HELP_SECTION_IDS in scripts/doc-check.cjs, and ship an i18n dict. The
// parse + render below iterate the map generically and fall back through
// the shared docPage policy (requested lang → en → fr → first present),
// so no rendering code changes.
const SECTION_IDS: ReadonlyArray<{ key: string; ids: Record<string, string> }> = [
  { key: "install",         ids: { fr: "fr-install",    en: "en-install", es: "es-install", de: "de-install", it: "it-install", pt: "pt-install" } },
  { key: "concepts",        ids: { fr: "fr-concepts",   en: "en-concepts", es: "es-concepts", de: "de-concepts", it: "it-concepts", pt: "pt-concepts" } },
  { key: "cycle",           ids: { fr: "fr-cycle",      en: "en-cycle", es: "es-cycle", de: "de-cycle", it: "it-cycle", pt: "pt-cycle" } },
  { key: "catalogue",       ids: { fr: "fr-catalogue",  en: "en-catalogue", es: "es-catalogue", de: "de-catalogue", it: "it-catalogue", pt: "pt-catalogue" } },
  { key: "tobacco",         ids: { fr: "fr-tabac",      en: "en-tobacco", es: "es-tobacco", de: "de-tobacco", it: "it-tobacco", pt: "pt-tobacco" } },
  { key: "lots",            ids: { fr: "fr-lots",       en: "en-lots", es: "es-lots", de: "de-lots", it: "it-lots", pt: "pt-lots" } },
  { key: "inventory",       ids: { fr: "fr-inventaire", en: "en-inventory", es: "es-inventory", de: "de-inventory", it: "it-inventory", pt: "pt-inventory" } },
  { key: "pipes",           ids: { fr: "fr-pipes",      en: "en-pipes", es: "es-pipes", de: "de-pipes", it: "it-pipes", pt: "pt-pipes" } },
  { key: "wishlist",        ids: { fr: "fr-wishlist",   en: "en-wishlist", es: "es-wishlist", de: "de-wishlist", it: "it-wishlist", pt: "pt-wishlist" } },
  { key: "acc",             ids: { fr: "fr-acc",        en: "en-acc", es: "es-acc", de: "de-acc", it: "it-acc", pt: "pt-acc" } },
  { key: "journal",         ids: { fr: "fr-journal",    en: "en-journal", es: "es-journal", de: "de-journal", it: "it-journal", pt: "pt-journal" } },
  { key: "ai",              ids: { fr: "fr-ia",         en: "en-ai", es: "es-ai", de: "de-ai", it: "it-ai", pt: "pt-ai" } },
  { key: "stats",           ids: { fr: "fr-stats",      en: "en-stats", es: "es-stats", de: "de-stats", it: "it-stats", pt: "pt-stats" } },
  { key: "backup",          ids: { fr: "fr-sauvegarde", en: "en-backup", es: "es-backup", de: "de-backup", it: "it-backup", pt: "pt-backup" } },
  { key: "updates",         ids: { fr: "fr-maj",        en: "en-updates", es: "es-updates", de: "de-updates", it: "it-updates", pt: "pt-updates" } },
  { key: "troubleshooting", ids: { fr: "fr-depannage",  en: "en-troubleshooting", es: "es-troubleshooting", de: "de-troubleshooting", it: "it-troubleshooting", pt: "pt-troubleshooting" } },
  { key: "trash",           ids: { fr: "fr-corbeille",  en: "en-trash", es: "es-trash", de: "de-trash", it: "it-trash", pt: "pt-trash" } },
];

interface ParsedSection {
  key: string;
  // language code → section title / body HTML. Only languages actually
  // present in help.html appear; the view resolves the active language
  // via pickLang().
  titles: Record<string, string>;
  bodies: Record<string, string>;
}

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Source-order extraction — we slice the raw HTML between this h2's
// closing tag and the next h2's opening tag, anywhere in the document.
// The earlier DOM-sibling-walk implementation broke on malformed markup: a
// stray </div> on the "Sauvegarde auto Drive" <li> auto-closed
// <div id="sec-fr"> and ejected the last 4 FR h2s into <body>, so
// querying inside frRoot found nothing for them. Slicing the source
// string is immune to that class of HTML-parser quirk.
function extractSection(html: string, h2Id: string): { title: string; body: string } | null {
  const startRe = new RegExp(
    "<h2\\b[^>]*\\sid=[\"']" + escapeRegex(h2Id) + "[\"'][^>]*>([\\s\\S]*?)<\\/h2>",
    "i"
  );
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const afterTitle = startMatch.index + startMatch[0].length;
  const tail = String(html).substring(afterTitle);
  const endMatch = /<h2\b/i.exec(tail);
  const body = endMatch ? tail.substring(0, endMatch.index) : tail;
  // Strip nested markup from the h2 title. Loop to a fixed-point
  // (CodeQL js/incomplete-multi-character-sanitization) so a
  // pathological "<<span>span>Hello</span></span>" can't slip a tag
  // through. Source is help.html which we control, so this is
  // belt-and-braces — but the bounded loop costs nothing.
  let rawTitle: string = startMatch[1] || "";
  for (let i = 0; i < 8; i++) {
    const next = String(rawTitle).replace(/<[^>]+>/g, "");
    if (next === rawTitle) break;
    rawTitle = next;
  }
  const title = String(rawTitle).replace(/\s+/g, " ").trim();
  return { title, body };
}

export function parseHelpHtml(html: string): ParsedSection[] {
  const out: ParsedSection[] = [];
  for (const { key, ids } of SECTION_IDS) {
    const titles: Record<string, string> = {};
    const bodies: Record<string, string> = {};
    let any = false;
    for (const code of Object.keys(ids)) {
      const sec = extractSection(html, ids[code]!);
      if (sec) { titles[code] = sec.title; bodies[code] = sec.body; any = true; }
    }
    if (!any) continue;
    out.push({ key, titles, bodies });
  }
  return out;
}

function stripHtml(s: string): string {
  return String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
}

// Inline CSS scoped to the help body — kept in lock-step with the
// help.html stylesheet so the rendered content keeps its visual
// language (note / warn / badge / flow / table). Exception to the
// project's "no CSS files" rule: the alternative is converting every
// HTML class to inline styles per element, which the dangerouslySet
// path can't reach.
const HELP_BODY_STYLES = `
.help-body { color: ${C.tx}; line-height: 1.65; font-size: ${fs(15)}; }
.help-body p, .help-body li { color: ${C.tx}; }
.help-body strong { color: ${C.ivory}; }
.help-body em { color: ${C.tx2}; }
.help-body a { color: ${C.brass}; text-decoration: none; }
.help-body a:hover { text-decoration: underline; }
.help-body code { background: ${C.bg2}; padding: 2px 6px; border-radius: 4px; font-size: ${fs(14.5)}; color: ${C.brass}; font-family: ${F.mono}; }
.help-body h3 { color: ${C.ivory}; font-size: ${fs(16)}; margin: 22px 0 6px; font-weight: 700; letter-spacing: 0.2px; }
.help-body ul, .help-body ol { padding-left: 22px; margin: 8px 0; }
.help-body li { margin-bottom: 4px; }
.help-body table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: ${fs(15)}; }
.help-body th { background: ${C.bg2}; color: ${C.ivory}; text-align: left; padding: 8px 12px; border-bottom: 1px solid ${C.rule}; }
.help-body td { padding: 8px 12px; border-bottom: 1px solid ${C.bg2}; vertical-align: top; color: ${C.tx}; }
.help-body td:first-child { color: ${C.brass}; white-space: nowrap; font-weight: 500; }
.help-body .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: ${fs(14)}; font-weight: 700; white-space: nowrap; }
.help-body .badge-cave { background: ${C.docBadgeCave}; color: ${C.sage}; }
.help-body .badge-pot { background: ${C.docBadgePot}; color: ${C.brassHi}; }
.help-body .badge-fin { background: ${C.docBadgeFin}; color: ${C.tx3}; }
.help-body .flow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0; padding: 16px; background: ${C.bg2}; border-radius: 10px; border: 1px solid ${C.rule}; }
.help-body .flow-step { text-align: center; }
.help-body .flow-step .icon { font-size: ${fs(26)}; display: block; }
.help-body .flow-step .label { font-size: ${fs(14.5)}; color: ${C.ivory}; font-weight: 700; }
.help-body .flow-step .sub { font-size: ${fs(12.5)}; color: ${C.tx3}; }
.help-body .flow-arrow { color: ${C.rule2}; font-size: ${fs(20)}; font-weight: 700; }
.help-body .note { background: ${C.bg2}; border-left: 3px solid ${C.brass}; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: ${fs(15)}; color: ${C.tx}; }
.help-body .warn { background: ${C.panelWarn}; border-left: 3px solid ${C.oxbloodHi}; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: ${fs(15)}; color: ${C.oxbloodHi}; }
`;

export function CuratorHelpView() {
  const ctx = useAppCtx();
  const {
    view, lang, t, nav, closeDocPage,
    collapsedHelpSections, toggleHelpSection, setAllHelpSectionsCollapsed,
    helpFocusKey, setHelpFocusKey,
  } = ctx;

  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRing = useFocusRing();
  const e = useEnter(80);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (view !== "help") return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    // AbortController so a slow connection (captive portal,
    // dropped 4G) doesn't keep the fetch alive after the user has
    // navigated away from Help. 15s ceiling.
    let ctrl: AbortController | null = null;
    try { ctrl = new AbortController(); } catch (_e) {}
    const timer = ctrl
      ? setTimeout(() => { try { ctrl!.abort(); } catch (_e) {} }, 15000)
      : null;
    fetch("./help.html", ctrl ? { signal: ctrl.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(html => {
        if (cancelled) return;
        const parsed = parseHelpHtml(html);
        setSections(parsed);
      })
      .catch(err => {
        if (cancelled) return;
        setError(String(err && err.message ? err.message : err));
      })
      .finally(() => { if (timer) clearTimeout(timer); });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (ctrl) { try { ctrl.abort(); } catch (_e) {} }
    };
  }, [view]);

  const q = String(query).trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sections) return [];
    if (!q) return sections;
    return sections.filter(s => {
      const title = String(pickLang(s.titles, lang) || "").toLowerCase();
      const body = stripHtml(pickLang(s.bodies, lang) || "");
      return title.indexOf(q) !== -1 || body.indexOf(q) !== -1;
    });
  }, [sections, q, lang]);

  if (view !== "help") return null;

  // Scroll to the section the « ? » asked for, ONCE.
  //
  // It waits for `sections` because the cards do not exist until the guide has
  // been fetched and parsed — this view renders nothing before that. It reads
  // the TopBar's MEASURED height rather than a constant: that bar is sticky and
  // overlays the content, and it grows with the safe-area inset and with the
  // user's text-size setting, so a hardcoded offset is wrong on most devices
  // (the same reason `data-topbar` exists for the wishlist reveal).
  //
  // `setHelpFocusKey("")` is what makes it once-only: without it, every later
  // re-render — a search keystroke, a fold toggled — would yank the page back.
  useEffect(() => {
    if (view !== "help" || !helpFocusKey || !sections) return;
    const el = document.querySelector(`[data-help-key="${helpFocusKey}"]`);
    if (el) {
      const bar = document.querySelector("[data-topbar]");
      const barH = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
      const y = window.scrollY + el.getBoundingClientRect().top - barH - 8;
      try { window.scrollTo({ top: Math.max(0, y), behavior: "auto" }); }
      catch (_e) { window.scrollTo(0, Math.max(0, y)); }
    }
    if (setHelpFocusKey) setHelpFocusKey("");
  }, [view, helpFocusKey, sections, setHelpFocusKey]);

  const allKeys = sections ? sections.map(s => s.key) : [];
  const anyExpanded = allKeys.some(k => !(collapsedHelpSections && collapsedHelpSections[k]));

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <style>{HELP_BODY_STYLES}</style>
      <ScreenWash color={C.brass} opacity={0.05} />
      <div style={{ paddingBottom: 80 }}>

        <TopBar
          leading={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconBtn icon="back"
                onClick={() => { if (closeDocPage) closeDocPage(); else if (nav) nav("home"); }}
                ariaLabel={t ? t("btn_back") : "Retour"} />
              <Orn color={C.brass} />
            </div>
          }
          trailing={null}
        />

        <PageTitle>
          {t ? t("help_title_prefix") : "Mode"} <span style={{ fontStyle: "italic", color: C.ivory }}>{t ? t("help_title_word") : "d'emploi"}</span>
        </PageTitle>

        <div style={{ padding: "0 12px 8px" }}>
          <p style={{ color: C.tx3, fontSize: fs(14.5), marginTop: -8, marginBottom: 14 }}>
            {/* Interpolate the live APP_VERSION so the subtitle
                never goes stale again (it was hand-frozen at v1.2 then v1.3). */}
            {String(t ? t("help_subtitle") : "Ma Cave à Tabac v{version} · Guide complet").replace("{version}", APP_VERSION)}
          </p>
        </div>

        {/* Search + expand/collapse controls */}
        <div style={{
          // The row WRAPS. The search field and the
          // collapse-all button share it, the button is `nowrap` and its label
          // is the longest thing here in German ("Alle einklappen", uppercase +
          // letter-spaced mono), so the field was squeezed to ~157 px while its
          // own placeholder ("Anleitung durchsuchen") needs ~171 — the hint
          // telling you what the box is for was the thing cut off. `flexWrap`
          // costs a line ONLY where the two do not fit and clips nothing; the
          // 220 px floor is what makes the row actually break instead of
          // shrinking the field further. Shortening the German was the other
          // option and is the one already tried and reverted elsewhere.
          //
          // Note `i18n:layout` cannot see this class at all: it measures TEXT
          // NODES, and a placeholder is an attribute.
          margin: "0 12px 14px", display: "flex", gap: 8, alignItems: "center",
          flexWrap: "wrap",
          ...e,
        }}>
          <div style={{ flex: "1 1 220px", minWidth: 0, position: "relative" }}>
            <span style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: C.tx3, display: "inline-flex", pointerEvents: "none",
            }}>
              <Ico name="search" size={14} sw={1.7} />
            </span>
            <input
              type="search"
              value={query}
              onChange={ev => setQuery(ev.target.value)}
              placeholder={t ? t("help_search_placeholder") : "Chercher dans le guide"}
              aria-label={t ? t("help_search_placeholder") : "Chercher dans le guide"}
              style={{
                width: "100%", padding: "10px 12px 10px 32px",
                background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
                color: C.ivory, fontSize: fsInput(15), fontFamily: F.body,
                outline: "none", boxSizing: "border-box",
                ...searchRing.style,
              }}
              onFocus={searchRing.onFocus}
              onBlur={searchRing.onBlur}
            />
          </div>
          {sections && allKeys.length > 0 && (
            <button
              type="button"
              onClick={() => setAllHelpSectionsCollapsed && setAllHelpSectionsCollapsed(anyExpanded, allKeys)}
              style={{
                padding: "9px 12px", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
                color: C.brassHi, fontSize: fs(13.5), fontFamily: F.mono, fontWeight: 600,
                letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap",
              }}
              aria-label={anyExpanded
                ? (t ? t("aria_collapse_all") : "Tout replier")
                : (t ? t("aria_expand_all") : "Tout déplier")}>
              {anyExpanded
                ? (t ? t("btn_collapse_all") : "Tout replier")
                : (t ? t("btn_expand_all") : "Tout déplier")}
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "0 12px" }}>
          {error && (
            <div style={{
              padding: "16px", background: C.panelWarn, border: `1px solid ${C.oxbloodHi}`,
              borderRadius: 8, color: C.oxbloodHi, fontSize: fs(15),
            }}>
              {/* Kept inline — interpolation. */}
              {t
                ? String(t("help_load_error")).replace("{e}", String(error))
                : `Impossible de charger le guide (${error}). Recharge l'application.`}
            </div>
          )}
          {!error && !sections && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.tx3, fontSize: fs(15) }}>
              {t ? t("lbl_loading_dots") : "Chargement…"}
            </div>
          )}
          {!error && sections && filtered.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.tx3, fontSize: fs(15) }}>
              {t ? t("help_no_match") : "Aucune section ne correspond."}
            </div>
          )}
          {!error && sections && filtered.map(s => {
            const title = pickLang(s.titles, lang) || "";
            const body = pickLang(s.bodies, lang) || "";
            const collapsed = !!(collapsedHelpSections && collapsedHelpSections[s.key]);
            // While a search query is active, force every matching
            // section open so the user can see the hit in context.
            const forceOpen = q.length > 0;
            const open = forceOpen || !collapsed;
            return (
              <div key={s.key} data-help-key={s.key} style={{
                marginBottom: 12,
                background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 10,
                overflow: "hidden",
              }}>
                <button
                  type="button"
                  onClick={() => toggleHelpSection && toggleHelpSection(s.key)}
                  aria-expanded={open}
                  aria-controls={`help-body-${s.key}`}
                  style={{
                    width: "100%", padding: "14px 16px",
                    background: "transparent", border: "none",
                    display: "flex", alignItems: "center", gap: 10,
                    cursor: "pointer", textAlign: "left",
                    color: C.ivory, fontFamily: F.display, fontSize: fs(17),
                    fontStyle: "italic", letterSpacing: -0.2,
                  }}>
                  <span style={{ flex: 1 }}>{title}</span>
                  <span style={{
                    color: C.brassHi,
                    transform: open ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 200ms cubic-bezier(.2,.7,.3,1)",
                    display: "inline-flex",
                  }}>
                    <Ico name="chevron" size={14} sw={2} />
                  </span>
                </button>
                {open && (
                  // Explicit trust decision documented here.
                  // `body` is parsed from `./help.html` — same-origin
                  // static asset shipped by us. The HTML never carries
                  // <script> (the parser slices between <h2> anchors)
                  // and the CSP `script-src` doesn't allow inline JS
                  // anyway, so even an injected <script> would be a
                  // no-op. The only realistic threat is a deploy-pipeline
                  // compromise, which is an upstream concern. Do NOT
                  // wire this to any user-provided content — call
                  // sanitization explicitly (DOMPurify) before doing so.
                  <div id={`help-body-${s.key}`} className="help-body"
                    style={{ padding: "0 12px 16px" }}
                    dangerouslySetInnerHTML={{ __html: body }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {sections && (
          <div style={{
            margin: "20px 16px 0", paddingTop: 16,
            borderTop: `1px solid ${C.rule}`,
            textAlign: "center",
          }}>
            <Lbl color={C.tx3}>
              {(t ? t("app_name") : "Ma Cave à Tabac") + " · "}<a href="https://t-cellar.app" target="_blank" rel="noopener noreferrer" style={{ color: C.brass, textDecoration: "none" }}>t-cellar.app</a>
            </Lbl>
          </div>
        )}
      </div>
    </div>
  );
}
