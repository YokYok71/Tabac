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
import { lsGet } from "../../utils/appStorage.ts";

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
      welcomed = lsGet(WELCOME_KEY) || "";
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
    // `capHeight` + un corps `flex:1; minHeight:0; overflowY:auto` — la forme
    // maison pour toute modale dont le contenu peut dépasser l'écran.
    //
    // ELLE MANQUAIT ICI, ET LE SYMPTÔME N'EST PAS « ça déborde » MAIS « on ne
    // peut pas scroller », signalé depuis un iPhone. Le fond de `Modal` porte
    // `overflowY:auto` ET `alignItems:center` : un enfant plus haut que son
    // conteneur centré déborde des DEUX côtés, et un conteneur qui défile ne
    // peut pas atteindre ce qui dépasse AVANT son origine. Le haut du texte
    // devenait donc inatteignable — pas seulement inconfortable, illisible.
    // C'est la raison d'être de `capHeight`, et cet appelant ne l'utilisait pas.
    //
    // Un avis diffusé est précisément le contenu dont la longueur n'est PAS
    // connue à l'écriture du composant : il vient de notice.json et peut
    // changer sans rebuild. Cette modale doit donc supposer le débordement,
    // jamais en dépendre. En-tête et bouton restent hors du défilement — le
    // « C'est noté » doit rester atteignable sans avoir à parcourir le texte.
    <Modal
      open={open}
      onClose={close}
      maxWidth={460}
      align="center"
      capHeight
      ariaLabel={heading}
    >
      <div style={{ padding: "26px 24px 4px", textAlign: "center", flexShrink: 0 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <Orn color={accent} />
          <Lbl color={accent} size={11}>
            {t ? t("notice_kicker") : "Annonce"}
          </Lbl>
          <Orn color={accent} />
        </div>

        {/* `flex` + `margin: 0 auto`, PAS `inline-flex`. MESURÉ dans Chromium :
            en inline-flex la pastille se posait à x=212 alors que le bandeau
            « ◆ NOTICE ◆ » finissait à x=212 — les deux sur la MÊME ligne,
            collées, la pastille mordant le losange de droite. Deux frères
            inline s'enchaînent, et le `marginBottom` que chacun portait dit
            bien qu'ils étaient pensés empilés. Antérieur à ce correctif : les
            deux `display` sont identiques dans la version précédente. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 52, height: 52, borderRadius: 26,
          background: alpha(accent, "1f"), border: `1px solid ${alpha(accent, "55")}`,
          color: accent, margin: "0 auto 14px",
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
      </div>

      {notice.body && (
        // `minHeight:0` est porteur : un enfant flex vaut `min-height:auto` et
        // refuse de descendre sous la hauteur de son contenu — sans lui, la
        // région ne défile pas et le débordement revient tel quel.
        <div style={{
          flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
          padding: "0 24px",
        }}>
          <div style={{
            fontSize: fs(15), color: C.tx2, lineHeight: 1.55,
            maxWidth: 380, margin: "0 auto",
            fontFamily: F.body, whiteSpace: "pre-wrap",
            // ALIGNÉ À GAUCHE, contre le centrage du titre. Un avis peut être
            // une phrase — centrée, elle allait bien — mais celui-ci porte
            // quatre étapes numérotées, et des lignes centrées font perdre le
            // début de chacune. Le composant ne connaît pas la longueur de ce
            // qu'il affiche : la gauche est le seul alignement correct pour
            // les deux cas.
            textAlign: "left",
          }}>
            {notice.body}
          </div>
        </div>
      )}

      <div style={{ padding: "18px 24px 22px", flexShrink: 0 }}>
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
