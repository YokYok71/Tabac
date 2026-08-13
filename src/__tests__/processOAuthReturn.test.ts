/**
 * regression suite for `processOAuthReturn` (the
 * App.tsx OAuth-handler IIFE, extracted to a testable function).
 *
 * The regression that motivated this file: an
 * early `localStorage.removeItem("gdrive-pending")` cleanup ran
 * BEFORE the success-path read of the same key, so the action
 * context was always lost and the dispatcher silently dropped every
 * fresh token. The "iOS happy path captures action before cleanup"
 * test below would have caught it the moment the regression landed.
 *
 * The action whitelist must stay synced with the dispatcher in
 * useGdriveSync. The "whitelist coverage" test exercises every entry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { processOAuthReturn } from "../utils/oauthReturn.ts";
import { OAUTH_DIAG_KEY, readOAuthEvent } from "../utils/oauthDiag.ts";

interface FakeWindow {
  location: { hash: string; search: string; pathname: string };
  localStorage: Storage;
  history: { replaceState: ReturnType<typeof vi.fn> };
  __PENDING_GDRIVE_TOKEN__?: string | null;
  __PENDING_GDRIVE_ACTION__?: string | null;
  __PENDING_GDRIVE_CODE__?: string | null;
  __PENDING_GDRIVE_VERIFIER__?: string | null;
  __PENDING_GDRIVE_REDIRECT__?: string | null;
}

function makeWin(opts: { hash?: string; search?: string } = {}): FakeWindow {
  return {
    location: {
      hash: opts.hash || "",
      search: opts.search || "",
      pathname: "/",
    },
    localStorage: window.localStorage,
    history: { replaceState: vi.fn() },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("processOAuthReturn — implicit grant (iOS) happy path", () => {
  it("captures gdrive-pending BEFORE the early cleanup wipes it", () => {
    // This is the regression test for the bug.
    // Set up: an iOS Reconnect flow is in flight, Google has just
    // bounced back with a fresh token.
    window.localStorage.setItem("gdrive-pending", "reconnect");
    window.localStorage.setItem("gdrive-pending-ts", String(Date.now()));
    window.localStorage.setItem("gdrive-state", "STATE_X");
    const w = makeWin({ hash: "#access_token=TK&state=STATE_X" });

    processOAuthReturn(w as unknown as Window);

    // The dispatcher MUST have seen the action context. Earlier
    // this assertion failed because the early cleanup wiped the key
    // before the action was read.
    expect(w.__PENDING_GDRIVE_ACTION__).toBe("reconnect");
    expect(w.__PENDING_GDRIVE_TOKEN__).toBe("TK");
    // OAuth housekeeping should be cleaned up.
    expect(window.localStorage.getItem("gdrive-pending")).toBeNull();
    expect(window.localStorage.getItem("gdrive-pending-ts")).toBeNull();
    expect(window.localStorage.getItem("gdrive-state")).toBeNull();
    // Hash should be cleared from history.
    expect(w.history.replaceState).toHaveBeenCalledWith({}, "", "/");
  });

  it("records return-success with the action context", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    window.localStorage.setItem("gdrive-state", "S");
    const w = makeWin({ hash: "#access_token=tk&state=S" });
    processOAuthReturn(w as unknown as Window);
    const ev = readOAuthEvent();
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("return-success");
    // The bug surfaced as "return-success" WITHOUT an action — that's
    // exactly what we're guarding against.
    expect(ev!.action).toBe("reconnect");
  });

  // "restore-cnb" added for the banner-driven cloud-newer
  // restore flow on iOS (so the OAuth-return dispatcher can resume the
  // direct restore-by-id instead of opening the full backup picker).
  for (const action of ["save", "restore", "reconnect", "list", "autosave", "restore-cnb"] as const) {
    it("whitelisted action '" + action + "' is dispatched", () => {
      window.localStorage.setItem("gdrive-pending", action);
      window.localStorage.setItem("gdrive-state", "S");
      const w = makeWin({ hash: "#access_token=tk&state=S" });
      processOAuthReturn(w as unknown as Window);
      expect(w.__PENDING_GDRIVE_ACTION__).toBe(action);
      expect(w.__PENDING_GDRIVE_TOKEN__).toBe("tk");
    });
  }

  it("non-whitelisted action is dropped (security invariant)", () => {
    window.localStorage.setItem("gdrive-pending", "exfiltrate");
    window.localStorage.setItem("gdrive-state", "S");
    const w = makeWin({ hash: "#access_token=tk&state=S" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_ACTION__).toBeUndefined();
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
  });
});

describe("processOAuthReturn — implicit grant error paths", () => {
  it("returns early when there is no hash", () => {
    const w = makeWin({ hash: "" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    expect(readOAuthEvent()).toBeNull();
  });

  it("records return-no-token when the hash has neither token nor error", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    const w = makeWin({ hash: "#state=S" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    const ev = readOAuthEvent();
    expect(ev?.type).toBe("return-no-token");
    expect(ev?.action).toBe("reconnect");
  });

  it("records return-error with the error code", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    const w = makeWin({ hash: "#error=access_denied&state=S" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    const ev = readOAuthEvent();
    expect(ev?.type).toBe("return-error");
    expect(ev?.detail).toBe("access_denied");
    expect(ev?.action).toBe("reconnect");
  });

  it("error / no-token return clears gdrive-pending + ts", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    window.localStorage.setItem("gdrive-pending-ts", "1234");
    const w = makeWin({ hash: "#error=access_denied" });
    processOAuthReturn(w as unknown as Window);
    expect(window.localStorage.getItem("gdrive-pending")).toBeNull();
    expect(window.localStorage.getItem("gdrive-pending-ts")).toBeNull();
  });

  it("state mismatch discards token + records state-mismatch", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    window.localStorage.setItem("gdrive-state", "S_EXPECTED");
    const w = makeWin({ hash: "#access_token=tk&state=S_DIFFERENT" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    expect(w.__PENDING_GDRIVE_ACTION__).toBeUndefined();
    const ev = readOAuthEvent();
    expect(ev?.type).toBe("state-mismatch");
    expect(ev?.action).toBe("reconnect");
  });

  it("missing expected state (cleared between redirect-out and return) fails fail-closed", () => {
    // Security invariant: !st || !expectedSt || st !== expectedSt.
    // If expectedSt was somehow wiped, the OAuth return must NOT
    // accept the token.
    window.localStorage.setItem("gdrive-pending", "reconnect");
    // No gdrive-state set.
    const w = makeWin({ hash: "#access_token=tk&state=S" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    expect(readOAuthEvent()?.type).toBe("state-mismatch");
  });

  it("missing returned state (Google returned nothing) fails fail-closed", () => {
    window.localStorage.setItem("gdrive-pending", "reconnect");
    window.localStorage.setItem("gdrive-state", "S");
    const w = makeWin({ hash: "#access_token=tk" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_TOKEN__).toBeUndefined();
    expect(readOAuthEvent()?.type).toBe("state-mismatch");
  });
});

describe("processOAuthReturn — PKCE authorization-code grant (non-iOS popup)", () => {
  it("happy path: code + verifier + matching state dispatches the action", () => {
    window.localStorage.setItem("gdrive-pending", "save");
    window.localStorage.setItem("gdrive-state", "STATE_Q");
    window.localStorage.setItem("gdrive-pkce-verifier", "V");
    window.localStorage.setItem("gdrive-pkce-redirect", "https://app/");
    const w = makeWin({ search: "?code=CODE&state=STATE_Q" });

    processOAuthReturn(w as unknown as Window);

    expect(w.__PENDING_GDRIVE_ACTION__).toBe("save");
    expect(w.__PENDING_GDRIVE_CODE__).toBe("CODE");
    expect(w.__PENDING_GDRIVE_VERIFIER__).toBe("V");
    expect(w.__PENDING_GDRIVE_REDIRECT__).toBe("https://app/");
    expect(window.localStorage.getItem("gdrive-pending")).toBeNull();
    expect(window.localStorage.getItem("gdrive-state")).toBeNull();
    expect(window.localStorage.getItem("gdrive-pkce-verifier")).toBeNull();
  });

  it("PKCE state mismatch fails fail-closed", () => {
    window.localStorage.setItem("gdrive-pending", "save");
    window.localStorage.setItem("gdrive-state", "STATE_A");
    window.localStorage.setItem("gdrive-pkce-verifier", "V");
    const w = makeWin({ search: "?code=CODE&state=STATE_B" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_CODE__).toBeUndefined();
  });

  it("PKCE missing verifier fails fail-closed", () => {
    window.localStorage.setItem("gdrive-pending", "save");
    window.localStorage.setItem("gdrive-state", "STATE_A");
    // No verifier.
    const w = makeWin({ search: "?code=CODE&state=STATE_A" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_CODE__).toBeUndefined();
  });

  it("PKCE non-whitelisted action drops the dispatch", () => {
    window.localStorage.setItem("gdrive-pending", "exfiltrate");
    window.localStorage.setItem("gdrive-state", "S");
    window.localStorage.setItem("gdrive-pkce-verifier", "V");
    const w = makeWin({ search: "?code=CODE&state=S" });
    processOAuthReturn(w as unknown as Window);
    expect(w.__PENDING_GDRIVE_ACTION__).toBeUndefined();
    expect(w.__PENDING_GDRIVE_CODE__).toBeUndefined();
  });
});

describe("processOAuthReturn — read-before-clear invariant", () => {
  it("the gdrive-pending read happens BEFORE the early cleanup", () => {
    // Sentinel: in a Proxy-wrapped localStorage we observe the call
    // order. The regression had removeItem("gdrive-pending")
    // call BEFORE the read, so this test would have flagged it
    // immediately (action would be null in the dispatch).
    const calls: string[] = [];
    const realLS = window.localStorage;
    const proxy = new Proxy(realLS, {
      get(t, prop, r) {
        const v = Reflect.get(t, prop, r);
        if (typeof v !== "function") return v;
        return function (this: unknown, ...args: unknown[]) {
          if (prop === "getItem" || prop === "removeItem") {
            const k = String(args[0]);
            if (k === "gdrive-pending") calls.push(prop + ":" + k);
          }
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      },
    });
    realLS.setItem("gdrive-pending", "reconnect");
    realLS.setItem("gdrive-state", "S");
    const w = {
      location: { hash: "#access_token=tk&state=S", search: "", pathname: "/" },
      localStorage: proxy,
      history: { replaceState: vi.fn() },
    };
    processOAuthReturn(w as unknown as Window);
    // First touch of gdrive-pending must be a getItem (capture),
    // followed by removeItem.
    expect(calls[0]).toBe("getItem:gdrive-pending");
    expect(calls).toContain("removeItem:gdrive-pending");
    expect(calls.indexOf("getItem:gdrive-pending")).toBeLessThan(
      calls.indexOf("removeItem:gdrive-pending"),
    );
  });
});

afterEach(() => {
  // Diag is shared global state — wipe between tests.
  try { window.localStorage.removeItem(OAUTH_DIAG_KEY); } catch (_e) {}
});
