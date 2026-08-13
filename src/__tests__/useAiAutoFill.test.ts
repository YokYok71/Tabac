// Unit tests for useAiAutoFill.
//
// Coverage focus:
//   1. Initial state (provider + key from localStorage, default exclude)
//   2. saveAiProvider swaps the cached API key per provider
//   3. saveApiKey persists under the active provider's storage key
//   4. excludeApiKey reflects the cave-exclude-apikey localStorage flag
//   5. aiAutoFill SECURITY: rejects empty key, truncates query >200 chars
//   6. aiAutoFill dispatches the correct provider URL + headers (anthropic /
//      openai / gemini) and supplies the language instruction matching `lang`
//
// Notes: tests don't drive real network — fetch is mocked. The hook is
// rendered via @testing-library/react renderHook so React state actually
// flows. We assert against the URL + headers + body of the mocked fetch.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAiAutoFill, redactApiKeys, normalizeAiModel, defaultAiModel,
  AI_MODEL_OPTIONS, AI_MODEL_ALIASES, openaiMaxTokensField, isModelGoneError,
  AI_MODEL_AUTO, resolveAiModel, deadModelsKey,
  isFormerDefaultModel, AI_FORMER_DEFAULTS, AI_AUTO_MIGRATED_KEY, buildModelProbeRequest,
} from "../hooks/useAiAutoFill";
import { _resetTobaccoDbForTests, loadTobaccoDb } from "../utils/tobaccoDb.ts";

function defaultProps(overrides: any = {}) {
  return {
    lang: "fr",
    form: { brand: "", name: "" },
    setForm: vi.fn(),
    pipeForm: { brand: "", name: "" },
    setPipeForm: vi.fn(),
    wishForm: { brand: "", name: "" },
    setWishForm: vi.fn(),
    weightUnit: "g",
    lengthUnit: "mm",
    t: (k: string) => k,
    ...overrides,
  };
}

beforeEach(async () => {
  localStorage.clear();
  // The AI hook now mounts a loadTobaccoDb() useEffect on
  // render. The fetch spies in this file don't return DB-shaped JSON, so
  // we pre-fail the DB cache here. loadTobaccoDb's internal `failed`
  // flag is sticky → subsequent loadTobaccoDb() calls (including the
  // hook's mount effect) short-circuit to null without firing fetch,
  // keeping these tests focused on AI dispatch and unaffected by the
  // DB-first integration.
  _resetTobaccoDbForTests();
  (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error("no DB in this test file"));
  await loadTobaccoDb();
  delete (globalThis as any).fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAiAutoFill — initial state", () => {
  it("defaults to anthropic provider when none stored", () => {
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.aiProvider).toBe("anthropic");
  });

  it("reads provider from localStorage", () => {
    localStorage.setItem("ai-provider", "openai");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.aiProvider).toBe("openai");
  });

  it("reads the per-provider API key on init", () => {
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-test-123");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.apiKey).toBe("sk-test-123");
  });

  it("excludeApiKey defaults to true (opt-out model)", () => {
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.excludeApiKey).toBe(true);
  });

  it("excludeApiKey is false only when 'cave-exclude-apikey' is exactly '0'", () => {
    localStorage.setItem("cave-exclude-apikey", "0");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.excludeApiKey).toBe(false);
  });

  it("aiLoad starts false and aiErr starts empty", () => {
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.aiLoad).toBe(false);
    expect(result.current.aiErr).toBe("");
  });
});

describe("useAiAutoFill — saveAiProvider", () => {
  it("persists the new provider and loads its API key", () => {
    localStorage.setItem("anthropic-api-key", "sk-ant-A");
    localStorage.setItem("openai-api-key", "sk-O");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.saveAiProvider("openai"));
    expect(localStorage.getItem("ai-provider")).toBe("openai");
    expect(result.current.aiProvider).toBe("openai");
    expect(result.current.apiKey).toBe("sk-O");
  });

  it("loads empty key when target provider has none stored", () => {
    localStorage.setItem("anthropic-api-key", "sk-ant-A");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.saveAiProvider("gemini"));
    expect(result.current.apiKey).toBe("");
  });
});

describe("useAiAutoFill — saveApiKey", () => {
  it("writes the key under the active provider's storage slot", () => {
    localStorage.setItem("ai-provider", "openai");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.saveApiKey("sk-openai-new"));
    expect(localStorage.getItem("openai-api-key")).toBe("sk-openai-new");
    expect(result.current.apiKey).toBe("sk-openai-new");
  });

  // targeted-provider import. A backup made under
  // Anthropic must drop its key into `anthropic-api-key` regardless
  // of which provider is currently active on the importing device.
  it("targets the provided provider slot without touching the active one", () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "gem-existing");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.saveApiKey("sk-ant-imported", "anthropic"));
    // Anthropic slot got the new key.
    expect(localStorage.getItem("anthropic-api-key")).toBe("sk-ant-imported");
    // The active (Gemini) slot is untouched.
    expect(localStorage.getItem("gemini-api-key")).toBe("gem-existing");
    // Displayed apiKey (Gemini's) is also unchanged.
    expect(result.current.apiKey).not.toBe("sk-ant-imported");
  });

  it("ignores an unknown provider arg (falls back to active slot)", () => {
    localStorage.setItem("ai-provider", "openai");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.saveApiKey("sk-x", "bogus"));
    expect(localStorage.getItem("openai-api-key")).toBe("sk-x");
  });
});

