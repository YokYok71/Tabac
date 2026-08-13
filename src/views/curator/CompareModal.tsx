// The side-by-side blend comparison.
//
// Lives on the CATALOGUE page, which is the right home for two reasons and not
// merely a convenient one: the decision this answers is « est-ce que j'achète
// celui-là plutôt que celui que j'ai déjà ? », so it belongs where you are
// browsing blends you do not own; and the catalogue chunk is ALREADY loaded
// there, so offering catalogue blends as columns costs no extra fetch (the
// cold-start gating rule in CLAUDE.md forbids pulling it anywhere else).
//
// The decisions worth keeping:
//
//   • THE COLUMNS ARE ASYMMETRIC ON PURPOSE. A catalogue or wishlist column
//     cannot answer "what did it give me" — those cells show "—" and the modal
//     SAYS SO, once, rather than letting a block of dashes read as a bug.
//   • DIFFERENCES ARE MARKED, not just displayed. A comparison whose rows all
//     look alike makes the reader do the diffing; `buildComparison` flags the
//     rows that disagree and they get the accent.
//   • THE PICKER SEARCHES ALL THREE SOURCES AT ONCE. Splitting it into tabs
//     would make the user answer "where is this blend?" before they can answer
//     "how do these two compare?", which is the wrong question first.

import { useMemo, useState } from "react";
import { alpha, fs, fsInput, C, F, CARD_BG } from "../../theme-curator.ts";
import { CATS_EN, CUTS_EN } from "../../constants.ts";
import { Modal, ModalHeader } from "../../components/curator/Modal.tsx";
import { PressCard, Lbl, IconBtn } from "../../components/curator/primitives.tsx";
import { Notice } from "../../components/curator/Notice.tsx";
import { useFocusRing } from "../../components/curator/FormFields.tsx";
import {
  COMPARE_MAX, buildComparison, hasExperienceColumn,
  compareItemFromTobacco, compareItemFromCatalogue, compareItemFromWish,
  type CompareItem, type CompareRow,
} from "../../utils/compareBlends.ts";
import { tobaccoDbSearchMatch, type TobaccoDb } from "../../utils/tobaccoDb.ts";
import { computeCostPerSession } from "../../utils/stats.ts";
import { fmtLotAge } from "../../utils.ts";
import { aromaLabelKey } from "../../utils/aromas.ts";

// An explicit table, not a key built by concatenating a prefix with
// the source name. (Spelling that concatenation out HERE would itself trip
// doc:check — `extractTKeys` reads comments.) A built key
// is invisible to doc:check's "this key exists in every dictionary" gate, and a
// missing one would fall back to rendering the RAW KEY on screen — a defect
// already met once, whose fix was exactly this shape. Null-proto: indexed by a value that
// ultimately comes from stored data.
const SRC_KEY: Record<string, string> = Object.assign(Object.create(null), {
  cellar: "cmp_src_cellar",
  catalogue: "cmp_src_catalogue",
  wish: "cmp_src_wish",
});

type T = (k: string) => string;
type XL = (v: string, map: Record<string, string>) => string;

