// Feature-announcement pop-up for the light/dark MODE
// (cave-theme-mode). Shows at every app open for a 3-week window
// (until THEMEMODE_NOTICE_EXPIRY_MS), then stops on its own. The user
// can also dismiss it permanently with "Ne plus afficher".
//
// Sequencing: like the startup-notice modal, it defers to the one-shot
// welcome modal — it only surfaces once `cave-curator-welcomed` is set,
// so a brand-new user never gets two pop-ups stacked at first launch.

import { useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Lbl, PressCard } from "../../components/curator/primitives.tsx";
import { Orn, Ico } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { lsSet } from "../../utils/appStorage.ts";
import { WELCOME_KEY as WELCOME_KEY_C } from "../../constants.ts";

const WELCOME_KEY = WELCOME_KEY_C;
// The notice was broadened (it now covers text size too) and
// re-broadcast — bumping the dismiss key to "-v2" resets the opt-out so
// users who tapped "Ne plus afficher" on the first version see it again.
const DISMISS_KEY = "cave-thememode-notice-dismissed-v2";
// RETIRED EARLY (the re-broadcast window was due to run to
// 2026-08-15). The app is now being shared publicly, and a newcomer meets
// light/dark mode and text size for the first time anyway: announcing them
// as "new" on the launch right after the welcome modal is pure noise for
// them. To reuse this component for a future announcement, set a fresh
// date here and bump the DISMISS_KEY suffix.
const EXPIRY_MS = Date.parse("2026-07-24T00:00:00Z");

export function CuratorThemeModeNoticeModal() {
  const ctx = useAppCtx();
  const { t } = ctx;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (Date.now() > EXPIRY_MS) return;                       // window closed
      if (localStorage.getItem(DISMISS_KEY) === "1") return;    // user opted out
      if (localStorage.getItem(WELCOME_KEY) !== "1") return;    // defer to welcome
    } catch (_e) {
      return;
    }
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Plain close (backdrop / esc / primary CTA): reappears next launch
  // until the window closes.
  const close = () => setOpen(false);
  // "Ne plus afficher": permanent opt-out.
  const dontShowAgain = () => {
    lsSet(DISMISS_KEY, "1");
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={close} maxWidth={460} align="center"
      ariaLabel={t ? t("thememode_notice_title") : "Affichage sur mesure"}>
      <div style={{ padding: "26px 24px 20px", textAlign: "center" }}>
        {/* Icon badge — its own centered line (was inline-flex, which let it
            sit BESIDE the kicker). */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 52, height: 52, borderRadius: 26,
            background: alpha(C.brass, "1f"), border: `1px solid ${alpha(C.brass, "55")}`,
            color: C.brassHi,
          }}>
            <Ico name="contrast" size={22} sw={1.7} />
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10,
        }}>
          <Orn color={C.brass} />
          <Lbl color={C.brassHi} size={11}>
            {t ? t("thememode_notice_kicker") : "Nouveau"}
          </Lbl>
          <Orn color={C.brass} />
        </div>

        <div style={{
          fontFamily: F.display, fontSize: fs(28), color: C.ivory,
          letterSpacing: -0.4, lineHeight: 1.15, marginBottom: 10, fontStyle: "italic",
        }}>
          {t ? t("thememode_notice_title") : "Affichage sur mesure"}
        </div>

        <div style={{
          fontSize: fs(15), color: C.tx2, lineHeight: 1.55,
          maxWidth: 380, margin: "0 auto 22px", fontFamily: F.body,
        }}>
          {/* The canonical string lives in i18n (thememode_notice_body); this inline
              fallback must mirror fr[key] byte-for-byte per doc:check gate b.2, so its
              breadcrumb can't be trimmed. The breadcrumb lint rule was taught to
              skip this shape, so the hand-written disable that used to sit here is gone. */}
          {t ? t("thememode_notice_body") : "Passez l'application en thème clair ou sombre, et choisissez la taille du texte (Petit / Moyen / Grand). Tout se règle dans Paramètres → Préférences."}
        </div>

        <PressCard onClick={close} style={{
          padding: "12px 14px", textAlign: "center",
          background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
          border: "none", borderRadius: 8,
          color: C.bg, fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
          boxShadow: `0 6px 18px ${alpha(C.brass, "55")}`,
        }}>
          {t ? t("welcome_got_it") : "C'est noté"}
        </PressCard>

        <PressCard onClick={dontShowAgain} style={{
          marginTop: 16, padding: "6px 12px", textAlign: "center",
          background: "transparent", border: "none",
          color: C.tx3, fontFamily: F.body, fontSize: fs(13.5),
          textDecoration: "underline", textUnderlineOffset: 3,
        }}>
          {t ? t("thememode_notice_dismiss") : "Ne plus afficher"}
        </PressCard>
      </div>
    </Modal>
  );
}