describe("useAiAutoFill — aiAutoFill guards", () => {
  it("sets aiErr to 'err_api_key' when key is empty (no fetch)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => result.current.aiAutoFill("tobacco"));
    expect(result.current.aiErr).toBe("err_api_key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Note: the q.length < 3 guard inside aiAutoFill is effectively dead code
  // because the scaffolding (" pipe tobacco" / " pipe") always pads the
  // query beyond 3 chars. We don't test it.
});

describe("useAiAutoFill — aiAutoFill dispatch", () => {
  it("posts to api.anthropic.com with x-api-key header for anthropic", async () => {
    localStorage.setItem("anthropic-api-key", "sk-ant-xyz");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: "{}" }] }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({ form: { brand: "Halvorsen", name: "Duskfall" } })),
    );
    await act(async () => {
      result.current.aiAutoFill("tobacco");
    });
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-xyz");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("posts to api.openai.com with Bearer header for openai", async () => {
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-openai-xyz");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "{}" } }] }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({ form: { brand: "Halvorsen", name: "Duskfall" } })),
    );
    await act(async () => {
      result.current.aiAutoFill("tobacco");
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-openai-xyz");
  });

  it("posts to generativelanguage.googleapis.com with x-goog-api-key for gemini", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-xyz");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: "{}" }] } }],
        }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({ form: { brand: "Halvorsen", name: "Duskfall" } })),
    );
    await act(async () => {
      result.current.aiAutoFill("tobacco");
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("generativelanguage.googleapis.com");
    expect(init.headers["x-goog-api-key"]).toBe("AIza-xyz");
    // Critical: gemini key must NOT be in the URL query (avoid log/referrer leak)
    expect(String(url)).not.toContain("AIza-xyz");
  });

  it("language instruction matches the current lang setting", async () => {
    localStorage.setItem("anthropic-api-key", "sk-ant");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: "{}" }] }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(
        defaultProps({
          lang: "en",
          form: { brand: "Halvorsen", name: "Duskfall" },
        }),
      ),
    );
    await act(async () => {
      result.current.aiAutoFill("tobacco");
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body.system).toContain("All text fields");
    expect(body.system).not.toContain("Tous les champs");
  });

  it("truncates the embedded query to 200 chars (prompt-injection surface)", async () => {
    localStorage.setItem("anthropic-api-key", "sk-ant");
    const long = "X".repeat(500);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: "{}" }] }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({ form: { brand: long, name: "Z" } })),
    );
    await act(async () => {
      result.current.aiAutoFill("tobacco");
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    const userMsg = body.messages[0].content;
    // The user message wraps the query in scaffolding ("Tabac: ... -> JSON: ...").
    // The query itself must be capped at 200 chars; total user message can be longer.
    // We assert the count of "X"s present <= 200.
    const xCount = (userMsg.match(/X/g) || []).length;
    expect(xCount).toBeLessThanOrEqual(200);
  });
});

// ── Anthropic request shape — regression locks ────────────────────
// These tests don't validate against Anthropic's API (we don't own that
// contract — Anthropic could change defaults tomorrow and these would
// still pass while real calls fail). What they DO is lock in every shape
// invariant we've already paid for at runtime, so future edits can't
// silently re-break them.
//
// Build history of regressions these tests would have caught:
//   • someone (me) kept `web_search_20260209` after
//     reverting to Haiku 4.5, not realising _20260209 defaults to
//     requiring programmatic tool calling (PTC) which Haiku doesn't
//     support. Every auto-fill call 400'd until allowed_callers:
//     ["direct"] was added explicitly. The third test below locks that
//     fix — anyone removing allowed_callers gets a red CI.
//
// **If you bump the Anthropic model or tool version, you MUST also
// trigger a real auto-fill from the UI before pushing.** These tests
// only prevent regressions against shapes we've already validated by
// hand; they cannot discover the next shape Anthropic decides to
// require. Treat them as a safety net, not a substitute for manual
// verification.

describe("useAiAutoFill — anthropic request shape regression locks", () => {
  function setupAnthropic() {
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: "{}" }] }),
    });
    globalThis.fetch = fetchSpy as any;
    return fetchSpy;
  }

  async function callAndGetBody(type: "tobacco" | "pipe" | "wish") {
    const fetchSpy = setupAnthropic();
    const props = defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
      pipeForm: { brand: "Halvorsen", name: "Sherlock" },
      wishForm: { brand: "GLP", name: "Westminster" },
    });
    const { result } = renderHook(() => useAiAutoFill(props));
    await act(async () => { result.current.aiAutoFill(type); });
    return JSON.parse(fetchSpy.mock.calls[0]![1].body);
  }

  it("uses claude-haiku-4-5 as the default model", async () => {
    const body = await callAndGetBody("tobacco");
    // Locking the exact id, not just the family — a
    // model swap to Opus or Sonnet would intentionally break this test
    // and force a conscious update.
    expect(body.model).toBe("claude-haiku-4-5");
  });

  it("uses the user-selected model stored in ai-model-<provider>", async () => {
    localStorage.setItem("ai-model-anthropic", "claude-sonnet-5");
    const body = await callAndGetBody("tobacco");
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("does NOT set output_config.effort — Haiku 4.5 returns 400 on effort", async () => {
    // This was once added for Opus and reverted, but
    // someone re-tuning could re-add it without realising Haiku rejects.
    const body = await callAndGetBody("tobacco");
    expect(body.output_config).toBeUndefined();
  });

  it("declares web_search with allowed_callers=['direct'] (PTC fix)", async () => {
    const body = await callAndGetBody("tobacco");
    expect(Array.isArray(body.tools)).toBe(true);
    const webSearchTool = body.tools.find((tt: any) => tt.name === "web_search");
    expect(webSearchTool).toBeTruthy();
    // The exact field that added. Removing this re-introduces
    // the "claude-haiku-4-5 does not support programmatic tool calling"
    // 400 error from the screenshot.
    expect(webSearchTool.allowed_callers).toEqual(["direct"]);
    // Cap on web_search rounds — latency driver, not just a vibe knob.
    expect(webSearchTool.max_uses).toBe(3);
    // Lock the tool version too, so a bump that silently changes PTC
    // defaults again forces a conscious review.
    expect(webSearchTool.type).toBe("web_search_20260209");
  });

  it("sends a non-empty system + exactly one user message", async () => {
    const body = await callAndGetBody("tobacco");
    expect(typeof body.system).toBe("string");
    expect(body.system.length).toBeGreaterThan(50);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(typeof body.messages[0].content).toBe("string");
  });

  it("max_tokens is 1024 — well below streaming threshold", async () => {
    const body = await callAndGetBody("tobacco");
    // The auto-fill request is intentionally bounded — under 16K means
    // we can stay on the simpler non-streaming code path without
    // hitting SDK HTTP timeouts. Bumping this above ~16K means moving
    // to streaming.
    expect(body.max_tokens).toBe(1024);
    expect(body.max_tokens).toBeLessThan(16000);
  });

  it("applies the same shape invariants for the pipe and wish branches", async () => {
    const pipeBody = await callAndGetBody("pipe");
    const wishBody = await callAndGetBody("wish");
    for (const body of [pipeBody, wishBody]) {
      expect(body.model).toBe("claude-haiku-4-5");
      expect(body.output_config).toBeUndefined();
      const webSearchTool = body.tools.find((tt: any) => tt.name === "web_search");
      expect(webSearchTool.allowed_callers).toEqual(["direct"]);
    }
  });
});


