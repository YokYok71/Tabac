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
export var PIPE_MAINT_SESSIONS_THRESHOLD = 5;

export interface PipeMaintReminder {
  pipeId: string;
  pipe: any;
  sessionsSince: number;          // sessions after the last maintenance (or all, if never)
  lastMaintDate: string | null;   // ISO date of the most recent maintenance, null if never
  everMaintained: boolean;
}

/** pipeId → array of session dates (ISO), one pass over sessions. */
function sessionDatesByPipe(sessions: any[] | null | undefined): Record<string, string[]> {
  var map: Record<string, string[]> = Object.create(null);
  (sessions || []).forEach(function (s: any) {
    if (!s || s.deletedAt || !s.pipeId || typeof s.date !== "string" || !s.date) return;
    var k = String(s.pipeId);
    (map[k] || (map[k] = [])).push(s.date);
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

/** How many sessions have been smoked since the pipe's last maintenance. */
export function pipeSessionsSinceMaint(
  pipe: any,
  sessions: any[] | null | undefined,
  todayStr?: string,
): { sessionsSince: number; lastMaintDate: string | null; everMaintained: boolean } {
  var lm = lastMaintDate(pipe, todayStr);
  var dates = (sessionDatesByPipe(sessions)[String(pipe?.id)]) || [];
  var since = lm ? dates.filter(function (d) { return d > (lm as string); }).length : dates.length;
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
  var byPipe = sessionDatesByPipe(sessions);
  var out: PipeMaintReminder[] = [];
  (pipes || []).forEach(function (p: any) {
    if (!p || p.deletedAt || p.status === "finished") return;
    var lm = lastMaintDate(p, todayStr);
    var dates = byPipe[String(p.id)] || [];
    var since = lm ? dates.filter(function (d) { return d > (lm as string); }).length : dates.length;
    if (since >= threshold) {
      out.push({ pipeId: String(p.id), pipe: p, sessionsSince: since, lastMaintDate: lm, everMaintained: !!lm });
    }
  });
  out.sort(function (a, b) {
    return b.sessionsSince - a.sessionsSince || String(a.pipeId).localeCompare(String(b.pipeId));
  });
  return topN > 0 ? out.slice(0, topN) : out;
}
