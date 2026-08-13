// CatalogueMissing — no catalogue is loaded, and here is how
// to load one.
//
// It REPLACES the former `CatalogUnavailable`, whose whole subject no longer
// exists: that banner explained a failed CHUNK DOWNLOAD and offered a reload,
// because a dynamic `import()` that fails is remembered as a failure in the
// browser's module map and only a fresh JS context clears it. The app ships no
// chunk now, so there is nothing to re-download and a reload fixes nothing.
//
// What DOES carry over is that component's other finding, and it is the reason this
// component still exists rather than the surfaces simply rendering nothing:
// the entry forms marked themselves ready whether the catalogue had loaded or
// not, so a user typing a catalogued blend never saw the "fill the fiche in
// one tap" offer, nothing was wrong with what they typed, and nothing said so.
// A missing catalogue must be VISIBLE at the point where it would have helped
// — the same action↔feedback adjacency rule that put `CatalogOffer` directly
// under the brand field.
//
// The CTA opens Réglages → Données, which is the only place a catalogue can be
// loaded. `compact` is for the forms, where the banner sits inside a field
// stack and a full paragraph would push the fields the user is typing into off
// the screen.

import { Notice } from "./Notice.tsx";
import { ModalAction } from "./ModalAction.tsx";
import { useAppCtx } from "../../AppContext.tsx";

export interface CatalogueMissingProps {
  /** Drop the explanatory sentence, keeping the one-line offer. */
  compact?: boolean;
}

export function CatalogueMissing({ compact }: CatalogueMissingProps) {
  const { t, setImportModal, setSettingsTab } = useAppCtx();
  function open() {
    if (setSettingsTab) setSettingsTab("data");
    if (setImportModal) setImportModal(true);
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <Notice tone="info">
        <div style={{ marginBottom: 8 }}>
          {compact
            ? (t ? t("cat_missing_short") : "Aucun catalogue chargé — le catalogue est votre propre fichier.")
            : (t ? t("cat_missing_hint") : "Aucun catalogue chargé. Le catalogue est votre propre fichier : téléchargez le modèle depuis Réglages → Données, remplissez-le, puis chargez-le.")}
        </div>
        <ModalAction variant="secondary" onClick={open}>
          {t ? t("btn_cat_open_settings") : "Ouvrir Réglages → Données"}
        </ModalAction>
      </Notice>
    </div>
  );
}