// ── API-key redaction in error messages ──────────────────────────
// Provider error messages are displayed verbatim in the UI (and land on
// user screenshots). If a provider, proxy, or gateway ever echoes the
// key back in an error body, it must be masked before display.

describe("useAiAutoFill — error message API-key redaction", () => {
  async function triggerError(message: string) {
    localStorage.setItem("anthropic-api-key", "sk-ant-secret1234567890abcdef");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: { message } }),
    });
    globalThis.fetch = fetchSpy as any;
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({ form: { brand: "Halvorsen", name: "Duskfall" } })),
    );
    await act(async () => { result.current.aiAutoFill("tobacco"); });
    return result;
  }

  it("masks Anthropic/OpenAI-style sk- keys", async () => {
    const result = await triggerError(
      "Invalid key: sk-ant-secret1234567890abcdef provided",
    );
    expect(result.current.aiErr).not.toContain("sk-ant-secret1234567890abcdef");
    expect(result.current.aiErr).toContain("[clé masquée]");
  });

  it("masks Google AIza-style keys", async () => {
    const result = await triggerError("Bad key AIzaSyB1234567890abcdefghij rejected");
    expect(result.current.aiErr).not.toContain("AIzaSyB1234567890abcdefghij");
    expect(result.current.aiErr).toContain("[clé masquée]");
  });

  it("masks api_key= query params", async () => {
    const result = await triggerError("403 on https://x.test/v1?api_key=topsecret123&q=z");
    expect(result.current.aiErr).not.toContain("topsecret123");
  });

  it("leaves ordinary error messages readable", async () => {
    const result = await triggerError("Rate limit exceeded, retry in 60s");
    expect(result.current.aiErr).toBe("Rate limit exceeded, retry in 60s");
  });
});

// redactApiKeys widened to cover OAuth secrets (Dropbox
// PKCE error_descriptions can echo the request body verbatim) and HTTP
// Bearer tokens. Pure-function tests so the patterns are locked.
describe("redactApiKeys — OAuth + Bearer widening", () => {
  it("masks Bearer tokens of plausible length", () => {
    const s = "401 Unauthorized: Bearer ya29.A0ARrdaM_super_long_token_abcdefghij_123";
    const out = redactApiKeys(s);
    expect(out).not.toContain("ya29.A0ARrdaM");
    expect(out).toContain("Bearer [clé masquée]");
  });

  it("masks PKCE code_verifier + refresh_token + access_token + code params", () => {
    const s = "invalid_grant: code=4/0Adeu5BWzExample&code_verifier=verifier-secret-abc&refresh_token=rt-abc-123&access_token=tok-xyz";
    const out = redactApiKeys(s);
    expect(out).not.toContain("4/0Adeu5BWzExample");
    expect(out).not.toContain("verifier-secret-abc");
    expect(out).not.toContain("rt-abc-123");
    expect(out).not.toContain("tok-xyz");
    expect(out).toContain("code=[masqué]");
    expect(out).toContain("code_verifier=[masqué]");
    expect(out).toContain("refresh_token=[masqué]");
    expect(out).toContain("access_token=[masqué]");
  });

  it("leaves ordinary OAuth error strings readable", () => {
    expect(redactApiKeys("invalid_grant: token expired")).toBe("invalid_grant: token expired");
  });
});


// ── Validation of AI output ─────────────────────────────────────
// The model occasionally returns garbage (oversized text, refusal
// phrases, out-of-range Force, "abc" in agingMax). We assert these
// values are filtered before being merged into the form so the user's
// existing values are preserved instead of being clobbered.

describe("useAiAutoFill — output validation", () => {
  function setupOpenAi(payload: any) {
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-test");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    });
    globalThis.fetch = fetchSpy as any;
  }

  it("clamps Force/RoomNote/Taste >5 down to 5", async () => {
    setupOpenAi({ force: 12, room_note: 99, taste: -3 });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", force: 0, roomNote: 0, taste: 0 },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", force: 0, roomNote: 0, taste: 0 });
    expect(next.force).toBe(5);
    expect(next.roomNote).toBe(5);
    expect(next.taste).toBe(0);
  });

  it("ignores an absurdly long description (>4000 chars)", async () => {
    const huge = "x".repeat(5000);
    setupOpenAi({ description: huge });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", description: "Original notes" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", description: "Original notes" });
    expect(next.description).toBe("Original notes");
  });

  it("ignores AI refusal phrases in the name field", async () => {
    setupOpenAi({ name: "I cannot find any information about this tobacco." });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall" });
    expect(next.name).toBe("Duskfall");
  });

  it("ignores AI refusal phrases in French (Désolé, Je ne peux pas)", async () => {
    setupOpenAi({ description: "Désolé, je n'ai pas d'informations sur ce blend." });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", description: "Mes notes" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", description: "Mes notes" });
    expect(next.description).toBe("Mes notes");
  });

  it("rejects non-numeric agingMax", async () => {
    setupOpenAi({ aging_max_years: "indéterminé" });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", agingMax: "12" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", agingMax: "12" });
    expect(next.agingMax).toBe("12");
  });

  it("accepts agingMax in the N-M range format", async () => {
    setupOpenAi({ aging_max_years: "10-15" });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", agingMax: "" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", agingMax: "" });
    expect(next.agingMax).toBe("10-15");
  });

  it("rejects an out-of-range agingMax (>100)", async () => {
    setupOpenAi({ aging_max_years: "9999" });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", agingMax: "5" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", agingMax: "5" });
    expect(next.agingMax).toBe("5");
  });

  it("strips an oversized brand (>100 chars)", async () => {
    setupOpenAi({ brand: "x".repeat(150) });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall" });
    expect(next.brand).toBe("Halvorsen");
  });

  // Anthropic's web-search tool occasionally returns
  // citation tags like <cite index="8-1">…</cite> inline. Strip them
  // so the form gets clean text instead of HTML in the visible
  // description / blend fields.
  it("strips Anthropic web-search citation tags from description", async () => {
    setupOpenAi({
      description: "A Virginia <cite index=\"8-1\">flake</cite> with hints of Perique.",
    });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Duskfall", description: "" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Duskfall", description: "" });
    expect(next.description).not.toMatch(/<\/?cite/i);
    expect(next.description).toBe("A Virginia flake with hints of Perique.");
  });

  it("decodes common HTML entities and strips arbitrary tags", async () => {
    setupOpenAi({
      blend: "Virginia &amp; Perique <span class=\"x\">blend</span>",
    });
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        form: { brand: "Halvorsen", name: "Early Tide", blend: "" },
        setForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("tobacco"); });
    const updater = setForm.mock.calls[setForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Early Tide", blend: "" });
    expect(next.blend).toBe("Virginia & Perique blend");
  });
});