export function CuratorCompareModal({
  open, onClose, db, lang, data, t, xl, weightUnit, currencySymbol, seedKey,
}: {
  open: boolean;
  onClose: () => void;
  db: TobaccoDb | null;
  lang: string;
  data: any;
  t?: T;
  xl?: XL;
  weightUnit: string;
  currencySymbol: string;
  /** Optional catalogue key to start from (opened from a blend's fiche). */
  seedKey?: string | null;
}) {
  const tr = (k: string, fb: string) => (t ? t(k) : fb);
  const [picks, setPicks] = useState<string[]>(seedKey ? [seedKey] : []);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const ring = useFocusRing();

  // Cost per bowl is an aggregate that already has a home — index it once here
  // rather than re-deriving it inside the pure module.
  const costIndex = useMemo(() => {
    const out: Record<string, number> = Object.create(null);
    try {
      const cps = computeCostPerSession(data?.tobaccos, data?.sessions, { max: 9999 });
      (cps.items || []).forEach((i: any) => { out[String(i.id)] = i.costPerSession; });
    } catch { /* an aggregate failing must not take the comparison down */ }
    return out;
  }, [data]);

  const resolve = useMemo(() => (key: string): CompareItem | null => {
    const i = String(key).indexOf(":");
    const kind = String(key).slice(0, i);
    const rest = String(key).slice(i + 1);
    if (kind === "cellar") {
      const tob = (data?.tobaccos || []).find((x: any) => x && !x.deletedAt && String(x.id) === rest);
      return tob ? compareItemFromTobacco(tob, data?.sessions, costIndex) : null;
    }
    if (kind === "wish") {
      const w = (data?.wishlist || []).find((x: any) => x && !x.deletedAt && String(x.id) === rest);
      return w ? compareItemFromWish(w) : null;
    }
    const entry = db?.blends?.[rest];
    if (!entry) return null;
    const bk = rest.split("|")[0] || "";
    return compareItemFromCatalogue(rest, entry, lang, db?.brands?.[bk]?.displayName || bk);
  }, [data, db, lang, costIndex]);

  const items = useMemo(
    () => picks.map(resolve).filter(Boolean) as CompareItem[],
    [picks, resolve]);
  const rows = useMemo(() => buildComparison(items), [items]);
  const anyOwned = hasExperienceColumn(items);

  // ─── the picker: all three sources, one query ───
  const options = useMemo(() => {
    const query = String(q).trim();
    const out: Array<{ key: string; brand: string; name: string; src: string }> = [];
    (data?.tobaccos || []).forEach((x: any) => {
      if (!x || x.deletedAt) return;
      const label = String(x.brand || "") + " " + String(x.name || "");
      if (query && String(label).toLowerCase().indexOf(String(query).toLowerCase()) < 0) return;
      out.push({ key: "cellar:" + x.id, brand: String(x.brand || ""), name: String(x.name || ""), src: "cellar" });
    });
    (data?.wishlist || []).forEach((x: any) => {
      if (!x || x.deletedAt) return;
      const label = String(x.brand || "") + " " + String(x.name || "");
      if (query && String(label).toLowerCase().indexOf(String(query).toLowerCase()) < 0) return;
      out.push({ key: "wish:" + x.id, brand: String(x.brand || ""), name: String(x.name || ""), src: "wish" });
    });
    // The catalogue is ~1200 rows: only offered once the user has typed, and
    // capped, so the list never becomes a wall.
    if (db && query.length >= 2) {
      let n = 0;
      for (const k of Object.keys(db.blends)) {
        if (n >= 40) break;
        const e: any = db.blends[k];
        if (!e || !tobaccoDbSearchMatch(k, e, query)) continue;
        const bk = String(k).split("|")[0] || "";
        out.push({
          key: "catalogue:" + k,
          brand: db.brands?.[bk]?.displayName || bk,
          name: String(e.name || ""), src: "catalogue",
        });
        n++;
      }
    }
    return out.filter((o) => picks.indexOf(o.key) < 0);
  }, [q, data, db, picks]);

  const add = (key: string) => {
    setPicks((p) => (p.length >= COMPARE_MAX || p.indexOf(key) >= 0 ? p : p.concat([key])));
    setPicking(false);
    setQ("");
  };
  const drop = (key: string) => setPicks((p) => p.filter((x) => x !== key));

  return (
    <Modal open={open} onClose={onClose} maxWidth={760} capHeight
      ariaLabel={tr("cmp_title", "Comparer des blends")}>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "100%" }}>
        <ModalHeader title={tr("cmp_title", "Comparer des blends")} onClose={onClose} accent={C.steelHi} />

        <div style={{ overflowY: "auto", overscrollBehavior: "contain", padding: "0 18px 18px" }}>
          {/* ── the picked columns ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {items.map((it) => (
              <div key={it.key} data-compare-col=""
                style={{
                  flex: "1 1 140px", minWidth: 0, background: CARD_BG,
                  border: `1px solid ${C.rule}`, borderRadius: 8, padding: "8px 10px",
                  display: "flex", alignItems: "flex-start", gap: 6,
                }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Lbl size={9} color={it.source === "cellar" ? C.sage : C.steelHi}>
                    {tr(SRC_KEY[it.source] || "cmp_src_catalogue", it.source)}
                  </Lbl>
                  <div style={{
                    fontFamily: F.body, fontSize: fs(14), color: C.ivory,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{it.name}</div>
                  <div style={{
                    fontFamily: F.body, fontSize: fs(12), color: C.tx3,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{it.brand}</div>
                </div>
                <IconBtn icon="close" size={28} iconSize={13} border={false}
                  onClick={() => drop(it.key)}
                  ariaLabel={tr("cmp_remove", "Retirer") + " " + it.name} />
              </div>
            ))}
            {picks.length < COMPARE_MAX && (
              <PressCard onClick={() => setPicking(true)}
                ariaLabel={tr("cmp_add", "Ajouter un blend")}
                style={{
                  flex: "1 1 140px", minWidth: 0, minHeight: 62,
                  border: `1px dashed ${C.rule2}`, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: F.body, fontSize: fs(13), color: C.tx2,
                }}>
                + {tr("cmp_add", "Ajouter un blend")}
              </PressCard>
            )}
          </div>

          {/* ── the picker ── */}
          {picking && (
            <div style={{ marginBottom: 12 }}>
              <input
                type="text" value={q} autoFocus
                onChange={(e) => setQ(e.target.value)}
                aria-label={tr("cmp_search", "Chercher un blend")}
                placeholder={tr("cmp_search", "Chercher un blend")}
                onFocus={ring.onFocus} onBlur={ring.onBlur}
                style={{
                  width: "100%", boxSizing: "border-box", background: C.bg,
                  border: `1px solid ${C.rule}`, borderRadius: 8,
                  padding: "10px 12px", color: C.tx,
                  fontFamily: F.body, fontSize: fsInput(15), outline: "none",
                  ...(ring.style || {}),
                }} />
              <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 6 }}>
                {options.map((o) => (
                  <PressCard key={o.key} onClick={() => add(o.key)}
                    style={{
                      padding: "8px 10px", marginBottom: 4, borderRadius: 8,
                      background: CARD_BG, border: `1px solid ${C.rule}`,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                    <Lbl size={9} color={o.src === "cellar" ? C.sage : C.steelHi}>
                      {tr(SRC_KEY[o.src] || "cmp_src_catalogue", o.src)}
                    </Lbl>
                    <span style={{
                      fontFamily: F.body, fontSize: fs(14), color: C.tx,
                      minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{o.brand} · {o.name}</span>
                  </PressCard>
                ))}
                {!options.length && (
                  <div style={{ fontFamily: F.body, fontSize: fs(13), color: C.tx3, padding: "8px 2px" }}>
                    {String(q).trim().length < 2
                      ? tr("cmp_search_hint", "Tapez au moins 2 lettres pour chercher dans le catalogue.")
                      : tr("cmp_no_match", "Aucun résultat.")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── the comparison ── */}
          {items.length < 2 ? (
            <Notice tone="info">{tr("cmp_pick_two", "Choisissez au moins deux blends à comparer.")}</Notice>
          ) : (
            <>
              {!anyOwned && (
                // Said ONCE, here — not repeated as a dash on every line.
                <Notice tone="info">{tr("cmp_no_owned", "Aucun des blends choisis n'est dans votre cave : les lignes sur votre expérience (note, stock, séances) restent vides.")}</Notice>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                <tbody>
                  {rows.map((r) => (
                    <CompareRowView key={r.field} row={r} t={t} xl={xl}
                      weightUnit={weightUnit} currencySymbol={currencySymbol} />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CompareRowView({
  row, t, xl, weightUnit, currencySymbol,
}: {
  row: CompareRow; t?: T | undefined; xl?: XL | undefined;
  weightUnit: string; currencySymbol: string;
}) {
  const tr = (k: string, fb: string) => (t ? t(k) : fb);
  const cell = (v: any): string => {
    // The rule the whole feature rests on: unknown is "—", never 0.
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return "—";
    switch (row.kind) {
      case "enum":
        return xl ? xl(String(v), row.field === "cut" ? CUTS_EN : CATS_EN) : String(v);
      case "score":
      case "stars":
        return String(Math.round(Number(v) * 10) / 10) + "/5";
      case "weight":
        return String(Math.round(Number(v) * 10) / 10) + " " + weightUnit;
      case "age":
        return String(v) + " " + tr("age_y_word", "ans");
      case "count":
        return row.field === "oldestLotDays" ? fmtLotAge(Number(v), t || ((k: string) => k)) : String(v);
      case "money":
        return (Math.round(Number(v) * 100) / 100).toFixed(2) + " " + currencySymbol;
      case "aromas":
        return (v as string[]).map((k) => tr(aromaLabelKey(k), k)).join(" · ");
      default:
        return String(v);
    }
  };
  return (
    <tr data-compare-row={row.field} data-differs={row.differs ? "1" : "0"}>
      <th scope="row" style={{
        textAlign: "left", verticalAlign: "top", padding: "7px 8px 7px 0",
        borderTop: `1px solid ${C.rule}`, width: "28%",
        fontFamily: F.mono, fontSize: fs(10.5), letterSpacing: 1,
        textTransform: "uppercase", fontWeight: 700,
        color: row.differs ? C.brassHi : C.tx3,
      }}>{tr(row.labelKey, row.field)}</th>
      {row.values.map((v, i) => (
        <td key={i} style={{
          padding: "7px 0 7px 8px", verticalAlign: "top",
          borderTop: `1px solid ${C.rule}`,
          fontFamily: F.body, fontSize: fs(13.5),
          color: v === null ? C.tx3 : C.tx,
          // The whole point of a comparison: what actually disagrees is marked,
          // so the reader is not left doing the diffing.
          background: row.differs ? alpha(C.brass, "0f") : "transparent",
        }}>{cell(v)}</td>
      ))}
    </tr>
  );
}
