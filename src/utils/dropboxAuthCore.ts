// dropboxAuthCore.ts — pure, React-free Dropbox OAuth helpers
// (step 3b foundation).
//
// Dropbox supports PKCE properly for browser apps (unlike Google's Web
// Application clients, which demand a client_secret for the code
// exchange — the reason the Drive iOS flow is stuck on the implicit
// grant). With `token_access_type=offline` the exchange also returns a
// REFRESH TOKEN usable client-side, which kills the whole class of
// "session expired after 1h" problems the Drive layer needs banners,
// piggybacks and reconnect buttons for.
//
// ⚠️ SECURITY — mirrors the Google-side invariants (CLAUDE.md §20):
//   - CSRF state check is FAIL-CLOSED: `!st || !expected || st !== expected`.
//   - The pending action is validated against DROPBOX_OAUTH_ACTIONS
//     before dispatch (same whitelist values as gdrive-pending).
//   - dropbox-pending is READ BEFORE any removeItem of the same key
//     (the read-before-clear rule; the
//     tabac-local/no-storage-read-after-remove ESLint rule statically
//     guards every literal localStorage key, this one included).

import { DROPBOX_APP_KEY } from "../constants.ts";

export var DROPBOX_OAUTH_ACTIONS = [
  "save",
  "restore",
  "reconnect",
  "list",
  "autosave",
  // Banner-driven cloud-newer restore (one-tap on iOS).
  // See useGdriveSync.restoreCloudNewerBackup + the Drive twin in
  // src/utils/oauthReturn.ts.
  "restore-cnb",
  // The CATALOGUE's own cloud stream. They borrowed "save" and "list", which
  // on a redirect made each button resume as a different operation entirely.
  // See the note on OAUTH_ACTIONS in src/utils/oauthReturn.ts for why this is
  // a distinct action rather than a fifth one-shot marker.
  "cat-save",
  "cat-restore",
] as const;

export function isValidDropboxAction(ac: any): boolean {
  return typeof ac === "string" && (DROPBOX_OAUTH_ACTIONS as readonly string[]).indexOf(ac) >= 0;
}

// RFC 7636 S256: challenge = base64url(SHA-256(verifier)). Async — uses
// WebCrypto. (The SHA-256 challenge helper once removed as dead code
// returns for real this time: Dropbox actually consumes it.)
export function pkceChallengeS256(verifier: string): Promise<string> {
  var bytes = new TextEncoder().encode(verifier);
  return crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
    var arr = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i] || 0);
    return String(btoa(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  });
}

// LABEL-CONTRACT:start dropbox-oauth-scope — see scripts/label-contracts.json
export function buildDropboxAuthUrl(opts: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
// LABEL-CONTRACT:end dropbox-oauth-scope
  return (
    "https://www.dropbox.com/oauth2/authorize" +
    "?client_id=" + encodeURIComponent(DROPBOX_APP_KEY) +
    "&response_type=code" +
    "&redirect_uri=" + encodeURIComponent(opts.redirectUri) +
    "&state=" + encodeURIComponent(opts.state) +
    "&code_challenge=" + encodeURIComponent(opts.challenge) +
    "&code_challenge_method=S256" +
    // offline → the exchange returns a refresh token, so the app can
    // renew access tokens silently forever (no re-auth banners).
    "&token_access_type=offline"
  );
}

export interface DropboxReturn {
  code: string;
  action: string;
  verifier: string;
}

// Processes a Dropbox OAuth return. `search` is window.location.search
// ("?code=…&state=…"); `w` is injectable for tests (defaults to the
// real window.localStorage).
//
// Returns null when: no code present (not a Dropbox return), state
// check fails (fail-closed), the pending action isn't whitelisted, or
// the verifier is missing. On EVERY processed return (success or
// failure) the one-shot keys are cleared — but only AFTER the reads
// (read-before-clear).
export function processDropboxReturn(
  search: string,
  w: { localStorage: Storage } = window,
): DropboxReturn | null {
  var params: URLSearchParams;
  try { params = new URLSearchParams(search || ""); } catch (_e) { return null; }
  var code = params.get("code");
  var st = params.get("state");
  if (!code) return null; // not an OAuth return — leave storage alone

  // READ everything BEFORE clearing anything (standing invariant).
  var expectedSt: string | null, action: string | null, verifier: string | null;
  try {
    expectedSt = w.localStorage.getItem("dropbox-state");
    action = w.localStorage.getItem("dropbox-pending");
    verifier = w.localStorage.getItem("dropbox-verifier");
  } catch (_e) { return null; }

  // One-shot cleanup — a return is consumed exactly once, valid or not.
  try {
    w.localStorage.removeItem("dropbox-state");
    w.localStorage.removeItem("dropbox-pending");
    w.localStorage.removeItem("dropbox-pending-ts");
    w.localStorage.removeItem("dropbox-verifier");
  } catch (_e) {}

  // FAIL-CLOSED CSRF check — same shape as the Google side. Never
  // weaken to &&.
  if (!st || !expectedSt || st !== expectedSt) return null;
  if (!isValidDropboxAction(action)) return null;
  if (!verifier) return null;

  return { code: code, action: action as string, verifier: verifier };
}
