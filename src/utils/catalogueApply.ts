// Apply the reference catalogue to the WHOLE cellar in one pass.
//
// `useDbSync` already does this for ONE fiche, at form-open time. This is the
// bulk counterpart, driven from Settings → Données, and the reason it is a pure
// module is that its whole value rests on one promise — "personal data is never
// overwritten" — and that promise has to be assertable, not eyeballed over 200
// rows.
//
// ── WHAT IS APPLIED ────────────────────────────────────────────────────────
// The same factual field set as `useDbSync`, MINUS name and brand.
//
// Excluding identity is deliberate and is the one place this pass is stricter
// than the per-fiche sync. `useDbSync` offers name/brand because the user is
// looking at that single fiche and can see what they are accepting. A bulk pass
// reviews nothing: silently rewriting the label the user recognises their tin by
// — across hundreds of rows — is the one change they would struggle to spot and
// hardest to reason about afterwards. It is also the merge identity (`dupKey` is
// `brand|name`, CSV re-import dedups on it), so a bulk rename would quietly move
// rows around on the next import. The per-fiche sync still offers it.
//
// ── WHAT IS NEVER TOUCHED ──────────────────────────────────────────────────
// Everything the user authored or measured:
//   tastingNotes  their own prose — the field `useDbSync` has always refused
//   rating        their judgement
//   rebuy         their judgement ("à ne pas reprendre" is a deliberate act)
//   imageUrl      their photo
//   notes         the wishlist personal note
//   priority      wishlist ordering
//   lots          stock, weights, prices, dates — the accounting
//   tags          their own collections
//   id / uid      identity
// The list is asserted field-by-field in catalogueApply.test.ts, and the test
// builds its fixtures from the templates so a NEW personal field on Tobacco is
// protected by default rather than silently exposed.
//
// ── THE PER-FICHE OPT-OUT ─────────────────────────────────────────────────
// A fiche carrying `catalogueLock` is skipped ENTIRELY — before the lookup, so
// the catalogue is never even consulted for it. The field lives on Tobacco and
// WishlistItem and is set by a checkbox at the bottom of each form.
//
// It exists because the field-level protections above answer "which columns",
// and some users curate a WHOLE fiche by hand — a corrected composition, a
// strength they measured themselves, a description they rewrote. For those the
// right unit of protection is the row, not the column.
//
// Scope is the BULK pass ONLY, and that is the point rather than a limitation:
// the bulk pass reviews nothing, whereas `useDbSync`'s per-fiche offer puts the
// diff on screen and waits for a tap. Locking a row must not disable a control
// the user is looking at.

// `description` IS applied, which is the one judgement call worth stating: it is
// CATALOGUE prose, not the user's. That is the settled convention — `useDbSync`
// has synced it for a long time and refuses only `tastingNotes`, and the
// merge rules make the same split. A user's own writing about a blend
// belongs in `tastingNotes`, which is inviolable.

/** One field the catalogue would change on one entity. */
import { canonCategory, canonCut } from "../constants.ts";

export interface CatalogueFieldChange {
  field: string;
  from: any;
  to: any;
}

export interface CatalogueEntityChange {
  kind: "tobacco" | "wish";
  id: any;
  label: string;
  changes: CatalogueFieldChange[];
}

export interface CataloguePlan {
  entries: CatalogueEntityChange[];
  /** Live rows whose brand+name found no catalogue entry. */
  unmatched: number;
  /** Live rows matched but already identical to the catalogue. */
  alreadyCurrent: number;
  /**
   * Live rows the user has PINNED (`catalogueLock`). They are
   * skipped before the lookup, so they are neither `unmatched` nor
   * `alreadyCurrent` — conflating them with either would be a lie in the
   * confirm modal, which is the one place the user decides.
   */
  locked: number;
  tobaccosChanged: number;
  wishesChanged: number;
  fieldsChanged: number;
}

// The factual fields the catalogue can speak for. Identity (name/brand) is
// excluded — see the header.
export const APPLIED_FIELDS = [
  "category", "cut", "blend",
  "force", "roomNote", "taste",
  "agingMax",
  "description",
] as const;

// Fields this pass must NEVER write. Exported so the test can assert the
// promise directly instead of restating it.
export const PROTECTED_FIELDS = [
  "id", "uid", "name", "brand",
  "tastingNotes", "rating", "rebuy",
  "imageUrl", "notes", "priority",
  "lots", "tags", "deletedAt",
  // Already unreachable — a locked row never enters the
  // plan — but the pass must never be able to clear the very flag that keeps
  // a row out of it. Listing it makes that a stated promise the test asserts
  // rather than an emergent property of the walk.
  "catalogueLock",
] as const;

// The catalogue exposes the brand under a different key; mirrors useDbSync.
// Null-proto: the key comes from our own list here, but the same forged-key
// reasoning as the no-dynamic-index rule applies if this ever takes user input.
const HIT_KEY: Record<string, string> = Object.assign(Object.create(null), {
  brand: "brandDisplay",
});

function isBlank(v: any): boolean {
  return typeof v === "number" ? !v : !String(v ?? "").trim();
}

