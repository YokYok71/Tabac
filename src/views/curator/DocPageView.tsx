// Unified in-app static-doc view. One component renders
// EVERY simple shipped doc page (changelog / privacy / licenses) inside
// the curator shell, driven by the `view` key. The *.html files stay the
// source of truth (still published + served network-first), so the
// privacy policy and licenses remain reachable at their public URL
// directly from a browser — a hard requirement for Google's OAuth
// verification. HelpView keeps its own richer (search + collapse) view
// but shares the same language-resolution policy via docPage.ts.
//
// Language handling is content-only extensible: extractDocContent resolves
// `<div id="sec-<lang>">` dynamically with an en → fr → first-present
// fallback, so adding a language means authoring a section block in the
// .html page (+ an i18n dict), NOT touching this component.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { fs, C, F } from "../../theme-curator.ts";
import { extractDocContent } from "../../utils/docPage.ts";
import {
  Lbl, IconBtn, ScreenWash, TopBar, PageTitle, useEnter,
} from "../../components/curator/primitives.tsx";
import { Orn } from "../../components/curator/icons.tsx";

interface DocPageMeta {
  file: string;
  titleKey: string;
  fallbackTitle: string;
  // When set, a "open the web version ↗" link is shown in the footer so
  // the canonical public URL is always one tap away (privacy / licenses).
  webUrl?: string;
}

// Null-proto (keyed by the `view` string; a forged key must not
// resolve to Object.prototype and be treated as a valid doc page).
export const DOC_PAGES: Record<string, DocPageMeta> = Object.assign(Object.create(null), {
  changelog: { file: "./changelog.html", titleKey: "btn_whats_new", fallbackTitle: "Nouveautés" },
  privacy:   { file: "./privacy.html",   titleKey: "btn_privacy",   fallbackTitle: "Confidentialité", webUrl: "./privacy.html" },
  licenses:  { file: "./licenses.html",  titleKey: "btn_licenses",  fallbackTitle: "Licences",        webUrl: "./licenses.html" },
});

// Curator-themed re-skin covering every class used across the three
// pages (changelog tag/date/subtitle, privacy code, licenses
// tag/license-card/meta/license-text). Same "no CSS files" exception as
// HelpView — the dangerouslySet path can't reach per-element classes.
const DOC_BODY_STYLES = `
.doc-body { color: ${C.tx}; line-height: 1.7; font-size: ${fs(15)}; }
.doc-body h2 { color: ${C.ivory}; font-family: ${F.display}; font-style: italic; font-weight: 400; font-size: ${fs(18)}; margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid ${C.rule}; letter-spacing: -0.2px; }
.doc-body h2:first-child { margin-top: 4px; }
.doc-body h3 { color: ${C.brass}; font-size: ${fs(14)}; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
.doc-body p, .doc-body li { color: ${C.tx}; font-size: ${fs(15)}; }
.doc-body ul, .doc-body ol { padding-left: 22px; margin: 8px 0; }
.doc-body li { margin-bottom: 5px; }
.doc-body strong { color: ${C.ivory}; }
.doc-body em { color: ${C.tx2}; }
.doc-body a { color: ${C.brass}; text-decoration: none; }
.doc-body a:hover { text-decoration: underline; }
.doc-body code { background: ${C.bg2}; padding: 2px 6px; border-radius: 4px; font-size: ${fs(14.5)}; color: ${C.brass}; font-family: ${F.mono}; }
.doc-body .subtitle { color: ${C.tx3}; font-size: ${fs(14.5)}; margin-top: -2px; }
.doc-body .tag { display: inline-block; background: ${C.bg2}; border: 1px solid ${C.rule}; border-radius: 6px; padding: 2px 10px; font-size: ${fs(12.5)}; color: ${C.brass}; margin-right: 6px; vertical-align: middle; font-weight: 700; font-family: ${F.mono}; }
.doc-body .license-card { background: ${C.bg2}; border: 1px solid ${C.rule}; border-radius: 8px; padding: 14px 16px; margin: 10px 0 18px; }
.doc-body .license-card .meta { font-size: ${fs(13.5)}; color: ${C.tx3}; margin-bottom: 8px; }
.doc-body .license-card .license-text { font-size: ${fs(13.5)}; color: ${C.tx3}; white-space: pre-wrap; line-height: 1.5; font-family: ${F.mono}; }
.doc-body hr { border: none; border-top: 1px solid ${C.rule}; margin: 26px 0; }
`;

