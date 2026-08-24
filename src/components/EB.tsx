import React from "react";
import { LANG } from "../i18n.ts";
import { lsGet, lsSet } from "../utils/appStorage.ts";

// Extracted verbatim from App.tsx (it was a module-level,
// App-state-free block). App.tsx re-exports EB so importers (main.jsx,
// EB.test.tsx) are unchanged. Handles chunk-load-error auto-recovery (SW +
// caches purge → reload) with a 30 s anti-loop guard; falls back to a manual
// "clear cache & reload" screen. See the "EB chunk-load recovery" section in
// CLAUDE.md.

function isChunkLoadError(e: any): boolean {
  if (!e) return false;
  // `e` is guaranteed truthy by the early return above, so the old
  // `(e && e.message)` guard was a useless conditional (CodeQL
  // js/trivial-conditional). Plain `.message` member access — NOT optional
  // chaining: a `?.` here would trip doc:check's LANG-direct-lookup regex
  // (`\bLANG\b[^?]*?\?\.key`) into reading a bogus i18n key off the property
  // name, since the `import { LANG }` line above has no `?` before this point.
  // On a primitive `e` (string/number), `.message` is just undefined (no
  // throw) → falls back to `e` itself.
  const msg = String(e.message || e);
  return /Importing a module|module script|Failed to fetch dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|error loading dynamically imported module/i.test(msg);
}
// Can the app actually be re-downloaded? Everything below hangs on this
// question, and it must be answered BEFORE anything is deleted.
//
// `navigator.onLine` is checked first as a cheap short-circuit, but it is NOT
// the test — it reports whether an interface exists, not whether the site
// answers. MEASURED in Chromium with the server stopped and the interface up:
// `onLine` stays `true`, the old guard let the purge through, and one tap on
// an unvisited tab took the app to `chrome-error://chromewebdata/` —
// "ERR_CONNECTION_REFUSED", with the SW registration and every cache gone.
// A captive portal (hotel, airport, train), a mobile radio with no data, a DNS
// failure, a corporate firewall and a mid-deploy window all leave `onLine`
// true, so this was not a corner: it is the ordinary shape of "the network is
// there but the site is not".
//
// `cache: 'no-store'` is what makes the answer trustworthy: `sw.js` returns
// early for such a request (its third guard), so this genuinely reaches the
// network instead of being satisfied by the very cache we are about to
// destroy. The BODY is read too, because a captive portal answers 200 with its
// own page and `res.ok` alone would wave it through.
//
// The sibling page `public/reset.html` carries this exact probe, for these
// exact reasons — it was hardened first and this call site was missed.
async function appReachable(): Promise<boolean> {
  try { if (typeof navigator !== "undefined" && navigator.onLine === false) return false; } catch (_e) {}
  try {
    const res = await fetch("./?_probe=" + Date.now(), { cache: "no-store" });
    if (!res || !res.ok) return false;
    const body = await res.text();
    return body.indexOf('id="root"') >= 0;
  } catch (_e) { return false; }
}

