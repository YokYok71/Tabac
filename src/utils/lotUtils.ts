/**
 * Pure utility functions for lot/batch management.
 * No React, no state — safe to import anywhere.
 */

// The Infinity-hardened weight coercion is now single-sourced in
// utils.ts (was duplicated here + useSessionStore + stats). Aliased to keep
// the local `safeW` call sites unchanged. Guards pickJarLot's `isRound` from
// a forged `weightG:"Infinity"` (`Infinity % 50 === 0` → NaN === 0 → false →
// non-round → wrongly preferred as the jar lot).
import { safeWeight as safeW, isUntrackedWeight, today as _todayLocal } from "../utils.ts";

/**
 * Selects the "best" jar lot for a tobacco:
 * - prefers non-round weight (g: not multiple of 50; oz: non-integer)
 * - then oldest dateOpened
 * Returns {lot, idx} or null.
 * Only searches status === "jar" lots.
 */
export function pickJarLot(tob: any, weightUnit: string): { lot: any; idx: number } | null {
  // Guard against non-array `lots`. Real production code
  // always passes a Tobacco with `lots: Lot[]`, but the property fuzz
  // exposed that `.reduce` would crash on a string / number / null
  // `lots` field — and ANY guard at the data layer that lets garbage
  // through becomes our problem if a future direct caller doesn't
  // normalise first. `Array.isArray` is the canonical defence.
  if (!tob) return null;
  var lots = Array.isArray(tob.lots) ? tob.lots : [];
  var jars = lots.reduce(function (acc: any[], l: any, i: number) {
    // Review fix: never pick a soft-deleted (trashed) lot. Stores get raw
    // `data` (trashed rows must survive saves), so a session with an empty
    // lotId could otherwise debit a lot the user believes is gone.
    // `isUsableLot`, not `status === "jar"`. The two predicates
    // disagreed on exactly one lot — a jar carrying an EXPLICIT weight of "0",
    // which is settled to mean an empty tin — and the disagreement was
    // reachable and silent. A tobacco with a 0 g jar AND a full cellar lot is
    // offered in both session pickers (the cellar lot makes it usable); the
    // auto-select then landed on the 0 g JAR, which is absent from the picker's
    // option list, so the `<select>` displayed the cellar lot while the state
    // held the empty jar — and the session was capped to 0 g against it.
    // REPRODUCED before the fix (usable = [cellar], picked = the 0 g jar).
    //
    // The credit direction (`locateLotIdx` with delta > 0, no lotId) loses its
    // fallback onto such a jar and falls through to the finished-lot branch or
    // to -1. That is deliberate: an empty tin is not where a restored session's
    // grams belong, and every modern caller passes an explicit lot id — the
    // fallback is a legacy path, not the normal one.
    // Still JAR-only — that is this function's contract, and `_persistSession`
    // refuses a cellar lot outright.
    if (l && l.status === "jar" && isUsableLot(l)) acc.push({ lot: l, idx: i });
    return acc;
  }, []);
  if (!jars.length) return null;
  if (jars.length === 1) return jars[0];
  var isRound = function (l: any) {
    var w = safeW(l.weightG);
    return weightUnit === "oz" ? w % 1 === 0 : w % 50 === 0;
  };
  var nonRound = jars.filter(function (e: any) {
    return !isRound(e.lot);
  });
  var candidates = nonRound.length > 0 ? nonRound : jars;
  return candidates.slice().sort(function (a: any, b: any) {
    return String(a.lot.dateOpened || "").localeCompare(String(b.lot.dateOpened || ""));
  })[0];
}

// ─── Held-stock predicates ────────────────────────────────────────────
// Single source of truth for "can this lot back a session" and "does this
// tobacco have any usable lot / how much stock is on hand". Extracted from
// ~7 drifted inline copies across SessionFormView / TastingView /
// InventoryDetailView / InventoryListView. CLAUDE.md
// conv. #17/#18 require SessionFormView and TastingView to offer the SAME
// tobaccos/lots line-for-line — sharing the predicate turns that
// copy-paste discipline into a code guarantee.