// ── pipe finish auto-fill ────────────────────────────────────
// The pipe AI parse now reads `info.finish` and applies it when the value is
// one of FINISHES (Lisse / Rustiquée / Sablée / Autre). Off-list values keep
// the user's existing finish — same validated-against-enum model as bowl /
// stem material.

describe("useAiAutoFill — pipe finish", () => {
  function setupPipeOpenAi(payload: any) {
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-test");
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    }) as any;
  }

  it("applies a valid FR finish value from the AI", async () => {
    setupPipeOpenAi({ finish: "Sablée" });
    const setPipeForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        pipeForm: { brand: "Halvorsen", name: "Shell", finish: "" },
        setPipeForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("pipe"); });
    const updater = setPipeForm.mock.calls[setPipeForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Shell", finish: "" });
    expect(next.finish).toBe("Sablée");
  });

  it("keeps the existing finish when the AI returns an off-list value", async () => {
    setupPipeOpenAi({ finish: "Polished glossy" });
    const setPipeForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        pipeForm: { brand: "Halvorsen", name: "Shell", finish: "Lisse" },
        setPipeForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("pipe"); });
    const updater = setPipeForm.mock.calls[setPipeForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Shell", finish: "Lisse" });
    expect(next.finish).toBe("Lisse");
  });

  it("leaves finish untouched when the AI omits the field", async () => {
    setupPipeOpenAi({ shape: "Billiard" });
    const setPipeForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(defaultProps({
        pipeForm: { brand: "Halvorsen", name: "Shell", finish: "Rustiquée" },
        setPipeForm,
      })),
    );
    await act(async () => { await result.current.aiAutoFill("pipe"); });
    const updater = setPipeForm.mock.calls[setPipeForm.mock.calls.length - 1]![0];
    const next = updater({ brand: "Halvorsen", name: "Shell", finish: "Rustiquée" });
    expect(next.finish).toBe("Rustiquée");
  });
});

// ── aiScanLabel chains the full auto-fill ─────────────────────
// jsdom has no real canvas/Image decode — stub the three browser APIs
// the scaling helper touches so the hook-level chain is exercised
// end-to-end: scan response → brand/name applied → SECOND fetch with
// the query built from the SCAN RESULT (not the stale form closure).

