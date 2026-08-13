// AromaPicker — the tappable "aroma wheel".
//
// Grouped, multi-select chips over AROMA_WHEEL. Used identically by
// SessionFormView and TastingView (the two session entry points must behave
// the same), so all the layout lives here. `value` is the session's aroma
// key array; `onChange` receives the next array (wheel-ordered, de-duped).
//
// a11y: each chip is a real <button> with aria-pressed reflecting selection
// (mirrors FilterChipSimple).

import { useAppCtx } from "../../AppContext.tsx";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { AROMA_WHEEL, ALL_AROMAS, aromaLabelKey, groupLabelKey } from "../../utils/aromas.ts";

export interface AromaPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  accent?: string;
}

export function AromaPicker({ value, onChange, accent = C.brass }: AromaPickerProps) {
  const { t } = useAppCtx();
  const sel: Record<string, boolean> = {};
  (Array.isArray(value) ? value : []).forEach((k) => { sel[k] = true; });

  function toggle(key: string) {
    const nextSet: Record<string, boolean> = Object.assign({}, sel);
    if (nextSet[key]) delete nextSet[key];
    else nextSet[key] = true;
    // Emit in canonical wheel order so storage / display stay stable.
    onChange(ALL_AROMAS.filter((k) => nextSet[k]));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {AROMA_WHEEL.map((group) => (
        <div key={group.key}>
          <div style={{
            fontFamily: F.mono, fontSize: fs(12), letterSpacing: 1.5,
            textTransform: "uppercase", color: C.tx3, marginBottom: 6,
          }}>
            {t ? t(groupLabelKey(group.key)) : group.key}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {group.aromas.map((key) => {
              const on = !!sel[key];
              return (
                <button key={key} type="button" aria-pressed={on}
                  onClick={() => toggle(key)}
                  style={{
                    padding: "7px 12px",
                    border: `1px solid ${on ? accent : C.rule}`,
                    background: on ? alpha(accent, "22") : "transparent",
                    color: on ? accent : C.tx,
                    borderRadius: 8, fontSize: fs(15), fontWeight: 500,
                    fontFamily: F.body, whiteSpace: "nowrap", cursor: "pointer",
                    transition: "background 180ms, color 180ms, border-color 180ms",
                  }}>
                  {t ? t(aromaLabelKey(key)) : key}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