// A lot is "usable" for a session when it is still held (jar OR cellar —
// NOT finished) AND carries a positive balance. `safeW` hardens against a
// forged `weightG:"Infinity"` (parseFloat||0 would let it through).
export function isUsableLot(l: any): boolean {
  if (!l || l.deletedAt) return false;
  if (l.status !== "jar" && l.status !== "cellar") return false;
  // An UNWEIGHED lot is usable. `safeW("")` is 0, so a jar
  // the user opened and never weighed was read as empty and its tobacco
  // disappeared from the session picker entirely: the tin is open on the
  // desk and the app refuses to log a bowl from it. Reported from the app.
  //
  // The distinction is the one `checkLotInvariants` has drawn since build
  // 167 — a blank weight is an absence of data, an explicit 0 is an empty
  // tin (which auto-finishes anyway). Only the second may hide a lot.
  if (isUntrackedWeight(l.weightG)) return true;
  return safeW(l.weightG) > 0;
}

// True when the tobacco has at least one usable lot (drives the session
// tobacco dropdown + the "Démarrer une séance" CTA gate).
export function tobaccoHasUsableLot(tob: any): boolean {
  if (!tob) return false;
  var lots = Array.isArray(tob.lots) ? tob.lots : [];
  return lots.some(isUsableLot);
}

/**
 * The lot a NEW session should charge: the best usable jar,
 * else the oldest usable CELLAR lot (which the two entry points then offer to
 * open through a confirm).
 *
 * It exists because both `SessionFormView` and `TastingView` carried this
 * block verbatim, and a rule written twice is a rule that drifts — the same
 * `.filter()` had already had to be fixed in both files. More than style:
 * the auto-selected lot MUST be one the picker below it will list, or the
 * `<select>` shows one lot while the state holds another. Guaranteed here by
 * construction — every candidate passes `isUsableLot`, which is exactly the
 * predicate both views build their option list from.
 *
 * The cellar tie-break is the oldest PURCHASE, matching the blocks it replaced.
 */
export function pickSessionLot(tob: any, weightUnit: string): any | null {
  if (!tob) return null;
  var jar = pickJarLot(tob, weightUnit);
  if (jar) return jar.lot;
  var lots = Array.isArray(tob.lots) ? tob.lots : [];
  return lots
    .filter(function (l: any) { return l && l.status === "cellar" && isUsableLot(l); })
    .slice()
    .sort(function (a: any, b: any) {
      return String(a.datePurchased || "").localeCompare(String(b.datePurchased || ""));
    })[0] || null;
}

// Total weight the user still physically holds for a tobacco: sum of every
// non-finished lot's balance (hardened via safeW). Excludes finished AND
// soft-deleted lots. Used by the list card, the detail hero and the qty
// sort — they must all report the same "en cave" figure.
export function heldWeight(tob: any): number {
  if (!tob) return 0;
  var lots = Array.isArray(tob.lots) ? tob.lots : [];
  return lots.reduce(function (s: number, l: any) {
    if (!l || l.deletedAt || l.status === "finished") return s;
    return s + safeW(l.weightG);
  }, 0);
}

// Will the session's weight zero-out (or drive
// negative) the selected lot? `applyLotWeightDelta` then auto-finishes it
// silently, so both the session form and the live tasting surface an info
// banner. Shared so the two projections stay in step. `restoreWeight` is
// the OLD session weight being given back on an editJ (0 on a fresh add /
// live tasting). Skips finished lots + zero session weight (no warning).
export function lotWillClose(lot: any, sessionWeight: number, restoreWeight: number = 0): boolean {
  if (!lot || lot.status === "finished") return false;
  if (!(sessionWeight > 0)) return false;
  // Third reader of the same distinction. `parseFloat("")`
  // is NaN, so `|| 0` made an UNWEIGHED lot look like an empty one and the
  // form announced « ce lot va être terminé » about a tin that stepApplyDelta
  // now leaves untouched. A banner that contradicts what the save does is
  // worse than no banner.
  if (isUntrackedWeight(lot.weightG)) return false;
  var lotW = parseFloat(lot.weightG) || 0;
  return lotW + restoreWeight - sessionWeight <= 0;
}

