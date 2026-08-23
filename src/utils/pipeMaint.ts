// pipeMaint.ts — pure "maintenance reminder" helpers.
//
// A pipe accumulates cake / moisture as it's smoked; the meaningful trigger
// for "time to clean it" is USAGE, not the calendar (a pipe unsmoked for
// months needs nothing). The app already knows every session's pipeId + date
// and every pipe's maintenance log, so "how many times have I
// smoked this pipe since I last cleaned it" is derivable — no new stored
// field. These helpers are pure (no React, no Date.now() closure) so they're
// property-testable and reusable by the Home section + the card / fiche chips.
//
// Conventions mirror rotation.ts: ISO "YYYY-MM-DD" dates, Object.create(null)
// maps (pipeId is user-controlled), malformed dates skipped, finished /
// trashed pipes ignored.

// Sessions smoked since the last maintenance beyond which the pipe is flagged
// "à entretenir". Default 5 sessions since the last cleaning (user-adjustable
// in Settings → Préférences).
import { sessionStartMs } from "./rotation.ts";

export var PIPE_MAINT_SESSIONS_THRESHOLD = 5;

export interface PipeMaintReminder {
  pipeId: string;
  pipe: any;
  sessionsSince: number;          // sessions after the last maintenance (or all, if never)
  lastMaintDate: string | null;   // ISO date of the most recent maintenance, null if never
  everMaintained: boolean;
}

/** pipeId → array of session MOMENTS (ms), one pass over sessions.
 *
 *  It carried DATE STRINGS and compared them with `>`, which cannot order a
 *  session against a cleaning that happened the SAME DAY — so a pipe cleaned
 *  and smoked again within the day counted zero sessions since its cleaning
 *  and dropped out of the reminders. Reported from the app at a threshold of
 *  1, where it is the whole feature. `sessionStartMs` is the helper the rest
 *  of the app already uses for this (date + optional HH:MM, NOON when the time
 *  is missing); reusing it is what makes the two sides of the comparison agree
 *  on what an absent time means. Unparseable dates are dropped exactly as
 *  before. */
function sessionMomentsByPipe(sessions: any[] | null | undefined): Record<string, number[]> {
  var map: Record<string, number[]> = Object.create(null);
  (sessions || []).forEach(function (s: any) {
    if (!s || s.deletedAt || !s.pipeId || typeof s.date !== "string" || !s.date) return;
    var ms = sessionStartMs(s);
    if (isNaN(ms)) return;
    var k = String(s.pipeId);
    (map[k] || (map[k] = [])).push(ms);
  });
  return map;
}

/** An entry resets the reminder only when it's a light/full CLEANING.
 *  A "none" entry (repair, waxing…) is an additional task that does NOT count. */
export function isCleaningMaint(m: any): boolean {
  return !!m && (m.kind === "light" || m.kind === "full");
}

/** ISO date of the pipe's most recent CLEANING entry (light/full), or null.
 *  "none" entries are skipped so they never reset the reminder counter.
 *  When `todayStr` is given, a FUTURE-dated cleaning (`m.date >
 *  todayStr`, e.g. a fat-fingered "2030-…") is ignored — otherwise it would
 *  park `lastMaintDate` past every real session and suppress the reminder
 *  forever. Omitting `todayStr` keeps the old unfiltered behaviour (pure,
 *  property-testable — production callers pass today()). */
export function lastMaintDate(pipe: any, todayStr?: string): string | null {
  var last: string | null = null;
  ((pipe && pipe.maintenance) || []).forEach(function (m: any) {
    if (
      isCleaningMaint(m) &&
      typeof m.date === "string" &&
      m.date &&
      (!todayStr || m.date <= todayStr) &&
      (last === null || m.date > last)
    ) last = m.date;
  });
  return last;
}

/** The MOMENT (ms) of the pipe's most recent CLEANING, or NaN when never
 *  cleaned. The date half is `lastMaintDate` — unchanged, and still what the
 *  fiche displays; this adds the time, so a session can be ordered against a
 *  cleaning that happened the same day.
 *
 *  A cleaning with no `time` reads as NOON, the same fallback
 *  `sessionStartMs` applies to an untimed session. That is the load-bearing
 *  choice for LEGACY entries, which have no time at all: it splits the day
 *  instead of swallowing it, so a bowl smoked in the evening counts against a
 *  cleaning logged that morning while one smoked at dawn does not. The two
 *  older alternatives are both a whole-day error in one direction — end of
 *  day is the defect this replaces, start of day is that defect mirrored. */
export function lastMaintMoment(pipe: any, todayStr?: string): number {
  var d = lastMaintDate(pipe, todayStr);
  if (!d) return NaN;
  // The entry that CARRIES that date — the latest one, so two cleanings on the
  // same day resolve to the later time rather than to whichever came first.
  var best = NaN;
  ((pipe && pipe.maintenance) || []).forEach(function (m: any) {
    if (!isCleaningMaint(m) || m.date !== d) return;
    var ms = sessionStartMs(m);
    if (isNaN(ms)) return;
    if (isNaN(best) || ms > best) best = ms;
  });
  return best;
}

