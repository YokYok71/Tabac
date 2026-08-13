// The auto-fill default is the CATALOGUE, and the "API selected but no key"
// fallback is LOCKED rather than assumed.
//
// Two rules:
//   (a) by default, go through the catalogue and not the API;
//   (b) if API is selected, go there only when a key is configured.
//
// (b) has always been true — `runAutoFill`'s AI-first branch drops straight to
// `tobaccoDbLookup` when `!apiKey`. It went uncovered for a long time, and
// that is exactly how its companion defect survived: the catalogue OFFER
// banner was suppressed on every fresh install for months while the underlying
// behaviour was correct, because no test ever asked what the button actually
// does. Hence cases for (b), not just a re-reading of the source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, act, waitFor } from "@testing-library/react";

const lookup = vi.fn();
// Mirrors the module's REAL export surface — three stale names
// (`loadTobaccoCatalogue`, `tobaccoDbFailKind`, `ensureLangDescriptions`) were
// left here after the bundled-catalogue removal deleted them. A mock that
// invents exports is a mock that can keep passing over a module it no longer
// resembles.
vi.mock("../utils/tobaccoDb.ts", () => ({
  loadTobaccoDb: () => Promise.resolve({}),
  tobaccoDbInvalidate: () => {},
  tobaccoDbLookup: (...a: any[]) => lookup(...a),
  tobaccoDbLookupSync: () => null,
  tobaccoDbCanonicalKey: () => null,
  tobaccoDbSearchMatch: () => false,
  displayAliases: () => [],
  isTobaccoDbReady: () => true,
  tobaccoDbSize: () => 0,
  _resetTobaccoDbForTests: () => {},
}));

import { useAiAutoFill } from "../hooks/useAiAutoFill";

const HIT = {
  brand: "Halvorsen", name: "Duskfall", category: "Anglais", cut: "Ready Rubbed",
  blend: "Virginia, Latakia, Perique", force: 4, roomNote: 3, taste: 4,
  agingMax: "", description: "A classic English blend.",
};

function makeProps(over: Record<string, any> = {}) {
  return {
    form: { brand: "Halvorsen", name: "Duskfall" },
    setForm: vi.fn(),
    wishForm: {}, setWishForm: vi.fn(),
    pipeForm: {}, setPipeForm: vi.fn(),
    t: (k: string) => k,
    lang: "fr",
    weightUnit: "g", lengthUnit: "mm",
    ...over,
  };
}

let fetchSpy: any;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  lookup.mockResolvedValue(HIT);
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve({ content: [{ type: "text", text: "{}" }] }),
  });
  (globalThis as any).fetch = fetchSpy;
});
afterEach(() => { localStorage.clear(); });

// ── (a) the DEFAULT ──────────────────────────────────────────────────────────

describe("the shipped default is the catalogue", () => {
  it("App.tsx reads an ABSENT preference as 'local'", () => {
    // The initialiser, read at source: it is a one-liner and the whole change,
    // and driving App.tsx here would mean mounting the entire application.
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).toContain('localStorage.getItem("cave-autofill-source") === "ai" ? "ai" : "local"');
    // …and NOT the earlier shape, which read an absent value as "ai".
    expect(src).not.toContain('localStorage.getItem("cave-autofill-source") === "local" ? "local" : "ai"');
  });

  it("a stored 'ai' still wins — a deliberate pick is not a default", () => {
    // The `ai-model-auto-migrated` rule: a default may move, a choice may
    // not. `saveAutofillSource` writes only on change, so anyone who has ever
    // touched the Segmented keeps their pick.
    const src = readFileSync("src/App.tsx", "utf8");
    const init = src.match(/getItem\("cave-autofill-source"\)[^,\n]*/)![0];
    expect(init).toContain('=== "ai" ? "ai"');
  });

  it("no stale rationale survives in the comment", () => {
    // It used to say the default was "ai" *while the catalogue is being
    // re-validated against smokingpipes* — a condition that no longer exists
    // now that the catalogue is the user's own file. A sentence like that
    // sends the next reader looking for work that cannot be done.
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).not.toMatch(/being re-validated against\s*\n?\s*\/\/\s*smokingpipes/);
    expect(src).not.toContain("~550 popular blends");
  });

  it("Settings no longer advertises ~550 blends either", () => {
    const src = readFileSync("src/views/curator/SettingsModal.tsx", "utf8");
    expect(src).not.toContain("~550 popular blends");
  });
});

// ── (b) "API selected" only reaches the API when a key exists ────────────────

describe("the API is only called when a key is configured", () => {
  it("source 'ai' + NO key → the catalogue answers, and nothing is fetched", async () => {
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useAiAutoFill(makeProps({ autofillSource: "ai", setForm }) as any));
    act(() => { result.current.aiAutoFill("tobacco"); });
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(fetchSpy, "no key means no provider call").not.toHaveBeenCalled();
    await waitFor(() => expect(setForm).toHaveBeenCalled());
  });

  it("source 'ai' + a key → the provider IS called", async () => {
    localStorage.setItem("anthropic-api-key", "sk-real");
    const { result } = renderHook(() =>
      useAiAutoFill(makeProps({ autofillSource: "ai" }) as any));
    act(() => { result.current.aiAutoFill("tobacco"); });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("source 'local' → the catalogue first, key or not", async () => {
    localStorage.setItem("anthropic-api-key", "sk-real");
    const { result } = renderHook(() =>
      useAiAutoFill(makeProps({ autofillSource: "local" }) as any));
    act(() => { result.current.aiAutoFill("tobacco"); });
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(fetchSpy, "a catalogue HIT must not then call the provider").not.toHaveBeenCalled();
  });

  it("source 'local' + a catalogue MISS + a key → falls through to the provider", async () => {
    // The fallback must survive: "catalogue first" is not "catalogue only".
    lookup.mockResolvedValue(null);
    localStorage.setItem("anthropic-api-key", "sk-real");
    const { result } = renderHook(() =>
      useAiAutoFill(makeProps({ autofillSource: "local" }) as any));
    act(() => { result.current.aiAutoFill("tobacco"); });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("no key AND a catalogue miss → says so, rather than failing silently", async () => {
    lookup.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useAiAutoFill(makeProps({ autofillSource: "ai" }) as any));
    act(() => { result.current.aiAutoFill("tobacco"); });
    await waitFor(() => expect(result.current.aiErr).toBeTruthy());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the PIPE form has no catalogue, so with no key it asks for one", async () => {
    // Deliberately different: the catalogue has no pipe entries, so there is
    // nothing to fall back TO and the honest answer is the key error.
    const { result } = renderHook(() => useAiAutoFill(makeProps({
      autofillSource: "ai", pipeForm: { brand: "Halvorsen", name: "Sherlock" },
    }) as any));
    act(() => { result.current.aiAutoFill("pipe"); });
    await waitFor(() => expect(result.current.aiErr).toBe("err_api_key"));
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
