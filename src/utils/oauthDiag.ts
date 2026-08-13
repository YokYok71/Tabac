/**
 * Small, single-slot OAuth diagnostic recorder.
 *
 * Records the most recent OAuth touchpoint so the user (and us) can
 * see what's happening when Drive auth fails to take effect. The
 * Settings → Drive section renders the latest entry as a small
 * italic line under the expired-session Notice.
 *
 * Recorded events:
 *   - "redirect-start"  : window.location.replace just fired
 *   - "return-success"  : OAuth return hash had access_token
 *   - "return-no-token" : OAuth return hash, NO access_token
 *   - "return-error"    : OAuth return hash had error=...
 *   - "state-mismatch"  : token returned but state failed validation
 *   - "token-stored"    : token persisted via tkSet successfully
 *
 * The action context ("autosave" | "reconnect" | etc.) is included
 * where relevant so the user can tell silent-piggyback failures from
 * explicit Reconnect failures.
 *
 * Storage: localStorage["cave-oauth-diag"] = JSON. Single slot, no
 * history. The previous value is overwritten on every record() call.
 */

import { lsSet, lsRemove } from "./appStorage.ts";

export var OAUTH_DIAG_KEY = "cave-oauth-diag";

export interface OAuthDiagEntry {
  ts: number;
  type: string;
  action?: string;
  detail?: string;
}

export function recordOAuthEvent(
  type: OAuthDiagEntry["type"],
  action?: string,
  detail?: string,
): void {
  try {
    var entry: OAuthDiagEntry = { ts: Date.now(), type: type };
    if (action) entry.action = action;
    if (detail) entry.detail = detail;
    lsSet(OAUTH_DIAG_KEY, JSON.stringify(entry));
  } catch (_e) {}
}

export function readOAuthEvent(): OAuthDiagEntry | null {
  try {
    var raw = localStorage.getItem(OAUTH_DIAG_KEY);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (!p || typeof p !== "object" || typeof p.ts !== "number" || typeof p.type !== "string") {
      return null;
    }
    return p as OAuthDiagEntry;
  } catch (_e) {
    return null;
  }
}

export function clearOAuthEvent(): void {
  try {
    lsRemove(OAUTH_DIAG_KEY);
  } catch (_e) {}
}