/** How many sessions have been smoked since the pipe's last maintenance.
 *
 *  `momentsByPipe` is an OPTIONAL precomputed index — the one
 *  `computePipeMaintenanceReminders` builds once for the whole collection.
 *  Without it this function walks every session, which is correct for a single
 *  pipe and quadratic inside a loop: delegating the count to it (right, one
 *  implementation) dropped the map that the loop used to hoist, taking 30
 *  pipes × 5000 sessions from 0.4 ms to 63 ms — recomputed on every data write,
 *  and on views the user is not even looking at, since `CuratorApp` mounts them
 *  all and both memos evaluate above their `return null`. The parameter keeps
 *  the single implementation AND the hoist. */
export function pipeSessionsSinceMaint(
  pipe: any,
  sessions: any[] | null | undefined,
  todayStr?: string,
  momentsByPipe?: Record<string, number[]>,
): { sessionsSince: number; lastMaintDate: string | null; everMaintained: boolean } {
  var lm = lastMaintDate(pipe, todayStr);
  var lmMs = lastMaintMoment(pipe, todayStr);
  var idx = momentsByPipe || sessionMomentsByPipe(sessions);
  var moments = idx[String(pipe?.id)] || [];
  // STRICTLY after the cleaning, on the same MOMENT scale. A cleaning whose
  // own date is unparseable yields NaN here; every comparison against NaN is
  // false, which would silently count nothing — so that case falls back to
  // "never cleaned" rather than to "nothing counts".
  var since = lm && !isNaN(lmMs)
    ? moments.filter(function (ms) { return ms > lmMs; }).length
    : moments.length;
  return { sessionsSince: since, lastMaintDate: lm, everMaintained: !!lm };
}

/** true when an ACTIVE pipe has been smoked ≥ threshold times since its last
 *  maintenance (or ever, if never maintained). */
export function isPipeMaintenanceDue(
  pipe: any,
  sessions: any[] | null | undefined,
  threshold: number = PIPE_MAINT_SESSIONS_THRESHOLD,
  todayStr?: string,
): boolean {
  if (!pipe || pipe.deletedAt || pipe.status === "finished") return false;
  return pipeSessionsSinceMaint(pipe, sessions, todayStr).sessionsSince >= threshold;
}

/** Active pipes due for maintenance, most-overdue first, capped at topN. */
export function computePipeMaintenanceReminders(
  pipes: any[] | null | undefined,
  sessions: any[] | null | undefined,
  threshold: number = PIPE_MAINT_SESSIONS_THRESHOLD,
  topN: number = 5,
  todayStr?: string,
): PipeMaintReminder[] {
  var out: PipeMaintReminder[] = [];
  // HOISTED — one pass over the sessions for the whole collection, not one per
  // pipe. See `pipeSessionsSinceMaint` for what dropping this cost.
  var momentsByPipe = sessionMomentsByPipe(sessions);
  (pipes || []).forEach(function (p: any) {
    if (!p || p.deletedAt || p.status === "finished") return;
    // DELEGATED, where this function used to carry its own copy of the count.
    // Two implementations of one rule is what this repo keeps paying for, and
    // it was live here: the Home section and the pipe-card chips read the same
    // number through two different code paths, free to drift the day either
    // was touched. They cannot now.
    var r = pipeSessionsSinceMaint(p, sessions, todayStr, momentsByPipe);
    if (r.sessionsSince >= threshold) {
      out.push({
        pipeId: String(p.id), pipe: p, sessionsSince: r.sessionsSince,
        lastMaintDate: r.lastMaintDate, everMaintained: r.everMaintained,
      });
    }
  });
  // Most overdue first — and the TIEBREAK is the part that had to change.
  //
  // It was the pipe id compared as TEXT, which is deterministic (so the list
  // never flickers between launches) and completely arbitrary to the reader:
  // `"11" < "3"`, so it systematically favours pipes whose id begins with a
  // low digit. Measured on twenty equally-overdue pipes it produced
  // 11 · 15 · 19 · 03 · 07 — an order with no meaning at all.
  //
  // And a tie is not the rare case, it is the NORMAL one: at the default
  // threshold most overdue pipes sit on the same small session count, and at a
  // threshold of 1 nearly all of them do. So the id was deciding which five
  // the Home showed, i.e. the real criterion decided nothing.
  //
  // The last cleaning DATE does mean something: among pipes smoked the same
  // number of times since their last cleaning, the one cleaned longest ago is
  // genuinely the most due, and a pipe never cleaned at all comes first.
  // The id stays as the final rung so the order is still total and stable.
  //
  // DATE, not `lastMaintMoment`: the reminder already carries the date (it is
  // what the fiche shows), and two cleanings within one day is not a
  // difference worth ordering a chore list by.
  out.sort(function (a, b) {
    if (b.sessionsSince !== a.sessionsSince) return b.sessionsSince - a.sessionsSince;
    if (!a.lastMaintDate !== !b.lastMaintDate) return a.lastMaintDate ? 1 : -1;
    if (a.lastMaintDate && b.lastMaintDate && a.lastMaintDate !== b.lastMaintDate) {
      return a.lastMaintDate < b.lastMaintDate ? -1 : 1;
    }
    return String(a.pipeId).localeCompare(String(b.pipeId));
  });
  return topN > 0 ? out.slice(0, topN) : out;
}
