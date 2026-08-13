import React from "react";
import { LANG } from "../i18n.ts";
import { lsSet } from "../utils/appStorage.ts";

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
async function purgeCachesAndReload() {
  // Never purge while OFFLINE (audit HIGH).
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
  // the sibling call site (useAppUpdate `fireSilent`) and now in
  // `doUpdate`. This was the one purge path still missing it. Falling through
  // to the manual fallback screen is the right outcome: it explains itself and
  // leaves the caches intact.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
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
}
export class EB extends React.Component<
  { children?: React.ReactNode },
  { err: any; recovering: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { err: null, recovering: false };
  }
  static getDerivedStateFromError(e: any) {
    // Read-only: React can call getDerivedStateFromError more than once per
    // error in dev / Strict Mode. The flag write lives in
    // componentDidCatch (single call) so a re-render doesn't see its own
    // just-written timestamp and downgrade us to the manual UI.
    let recovering = false;
    if (isChunkLoadError(e)) {
      try {
        const last = parseInt(localStorage.getItem("cave-eb-recovery-ts") || "0", 10);
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
      // Fire-and-forget: purgeCachesAndReload triggers location.reload().
      void purgeCachesAndReload();
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
    const lang = (localStorage.getItem("cave-lang") || "en") as string;
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
              onClick={() => { void purgeCachesAndReload(); }}
              style={{
                padding: "12px 20px", minHeight: 44,
                background: "#d4a661", color: "#0e1311",
                border: "none", borderRadius: 8,
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}>
              {L.eb_retry_btn || "Vider le cache et recharger"}
            </button>
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