// Canonical lot ordering for the session + tasting lot
// pickers. Jar before cellar (smoke from an already-opened tin before
// opening a new one); within jar ascending dateOpened (FIFO); within
// cellar ascending boxNumber (numeric when parseable, else String-coerced
// — this guards against a numeric boxNumber crashing localeCompare).
// Shared verbatim so SessionFormView and TastingView never desync.
export function compareLotForPicker(a: any, b: any): number {
  if (a.status !== b.status) return a.status === "jar" ? -1 : 1;
  if (a.status === "jar") {
    return String(a.dateOpened || "").localeCompare(String(b.dateOpened || ""));
  }
  var an = parseInt(a.boxNumber, 10);
  var bn = parseInt(b.boxNumber, 10);
  if (!isNaN(an) && !isNaN(bn)) return an - bn;
  return String(a.boxNumber || "").localeCompare(String(b.boxNumber || ""));
}

// ─── Lifecycle date rules ─────────────────────────────────────────────
// Single source of truth for the "what date fields to set/clear when
// the lot transitions to status X" rules. Used by:
//   - changeLotStatus  (manual transition, useTobaccoStore)
//   - stepAutoReactivate (auto-recovery via session delete / weight
//     restore on a finished lot — preserves opening history)
// The "manual" mode clears dateOpened when going to cellar (user
// explicitly resets the lot to its sealed state). The "auto-recovery"
// mode preserves dateOpened as historical memory (fix #23).
// For both modes, "jar" always carries a non-empty dateOpened (defaulted
// to today if absent) so the lifecycle invariant `jar ⟹ dateOpened`
// always holds.
export type TransitionMode = "manual" | "auto-recovery";

export function applyLifecycleDates(
  lot: any,
  nextStatus: "cellar" | "jar" | "finished",
  mode: TransitionMode = "manual",
): any {
  var out: any = Object.assign({}, lot, { status: nextStatus });
  // LOCAL calendar date (shared today()) so an evening cellar→jar /
  // →finished transition doesn't stamp tomorrow's UTC date west of UTC.
  var today = _todayLocal();
  // The "is the field already a non-empty date?" check
  // must accept ONLY a non-empty string. The previous `!out.dateOpened`
  // returned false for the numeric value `-1` (truthy), letting a
  // numeric garbage field bypass the today-default and break the
  // lifecycle invariant (`jar ⟹ typeof dateOpened === "string"` and
  // it's non-empty). Same for dateFinished.
  function hasDateString(v: any): boolean {
    return typeof v === "string" && v.length > 0;
  }
  if (nextStatus === "jar") {
    if (!hasDateString(out.dateOpened)) out.dateOpened = today;
    out.dateFinished = "";
    // A jar lot is ACTIVE — it can't be
    // "disposed" (thrown / given away). Clear the flag on a manual reactivate
    // to jar, matching the cellar branch below AND stepAutoReactivate (which
    // clears it on the auto path). The jar branch used to leave disposed:true,
    // leaking an "Éliminé"-flagged active jar lot that would reappear under the
    // Éliminés filter if it was later re-finished through a non-consumption path.
    if (mode === "manual") out.disposed = false;
  } else if (nextStatus === "finished") {
    if (!hasDateString(out.dateFinished)) out.dateFinished = today;
  } else {
    // cellar
    out.dateFinished = "";
    if (mode === "manual") {
      out.dateOpened = "";
      out.disposed = false;
    }
  }
  return out;
}

// ─── applyLotWeightDelta pipeline ─────────────────────────────────────
// Refactored from a 50-line monolith into 4 pure, individually
// testable steps. Each step takes a lot, returns an updated lot.

/** Locate the lot index inside a tobacco. Falls back to pickJarLot,
 *  then to the most-recently-finished lot if delta > 0. Returns -1
 *  when nothing matches. */