/** Returns true when it actually purged (and therefore reloaded). */
async function purgeCachesAndReload(): Promise<boolean> {
  // Never purge while the app cannot be re-downloaded (audit HIGH).
  //
  // The recovery is triggered by a failed dynamic import — and offline, a lazy
  // chunk the user has never opened (Stats, Settings, Trash, Help, a language,
  // a catalogue chunk) fails EXACTLY that way, because the SW returns a 503 on
  // a cache miss it cannot fetch. So the ordinary offline act of tapping an
  // unvisited tab reached here and deleted every Cache Storage entry plus every
  // SW registration, then reloaded with no network to refill them: the working
  // offline app is gone and cannot boot until connectivity returns.
  //
  // Disproportionate on its face — a transient chunk miss answered by
  // destroying the installed app — and the identical guard already exists at
  // the sibling call site (useAppUpdate `fireSilent`) and in `doUpdate`.
  //
  // THE ASYMMETRY THAT SETTLES THE STRICTNESS, and it is the one `reset.html`
  // states: a probe that wrongly FAILS costs one tap on the manual button and
  // deletes nothing, while one that wrongly PASSES leaves the user with no
  // application at all. So it errs toward refusing. Falling through to the
  // manual fallback screen is the right outcome: it explains itself and leaves
  // the caches intact.
  if (!(await appReachable())) return false;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch (_e) {}
  location.reload();
  return true;
}
export class EB extends React.Component<
  { children?: React.ReactNode },
  { err: any; recovering: boolean; unreachable: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { err: null, recovering: false, unreachable: false };
  }
  static getDerivedStateFromError(e: any) {
    // Read-only: React can call getDerivedStateFromError more than once per
    // error in dev / Strict Mode. The flag write lives in
    // componentDidCatch (single call) so a re-render doesn't see its own
    // just-written timestamp and downgrade us to the manual UI.
    let recovering = false;
    if (isChunkLoadError(e)) {
      try {
        const last = parseInt(lsGet("cave-eb-recovery-ts") || "0", 10);
        // Only a VALID, recent (<30 s) stamp
        // suppresses auto-recovery (the genuine anti-loop case). A NaN stamp
        // (`Date.now() - NaN` is NaN, `>= 30000` false) or a FUTURE stamp
        // (clock corrected backward / forged — negative delta) must NOT
        // permanently pin the manual screen; treat either as "no recent
        // recovery" and allow one auto-purge.
        const validRecent = Number.isFinite(last) && last <= Date.now() && Date.now() - last < 30_000;
        // OFFLINE never enters the recovering state. The purge
        // is refused there (see purgeCachesAndReload), so claiming "Récupération
        // en cours…" would strand the user on a screen waiting for a reload
        // that is never coming. The manual fallback explains itself and leaves
        // the installed app intact — which is what an offline chunk miss
        // actually needs.
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (!validRecent && !offline) recovering = true;
      } catch (_e) {}
    }
    return { err: e, recovering };
  }
  componentDidCatch(error: any) {
    if (this.state.recovering && isChunkLoadError(error)) {
      try {
        lsSet("cave-eb-recovery-ts", String(Date.now()));
      } catch (_e) {}
      // NOT fire-and-forget any more. `getDerivedStateFromError` is
      // synchronous and static, so it cannot await the reachability probe — it
      // keeps the cheap `navigator.onLine` guess. This is where that guess is
      // CORRECTED: when the purge refuses (the site is unreachable), leaving
      // `recovering` set would strand the user on "Passage à la dernière
      // version…" waiting for a reload that is never coming — the exact
      // failure that method's own comment describes. Drop to the manual
      // screen, which explains itself and leaves the installed app intact.
      void purgeCachesAndReload().then((purged) => {
        if (!purged) this.setState({ recovering: false, unreachable: true });
      });
    }
  }
  render() {
    if (!this.state.err) return this.props.children;
    // ENGLISH, not French, on both counts. Only
    // `en` is compiled in, so `LANG.fr` is undefined unless French happened to
    // load — which collapsed `L` to `{}` and dropped every string to its
    // hardcoded French literal, in precisely the case this boundary exists for
    // (a chunk that failed to load). Measured: `cave-lang=de` with the German
    // dictionary absent rendered "⚠ Erreur de rendu" to a German user.
    // `lsGet`, NEVER a raw read. THIS LINE ONLY RUNS ONCE SOMETHING HAS
    // ALREADY CRASHED, and a browser that refuses site storage (Safari with
    // "Block all cookies", a blocked origin, an MDM profile) THROWS on the
    // access rather than returning null — so the boundary threw the identical
    // error while rendering the screen meant to explain it, React unmounted
    // the tree, and `#root` was left EMPTY. The boot shell in index.html,
    // including the "Réparer l'application" link, lives inside `#root` and had
    // already been replaced: a white page with no way out. The boundary may
    // not depend on anything that can be the thing that failed.
    const lang = (lsGet("cave-lang") || "en") as string;
    const L = ((LANG as any)[lang] || (LANG as any).en) || {};
    const isChunk = isChunkLoadError(this.state.err);
    if (this.state.recovering) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a0a0a",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, color: "#d4a661",
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16 }}>
              {/* "Passage à la dernière version…", not "Récupération en
                  cours…". This screen is reached when a lazy chunk fails to load, and
                  the overwhelmingly common cause is not a fault at all: the chunks are
                  content-hashed, so the moment a new build is deployed the OLD
                  SettingsModal / Stats / Trash / Help chunk stops existing on the
                  server. The first tap on one of those surfaces then 404s, lands here,
                  and purges + reloads onto the new build. Reported as "I tapped the
                  banner, it did not open the menu, it just updated by itself" — which
                  is exactly what happened, and the app called it a recovery. The new
                  wording is true in BOTH cases: after the purge you are on the current
                  version, whether the cause was a deploy or a genuinely stale cache. */}
                {L.eb_recovering || "Passage à la dernière version…"}
            </div>
          </div>
        </div>
      );
    }
    if (isChunk) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a0a0a",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        }}>
          <div style={{ maxWidth: 420, textAlign: "center", color: "#dcd4ba" }}>
            <div style={{ fontSize: 20, color: "#e89556", marginBottom: 12, fontWeight: 600 }}>
              {L.eb_chunk_title || "⚠ Mise à jour incomplète"}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "#b5ad95", marginBottom: 20 }}>
              {L.eb_chunk_body || "L'app a essayé de charger une nouvelle version mais le navigateur l'a refusée. Touchez le bouton pour vider le cache local et recharger."}
            </div>
            <button
              type="button"
              // A BUTTON THAT REFUSES MUST SAY SO. The purge now probes the
              // network first, so offline — which is exactly when this screen
              // is reached — the tap legitimately does nothing. Silence there
              // is the "dead control" failure this repo has already paid for
              // (`Vérifier les sauvegardes` answering three rows away, the
              // panel with no way out): the user taps, nothing moves, and they
              // cannot tell a refusal from a broken button. So the refusal is
              // reported, and it names what did NOT happen — nothing was
              // deleted — because that is the reassuring half and it is true.
              onClick={() => {
                void purgeCachesAndReload().then((purged) => {
                  if (!purged) this.setState({ unreachable: true });
                });
              }}
              style={{
                padding: "12px 20px", minHeight: 44,
                background: "#d4a661", color: "#0e1311",
                border: "none", borderRadius: 8,
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}>
              {L.eb_retry_btn || "Vider le cache et recharger"}
            </button>
            {this.state.unreachable ? (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "#e89556", marginTop: 14 }}>
                {L.eb_unreachable || "Le site est injoignable : rien n'a été supprimé. Reconnectez-vous, puis réessayez."}
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0a",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        <div style={{
          color: "#e74c3c", fontFamily: "monospace", fontSize: 13,
          maxWidth: 480, wordBreak: "break-word",
        }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {L.eb_render_error || "⚠ Erreur de rendu"}
          </div>
          {String(this.state.err)}
        </div>
      </div>
    );
  }
}
