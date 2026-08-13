// The item's own collections on a fiche — folded away by default.
//
// WHY IT IS SHARED. The tobacco, pipe and accessory fiches each carried a
// byte-identical copy of this block (label + chips → the filtered list). Three
// copies is where the repo promotes a shape — and the <Notice> unification
// pass is the evidence: every inline copy of a shared shape had drifted.
//
// WHY IT FOLDS. Reported from the app: "cacher les tags derrière un menu
// dépliant sinon ça prend trop de place. À tous les endroits où ils se
// trouvent." An earlier pass did the three LIST filter rows; this is the fiches.
// Measured before changing anything: with five collections the block wraps to
// two lines (62 px at 390 px wide), so folding it wins a line back — while a
// fiche with two tags is unchanged, since the label row exists either way.
//
// The COUNT is on the closed label on purpose. A disclosure that hides how much
// it hides makes the user open it to find out, which is worse than the row it
// saved; "COLLECTIONS · 5" tells them whether it is worth a tap.

import { useState } from "react";
import { alpha, fs, C, F } from "../../theme-curator.ts";
import { Lbl } from "./primitives.tsx";
import { Ico } from "./icons.tsx";

export function TagChipRow({ tags, onOpen, t }: {
  tags: unknown;
  /** Tap a chip → the list filtered on that collection (back returns here). */
  onOpen?: (tag: string) => void;
  t?: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const list = tags as string[];
  return (
    <div style={{ margin: "0 12px 18px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t ? t("sec_tags") : "Collections"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
        }}>
        <Lbl color={C.steelHi}>{t ? t("sec_tags") : "Collections"}</Lbl>
        <span style={{ fontFamily: F.mono, fontSize: fs(11), color: C.tx3 }}>· {list.length}</span>
        <span style={{
          display: "inline-flex", color: C.steelHi,
          transition: "transform 200ms", transform: open ? "rotate(90deg)" : "rotate(0deg)",
        }}>
          <Ico name="chevron" size={12} sw={1.8} />
        </span>
      </button>
      {open && list.map((tg: string) => (
        <button key={tg} type="button"
          onClick={() => onOpen && onOpen(tg)}
          aria-label={(t ? t("tag_filter_label") : "Filtrer par collection") + " " + tg}
          style={{
            background: alpha(C.steelHi, "22"), color: C.steelHi,
            border: `1px solid ${alpha(C.steelHi, "55")}`, borderRadius: 8,
            padding: "5px 10px", fontFamily: F.mono, fontSize: fs(12.5), cursor: "pointer",
          }}>
          # {tg}
        </button>
      ))}
    </div>
  );
}
