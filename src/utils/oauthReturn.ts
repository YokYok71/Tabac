/**
 * OAuth-return processing extracted from the App.tsx
 * IIFE for testability.
 *
 * Reads `window.location.hash` / `window.location.search` and
 * `localStorage`, dispatches the in-flight action by setting the
 * matching `window.__PENDING_GDRIVE_*` globals, clears the OAuth
 * housekeeping keys, and records a diagnostic event.
 *
 * The function is pure with respect to its arguments: it takes the
 * window object (so tests can swap a stub) and reads/writes the
 * standard DOM globals on that window. All side effects (window
 * globals + localStorage + history) happen on the passed-in object.
 *
 * Action whitelist must stay in lock-step with the validator in
 * useGdriveSync. See the OAuth security invariant in CLAUDE.md
 * ("OAuth action whitelist").
 */

import { recordOAuthEvent } from "./oauthDiag.ts";

// "restore-cnb" added — banner-driven cloud-newer
// restore on iOS standalone. The pre-existing "restore" action opens
// the full picker; this one resumes the direct restore-by-id flow
// using the file id persisted in localStorage["cave-cloud-newer-pending-id"].
// "cat-save" / "cat-restore" added — the CATALOGUE's own cloud stream. They
// borrowed "save" and "list", and on iOS standalone (where a missing token
// means a redirect) that made the two buttons resume as a DIFFERENT
// OPERATION: "save" runs a full cellar backup under a "✓ OK" the user reads
// as their catalogue being safe, and "list" lands on the backups panel with
// the catalogue never fetched.
//
// A DISTINCT ACTION rather than a fifth one-shot marker. The markers exist
// because three buttons share the "list my cloud files" operation and differ
// only in what they do with the result; a catalogue save is not a cellar save
// with a flag on it. Overloading an action and disambiguating it out-of-band
// is what produced this defect three times over.
var OAUTH_ACTIONS = ["save", "restore", "reconnect", "list", "autosave", "restore-cnb", "cat-save", "cat-restore"];

function isValidAction(s: string | null): boolean {
  return !!s && OAUTH_ACTIONS.indexOf(s) >= 0;
}

export function processOAuthReturn(w: Window = window): void {
  // Nothing in the current code SETS gdrive-pkce-verifier
  // or gdrive-pkce-redirect (the PKCE-code redirect attempt was retired
  // because Google Web Application clients require a
  // client_secret to exchange the code). The branch below is kept for:
  //   (1) defensive cleanup of stale keys from installs that predate that;
  //   (2) the test fixture (processOAuthReturn.test.ts) that locks
  //       the contract; and (3) future-proofing if Google ever changes
  //       its policy. In production it short-circuits on `if (!verifier)`.
  //
  // PKCE authorization code flow (response_type=code): code arrives
  // in the query string. The secure flow recommended by Google for
  // SPAs, used historically by an older non-iOS attempt.
  var search = w.location.search;
  if (search && search.length > 1) {
    var qp = new URLSearchParams(String(search).substring(1));
    var code = qp.get("code");
    if (code) {
      var stQ = qp.get("state");
      var expectedStQ = w.localStorage.getItem("gdrive-state");
      w.localStorage.removeItem("gdrive-state");
      var verifier = w.localStorage.getItem("gdrive-pkce-verifier");
      w.localStorage.removeItem("gdrive-pkce-verifier");
      var redirect = w.localStorage.getItem("gdrive-pkce-redirect");
      w.localStorage.removeItem("gdrive-pkce-redirect");
      if (!stQ || !expectedStQ || stQ !== expectedStQ) return;
      if (!verifier) return;
      w.history.replaceState({}, "", w.location.pathname);
      var paQ = w.localStorage.getItem("gdrive-pending");
      w.localStorage.removeItem("gdrive-pending");
      w.localStorage.removeItem("gdrive-pending-ts");
      if (isValidAction(paQ)) {
        (w as any).__PENDING_GDRIVE_CODE__ = code;
        (w as any).__PENDING_GDRIVE_VERIFIER__ = verifier;
        (w as any).__PENDING_GDRIVE_REDIRECT__ = redirect;
        (w as any).__PENDING_GDRIVE_ACTION__ = paQ;
      }
      return;
    }
  }
  // Token grant redirect: used for iOS standalone (response_type=token
  // implicit grant) and for in-flight redirects from prior app versions.
  if (!w.location.hash) return;
  var hp = new URLSearchParams(String(w.location.hash).substring(1));
  var tk = hp.get("access_token");
  // INVARIANT: capture `pending` BEFORE any cleanup.
  // An early-cleanup added further down was racing the success-
  // path read. Hoisting the read above any removeItem call keeps the
  // action dispatcher honest. See processOAuthReturn.test.ts for the
  // regression that locked this in.
  var pending = w.localStorage.getItem("gdrive-pending");
  // Clear `gdrive-pending` early on every OAuth return —
  // token success OR error reply. Originally the pending key was
  // only cleared on the happy path (after the state check), which meant
  // a failed silent return (#error=… or no useful hash) left
  // gdrive-pending set forever, blocking every subsequent triggerIos-
  // AutosaveReauth attempt.
  if (tk || hp.has("error")) {
    try {
      w.localStorage.removeItem("gdrive-pending");
      w.localStorage.removeItem("gdrive-pending-ts");
    } catch (_e) {}
  }
  if (!tk) {
    var errCode = hp.get("error");
    if (errCode) {
      recordOAuthEvent("return-error", pending || undefined, errCode);
    } else {
      recordOAuthEvent("return-no-token", pending || undefined);
    }
    return;
  }
  var st = hp.get("state");
  var expectedSt = w.localStorage.getItem("gdrive-state");
  w.localStorage.removeItem("gdrive-state");
  w.localStorage.removeItem("gdrive-pkce-verifier");
  w.localStorage.removeItem("gdrive-pkce-redirect");
  if (!st || !expectedSt || st !== expectedSt) {
    recordOAuthEvent("state-mismatch", pending || undefined,
      "st=" + (st ? "set" : "null") + " expected=" + (expectedSt ? "set" : "null"));
    return;
  }
  w.history.replaceState({}, "", w.location.pathname);
  // `pending` was captured at the top; re-use it so the action
  // dispatcher sees what was set by gdriveGetToken at redirect-time.
  var pa = pending;
  recordOAuthEvent("return-success", pa || undefined);
  if (isValidAction(pa)) {
    (w as any).__PENDING_GDRIVE_TOKEN__ = tk;
    (w as any).__PENDING_GDRIVE_ACTION__ = pa;
  }
}
