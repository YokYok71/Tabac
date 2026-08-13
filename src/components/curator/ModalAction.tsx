// Shared <ModalAction> primitive — extracted from the
// dozen-or-so action buttons that close out a modal panel
// (LotFormModal, SettingsModal import picker / Drive confirm / update
// confirm / etc). Each site re-rolled the same brass-gradient vs
// transparent-border patterns with subtly different radii and
// fontWeights. Three visual variants are exposed:
//   - "primary"   → brass gradient, white text, shadow (Save / Confirm)
//   - "secondary" → transparent, rule border, tx color  (Cancel)
//   - "danger"    → oxbloodHi background, ivory text   (destructive)
//
// FormScreen's bottom bar handles its own save/cancel layout (it
// shares the same look but lives in FormFields.tsx). Use this for
// modal panels only.

import React from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { PressCard } from "./primitives.tsx";

export type ModalActionVariant = "primary" | "secondary" | "danger";

export interface ModalActionProps {
  variant?: ModalActionVariant;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Override the default flex behaviour; default is `flex: 1`. */
  style?: React.CSSProperties;
  /** Optional aria-label for icon-only buttons. */
  ariaLabel?: string;
}

export function ModalAction({
  variant = "primary", onClick, disabled, children, style, ariaLabel,
}: ModalActionProps) {
  const base: React.CSSProperties = {
    flex: 1, padding: "12px 16px", textAlign: "center",
    borderRadius: 8,
    fontFamily: F.body, fontSize: fs(15),
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    // Flex-center so a single-line label and a multi-line
    // label (e.g. "Ouvrir & enregistrer" wrapping on narrow screens)
    // are vertically aligned in the row. Without this, the single-
    // line button looked "floating" next to a 2-line peer.
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const variantStyle: React.CSSProperties =
    variant === "primary" ? {
      background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
      color: C.bg, border: "none", fontWeight: 700,
      boxShadow: `0 6px 18px ${alpha(C.brass, "55")}`,
    } :
    variant === "danger" ? {
      background: C.oxbloodHi, color: C.ivory,
      border: "none", fontWeight: 700,
    } : {
      background: C.bg2, color: C.tx,
      border: `1px solid ${C.rule}`, fontWeight: 500,
    };
  return (
    <PressCard
      onClick={disabled ? undefined : onClick}
      // Two fixes, both silent until they were found:
      //  1. This was `aria-label={ariaLabel}`, but PressCard's prop is
      //     `ariaLabel`. TypeScript did not catch it because it deliberately
      //     skips excess-property checking on HYPHENATED JSX attribute names
      //     (they can't be TS identifiers) — so the prop was accepted, dropped,
      //     and every icon-only ModalAction would have shipped with no
      //     accessible name. Latent: no caller passed it yet.
      //  2. `disabled` styled the button as unavailable (opacity 0.5,
      //     cursor:not-allowed) but never announced it.
      ariaLabel={ariaLabel}
      ariaDisabled={disabled}
      style={{ ...base, ...variantStyle, ...style }}>
      {children}
    </PressCard>
  );
}