export function locateLotIdx(tob: any, lotId: any, delta: number, weightUnit: string): number {
  // Guard against null/undefined `tob` and non-array
  // `tob.lots`. Same rationale as pickJarLot's guard.
  if (!tob) return -1;
  var lots = Array.isArray(tob.lots) ? tob.lots : [];
  var idx = -1;
  if (lotId) {
    idx = lots.findIndex(function (l: any) {
      return String(l.id) === String(lotId);
    });
  }
  if (idx === -1) {
    var b = pickJarLot(tob, weightUnit);
    if (b) idx = b.idx;
  }
  if (idx === -1 && delta > 0) {
    var fins = lots.reduce(function (acc: any[], l: any, i: number) {
      // Review fix: don't auto-reactivate a soft-deleted (trashed) finished lot.
      if (l && !l.deletedAt && l.status === "finished") acc.push({ lot: l, idx: i });
      return acc;
    }, []);
    if (fins.length === 1) {
      idx = fins[0].idx;
    } else if (fins.length > 1) {
      fins.sort(function (a: any, b: any) {
        return String(b.lot.dateFinished || "").localeCompare(String(a.lot.dateFinished || ""));
      });
      idx = fins[0].idx;
    }
  }
  return idx;
}

/** Step 1: apply the raw delta (clamped at 0, rounded per unit).
 *  Guard against non-finite `delta` (Infinity, NaN, undefined,
 *  null, garbage strings) — same fix already in applyLotWeightDelta, but
 *  applied at the step level too so a future direct caller can't bypass
 *  it. Non-finite delta becomes a no-op (the existing weight survives).
 *  Parse string deltas defensively (Lot.weightG is stored as a
 *  string everywhere, so a direct caller is likely to hand in a string).
 *  Symmetric with stepAutoReactivate's own defensive widening.
 *  UNIT-AWARE rounding precision. 0.1 g is negligible, but 0.1 oz
 *  ≈ 2.8 g ≈ a whole bowl — rounding every oz balance to 0.1 systematically
 *  OVER-deducted (each session shaved ~0.02 oz extra, the tin auto-finished
 *  early and the journal under-counted the smoked total, invisibly to the
 *  balance invariant which only flags the over-claim direction). Grams keep
 *  0.1 (1 dp); ounces round to 0.01 (2 dp), matching the 2-dp oz values the
 *  bowl estimator produces. `weightUnit` defaults to grams for legacy/direct
 *  callers. */
// Round a weight to the SAME unit grid the lot deduction
// uses (1 dp g / 2 dp oz). A session stores its own weightG while the lot
// balance is debited via stepApplyDelta's rounded delta — if the stored value
// isn't rounded to the same grid, Σ(sessions) and (weightInitial − weightG)
// drift by sub-grid amounts, and after enough hand-typed >1 dp sessions on ONE
// lot the drift crosses the balance tolerance → a FALSE lot-balance-overflow.
// Rounding the stored session weight here keeps Σ and the debit byte-identical.
// Non-finite → 0 (mirrors safeW).
export function roundWeightToUnit(w: any, weightUnit?: string): number {
  var v = parseFloat(String(w));
  if (!Number.isFinite(v)) return 0;
  var factor = weightUnit === "oz" ? 100 : 10;
  return Math.round(v * factor) / factor;
}

/**
 * Round a DISPLAY AGGREGATE (a year's consumption, a total) to a precision the
 * unit can carry. A weight is stored in whatever unit the user typed — the unit
 * setting is display-only — so `Math.round` means 1 g in gram mode and 28.35 g
 * in ounce mode: a year of light smoking (3 bowls at 0.09 oz) reported "0 oz",
 * and 8 bowls reported "1 oz" for 20 g actually smoked.
 *
 * Grams keep WHOLE units, which is what every gram user has always seen; ounces
 * get one decimal (0.1 oz = 2.8 g), the closest match on a tile that must also
 * fit a four-digit total. Two decimals would be finer than the gram branch's own
 * resolution, so it would be precision the figure does not have.
 *
 * This is the DISPLAY grid; `roundWeightToUnit` above is the DEDUCTION grid
 * (1 dp / 2 dp) and the two are deliberately different — a stored balance needs
 * more precision than a headline total.
 */
