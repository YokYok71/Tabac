// CatalogOffer — "this blend is in the reference catalogue, fill the form
// in one tap" (extracted from AICard).
//
// WHY IT LIVES HERE AND NOT IN AICard. The offer is triggered by TYPING the
// brand + name, but AICard sits at the very TOP of the form, above the
// Identité section. On a phone with the keyboard up, the brand field is
// mid-screen and the card is scrolled off the top — so the app recognised
// the blend and said so somewhere the user could not see. The offer now
// renders directly UNDER the brand field, i.e. under the input that
// triggered it: same action → feedback adjacency rule as the cloud-save
// status in Settings.
//
// Deliberately NOT a modal: the match is detected as the brand + name are
// typed, so a pop-up would interrupt typing and steal the iOS keyboard.

import { useState } from "react";
import { C, F, fs, alpha } from "../../theme-curator.ts";
import { Ico } from "./icons.tsx";
import { PressCard } from "./primitives.tsx";
import { Notice } from "./Notice.tsx";

export interface CatalogOfferProps {
  /** True when the typed brand+name matches the LOADED catalogue AND the tap
   *  will actually reach it — i.e. source "local", or "ai" with no API key
   *  configured (in which case the AI-first branch falls through to the
   *  catalogue anyway). Keying on the SETTING alone would suppress the offer
   *  on the one install that has no other way to fill a fiche. Computed by
   *  the caller. */
  show?: boolean | undefined;
  /** An AI fill is in flight — hold the offer back rather than stacking. */
  busy?: boolean | undefined;
  /** The AI surfaced an error — that message takes the floor. */
  error?: string | undefined;
  /** Runs the fill (the caller passes its own kind-bound aiAutoFill). */
  onApply: () => void;
  t?: ((k: string) => string) | undefined;
}

export function CatalogOffer({ show, busy, error, onApply, t }: CatalogOfferProps) {
  // Folds the offer away for the rest of this form. Scoped to the mount on
  // purpose — dismissing means "not for this entry", and the form unmounts
  // when it is saved or left.
  //
  // APPLYING dismisses it too. Reported from the app: "j'appuie
  // sur remplir la fiche mais le message ne disparaît pas". Only "Ignorer" set
  // this flag, and `show` is just "brand+name match a catalogue entry" — which
  // the fill does not change, since it writes the OTHER fields. So the offer to
  // fill a form that was just filled stayed on screen for ever, inviting the
  // same tap again. Present since the offer first shipped, in BOTH the
  // tobacco and wishlist forms, which is why the fix belongs here rather than
  // at either call site.
  const [dismissed, setDismissed] = useState(false);
  if (!show || busy || error || dismissed) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <Notice tone="success">
        <div style={{ marginBottom: 8 }}>
          {t ? t("ai_db_hint") : "Ce blend est dans votre catalogue — remplis la fiche en un tap, sans connexion."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PressCard
            // Dismiss BEFORE running the fill: the banner must go regardless of
            // what the fill does. A failure is already covered — the `error`
            // prop hides the offer and the message surfaces on the AI card.
            onClick={() => { setDismissed(true); onApply && onApply(); }}
            style={{
              padding: "8px 14px", borderRadius: 8,
              background: alpha(C.sageHi, "22"),
              border: `1px solid ${alpha(C.sageHi, "66")}`, color: C.sageHi,
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
            }}>
            <Ico name="check" size={12} sw={1.9} />
            {t ? t("ai_db_apply") : "Remplir la fiche"}
          </PressCard>
          <PressCard
            onClick={() => setDismissed(true)}
            style={{
              padding: "8px 14px", borderRadius: 8,
              background: "transparent",
              border: `1px solid ${C.rule}`, color: C.tx3,
              fontFamily: F.body, fontSize: fs(14.5),
            }}>
            {t ? t("ai_db_ignore") : "Ignorer"}
          </PressCard>
        </div>
      </Notice>
    </div>
  );
}