describe("aiScanLabel — auto-chain", () => {
  let origImage: any;
  let origGetContext: any;
  let origToDataURL: any;

  beforeEach(() => {
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    origImage = globalThis.Image;
    (globalThis as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 800; height = 600;
      set src(_v: string) {
        setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
    };
    origGetContext = HTMLCanvasElement.prototype.getContext;
    origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    (HTMLCanvasElement.prototype as any).getContext = () => ({ drawImage: () => {} });
    (HTMLCanvasElement.prototype as any).toDataURL = () => "data:image/jpeg;base64,QUJD";
  });

  afterEach(() => {
    (globalThis as any).Image = origImage;
    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLCanvasElement.prototype.toDataURL = origToDataURL;
  });

  it("applies scan fields then fires the chained web search with the scanned query", async () => {
    const fetchSpy = vi.fn()
      // 1st call: the vision scan.
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          content: [{ type: "text", text: '{"brand":"Halvorsen","name":"Duskfall","blend":""}' }],
        }),
      })
      // 2nd call: the chained auto-fill.
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          content: [{ type: "text", text: '{"brand":"Halvorsen","name":"Duskfall","category":"Anglais","cut":"Ribbon","force":4,"room_note":3,"taste":4,"aging_max_years":"10","blend":"Virginia, Latakia","description":"Classique du soir."}' }],
        }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const setForm = vi.fn();
    const { result } = renderHook(() => useAiAutoFill(defaultProps({ setForm })));
    const file = new File(["x"], "tin.jpg", { type: "image/jpeg" });
    await act(async () => {
      result.current.aiScanLabel("tobacco", file);
      // Drain: FileReader onload → Image onload (setTimeout 0) → fetch
      // chain. A few macrotask hops cover it.
      await new Promise(r => setTimeout(r, 50));
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Scan fields applied (functional update — run it to inspect).
    const scanApply = setForm.mock.calls[0]![0];
    expect(scanApply({ brand: "", name: "", blend: "" })).toMatchObject({
      brand: "Halvorsen", name: "Duskfall",
    });
    // Chained request: query built from the SCAN result.
    const secondBody = JSON.parse(fetchSpy.mock.calls[1]![1].body);
    const userMsg = JSON.stringify(secondBody.messages);
    expect(userMsg).toContain("Halvorsen Duskfall pipe tobacco");
    // And the autofill application landed too (2nd setForm call).
    const fillApply = setForm.mock.calls[1]![0];
    expect(fillApply({ brand: "Halvorsen", name: "Duskfall", blend: "", category: "", cut: "", force: 0, roomNote: 0, taste: 0, agingMax: "", description: "" }).category).toBe("Anglais");
    // Spinner cleared at the end of the chain.
    expect(result.current.aiLoad).toBe(false);
    vi.unstubAllGlobals();
  });

  it("a failed scan surfaces the error and never fires the chained search", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({
        content: [{ type: "text", text: "Je ne vois pas d'étiquette." }],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const setForm = vi.fn();
    const { result } = renderHook(() => useAiAutoFill(defaultProps({ setForm })));
    await act(async () => {
      result.current.aiScanLabel("tobacco", new File(["x"], "t.jpg", { type: "image/jpeg" }));
      await new Promise(r => setTimeout(r, 50));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(setForm).not.toHaveBeenCalled();
    expect(result.current.aiErr).toBe("ai_scan_unreadable");
    expect(result.current.aiLoad).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("runAutoFill — degenerate query short-circuit", () => {
  // The `q.length < 3` guard in runAutoFill is defensive — in practice
  // it's unreachable from every public call site because the form
  // path always appends " pipe tobacco" / " pipe" (≥ 4 chars after
  // trim) and the scan-chain path builds its query the same way. The
  // dead branch is kept to fail safe if a future caller passes a
  // sub-3 qOverride. Lock that today the shortest reachable query
  // ("pipe", from an empty pipe form) goes through so a regression
  // accidentally tripping the guard would surface as a missing fetch.
  it("the shortest reachable query ('pipe') still fires the request", async () => {
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: '{"name":"","brand":""}' }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      pipeForm: { brand: "", name: "" },
    })));
    await act(async () => {
      result.current.aiAutoFill("pipe");
      await new Promise(r => setTimeout(r, 10));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.aiLoad).toBe(false);
    vi.unstubAllGlobals();
  });
});

// ── model catalogue refresh + legacy-id normalisation ──────
// The chosen model id is persisted per provider for ever, so refreshing the
// curated option list is only safe if a stored superseded id still resolves to
// something the picker can show and the API accepts. These tests lock BOTH
// halves: the list itself (a swap must be conscious) and the alias mapping.
describe("AI model catalogue", () => {
  beforeEach(() => localStorage.clear());

  it("offers the current Anthropic tiers, cheapest first, with exact ids", () => {
    // Exact ids — never a date-suffixed snapshot (the dated Haiku id shipped
    // And is now an alias, see below).
    expect(AI_MODEL_OPTIONS.anthropic).toEqual([
      { id: "auto", label: "Auto" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      { id: "claude-sonnet-5", label: "Sonnet 5" },
      { id: "claude-opus-5", label: "Opus 5" },
    ]);
    for (const o of AI_MODEL_OPTIONS.anthropic!) {
      expect(o.id).not.toMatch(/-\d{8}$/);
    }
  });

  it("offers the current OpenAI + Gemini tiers (both were retired upstream)", () => {
    // gpt-4o* left OpenAI's model list and gemini-2.0-flash was SHUT DOWN on
    // 2026-03-03 — the old lists produced failing requests, not just dated
    // ones. Cheapest tier first in each.
    expect(AI_MODEL_OPTIONS.openai!.map((o) => o.id))
      .toEqual(["auto", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
    expect(AI_MODEL_OPTIONS.gemini!.map((o) => o.id))
      .toEqual(["auto", "gemini-3.5-flash-lite", "gemini-3.6-flash"]);
    // No retired id may be OFFERED any more, in any provider list.
    const retired = ["gpt-4o", "gpt-4o-mini", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
    const offered = Object.keys(AI_MODEL_OPTIONS)
      .flatMap((p) => (AI_MODEL_OPTIONS[p] || []).map((o) => o.id));
    for (const dead of retired) expect(offered).not.toContain(dead);
  });

  it("defaults to auto, which RESOLVES to the cheapest tier (Haiku on Claude)", () => {
    // The stored default is the sentinel, so a future list refresh
    // moves a fresh install forward instead of stranding a frozen id. What
    // actually runs is still the cheap tier.
    expect(defaultAiModel("anthropic")).toBe("auto");
    expect(defaultAiModel("openai")).toBe("auto");
    expect(defaultAiModel("gemini")).toBe("auto");
    expect(defaultAiModel("nope")).toBe("auto");
    expect(resolveAiModel("anthropic", defaultAiModel("anthropic"))).toBe("claude-haiku-4-5");
    expect(resolveAiModel("openai", defaultAiModel("openai"))).toBe("gpt-5.6-luna");
    expect(resolveAiModel("gemini", defaultAiModel("gemini"))).toBe("gemini-3.5-flash-lite");
  });

  it("every alias target is a real option — an alias can't strand the picker", () => {
    const known = new Set(
      Object.keys(AI_MODEL_OPTIONS).flatMap((p) => (AI_MODEL_OPTIONS[p] || []).map((o) => o.id)),
    );
    for (const from of Object.keys(AI_MODEL_ALIASES)) {
      expect(known.has(AI_MODEL_ALIASES[from]!)).toBe(true);
      // A stale id must not ALSO be offered, or the list would show both.
      expect(known.has(from)).toBe(false);
    }
  });

  it("normalizeAiModel maps the shipped legacy ids and passes everything else through", () => {
    expect(normalizeAiModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeAiModel("claude-opus-4-8")).toBe("claude-opus-5");
    expect(normalizeAiModel("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeAiModel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    // Empty / garbage → "" so the caller falls back to the provider default.
    expect(normalizeAiModel("")).toBe("");
    expect(normalizeAiModel(null)).toBe("");
    expect(normalizeAiModel(undefined)).toBe("");
    expect(normalizeAiModel("  claude-opus-4-8  ")).toBe("claude-opus-5");
  });

  it("maps every retired OpenAI / Gemini id onto a current tier", () => {
    expect(normalizeAiModel("gpt-4o-mini")).toBe("gpt-5.6-luna");
    expect(normalizeAiModel("gpt-4o")).toBe("gpt-5.6-terra");
    expect(normalizeAiModel("gemini-2.0-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeAiModel("gemini-2.5-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeAiModel("gemini-2.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(normalizeAiModel("gemini-2.5-pro")).toBe("gemini-3.6-flash");
  });

  it("never aliases across providers — a swap must stay in its own family", () => {
    // A cross-provider alias would send an OpenAI id to Anthropic (or vice
    // versa) and 404 with a baffling message.
    const family = (id: string) =>
      id.startsWith("claude-") ? "anthropic" : id.startsWith("gpt-") ? "openai" : "gemini";
    for (const from of Object.keys(AI_MODEL_ALIASES)) {
      expect(family(AI_MODEL_ALIASES[from]!)).toBe(family(from));
    }
  });

  it("is prototype-safe: a forged stored id can't resolve to Object.prototype", () => {
    // The key comes from localStorage, so a plain-object map would return a
    // truthy non-model here and ship it as the request's `model`.
    expect(normalizeAiModel("__proto__")).toBe("__proto__");
    expect(normalizeAiModel("constructor")).toBe("constructor");
    expect(normalizeAiModel("toString")).toBe("toString");
  });

  it("a legacy stored id is normalised on read (initial state)", () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("ai-model-anthropic", "claude-opus-4-8");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.aiModel).toBe("claude-opus-5");
  });

  it("a legacy stored id is normalised when switching back to that provider", () => {
    localStorage.setItem("ai-provider", "openai");
    // A DELIBERATE legacy choice (Opus 4.8), not a former default — a former
    // default would be rewritten to "auto" by the migration, which is
    // its own test; this one is about the alias normalisation on switch.
    localStorage.setItem("ai-model-anthropic", "claude-opus-4-8");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => { result.current.saveAiProvider("anthropic"); });
    expect(result.current.aiModel).toBe("claude-opus-5");
  });

  it("saveAiModel persists the canonical id, not the legacy one", () => {
    localStorage.setItem("ai-provider", "anthropic");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    act(() => { result.current.saveAiModel("claude-opus-4-8"); });
    expect(result.current.aiModel).toBe("claude-opus-5");
    expect(localStorage.getItem("ai-model-anthropic")).toBe("claude-opus-5");
    // Blank still falls back to the provider default (pre-existing contract),
    // which is the auto sentinel.
    act(() => { result.current.saveAiModel("   "); });
    expect(localStorage.getItem("ai-model-anthropic")).toBe("auto");
  });

  it("the normalised id reaches the wire (a legacy stored id never ships)", async () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    localStorage.setItem("ai-model-anthropic", "claude-opus-4-8");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ content: [{ type: "text", text: '{"name":"","brand":""}' }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 10));
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body.model).toBe("claude-opus-5");
    vi.unstubAllGlobals();
  });
});

// ── the OpenAI output-cap parameter ────────────────────────
// GPT-5 and the o-series REJECT `max_tokens` on Chat Completions. Moving the
// option list to gpt-5.6 without switching the field would have turned every
// OpenAI request into a 400 — a silent break of the whole provider, so this
// is locked at the pure-helper level AND on the wire.
describe("openaiMaxTokensField", () => {
  it("sends max_completion_tokens for the GPT-5+ / o-series families", () => {
    for (const m of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5", "o3", "o4-mini"]) {
      expect(openaiMaxTokensField(m, 300)).toEqual({ max_completion_tokens: 300 });
    }
  });

  it("keeps max_tokens for the legacy 4o / 4.1 era ids (they know only that)", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-3.5-turbo"]) {
      expect(openaiMaxTokensField(m, 512)).toEqual({ max_tokens: 512 });
    }
  });

  it("falls back to max_tokens on a blank / garbage model", () => {
    expect(openaiMaxTokensField("", 10)).toEqual({ max_tokens: 10 });
    expect(openaiMaxTokensField(undefined as any, 10)).toEqual({ max_tokens: 10 });
  });

  it("every OFFERED OpenAI model takes max_completion_tokens", () => {
    // If a future list adds a model that needs the legacy field, this fails
    // and forces the request builder to be re-checked.
    for (const o of AI_MODEL_OPTIONS.openai!) {
      if (o.id === AI_MODEL_AUTO) continue; // sentinel, never on the wire
      expect(openaiMaxTokensField(o.id, 1)).toEqual({ max_completion_tokens: 1 });
    }
  });

  it("the autofill request carries max_completion_tokens, never max_tokens", async () => {
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-test");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 10));
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

// ── a dead model says so, in the user's words ──────────────
// gemini-2.0-flash — the app's own Gemini default — was four months dead
// before anyone noticed, because the UI showed the raw provider sentence
// ("models/gemini-2.0-flash is not found for API version v1beta"). The
// strings below are the REAL wire messages from the three providers.
describe("isModelGoneError", () => {
  const DEAD = [
    // Anthropic 404
    "model: claude-opus-4-1",
    "not_found_error: model: claude-x",
    // OpenAI 404
    "The model `gpt-4o` does not exist or you do not have access to it.",
    "model_not_found",
    // Gemini 404 — the exact sentence that hid the March outage
    "models/gemini-2.0-flash is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models.",
    "Model gemini-1.5-pro has been deprecated",
    // Model ids are full of dots — an earlier version of the detector used a
    // dot-excluding gap and could not match ANY real message. Keep a dotted
    // id in every shape below.
    "The model `gpt-5.6-luna` does not exist or you do not have access to it.",
    "models/gemini-3.5-flash-lite is not found for API version v1beta",
  ];
  const ALIVE = [
    "",
    "Failed to fetch",
    "rate_limit_error: Number of request tokens has exceeded your per-minute rate limit",
    "overloaded_error",
    "invalid_api_key: Incorrect API key provided",
    "Internal server error",
    // A blend the catalogue does not know is NOT a model problem — the word
    // "not found" alone must not trip this.
    "Duskfall not found in the reference catalogue",
    "insufficient_quota: You exceeded your current quota",
  ];

  it("recognises every provider's retired-model message", () => {
    for (const m of DEAD) expect(isModelGoneError(m), m).toBe(true);
  });

  it("does NOT fire on transient / auth / unrelated failures", () => {
    for (const m of ALIVE) expect(isModelGoneError(m), m).toBe(false);
  });

  it("reads an Error object as well as a string, and tolerates junk", () => {
    expect(isModelGoneError(new Error("model_not_found"))).toBe(true);
    expect(isModelGoneError(new Error("Failed to fetch"))).toBe(false);
    expect(isModelGoneError(null)).toBe(false);
    expect(isModelGoneError(undefined)).toBe(false);
    expect(isModelGoneError({})).toBe(false);
    expect(isModelGoneError(42)).toBe(false);
  });

  it("surfaces the friendly message instead of the provider sentence", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-test");
    localStorage.setItem("ai-model-gemini", "gemini-3.6-flash"); // PINNED
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        error: { code: 404, status: "NOT_FOUND", message: "models/gemini-2.0-flash is not found for API version v1beta, or is not supported for generateContent." },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    // `t` is identity in these tests, so the KEY proves the mapping ran.
    expect(result.current.aiErr).toBe("ai_err_model_gone");
    expect(result.current.aiErr).not.toContain("v1beta");
    expect(result.current.aiLoad).toBe(false);
    vi.unstubAllGlobals();
  });

  it("is NOT swallowed by the catalogue fallback (a config error must show)", async () => {
    // The catalogue fallback exists for transient failures. A retired model
    // fails on every future call, so a silent catalogue fill would leave the
    // user permanently mis-configured — the error has to reach them.
    localStorage.setItem("ai-provider", "openai");
    localStorage.setItem("openai-api-key", "sk-test");
    localStorage.setItem("ai-model-openai", "gpt-5.6-terra"); // PINNED
    localStorage.setItem("cave-autofill-source", "ai");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        error: { code: "model_not_found", message: "The model `gpt-4o` does not exist or you do not have access to it." },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const setForm = vi.fn();
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" }, setForm,
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.aiErr).toBe("ai_err_model_gone");
    vi.unstubAllGlobals();
  });

  it("a transient failure still keeps its own message (no over-reach)", async () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "overloaded_error: Overloaded" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.aiErr).not.toBe("ai_err_model_gone");
    vi.unstubAllGlobals();
  });
});

// ── "Auto" — the user delegates the model choice ───────────
// It resolves to the cheapest CURATED tier at request time (never a call to
// the provider's model-list endpoint, which returns embeddings/TTS/fine-tunes
// with no capability metadata and could land on a frontier model at 5× the
// price). A model retired upstream is remembered as dead and skipped after
// exactly one failed call — the self-healing the Gemini outage lacked.
describe("auto model selection", () => {
  beforeEach(() => localStorage.clear());

  it("is offered FIRST for every provider (cheapest-first ordering)", () => {
    for (const p of Object.keys(AI_MODEL_OPTIONS)) {
      expect(AI_MODEL_OPTIONS[p]![0]!.id, p).toBe(AI_MODEL_AUTO);
      expect(AI_MODEL_OPTIONS[p]![0]!.label).toBe("Auto");
    }
  });

  it("resolves to the cheapest concrete tier of the provider", () => {
    expect(resolveAiModel("anthropic", AI_MODEL_AUTO)).toBe("claude-haiku-4-5");
    expect(resolveAiModel("openai", AI_MODEL_AUTO)).toBe("gpt-5.6-luna");
    expect(resolveAiModel("gemini", AI_MODEL_AUTO)).toBe("gemini-3.5-flash-lite");
  });

  it("never returns the sentinel itself — that would 404 on the wire", () => {
    for (const p of Object.keys(AI_MODEL_OPTIONS)) {
      expect(resolveAiModel(p, AI_MODEL_AUTO)).not.toBe(AI_MODEL_AUTO);
      expect(resolveAiModel(p, "")).not.toBe(AI_MODEL_AUTO);
      expect(resolveAiModel(p, null)).not.toBe(AI_MODEL_AUTO);
      // even when every option is known-dead, we still attempt something
      const allDead = AI_MODEL_OPTIONS[p]!.map((o) => o.id);
      expect(resolveAiModel(p, AI_MODEL_AUTO, allDead)).not.toBe(AI_MODEL_AUTO);
      expect(resolveAiModel(p, AI_MODEL_AUTO, allDead)).toBeTruthy();
    }
  });

  it("skips a known-dead model and steps to the next tier", () => {
    expect(resolveAiModel("gemini", AI_MODEL_AUTO, ["gemini-3.5-flash-lite"]))
      .toBe("gemini-3.6-flash");
    expect(resolveAiModel("anthropic", AI_MODEL_AUTO, ["claude-haiku-4-5"]))
      .toBe("claude-sonnet-5");
    expect(resolveAiModel("anthropic", AI_MODEL_AUTO, ["claude-haiku-4-5", "claude-sonnet-5"]))
      .toBe("claude-opus-5");
  });

  it("a PINNED model wins over auto and is still normalised", () => {
    expect(resolveAiModel("anthropic", "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveAiModel("anthropic", "claude-opus-4-8")).toBe("claude-opus-5");
    // a pinned choice is NOT overridden by the dead list — the user asked for
    // that model, so they must see the real error, not a silent substitution.
    expect(resolveAiModel("anthropic", "claude-sonnet-5", ["claude-sonnet-5"]))
      .toBe("claude-sonnet-5");
  });

  it("the resolved id — not 'auto' — reaches the wire", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-test");
    localStorage.setItem("ai-model-gemini", AI_MODEL_AUTO);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    expect(result.current.aiModelResolved).toBe("gemini-3.5-flash-lite");
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(url).not.toContain("auto");
    vi.unstubAllGlobals();
  });

  it("records the dead model under auto, so the NEXT call skips it", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-test");
    localStorage.setItem("ai-model-gemini", AI_MODEL_AUTO);
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        error: { code: 404, status: "NOT_FOUND", message: "models/gemini-3.5-flash-lite is not found for API version v1beta" },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    // Auto-specific copy: there is nothing for the user to reconfigure.
    expect(result.current.aiErr).toBe("ai_err_model_auto");
    expect(JSON.parse(localStorage.getItem(deadModelsKey("gemini"))!))
      .toContain("gemini-3.5-flash-lite");
    // A fresh mount now resolves past the dead tier — self-healed.
    const { result: r2 } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(r2.current.aiModelResolved).toBe("gemini-3.6-flash");
    vi.unstubAllGlobals();
  });

  it("a PINNED dead model keeps the actionable message and records nothing", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-test");
    localStorage.setItem("ai-model-gemini", "gemini-3.6-flash");
    const fetchSpy = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: { status: "NOT_FOUND", message: "models/gemini-3.6-flash is not found" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps({
      form: { brand: "Halvorsen", name: "Duskfall" },
    })));
    await act(async () => {
      result.current.aiAutoFill("tobacco");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.aiErr).toBe("ai_err_model_gone");
    expect(localStorage.getItem(deadModelsKey("gemini"))).toBeNull();
    vi.unstubAllGlobals();
  });

  it("a corrupt dead-list degrades to 'nothing is dead'", () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem(deadModelsKey("anthropic"), "{not json");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(result.current.aiModelResolved).toBe("claude-haiku-4-5");
  });
});

