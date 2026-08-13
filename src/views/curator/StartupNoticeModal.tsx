// On-demand broadcast pop-up.
//
// Pairs with the `useStartupNotice` hook (src/hooks/useStartupNotice.ts)
// which fetches `public/notice.json` at every mount. If the file
// declares a fresh (unseen) message, this modal pops up automatically
// the next time the user opens the app — without any new build /
// deploy. Editing the JSON on the live site is the only step required
// to push a message to every user.
//
// Sequencing rule: the welcome modal (one-shot first-run) takes
// precedence — if `cave-curator-welcomed` isn't set yet, the notice
// modal silently defers itself so a brand-new user isn't drowned in
// two pop-ups at once. It will surface on the next launch once the
// welcome is dismissed.

import { useEffect, useState } from "react";
import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Lbl, PressCard } from "../../components/curator/primitives.tsx";
import { Orn, Ico } from "../../components/curator/icons.tsx";
import { Modal } from "../../components/curator/Modal.tsx";
import { useStartupNotice } from "../../hooks/useStartupNotice.ts";
import { noticeToneColor, noticeDefaultIcon } from "../../components/curator/Notice.tsx";
import { WELCOME_KEY as WELCOME_KEY_C } from "../../constants.ts";

const WELCOME_KEY = WELCOME_KEY_C;

export function CuratorStartupNoticeModal() {
  const ctx = useAppCtx();
  const { t, lang } = ctx;
  const { notice, dismiss } = useStartupNotice(lang || "fr");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!notice) return;
    let welcomed: string;
    try {
      welcomed = localStorage.getItem(WELCOME_KEY) || "";
    } catch (_e) {
      welcomed = "1";
    }
    if (welcomed !== "1") return;
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, [notice]);

  if (!notice) return null;

  const close = () => {
    setOpen(false);
    dismiss();
  };

  const accent = noticeToneColor(notice.tone);
  const glyph = noticeDefaultIcon(notice.tone);
  const heading = notice.title || (t ? t("notice_default_title") : "Information");

  return (
    <Modal
      open={open}
      onClose={close}
      maxWidth={460}
      align="center"
      ariaLabel={heading}
    >
      <div style={{ padding: "26px 24px 22px", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <Orn color={accent} />
          <Lbl color={accent} size={11}>
            {t ? t("notice_kicker") : "Annonce"}
          </Lbl>
          <Orn color={accent} />
        </div>

        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 52, height: 52, borderRadius: 26,
          background: alpha(accent, "1f"), border: `1px solid ${alpha(accent, "55")}`,
          color: accent, marginBottom: 14,
        }}>
          <Ico name={glyph} size={22} sw={1.7} />
        </div>

        <div style={{
          fontFamily: F.display, fontSize: fs(28), color: C.ivory,
          letterSpacing: -0.4, lineHeight: 1.15, marginBottom: 10,
          fontStyle: "italic",
        }}>
          {heading}
        </div>

        {notice.body && (
          <div style={{
            fontSize: fs(15), color: C.tx2, lineHeight: 1.55,
            maxWidth: 380, margin: "0 auto 22px",
            fontFamily: F.body, whiteSpace: "pre-wrap",
          }}>
            {notice.body}
          </div>
        )}

        <PressCard onClick={close} style={{
          padding: "12px 14px", textAlign: "center",
          background: `linear-gradient(135deg, ${accent}, ${alpha(accent, "cc")})`,
          border: "none", borderRadius: 8,
          color: C.bg, fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
          boxShadow: `0 6px 18px ${alpha(accent, "55")}`,
        }}>
          {t ? t("welcome_got_it") : "C'est noté"}
        </PressCard>
      </div>
    </Modal>
  );
}
