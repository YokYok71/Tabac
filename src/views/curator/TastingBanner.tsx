// Curator TastingBanner — fixed banner shown above all screens when a tasting
// is in progress but the user has navigated away from /tasting. Mirrors the
// behaviour.

import { useEffect, useRef, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Ico } from "../../components/curator/icons.tsx";
import { Lbl } from "../../components/curator/primitives.tsx";
import { formatTastingTime as formatMs } from "../../hooks/useTastingSession.ts";

export function CuratorTastingBanner({ onHeight, topInset }: { onHeight?: (h: number) => void; topInset?: number }) {
  const ctx = useAppCtx();
  const {
    view, t, tasting, tastingElapsedMs, tastingResume,
    tastingOvertimePrompt, tastingOvertimeRemainingMs,
    tastingPostponeOvertime, tastingEnd,
    nav,
  } = ctx;
  // Sit below whichever `top: 0` banner is up, instead of sharing its
  // rectangle. `topInset` is the measured height of that banner;
  // this banner is z2001 so without the offset it simply painted OVER a save
  // failure or a quota warning.
  //
  // The old `autoUpdateCountdown ? 44 : 0` term was also DROPPED: the
  // countdown moved from a ~15 px strip at top:0 to a centred
  // Modal, so those 44 px had been reserving space for something that no
  // longer exists — the banner just dropped for no reason while the dialog
  // was up.
  const topOffset = topInset || 0;
  // Tick the elapsed time every second so the timer updates live.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tasting || tasting.stage !== "running") return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
    // The effect only re-subscribes when the tasting transitions in or
    // out of "running" — other fields on the `tasting` object (lotId,
    // weightG, dateOpened, etc.) change during the session but must not
    // tear down the 1-Hz tick interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasting?.stage]);

  // Report the banner's *content* height to the parent so it can reserve
  // that much top padding on the scroll column — otherwise the fixed banner
  // overlays each view's TopBar and hides the search / settings / cloud /
  // trash icons while a tasting runs. We report offsetHeight MINUS the
  // banner's own safe-area top padding: the view's TopBar re-provides the
  // notch clearance, so subtracting it avoids a double safe-area gap. When
  // the banner is hidden (returns null below) we report 0.
  // `HTMLElement` et non `HTMLDivElement` : les deux branches ne rendent pas la
  // même balise — la bannière DÉPASSEMENT est un `<div>` (elle contient déjà
  // ses deux boutons), celle EN COURS est elle-même un `<button>`. La ref ne
  // sert qu'à mesurer la hauteur, donc l'ancêtre commun suffit.
  const rootRef = useRef<HTMLElement | null>(null);
  // Une ref de RAPPEL, parce que `Ref<T>` est invariant en TypeScript : un
  // `RefObject<HTMLElement>` ne s'assigne ni à `Ref<HTMLDivElement>` ni à
  // `Ref<HTMLButtonElement>`. Une fonction qui ACCEPTE le type large convient
  // aux deux, et rien n'est élargi au-delà de ce que la mesure demande.
  const setRoot = (el: HTMLElement | null) => { rootRef.current = el; };
  const running = !!tasting && tasting.stage === "running";
  const onTastingView = view === "tasting";
  const overtimeNow = running && tastingOvertimePrompt ? tastingOvertimePrompt() : false;
  // The in-progress banner is hidden on the tasting screen itself, but the
  // overtime banner shows everywhere — so it reserves space even there.
  const visible = running && (overtimeNow || !onTastingView);
  useEffect(() => {
    const report = onHeight;
    if (!report) return;
    const el = rootRef.current;
    if (!visible || !el) { report(0); return; }
    const measure = () => {
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
      const pt = cs ? (parseFloat(cs.paddingTop) || 0) : 0;
      report(Math.max(0, el.offsetHeight - pt));
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); };
  }, [visible, topOffset, onHeight]);

  if (!tasting || tasting.stage !== "running") return null;

  const ms = tastingElapsedMs ? tastingElapsedMs() : 0;
  const paused = tasting.pauseStartTs !== null && tasting.pauseStartTs !== undefined;
  const overtime = tastingOvertimePrompt ? tastingOvertimePrompt() : false;

  // Overtime banner overrides everywhere (including the tasting view itself)
  if (overtime) {
    const remaining = tastingOvertimeRemainingMs ? tastingOvertimeRemainingMs() : 0;
    return (
      <div ref={setRoot} style={{
        position: "fixed", top: topOffset, left: 0, right: 0, zIndex: 2001,
        background: `linear-gradient(135deg, ${C.oxblood}, ${alpha(C.oxblood, "dd")})`,
        color: C.ctaInk, fontFamily: F.body,
        paddingTop: `max(env(safe-area-inset-top, 0), 10px)`,
        paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
        display: "flex", alignItems: "center", gap: 10,
        boxShadow: "0 4px 18px rgba(0,0,0,0.5)",
      }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: fs(15), lineHeight: 1.35, fontWeight: 600 }}>
          ⚠️ {t ? t("tasting_overtime_body") : "Ta séance dure depuis plus de 90 min — toujours en train de fumer ?"} {t ? t("tasting_overtime_auto_in") : "Clôture auto dans"} {formatMs(remaining)}
        </span>
        <button onClick={tastingPostponeOvertime}
          style={{
            background: "transparent", border: `1px solid ${alpha(C.ctaInk, "66")}`,
            borderRadius: 8, color: C.ctaInk, fontSize: fs(15), fontWeight: 700,
            padding: "6px 10px", cursor: "pointer", fontFamily: F.body,
          }}>
          {t ? t("tasting_overtime_extend") : "Continuer"}
        </button>
        <button onClick={tastingEnd}
          style={{
            background: C.ctaInk, border: `1px solid ${C.ctaInk}`,
            borderRadius: 8, color: C.oxblood, fontSize: fs(15), fontWeight: 700,
            padding: "6px 10px", cursor: "pointer", fontFamily: F.body,
          }}>
          {t ? t("tasting_overtime_end_now") : "Terminer"}
        </button>
      </div>
    );
  }

  // Hide regular in-progress banner while on the dedicated tasting screen
  if (view === "tasting") return null;

  // UN VRAI <button>, ET C'EST LE FOND DU CORRECTIF.
  //
  // C'était un `<div onClick>` sans `role`, sans `tabIndex`, sans gestionnaire
  // clavier, et — vérifié — SANS AUCUN DESCENDANT FOCALISABLE : la branche
  // « en cours » ne contient qu'une icône, un libellé et un chrono. Elle
  // s'affiche sur les cinq vues où la dégustation n'est pas à l'écran (tabacs,
  // pipes, accessoires, journal, stats), en se présentant comme le RACCOURCI
  // pour y revenir — et au clavier ce raccourci n'existait pas. Le détour
  // restait possible (Accueil, puis son propre appel à l'action), donc ce
  // n'était pas une impasse ; c'était un contrôle qui promet un chemin court
  // et ne l'offre qu'à la souris.
  //
  // `<button>` plutôt que `role="button"` + `tabIndex` + `onKeyDown` : Entrée
  // ET Espace viennent avec, l'anneau de focus aussi, et il n'y a rien à
  // synchroniser. La branche DÉPASSEMENT au-dessus portait déjà deux vrais
  // boutons, donc pas d'imbrication interactive ici. Les valeurs par défaut du
  // navigateur (bordure, fond, police, alignement) sont écrasées explicitement
  // pour que le rendu reste identique au pixel.
  return (
    <button
      type="button"
      ref={setRoot}
      // PAS d'`aria-label` — et c'est délibéré. Un libellé posé sur le
      // conteneur REMPLACE tout son sous-arbre dans le nom accessible : on
      // entendrait « Reprendre, bouton » à la place de « Séance en cours
      // 12:34 », c'est-à-dire qu'on perdrait l'état et le chrono, qui sont la
      // seule chose que cette bannière apporte. Son contenu EST son nom, et
      // « bouton » vient du rôle.
      onClick={() => {
        if (tastingResume) tastingResume();
        else if (nav) nav("tasting");
      }}
      style={{
        position: "fixed",
        top: topOffset, left: 0, right: 0, zIndex: 180,
        border: "none", margin: 0, textAlign: "left", font: "inherit",
        width: "100%",
        background: paused
          ? `linear-gradient(135deg, ${C.tx2}, ${C.tx3})`
          : `linear-gradient(135deg, ${C.oxblood}, ${C.ember})`,
        color: paused ? C.bg : C.ctaInk,
        boxShadow: paused
          ? "0 4px 14px rgba(0,0,0,0.4)"
          : `0 4px 18px ${alpha(C.oxblood, "88")}`,
        cursor: "pointer",
        paddingTop: `max(env(safe-area-inset-top, 0), 8px)`,
        paddingBottom: 8, paddingLeft: 16, paddingRight: 16,
        display: "flex", alignItems: "center", gap: 12,
        fontFamily: F.body,
      }}>
      {/* Both of these were hardcoded WHITE, which only works on the
          RUNNING ground (oxblood→ember, dark). The PAUSED ground is built from
          TEXT tokens (`C.tx2`→`C.tx3`), so in dark mode it is LIGHT — the label
          measured 2.05:1 and this chip 1.18:1, i.e. invisible. Line ~127 already
          inverts the main text (`paused ? C.bg : C.ctaInk`); these two now
          follow the same inversion instead of contradicting it. No `alpha()` on
          the LABEL: de-emphasising text by translucency is banned here
          — small letter-spaced uppercase is already subordinate.
          Never caught because the fixture seeds no active tasting. */}
      <div style={{
        width: 32, height: 32, borderRadius: 9,
        background: alpha(paused ? C.bg : C.ctaInk, "22"),
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Ico name={paused ? "pause" : "flame"} size={16} sw={1.9} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Lbl color={paused ? C.bg : C.ctaInk} size={9.5}>
          {paused
            ? (t ? t("tasting_paused") : "En pause")
            : (t ? t("tasting_in_progress") : "Séance en cours")}
        </Lbl>
        <div style={{
          fontFamily: F.display, fontStyle: "italic", fontSize: fs(18),
          lineHeight: 1.1, letterSpacing: -0.3,
          fontVariantNumeric: "tabular-nums",
        }}>
          {formatMs(ms)}
          {overtime && (
            <span style={{ marginLeft: 8, fontSize: fs(15), opacity: 0.85 }}>
              ⚠ {t ? t("tasting_overtime_short") : "dépassement"}
            </span>
          )}
        </div>
      </div>
      <Ico name="chevron" size={18} sw={2.2} />
    </button>
  );
}
