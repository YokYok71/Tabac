// First-run consent screen. Blocks the app until the user accepts the
// privacy notice.

import { useState } from "react";
import { LANGUAGES } from "../../i18n/languages.ts";
import { useAppCtx } from "../../AppContext.tsx";
import { APP_VERSION, APP_BUILD } from "../../constants.ts";
import { alpha, fs, C, F, CARD_BG } from "../../theme-curator.ts";
import { Lbl, PressCard } from "../../components/curator/primitives.tsx";
import { Ico, Orn } from "../../components/curator/icons.tsx";

export function CuratorTermsGate() {
  const ctx = useAppCtx();
  const { t, lang, saveLang, acceptTerms, langPending, langErr } = ctx;
  const [agreed, setAgreed] = useState(false);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: `radial-gradient(circle at 30% 15%, ${C.washMoss}, ${C.bg} 70%), ${C.bg}`,
      display: "flex", justifyContent: "center", alignItems: "stretch",
      fontFamily: F.body, color: C.tx, overflow: "auto",
    }}>
      {/* `margin: auto 0`, NEVER `justifyContent: center`.
          This column used to be centred with `justify-content: center` while
          the ROOT is `overflow: auto`, and that combination loses the top of
          the screen the moment the content is taller than the viewport:
          centring overflows the content EQUALLY in both directions, and
          `scrollTop` cannot go below 0, so the part above the start edge is
          unreachable — not merely scrolled off, unreachable.

          MEASURED before the fix, with `scrollTop` forced to -9999 (it stayed
          0) and `elementFromPoint` returning nothing: the language toggle sat
          at y = -55 at 390x844 in French — the app's own reference width — at
          -67 in German, at -167 on an iPhone SE, and at -273 at 360x640 in
          German at the "L" text size, where the title went with it. Only
          >= 412 px wide escaped. So on essentially every phone, the FIRST
          screen of the app opened with its top cut off and the language
          switcher — the one control a non-French speaker needs before
          anything else works — could not be reached at all. iOS is worse
          still: the safe-area inset adds to the padding below.

          Cross-axis `auto` margins are the fix rather than `safe center`
          because they need no modern keyword: per flexbox, an item with an
          auto cross margin is NOT stretched and absorbs the free space, and
          when that space is NEGATIVE the auto margins compute to zero — so it
          is centred when it fits and flush to the top, scrollable, when it
          does not. Exactly the two behaviours wanted, with no fallback to
          reason about. */}
      <div style={{
        width: "100%", maxWidth: 560, margin: "auto 0",
        padding: `max(env(safe-area-inset-top, 0), 22px) 24px 24px`,
        display: "flex", flexDirection: "column", gap: 22,
      }}>

        {/* Language toggle (top-right) */}
        {saveLang && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -10 }}>
            <div style={{
              display: "inline-flex", border: `1px solid ${C.rule}`,
              background: C.bg2, borderRadius: 8, overflow: "hidden",
            }}>
              {/* DERIVED from LANGUAGES. This toggle offered fr and
                  en only — unchanged since es/de/it were added, so
                  four languages were missing from the FIRST screen a new user
                  sees, on a screen whose whole job is being readable before
                  anything else works. It looked deliberate, which is why it
                  survived three language additions; found by doc:check gate 15
                  once that gate learned to read a language ARRAY. */}
              {LANGUAGES.map(({ code, label }, i) => {
                const on = lang === code;
                return (
                  <button key={code} type="button" onClick={() => saveLang(code)}
                    style={{
                      padding: "6px 12px", border: "none",
                      background: on ? C.brass : "transparent",
                      color: on ? C.bg : C.tx,
                      cursor: "pointer", fontFamily: F.body, fontWeight: on ? 700 : 500,
                      fontSize: fs(13.5), letterSpacing: 0.4,
                      borderLeft: i > 0 ? `1px solid ${C.rule}` : "none",
                    }}>{label}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* The gate is the ONE screen where a failed language switch
            used to be completely silent — it called saveLang and rendered
            neither the spinner nor the error, so tapping FR offline changed
            nothing at all with no explanation. English is compiled in, so only
            the FR tap can fail here. Deliberately plain text, not the Notice
            primitive: the gate renders before the app shell and keeps its own
            minimal vocabulary. */}
        {(langPending || langErr) ? (
          <div style={{
            textAlign: "right", marginTop: -6, marginBottom: -10,
            fontSize: fs(12), color: langErr ? C.amber : C.tx3, lineHeight: 1.4,
          }}>
            {langErr
              ? (t ? t("lang_offline_err") : "Cette langue doit être téléchargée une première fois. Reconnectez-vous, puis rechargez l'application : réessayer depuis cet écran ne relance pas le téléchargement.")
              : (t ? t("lang_loading") : "Téléchargement de la langue…")}
          </div>
        ) : null}

        {/* Logo / wordmark */}
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Orn color={C.brass} />
            <span style={{
              fontFamily: F.display, fontStyle: "italic", fontSize: fs(17),
              color: C.brassHi, letterSpacing: 0.2,
            }}>{t ? t("app_name") : "Ma Cave à Tabac"}</span>
            <Orn color={C.brass} />
          </div>
          <div style={{
            fontFamily: F.display, fontSize: fs(40), color: C.ivory,
            letterSpacing: -0.6, lineHeight: 1.05, marginTop: 14,
          }}>
            {t ? t("terms_welcome_pre") : "Bienvenue dans votre"}<br/>
            <span style={{ fontStyle: "italic", color: C.title }}>
              {t ? t("terms_welcome_noun") : "cave"}
            </span>
          </div>
        </div>

        {/* Privacy summary card */}
        <div style={{
          padding: "18px 20px",
          background: CARD_BG, border: `1px solid ${C.rule}`, borderRadius: 12,
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: C.sage, display: "inline-flex" }}>
              <Ico name="check" size={20} sw={1.8} />
            </span>
            <Lbl color={C.sage}>{t ? t("terms_your_data") : "Vos données, à vous seul"}</Lbl>
          </div>
          <div style={{
            fontSize: fs(15), color: C.cream, lineHeight: 1.65,
          }}>
            {t ? t("terms_local_pre") : "L'application stocke tout"}{" "}
            <strong style={{ color: C.brassHi }}>{t ? t("terms_local_strong") : "localement sur votre appareil"}</strong>
            {t ? t("terms_local_post") : ". Rien n'est envoyé ailleurs sauf si vous activez une sauvegarde cloud (Dropbox ou Google Drive) ou utilisez l'assistant IA optionnel."}
          </div>

          {/* Best-effort warranty + backup reminder (i18n keys
              terms_point_warranty / terms_point_backup). */}
          <div style={{
            marginTop: 14, paddingTop: 14, borderTop: `1px dotted ${C.rule2}`,
            display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, fontSize: fs(15), color: C.tx2, lineHeight: 1.55,
          }}>
            <div>{t ? t("terms_point_warranty") : "⚠️ L'application est mise à disposition gratuitement, en mode « best effort » et « telle quelle » — sans garantie de disponibilité ni de conservation des données. Un navigateur peut effacer son cache, un appareil peut tomber en panne."}</div>
            <div>{t ? t("terms_point_backup") : "💾 Pense à exporter régulièrement tes données (Paramètres → Exporter JSON) ou à activer une sauvegarde cloud (Dropbox recommandé, Google Drive possible)."}</div>
          </div>

          {/* Intentionally a DIRECT link to the published ./privacy.html,
              NOT the in-app privacy view: the TermsGate renders BEFORE the
              app (the curator views aren't mounted yet), and Google's OAuth
              verification requires the privacy policy to be reachable at a
              public URL from a plain browser. Do not convert to nav(). */}
          <a href="./privacy.html" target="_blank" rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14,
              color: C.brassHi, fontSize: fs(15), textDecoration: "none",
              fontFamily: F.body, fontWeight: 600,
            }}>
            <Ico name="check" size={13} sw={1.8} />
            {t ? t("terms_read_full") : "Lire la politique de confidentialité complète"}
            <Ico name="chevron" size={12} sw={1.8} />
          </a>
        </div>

        {/* Agree checkbox */}
        <PressCard onClick={() => setAgreed(a => !a)} style={{
          padding: "12px 16px",
          background: agreed ? alpha(C.brass, "1f") : C.bg2,
          border: `1px solid ${agreed ? C.brass : C.rule}`,
          borderRadius: 8, display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 5,
            background: agreed ? C.brass : "transparent",
            border: `1.5px solid ${agreed ? C.brass : C.rule2}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.bg, flexShrink: 0,
            transition: "background 200ms, border-color 200ms",
          }}>
            {agreed && <Ico name="check" size={14} sw={2.4} />}
          </div>
          <span style={{ flex: 1, fontSize: fs(15), color: agreed ? C.ivory : C.tx, lineHeight: 1.4 }}>
            {t ? t("terms_agree") : "J'ai lu et j'accepte la politique de confidentialité."}
          </span>
        </PressCard>

        {/* Continue */}
        <PressCard
          onClick={agreed ? acceptTerms : undefined}
          // Without this, PressCard computes role/tabIndex from
          // `onClick || ariaDisabled`, so while the box is unticked this renders
          // as a bare <div> — no role, not focusable, silent to a screen reader.
          // It is the FIRST screen and the only way into the app. It escaped the
          // ariaDisabled sweep twice over: no `cursor: "not-allowed"` (the marker
          // CLAUDE.md calls reliable) and the ternary is REVERSED
          // (`cond ? cb : undefined`), so the grep for the usual shape missed it.
          // jest-axe has no rule for a role-less pseudo-button, which is the
          // blind spot the codebase already documents.
          ariaDisabled={!agreed}
          style={{
            padding: "14px 18px", textAlign: "center",
            background: agreed
              ? `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`
              : C.card,
            color: agreed ? C.bg : C.tx3,
            border: agreed ? "none" : `1px solid ${C.rule}`,
            borderRadius: 10, fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
            boxShadow: agreed ? `0 8px 24px ${alpha(C.brass, "55")}` : "none",
            opacity: agreed ? 1 : 0.6,
            transition: "opacity 200ms, background 200ms",
          }}>
          {t ? t("terms_enter") : "Entrer dans la cave"}
        </PressCard>

        <div style={{ textAlign: "center", color: C.tx3, fontSize: fs(14.5), fontFamily: F.mono, letterSpacing: 1 }}>
          {/* eslint-disable-next-line tabac-local/no-hardcoded-jsx-text -- "v … · build N" is a version identifier, not translatable copy; matches the app's "vX.Y · Build N" changelog convention. */}
          v {APP_VERSION} · build {APP_BUILD}
        </div>
      </div>
    </div>
  );
}