export function roundAggregateWeight(v: any, weightUnit?: string): number {
  var n = parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  var factor = weightUnit === "oz" ? 10 : 1;
  return Math.round(n * factor) / factor;
}

export function stepApplyDelta(lot: any, delta: any, weightUnit?: string): any {
  // An UNWEIGHED lot has no balance to move, so it is left
  // exactly as it is. This is the other half of the isUsableLot fix and it is
  // the load-bearing half: without it, logging one session against a jar the
  // user never weighed would write `weightG: "0"` (max(0, 0 − 2.5)) and
  // `stepAutoFinish` would then CLOSE the tin on the spot. Offering the lot
  // and destroying it would be worse than not offering it.
  //
  // It also keeps the lot out of the balance rules for good: `weightG` stays
  // blank, which is what `checkLotInvariants` skips.
  if (lot && isUntrackedWeight(lot.weightG)) return lot;
  var parsed = parseFloat(String(delta));
  var d = Number.isFinite(parsed) ? parsed : 0;
  var w = safeW(lot && lot.weightG);
  var factor = weightUnit === "oz" ? 100 : 10;
  var nw = Math.max(0, Math.round((w + d) * factor) / factor);
  return Object.assign({}, lot, { weightG: String(nw) });
}

/** Step 2: auto-finish a jar lot whose weight just hit 0. */
export function stepAutoFinish(lot: any): any {
  if (!lot) return lot;
  // FOURTH reader of the same notion, and the one that would
  // have undone the other three: an UNWEIGHED lot has no zero to reach, so it
  // must never auto-close. `safeW("")` is 0, so without this a jar the user
  // never weighed was finished by the first session logged against it — the
  // exact damage the fix exists to prevent, one step further down the pipe.
  // Found by writing the test, not by reading the code.
  if (isUntrackedWeight(lot.weightG)) return lot;
  var w = safeW(lot.weightG);
  if (w === 0 && lot.status === "jar") {
    return Object.assign({}, lot, {
      status: "finished",
      dateFinished: _todayLocal(), // LOCAL date, not UTC
      disposed: false,
    });
  }
  return lot;
}

/** Step 3: auto-reactivate a finished lot whose weight is positive again.
 *  Goes through applyLifecycleDates so a legacy finished-without-dateOpened
 *  lot picks up `today()` instead of remaining empty.
 *  Require `Number.isFinite(delta)` — an Infinity delta would
 *  otherwise spuriously trigger the auto-reactivate path.
 *  Parse delta defensively. `applyLotWeightDelta` pre-parses,
 *  but a direct caller might pass a string (Lot.weightG is stored as a
 *  string everywhere). Non-numeric / non-finite ⇒ no-op. */
export function stepAutoReactivate(lot: any, delta: any): any {
  if (!lot) return lot;
  var d = parseFloat(String(delta));
  if (!Number.isFinite(d)) return lot;
  var w = safeW(lot.weightG);
  // NEVER auto-reactivate a DISPOSED lot. `disposed` means the
  // tobacco was physically thrown / given away — deleting an old session that
  // credits weight back onto it must not resurrect it as usable jar stock
  // (phantom inventory that skews Stock-bas / shopping / held-weight, and which
  // checkBalanceInvariants can't flag because Σsessions=0=diff after the
  // session is gone). The weight is still restored onto the lot by
  // stepApplyDelta above, but it stays finished+disposed (shown only under
  // "Éliminés", never counted as stock). A finished-but-NOT-disposed lot still
  // reactivates — it genuinely has stock again.
  if (w > 0 && lot.status === "finished" && d > 0 && !lot.disposed) {
    // Latent-bug fix: a lot whose weight came back is no longer
    // "disposed" — it has stock again. Clear the flag (a no-op now that the
    // guard above already excludes disposed lots, kept for symmetry with
    // stepAutoFinish which sets disposed:false when finishing).
    //
    // Verify #8: the target is ALWAYS "jar", INTENTIONALLY — it
    // does NOT consult `originalStatus` the way the manual Réactiver button
    // does, and that asymmetry is correct. This path fires only when a SESSION
    // credits weight back onto a finished lot, and a lot that ever hosted a
    // session was necessarily OPENED (you can't smoke from a sealed cellar
    // tin). Restoring it to "cellar" (sealed) would be physically wrong for a
    // partially-consumed lot. The manual button consults `originalStatus`
    // because it can reactivate a NEVER-smoked lot (a mis-marked finish). Do
    // NOT "align" this to originalStatus — the contexts genuinely differ.
    return Object.assign({}, applyLifecycleDates(lot, "jar", "auto-recovery"), { disposed: false });
  }
  return lot;
}

