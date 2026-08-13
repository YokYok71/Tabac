// Label-scan helpers: pure parse / request-builder /
// redaction logic. The browser-only canvas scaling and the live fetch
// flow are deliberately thin and not unit-tested here; the wire shape
// and the response parsing carry the logic.

import { describe, it, expect } from "vitest";
import {
  parseScanResult,
  buildScanRequest,
  buildScanPrompt,
  redactApiKeys,
  aiClipStr,
  aiIsRefusal,
} from "../hooks/useAiAutoFill";

describe("parseScanResult", () => {
  it("parses a clean JSON answer", () => {
    const res = parseScanResult('{"brand":"Halvorsen","name":"Duskfall","blend":"Virginia, Latakia, Périque"}');
    expect(res).toEqual({
      brand: "Halvorsen",
      name: "Duskfall",
      blend: "Virginia, Latakia, Périque",
    });
  });

  it("strips markdown fences around the JSON", () => {
    const res = parseScanResult('```json\n{"brand":"Halvorsen","name":"Irish Flake","blend":""}\n```');
    expect(res!.brand).toBe("Halvorsen");
    expect(res!.name).toBe("Irish Flake");
  });

  it("extracts the JSON from surrounding prose", () => {
    const res = parseScanResult('Voici le résultat : {"brand":"Pellworm","name":"HH Old Dark Fired","blend":""} — bonne dégustation.');
    expect(res!.brand).toBe("Pellworm");
  });

  it("returns null when no JSON object is present", () => {
    expect(parseScanResult("Je ne vois pas d'étiquette sur cette photo.")).toBeNull();
    expect(parseScanResult("")).toBeNull();
    expect(parseScanResult(null)).toBeNull();
    expect(parseScanResult(42 as any)).toBeNull();
  });

  it("returns null when JSON parsing fails", () => {
    expect(parseScanResult('{"brand": "Halvorsen", broken')).toBeNull();
  });

  it("returns null when neither brand nor name is readable", () => {
    expect(parseScanResult('{"brand":"","name":"","blend":"Virginia"}')).toBeNull();
  });

  it("accepts brand-only and name-only results", () => {
    expect(parseScanResult('{"brand":"Halvorsen","name":"","blend":""}')).not.toBeNull();
    expect(parseScanResult('{"brand":"","name":"Duskfall","blend":""}')).not.toBeNull();
  });

  it("rejects refusal text in individual fields", () => {
    const res = parseScanResult('{"brand":"Halvorsen","name":"Je ne peux pas lire le nom","blend":""}');
    expect(res!.brand).toBe("Halvorsen");
    expect(res!.name).toBe("");
  });

  it("strips HTML-like markup from values", () => {
    const res = parseScanResult('{"brand":"<b>Halvorsen</b>","name":"Duskfall","blend":""}');
    expect(res!.brand).toBe("Halvorsen");
  });

  it("drops over-budget runaway values", () => {
    const res = parseScanResult(JSON.stringify({
      brand: "Halvorsen", name: "x".repeat(500), blend: "",
    }));
    expect(res!.name).toBe("");
    expect(res!.brand).toBe("Halvorsen");
  });
});

describe("buildScanPrompt — language", () => {
  it("names the active UI language for the extracted composition (es/de/it, not just fr/en)", () => {
    // fr keeps its French clause; every other language gets an English
    // instruction that NAMES the target language so es/de/it users no longer
    // get an English composition.
    expect(buildScanPrompt("fr")).toContain("rédige-la en français");
    expect(buildScanPrompt("en")).toContain("write it in English");
    expect(buildScanPrompt("es")).toContain("write it in Spanish");
    expect(buildScanPrompt("de")).toContain("write it in German");
    expect(buildScanPrompt("it")).toContain("write it in Italian");
    // Unknown code falls back to English rather than leaking a code.
    expect(buildScanPrompt("xx")).toContain("write it in English");
  });
});

