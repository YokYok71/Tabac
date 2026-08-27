// Shared "Sync with DB" hook.
// Previously inlined in TobaccoFormView + WishFormView.
// Extracted here to remove ~80 LoC of duplication and to
// give the dismiss-branch tests a single source of truth.
//
// Detects when the editing form's brand+name matches a catalog entry
// AND at least one field diverges from the catalog value.
// Returns:
//   - `dbSync`: null OR { hit, diffs[] } describing the divergence
//   - `applyDbSync()`: patches the form fields to the catalog values
//   - `dismissDbSync()`: hides the notice for the current entry
//
// **Personal notes (`tastingNotes`) are NEVER in the diff** — that's
// the only user-owned prose the sync respects. Description WAS
// originally excluded too, but a later editorial
// pass on the catalog made the descriptions worth propagating —
// the user opted in explicitly. Only their tasting notes stay
// sacrosanct.

import { canonCategory, canonCut } from "../constants.ts";
import React from "react";
import { tobaccoDbLookupSync } from "../utils/tobaccoDb.ts";

var useState = React.useState,
  useEffect = React.useEffect,
  useMemo = React.useMemo;

export interface DbSyncDiff {
  field: string;
  db: any;
  current: any;
}

export interface DbSyncResult {
  hit: any;
  diffs: DbSyncDiff[];
}

// Description + name + brand joined the diff after the
// user explicitly opted in (an editorial pass made the
// catalog descriptions authoritative; canonicalising name + brand
// normalises the user's typed variants to the catalog's display
// form). `tastingNotes` stays excluded — that's the only user-owned
// prose the sync NEVER touches. The lookup exposes the brand as
// `brandDisplay`, so we alias it via HIT_KEY when reading.
const FIELDS = [
  "name", "brand",
  "category", "cut", "blend",
  "force", "roomNote", "taste",
  "agingMax",
  "description",
];
// Null-proto (a forged form-field key like "__proto__" must not
// resolve to Object.prototype and defeat the `HIT_KEY[f] || f` fallback).
const HIT_KEY: Record<string, string> = Object.assign(Object.create(null), {
  brand: "brandDisplay",
});

/**
 * Has the catalogue anything to ADD to this form? True when at least one field
 * the catalogue can supply is still EMPTY in the form.
 *
 * This is what `CatalogOffer` was missing. Its `show` was only
 * "brand + name match a catalogue entry", which is true for a catalogued blend
 * for ever, so the offer to "fill the fiche in one tap" appeared on EVERY open
 * of an already-complete fiche. Applying it used to dismiss it, but only
 * within one mount: re-opening the form remounted the component, reset the
 * flag, and the offer was back. Reported as "when I reopen it asks me to update
 * from the catalogue again".
 *
 * Note the deliberate difference from `useDbSync`'s diff: this asks whether a
 * field is EMPTY (nothing to lose — fill it), the diff asks whether a field
 * DIVERGES (the user's value would be overwritten — ask first). Two questions,
 * two banners, and conflating them is what produced a banner that never left.
 *
 * Identity is excluded: `name`/`brand` are what the user typed to get the match
 * in the first place, so they are never "missing".
 */
/**
 * What the catalogue offers for a field, as the CELLAR can
 * store it, or null when it cannot store it at all.
 *
 * The catalogue is the user's OWN file and `parseCatalogueCsv`
 * keeps an unrecognised taxonomy label VERBATIM on purpose. Both this hook and
 * the bulk pass copied `category` / `cut` straight across, so a catalogue row
 * saying `Pipeweed` / `Zigzag Cut` landed in the cellar — where the form's
 * dropdown has no option for it, so the first save rewrites it anyway.
 * Returning null makes the field invisible to the diff, so nothing is
 * offered that applying would not actually change.
 */
function offered(f: string, hit: any): any {
  const raw = hit[HIT_KEY[f] || f];
  if (f === "category") return canonCategory(raw);
  if (f === "cut") return canonCut(raw);
  return raw;
}

export function catalogueCanFill(form: any, hit: any): boolean {
  if (!form || !hit) return false;
  for (const f of FIELDS) {
    if (f === "name" || f === "brand") continue;
    const dbVal = offered(f, hit);
    if (typeof dbVal === "number" ? !dbVal : !String(dbVal || "").trim()) continue;
    const cur = form[f];
    const vide = typeof cur === "number" ? !cur : !String(cur ?? "").trim();
    if (vide) return true;
  }
  return false;
}

