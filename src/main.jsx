import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { EB } from './App.tsx'
// The two seeds below go through lsSet (crash-safe wrapper) rather
// than raw setItem — this file was outside ESLint's scope for a long time, so
// the no-raw-storage-write rule had never seen them.
import { lsSet } from './utils/appStorage.ts'
import { detectUiLang } from './utils.ts'
import { LANGUAGES } from './i18n/languages.ts'
import { ensureLang } from './i18n.ts'
import { applyTheme } from './theme-curator.ts'
import { isFramed, renderFramedNotice, tryBustOut } from './utils/frameGuard.ts'

// Refuse to run inside someone else's frame. The CSP's
// `frame-ancestors 'none'` is INERT in a <meta> (CSP3 §3.3 requires the UA to
// drop it) and GitHub Pages cannot send the header — see frameGuard.ts for the
// full reasoning and for why "do not render" is the defence rather than the
// bust-out. Computed FIRST so nothing else in this file runs for a framed
// document; the mount and the service-worker registration are both gated on it.
const FRAMED = isFramed()

// Seed the colour theme onto <html> BEFORE React mounts so the
// steel-blue theme paints from frame 1 (no brass→steel flash). Layout-neutral
// (only sets CSS custom properties), same safe pre-mount pattern as cave-lang.
try { applyTheme(localStorage.getItem('cave-theme') || 'brass', localStorage.getItem('cave-theme-mode') || 'dark') } catch { /* ignore */ }

