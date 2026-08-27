import React from "react";
// Curator form field primitives. All styles inline.

import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, fsInput, C, F, CARD_BG } from "../../theme-curator.ts";
import { Stars, Lbl, IconBtn, PressCard } from "./primitives.tsx";
import { Ico } from "./icons.tsx";
import { safeImgSrc } from "../../utils/imgCache.ts";

// ─────────────────────────────────────────────────────────────
// FormScreen — full-screen form layout: brass-edged top bar +
// scrollable body + sticky save bar at the bottom.
// ─────────────────────────────────────────────────────────────
export interface FormScreenProps {
  overline?: string;
  title: React.ReactNode;
  onCancel: () => void;
  onSave: () => void;
  canSave?: boolean;
  saveLabel?: string;
  children: React.ReactNode;
  accent?: string;
}
export function FormScreen({
  overline, title, onCancel, onSave, canSave = true,
  saveLabel = "Enregistrer", children, accent = C.brass,
}: FormScreenProps) {
  const ctx = useAppCtx();
  const t = ctx?.t;
  // Default-only fallback: the close icon's aria-label was hardcoded
  // FR for the app's first 116 releases. Now reads via ctx so screen readers announce it
  // in the user's UI language.
  const cancelLbl = t ? t("btn_cancel") : "Annuler";
  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: C.bg, fontFamily: F.body, color: C.tx,
    }}>
      {/* Brass top hair */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        zIndex: 6,
      }} />

      {/* Top bar */}
      <div style={{
        paddingTop: `max(env(safe-area-inset-top, 0), 14px)`,
        paddingLeft: 18, paddingRight: 14, paddingBottom: 8,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 5,
        background: `linear-gradient(180deg, ${C.bg}, ${alpha(C.bg, "cc")})`,
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      }}>
        <IconBtn icon="close" onClick={onCancel} ariaLabel={cancelLbl} />
        {overline && <Lbl color={accent} size={11}>{overline}</Lbl>}
        <button type="button" onClick={canSave ? onSave : undefined}
          aria-disabled={!canSave}
          style={{
            padding: "8px 14px", borderRadius: 8,
            border: "none",
            background: canSave ? `linear-gradient(135deg, ${C.brassHi}, ${C.brass})` : C.card,
            color: canSave ? C.bg : C.tx3,
            fontFamily: F.body, fontWeight: 700, fontSize: fs(15),
            cursor: canSave ? "pointer" : "not-allowed",
            opacity: canSave ? 1 : 0.5,
            boxShadow: canSave ? `0 4px 14px ${alpha(C.brass, "44")}` : "none",
            transition: "opacity 200ms",
          }}>{saveLabel}</button>
      </div>

      {/* Hero title — an <h1>, not a <div>. This is the
          form's own page title (the TopBar above carries only a small-caps
          `Lbl`), so with it as a plain div all five forms had NO h1 at all
          and their sections started at h3. Inline `fontWeight: 400` +
          `margin: 0` keep the rendered result byte-identical — the same
          recipe `PageTitle` has always used. */}
      <div style={{ padding: "10px 22px 14px" }}>
        <h1 style={{
          margin: 0, padding: 0, fontWeight: 400,
          fontFamily: F.display, fontSize: fs(34), color: C.ivory,
          letterSpacing: -0.6, lineHeight: 1.05,
        }}>{title}</h1>
      </div>

      {/* Body */}
      <div style={{ padding: "0 12px 100px" }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FormSection — group of fields with italic-serif section title
// ─────────────────────────────────────────────────────────────
export function FormSection({
  title, sub, accent = C.brass, children,
}: { title: string; sub?: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 16,
      background: CARD_BG, border: `1px solid ${C.rule}`,
      borderRadius: 10, overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 16px 10px",
        borderBottom: `1px solid ${C.rule}`,
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 4, height: 14, background: accent, borderRadius: 1,
            boxShadow: `0 0 8px ${alpha(accent, "66")}`,
          }} />
          {/* h2, not h3. It was an h3 under NO h1 at all;
              now that `FormScreen`'s hero is the h1, h3 would skip a level.
              Checked before moving it: no view combines `FormSection` with
              `SectionHead` (which is also h2), so the two cannot collide. */}
          <h2 style={{
            margin: 0, padding: 0, fontWeight: 400,
            fontFamily: F.display, fontSize: fs(18), color: C.ivory,
            fontStyle: "italic", letterSpacing: -0.2,
          }}>{title}</h2>
        </div>
        {sub && <Lbl color={C.tx3}>{sub}</Lbl>}
      </div>
      <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FieldLabel — small caps label sitting above an input
// ─────────────────────────────────────────────────────────────
export function FieldLabel({
  htmlFor, children, required, hint, color = C.tx2,
}: {
  htmlFor?: string | undefined;
  children: React.ReactNode;
  required?: boolean | undefined;
  hint?: string | undefined;
  color?: string | undefined;
}) {
  // When htmlFor is provided we render a real <label> so SR users hear
  // the field name; otherwise fall back to a styled <div>.
  const inner = (
    <>
      <Lbl color={color}>{children}{required && <span style={{ color: C.oxbloodHi, marginLeft: 4 }}>*</span>}</Lbl>
      {hint && <div style={{ marginTop: 2, fontSize: fs(14.5), color: C.tx3, fontFamily: F.body }}>{hint}</div>}
    </>
  );
  if (htmlFor) {
    return <label htmlFor={htmlFor} style={{ marginBottom: 6, display: "block" }}>{inner}</label>;
  }
  return <div style={{ marginBottom: 6 }}>{inner}</div>;
}

// ─────────────────────────────────────────────────────────────
// Base input style + focus ring helper
// Inline-style components can't use :focus, so we expose a hook that
// flips a boxShadow on/off based on focus/blur events. Pair every
// outline:none input with this to satisfy WCAG 2.1.1 / 2.4.7.
// ─────────────────────────────────────────────────────────────
const baseInput: React.CSSProperties = {
  width: "100%", padding: "11px 14px",
  // Fields recess to C.bg (a step below the CARD_BG=bg2
  // FormSection they sit in) so they read as inset wells instead of
  // merging bg2-on-bg2 after the recessed-tone pass moved sections to bg2.
  background: C.bg, color: C.ivory,
  border: `1px solid ${C.rule}`, borderRadius: 8,
  // 16px (was 15) — iOS Safari auto-zooms on focus when an
  // input font-size is < 16. Pinch-zoom was re-enabled, so the
  // user can still pinch the form if they want, but the involuntary
  // focus zoom is the annoying one. docs/architecture.md (fsInput) documents this as
  // the canonical iOS-no-zoom workaround.
  fontFamily: F.body, fontSize: fsInput(17),
  outline: "none", boxSizing: "border-box",
  transition: "border-color 200ms, background 200ms, box-shadow 200ms",
};

export function useFocusRing() {
  const [focused, setFocused] = React.useState(false);
  return {
    focused,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: focused ? { boxShadow: `0 0 0 2px ${alpha(C.brassHi, "88")}`, borderColor: C.brassHi } : undefined,
  };
}

// On focusing a numeric field, drop the caret at the END of the
// value (right of the digits) rather than wherever the tap landed — the
// natural place to append or correct a number. Deferred one frame so it
// wins over the browser's tap-driven caret placement, and try/guarded
// because some input types don't support setSelectionRange. Scoped to
// numeric cells only; on long text fields caret-to-end would fight the
// common "tap mid-word to fix a typo" gesture. Shared so every numeric
// input across the app behaves identically.
export function caretToEnd(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    try {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    } catch { /* input type doesn't support text selection */ }
  });
}