describe("buildScanRequest", () => {
  const B64 = "aGVsbG8=";
  const PROMPT = buildScanPrompt("fr");

  it("anthropic: vision message with base64 image, no web_search tool", () => {
    const { url, init } = buildScanRequest("anthropic", "sk-ant-test", B64, PROMPT);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.tools).toBeUndefined();
    const content = body.messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source).toEqual({ type: "base64", media_type: "image/jpeg", data: B64 });
    expect(content[1].type).toBe("text");
  });

  it("openai: the vision request carries max_completion_tokens", () => {
    // Same GPT-5 constraint as the autofill body — the scan path has its own
    // request builder, so it needs its own lock.
    const body = JSON.parse(buildScanRequest("openai", "k", B64, PROMPT).init.body);
    expect(body.max_completion_tokens).toBe(300);
    expect(body.max_tokens).toBeUndefined();
  });

  it("openai: data-URL image_url part", () => {
    const { url, init } = buildScanRequest("openai", "sk-test", B64, PROMPT);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-5.6-luna");
    const img = body.messages[0].content.find((c: any) => c.type === "image_url");
    expect(img.image_url.url).toBe("data:image/jpeg;base64," + B64);
  });

  it("gemini: inline_data part + key in header (never the URL)", () => {
    const { url, init } = buildScanRequest("gemini", "AIza-test", B64, PROMPT);
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).not.toContain("AIza-test");
    expect(init.headers["x-goog-api-key"]).toBe("AIza-test");
    const body = JSON.parse(init.body);
    const inline = body.contents[0].parts.find((p: any) => p.inline_data);
    expect(inline.inline_data).toEqual({ mime_type: "image/jpeg", data: B64 });
  });

  it("honours an explicit model per provider", () => {
    // Anthropic + OpenAI carry the model in the body; Gemini in the URL.
    expect(JSON.parse(buildScanRequest("anthropic", "k", B64, PROMPT, "claude-opus-5").init.body).model)
      .toBe("claude-opus-5");
    expect(JSON.parse(buildScanRequest("openai", "k", B64, PROMPT, "gpt-5.6-sol").init.body).model)
      .toBe("gpt-5.6-sol");
    expect(buildScanRequest("gemini", "k", B64, PROMPT, "gemini-3.6-flash").url)
      .toContain("/models/gemini-3.6-flash:generateContent");
  });

  // The "auto" sentinel must NEVER reach a request. buildScanRequest
  // used to fall back to defaultAiModel(), which became "auto" — that shipped
  // a literal "auto" as the model (a 404) and, on OpenAI, also picked the wrong
  // token-cap field. Caught by the tests below before release; this asserts it
  // explicitly for every provider so the trap cannot be re-set.
  it("never puts the 'auto' sentinel on the wire, whatever it is handed", () => {
    for (const prov of ["anthropic", "openai", "gemini"]) {
      for (const handed of [undefined, "", "auto"] as any[]) {
        const { url, init } = buildScanRequest(prov, "k", B64, PROMPT, handed);
        const body = JSON.parse(init.body);
        const onWire = prov === "gemini" ? url : String(body.model);
        expect(onWire, `${prov} / ${String(handed)}`).not.toContain("auto");
      }
    }
  });

  it("falls back to the provider default when no model is passed", () => {
    expect(JSON.parse(buildScanRequest("anthropic", "k", B64, PROMPT).init.body).model)
      .toBe("claude-haiku-4-5");
    expect(buildScanRequest("gemini", "k", B64, PROMPT).url)
      .toContain("/models/gemini-3.5-flash-lite:generateContent");
  });

  it("prompt asks for JSON-only and forbids invention", () => {
    expect(PROMPT).toContain("UNIQUEMENT en JSON");
    expect(PROMPT).toContain("N'invente RIEN");
  });
});

describe("redactApiKeys", () => {
  it("masks Anthropic / OpenAI / Google keys and key params", () => {
    expect(redactApiKeys("error sk-ant-abc123def456ghi")).not.toContain("sk-ant-abc123def456ghi");
    expect(redactApiKeys("bad AIzaSyD1234567890abc")).not.toContain("AIzaSyD1234567890abc");
    expect(redactApiKeys("url?api_key=secret123&x=1")).not.toContain("secret123");
  });

  it("passes ordinary messages through", () => {
    expect(redactApiKeys("HTTP 429 rate limited")).toBe("HTTP 429 rate limited");
  });
});

describe("aiClipStr / aiIsRefusal (moved to module scope)", () => {
  it("clips over-budget strings to empty", () => {
    expect(aiClipStr("x".repeat(101), 100)).toBe("");
    expect(aiClipStr("ok", 100)).toBe("ok");
    expect(aiClipStr(42, 100)).toBe("");
  });

  it("detects FR and EN refusals", () => {
    expect(aiIsRefusal("Je ne peux pas identifier ce tabac")).toBe(true);
    expect(aiIsRefusal("I cannot identify this blend")).toBe(true);
    expect(aiIsRefusal("Halvorsen Duskfall")).toBe(false);
  });
});
