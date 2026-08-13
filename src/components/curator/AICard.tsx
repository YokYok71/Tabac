// AI auto-fill card. Exposed by every tobacco / pipe / wishlist /
// accessory form via <AICard />.

import { useRef } from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Ico } from "./icons.tsx";
import { Lbl, PressCard } from "./primitives.tsx";
import { Notice } from "./Notice.tsx";
import { CATS_EN, CUTS_EN } from "../../constants.ts";

// ─────────────────────────────────────────────────────────────
// AICard — auto-fill from name/brand using the configured AI provider.
// Reads & calls ctx-provided handlers: aiAutoFill(kind), aiLoad, aiErr.
// ─────────────────────────────────────────────────────────────
export interface AICardProps {
  kind: "tobacco" | "pipe" | "wish";
  apiKey: string;
  aiLoad: boolean;
  aiErr: string;
  aiAutoFill: (kind: "tobacco" | "pipe" | "wish") => void;
  t?: (k: string) => string;
  /** The enum translator, so the AI-vs-catalogue diff can render
   *  category/cut in the active language instead of the stored French. */
  xl?: (v: string, m: readonly string[]) => string;
  /** When provided, a "📷 Étiquette" button opens the
   *  photo picker (camera or library — no `capture` attr so iOS AND
   *  Android offer both) and hands the file to the label-scan flow.
   *  Tobacco + wishlist forms pass it; the pipe form doesn't (pipe
   *  stampings are too small/worn for reliable extraction). */
  onScanFile?: ((file: File) => void) | undefined;
  /** Surface the active provider next to the title so
   *  the user can tell at a glance which key + which model is about
   *  to run (multi-provider setups previously had no signal). Optional —
   *  Settings's AI section still carries the provider picker. */
  aiProvider?: string | undefined;
  /** Source of the LAST successful auto-fill.
   *  "local" (DB) / "anthropic" / "openai" / "gemini" / "". Shown as
   *  a tiny "· source: …" tag under the search button so the user
   *  can tell where the just-filled data came from. */
  aiSource?: string | undefined;
  // The `dbHinted` prop is GONE. The catalogue offer it
  // rendered moved to <CatalogOffer>, which the forms place directly under
  // the BRAND field — this card sits above the whole form, so on a phone
  // with the keyboard up the offer was scrolled off the top, unseen. Do NOT
  // re-add a catalogue hint here.
  /** Cross-check feature. When aiSource === "local" and
   *  an API key is configured, a "Vérifier avec l'IA" button shows
   *  below the source label. On click the hook fires the AI for the
   *  same blend and stores the result in `aiCompare`; AICard then
   *  renders a diff Notice with [Appliquer IA] / [Garder DB] actions. */
  aiCompare?: null | { type: string; db: Record<string, any>; ai: Record<string, any> };
  aiCompareCheck?: (kind: "tobacco" | "wish") => void;
  applyAiCompare?: () => void;
  dismissAiCompare?: () => void;
}
export function AICard({
  kind, apiKey, aiLoad, aiErr, aiAutoFill, t, xl, onScanFile, aiProvider,
  aiSource,
  aiCompare, aiCompareCheck, applyAiCompare, dismissAiCompare,
}: AICardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasKey = !!apiKey;
  const hint = hasKey
    ? (t ? t("ai_hint") : "Remplis nom/marque")
    // The fallback carries the breadcrumb because doc:check gate (b.2) pins it
    // byte-identical to the fr value. (The comment here used to claim the
    // opposite — that the breadcrumb was dropped — while the string plainly
    // contained it; the lint rule was narrowed to stop flagging this
    // shape instead of pretending it had been handled.)
    : (t ? t("ai_no_key_hint") : "Ajoute une clé API dans Paramètres → IA");
  const search = t ? t("ai_search") : "🔍 Chercher";
  const title = t ? t("ai_title") : "Auto-compléter";
  // Human label for the source tag. The hook stores
  // "local" / provider id; here we expand to a short display label.
  const sourceLabel = aiSource === "local"
    ? (t ? t("ai_src_local") : "catalogue")
    : (aiSource || "");

  return (
    <div style={{
      margin: "0 0 14px", padding: "12px 14px",
      background: `linear-gradient(135deg, ${C.card}, ${C.bg2})`,
      // Was `${C.brass}${hasKey ? "55" : "25"}` — a SPLIT
      // interpolation, so the token and its alpha suffix sit in separate
      // `${}` slots. Since the tokens were varized that yields
      // `var(--c-brass, #d4a661)55`, invalid CSS the browser drops: the card
      // rendered with NO border at all. This shape is why the earlier sweeps
      // missed it — they grepped `${C.x}AA` (suffix inline) and `C.x + "AA"`.
      border: `1px solid ${alpha(C.brass, hasKey ? "55" : "25")}`, borderRadius: 10,
      position: "relative", overflow: "hidden",
      opacity: hasKey ? 1 : 0.7,
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${C.brass}, transparent)`,
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: alpha(C.brass, "22"), border: `1px solid ${alpha(C.brass, "55")}`,
          color: C.brassHi,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Ico name="diamond" size={14} sw={1.7} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <Lbl color={C.brassHi}>{title}</Lbl>
            {aiProvider && (
              <span style={{
                fontFamily: F.mono, fontSize: fs(11), color: C.tx3,
                letterSpacing: 0.8, textTransform: "uppercase",
                // The space after the separator was a legal break
                // point, so on a 390 px phone in FR the header rendered as
                // "AUTO-" + a lone "·" on line 1 and "COMPLÉTER" + "ANTHROPIC"
                // on line 2 — the dot divorced from the word it qualifies. Found
                // by LOOKING at the card, not by any ratio or assertion.
                whiteSpace: "nowrap",
              }}>· {aiProvider}</span>
            )}
          </div>
          <div style={{
            marginTop: 2, fontSize: fs(14.5), color: C.tx3,
            fontFamily: F.body,
          }}>{hint}</div>
        </div>
        <PressCard
          onClick={!hasKey || aiLoad ? undefined : () => aiAutoFill(kind)}
          ariaBusy={aiLoad}
          // Without a key this is styled as disabled but was
          // announced as plain text, so a screen-reader user had no way to know
          // a search button existed at all. The reason is right above it
          // (ai_no_key_hint), which only helps if the control is discoverable.
          ariaDisabled={!hasKey}
          style={{
            padding: "8px 14px", borderRadius: 8,
            background: (!hasKey || aiLoad)
              ? C.card
              : `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
            color: (!hasKey || aiLoad) ? C.tx3 : C.bg,
            border: (!hasKey || aiLoad) ? `1px solid ${C.rule}` : "none",
            fontFamily: F.body, fontSize: fs(15), fontWeight: 700,
            opacity: (!hasKey || aiLoad) ? 0.6 : 1,
            cursor: !hasKey ? "not-allowed" : (aiLoad ? "wait" : "pointer"),
          }}>
          {aiLoad ? (t ? t("loading") : "Chargement...") : search}
        </PressCard>
      </div>
      {/* Label scan — photo of the tin → AI extracts
          brand + name (+ blend when readable). */}
      {onScanFile && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-hidden="true"
            tabIndex={-1}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) onScanFile(f);
              // Reset so picking the same photo twice re-triggers change.
              e.target.value = "";
            }}
          />
          <PressCard
            onClick={!hasKey || aiLoad ? undefined : () => fileRef.current && fileRef.current.click()}
            ariaDisabled={!hasKey}
            ariaBusy={aiLoad}
            style={{
              marginTop: 8, padding: "9px 12px", borderRadius: 8,
              background: "transparent",
              border: `1px solid ${alpha(C.brass, (!hasKey || aiLoad) ? "22" : "44")}`,
              color: (!hasKey || aiLoad) ? C.tx3 : C.brassHi,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
              opacity: (!hasKey || aiLoad) ? 0.6 : 1,
              cursor: !hasKey ? "not-allowed" : (aiLoad ? "wait" : "pointer"),
            }}>
            <Ico name="camera" size={14} sw={1.8} />
            {t ? t("ai_scan_btn") : "Scanner la boîte"}
          </PressCard>
        </>
      )}
      {/* Source tag of the LAST successful fill. */}
      {sourceLabel && !aiLoad && !aiErr && (
        <div style={{
          marginTop: 8, fontFamily: F.mono, fontSize: fs(12),
          letterSpacing: 0.5, color: aiSource === "local" ? C.sageHi : C.brassHi,
          padding: "0 2px",
        }}>
          {(t ? t("ai_src_label") : "source : ") + sourceLabel}
        </div>
      )}
      {/* After a DB hit, offer a one-tap AI cross-check.
          Only relevant for tobacco / wish (the pipe form has no DB hit
          to compare against). Hidden during a fill in flight (aiLoad)
          and when no API key is configured. */}
      {aiSource === "local" && (kind === "tobacco" || kind === "wish") && hasKey && !aiLoad && !aiCompare && aiCompareCheck && (
        <PressCard
          onClick={() => aiCompareCheck(kind as "tobacco" | "wish")}
          style={{
            marginTop: 8, padding: "8px 12px", borderRadius: 8,
            background: "transparent",
            border: `1px solid ${alpha(C.brass, "44")}`, color: C.brassHi,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
          }}>
          <Ico name="diamond" size={12} sw={1.7} />
          {t ? t("ai_compare_btn") : "Vérifier avec l'IA"}
        </PressCard>
      )}
      {/* Diff Notice once the cross-check returns. */}
      {aiCompare && !aiLoad && (
        <Notice tone="info" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {t ? t("ai_compare_title") : "Comparaison catalogue / IA"}
          </div>
          <AiCompareDiff db={aiCompare.db} ai={aiCompare.ai} {...(t ? { t } : {})} {...(xl ? { xl } : {})} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <PressCard
              onClick={applyAiCompare}
              style={{
                padding: "7px 12px", borderRadius: 8,
                background: `linear-gradient(135deg, ${C.brassHi}, ${C.brass})`,
                color: C.bg, border: "none",
                fontFamily: F.body, fontSize: fs(14.5), fontWeight: 700,
              }}>
              {t ? t("ai_compare_apply") : "Appliquer l'IA"}
            </PressCard>
            <PressCard
              onClick={dismissAiCompare}
              style={{
                padding: "7px 12px", borderRadius: 8,
                background: "transparent",
                border: `1px solid ${alpha(C.sage, "55")}`, color: C.sageHi,
                fontFamily: F.body, fontSize: fs(14.5), fontWeight: 600,
              }}>
              {t ? t("ai_compare_keep_db") : "Garder le catalogue"}
            </PressCard>
          </div>
        </Notice>
      )}
      {aiErr && (
        <Notice tone="error" style={{ marginTop: 8 }}>{aiErr}</Notice>
      )}
    </div>
  );
}

