// useDropboxAuth.ts — Dropbox OAuth + token lifecycle.
//
// Token model (the part that makes Dropbox NICER than Drive here):
//   - dropbox-rt  (localStorage): long-lived refresh token from the
//     PKCE exchange with token_access_type=offline.
//   - dropbox-tk  (localStorage): short-lived access token cache
//     {t, x} — same envelope shape as gdrive-tk.
//   - getToken(): cached → silent refresh-grant (plain fetch, works on
//     EVERY platform incl. iOS standalone) → interactive redirect.
//     The interactive leg should be needed exactly once per device.

import React from "react";
import { DROPBOX_APP_KEY } from "../constants.ts";
import { recordOAuthEvent } from "../utils/oauthDiag.ts";
import { fetchWithTimeout } from "../utils/gdriveApi.ts";
import { spaRoot, pkceGenerateVerifier } from "./useGdriveAuth.ts";
import { redactApiKeys } from "./useAiAutoFill.ts";
import {
  pkceChallengeS256,
  buildDropboxAuthUrl,
  processDropboxReturn,
} from "../utils/dropboxAuthCore.ts";

var useState = React.useState,
  useEffect = React.useEffect,
  useRef = React.useRef;

export function dbxTkGet(): string | null {
  try { return localStorage.getItem("dropbox-tk"); } catch { return null; }
}
export function dbxTkSet(v: string): void {
  // CodeQL js/clear-text-storage-of-sensitive-information — accepted
  // risk, same rationale as tkSet (no backend; CSP is the XSS defense).
  try { localStorage.setItem("dropbox-tk", v); } catch {}
}
export function dbxRtGet(): string {
  try { return localStorage.getItem("dropbox-rt") || ""; } catch { return ""; }
}
export function dbxRtSet(v: string): void {
  if (!v) return;
  try { localStorage.setItem("dropbox-rt", v); } catch {}
}
export function dbxAuthClear(): void {
  try { localStorage.removeItem("dropbox-tk"); } catch {}
  try { localStorage.removeItem("dropbox-rt"); } catch {}
}

/**
 * « L'APPEL A ÉCHOUÉ » N'EST PAS « VOTRE AUTORISATION EST MORTE ».
 *
 * `fetch` rejette sur une coupure, un DNS mort ou le délai de garde de 20 s,
 * et un 5xx à corps non-JSON fait rejeter `r.json()`. Ces rejets remontaient
 * jusqu'à `getToken`, indiscernables d'un grant absent ou révoqué — et
 * `getToken` répondait à tout par une redirection vers dropbox.com. Une panne
 * passagère éjectait donc l'utilisateur hors de son application ; hors ligne,
 * dropbox.com échoue aussi, et sur une PWA installée il faut fermer et
 * rouvrir. `gdriveGetToken` ne peut pas faire ça : il ne fait AUCUN appel
 * réseau avant de décider.
 *
 * Le marqueur est posé ici, au seul endroit qui sait que le rejet vient du
 * transport et non du contenu de la réponse.
 */
export var NETWORK_FAILURE = "__cloudNetworkFailure__";
function markNetwork(e: any): any {
  var err = e instanceof Error ? e : new Error(String(e || "network"));
  (err as any)[NETWORK_FAILURE] = true;
  return err;
}
function tokenEndpoint(body: URLSearchParams): Promise<any> {
  return fetchWithTimeout("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).then(
    function (r) { return r.json().catch(function (e: any) { throw markNetwork(e); }); },
    function (e: any) { throw markNetwork(e); },
  );
}

function cacheAccessToken(resp: any): string | null {
  if (!resp || !resp.access_token) return null;
  var ttlMs = (typeof resp.expires_in === "number" ? resp.expires_in : 14400) * 1000;
  // 5-minute safety margin, mirroring the gdrive-tk envelope habits.
  try {
    dbxTkSet(JSON.stringify({ t: resp.access_token, x: Date.now() + ttlMs - 300000 }));
  } catch (_e) {}
  if (resp.refresh_token) dbxRtSet(resp.refresh_token);
  return resp.access_token;
}

