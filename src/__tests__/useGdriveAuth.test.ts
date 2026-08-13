/**
 * Tests for src/hooks/useGdriveAuth.ts (step 2 of the
 * useGdriveSync split). Covers the surfaces that became public:
 *
 *   - token storage helpers (tkGet/tkSet/tkClear) incl. the dual-storage
 *     wipe invariant
 *   - account hint helpers + captureAccountHint
 *   - gdriveGetToken popup path (window.google mocked): token resolution,
 *     hint capture, forceSelect semantics
 *   - gdriveReconnect: interactive flag + token persistence + status reset
 *   - triggerIosAutosaveReauth: hard no-op off iOS standalone
 *   - pendingOAuth capture from the __PENDING_GDRIVE_TOKEN__ globals,
 *     incl. the per-action setImportModal rules
 *
 * The iOS redirect branch of gdriveGetToken (location.replace) is NOT
 * driven here — jsdom can't navigate; its contract is locked by
 * processOAuthReturn.test.ts + oauthWhitelist.property.test.ts on the
 * return side, and the URL-building logic is exercised on a real device
 * (CLAUDE.md rule: model/OAuth changes need a manual smoke test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useGdriveAuth,
  tkGet, tkSet, tkClear,
  hintGet, hintSet,
  captureAccountHint,
  spaRoot,
} from "../hooks/useGdriveAuth";

function makeProps(overrides: Record<string, any> = {}) {
  return {
    t: (k: string) => k,
    setGdriveStatus: vi.fn(),
    setImportModal: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  (window as any).__PENDING_GDRIVE_ACTION__ = null;
  (window as any).__PENDING_GDRIVE_TOKEN__ = null;
  (window as any).__PENDING_GDRIVE_CODE__ = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).google;
});

// ── Token storage helpers ─────────────────────────────────────────────────────

describe("tkGet / tkSet / tkClear", () => {
  it("round-trips via sessionStorage on non-iOS (jsdom has no navigator.standalone)", () => {
    tkSet("tok-123");
    expect(sessionStorage.getItem("gdrive-tk")).toBe("tok-123");
    expect(tkGet()).toBe("tok-123");
  });

  it("tkClear wipes BOTH storages (the cross-platform invariant)", () => {
    sessionStorage.setItem("gdrive-tk", "a");
    localStorage.setItem("gdrive-tk", "b");
    tkClear();
    expect(sessionStorage.getItem("gdrive-tk")).toBeNull();
    expect(localStorage.getItem("gdrive-tk")).toBeNull();
  });

  it("tkClear does NOT clear the account hint", () => {
    hintSet("user@example.com");
    tkClear();
    expect(hintGet()).toBe("user@example.com");
  });
});

// ── Account hint ──────────────────────────────────────────────────────────────

describe("hint helpers + captureAccountHint", () => {
  it("hintSet ignores empty values", () => {
    hintSet("");
    expect(hintGet()).toBe("");
  });

  it("captureAccountHint fetches drive/v3/about and persists the email", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { emailAddress: "remy@example.com" } }),
    });
    globalThis.fetch = fetchSpy as any;
    captureAccountHint("tok");
    await waitFor(() => expect(hintGet()).toBe("remy@example.com"));
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("drive/v3/about");
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok");
  });

  it("captureAccountHint short-circuits when a hint already exists", () => {
    hintSet("already@example.com");
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    captureAccountHint("tok");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("captureAccountHint rejects non-email payloads", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { emailAddress: "not-an-email" } }),
    }) as any;
    captureAccountHint("tok");
    await new Promise(r => setTimeout(r, 10));
    expect(hintGet()).toBe("");
  });
});

// ── spaRoot ───────────────────────────────────────────────────────────────────

describe("spaRoot", () => {
  it("returns a trailing-slash path (jsdom default '/')", () => {
    expect(spaRoot()).toBe("/");
  });
});

// ── gdriveGetToken (popup path) ───────────────────────────────────────────────

function mockGsi(result: any) {
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn().mockImplementation((cfg: any) => ({
    requestAccessToken: requestAccessToken.mockImplementation(() => {
      cfg.callback(result);
    }),
  }));
  (window as any).google = { accounts: { oauth2: { initTokenClient } } };
  return { initTokenClient, requestAccessToken };
}

describe("gdriveGetToken — popup path (non-iOS)", () => {
  it("resolves the access token via initTokenClient", async () => {
    mockGsi({ access_token: "fresh-tok" });
    const { result } = renderHook(() => useGdriveAuth(makeProps()));
    const tok = await result.current.gdriveGetToken("save");
    expect(tok).toBe("fresh-tok");
  });

  it("rejects when GSI reports an error", async () => {
    mockGsi({ error: "access_denied", error_description: "user said no" });
    const { result } = renderHook(() => useGdriveAuth(makeProps()));
    await expect(result.current.gdriveGetToken("save")).rejects.toThrow("user said no");
  });

  it("passes the stored login_hint to initTokenClient", async () => {
    hintSet("remy@example.com");
    const { initTokenClient } = mockGsi({ access_token: "t" });
    const { result } = renderHook(() => useGdriveAuth(makeProps()));
    await result.current.gdriveGetToken("save");
    expect(initTokenClient.mock.calls[0]![0].hint).toBe("remy@example.com");
  });

  it("gdrive-force-select clears the hint and requests the account picker", async () => {
    hintSet("old@example.com");
    localStorage.setItem("gdrive-force-select", "1");
    const { initTokenClient } = mockGsi({ access_token: "t" });
    const { result } = renderHook(() => useGdriveAuth(makeProps()));
    await result.current.gdriveGetToken("save");
    // Hint wiped + marker consumed + no hint passed to GSI.
    expect(hintGet()).toBe("");
    expect(localStorage.getItem("gdrive-force-select")).toBeNull();
    expect(initTokenClient.mock.calls[0]![0].hint).toBeUndefined();
  });
});

// ── gdriveReconnect ───────────────────────────────────────────────────────────

describe("gdriveReconnect", () => {
  it("persists the fresh token via tkSet and clears the status", async () => {
    mockGsi({ access_token: "reconnect-tok" });
    const props = makeProps();
    const { result } = renderHook(() => useGdriveAuth(props));
    const tok = await result.current.gdriveReconnect();
    expect(tok).toBe("reconnect-tok");
    const stored = JSON.parse(tkGet() || "null");
    expect(stored.t).toBe("reconnect-tok");
    expect(stored.x).toBeGreaterThan(Date.now());
    expect(props.setGdriveStatus).toHaveBeenLastCalledWith(null);
  });

  it("surfaces the error in gdriveStatus on failure (no throw)", async () => {
    mockGsi({ error: "popup_closed", error_description: "closed" });
    const props = makeProps();
    const { result } = renderHook(() => useGdriveAuth(props));
    await result.current.gdriveReconnect();
    const calls = props.setGdriveStatus.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((s: any) => typeof s === "string" && s.includes("closed"))).toBe(true);
  });
});

// ── triggerIosAutosaveReauth ──────────────────────────────────────────────────

describe("triggerIosAutosaveReauth", () => {
  it("is a hard no-op off iOS standalone (jsdom)", () => {
    localStorage.setItem("cave-autosave", "1");
    localStorage.setItem("gdrive-auto-fid", "fid");
    const { initTokenClient } = mockGsi({ access_token: "t" });
    const { result } = renderHook(() => useGdriveAuth(makeProps()));
    act(() => { result.current.triggerIosAutosaveReauth(); });
    expect(initTokenClient).not.toHaveBeenCalled();
    expect(localStorage.getItem("gdrive-pending")).toBeNull();
  });
});

// ── pendingOAuth capture (mount effect) ───────────────────────────────────────

describe("pendingOAuth capture from __PENDING_GDRIVE_TOKEN__", () => {
  it("captures the token + action into pendingOAuth and opens Settings for 'save'", async () => {
    (window as any).__PENDING_GDRIVE_ACTION__ = "save";
    (window as any).__PENDING_GDRIVE_TOKEN__ = "ios-tok";
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any; // hint capture noise
    const props = makeProps();
    const { result } = renderHook(() => useGdriveAuth(props));
    await waitFor(() => expect(result.current.pendingOAuth).toEqual({ tk: "ios-tok", ac: "save" }));
    expect(props.setImportModal).toHaveBeenCalledWith(true);
    // Globals consumed.
    expect((window as any).__PENDING_GDRIVE_TOKEN__).toBeNull();
    expect((window as any).__PENDING_GDRIVE_ACTION__).toBeNull();
  });

  it.each(["reconnect", "autosave"])(
    "does NOT open Settings for the '%s' action",
    async (ac) => {
      (window as any).__PENDING_GDRIVE_ACTION__ = ac;
      (window as any).__PENDING_GDRIVE_TOKEN__ = "tok";
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
      const props = makeProps();
      const { result } = renderHook(() => useGdriveAuth(props));
      await waitFor(() => expect(result.current.pendingOAuth).toEqual({ tk: "tok", ac }));
      expect(props.setImportModal).not.toHaveBeenCalled();
    },
  );

  it("does nothing when no pending action exists", () => {
    const props = makeProps();
    const { result } = renderHook(() => useGdriveAuth(props));
    expect(result.current.pendingOAuth).toBeNull();
    expect(props.setImportModal).not.toHaveBeenCalled();
  });
});
