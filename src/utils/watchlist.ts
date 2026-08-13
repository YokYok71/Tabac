// watchlist.ts — passive reminders for the Home "À surveiller"
// section. No notifications, no backend: the app
// simply derives, at render time, the list of tobaccos that deserve
// the user's attention — from data that's already there.
//
// Signals, by severity:
//   1. overaged      — a lot is past its recommended cellar age.
//                      Flags EVERY tobacco, including "à ne pas
//                      reprendre" (rebuy === false): the goal there is
//                      to finish them off before they're too old.
//   2. approaching   — a lot is inside its peak window (same scope).
//   3. low_stock     — a tobacco is nearly out of stock, so it's worth
//                      rebuying before it disappears from catalogues.
//                      Flags every tobacco EXCEPT "à ne pas reprendre"
//                      (no point warning to restock what you won't rebuy).
//
// (The "stale_jar" signal — a jar open for many months — was
// removed; it was noise more than signal, so the Home alert and its
// configurable threshold are gone.)
//
// One entry per tobacco (its most severe signal) so the list reads as
// a checklist, not a wall of duplicates. Pure module — `now` always
// an explicit argument with a default; tested in watchlist.test.ts.

import { lotAgingStatus, effectiveAgingMax } from "../utils.ts";
import { safeNonNeg } from "./stats.ts";

export type WatchKind = "overaged" | "approaching" | "low_stock";

export interface WatchItem {
  kind: WatchKind;
  tobaccoId: string;
  /** low_stock → remaining active weight (user's display unit);
   *  overaged / approaching → 0 (the badge label carries the info). */
  value: number;
}

export interface WatchOptions {
  now?: number;
  /** "Low stock" threshold in the user's display unit
   *  (50 for grams, ~1.8 for oz). Default 50. */
  lowWeightThreshold?: number;
  /** Cap on the returned list. Default 5. */
  max?: number;
}

const SEVERITY: Record<WatchKind, number> = {
  overaged: 0, approaching: 1, low_stock: 2,
};

export function computeWatchlist(
  tobaccos: any[] | null | undefined,
  opts?: WatchOptions,
): WatchItem[] {
  var lowThreshold = (opts && opts.lowWeightThreshold) || 50;
  var max = (opts && opts.max) || 5;

  var out: WatchItem[] = [];
  (tobaccos || []).forEach(function (t: any) {
    if (!t || t.id === undefined || t.id === null) return;
    var lots = ((t.lots || []) as any[]).filter(function (l: any) {
      // Skip soft-deleted lots for parity with the other lot
      // engines (cellarInsights / shopping / cost-per-session). Callers pass
      // liveData today, but the contract should be uniform.
      return l && !l.deletedAt && l.status !== "finished";
    });
    if (lots.length === 0) return;

    var best: WatchItem | null = null;
    function offer(kind: WatchKind, value: number) {
      if (!best || SEVERITY[kind] < SEVERITY[best.kind]) {
        best = { kind: kind, tobaccoId: String(t.id), value: value };
      }
    }

    // 1+2 — aging urgency.
    var hasOveraged = false, hasApproaching = false;
    lots.forEach(function (l: any) {
      var st = lotAgingStatus(l, effectiveAgingMax(t));
      if (st === "overaged") hasOveraged = true;
      else if (st === "approaching") hasApproaching = true;
    });
    if (hasOveraged) offer("overaged", 0);
    else if (hasApproaching) offer("approaching", 0);

    // 3 — running low on stock (any tobacco except "don't rebuy").
    if (t.rebuy !== false) {
      var totalActive = lots.reduce(function (sum: number, l: any) {
        return sum + safeNonNeg(l.weightG);
      }, 0);
      if (totalActive > 0 && totalActive <= lowThreshold) {
        offer("low_stock", Math.round(totalActive * 10) / 10);
      }
    }

    if (best) out.push(best);
  });

  out.sort(function (a, b) {
    return SEVERITY[a.kind] - SEVERITY[b.kind]
      || String(a.tobaccoId).localeCompare(String(b.tobaccoId));
  });
  return out.slice(0, Math.max(0, max));
}
