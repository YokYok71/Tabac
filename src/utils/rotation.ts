// rotation.ts — pure pipe-rest helpers.
//
// A briar pipe needs to dry between smokes; the rule of thumb most
// smokers follow is "let it rest a day or two". The app already knows
// every session's date + pipeId, so the rest time is derivable — no
// new data entry, no new fields. These helpers are pure (no React, no
// Date.now() closure — `now` is always an explicit argument with a
// default) so they can be property-tested and reused by the
// suggestion engine.
//
// Conventions:
// - Session dates are ISO "YYYY-MM-DD" strings (the storage format of
//   every <input type="date">). Malformed dates are skipped.
// - A pipe with NO recorded session returns null ("never smoked") —
//   callers decide whether that means "infinitely rested" (suggestion
//   engine) or "nothing to show" (list chip).
// - Day diff is calendar-flavoured: floor((now - date) / 86400000),
//   clamped ≥ 0 so a session dated in the future (clock skew, typo)
//   can't produce a negative rest.

export var PIPE_REST_TARGET_DAYS = 2;

import { parseLocalDate } from "../utils.ts";

const DAY_MS = 86400000;

/** Map pipeId (string) → most recent session date (ISO string). */
export function lastSessionDateByPipe(
  sessions: any[] | null | undefined,
): Record<string, string> {
  // Object.create(null): pipeId comes from user-controlled data — a
  // key like "toString" must not collide with Object.prototype (same
  // defense as the stats aggregators, see src/utils/stats.ts).
  var map: Record<string, string> = Object.create(null);
  (sessions || []).forEach(function (s: any) {
    if (!s || !s.pipeId || typeof s.date !== "string" || !s.date) return;
    if (isNaN(new Date(s.date).getTime())) return;
    var k = String(s.pipeId);
    var prev = map[k];
    if (!prev || s.date > prev) map[k] = s.date;
  });
  return map;
}

/**
 * Days since the pipe was last smoked. null = never smoked (or the
 * only recorded dates are unparseable).
 */
export function pipeRestDays(
  pipeId: string | number,
  sessions: any[] | null | undefined,
  now: number = Date.now(),
): number | null {
  var map = lastSessionDateByPipe(sessions);
  var last = map[String(pipeId)];
  if (!last) return null;
  // LOCAL-anchored parse — a bare "YYYY-MM-DD" is UTC-midnight via
  // `new Date`, and diffing that against a local `now` gave a TZ off-by-one.
  var t = parseLocalDate(last);
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/**
 * Rest map for a whole collection in one pass — pipeId → rest days
 * (null when never smoked). Cheaper than calling pipeRestDays per
 * pipe (one scan of sessions instead of N).
 */
export function computePipeRest(
  pipes: any[] | null | undefined,
  sessions: any[] | null | undefined,
  now: number = Date.now(),
): Record<string, number | null> {
  var lastMap = lastSessionDateByPipe(sessions);
  var out: Record<string, number | null> = Object.create(null);
  (pipes || []).forEach(function (p: any) {
    if (!p || p.id === undefined || p.id === null) return;
    var k = String(p.id);
    var last = lastMap[k];
    if (!last) { out[k] = null; return; }
    var t = parseLocalDate(last); // LOCAL-anchored (see pipeRestDays)
    out[k] = isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY_MS));
  });
  return out;
}

/** true when the pipe has rested at least PIPE_REST_TARGET_DAYS. */
export function isPipeRested(restDays: number | null): boolean {
  return restDays === null || restDays >= PIPE_REST_TARGET_DAYS;
}

// ── Sub-day rest check ──────────────────────────────────────────────────
// The day-level helpers above drive the list chip / suggestion engine. The
// session form needs finer resolution: warn when the picked pipe was smoked
// LESS THAN 24 h before this session so the briar hasn't had time to dry.
// Sessions carry an optional "HH:MM" `time`; when absent we assume noon so a
// same-day session isn't pinned to midnight.

export var PIPE_REST_MIN_HOURS = 24;
const HOUR_MS = 3600000;

function _isHHMM(t: any): boolean {
  return typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
}

/** Local ms timestamp of a session's start = date + optional HH:MM (noon
 *  fallback). NaN when the date is missing / unparseable. */
export function sessionStartMs(s: any): number {
  if (!s || typeof s.date !== "string" || !s.date) return NaN;
  return new Date(s.date + "T" + (_isHHMM(s.time) ? s.time : "12:00") + ":00").getTime();
}

/** Hours since the pipe's most recent session STRICTLY before `refMs`
 *  (optionally excluding the session being edited). null when the pipe has no
 *  earlier session. Skips trashed sessions + unparseable dates. */
export function pipeHoursSinceLastSession(
  pipeId: string | number,
  sessions: any[] | null | undefined,
  refMs: number = Date.now(),
  excludeSessionId?: any,
): number | null {
  var pid = String(pipeId);
  var latest = NaN;
  (sessions || []).forEach(function (s: any) {
    if (!s || s.deletedAt || String(s.pipeId) !== pid) return;
    if (excludeSessionId !== undefined && String(s.id) === String(excludeSessionId)) return;
    var ms = sessionStartMs(s);
    if (isNaN(ms) || ms >= refMs) return; // only sessions before the reference
    if (isNaN(latest) || ms > latest) latest = ms;
  });
  if (isNaN(latest)) return null;
  return Math.max(0, (refMs - latest) / HOUR_MS);
}