export function useDropboxAuth({
  setDropboxStatus,
  t,
}: {
  setDropboxStatus?: (s: string | null) => void;
  t?: (k: string) => string;
}) {
  // Review fix: localized "Error" prefix (French fallback if t is absent).
  var errPrefix = function () { return t ? t("err_prefix") : "Erreur"; };
  var _pda = useState<{ ac: string } | null>(null),
    pendingDropbox = _pda[0],
    setPendingDropbox = _pda[1];
  var exchangingRef = useRef(false);

  // Silent path only: cached access token, else refresh grant. Never
  // navigates. Rejects when neither is available — callers decide
  // whether to escalate to the interactive redirect.
  function getTokenSilent(): Promise<string> {
    var cached: any = null;
    try { cached = JSON.parse(dbxTkGet() || "null"); }
    catch (_pe) { try { localStorage.removeItem("dropbox-tk"); } catch (_ce) {} }
    if (cached && cached.t && cached.x > Date.now() + 60000) {
      return Promise.resolve(cached.t);
    }
    var rt = dbxRtGet();
    if (!rt) return Promise.reject(new Error("no refresh token"));
    var body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", rt);
    body.set("client_id", DROPBOX_APP_KEY);
    return tokenEndpoint(body).then(function (resp) {
      var tok = cacheAccessToken(resp);
      if (!tok) {
        // invalid_grant = the refresh token was revoked (user removed
        // the app from dropbox.com/account/connected_apps). Clear it so
        // the next getToken escalates to the interactive redirect
        // instead of hammering a dead grant.
        if (resp && resp.error === "invalid_grant") dbxAuthClear();
        throw new Error((resp && (resp.error_description || resp.error)) || "refresh failed");
      }
      return tok;
    });
  }

  // Full path: silent first, interactive redirect as last resort.
  // The redirect leg never resolves locally (navigation) — the mount
  // effect picks the return up, same dance as the iOS Drive flow.
  function getToken(action: string): Promise<string> {
    return getTokenSilent().catch(function (e: any) {
      // Une panne de TRANSPORT ne justifie pas de quitter l'application : on
      // le dit et on reste. Seules « pas de grant » et « grant révoqué »
      // méritent la redirection — dans les deux cas il n'y a effectivement
      // plus d'autorisation à renouveler en silence.
      if (e && (e as any)[NETWORK_FAILURE]) {
        throw new Error(t ? t("err_cloud_unreachable") : "Destination cloud injoignable. Vérifiez votre connexion, puis réessayez.");
      }
      var st = pkceGenerateVerifier();      // CSRF state
      var verifier = pkceGenerateVerifier(); // PKCE verifier (separate value)
      return pkceChallengeS256(verifier).then(function (challenge) {
        try {
          localStorage.setItem("dropbox-pending", action || "save");
          localStorage.setItem("dropbox-pending-ts", String(Date.now()));
          localStorage.setItem("dropbox-state", st);
          localStorage.setItem("dropbox-verifier", verifier);
        } catch (_e) {}
        recordOAuthEvent("redirect-start", action || "save", "dropbox");
        window.location.assign(buildDropboxAuthUrl({
          redirectUri: window.location.origin + spaRoot(),
          state: st,
          challenge: challenge,
        }));
        // Unreachable in practice (navigation) — keeps the type happy.
        return new Promise<string>(function () {});
      });
    });
  }

  // Mount: consume a Dropbox OAuth return (?code=…&state=…). Exchange
  // the code (PKCE — no secret), persist both tokens, surface the
  // pending action for the sync layer's dispatcher.
  useEffect(function () {
    var retMaybe = processDropboxReturn(window.location.search);
    if (!retMaybe || exchangingRef.current) return;
    // Capture in a const so the narrowing survives into the async
    // closures below (TS doesn't carry it across function boundaries).
    var ret = retMaybe;
    exchangingRef.current = true;
    // Strip ?code&state from the address bar — they're consumed, and a
    // reload must not re-process them.
    try {
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", clean);
    } catch (_e) {}
    var body = new URLSearchParams();
    body.set("code", ret.code);
    body.set("grant_type", "authorization_code");
    body.set("client_id", DROPBOX_APP_KEY);
    body.set("redirect_uri", window.location.origin + spaRoot());
    body.set("code_verifier", ret.verifier);
    tokenEndpoint(body)
      .then(function (resp) {
        var tok = cacheAccessToken(resp);
        if (!tok) {
          recordOAuthEvent("return-error", ret.action, "dropbox");
          if (setDropboxStatus) {
            // Redact any echoed secret from the error
            // string before it lands on screen / in a screenshot.
            var rawMsg = (resp && (resp.error_description || resp.error)) || "no token";
            setDropboxStatus(errPrefix() + " Dropbox: " + redactApiKeys(String(rawMsg)));
            setTimeout(function () { if (setDropboxStatus) setDropboxStatus(null); }, 5000);
          }
          return;
        }
        recordOAuthEvent("token-stored", ret.action, "dropbox");
        setPendingDropbox({ ac: ret.action });
      })
      .catch(function (e) {
        recordOAuthEvent("return-error", ret.action, "dropbox");
        if (setDropboxStatus) {
          var rawCatch = (e && e.message) || "exchange failed";
          setDropboxStatus(errPrefix() + " Dropbox: " + redactApiKeys(String(rawCatch)));
          setTimeout(function () { if (setDropboxStatus) setDropboxStatus(null); }, 5000);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pendingDropbox,
    setPendingDropbox,
    getToken,
    getTokenSilent,
    dbxAuthClear,
  };
}