export function CuratorDocPageView() {
  const ctx = useAppCtx();
  const { view, lang, t, nav, closeDocPage } = ctx;
  const page: DocPageMeta | undefined = DOC_PAGES[view];

  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const e = useEnter(80);
  // Keyed on the file so switching changelog ↔ privacy ↔ licenses
  // refetches (a plain boolean fetchedRef would stick to whichever
  // loaded first).
  const lastFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!page) return;
    if (lastFileRef.current === page.file) return;
    lastFileRef.current = page.file;
    setHtml(null);
    setError(null);
    let cancelled = false;
    let ctrl: AbortController | null = null;
    try { ctrl = new AbortController(); } catch (_e) {}
    const timer = ctrl
      ? setTimeout(() => { try { ctrl!.abort(); } catch (_e) {} }, 15000)
      : null;
    fetch(page.file, ctrl ? { signal: ctrl.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(txt => { if (!cancelled) setHtml(txt); })
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

  const body = useMemo(() => {
    if (!html) return null;
    const raw = extractDocContent(html, lang);
    if (!raw) return null;
    // Any link inside → new tab, never blow away the SPA.
    return String(raw).replace(/<a\s+href=/gi, '<a target="_blank" rel="noopener noreferrer" href=');
  }, [html, lang]);

  if (!page) return null;

  const title = (t && t(page.titleKey)) || page.fallbackTitle;

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      <style>{DOC_BODY_STYLES}</style>
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

        <PageTitle>{title}</PageTitle>

        <div style={{ padding: "12px 12px 0", ...e }}>
          {error && (
            <div style={{
              padding: "16px", background: C.panelWarn, border: `1px solid ${C.oxbloodHi}`,
              borderRadius: 8, color: C.oxbloodHi, fontSize: fs(15),
            }}>
              {t
                ? String(t("doc_load_error")).replace("{e}", String(error))
                : `Impossible de charger la page (${error}). Recharge l'application.`}
            </div>
          )}
          {!error && !html && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.tx3, fontSize: fs(15) }}>
              {t ? t("lbl_loading_dots") : "Chargement…"}
            </div>
          )}
          {!error && html && !body && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.tx3, fontSize: fs(15) }}>
              {t ? t("doc_empty_page") : "Page vide."}
            </div>
          )}
          {!error && body && (
            // Trust decision: `body` is sliced from a same-origin static
            // asset we ship. No <script> survives the strip, and CSP
            // `script-src` forbids inline JS anyway. Never wire to user
            // content without explicit sanitization.
            <div className="doc-body"
              dangerouslySetInnerHTML={{ __html: body }} />
          )}
        </div>

        {html && (
          <div style={{
            margin: "20px 12px 0", paddingTop: 16,
            borderTop: `1px solid ${C.rule}`, textAlign: "center",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {page.webUrl && (
              // Google/OAuth constraint: the privacy & licenses pages must
              // stay reachable in a plain browser. The .html is still
              // published; this makes the canonical URL one tap away.
              <a href={page.webUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: C.brass, fontSize: fs(14.5), textDecoration: "none", fontFamily: F.mono }}>
                {(t ? t("doc_open_web") : "Ouvrir la version web") + " ↗"}
              </a>
            )}
            <Lbl color={C.tx3}>
              {(t ? t("app_name") : "Ma Cave à Tabac") + " · "}<a href="https://t-cellar.app" target="_blank" rel="noopener noreferrer" style={{ color: C.brass, textDecoration: "none" }}>t-cellar.app</a>
            </Lbl>
          </div>
        )}
      </div>
    </div>
  );
}