// `stepCellarRevert` was REMOVED, and must NOT come back. The previous behaviour
// (jar lot reverts to cellar when a positive delta brings the weight
// back to weightInitial and originalStatus === "cellar") punished the
// common "delete a session" flow: the migration heuristic infers
// `originalStatus = "cellar"` for almost every legacy jar lot (any jar
// with a dateOpened, i.e. effectively all of them), so a session delete
// silently demoted an opened pot back into the sealed cellar. The
// product invariant — confirmed by the user — is that an opened jar
// MUST NEVER auto-revert to cellar. The user can still manually flip
// the status from the lot edit modal if they really mean to. The
// `originalStatus` field is preserved on lots (still surfaced in the
// edit modal) so future migrations can use it without resurrecting the
// auto-revert.

/**
 * Apply a weight delta to a lot. Composes the three pipeline steps
 * (locate → applyDelta → autoFinish → autoReactivate).
 *
 *   negative delta: session deduction
 *   positive delta: session restore (edit reducing weight, or delete)
 *
 * Returns a new `dat` object with the updated tobacco; original is
 * never mutated.
 */
export function applyLotWeightDelta(
  dat: any,
  tobId: any,
  lotId: any,
  delta: any,
  weightUnit: string,
): any {
  var d = parseFloat(String(delta)) || 0;
  // Guard against ±Infinity / NaN slipping through. The
  // `|| 0` above catches NaN but not ±Infinity (Infinity is truthy).
  // A subsequent `(w + Infinity)` would land `weightG: "Infinity"` on
  // the lot, breaking every downstream parseFloat consumer. Discovered
  // via the property fuzz.
  if (!Number.isFinite(d)) d = 0;
  var tobs = (dat.tobaccos || []).map(function (t: any) {
    if (String(t.id) !== String(tobId)) return t;
    var idx = locateLotIdx(t, lotId, d, weightUnit);
    if (idx === -1) return t;
    var lot = (t.lots || [])[idx];
    var withWeight = stepApplyDelta(lot, d, weightUnit);
    var afterFinish = stepAutoFinish(withWeight);
    var afterReact = stepAutoReactivate(afterFinish, d);
    var newLots = (t.lots || []).slice();
    newLots[idx] = afterReact;
    return Object.assign({}, t, { lots: newLots });
  });
  return Object.assign({}, dat, { tobaccos: tobs });
}

/**
 * Re-deduct the weight of every session that just lost its
 * `deletedAt` (i.e. was restored from the Trash) from its lot.
 *
 * Context: `useSessionStore.deleteSession` does TWO things on soft-
 * delete — it stamps `deletedAt` AND it restores the session's
 * `weightG` to the lot (so the inventory matches "this session never
 * happened"). The three restore paths in App.tsx (`restoreFromTrash`,
 * `restoreSelectionFromTrash`, `restoreAllFromTrash`) all clear
 * `deletedAt` but, at one time, they did not re-deduct. Net: every
 * delete → restore cycle added `weightG` grammes gratuits to the lot.
 *
 * This helper centralises the re-deduction so each restore path
 * collects the ids of the sessions it actually un-trashed, hands them
 * in, and gets back a `data` object whose lots have been debited again
 * via `applyLotWeightDelta`. If the parent tabac is gone (permanently
 * deleted in the meantime) the delta is a no-op; if the tabac exists but
 * the specific lot doesn't (forged data), the delta is skipped rather
 * than let it misdirect onto the wrong jar via pickJarLot.
 *
 * @param data         Raw app data AFTER `deletedAt` was cleared on the
 *                     restored sessions. The function reads each
 *                     session's tobaccoId / lotId / weightG straight
 *                     from this data.
 * @param restoredIds  Set or array of session ids (anything String()
 *                     can convert) that just had `deletedAt` cleared
 *                     by the caller. Sessions still carrying
 *                     `deletedAt` are skipped defensively.
 * @param weightUnit   The display weight unit, forwarded to
 *                     `applyLotWeightDelta`.
 * @returns            A new `data` object with the deductions applied,
 *                     or the original reference if nothing changed.
 */