export function useDbSync(opts: {
  enabled: boolean;
  /** Stable identity of the entry being edited — drives the dismiss
   *  scope. `form.id` for tabacs, `editWishId` for wishes. */
  entryId: any;
  form: any;
  /** Base catalogue (specs) loaded — enough to MATCH a blend. */
  dbReady: boolean;
  lang: string;
  setForm: (next: any) => void;
}) {
  var _dis = useState<any>(null),
    dismissed = _dis[0],
    setDismissed = _dis[1];

  // Ghost-click defence. On mobile, tapping "Synchroniser"
  // instantly clears the diffs, which unmounts the banner — the form
  // fields below shift UP under the finger, and the ~150 ms synthetic
  // click that trails the PressCard release lands on whatever is now
  // there (a native <select> for category/cut → pops its option list
  // open unprompted). The activeElement.blur() only covered the
  // keyboard-focus case, not this touch ghost-click. We keep the banner
  // mounted as an inert "✓ synchronised" state for a short window so the
  // layout stays put and the ghost-click hits an inert surface. Mirrors
  // the Modal / lightbox deferred-unmount pattern (see docs/ui.md).
  var _applied = useState(false),
    applied = _applied[0],
    setApplied = _applied[1];
  var appliedTimer = React.useRef<any>(null);
  useEffect(function () {
    return function () { if (appliedTimer.current) clearTimeout(appliedTimer.current); };
  }, []);

  // Reset dismissal when the entry being edited changes — a fresh
  // edit session must re-evaluate from scratch. setDismissed is a
  // stable React state setter — excluding it is the canonical pattern.
  useEffect(function () {
    setDismissed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.entryId]);

  var dbSync = useMemo<DbSyncResult | null>(function () {
    if (!opts.enabled || !opts.form || !opts.dbReady) return null;
    if (dismissed === opts.entryId) return null;
    var brand = String(opts.form.brand || "").trim();
    var name = String(opts.form.name || "").trim();
    if (!brand || !name) return null;
    var hit: any = tobaccoDbLookupSync(brand, name, opts.lang);
    if (!hit) return null;
    var diffs: DbSyncDiff[] = [];
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i]!;
      var dbVal = offered(f, hit);
      var curVal = opts.form[f];
      var dbIsNum = typeof dbVal === "number";
      var curIsNum = typeof curVal === "number";
      if (dbIsNum || curIsNum) {
        if (!dbVal && dbVal !== 0) continue;
        if (Number(dbVal) !== Number(curVal || 0)) {
          diffs.push({ field: f, db: dbVal, current: curVal || 0 });
        }
      } else {
        var a = String(dbVal || "").trim();
        var b = String(curVal || "").trim();
        if (!a) continue;
        if (a !== b) diffs.push({ field: f, db: a, current: b });
      }
    }
    if (diffs.length === 0) return null;
    return { hit: hit, diffs: diffs };
  }, [opts.enabled, opts.entryId, opts.form, opts.dbReady, opts.lang, dismissed]);

  function applyDbSync() {
    if (!dbSync) return;
    var patch: any = {};
    for (var i = 0; i < dbSync.diffs.length; i++) {
      var d = dbSync.diffs[i]!;
      patch[d.field] = d.db;
    }
    // Blur BEFORE the setForm re-render. The "Synchroniser"
    // button lives inside the dbSync banner, which unmounts the instant
    // the diffs clear (applying the patch makes diffs.length === 0). When
    // a focused element is removed from the DOM, mobile WebKit reassigns
    // focus to the next focusable in source order — the name / category
    // field just below — which pops the keyboard and scrolls the form
    // unprompted (the user-reported "focus jumps to name/type"). Blurring
    // the button first sends focus to <body> so nothing gets auto-focused.
    try {
      var ae = typeof document !== "undefined" ? (document.activeElement as any) : null;
      if (ae && typeof ae.blur === "function") ae.blur();
    } catch (_e) { /* non-DOM env — nothing to blur */ }
    opts.setForm(Object.assign({}, opts.form, patch));
    // Ghost-click defence: flip `applied` on so the form renders a
    // full-screen invisible tap-catcher overlay for a short window. The
    // ~150 ms synthetic tap that trails the PressCard release then lands on
    // the overlay, not on a form <select> that shifted up under the finger
    // (which would pop its native option list open). Component-scoped, so it
    // unmounts cleanly with the form — no leaked document listeners.
    setApplied(true);
    if (appliedTimer.current) clearTimeout(appliedTimer.current);
    appliedTimer.current = setTimeout(function () { setApplied(false); }, 420);
  }

  function dismissDbSync() {
    setDismissed(opts.entryId);
  }

  return { dbSync: dbSync, applied: applied, applyDbSync: applyDbSync, dismissDbSync: dismissDbSync };
}
