// Shared "Sync with DB" diff renderer.
// Previously inlined in TobaccoFormView (as `DbSyncDiff`) and
// WishFormView (as `WishDbSyncDiff`). Identical line-for-line —
// promoted to a single primitive so the visual
// presentation stays consistent if a third caller ever appears
// (e.g. an "AI cross-check" reuse).

import { fs, C } from "../../theme-curator.ts";
import { CATS_EN, CUTS_EN } from "../../constants.ts";

export interface DbSyncDiffEntry {
  field: string;
  db: any;
  current: any;
}

export function DbSyncDiff({
  diffs, t, xl,
}: {
  diffs: DbSyncDiffEntry[];
  t?: (k: string) => string;
  // Category/cut are STORED canonical French, so they must be run
  // through xl() like everywhere else — a German user comparing their entry
  // with the catalogue was reading "Anglais" and "Ribbon". Invisible to
  // `no-raw-enum-render`: the read is a generic `d.db`, not a field-named
  // property access the rule can recognise.
  xl?: (v: string, m: readonly string[]) => string;
}) {
  // NULL-PROTOTYPE, et ce n'est pas de la coquetterie : sur un littéral plein,
  // `FIELD_LABELS["__proto__"]` rend `Object.prototype` — TRUTHY — donc le
  // repli `|| t("lbl_field")` ne se déclenche jamais et un OBJET part vers
  // React, qui jette « Objects are not valid as a React child » et fait tomber
  // toute la fiche dans la frontière d'erreur. C'est la classe déjà consignée
  // pour `xl()` et `catColor()`, par une porte que personne n'avait regardée.
  //
  // Latent aujourd'hui — `d.field` vient d'une liste fixe dans `useDbSync`, pas
  // de données utilisateur — mais la carte juste en dessous est déjà
  // null-prototype pour cette raison exacte, et une seule des deux protégée est
  // une invitation à se tromper. `no-dynamic-index-plain-map` ne peut pas le
  // voir : la règle est limitée à la portée MODULE, ce que le cas `ghosting.ts`
  // avait déjà montré insuffisant.
  const FIELD_LABELS: Record<string, string> = Object.assign(Object.create(null), {
    name: t ? t("f_name") : "Nom",
    brand: t ? t("f_brand") : "Marque",
    category: t ? t("lbl_type") : "Type",
    cut: t ? t("lbl_cut") : "Coupe",
    blend: t ? t("lbl_blend") : "Composition",
    force: t ? t("lbl_force") : "Force",
    roomNote: t ? t("lbl_room_note") : "Room Note",
    taste: t ? t("lbl_taste") : "Goût",
    agingMax: t ? t("lbl_aging_max") : "Âge max cave (ans)",
    description: t ? t("lbl_desc") : "Description",
  });
  // Which diff fields hold an enum value, and against which English map.
  const ENUM_MAPS: Record<string, readonly string[]> =
    Object.assign(Object.create(null), { category: CATS_EN, cut: CUTS_EN });
  const showVal = (field: string, v: any) => {
    const m = ENUM_MAPS[field];
    return m && xl ? xl(String(v), m) : String(v);
  };
  // Descriptions are long-form prose. Truncate the
  // display to ~70 chars/side so a single row stays readable — the
  // full text still lands in the form when the user taps Sync.
  function preview(v: any): string {
    var s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (s.length <= 70) return s;
    return s.slice(0, 67) + "…";
  }
  return (
    <div style={{ fontSize: fs(13.5), color: C.tx, lineHeight: 1.5 }}>
      {diffs.map((d) => (
        <div key={d.field} style={{ display: "flex", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ color: C.tx3, minWidth: 90, flexShrink: 0 }}>{FIELD_LABELS[d.field] || (t ? t("lbl_field") : "Champ")}</span>
          <span style={{ color: C.tx2 }}>{d.current ? preview(showVal(d.field, d.current)) : "—"}</span>
          <span style={{ color: C.tx3 }}>→</span>
          <span style={{ color: C.brassHi }}>{preview(showVal(d.field, d.db))}</span>
        </div>
      ))}
    </div>
  );
}