// ── put an EXISTING device on auto, without overriding intent ─
describe("auto migration", () => {
  beforeEach(() => localStorage.clear());

  it("lists no stale / mistyped id — a typo here silently fails to migrate", () => {
    // AI_FORMER_DEFAULTS must name real ids: either a currently-offered option
    // or a known alias source. A typo would leave devices pinned for ever with
    // nothing to signal it. NOTE for a future default change: the OLD default
    // has to be added to this list, or devices holding it never migrate.
    const offered = new Set(Object.keys(AI_MODEL_OPTIONS)
      .flatMap((p) => (AI_MODEL_OPTIONS[p] || []).map((o) => o.id)));
    const aliasSources = new Set(Object.keys(AI_MODEL_ALIASES));
    for (const id of AI_FORMER_DEFAULTS) {
      expect(offered.has(id) || aliasSources.has(id), id).toBe(true);
    }
  });

  it("treats a former default (or nothing) as 'not a deliberate choice'", () => {
    for (const id of ["claude-haiku-4-5-20251001", "claude-haiku-4-5",
                      "gpt-4o-mini", "gpt-5.6-luna",
                      "gemini-2.0-flash", "gemini-3.5-flash-lite", "", null]) {
      expect(isFormerDefaultModel(id as any), String(id)).toBe(true);
    }
  });

  it("leaves a DELIBERATE choice alone — including auto itself", () => {
    // Someone who picked Sonnet or Opus expressed an intent; moving them to
    // the cheapest tier would be exactly the silent substitution the alias
    // rules refuse elsewhere.
    for (const id of ["claude-sonnet-5", "claude-opus-5",
                      "gpt-5.6-terra", "gpt-5.6-sol", "gemini-3.6-flash", "auto"]) {
      expect(isFormerDefaultModel(id), id).toBe(false);
    }
  });

  it("migrates a stored former default to auto, once", () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("ai-model-anthropic", "claude-haiku-4-5-20251001");
    localStorage.setItem("ai-model-gemini", "gemini-2.0-flash");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(localStorage.getItem("ai-model-anthropic")).toBe("auto");
    expect(localStorage.getItem("ai-model-gemini")).toBe("auto");
    expect(result.current.aiModel).toBe("auto");
    expect(localStorage.getItem(AI_AUTO_MIGRATED_KEY)).toBe("1");
  });

  it("does NOT migrate a deliberate choice", () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("ai-model-anthropic", "claude-opus-5");
    renderHook(() => useAiAutoFill(defaultProps()));
    expect(localStorage.getItem("ai-model-anthropic")).toBe("claude-opus-5");
  });

  it("never re-fires: a later pick of the cheapest tier sticks", () => {
    // Without the guard flag, choosing Haiku on purpose after the migration
    // would be flipped back to auto on the next launch, for ever.
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("ai-model-anthropic", "claude-haiku-4-5");
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    expect(localStorage.getItem("ai-model-anthropic")).toBe("claude-haiku-4-5");
    expect(result.current.aiModel).toBe("claude-haiku-4-5");
  });
});