// ─────────────────────────────────────────────────────────────
// TextField
// ─────────────────────────────────────────────────────────────
export interface TextFieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date" | "time" | "url";
  step?: string;
  min?: string;
  max?: string;
  mono?: boolean;
}
export function TextField({
  label, required, hint, value, onChange, placeholder, type = "text",
  step, min, max, mono,
}: TextFieldProps) {
  const id = React.useId();
  const ring = useFocusRing();
  // For numeric inputs, switch the HTML element from
  // type="number" to type="text" with inputMode="decimal". Reason:
  // Chrome/Safari/Firefox each handle the "," key differently when
  // type="number" — Chrome blanks the field, Safari rejects the keystroke
  // outright. With type="text" + inputMode="decimal" we get the numeric
  // mobile keypad AND can intercept the value to normalise comma → dot
  // before storing, so a FR user typing "2,5" actually stores "2.5".
  // parseFloat downstream then works correctly regardless of the
  // user's typing habit.
  const isNumeric = type === "number";
  const isDate = type === "date";
  return (
    <div>
      {label && <FieldLabel htmlFor={id} required={required} hint={hint}>{label}</FieldLabel>}
      <input
        id={id}
        type={isNumeric ? "text" : type}
        inputMode={isNumeric ? "decimal" : undefined}
        value={value}
        onChange={(e) => {
          var v = e.target.value;
          if (isNumeric) v = String(v).replace(",", ".");
          onChange(v);
        }}
        placeholder={placeholder}
        step={step} min={min} max={max}
        required={required}
        aria-label={label || placeholder}
        onFocus={(e) => { ring.onFocus(); if (isNumeric) caretToEnd(e); }}
        onBlur={ring.onBlur}
        style={{
          ...baseInput,
          fontFamily: mono ? F.mono : F.body,
          // iOS Safari renders <input type="date"> with its
          // own native chrome — centered text + larger internal padding
          // that made the date "20 mai 2026" appear to drift toward the
          // middle of the box and visually overflow vs the other inputs
          // which were left-aligned. Strip the native appearance and
          // force left text-alignment so the date field matches the
          // rest of the form. The native date picker still opens on tap
          // (appearance: none only removes the visual chrome).
          ...(isDate ? {
            WebkitAppearance: "none" as any,
            appearance: "none" as any,
            textAlign: "left" as const,
            minHeight: 44,
          } : null),
          ...ring.style,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TextAreaField
// ─────────────────────────────────────────────────────────────
export function TextAreaField({
  label, hint, value, onChange, placeholder, minHeight = 80, italic,
}: {
  label?: string; hint?: string;
  value: string; onChange: (v: string) => void;
  placeholder?: string; minHeight?: number; italic?: boolean;
}) {
  const id = React.useId();
  const ring = useFocusRing();
  return (
    <div>
      {label && <FieldLabel htmlFor={id} hint={hint}>{label}</FieldLabel>}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={{
          ...baseInput, minHeight, resize: "vertical",
          fontFamily: italic ? F.display : F.body,
          fontStyle: italic ? "italic" : "normal",
          lineHeight: 1.5, padding: "10px 14px",
          ...ring.style,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SelectField — native <select> styled like the curator inputs
// ─────────────────────────────────────────────────────────────
export interface SelectOption {
  value: string;
  label: string;
}
// Optional grouped variant — renders <optgroup> headers (e.g. pipe shapes by
// family). When `groups` is supplied it takes precedence over `options`.
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}
export function SelectField({
  label, hint, value, onChange, options, groups, required, placeholder = "—",
}: {
  label?: string; hint?: string;
  value: string; onChange: (v: string) => void;
  options?: SelectOption[]; groups?: SelectGroup[]; required?: boolean; placeholder?: string;
}) {
  const id = React.useId();
  const ring = useFocusRing();
  return (
    <div>
      {label && <FieldLabel htmlFor={id} required={required} hint={hint}>{label}</FieldLabel>}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        required={required}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={{ ...baseInput, appearance: "none",
          backgroundImage: `linear-gradient(45deg, transparent 50%, ${C.tx2} 50%), linear-gradient(135deg, ${C.tx2} 50%, transparent 50%)`,
          backgroundPosition: `calc(100% - 16px) center, calc(100% - 11px) center`,
          backgroundSize: "5px 5px, 5px 5px",
          backgroundRepeat: "no-repeat", paddingRight: 32,
          ...ring.style,
        }}>
        <option value="">{placeholder}</option>
        {groups
          ? groups.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))
          : (options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StarsField — interactive star rating with label
// ─────────────────────────────────────────────────────────────
export function StarsField({
  label, value, onChange, size = 20,
}: { label?: string; value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      {/* a11y: pass the field label as the radiogroup's accessible
          name so a screen-reader user hears "Force, radiogroup" not "radiogroup". */}
      <Stars n={value} size={size} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SegmentedField — choose 1 from N options (rebuy yes/no/?, etc.)
// ─────────────────────────────────────────────────────────────
export interface SegmentedOption<T> {
  value: T;
  label: string;
  color?: string;
}
export function SegmentedField<T>({
  label, value, onChange, options,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
}) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o, i) => {
          const on = o.value === value;
          const c = o.color || C.brass;
          return (
            // a11y: aria-pressed so a screen reader announces the
            // selected segment (was signalled by colour/weight only).
            <button key={String(o.value) + i} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
              style={{
                padding: "8px 14px",
                border: `1px solid ${on ? c : C.rule}`,
                background: on ? alpha(c, "22") : C.bg2,
                color: on ? c : C.tx,
                borderRadius: 8, cursor: "pointer",
                fontFamily: F.body, fontSize: fs(15), fontWeight: on ? 700 : 500,
                transition: "background 200ms, color 200ms, border-color 200ms",
              }}>{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CheckboxField — a single on/off choice with an explanatory hint
// ─────────────────────────────────────────────────────────────
// The forms had no checkbox: every boolean until now was
// either a SegmentedField (two labelled options) or a tri-state on a fiche.
// A Segmented would have worked here, but it forces the user to read two
// labels to learn there is a choice, where a checkbox states the one thing
// that can be true and shows whether it is.
//
// a11y, and none of it is optional under this repo's invariants:
//  · `role="checkbox"` + `aria-checked` on a real <button>, so Enter AND Space
//    activate it for free and the state is ANNOUNCED, not conveyed by colour
//    (the FilterChipSimple / Settings-toggle lesson, twice recorded);
//  · the hint is wired with `aria-describedby`, so it is read as the
//    description rather than being invisible to a screen reader like the
//    sibling <div> that made all six Settings toggles anonymous;
//  · minHeight 44 — the house target, stricter than WCAG 2.2's 24.
export function CheckboxField({
  label, hint, checked, onChange, accent,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent?: string;
}) {
  const id = React.useId();
  const c = accent || C.brass;
  const on = !!checked;
  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        {...(hint ? { "aria-describedby": id } : {})}
        onClick={() => onChange(!on)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          width: "100%", minHeight: 44, padding: "8px 10px",
          background: on ? alpha(c, "18") : C.bg,
          border: `1px solid ${on ? c : C.rule}`,
          borderRadius: 8, cursor: "pointer", textAlign: "left",
          transition: "background 200ms, border-color 200ms",
        }}>
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 22px", height: 22, borderRadius: 6,
            border: `2px solid ${on ? c : C.rule2}`,
            background: on ? c : "transparent",
            color: C.bg, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: fs(14), fontWeight: 800,
            transition: "background 200ms, border-color 200ms",
          }}>{on ? "✓" : ""}</span>
        <span style={{
          fontFamily: F.body, fontSize: fs(15), color: on ? c : C.tx,
          fontWeight: on ? 600 : 500, minWidth: 0,
        }}>{label}</span>
      </button>
      {hint && (
        <div id={id} style={{
          fontFamily: F.body, fontSize: fs(13), color: C.tx3,
          lineHeight: 1.45, margin: "6px 2px 0",
        }}>{hint}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PhotoField — image picker with preview, URL field, remove
// ─────────────────────────────────────────────────────────────
export function PhotoField({
  label, value, preview, onPickFile, onClear,
}: {
  label?: string;
  value: string;
  preview?: string;
  onPickFile: () => void;
  onClear: () => void;
}) {
  const ctx = useAppCtx();
  const t = ctx?.t;
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        <PressCard onClick={onPickFile} style={{
          padding: "11px 14px",
          background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8,
          display: "flex", alignItems: "center", gap: 10,
          color: C.brassHi, fontFamily: F.body, fontSize: fs(15), fontWeight: 600,
        }}>
          <Ico name="plus" size={15} sw={1.8} />
          <span style={{ flex: 1 }}>{t ? t("photo_import") : "Importer une photo"}</span>
        </PressCard>
        {value && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px", background: C.bg2,
            border: `1px solid ${C.rule}`, borderRadius: 8,
          }}>
            {/* The ONE `<img src>` in the app, and the one
                sink `safeBgUrl` does not cover. `preview` falls back to the
                raw `imageUrl` when the IndexedDB lookup misses, so a forged
                backup carrying `//evil.com/x.png` beaconed the moment the
                user opened that item's edit form. `safeImgSrc` shares its
                allowlist with `migrateData` so the two cannot drift, and it
                deliberately still passes a `data:image/…` URI — that is the
                IndexedDB quota fallback, which the label below renders as
                « image locale ». */}
            {safeImgSrc(preview) && (
              <img src={safeImgSrc(preview)} alt="" style={{
                width: 48, height: 48, objectFit: "cover", borderRadius: 5,
                border: `1px solid ${C.rule2}`,
              }} />
            )}
            <span style={{
              flex: 1, fontSize: fs(14.5), color: C.tx3, fontFamily: F.mono,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{String(value).startsWith("data:")
              ? (t ? t("photo_local_image") : "image locale")
              : value}</span>
            <IconBtn icon="trash" iconSize={14} size={36} onClick={onClear}
              ariaLabel={t ? t("photo_remove") : "Supprimer l'image"}
              color={C.oxbloodHi} style={{ borderColor: alpha(C.oxblood, "44") }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DangerButton was removed — never referenced.