// THE APP OWNS SCROLL RESTORATION — tell the browser to stop.
//
// Reported from the app: open a blend in the catalogue, close it with a
// left-edge swipe, and you land at the TOP of the 1222-row list instead of
// where you were. Closing with the × or Escape is fine — only the swipe.
//
// It is not the app scrolling. Traced in a browser: `window.scrollTo` is never
// called, the document never shrinks (75 030 px and 1222 rows throughout), and
// `Modal`'s focus restore lands on the right row with the scroll still intact
// at 12 000. The jump happens AFTER every handler has run, which is the
// browser restoring the scroll position recorded on the history entry being
// returned to — and `useBackNavigation` seeds that entry at mount, when the
// scroll is 0.
//
// The app already owns this: `scrollSaveRef` + `restoreScrollY` for the
// restore paths, `scrollToTopRef` for forward navigation. The browser doing it
// too is a straight conflict, and the browser wins because it acts last. This
// is why the defect is INVISIBLE almost everywhere — most back paths navigate
// to a view whose scroll the app then restores explicitly, painting over the
// browser's 0. The catalogue merely closes a modal, so nothing re-scrolls and
// the 0 stands.
//
// It MUST be set here, before anything else runs: `scrollRestoration` is a
// property of the CURRENT history entry, so setting it later leaves the entry
// you navigate BACK to on 'auto'. (Measured: setting it after load changed
// nothing, which briefly looked like a refutation of the diagnosis.)
try { if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual' } catch { /* ignore */ }

// First-launch UI-language detection. If the user has never
// picked a language (no `cave-lang`), seed it from the browser's preferred
// languages — mapped to a supported code, falling back to English. Runs here,
// BEFORE React mounts, so every `cave-lang` reader (the lang state AND
// initDateFormat) sees the detected value on the very first render. Returning
// users and anyone who has chosen a language are untouched (the key exists).
try {
  if (!localStorage.getItem('cave-lang')) {
    const codes = LANGUAGES.map((l) => l.code)
    const preferred = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : (navigator.language ? [navigator.language] : [])
    const detected = detectUiLang(preferred, codes)
    lsSet('cave-lang', detected)
    // Flag the auto-detection so the app can show a one-time
    // "language set automatically · change" toast. Cleared the moment the
    // user picks a language explicitly (terms gate or Settings), so it never
    // fires when the choice was deliberate.
    lsSet('cave-lang-auto', detected)
  }
} catch { /* localStorage unavailable (private mode) — App keeps its own default */ }

// Set <html lang> ONCE here, before React mounts, so screen readers
// pronounce the UI in the active language. This is deliberately NOT a React
// effect: the previous effect version was removed (App.tsx) because mutating
// documentElement AFTER mount dislodged the fixed bottom dock on the installed
// iOS PWA. A one-shot attribute set at startup is layout-neutral and safe. The
// attribute refreshes on the next launch after a language change in Settings.
//
// The value is VALIDATED against the registry first. It used to
// be written verbatim, so a corrupt `cave-lang` produced `<html lang="xx">`,
// `lang="constructor"` or `lang="{&quot;a&quot;:1}"` — none of them a BCP-47
// tag — while the UI itself rendered in English. The attribute exists for
// screen readers, so an invalid tag is worse than no tag: leaving the
// document's own `lang` in place at least keeps a valid one.
try {
  const lng = localStorage.getItem('cave-lang')
  if (lng && LANGUAGES.some((l) => l.code === lng)) document.documentElement.lang = lng
} catch { /* ignore */ }

// Localise the PRE-REACT boot shell (the "Chargement…" line in
// index.html and its 5s-delayed "repair the app" escape hatch). Those were
// French-only in all five languages, at the worst possible moment — the link is
// what a user reaches for when the app is broken.
//
// It is done HERE and not with an inline script in index.html on purpose: that
// document's CSP is `script-src 'self'` with NO 'unsafe-inline' (a documented
// security invariant), so an inline script would simply be blocked, and adding
// 'unsafe-inline' to translate two words would be a bad trade. This module is
// 'self', runs within milliseconds of parse, and therefore lands long before
// the repair link fades in at 5s. Residual: if the bundle itself never loads,
// the static French text remains — but that is precisely the case where the
// link's HREF matters and its label does not, and it is no worse than today.
try {
  const bootLng = (localStorage.getItem('cave-lang') || 'en').slice(0, 2)
  // The THIRD and FOURTH entries are the framed-document notice.
  // Deliberately the SAME table: these are all pre-mount strings that cannot
  // go through `t()`, and one table means one language axis, already covered
  // by doc:check gate 15. A second map here is exactly the shape a whole
  // release was once spent removing.
  const BOOT = {
    fr: ['Chargement…', "Rien ne se passe ? Réparer l'application →",
      "Ma Cave à Tabac ne s'affiche pas à l'intérieur d'un autre site, pour votre sécurité.", "Ouvrir l'application →"],
    en: ['Loading…', 'Nothing happening? Repair the app →',
      'Ma Cave à Tabac does not run inside another site, for your safety.', 'Open the app →'],
    es: ['Cargando…', '¿No pasa nada? Reparar la aplicación →',
      'Ma Cave à Tabac no se muestra dentro de otro sitio, por su seguridad.', 'Abrir la aplicación →'],
    de: ['Wird geladen…', 'Nichts passiert? App reparieren →',
      'Ma Cave à Tabac läuft zu deiner Sicherheit nicht innerhalb einer anderen Website.', 'App öffnen →'],
    it: ['Caricamento…', 'Non succede nulla? Ripara l\'app →',
      'Ma Cave à Tabac non viene mostrata all\'interno di un altro sito, per la tua sicurezza.', 'Apri l\'applicazione →'],
    pt: ['A carregar…', 'Nada acontece? Reparar a aplicação →',
      'A Ma Cave à Tabac não é apresentada dentro de outro site, para sua segurança.', 'Abrir a aplicação →'],
  }
  const pair = BOOT[bootLng] || BOOT.en
  if (FRAMED) {
    tryBustOut(window)
    renderFramedNotice(document, { title: pair[2], open: pair[3] }, window.self.location.href)
  }
  const shell = document.getElementById('root')
  const link = shell && shell.querySelector('a[href$="reset.html"]')
  if (link) {
    // The loading text is the shell's own first text node, before the link.
    const host = link.parentNode
    if (host && host.firstChild && host.firstChild.nodeType === 3) host.firstChild.nodeValue = pair[0]
    link.textContent = pair[1]
  }
} catch { /* boot shell already replaced by React, or no DOM — nothing to do */ }

// Not from inside a frame. Registering a service worker for a
// document we are refusing to render would install the app's whole offline
// machinery on behalf of a page the user never chose to open.
if (!FRAMED && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
}

// Load the ACTIVE language's dictionary before mounting.
// English is compiled in; the other four are separate chunks fetched on demand,
// which is what took the cold start from 303 KB to ~241 and unblocked a sixth
// language. `t()` stays synchronous, so the dictionary must be in memory before
// the first render — hence the await here rather than a Suspense boundary.
//
// `ensureLang` never rejects: it resolves false when the language is unknown or
// the chunk cannot be fetched (offline before it was ever cached, stale cache
// mid-deploy), and English then serves — which is the app's stated fallback
// rule, so the failure path needs no special handling here.
//
// The boot shell above is already showing "Loading…" in the right language, so
// this await is covered visually. It is one chunk (~16 KB gzip) on the critical
// path; the service worker is cache-first, so it costs nothing after the first
// visit in that language.
const mount = () => ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(EB, null, React.createElement(App))
)
// A framed document is never mounted — the notice above has already
// replaced #root and React must not paint the app over it. Written as a gate
// around the whole block, NOT as a `throw` inside the try: that catch calls
// `mount()`, so throwing would have mounted the app anyway. (Caught while
// writing it; the probe below would have caught it too.)
if (!FRAMED) try {
  const active = localStorage.getItem('cave-lang') || 'en'
  // And if the chunk never arrives, the UI is English, so the
  // attribute must say so too. Announcing English prose as German is the same
  // defect as announcing it as "constructor", one step further along. Still a
  // single pre-mount write, so the iOS constraint (never mutate
  // documentElement AFTER mount) holds.
  ensureLang(active).then((ok) => {
    if (!ok) { try { document.documentElement.lang = 'en' } catch { /* ignore */ } }
    mount()
  }, mount)
} catch {
  // localStorage unreadable (Safari private mode) — English is already in.
  mount()
}
