// Shared free-text tag / collection editor.
// Type + Enter (or the + button) to add; tap a chip's × to remove; tap a
// suggestion chip to add an existing tag. All mutations flow through the
// parent's sanitizeTags so dupes / garbage can't land. Used identically by the
// tobacco, pipe and accessory forms.

import { useState } from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { useFocusRing } from "./FormFields.tsx";
import { Ico } from "./icons.tsx";
import { MAX_TAG_LEN } from "../../utils/tags.ts";

export function TagEditor({ tags, suggestions, onChange, t }: {
  tags: string[]; suggestions: string[]; onChange: (next: string[]) => void; t?: (k: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const [showSug, setShowSug] = useState(false);
  const focus = useFocusRing();
  const lower = tags.map((x) => String(x).toLowerCase());
  const unused = suggestions.filter((s) => lower.indexOf(String(s).toLowerCase()) < 0).slice(0, 12);
  const canAdd = !!String(draft).trim();

  function add(raw: string) {
    const v = String(raw || "").replace(/\s+/g, " ").trim();
    if (!v) return;
    onChange(tags.concat([v]));
    setDraft("");
  }
  function remove(tag: string) {
    onChange(tags.filter((x) => x !== tag));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {tags.map((tag) => (
            <span key={tag} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: alpha(C.steelHi, "22"), color: C.steelHi,
              border: `1px solid ${alpha(C.steelHi, "55")}`, borderRadius: 8,
              padding: "5px 8px 5px 10px", fontFamily: F.mono, fontSize: fs(12.5),
            }}>
              {tag}
              <button type="button" onClick={() => remove(tag)}
                aria-label={(t ? t("tag_remove") : "Retirer l'étiquette") + " " + tag}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  // Was 20x20, which fails even WCAG 2.5.8's 24px
                  // AA floor — and this × is shared by the tobacco, pipe and
                  // accessory forms. NOT the project's 44px IconBtn rule (2.5.5,
                  // AAA): a 44px button inside a ~28px chip would grow the whole
                  // tag row out of proportion. 24 is the AA minimum and costs
                  // 4px of chip height, which is the trade taken deliberately.
                  width: 24, height: 24, minWidth: 24, borderRadius: 6,
                  background: "transparent", border: "none", color: C.steelHi, cursor: "pointer", padding: 0,
                }}>
                <Ico name="close" size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_TAG_LEN))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }}
          placeholder={t ? t("tag_placeholder") : "Ajouter une collection…"}
          aria-label={t ? t("tag_add_label") : "Ajouter une étiquette"}
          maxLength={MAX_TAG_LEN}
          style={{
            flex: 1, background: C.bg, color: C.tx,
            border: `1px solid ${C.rule}`, borderRadius: 8, padding: "10px 12px",
            fontFamily: F.body, fontSize: "max(16px, " + fs(14) + ")", outline: "none", ...focus.style,
          }}
          onFocus={focus.onFocus} onBlur={focus.onBlur}
        />
        <button type="button" onClick={() => add(draft)} disabled={!canAdd}
          aria-label={t ? t("tag_add_label") : "Ajouter une étiquette"}
          style={{
            width: 44, minWidth: 44, borderRadius: 8, cursor: canAdd ? "pointer" : "default",
            background: canAdd ? alpha(C.steelHi, "22") : "transparent",
            border: `1px solid ${C.rule}`, color: canAdd ? C.steelHi : C.tx3,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <Ico name="plus" size={18} />
        </button>
      </div>
      {/* The reuse suggestions fold away. Up to 12 dashed chips is
          two or three rows inside a form section, and they are an accelerator,
          not something you need in view while typing — the item's OWN tags and
          the input stay visible. Same request as the list rows:
          "cacher les tags derrière un menu dépliant, ça prend trop de place". */}
      {unused.length > 0 && (
        <button type="button"
          onClick={() => setShowSug((v) => !v)}
          aria-expanded={showSug}
          style={{
            alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            color: C.tx2, fontFamily: F.mono, fontSize: fs(12), letterSpacing: 0.3,
          }}>
          {t ? t("tag_reuse") : "Réutiliser une collection"}
          <span style={{ color: C.tx3 }}>· {unused.length}</span>
          <span style={{
            display: "inline-flex", transition: "transform 200ms",
            transform: showSug ? "rotate(90deg)" : "rotate(0deg)",
          }}>
            <Ico name="chevron" size={12} sw={1.8} />
          </span>
        </button>
      )}
      {showSug && unused.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              style={{
                background: "transparent", color: C.tx2,
                border: `1px dashed ${C.rule2}`, borderRadius: 8,
                padding: "4px 9px", fontFamily: F.mono, fontSize: fs(12), cursor: "pointer",
              }}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
