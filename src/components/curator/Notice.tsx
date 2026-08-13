// Shared `<Notice>` primitive — extracted from
// `SettingsModal.tsx` and promoted to the curator
// primitives so every inline status / info / warn / error message
// across the app shares the same shell.
//
// Audit before this extraction found 10
// distinct "tinted banner" implementations strewn across views:
// aging warnings (InventoryDetailView), cellar advisories
// (SessionFormView / TastingView), duplicate-entry warnings
// (TobaccoFormView / WishFormView), AICard error, orphan-lot
// warning, trash summary header. Same visual role, 10 different
// paddings / radii / alpha tiers. Migrating them all to <Notice>
// drops the visible inconsistency at zero behavioural cost.
//
// **Out of scope**: the fixed-top alert banners (SaveError,
// SaveWarn, ExportReminder, DriveExpired in Overlays.tsx). Those
// use SOLID backgrounds and full-bleed positioning — a
// fundamentally different visual style. They stay as-is.

import React from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Ico, IcoName } from "./icons.tsx";

export type NoticeTone = "info" | "success" | "warn" | "error";

export interface NoticeProps {
  /** Picks the colour family. Default "info" (brass). */
  tone?: NoticeTone;
  /** Override the default icon glyph for the tone. */
  icon?: IcoName;
  /** The body of the notice. */
  children: React.ReactNode;
  /** Optional right-aligned slot — typically a `<SettingsButton>`
   *  or any small inline action (e.g. "Reconnect", "Update"). */
  action?: React.ReactNode;
  /** Optional style overrides (margin, alignment). */
  style?: React.CSSProperties;
}

// Picks the tone-colour from the curator palette. Centralised here
// so every notice in the app is locked to the same 4-tier system.
export function noticeToneColor(tone: NoticeTone): string {
  return tone === "success" ? C.sage
       : tone === "warn"    ? C.amber
       : tone === "error"   ? C.oxbloodHi
       :                      C.brassHi;
}

// Default icon per tone — overridable via the `icon` prop.
export function noticeDefaultIcon(tone: NoticeTone): IcoName {
  return tone === "success" ? "check"
       : tone === "warn"    ? "diamond"
       : tone === "error"   ? "close"
       :                      "more";
}

export function Notice({
  tone = "info", icon, children, action, style,
}: NoticeProps) {
  const color = noticeToneColor(tone);
  // a11y: most Notices are conditional feedback (aging warning,
  // duplicate-entry alert, AI error, cellar advisory), so expose them to
  // assistive tech as live regions — warn/error assertively (role=alert),
  // info/success politely (role=status). Static info notices announced politely
  // on mount is acceptable and better than silent.
  const isAlert = tone === "error" || tone === "warn";
  return (
    <div role={isAlert ? "alert" : "status"} style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "10px 14px", borderRadius: 8,
      background: alpha(color, "15"), border: `1px solid ${alpha(color, "44")}`,
      color, fontFamily: F.body, fontSize: fs(15), lineHeight: 1.45,
      ...style,
    }}>
      <span style={{ flexShrink: 0, display: "inline-flex" }}>
        <Ico name={icon || noticeDefaultIcon(tone)} size={14} sw={1.7} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {action && <span style={{ flexShrink: 0 }}>{action}</span>}
    </div>
  );
}

// Best-effort tone inference for free-form status messages
// (gdriveStatus, backupStatus, etc.). Used by callers that don't
// know the tone up front. Kept here so consumers don't re-invent
// the heuristic — it previously lived inside SettingsModal.tsx.
export function statusToneFromMessage(msg: string): NoticeTone {
  if (!msg) return "info";
  if (String(msg).startsWith("✓") || /\bdone\b/i.test(msg)) return "success";
  // The ERROR row already covered all five languages; the WARN row
  // knew French and English only, so a warn-level status rendered with the
  // neutral `info` tint in German, Spanish and Italian. Colour only — no text
  // was wrong — which is exactly why nothing reported it.
  if (/erreur|error|fehler|fail|expir/i.test(msg)) return "error";
  if (/⚠|warn|attention|achtung|atenci[oó]n|aviso|attenzione|avviso/i.test(msg)) return "warn";
  return "info";
}
