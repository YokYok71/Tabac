// One-shot welcome modal shown on first run.
// Shown once per user (localStorage flag `cave-curator-welcomed`).

import { useState, useEffect } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Lbl, PressCard } from "../../components/curator/primitives.tsx";
import { Orn } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { lsGet, lsSet } from "../../utils/appStorage.ts";
import { WELCOME_KEY } from "../../constants.ts";

const KEY = WELCOME_KEY;

export function CuratorWelcomeModal() {
  const ctx = useAppCtx();
  const { t } = ctx;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (lsGet(KEY) !== "1") {
        const r = requestAnimationFrame(() => setOpen(true));
        return () => cancelAnimationFrame(r);
      }
    } catch (_e) {}
  }, []);

  const dismiss = () => {
    lsSet(KEY, "1");
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={dismiss} maxWidth={480} align="center"
      ariaLabel={t ? t("welcome_title") : "Bienvenue"}>
      <div style={{ padding: "26px 24px 22px", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12,
        }}>
          <Orn color={C.brass} />
          <Lbl color={C.brassHi} size={11}>
            {t ? t("welcome_title") : "Bienvenue"}
          </Lbl>
          <Orn color={C.brass} />
        </div>

        <div style={{
          fontFamily: F.display, fontSize: fs(34), color: C.ivory,
          letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 8,
        }}>
          {t ? t("welcome_your") : "Votre"}{" "}
          <span style={{ fontStyle: "italic", color: C.title }}>
            {t ? t("terms_welcome_noun") : "cave"}
          </span>
        </div>

        <div style={{
          fontSize: fs(15), color: C.tx2, lineHeight: 1.55,
          maxWidth: 380, margin: "0 auto 22px",
          fontFamily: F.body,
        }}>
          {t ? t("welcome_drive_hint") : "Tout ce que vous enregistrez — tabacs, pipes, accessoires, séances — reste sur cet appareil. Depuis ⚙️ Paramètres, activez une sauvegarde cloud : elle protège vos données et synchronise plusieurs appareils entre eux. Dropbox est recommandé (session renouvelée automatiquement, plus fiable notamment sur iPhone/iPad) ; Google Drive reste disponible."}
        </div>

        <PressCard onClick={dismiss} style={{
          padding: "12px 14px", textAlign: "center",
          background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
          border: "none", borderRadius: 8,
          color: C.bg, fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
          boxShadow: `0 6px 18px ${alpha(C.brass, "55")}`,
        }}>
          {t ? t("welcome_got_it") : "C'est noté"}
        </PressCard>
      </div>
    </Modal>
  );
}
