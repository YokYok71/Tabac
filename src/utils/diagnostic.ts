/**
 * Persisted diagnostic counter for invariant violations.
 *
 * Records each violation surfaced by assertLotInvariants. Exposes a
 * "last 20 violations" trail so the user / a debugger can see the
 * shape of any drift without needing to repro it live. Stored in
 * localStorage under `cave-diagnostic-v1`, capped at 20 recent
 * entries so the key never grows unboundedly.
 */

import type { InvariantViolation } from "./lotInvariants.ts";
import { lsSet, lsRemove } from "./appStorage.ts";

export var DIAGNOSTIC_KEY = "cave-diagnostic-v1";
export var DIAGNOSTIC_MAX_RECENT = 20;

export interface DiagnosticEntry {
  ts: string;
  scope: string;
  rule: string;
  detail: string;
  ref?: string;
}

export interface DiagnosticSnapshot {
  count: number;
  firstSeen: string;
  lastSeen: string;
  recent: DiagnosticEntry[];
}

function read(): DiagnosticSnapshot {
  try {
    var raw = localStorage.getItem(DIAGNOSTIC_KEY);
    if (!raw) return emptySnapshot();
    var p = JSON.parse(raw);
    if (!p || typeof p !== "object") return emptySnapshot();
    return {
      count: Number(p.count) || 0,
      firstSeen: typeof p.firstSeen === "string" ? p.firstSeen : "",
      lastSeen: typeof p.lastSeen === "string" ? p.lastSeen : "",
      recent: Array.isArray(p.recent) ? p.recent : [],
    };
  } catch (_e) {
    return emptySnapshot();
  }
}

function write(s: DiagnosticSnapshot) {
  try {
    lsSet(DIAGNOSTIC_KEY, JSON.stringify(s));
  } catch (_e) {
    // Best-effort. Quota errors are not fatal.
  }
}

function emptySnapshot(): DiagnosticSnapshot {
  return { count: 0, firstSeen: "", lastSeen: "", recent: [] };
}

function refOf(v: InvariantViolation): string {
  if (v.scope === "lot") {
    return "tob#" + (v.tobId !== undefined ? v.tobId : "?")
      + " lot#" + (v.lotId !== undefined ? v.lotId : "?");
  }
  if (v.scope === "session") return "session#" + (v.sessionId !== undefined ? v.sessionId : "?");
  if (v.scope === "pipe") return "pipe#" + (v.pipeId !== undefined ? v.pipeId : "?");
  if (v.scope === "accessory") return "accessory#" + (v.accessoryId !== undefined ? v.accessoryId : "?");
  // The two new top-level uniqueness scopes.
  if (v.scope === "tobacco") return "tob#" + (v.tobId !== undefined ? v.tobId : "?");
  if (v.scope === "wishlist") return "wish#" + (v.wishId !== undefined ? v.wishId : "?");
  // Pipe-maintenance scope (was falling through to "?").
  if (v.scope === "maintenance") {
    return "pipe#" + (v.pipeId !== undefined ? v.pipeId : "?")
      + " maint#" + (v.maintId !== undefined ? v.maintId : "?");
  }
  return "?";
}

/** Append one or more violations to the counter. Non-blocking. */
export function recordViolations(violations: InvariantViolation[]): void {
  if (!violations || violations.length === 0) return;
  var s = read();
  var now = new Date().toISOString();
  s.count += violations.length;
  if (!s.firstSeen) s.firstSeen = now;
  s.lastSeen = now;
  var entries: DiagnosticEntry[] = violations.map(function (v) {
    return {
      ts: now,
      scope: v.scope,
      rule: v.rule,
      detail: v.detail,
      ref: refOf(v),
    };
  });
  s.recent = entries.concat(s.recent).slice(0, DIAGNOSTIC_MAX_RECENT);
  write(s);
}

export function getDiagnosticSnapshot(): DiagnosticSnapshot {
  return read();
}

export function clearDiagnostic(): void {
  try {
    lsRemove(DIAGNOSTIC_KEY);
  } catch (_e) {}
}