export function reDeductRestoredSessions(
  data: any,
  restoredIds: Set<string> | string[],
  weightUnit: string,
): any {
  if (!data || !Array.isArray(data.sessions)) return data;
  var ids: Set<string>;
  if (restoredIds instanceof Set) {
    ids = restoredIds;
  } else {
    ids = new Set((restoredIds || []).map(function (x) { return String(x); }));
  }
  if (ids.size === 0) return data;
  var nd: any = data;
  data.sessions.forEach(function (s: any) {
    if (!s || s.deletedAt) return;
    if (!ids.has(String(s.id))) return;
    if (!s.tobaccoId || !s.lotId) return;
    var w = safeW(s.weightG);
    if (w <= 0) return;
    // Only re-deduct when the referenced lot actually
    // EXISTS in its tobacco. When the whole parent tobacco is gone the delta is
    // already a no-op (the `.map` matches nothing) — but when the tobacco
    // exists and only the specific lot is missing (forged/corrupt data), an
    // unguarded delta falls through locateLotIdx → pickJarLot and MISDIRECTS
    // the −w onto a different jar lot. Parity with deleteSession / _persistSession.
    var tob = (nd.tobaccos || []).find(function (t: any) { return String(t.id) === String(s.tobaccoId); });
    var lot = tob && Array.isArray(tob.lots) && tob.lots.find(function (l: any) { return String(l.id) === String(s.lotId); });
    if (!lot) return;
    nd = applyLotWeightDelta(nd, s.tobaccoId, s.lotId, -w, weightUnit);
  });
  return nd;
}

/**
 * Produce a FRESH duplicate of an existing lot — for logging the
 * other tins of a bulk purchase from one already-entered lot. The duplicate is
 * a full, unconsumed lot: weightG is reset to weightInitial, any finished/
 * disposed end-state is cleared, and a lot that was "finished" drops back to its
 * origin status (cellar/jar). The `id` and `deletedAt` are stripped (the store
 * stamps a fresh id). `nextBox` (from utils.nextBoxNumber) sets the new box
 * number when the user numbers their boxes; otherwise the source box is kept.
 * Pure — no id/date generation here (the store's addLotToTobacco fills those).
 */
export function makeLotDuplicate(lot: any, nextBox?: string): any {
  var src = lot || {};
  var dup: any = Object.assign({}, src);
  delete dup.id;
  // A duplicate is a DISTINCT physical tin — drop the source uid so
  // the store's addLotToTobacco mints a fresh one (it does so per clone anyway;
  // this keeps makeLotDuplicate's output identity-clean).
  delete dup.uid;
  delete dup.deletedAt;
  // Fresh, full lot: reset consumption + end state.
  var wi = String((src.weightInitial != null && src.weightInitial !== "")
    ? src.weightInitial
    : (src.weightG != null ? src.weightG : ""));
  dup.weightInitial = wi;
  dup.weightG = wi;
  dup.dateFinished = "";
  dup.disposed = false;
  // A duplicate can't start "finished" — return it to its origin status.
  if (dup.status === "finished") {
    dup.status = src.originalStatus === "jar" ? "jar" : "cellar";
  }
  // A cellar (sealed) duplicate carries no opening date.
  if (dup.status === "cellar") dup.dateOpened = "";
  dup.boxNumber = (nextBox && String(nextBox)) || String(src.boxNumber || "");
  return dup;
}
