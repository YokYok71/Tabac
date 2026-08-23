/**
 * Tests for the Dropbox auth foundation:
 *   - dropboxAuthCore: PKCE S256 challenge (known vector), auth URL
 *     composition, processDropboxReturn (fail-closed CSRF, action
 *     whitelist incl. near-miss fuzz, read-before-clear ordering).
 *   - useDropboxAuth: token cache → refresh-grant → escalation order,
 *     code-exchange on mount, invalid_grant self-cleanup.
 *
 * These mirror the Google-side suites (processOAuthReturn.test.ts /
 * oauthWhitelist.property.test.ts) because the Dropbox return path
 * must honour the same three invariants: fail-closed state check,
 * whitelisted actions only, read-before-clear.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import fc from "fast-check";
import {
  DROPBOX_OAUTH_ACTIONS,
  isValidDropboxAction,
  pkceChallengeS256,
  buildDropboxAuthUrl,
  processDropboxReturn,
} from "../utils/dropboxAuthCore";
import {
  useDropboxAuth, dbxTkSet, dbxRtSet, dbxTkGet, dbxRtGet,
} from "../hooks/useDropboxAuth";
import { DROPBOX_APP_KEY } from "../constants";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── PKCE S256 ─────────────────────────────────────────────────────────────────

describe("pkceChallengeS256", () => {
  it("matches the RFC 7636 appendix B known vector", async () => {
    // RFC 7636 B: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // → challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    await expect(
      pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

// ── Auth URL ──────────────────────────────────────────────────────────────────

describe("buildDropboxAuthUrl", () => {
  it("composes the PKCE + offline authorize URL", () => {
    const url = buildDropboxAuthUrl({
      redirectUri: "https://t-cellar.app/",
      state: "st123",
      challenge: "ch456",
    });
    expect(url.startsWith("https://www.dropbox.com/oauth2/authorize?")).toBe(true);
    expect(url).toContain("client_id=" + DROPBOX_APP_KEY);
    expect(url).toContain("response_type=code");
    expect(url).toContain("redirect_uri=" + encodeURIComponent("https://t-cellar.app/"));
    expect(url).toContain("state=st123");
    expect(url).toContain("code_challenge=ch456");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("token_access_type=offline");
  });
});

// ── processDropboxReturn ──────────────────────────────────────────────────────

function seedReturn(over: Record<string, string | null> = {}) {
  const defaults: Record<string, string> = {
    "dropbox-state": "st1",
    "dropbox-pending": "save",
    "dropbox-verifier": "ver1",
    "dropbox-pending-ts": String(Date.now()),
  };
  for (const [k, v] of Object.entries({ ...defaults, ...over })) {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
}

describe("processDropboxReturn", () => {
  it("returns code+action+verifier on a valid return and consumes the one-shot keys", () => {
    seedReturn();
    const ret = processDropboxReturn("?code=C1&state=st1");
    expect(ret).toEqual({ code: "C1", action: "save", verifier: "ver1" });
    expect(localStorage.getItem("dropbox-state")).toBeNull();
    expect(localStorage.getItem("dropbox-pending")).toBeNull();
    expect(localStorage.getItem("dropbox-pending-ts")).toBeNull();
    expect(localStorage.getItem("dropbox-verifier")).toBeNull();
  });

  it("returns null without touching storage when no code is present", () => {
    seedReturn();
    expect(processDropboxReturn("")).toBeNull();
    expect(processDropboxReturn("?foo=bar")).toBeNull();
    expect(localStorage.getItem("dropbox-state")).toBe("st1");
  });

  it.each([
    ["missing returned state", "?code=C1", {}],
    ["missing stored state", "?code=C1&state=st1", { "dropbox-state": null }],
    ["state mismatch", "?code=C1&state=WRONG", {}],
  ])("fail-closed CSRF: %s → null (and keys consumed)", (_lbl, search, over) => {
    seedReturn(over as any);
    expect(processDropboxReturn(search)).toBeNull();
    expect(localStorage.getItem("dropbox-state")).toBeNull();
    expect(localStorage.getItem("dropbox-verifier")).toBeNull();
  });

  it("rejects a missing verifier", () => {
    seedReturn({ "dropbox-verifier": null });
    expect(processDropboxReturn("?code=C1&state=st1")).toBeNull();
  });

  it("accepts each of the five canonical actions", () => {
    for (const ac of DROPBOX_OAUTH_ACTIONS) {
      seedReturn({ "dropbox-pending": ac });
      const ret = processDropboxReturn("?code=C1&state=st1");
      expect(ret?.action).toBe(ac);
    }
  });

  it("property: no non-whitelisted action ever passes (500 runs + near-misses)", () => {
    fc.assert(
      fc.property(fc.string(), (ac) => {
        if ((DROPBOX_OAUTH_ACTIONS as readonly string[]).indexOf(ac) >= 0) return true;
        seedReturn({ "dropbox-pending": ac });
        return processDropboxReturn("?code=C1&state=st1") === null;
      }),
      { numRuns: 500 },
    );
    for (const near of ["Save", "SAVE", " save", "save ", "save2", "restore\n", "autosavee"]) {
      seedReturn({ "dropbox-pending": near });
      expect(processDropboxReturn("?code=C1&state=st1")).toBeNull();
    }
  });

  it("reads dropbox-pending BEFORE removing it (invariant, Proxy-asserted)", () => {
    seedReturn();
    const ops: string[] = [];
    const proxied = new Proxy(localStorage, {
      get(target, prop: string) {
        const orig = (target as any)[prop];
        if (prop === "getItem" || prop === "removeItem") {
          return (key: string) => {
            if (key === "dropbox-pending") ops.push(prop + ":" + key);
            return orig.call(target, key);
          };
        }
        return typeof orig === "function" ? orig.bind(target) : orig;
      },
    });
    processDropboxReturn("?code=C1&state=st1", { localStorage: proxied as any });
    const readIdx = ops.indexOf("getItem:dropbox-pending");
    const removeIdx = ops.indexOf("removeItem:dropbox-pending");
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(removeIdx);
  });
});

// ── isValidDropboxAction ──────────────────────────────────────────────────────

describe("isValidDropboxAction", () => {
  it("matches the gdrive whitelist values exactly", () => {
    // THIS CASE DID NOT DO WHAT ITS NAME SAYS. It compared against a
    // hand-written literal and never read the gdrive list at all, so adding
    // an action on the Drive side alone left it GREEN — the lock-step it is
    // named for was asserted by nothing, and the literal had to be edited by
    // hand every time either side moved (which is how it was found: it went
    // red on a change that made the two lists AGREE).
    //
    // It now DERIVES the Drive side. `OAUTH_ACTIONS` is module-private, so it
    // is parsed out of the source — comments blanked first, because the note
    // above that array names several actions and a check satisfied by its own
    // explanation is the trap this repo keeps hitting.
    const src = readFileSync("src/utils/oauthReturn.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    const m = /var OAUTH_ACTIONS\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(m, "OAUTH_ACTIONS not found — the parse has rotted").toBeTruthy();
    const gdrive = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    // Non-vacuity: an empty parse would make the comparison trivially true
    // against an empty Dropbox list.
    expect(gdrive.length).toBeGreaterThan(5);

    expect([...DROPBOX_OAUTH_ACTIONS], "the two providers' whitelists have drifted")
      .toEqual(gdrive);
    expect(isValidDropboxAction(null)).toBe(false);
    expect(isValidDropboxAction(42)).toBe(false);
    // And the list is still fail-CLOSED for anything else.
    expect(isValidDropboxAction("cat-wipe")).toBe(false);
  });
});

// ── useDropboxAuth — token acquisition ladder ─────────────────────────────────

describe("useDropboxAuth.getTokenSilent", () => {
  it("resolves the cached access token when still valid", async () => {
    dbxTkSet(JSON.stringify({ t: "cached-tok", x: Date.now() + 3600000 }));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await expect(result.current.getTokenSilent()).resolves.toBe("cached-tok");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the refresh grant when the cache is stale", async () => {
    dbxTkSet(JSON.stringify({ t: "old", x: Date.now() - 1 }));
    dbxRtSet("refresh-123");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ access_token: "fresh-tok", expires_in: 14400 }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await expect(result.current.getTokenSilent()).resolves.toBe("fresh-tok");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dropboxapi.com/oauth2/token");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-123");
    expect(body).toContain("client_id=" + DROPBOX_APP_KEY);
    // Fresh token cached for next time.
    expect(JSON.parse(dbxTkGet() || "null").t).toBe("fresh-tok");
  });

  it("rejects without network when no refresh token exists", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await expect(result.current.getTokenSilent()).rejects.toThrow("no refresh token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears both tokens on invalid_grant (user revoked the app)", async () => {
    dbxRtSet("revoked-rt");
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "invalid_grant", error_description: "revoked" }),
    }) as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await expect(result.current.getTokenSilent()).rejects.toThrow("revoked");
    expect(dbxRtGet()).toBe("");
    expect(dbxTkGet()).toBeNull();
  });
});

// ── useDropboxAuth — mount code exchange ──────────────────────────────────────

describe("useDropboxAuth — OAuth return exchange on mount", () => {
  it("exchanges the code (PKCE, no secret) and stores both tokens + pending action", async () => {
    seedReturn({ "dropbox-pending": "restore" });
    window.history.replaceState(null, "", "/?code=XYZ&state=st1");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        access_token: "at-1", refresh_token: "rt-1", expires_in: 14400,
      }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await waitFor(() => expect(result.current.pendingDropbox).toEqual({ ac: "restore" }));
    const body = String(fetchSpy.mock.calls[0]![1].body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=XYZ");
    expect(body).toContain("code_verifier=ver1");
    expect(body).not.toContain("client_secret");
    expect(JSON.parse(dbxTkGet() || "null").t).toBe("at-1");
    expect(dbxRtGet()).toBe("rt-1");
    // Address bar stripped of the one-shot params.
    expect(window.location.search).toBe("");
    window.history.replaceState(null, "", "/");
  });

  it("does nothing on a state mismatch (fail-closed)", async () => {
    seedReturn();
    window.history.replaceState(null, "", "/?code=XYZ&state=WRONG");
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useDropboxAuth({}));
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.pendingDropbox).toBeNull();
    window.history.replaceState(null, "", "/");
  });
});