/**
 * What WOULD change, without changing anything. The caller shows this to the
 * user before applying — a pass over the whole cellar must be previewable.
 *
 * `lookup` is injected (normally `tobaccoDbLookupSync`) so the plan is testable
 * without loading the catalogue.
 */
export function planCatalogueApply(
  data: any,
  lang: string,
  lookup: (brand: string, name: string, lang: string) => any,
): CataloguePlan {
  const entries: CatalogueEntityChange[] = [];
  let unmatched = 0, alreadyCurrent = 0, fieldsChanged = 0, locked = 0;
  let tobaccosChanged = 0, wishesChanged = 0;

  const walk = (rows: any[], kind: "tobacco" | "wish") => {
    for (const row of rows || []) {
      if (!row || row.deletedAt) continue;          // trashed rows stay trashed
      // The user pinned this fiche. Skipped BEFORE the lookup
      // — the catalogue is not consulted at all, so a pinned row cannot even
      // be counted as matched. That is the whole promise: never overwritten.
      if (row.catalogueLock) { locked++; continue; }
      const brand = String(row.brand || "").trim();
      const name = String(row.name || "").trim();
      if (!brand || !name) { unmatched++; continue; }
      const hit = lookup(brand, name, lang);
      if (!hit) { unmatched++; continue; }
      const changes: CatalogueFieldChange[] = [];
      for (const f of APPLIED_FIELDS) {
        let dbVal = hit[HIT_KEY[f] || f];
        if (isBlank(dbVal)) continue;               // the catalogue has nothing to say
        // A value the CELLAR cannot represent is not applied.
        //
        // The catalogue is the user's OWN file, and
        // `parseCatalogueCsv` keeps an unrecognised taxonomy label VERBATIM on
        // purpose (silently rewriting someone's vocabulary is worse than
        // reporting it). This walk copied it straight into the cellar, where
        // it becomes the unrepresentable-value defect: no `CUT_DENSITY` for the session
        // bowl-weight estimate, no `xl()` translation so the raw string renders
        // in all six languages, no `FAMILY_AGING_MAX` entry so the blend loses
        // its maturity band entirely, and no matching option in the form's
        // fixed dropdown — so the first time the user opens and saves that
        // fiche the app rewrites the value itself. Reproduced with a catalogue
        // row saying `Pipeweed` / `Zigzag Cut`.
        //
        // SKIPPED, not snapped to "Autre": this pass's whole promise is that
        // personal data is never overwritten, so replacing a correct category
        // with the catch-all because the catalogue is approximate would be a
        // downgrade — and on an empty field "Autre" adds nothing. The label
        // stays in the catalogue exactly as the user wrote it, and
        // « Vérifier mon catalogue » still reports it.
        if (f === "category" || f === "cut") {
          const canon = f === "category" ? canonCategory(dbVal) : canonCut(dbVal);
          if (!canon) continue;
          dbVal = canon;   // a fold-only or alias difference is applied canonically
        }
        const cur = row[f];
        // Compare as strings so 3 and "3" are the same value — the cellar
        // stores force/roomNote/taste as numbers, the catalogue may not.
        if (String(cur ?? "") === String(dbVal)) continue;
        changes.push({ field: f, from: cur, to: dbVal });
      }
      if (!changes.length) { alreadyCurrent++; continue; }
      entries.push({ kind, id: row.id, label: String(brand + " " + name).trim(), changes });
      fieldsChanged += changes.length;
      if (kind === "tobacco") tobaccosChanged++; else wishesChanged++;
    }
  };
  walk(data?.tobaccos, "tobacco");
  walk(data?.wishlist, "wish");
  return { entries, unmatched, alreadyCurrent, locked, tobaccosChanged, wishesChanged, fieldsChanged };
}

/**
 * Apply a plan and return the NEW data. Pure — the caller owns persistence, so
 * the snapshot-undo wrapper in App.tsx can restore the previous state wholesale.
 *
 * `nowIso` is injected rather than read from the clock: this module must stay
 * deterministic (the repo forbids Date.now() in a few places for the same
 * reason, and a test that cannot pin the timestamp cannot assert it).
 */
export function applyCataloguePlan(data: any, plan: CataloguePlan, nowIso: string): any {
  if (!plan.entries.length) return data;
  const byKind = { tobacco: new Map<any, CatalogueEntityChange>(), wish: new Map<any, CatalogueEntityChange>() };
  for (const e of plan.entries) byKind[e.kind].set(e.id, e);

  const patch = (rows: any[], kind: "tobacco" | "wish") =>
    (rows || []).map((row: any) => {
      const e = row && byKind[kind].get(row.id);
      if (!e) return row;
      const next = Object.assign({}, row);
      for (const c of e.changes) {
        // Defence in depth: even if APPLIED_FIELDS and PROTECTED_FIELDS ever
        // overlapped through an edit, a protected field cannot be written here.
        if ((PROTECTED_FIELDS as readonly string[]).indexOf(c.field) !== -1) continue;
        next[c.field] = c.to;
      }
      next.updatedAt = nowIso;   // a real edit — so multi-device LWW sees it
      return next;
    });

  return Object.assign({}, data, {
    tobaccos: patch(data?.tobaccos, "tobacco"),
    wishlist: patch(data?.wishlist, "wish"),
  });
}
