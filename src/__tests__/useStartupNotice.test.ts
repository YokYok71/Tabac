import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  parseNoticeForLang,
  useStartupNotice,
  NOTICE_SEEN_KEY,
} from "../hooks/useStartupNotice";

// ── parseNoticeForLang (pure) ─────────────────────────────────────────────────

describe("parseNoticeForLang", () => {
  it("returns null on empty / undefined / non-object input", () => {
    expect(parseNoticeForLang(null, "fr")).toBeNull();
    expect(parseNoticeForLang(undefined, "fr")).toBeNull();
    expect(parseNoticeForLang("string", "fr")).toBeNull();
    expect(parseNoticeForLang(42, "fr")).toBeNull();
    expect(parseNoticeForLang({}, "fr")).toBeNull();
  });

  it("returns null when id is missing or empty", () => {
    expect(parseNoticeForLang({ fr: { body: "hi" } }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "", fr: { body: "hi" } }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "   ", fr: { body: "hi" } }, "fr")).toBeNull();
  });

  it("returns null when both fr and en are missing or empty", () => {
    expect(parseNoticeForLang({ id: "x" }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "x", fr: {}, en: {} }, "fr")).toBeNull();
    expect(parseNoticeForLang({ id: "x", fr: { title: "" }, en: { body: "  " } }, "fr")).toBeNull();
  });

  it("picks the matching language slot", () => {
    const raw = {
      id: "abc",
      fr: { title: "Bonjour", body: "Salut" },
      en: { title: "Hello", body: "Hi" },
    };
    expect(parseNoticeForLang(raw, "fr")).toEqual({
      id: "abc",
      tone: "info",
      title: "Bonjour",
      body: "Salut",
    });
    expect(parseNoticeForLang(raw, "en")).toEqual({
      id: "abc",
      tone: "info",
      title: "Hello",
      body: "Hi",
    });
  });

  it("falls back to the other language when the requested slot is empty", () => {
    const raw = { id: "abc", fr: { title: "Bonjour", body: "Salut" } };
    const parsed = parseNoticeForLang(raw, "en");
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Bonjour");
  });

  it("resolves the es/de/it slot when present", () => {
    const raw = {
      id: "abc",
      fr: { title: "Bonjour" }, en: { title: "Hello" },
      es: { title: "Hola" }, de: { title: "Hallo" }, it: { title: "Ciao" },
    };
    expect(parseNoticeForLang(raw, "es")!.title).toBe("Hola");
    expect(parseNoticeForLang(raw, "de")!.title).toBe("Hallo");
    expect(parseNoticeForLang(raw, "it")!.title).toBe("Ciao");
  });

  it("es/de/it fall back to en then fr when their slot is absent", () => {
    // en present, fr present, no es → es resolves to en (not fr)
    const rawEn = { id: "a", fr: { title: "Bonjour" }, en: { title: "Hello" } };
    expect(parseNoticeForLang(rawEn, "de")!.title).toBe("Hello");
    // only fr present → de resolves to fr
    const rawFr = { id: "b", fr: { title: "Bonjour" } };
    expect(parseNoticeForLang(rawFr, "it")!.title).toBe("Bonjour");
  });

  it("accepts info / success / warn / error tones", () => {
    const base = { id: "x", fr: { body: "hi" } };
    expect(parseNoticeForLang({ ...base, tone: "info" }, "fr")!.tone).toBe("info");
    expect(parseNoticeForLang({ ...base, tone: "success" }, "fr")!.tone).toBe("success");
    expect(parseNoticeForLang({ ...base, tone: "warn" }, "fr")!.tone).toBe("warn");
    expect(parseNoticeForLang({ ...base, tone: "error" }, "fr")!.tone).toBe("error");
  });

  it("falls back to info on an unknown tone", () => {
    const raw = { id: "x", tone: "nuclear", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")!.tone).toBe("info");
  });

  it("returns null when expiresAt is in the past", () => {
    const raw = { id: "x", expiresAt: "2020-01-01T00:00:00Z", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).toBeNull();
  });

  it("returns the notice when expiresAt is in the future", () => {
    const raw = { id: "x", expiresAt: "2999-01-01T00:00:00Z", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).not.toBeNull();
  });

  it("ignores a malformed expiresAt and still shows the notice", () => {
    const raw = { id: "x", expiresAt: "not-a-date", fr: { body: "hi" } };
    expect(parseNoticeForLang(raw, "fr")).not.toBeNull();
  });

  it("trims whitespace from title and body", () => {
    const raw = { id: "x", fr: { title: "  Hi  ", body: "  hello world  " } };
    const parsed = parseNoticeForLang(raw, "fr")!;
    expect(parsed.title).toBe("Hi");
    expect(parsed.body).toBe("hello world");
  });
});

// ── useStartupNotice hook ─────────────────────────────────────────────────────

describe("useStartupNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(payload: any, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok,
          json: () => Promise.resolve(payload),
        }),
      ),
    );
  }

  it("renders nothing for an empty notice.json", async () => {
    mockFetch({});
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).toBeNull();
    });
  });

  it("surfaces a fresh notice", async () => {
    mockFetch({
      id: "2026-06-12",
      tone: "warn",
      fr: { title: "Avis", body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    expect(result.current.notice!.id).toBe("2026-06-12");
    expect(result.current.notice!.tone).toBe("warn");
    expect(result.current.notice!.title).toBe("Avis");
    expect(result.current.notice!.body).toBe("Bonjour");
  });

  it("does NOT show a notice the user has already dismissed", async () => {
    localStorage.setItem(NOTICE_SEEN_KEY, "2026-06-12");
    mockFetch({
      id: "2026-06-12",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    // Give the microtask queue a chance to drain
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("DOES show a notice when the dismissed id differs from the current one", async () => {
    localStorage.setItem(NOTICE_SEEN_KEY, "old-id");
    mockFetch({
      id: "new-id",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    expect(result.current.notice!.id).toBe("new-id");
  });

  it("dismiss() persists the id and hides the notice", async () => {
    mockFetch({
      id: "abc",
      fr: { body: "Bonjour" },
    });
    const { result } = renderHook(() => useStartupNotice("fr"));
    await waitFor(() => {
      expect(result.current.notice).not.toBeNull();
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.notice).toBeNull();
    expect(localStorage.getItem(NOTICE_SEEN_KEY)).toBe("abc");
  });

  it("silently swallows fetch failures (no banner, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { result } = renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("silently swallows non-OK HTTP responses", async () => {
    mockFetch({}, false);
    const { result } = renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.notice).toBeNull();
  });

  it("uses a cache-busting query string so the SW bypass triggers", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    renderHook(() => useStartupNotice("fr"));
    await new Promise(r => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalled();
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, ...unknown[]];
    const url = firstCall[0];
    expect(url).toContain("notice.json");
    expect(url).toContain("?_v=");
  });
});