// ── liveness probe at the moment of choice ─────────────────
describe("buildModelProbeRequest", () => {
  it("is a plain metadata GET per provider, keyed like the real calls", () => {
    const a = buildModelProbeRequest("anthropic", "sk-ant", "claude-haiku-4-5");
    expect(a.url).toBe("https://api.anthropic.com/v1/models/claude-haiku-4-5");
    expect(a.init.method).toBe("GET");
    expect(a.init.headers["x-api-key"]).toBe("sk-ant");
    expect(a.init.headers["anthropic-version"]).toBe("2023-06-01");

    const o = buildModelProbeRequest("openai", "sk-o", "gpt-5.6-luna");
    expect(o.url).toBe("https://api.openai.com/v1/models/gpt-5.6-luna");
    expect(o.init.headers.Authorization).toBe("Bearer sk-o");

    const g = buildModelProbeRequest("gemini", "AIza", "gemini-3.6-flash");
    expect(g.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash");
    // The key stays in the HEADER, never the URL (same rule as every call).
    expect(g.url).not.toContain("AIza");
    expect(g.init.headers["x-goog-api-key"]).toBe("AIza");
  });

  it("carries no body — it must never generate tokens", () => {
    for (const p of ["anthropic", "openai", "gemini"]) {
      const r = buildModelProbeRequest(p, "k", "m");
      expect(r.init.body).toBeUndefined();
      expect(r.init.method).toBe("GET");
    }
  });

  it("URL-encodes the id (a forged stored value can't escape the path)", () => {
    expect(buildModelProbeRequest("openai", "k", "../../secret").url)
      .toBe("https://api.openai.com/v1/models/..%2F..%2Fsecret");
  });
});

describe("probeModel", () => {
  beforeEach(() => localStorage.clear());

  it("reports ok on a 200 and names the resolved model", async () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    localStorage.setItem("ai-model-anthropic", "auto");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    await act(async () => { result.current.probeModel(); await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.modelProbe).toEqual({ state: "ok", model: "claude-haiku-4-5" });
    vi.unstubAllGlobals();
  });

  it("a 404 means gone — and under auto it records the dead model", async () => {
    localStorage.setItem("ai-provider", "gemini");
    localStorage.setItem("gemini-api-key", "AIza-test");
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    localStorage.setItem("ai-model-gemini", "auto");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    await act(async () => { result.current.probeModel(); await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.modelProbe!.state).toBe("gone");
    expect(JSON.parse(localStorage.getItem(deadModelsKey("gemini"))!))
      .toContain("gemini-3.5-flash-lite");
    vi.unstubAllGlobals();
  });

  it("a 401/429/500 is NOT a verdict on the model", async () => {
    // Reporting "ce modèle ne répond plus" for a bad key or a rate limit would
    // send the user changing the wrong setting.
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    for (const status of [401, 403, 429, 500]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
      const { result } = renderHook(() => useAiAutoFill(defaultProps()));
      await act(async () => { result.current.probeModel(); await new Promise((r) => setTimeout(r, 10)); });
      expect(result.current.modelProbe!.state, String(status)).toBe("error");
      expect(localStorage.getItem(deadModelsKey("anthropic"))).toBeNull();
      vi.unstubAllGlobals();
    }
  });

  it("does nothing without a key — there is nothing to check against", async () => {
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    await act(async () => { result.current.probeModel(); });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.modelProbe).toBeNull();
    vi.unstubAllGlobals();
  });

  it("picking a model verifies it immediately (point of choice, not next search)", async () => {
    localStorage.setItem("ai-provider", "anthropic");
    localStorage.setItem("anthropic-api-key", "sk-ant-test");
    localStorage.setItem(AI_AUTO_MIGRATED_KEY, "1");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAiAutoFill(defaultProps()));
    await act(async () => {
      result.current.saveAiModel("claude-sonnet-5");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/v1/models/claude-sonnet-5");
    expect(result.current.modelProbe).toEqual({ state: "ok", model: "claude-sonnet-5" });
    vi.unstubAllGlobals();
  });
});