// Compact diff renderer for the cross-check Notice.
// Lists only the fields whose DB and AI values differ; identical
// fields are silently hidden. Description is excluded — the wording
// almost always differs and isn't actionable for a quick diff.
function AiCompareDiff({
  db, ai, t, xl,
}: {
  db: Record<string, any>; ai: Record<string, any>;
  t?: (k: string) => string;
  // Two defects on the same pair of lines: the values are STORED
  // canonical French enums printed raw (a German read "Anglais" / "Ribbon"),
  // and the "IA" tag is the FR/ES/IT word for AI — English users read "IA",
  // German should read "KI".
  xl?: (v: string, m: readonly string[]) => string;
}) {
  const FIELD_LABELS: Record<string, string> = {
    category: t ? t("lbl_type") : "Type",
    cut: t ? t("lbl_cut") : "Coupe",
    blend: t ? t("lbl_blend") : "Composition",
    force: t ? t("lbl_force") : "Force",
    roomNote: t ? t("lbl_room_note") : "Room Note",
    taste: t ? t("lbl_taste") : "Goût",
    agingMax: t ? t("lbl_aging_max") : "Âge max cave (ans)",
  };
  const ENUM_MAPS: Record<string, readonly string[]> =
    Object.assign(Object.create(null), { category: CATS_EN, cut: CUTS_EN });
  const showVal = (field: string, v: any) => {
    const m = ENUM_MAPS[field];
    return m && xl ? xl(String(v), m) : String(v);
  };
  const diffs: { field: string; db: any; ai: any }[] = [];
  for (const f of Object.keys(FIELD_LABELS)) {
    const a = db[f] ?? "";
    const b = ai[f] ?? "";
    // String-compare (both castable); only show if non-empty AI value
    // disagrees (the AI returning "" for a field shouldn't override).
    if (String(a) !== String(b) && b !== "" && b !== 0) {
      diffs.push({ field: f, db: a, ai: b });
    }
  }
  if (diffs.length === 0) {
    return (
      <div style={{ fontSize: fs(13.5), color: C.tx2 }}>
        {t ? t("ai_compare_identical") : "L'IA renvoie les mêmes valeurs que le catalogue."}
      </div>
    );
  }
  return (
    <div style={{ fontSize: fs(13.5), color: C.tx, lineHeight: 1.5 }}>
      {diffs.map((d) => (
        <div key={d.field} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
          <span style={{ color: C.tx3, minWidth: 80, flexShrink: 0 }}>{FIELD_LABELS[d.field]}</span>
          <span style={{ color: C.sageHi }}>{t ? t("lbl_src_db") : "Catalogue"} {showVal(d.field, d.db)}</span>
          <span style={{ color: C.tx3 }}>→</span>
          <span style={{ color: C.brassHi }}>{t ? t("lbl_src_ai") : "IA"} {showVal(d.field, d.ai)}</span>
        </div>
      ))}
    </div>
  );
}

