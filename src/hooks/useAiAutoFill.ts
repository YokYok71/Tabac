import React from "react";
import { LANGUAGES, langAssets } from "../i18n/languages.ts";
import {
  CATS,
  CUTS,
  SHAPES,
  BENDS,
  BOWL_MATS,
  STEM_MATS,
  FINISHES,
  canonCategory,
  canonCut,
} from "../constants.ts";
import { stripMarkupFromString } from "../utils.ts";
import { lsGet, lsSet } from "../utils/appStorage.ts";
import { safeJsonParse } from "../utils/safeJson.ts";
import {
  tobaccoDbLookup,
  isTobaccoDbReady,
  type LookupResult as TobaccoDbHit,
} from "../utils/tobaccoDb.ts";

var useState = React.useState;

// ── Module-level pure helpers ────────────────────────────────────────
// Shared by the text auto-fill and the label-scan paths, exported for
// unit tests. No React, no closure over hook state.

/** Strip anything that looks like an API key, OAuth token, or PKCE
 *  secret from an error message before it reaches the UI (and any
 *  user screenshot or bug report). Covers, in order:
 *   - Anthropic / OpenAI / generic `sk-…` keys
 *   - Google `AIza…` keys
 *   - `api_key=…` query params (any case, &/space/quote-terminated)
 *   - HTTP `Bearer …` tokens
 *   - OAuth `code=…`, `code_verifier=…`, `refresh_token=…`
 *     query params (Dropbox PKCE error_descriptions
 *     occasionally echo the request body verbatim).
 */
export function redactApiKeys(msg: string): string {
  return String(msg)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[clé masquée]")
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "[clé masquée]")
    .replace(/(api[_-]?key=)[^&\s"']+/gi, "$1[clé masquée]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-~+/=]{16,}/g, "Bearer [clé masquée]")
    .replace(/\b(code|code_verifier|refresh_token|access_token)=[^&\s"']+/gi, "$1=[masqué]");
}

/**
 * True when a provider error means "this model does not exist (any more)"
 * rather than something transient.
 *
 * WHY. Vendor line-ups move every few months and a retired id fails FOR EVER,
 * yet the app surfaced the raw provider sentence — which is how
 * `gemini-2.0-flash`, the app's own Gemini default, was found four months dead with
 * every Gemini auto-fill failing and nothing saying why. The three wire
 * shapes, all HTTP 404:
 *   Anthropic — {"type":"not_found_error","message":"model: claude-x"}
 *   OpenAI    — "The model `gpt-x` does not exist or you do not have access…"
 *               (code "model_not_found")
 *   Gemini    — "models/gemini-x is not found for API version v1beta, or is
 *               not supported for generateContent"
 * Deliberately matched on the MESSAGE, not the status code: the fetch paths
 * here throw `new Error(d.error.message)` and never see the response object.
 * "no access with this key" is folded in on purpose — from the user's chair
 * the fix is identical (pick another model), and the message says both.
 */
/**
 * Build the Error thrown for a provider error payload, KEEPING the provider's
 * machine-readable code on the object. Anthropic's retired-model
 * 404 has a message of just "model: claude-x" — the discriminator lives in
 * `error.type` ("not_found_error"), not in the text — so a message-only
 * detector cannot see it. The displayed string is unchanged (`aiErr` still
 * shows `error.message`); only the extra field is new.
 *   Anthropic → error.type    ("not_found_error")
 *   OpenAI    → error.code    ("model_not_found")
 *   Gemini    → error.status  ("NOT_FOUND")
 */
export function providerError(err: any): Error {
  var e = new Error(String((err && err.message) || err || "unknown error"));
  var code = err && (err.type || err.code || err.status);
  if (code) (e as any).providerCode = String(code);
  return e;
}

export function isModelGoneError(msg: any): boolean {
  var code = String((msg && (msg as any).providerCode) || "").toLowerCase();
  // A 404 from any of the three providers, on the only endpoints this app
  // calls, means the model path is wrong — there is nothing else to not-find.
  if (code === "not_found_error" || code === "model_not_found" || code === "not_found") return true;
  var m = String((msg && (msg as any).message) || msg || "").toLowerCase();
  if (!m) return false;
  return (
    /not_found_error/.test(m) ||
    // Anthropic's 404 message is literally "model: claude-x" and nothing else.
    /^model:\s*\S+$/.test(m.trim()) ||
    /model_not_found/.test(m) ||
    // NB: the gap is `.{0,80}` and NOT `[^.]{0,80}` — model ids are full of
    // dots (gpt-5.6, gemini-1.5-pro), so excluding them made every one of
    // these patterns silently unable to match a real message.
    /\bmodels?\b.{0,80}\b(is |was |are )?not found/.test(m) ||
    /\bmodel\b.{0,80}does not exist/.test(m) ||
    /not supported for generatecontent/.test(m) ||
    /\bmodel\b.{0,80}(has been )?(deprecated|retired|sunset|shut down|discontinued)/.test(m)
  );
}

/** Sanitise + clip an AI-returned string. Empty string when the input
 *  is not a string, blank after scrubbing, or over budget. */
export function aiClipStr(s: any, max: number): string {
  if (typeof s !== "string") return "";
  var t = String(stripMarkupFromString(s)).trim();
  if (!t) return "";
  if (t.length > max) return "";
  return t;
}

/** Detect common LLM refusal openers (EN + FR). */
export function aiIsRefusal(s: any): boolean {
  if (typeof s !== "string") return false;
  var t = String(s).trim();
  if (!t) return false;
  return /^(i (don'?t|do not|cannot|can'?t|am (sorry|unable))|sorry,?|unfortunately|i could not|désolé|je ne (peux|sais|trouve)|aucune information|je n'?ai pas)/i.test(t);
}

// Map a free AI-returned string onto a canonical enum
// value. Exact match → alias table → case-insensitive substring (in enum
// order). Extracted from normCat/normCut/normShape, which had drifted
// (normCut had dropped the `=== vl` exact branch — a no-op here since an
// exact match is also a substring, so unification is behaviour-preserving).
// normBend stays separate: it is alias-map-only, no enum-list fuzzy pass.
export function matchEnum(
  v: any,
  list: readonly string[],
  aliases?: Record<string, string>,
): string {
  if (!v) return "";
  if (list.indexOf(v) >= 0) return v;
  if (aliases && aliases[v]) return aliases[v];
  var vl = String(v).toLowerCase();
  var found = list.filter(function (c) {
    return c !== "Autre" && (String(c).toLowerCase() === vl || vl.indexOf(String(c).toLowerCase()) >= 0);
  });
  return found[0] || "";
}

/**
 * Parse the label-scan response: extract the first JSON object, scrub
 * and clip brand / name / blend. Returns null when no JSON is found,
 * JSON.parse fails, or neither brand nor name is readable — the caller
 * surfaces "étiquette illisible" instead of wiping the form.
 */
export function parseScanResult(
  text: any,
): { brand: string; name: string; blend: string } | null {
  if (typeof text !== "string") return null;
  var cl = String(text).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  var m = cl.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/) || cl.match(/\{[\s\S]*\}/);
  if (!m) return null;
  var info: any;
  try { info = JSON.parse(m[0]); } catch (_e) { return null; }
  if (!info || typeof info !== "object") return null;
  var brand = aiIsRefusal(info.brand) ? "" : aiClipStr(info.brand, 100);
  var name  = aiIsRefusal(info.name)  ? "" : aiClipStr(info.name, 120);
  var blend = aiIsRefusal(info.blend) ? "" : aiClipStr(info.blend, 300);
  if (!brand && !name) return null;
  return { brand: brand, name: name, blend: blend };
}

// The UI-language name each provider prompt names as the target output
// language. Module-level so both buildScanPrompt and the autofill dispatch
// (runAutoFill) share one source of truth.
// DERIVED from the shared per-language table so a new language
// cannot silently make the AI write in English (the old literal map's fallback).
export var LANG_PROMPT_NAME: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, langAssets(l.code).aiPromptName]),
);

/** The vision prompt for a tin/label photo. */
export function buildScanPrompt(lang: string): string {
  // Write the extracted blend composition in the active UI
  // language (was fr/en only — es/de/it users got the English clause and an
  // English composition). The English instruction names the target language
  // so every provider complies.
  var langClause = lang === "fr"
    ? " Si tu extrais une composition, rédige-la en français."
    : " If you extract a blend composition, write it in " + (LANG_PROMPT_NAME[lang] || "English") + ".";
  return "Photo d'une boîte ou étiquette de tabac à pipe. Lis l'étiquette et extrais : la marque (fabricant) et le nom exact du blend. Si la composition (variétés de tabac) est lisible sur l'étiquette, extrais-la aussi. Réponds UNIQUEMENT en JSON valide sans markdown : {\"brand\":\"\",\"name\":\"\",\"blend\":\"\"}. Chaîne vide pour tout champ illisible ou absent. N'invente RIEN qui ne soit pas visible sur la photo." + langClause;
}

// The model is user-selectable per provider (Settings →
// AI). These are the defaults + the curated option lists shown in the
// dropdown. Model ids are passed into the request builders so the pure
// helpers stay testable. Persisted per provider in `ai-model-<provider>`.
// The OpenAI and Gemini lists were RETIRED UPSTREAM, not
// merely superseded — `gemini-2.0-flash` (this hook's Gemini default) was shut
// down on 2026-03-03, and `gpt-4o` / `gpt-4o-mini` are off OpenAI's current
// model list. Every Gemini auto-fill was therefore failing outright. Cheapest
// tier first in each list, since that is the sane default for a lookup.
// LABEL-CONTRACT:start ai-model-catalogue — see scripts/label-contracts.json
export var AI_MODEL_AUTO = "auto";
// Defaults apply ONLY when nothing is stored for that provider, so switching
// them to "auto" changes no existing device's behaviour — it just stops new
// installs from freezing a concrete id that a future refresh would strand.
// NULL-PROTOTYPE, like AI_MODEL_ALIASES below. Both are indexed by
// `ai-provider`, a value read straight from storage — and on a plain object
// `AI_MODEL_OPTIONS["__proto__"]` resolves to `Object.prototype`, which is
// TRUTHY, so the `|| []` fallback never fires and `.filter is not a function`
// throws on every render of App. Permanent, since the value is persisted.
export var AI_MODEL_DEFAULTS: Record<string, string> = Object.assign(Object.create(null), {
  anthropic: AI_MODEL_AUTO,
  openai: AI_MODEL_AUTO,
  gemini: AI_MODEL_AUTO,
});
// "auto" — the user delegates the choice.
//
// It does NOT mean "ask the provider which models exist". That naive reading
// is a trap: a provider's model-list endpoint returns everything (embeddings,
// TTS, moderation, fine-tunes) with no reliable "good at this task" metadata,
// costs an extra request on the happy path, and could land on a frontier model
// — spending the user's money on a choice they never made.
//
// It means: the CHEAPEST tier of the curated list below, resolved at request
// time instead of being frozen in storage. So a list refresh moves an "auto"
// user forward automatically, and a model retired upstream is remembered as
// dead (see markModelDead) and skipped from the next call on — which is
// exactly how the four-month Gemini outage would have healed itself.
export var AI_MODEL_OPTIONS: Record<string, Array<{ id: string; label: string }>> = Object.assign(Object.create(null), {
  anthropic: [
    { id: AI_MODEL_AUTO, label: "Auto" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-opus-5", label: "Opus 5" },
  ],
  openai: [
    { id: AI_MODEL_AUTO, label: "Auto" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  ],
  gemini: [
    // No Pro tier: the current Gemini Pro (3.1) is preview-only, and a
    // consumer app must not point at a preview endpoint.
    { id: AI_MODEL_AUTO, label: "Auto" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  ],
});
// Legacy → current model ids. The chosen model lives in
// `ai-model-<provider>` for ever, so refreshing the option lists above would
// otherwise leave a returning user pinned to a superseded id with no visible
// cue (the Settings picker keeps an off-list value selectable and renders it
// as its raw id). Mapped on READ, so the correction applies with no migration
// write. Null-prototype: the key comes from stored data
// (tabac-local/no-dynamic-index-plain-map).
//
// TWO KINDS OF ALIAS, and the difference matters:
//   • SAME-TIER successor — price and context are preserved, so the swap is
//     invisible. The Anthropic pairs below are all of this kind.
//   • RETIRED model — no price-preserving option exists any more (the request
//     simply 400s), so the id maps to the nearest CURRENT tier, favouring the
//     cheaper one. Prices moved upstream; that is not something an alias can
//     undo, and a working call beats a dead one.
// Never alias a LIVE model to a costlier one — that would spend the user's
// money on a choice they did not make.
export var AI_MODEL_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  // same-tier
  "claude-haiku-4-5-20251001": "claude-haiku-4-5", // dated snapshot → canonical id
  "claude-opus-4-8": "claude-opus-5",              // same price + 1M context
  // retired upstream → nearest current tier (cheap slot / balanced slot)
  "gpt-4o-mini": "gpt-5.6-luna",
  "gpt-4o": "gpt-5.6-terra",
  "gemini-2.0-flash": "gemini-3.5-flash-lite",     // shut down 2026-03-03
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.6-flash",
});
// LABEL-CONTRACT:end ai-model-catalogue
// One-shot migration of an EXISTING device onto "auto".
//
// Moving the DEFAULT only applies when nothing is stored — so
// every device that had ever opened Settings stayed pinned to a concrete id and
// got none of auto's self-healing. This migrates those, but ONLY when the
// stored value is a value the app itself once put there (a former default or
// an alias of one). A genuinely DELIBERATE choice — someone who picked Sonnet
// or Opus on purpose — is left alone: silently moving them to the cheapest tier
// would override an intent they expressed, which is exactly the kind of quiet
// substitution the alias rules refuse elsewhere.
export var AI_FORMER_DEFAULTS = [
  "claude-haiku-4-5-20251001", "claude-haiku-4-5",   // Anthropic defaults, old and current
  "gpt-4o-mini", "gpt-5.6-luna",                     // OpenAI defaults, old and current
  "gemini-2.0-flash", "gemini-3.5-flash-lite",       // Gemini defaults, old and current
];
/** True when a stored model id was never a deliberate user choice. */
export function isFormerDefaultModel(id: any): boolean {
  var raw = String(id || "").trim();
  if (!raw) return true;                       // nothing stored → auto anyway
  if (raw === AI_MODEL_AUTO) return false;     // already delegated
  return AI_FORMER_DEFAULTS.indexOf(raw) >= 0;
}

export function normalizeAiModel(id: any): string {
  var raw = String(id || "").trim();
  if (!raw) return "";
  return AI_MODEL_ALIASES[raw] || raw;
}
export function defaultAiModel(provider: string): string {
  return AI_MODEL_DEFAULTS[provider] || AI_MODEL_AUTO;
}

export var AI_AUTO_MIGRATED_KEY = "ai-model-auto-migrated";

/** Dead-model memory, per provider. A model retired upstream costs exactly ONE
 *  failed call ever: the error path records it here, and `resolveAiModel` skips
 *  it from then on. Device-local, never in backups. */
export function deadModelsKey(provider: string): string {
  return "ai-model-dead-" + String(provider || "anthropic");
}

/**
 * The concrete model id to put on the wire (pure). "auto" (or an empty /
 * unknown value) resolves to the cheapest curated option this provider has
 * that is not known-dead; a pinned id is returned normalised. When every
 * option is known-dead we still return the first — better to attempt and show
 * the provider's answer than to refuse to call at all.
 */
export function resolveAiModel(provider: string, stored: any, dead?: readonly string[]): string {
  var list = AI_MODEL_OPTIONS[provider] || [];
  var concrete = list.filter(function (o) { return o.id !== AI_MODEL_AUTO; });
  var raw = normalizeAiModel(stored);
  if (raw && raw !== AI_MODEL_AUTO) return raw;
  var deadSet = dead || [];
  for (var i = 0; i < concrete.length; i++) {
    var id = concrete[i]!.id;
    if (deadSet.indexOf(id) < 0) return id;
  }
  return concrete.length ? concrete[0]!.id : "";
}
/**
 * The output-cap field for an OpenAI Chat Completions body.
 * GPT-5 and the o-series REJECT `max_tokens` outright ("Unsupported
 * parameter: 'max_tokens' is not supported with this model. Use
 * 'max_completion_tokens' instead"), so moving the list to gpt-5.6 without
 * this would have turned every OpenAI request into a 400. Legacy 4o/4.1-era
 * ids keep `max_tokens` — they only understand that one.
 */
export function openaiMaxTokensField(model: string, n: number): Record<string, number> {
  var m = String(model || "");
  return /^(gpt-[5-9]|o[1-9])/.test(m)
    ? { max_completion_tokens: n }
    : { max_tokens: n };
}
/**
 * A metadata GET that answers one question: does THIS model id exist for this
 * key? (Pure — returns {url, init} so the wire shape is unit-testable.) Free: no tokens are generated, unlike a 1-token completion.
 *
 * Note this is NOT the model-LIST endpoint auto deliberately avoids. Listing is
 * the wrong tool for CHOOSING a model (it returns embeddings / TTS / fine-tunes
 * with no "good at this task" metadata); asking whether one specific id exists
 * is exactly what it is right for. The point is to say "ce modèle ne répond
 * pas" at the moment the user picks it, instead of at their next search — the
 * gap that let a four-month Gemini outage go unnoticed.
 */
export function buildModelProbeRequest(provider: string, apiKey: string, model: string): { url: string; init: any } {
  var id = encodeURIComponent(String(model || ""));
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/models/" + id,
      init: { method: "GET", headers: { Authorization: "Bearer " + apiKey } },
    };
  }
  if (provider === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models/" + id,
      init: { method: "GET", headers: { "x-goog-api-key": apiKey } },
    };
  }
  return {
    url: "https://api.anthropic.com/v1/models/" + id,
    init: {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    },
  };
}

function geminiUrl(model: string): string {
  return "https://generativelanguage.googleapis.com/v1beta/models/" +
    (model || "gemini-3.5-flash-lite") + ":generateContent";
}

/**
 * Build the provider-specific vision request for a scaled JPEG
 * (raw base64, no data: prefix). Pure — returns {url, init} so the
 * wire shape is unit-testable without a network.
 * No web_search tool on the Anthropic path: the answer must come from
 * the IMAGE, not from a search (anti-hallucination).
 */
export function buildScanRequest(
  provider: string,
  apiKey: string,
  b64jpeg: string,
  prompt: string,
  model?: string,
): { url: string; init: any } {
  // RESOLVE, never fall back to the raw default — that default is
  // now the "auto" sentinel, so `model || defaultAiModel(provider)` would put
  // the literal "auto" on the wire (a 404, and on OpenAI it also silently
  // picked the wrong token-cap field). Passing an explicit id still wins, and
  // gets normalised on the way through.
  var mdl = resolveAiModel(provider, model);
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: mdl,
          ...openaiMaxTokensField(mdl, 300),
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64jpeg } },
            ],
          }],
        }),
      },
    };
  }
  if (provider === "gemini") {
    return {
      url: geminiUrl(mdl),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: b64jpeg } },
            ],
          }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      },
    };
  }
  return {
    url: "https://api.anthropic.com/v1/messages",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: mdl,
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: b64jpeg },
            },
            { type: "text", text: prompt },
          ],
        }],
      }),
    },
  };
}

// Downscale a photo to maxDim px (longest side) JPEG and return the
// raw base64 payload. Keeps vision-token cost predictable regardless
// of the 12-MP original. Browser-only (canvas) — not unit-testable in
// jsdom, deliberately thin.
function fileToScaledJpegBase64(
  file: File,
  maxDim: number,
  quality: number,
): Promise<string> {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error(AI_ERR.fileRead)); };
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          var w = Math.max(1, Math.round((img.width || 1) * scale));
          var h = Math.max(1, Math.round((img.height || 1) * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var c2d = canvas.getContext("2d");
          if (!c2d) { reject(new Error(AI_ERR.canvas)); return; }
          c2d.drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL("image/jpeg", quality);
          var b64 = String(dataUrl).split(",")[1] || "";
          if (!b64) { reject(new Error(AI_ERR.encode)); return; }
          resolve(b64);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error(AI_ERR.image)); };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// These five failures used to `throw new Error("<French prose>")`,
// and both display sinks push `e.message` straight into the error banner — so
// an en/es/de/it user scanning a corrupt tin photo read "Image illisible".
// Every OTHER error on this path already goes through a key. Sentinel CODES
// keep the throw sites terse while `aiErrMessage` does the lookup at the sink.
// Null-prototype: the message is compared against data-derived text.
export const AI_ERR = {
  fileRead: "E_AI_FILE_READ",
  canvas:   "E_AI_CANVAS",
  encode:   "E_AI_ENCODE",
  image:    "E_AI_IMAGE",
  noJson:   "E_AI_NO_JSON",
} as const;

const AI_ERR_KEYS: Record<string, string> = Object.assign(Object.create(null), {
  [AI_ERR.fileRead]: "err_photo_read",
  [AI_ERR.canvas]:   "ai_err_canvas",
  [AI_ERR.encode]:   "ai_err_encode",
  [AI_ERR.image]:    "err_photo_read",
  [AI_ERR.noJson]:   "ai_err_no_json",
});

/** Resolve a thrown AI error to display text: a sentinel code becomes a
 *  translated string, anything else (a provider message) passes through. */
export function aiErrMessage(raw: string, t?: ((k: string) => string) | undefined): string {
  const key = AI_ERR_KEYS[String(raw)];
  if (key && t) return t(key);
  return raw;
}

export function useAiAutoFill({
  lang,
  form,
  setForm,
  pipeForm,
  setPipeForm,
  wishForm,
  setWishForm,
  weightUnit,
  lengthUnit,
  t,
  autofillSource,
}: {
  lang: string;
  form: any;
  setForm: any;
  pipeForm: any;
  setPipeForm: any;
  wishForm: any;
  setWishForm: any;
  weightUnit: string;
  lengthUnit: string;
  t: (k: string) => string;
  /** "local" (default): DB first → AI fallback. "ai": AI first → DB fallback. */
  autofillSource?: "local" | "ai";
}) {
  var _aiL = useState(false),
    aiLoad = _aiL[0],
    setAiLoad = _aiL[1];
  var _aiE = useState(""),
    aiErr = _aiE[0],
    setAiErr = _aiE[1];
  var _aiK = useState(
      lsGet(
        (lsGet("ai-provider") || "anthropic") + "-api-key",
      ) || "",
    ),
    apiKey = _aiK[0],
    setApiKey = _aiK[1];
  var _aiP = useState(lsGet("ai-provider") || "anthropic"),
    aiProvider = _aiP[0],
    setAiProvider = _aiP[1];
  // User-selectable model, stored per provider
  // (`ai-model-<provider>`), defaulting to that provider's default model.
  var _aiM = useState((function () {
      var p = lsGet("ai-provider") || "anthropic";
      return normalizeAiModel(lsGet("ai-model-" + p)) || defaultAiModel(p);
    })()),
    aiModel = _aiM[0],
    setAiModel = _aiM[1];
  // Result of the last model-liveness probe (Settings → IA).
  // "" = nothing checked yet. Never blocks anything — purely informative.
  var _mp = useState<{ state: "busy" | "ok" | "gone" | "error"; model: string } | null>(null),
    modelProbe = _mp[0],
    setModelProbe = _mp[1];
  var _xk = useState(lsGet("cave-exclude-apikey") !== "0"),
    excludeApiKey = _xk[0],
    setExcludeApiKey = _xk[1];
  // Source of the last successful auto-fill. Surfaced
  // on AICard as a tiny "· source: local" / "· source: anthropic"
  // tag so the user sees where the data came from. Reset when the user
  // clears the form / starts a new auto-fill.
  var _src = useState<"" | "local" | "anthropic" | "openai" | "gemini">(""),
    aiSource = _src[0],
    setAiSource = _src[1];
  // "Vérifier avec l'IA" cross-check. After a DB hit the
  // user can ask the AI to look the blend up too, then pick which side
  // wins. We capture both sides here; AICard renders a small diff Notice
  // with "Apply AI" / "Keep DB" actions.
  var _ac = useState<null | {
    type: "tobacco" | "wish";
    db: { category: string; cut: string; blend: string; force: number; roomNote: number; taste: number; agingMax: string };
    ai: { category: string; cut: string; blend: string; force: number; roomNote: number; taste: number; agingMax: string };
  }>(null),
    aiCompare = _ac[0],
    setAiCompare = _ac[1];

  // The mount-time loadTobaccoDb() prefetch was removed — this
  // hook is mounted app-wide (App.tsx), so it pulled the catalog chunk onto
  // the HOME screen, counting toward Lighthouse's script-transfer budget. The
  // DB is now loaded lazily by whoever needs it: the tobacco/wish forms warm
  // it in their (view-gated) dbReady effect the instant they open, CatalogView
  // on catalog open, and aiAutoFill()/tobaccoDbLookup() await it on demand. So
  // the first lookup is still ready by the time the user can trigger it, with
  // zero cost on cold start. Do NOT re-add an unconditional mount prefetch.

  // Dead-model memory (see deadModelsKey). Kept tiny and crash-safe:
  // a corrupt value degrades to "nothing is dead", i.e. the original behaviour.
  function readDead(provider: string): string[] {
    var raw = safeJsonParse(lsGet(deadModelsKey(provider)), null) as any;
    return Array.isArray(raw) ? raw.filter(function (x) { return typeof x === "string"; }) : [];
  }
  function markModelDead(provider: string, id: string) {
    if (!id || id === AI_MODEL_AUTO) return;
    var cur = readDead(provider);
    if (cur.indexOf(id) >= 0) return;
    cur.push(id);
    lsSet(deadModelsKey(provider), JSON.stringify(cur.slice(-8)));
  }
  /** The id actually sent, for the ACTIVE provider. */
  function effectiveModel(): string {
    return resolveAiModel(aiProvider, aiModel, readDead(aiProvider));
  }
  /** True when the choice is delegated — drives the auto-specific error copy
   *  and whether a dead model gets recorded. */
  function isAutoModel(): boolean {
    return normalizeAiModel(aiModel) === AI_MODEL_AUTO || !normalizeAiModel(aiModel);
  }

  // Run the auto migration once per device (see
  // isFormerDefaultModel). Guarded by a flag so a user who deliberately picks
  // the cheapest tier AFTER the migration is never flipped back to auto.
  React.useEffect(function () {
    if (lsGet(AI_AUTO_MIGRATED_KEY) === "1") return;
    var changedActive = false;
    ["anthropic", "openai", "gemini"].forEach(function (p) {
      var stored = lsGet("ai-model-" + p);
      if (stored !== null && isFormerDefaultModel(stored)) {
        lsSet("ai-model-" + p, AI_MODEL_AUTO);
        if (p === (lsGet("ai-provider") || "anthropic")) changedActive = true;
      }
    });
    lsSet(AI_AUTO_MIGRATED_KEY, "1");
    if (changedActive) setAiModel(AI_MODEL_AUTO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveApiKey(k: any, provider?: string) {
    // `provider` lets the import path target the slot
    // the backup CAME FROM rather than the slot currently active. Without
    // it, importing a backup made under Anthropic while running Gemini
    // would write the Anthropic key into the `gemini-api-key` slot —
    // both keys lost on the next AI call. Falls back to the active
    // provider when not provided (manual user save in Settings).
    var target = (provider && /^(anthropic|openai|gemini)$/.test(provider))
      ? provider
      : (lsGet("ai-provider") || "anthropic");
    // CodeQL js/clear-text-storage-of-sensitive-information — accepted risk.
    // Static PWA with no backend: the AI provider key must live on-device to
    // call api.anthropic.com / api.openai.com / generativelanguage.googleapis.com
    // directly. CSP (no unsafe-inline, locked script-src) is the real XSS defense.
    lsSet(target + "-api-key", k);
    // Only mirror to the live React state when we wrote to the active
    // provider's slot — otherwise we'd overwrite the displayed key in
    // Settings with the imported one even when the user is on another
    // provider.
    var active = lsGet("ai-provider") || "anthropic";
    if (target === active) setApiKey(k);
  }

  function saveAiProvider(p: any) {
    setAiProvider(p);
    lsSet("ai-provider", p);
    setApiKey(lsGet(p + "-api-key") || "");
    // Recall this provider's saved model (or its default).
    setAiModel(normalizeAiModel(lsGet("ai-model-" + p)) || defaultAiModel(p));
  }

  /**
   * Check that the model that WOULD run actually exists for this key, and say
   * so next to the picker. Fired when the user changes the model, and on demand
   * from the "Vérifier" button. Silent no-op without a key — there is nothing
   * to check against. A `gone` verdict under auto also records the dead model,
   * so the next call already skips it.
   */
  function probeModel(modelArg?: string) {
    if (!apiKey) { setModelProbe(null); return; }
    var prov = lsGet("ai-provider") || "anthropic";
    var target = modelArg !== undefined
      ? resolveAiModel(prov, modelArg, readDead(prov))
      : effectiveModel();
    if (!target) { setModelProbe(null); return; }
    setModelProbe({ state: "busy", model: target });
    var req = buildModelProbeRequest(prov, apiKey, target);
    fetch(req.url, req.init)
      .then(function (r) {
        if (r.ok) { setModelProbe({ state: "ok", model: target }); return; }
        // 404 (and Anthropic's not_found_error) = the id does not exist for
        // this key. Anything else (401/403/429/5xx) is not a verdict ON THE
        // MODEL, so it must not be reported as one.
        if (r.status === 404) {
          var auto = normalizeAiModel(lsGet("ai-model-" + prov)) === AI_MODEL_AUTO
            || !lsGet("ai-model-" + prov);
          if (auto) markModelDead(prov, target);
          setModelProbe({ state: "gone", model: target });
        } else {
          setModelProbe({ state: "error", model: target });
        }
      })
      .catch(function () { setModelProbe({ state: "error", model: target }); });
  }

  // Persist the chosen model for the ACTIVE provider.
  // Empty / whitespace falls back to the provider default so the request
  // never ships a blank model id.
  function saveAiModel(m: any) {
    var active = lsGet("ai-provider") || "anthropic";
    var val = normalizeAiModel(m) || defaultAiModel(active);
    lsSet("ai-model-" + active, val);
    setAiModel(val);
    // Verify at the point of choice, not at the next search.
    probeModel(val);
  }

  // Apply a DB hit directly to the relevant form. Mirrors
  // the field selection that parseAndApply uses for the AI path but skips
  // the JSON parse / refusal / clip pipeline. `setAiSource("local")` tells
  // AICard to display "· source: catalogue".
  //
  // This comment used to justify skipping validation with
  // "the DB values are already validated by scripts/validate-tobacco-db.cjs".
  // That script was DELETED along with the bundled catalogue, so
  // the guarantee it named had not existed for seven releases: the catalogue is
  // the user's own file now, and `parseCatalogueCsv` keeps an unrecognised
  // taxonomy label VERBATIM on purpose. `canonCategory` / `canonCut` restore
  // the check at the write — a label the cellar cannot represent falls through
  // to the form's existing value, exactly as an empty catalogue field does.
  // See the helpers in constants.ts for why null and not "Autre".
  function applyDbHit(type: "tobacco" | "wish", hit: TobaccoDbHit) {
    var setter = type === "wish" ? setWishForm : setForm;
    setter(function (f: any) {
      return Object.assign({}, f, {
        name: hit.name || f.name,
        brand: hit.brandDisplay || f.brand,
        category: canonCategory(hit.category) || f.category,
        cut: canonCut(hit.cut) || f.cut,
        blend: hit.blend || f.blend,
        force: hit.force || f.force,
        roomNote: hit.roomNote || f.roomNote,
        taste: hit.taste || f.taste,
        agingMax: hit.agingMax || f.agingMax,
        description: hit.description || f.description,
      });
    });
    setAiSource("local");
    setAiLoad(false);
    setAiErr("");
  }

  function aiAutoFill(type: any) {
    if (aiLoad) return;
    setAiErr("");
    // DB-first or AI-first based on the user's setting.
    // The pipe form never hits the DB (no tobacco-db entries for pipes).
    var canDb = type === "tobacco" || type === "wish";
    var primary = autofillSource === "local" ? "local" : "ai";
  /**
   * A lookup that found nothing because there IS NO
   * CATALOGUE is not a miss. Saying "no match in the local catalogue" tells
   * the user something false about their blend when the truth is about the
   * app — this used to be a failed chunk download, and it is now the
   * ordinary state of anyone who has not loaded a catalogue of their own.
   */
  function noMatchKey(): string {
    return isTobaccoDbReady() ? "ai_err_no_match_no_key" : "ai_err_no_catalogue";
  }

    var brand = type === "wish" ? wishForm.brand : type === "pipe" ? pipeForm.brand : form.brand;
    var name = type === "wish" ? wishForm.name : type === "pipe" ? pipeForm.name : form.name;
    var hasInput = !!(String(brand || "").trim() && String(name || "").trim());

    // Synchronous short-circuit: no input + no key → legacy err_api_key.
    // Keeps the "click with empty form" UX unchanged and dodges an async
    // DB round-trip that would only ever return null anyway.
    if (!hasInput && !apiKey) {
      setAiErr(t("err_api_key"));
      return;
    }

    if (canDb && primary === "local" && hasInput) {
      setAiLoad(true);
      tobaccoDbLookup(brand, name, lang).then(function (hit) {
        if (hit) { applyDbHit(type as "tobacco" | "wish", hit); return; }
        // DB miss → fall through to AI
        if (!apiKey) {
          setAiLoad(false);
          setAiErr(t(noMatchKey()));
          return;
        }
        runAutoFill(type);
      });
      return;
    }
    // AI-first (or pipe form): try AI; if it fails AND it's a tobacco/wish, fall back to DB.
    if (!apiKey) {
      if (canDb && hasInput) {
        setAiLoad(true);
        tobaccoDbLookup(brand, name, lang).then(function (hit) {
          if (hit) { applyDbHit(type as "tobacco" | "wish", hit); return; }
          setAiLoad(false);
          setAiErr(t(noMatchKey()));
        });
        return;
      }
      setAiErr(t("err_api_key"));
      return;
    }
    runAutoFill(type);
  }

  // Body extracted from aiAutoFill so the label-scan
  // flow can CHAIN the full web search right after extracting
  // brand + name from the photo. `qOverride` bypasses the form-state
  // read — the scan's setForm hasn't re-rendered yet when the chain
  // fires, so reading form/wishForm here would see the PRE-scan
  // values (stale closure).
  // Third param `previewCallback` — when provided,
  // parseAndApply hands the AI-derived values to it INSTEAD of writing
  // to the form. Used by the cross-check feature so the user can
  // compare DB vs AI before deciding which to keep.
  // `dbOverride` carries the {brand,name} the caller already
  // knows (the scan result) so onErr's DB fallback doesn't read the STALE
  // pre-scan form (setForm hasn't re-rendered when the chained call fires).
  function runAutoFill(type: any, qOverride?: string, previewCallback?: (vals: any) => void, dbOverride?: { brand?: string; name?: string }) {
    // Resolve "auto" ONCE per run, so every provider branch below
    // puts a concrete id on the wire (a literal "auto" would 404).
    var effModel = effectiveModel();
    var q = qOverride !== undefined
      ? String(qOverride).trim()
      : type === "pipe"
        ? String(
            (pipeForm.brand || "") +
            " " +
            (pipeForm.name || "") +
            " pipe"
          ).trim()
        : type === "wish"
          ? String(
              (wishForm.brand || "") +
              " " +
              (wishForm.name || "") +
              " pipe tobacco"
            ).trim()
          : String(
              (form.brand || "") +
              " " +
              (form.name || "") +
              " pipe tobacco"
            ).trim();
    if (q.length < 3) {
      // When chained from a scan the spinner is already on — clear it
      // so a degenerate query can't strand the loading state.
      setAiLoad(false);
      return;
    }
    q = String(q).substring(0, 200);
    // WHICH FICHE ASKED. A provider call has a 60 s abort budget and is not
    // cancelled on navigation, so the answer could land on whatever working
    // copy was current when it resolved: open tobacco A, tap Rechercher, back
    // out, open tobacco B — and A's brand, name, category, blend, force, room
    // note, taste, ageing and description were merged into B. One Save then
    // wrote A's data over B's row.
    //
    // The id is the identity (`nav()` may not reset it — that is the hard
    // invariant — and the working copy carries it for an edit). RESIDUAL,
    // disclosed: two successive ADD forms both have `undefined`, so they
    // cannot be told apart this way. Guarding those on the typed brand+name
    // was written and rejected — the scan→auto-fill chain builds its query
    // from the SCAN result while the form still holds the previous value, so
    // that rule would have dropped a result the user was waiting for.
    var targetId = type === "pipe" ? pipeForm.id : type === "wish" ? wishForm.id : form.id;
    setAiErr("");
    var jT =
      '{"name":"","brand":"","category":"Anglais|Aromatique|Balkan|Burley|Cavendish|Dark Fired|Écossais|Latakia|Oriental|Perique|Turkish|VaPer|Virginia|Virginia/Burley","blend":"varietes","cut":"Broken Flake|Coins|Crumble Cake|Cube Cut|Curly Cut|Flake|Loose Cut|Plug|Pressed|Ready Rubbed|Ribbon|Rope|Rough Cut|Shag|Sliced","force":1,"room_note":1,"taste":1,"aging_max_years":"","description":""}';
    var jP =
      '{"name":"","brand":"","shape":"Apple|Billiard|Brandy|Bulldog|Calabash|Canadian|Churchwarden|Dublin|Egg|Freehand|Liverpool|Lovat|Lumberman|Oom Paul|Poker|Pot|Prince|Rhodesian|Stack|Zulu","courbure":"Droite|Semi-courbée|Courbée","length_mm":0,"weight_g":0,"chamber_diameter_mm":0,"chamber_depth_mm":0,"bowl_material":"Argile|Bambou|Bruyère|Cerisier|Chêne|Érable|Maïs|Meerschaum|Métal|Morta|Noyer|Olivier|Os|Pierre (stéatite)|Poirier|Porcelaine|Autre","stem_material":"Acrylique|Ambre|Bois|Canne|Corne|Cumberland|Delrin|Ivoirite|Lucite|Os|Ébonite|Autre","finish":"Lisse|Rustiquée|Sablée|Teintée|Autre","filter":"9mm|6mm|Balsa|Métal|Hybride 6mm|Hybride 9mm|Aucun","description":""}';
    // Write the free-text fields in the app's ACTIVE UI
    // language (was fr/en only — es/de/it users got English). The English
    // instruction names the target language so any provider complies.
    // LANG_PROMPT_NAME is module-level (shared with buildScanPrompt).
    var langInstr =
      lang === "fr"
        ? " Tous les champs texte (description, blend, notes de dégustation) doivent être rédigés en français."
        : " All text fields (description, blend, tasting notes) must be written in " + (LANG_PROMPT_NAME[lang] || "English") + ".";
    var sysp =
      type === "pipe"
        ? "Tu es expert en pipes. Utilise la recherche web pour identifier la pipe exacte. Pour le champ finish (finition de la bruyère) : Lisse=surface polie lisse ; Sablée=sablage (sandblast) ; Rustiquée=texture creusée/sculptée à la main (rusticated) ; Teintée=surface lisse avec teinte/coloration marquée (stained/contrast stain) ; Autre si indéterminé ou hybride. Reponds UNIQUEMENT en JSON valide sans markdown." +
          langInstr
        : "Tu es expert en tabacs à pipe. Utilise la recherche web pour identifier le blend exact avant de répondre. **Sources, par ordre de priorité STRICT pour TOUS les champs** : (1) smokingpipes.com — privilégie la table de specs officielle ET la blend description rédigées par l'équipe SP. C'est la source de référence pour TOUS les champs (catégorie, coupe, composition / blend, strength, room note, taste, âge max recommandé, description). Les commentaires utilisateurs SP ne servent qu'à confirmer une info absente de la spec sheet. (2) tobaccoreviews.com — fallback si SP n'a pas l'info OU pour compléter / enrichir la description avec le ressenti agrégé des revues utilisateurs ; ne JAMAIS écraser une valeur SP existante. (3) Reddit r/PipeTobacco — fallback UNIQUEMENT si SP et TR ne suffisent pas. Catégories : Anglais=mélange Latakia dominant sur base Virginia ; Balkan=Orientaux dominants+Latakia ; Écossais=style anglais léger peu de Latakia ; Virginia=Virginia pur ou très dominant sans Latakia ; VaPer=Virginia+Périque (DFK possible en condiment, pas de Latakia) ; Virginia/Burley=Virginia+Burley sans Latakia ; Aromatique=arômes/casings ajoutés ; Burley=Burley dominant ; Dark Fired=Kentucky fire-cured ; Oriental=Orientaux dominants sans Latakia. **MAPPING STRICT → 1-5 — à respecter SANS dévier** (réduit la variance entre appels et l'écart avec la base locale de référence). Pour **force et taste** : Extremely Mild/None → 1 ; Mild/Very Mild → 2 ; Mild to Medium → 3 ; Medium → 3 ; Medium to Full/Medium to Strong → 4 (PAS 3) ; Strong → 4 ; Full/Very Full/Extra Full/Extra Strong/Overwhelming → 5. Pour **room_note** (échelle à vocabulaire DISTINCT — ne PAS réutiliser les mots de force/taste) : Unnoticeable → 1 ; Tolerable → 2 ; Pleasant to Tolerable/Pleasant → 3 ; Very Pleasant → 4 ; Strong/Overwhelming → 5. Si SP/TR n'affiche pas ces 3 champs (rare), déduis depuis le blend type (Anglais Latakia-bomb → F4/T4 ; Aromatique léger → F2/T2 ; Burley fort → F4/T3-4 ; etc.). Pour description : PARAPHRASE en tes propres mots (ne recopie JAMAIS verbatim) la blend description SP officielle et le ressenti agrégé des revues TR ; minimum 240 caractères. Si les sources ne suffisent pas pour atteindre 240 caractères, reste factuel et plus court — n'invente rien pour combler. Pour aging_max_years : **extraction stricte, dans cet ordre exact**. (1) Détermine d'abord la category. (2) Cherche une mention chiffrée explicite dans la blend description SP ou TR (« ages X years », « X-Y years », « X+ years », « best after X years », « X years of aging ») → renvoie X ou X-Y. (3) Sinon, **applique IMPÉRATIVEMENT le default par famille** (barème sourcé smokingpipes/pipestud/pipe-club/pipesandcigars/tobaccoreviews — le Latakia s'estompe donc plus court, les Virginia/Perique se gardent le plus longtemps) : Virginia → **15-25** ; VaPer → **15-20** ; Virginia/Burley → **10-15** ; Anglais → **6-10** ; Balkan → **8-12** ; Écossais → **8-12** ; Burley → **5-10** ; Latakia → **5-8** ; Perique → **10-15** ; Dark Fired → **7-10** ; Oriental → **6-10** ; Turkish → **6-10** ; Aromatique/Cavendish → **3**. **GARDE-FOU FINAL OBLIGATOIRE** : sans mention chiffrée explicite d'une source, ta valeur d'agingMax DOIT être exactement le default de la category ci-dessus. Rappels : Virginia se garde le plus longtemps (15-25) ; Perique et VaPer très longtemps (Perique 10-15, VaPer 15-20) ; à l'inverse le Latakia s'estompe (Latakia 5-8, Anglais 6-10) et Burley/aromatiques gagnent peu (Burley 5-10, Aromatique/Cavendish 3). Ne t'écarte du default QUE si la source donne un chiffre explicite. Plafond strict : jamais > 30, jamais 0. Format : entier (ex: 8) ou fourchette N-M (ex: 6-10), JAMAIS de chaîne libre. Renvoie vide UNIQUEMENT si tu n'as réussi à déterminer NI la category NI une mention explicite. **RÈGLE ABSOLUE — NE JAMAIS INVENTER D'INFORMATION** : n'affirme que ce qui provient réellement des sources web (SP/TR/Reddit) ; les SEULES inférences autorisées sont les défauts par famille définis ci-dessus (force/room note/taste/âge max) et le mapping de strength. En cas de doute sur un champ, laisse-le vide plutôt que de deviner. Reponds UNIQUEMENT en JSON valide sans markdown." +
          langInstr;
    var up =
      type === "pipe"
        ? "Pipe: " + q + " -> JSON: " + jP
        : "Tabac: " +
          q +
          ". Recherche ce blend précis et retourne -> JSON: " +
          jT;
    function normCat(v: any) {
      if (!v) return "";
      if (CATS.indexOf(v) >= 0) return v;
      var al: Record<string, string> = {
        "Virginia/Perique": "VaPer",
        "Va/Per": "VaPer",
        "Va Per": "VaPer",
        Perique: "VaPer",
        "Virginia/Perique/Dark Fired": "VaPer",
        "VaPer/DFK": "VaPer",
        "Va/Per/DFK": "VaPer",
        English: "Anglais",
        "English Mixture": "Anglais",
        Latakia: "Anglais",
        "Latakia Blend": "Anglais",
        "Latakia Mixture": "Anglais",
        Scottish: "Écossais",
        Ecossais: "Écossais",
        "Dark Fired Kentucky": "Dark Fired",
        Kentucky: "Dark Fired",
        "Dark-Fired": "Dark Fired",
        "Balkan/Anglais": "Balkan",
        "Balkan English": "Balkan",
        "Balkan Mixture": "Balkan",
        Aromatic: "Aromatique",
        Cavendish: "Aromatique",
        Turkish: "Oriental",
        "Turkish Blend": "Oriental",
        "Turkish Mixture": "Oriental",
        "Flue Cured": "Virginia",
        Bright: "Virginia",
        "Bright Virginia": "Virginia",
        "Burley Blend": "Burley",
        "Pure Burley": "Burley",
        "Virginia Burley": "Virginia/Burley",
      };
      return matchEnum(v, CATS, al);
    }
    function normCut(v: any) {
      if (!v) return "";
      if (CUTS.indexOf(v) >= 0) return v;
      var al: Record<string, string> = {
        "Navy Cut": "Coins",
        Medallion: "Coins",
        "Roll Cut": "Coins",
        "Spun Cut": "Coins",
        "Round Slices": "Coins",
        Twist: "Rope",
        "Curly Kake": "Curly Cut",
        Cube: "Cube Cut",
        Sliced: "Flake",
        Slice: "Flake",
        "Rubbed Out": "Ready Rubbed",
        "Rubbed-Out": "Ready Rubbed",
        "Rubbed out flake": "Ready Rubbed",
        "Cut Plug": "Plug",
        "Long Cut": "Ribbon",
        "Long Ribbon": "Ribbon",
        "Fine Cut": "Shag",
        "Very Fine": "Shag",
        "Broken flake": "Broken Flake",
        "Ready rubbed": "Ready Rubbed",
        "Crumble cake": "Crumble Cake",
        "Curly cut": "Curly Cut",
        "Cube cut": "Cube Cut",
      };
      return matchEnum(v, CUTS, al);
    }
    function normShape(v: any) {
      return matchEnum(v, SHAPES);
    }
    function normBend(v: any) {
      if (!v) return "";
      if (BENDS.indexOf(v) >= 0) return v;
      var al: Record<string, string> = {
        straight: "Droite",
        droite: "Droite",
        "quarter bent": "Semi-courbée",
        quarter: "Semi-courbée",
        "1/4 bent": "Semi-courbée",
        "1/4 courbé": "Semi-courbée",
        "half bent": "Semi-courbée",
        half: "Semi-courbée",
        "1/2 bent": "Semi-courbée",
        "1/2 courbé": "Semi-courbée",
        "demi courbé": "Semi-courbée",
        "semi-courbée": "Semi-courbée",
        "semi courbée": "Semi-courbée",
        "full bent": "Courbée",
        "fully bent": "Courbée",
        full: "Courbée",
        courbée: "Courbée",
        bent: "Semi-courbée",
      };
      var vl = String(v).toLowerCase();
      if (al[vl]) return al[vl];
      return "";
    }
    // Validation helpers — keep AI hallucinations from
    // clobbering form fields with garbage. `clipStr` enforces a
    // length ceiling per field (returns "" past the cap so the
    // user's existing value wins via the `|| f.x` fallback).
    // `isRefusal` catches the common "Sorry, I can't help" patterns
    // that some providers occasionally return as the value of
    // `name` / `description`. `validAgingMax` requires the integer
    // or `N-M` range format `parseAgingMax` actually understands.
    // ClipStr / isRefusal moved to module scope (aiClipStr /
    // aiIsRefusal) so the label-scan parser shares the exact same scrub
    // logic. Local aliases keep this function's call sites unchanged.
    var clipStr = aiClipStr;
    var isRefusal = aiIsRefusal;
    function validAgingMax(v: any): string {
      if (v === null || v === undefined) return "";
      var s = String(v).trim();
      if (!s || s === "0") return "";
      // Single integer 1-30 OR `N-M` range with N,M integers 1-30.
      // Ceiling lowered 100 → 30 to mirror the system
      // prompt's "Plafond strict : jamais > 30" — a hallucinated "75" / "40-90"
      // used to pass and store a nonsense maturity window.
      var m = s.match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
      if (!m || !m[1]) return "";
      var lo = parseInt(m[1]);
      if (lo < 1 || lo > 30) return "";
      if (m[2]) {
        var hi = parseInt(m[2]);
        if (hi < 1 || hi > 30) return "";
        return lo + "-" + hi;
      }
      return String(lo);
    }
    // Field-length budgets. Generous enough for legit values, tight
    // enough to catch runaway generation (paragraph dumped into the
    // `name` field, etc).
    var CAP_NAME = 120;
    var CAP_BRAND = 100;
    var CAP_BLEND = 300;
    var CAP_DESC = 4000;

    function parseAndApply(text: any) {
      var cl = String(text)
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      var m =
        cl.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/) || cl.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(AI_ERR.noJson);
      var info = JSON.parse(m[0]);
      // Reject AI refusals at the name / description / blend level so
      // they don't replace the user's existing values.
      var safeName  = isRefusal(info.name)        ? "" : clipStr(info.name,  CAP_NAME);
      var safeBrand = isRefusal(info.brand)       ? "" : clipStr(info.brand, CAP_BRAND);
      var safeBlend = isRefusal(info.blend)       ? "" : clipStr(info.blend, CAP_BLEND);
      var safeDesc  = isRefusal(info.description) ? "" : clipStr(info.description, CAP_DESC);
      var safeAgingMax = validAgingMax(info.aging_max_years);
      // Preview mode — hand the normalised AI values to
      // the caller instead of writing to the form. Used by the
      // cross-check feature. Only the tobacco/wish branches are wired
      // (the pipe form has no DB and no cross-check).
      if (previewCallback && type !== "pipe") {
        var fvP = parseInt(info.force) || 0;
        var rnP = parseInt(info.room_note) || 0;
        var tsP = parseInt(info.taste) || 0;
        previewCallback({
          category: normCat(info.category) || "",
          cut: normCut(info.cut) || "",
          blend: safeBlend || "",
          force: Math.min(5, Math.max(0, fvP)),
          roomNote: Math.min(5, Math.max(0, rnP)),
          taste: Math.min(5, Math.max(0, tsP)),
          agingMax: safeAgingMax || "",
        });
        setAiLoad(false);
        return;
      }
      // Tag the source as the active provider for AICard display.
      setAiSource(aiProvider as any);
      if (type === "pipe") {
        setPipeForm(function (f: any) {
          if (f && f.id !== targetId) return f;   // another fiche is open now

          var validSh = normShape(info.shape || "") || f.shape;
          var lmm = parseFloat(info.length_mm);
          var wg = parseFloat(info.weight_g);
          var lenVal =
            !isNaN(lmm) && lmm > 0
              ? lengthUnit === "in"
                ? String((lmm / 25.4).toFixed(1))
                : String(Math.round(lmm))
              : f.length;
          var wgtVal =
            !isNaN(wg) && wg > 0
              ? weightUnit === "oz"
                ? String((wg / 28.35).toFixed(1))
                : String(Math.round(wg))
              : f.weight;
          var ft =
            info.filter &&
            ["9mm", "6mm", "Balsa", "Métal", "Hybride 6mm", "Hybride 9mm", "Autre"].indexOf(info.filter) >= 0
              ? info.filter
              : info.filter &&
                  (String(info.filter).toLowerCase() === "aucun" ||
                    String(info.filter).toLowerCase() === "none")
                ? ""
                : f.filterType;
          var cd = parseFloat(info.chamber_diameter_mm);
          var cdp = parseFloat(info.chamber_depth_mm);
          // ALWAYS MILLIMETRES, never `lengthUnit`. `length` and `weight`
          // legitimately follow the user's unit — their labels interpolate it
          // — but the CHAMBER pair does not: the form label hardcodes "(mm)",
          // the fiche prints " mm", `chamberVolumeCm3` documents mm and
          // CHAMBER_DIAMETER_MIN/MAX are 8-40 mm. They were given the length
          // field's treatment by mistake, so with the unit set to inches the
          // AI wrote 0.75 into a field the whole app reads as 0.75 mm: the
          // bowl-weight estimate collapsed to 0, and since `canSave` requires
          // a positive weight the session form's Save — and the tasting's
          // Ignite — stayed permanently greyed with nothing saying why. The
          // app's own validator flagged the value it had just written.
          var cdVal =
            !isNaN(cd) && cd > 0
              ? String(Math.round(cd))
              : f.chamberDiameter;
          var cdpVal =
            !isNaN(cdp) && cdp > 0
              ? String(Math.round(cdp))
              : f.chamberDepth;
          var bm =
            info.bowl_material && BOWL_MATS.indexOf(info.bowl_material) >= 0
              ? info.bowl_material
              : f.bowlMaterial;
          var sm =
            info.stem_material && STEM_MATS.indexOf(info.stem_material) >= 0
              ? info.stem_material
              : f.stemMaterial;
          // Finish follows the same FR-canonical +
          // validated-against-enum model as bowl / stem material. The
          // AI returns the FR value (Lisse / Rustiquée / Sablée /
          // Autre); anything off-list keeps the user's existing value.
          var fin =
            info.finish && (FINISHES as readonly string[]).indexOf(info.finish) >= 0
              ? info.finish
              : f.finish;
          return Object.assign({}, f, {
            name: safeName || f.name,
            brand: safeBrand || f.brand,
            shape: validSh,
            courbure: normBend(info.courbure || "") || f.courbure,
            length: lenVal,
            weight: wgtVal,
            filterType: ft,
            chamberDiameter: cdVal,
            chamberDepth: cdpVal,
            bowlMaterial: bm,
            stemMaterial: sm,
            finish: fin,
            description: safeDesc || f.description,
          });
        });
      } else if (type === "wish") {
        setWishForm(function (f: any) {
          if (f && f.id !== targetId) return f;   // another fiche is open now

          var fv = parseInt(info.force) || f.force || 0;
          var rn = parseInt(info.room_note) || f.roomNote || 0;
          var ts = parseInt(info.taste) || f.taste || 0;
          return Object.assign({}, f, {
            name: safeName || f.name,
            brand: safeBrand || f.brand,
            category: normCat(info.category) || f.category,
            blend: safeBlend || f.blend,
            cut: normCut(info.cut) || f.cut,
            force: Math.min(5, Math.max(0, fv)),
            roomNote: Math.min(5, Math.max(0, rn)),
            taste: Math.min(5, Math.max(0, ts)),
            agingMax: safeAgingMax || f.agingMax,
            description: safeDesc || f.description,
          });
        });
      } else {
        setForm(function (f: any) {
          if (f && f.id !== targetId) return f;   // another fiche is open now

          var fv = parseInt(info.force) || f.force || 0;
          var rn = parseInt(info.room_note) || f.roomNote || 0;
          var ts = parseInt(info.taste) || f.taste || 0;
          return Object.assign({}, f, {
            name: safeName || f.name,
            brand: safeBrand || f.brand,
            category: normCat(info.category) || f.category,
            blend: safeBlend || f.blend,
            cut: normCut(info.cut) || f.cut,
            force: Math.min(5, Math.max(0, fv)),
            roomNote: Math.min(5, Math.max(0, rn)),
            taste: Math.min(5, Math.max(0, ts)),
            agingMax: safeAgingMax || f.agingMax,
            description: safeDesc || f.description,
          });
        });
      }
      setAiLoad(false);
    }
    function onErr(e: any) {
      // In cross-check PREVIEW mode (previewCallback supplied) the
      // run must NEVER write the form. On AI error the DB-fallback below calls
      // applyDbHit → mutates the form; short-circuit to a plain error so
      // "Vérifier avec l'IA" that times out just shows the error instead of
      // silently overwriting the user's fields with DB values.
      if (previewCallback) { surfaceErr(e); return; }
      // A dead model must NOT be swallowed by the catalogue
      // fallback below. That fallback exists for TRANSIENT failures (timeout,
      // rate limit, network); a retired model fails on every future call, so
      // a silent catalogue fill would leave the user permanently
      // mis-configured — and every blend absent from the catalogue would keep
      // failing with no explanation. Surfacing costs nothing: the catalogue
      // fill is one tap away on the offer button under the brand field.
      if (isModelGoneError(e)) { surfaceErr(e); return; }
      // When AI is the PRIMARY source and it fails (timeout, rate limit, network), silently
      // fall back to the local DB before surfacing the error — the user
      // still gets a fill if the blend is in the catalog. Only applies
      // to tobacco/wish (pipe form has no DB coverage). Mirrors the
      // `primary` calculation in runAutoFill: undefined → "ai" too.
      var canDb = type === "tobacco" || type === "wish";
      if (canDb && autofillSource !== "local") {
        // Prefer the caller-supplied brand/name (scan chain) over the
        // form closure — after a tin scan the form setState hasn't landed, so
        // reading form.brand/name here looked up the EMPTY pre-scan values and
        // the catalog safety net silently missed on a flaky-network scan.
        var brand = (dbOverride && dbOverride.brand !== undefined)
          ? dbOverride.brand : (type === "wish" ? wishForm.brand : form.brand);
        var name = (dbOverride && dbOverride.name !== undefined)
          ? dbOverride.name : (type === "wish" ? wishForm.name : form.name);
        tobaccoDbLookup(brand, name, lang).then(function (hit) {
          if (hit) { applyDbHit(type, hit); return; }
          surfaceErr(e);
        });
        return;
      }
      surfaceErr(e);
    }
    function surfaceErr(e: any) {
      if (e && e.name === "AbortError") {
        setAiErr(t("err_ai_timeout"));
      } else if (isModelGoneError(e)) {
        // A retired model is a CONFIGURATION error with a two-tap
        // fix, not a wire failure. The raw provider sentence ("models/… is
        // not found for API version v1beta") told the user nothing.
        // Under "auto" there is nothing for the user to configure —
        // record the dead id so the next call skips it, and say so.
        if (isAutoModel()) {
          markModelDead(aiProvider, effModel);
          setAiErr(t("ai_err_model_auto"));
        } else setAiErr(t("ai_err_model_gone"));
      } else {
        // Provider error messages are displayed verbatim in
        // the UI (and end up on user screenshots). Redact anything that
        // looks like an API key before surfacing — Anthropic keys
        // (sk-ant-…), OpenAI keys (sk-…), Google keys (AIza…), and
        // key=… query params. Defensive: no provider currently echoes
        // the key back, but the blast radius if one ever does (or
        // proxies/gateways inject it) is a leaked credential.
        // Redaction extracted to redactApiKeys (module
        // scope) so the label-scan error path shares it.
        var msg = redactApiKeys(String((e && e.message) || e));
        // Same resolver as the label-scan sink below — a sentinel code
        // becomes translated text, a provider message still passes through.
        setAiErr(String(aiErrMessage(String(msg), t)).substring(0, 300));
      }
      setAiLoad(false);
    }
    // Abort after 60s — provider endpoints occasionally hang (especially
    // Anthropic with web_search tool). Without a timeout, aiLoad stays
    // true indefinitely and the spinner never resolves.
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId: any = null;
    if (ctrl) {
      var ctrlLocal = ctrl;
      // Back to 60s. Haiku 4.5 typically finishes in 15-25s
      // (the older Sonnet-era 90s margin isn't needed).
      timeoutId = setTimeout(function () { ctrlLocal.abort(); }, 60000);
    }
    function done() {
      if (timeoutId) clearTimeout(timeoutId);
    }
    if (aiProvider === "openai") {
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: effModel,
          ...openaiMaxTokensField(effModel, 512),
          messages: [
            { role: "system", content: sysp },
            { role: "user", content: up },
          ],
        }),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          done();
          if (d.error) throw providerError(d.error);
          // Guard against malformed / empty `choices` payloads
          // (rate-limited OpenAI returns 200 with `{ choices: [] }`,
          // future schema changes, etc.) — surface a readable error
          // instead of "Cannot read properties of undefined".
          var ch = d && Array.isArray(d.choices) ? d.choices[0] : null;
          var txt = ch && ch.message && ch.message.content;
          if (typeof txt !== "string" || !String(txt).trim()) throw new Error(t("err_ai_empty_response"));
          parseAndApply(txt);
        })
        .catch(function (e) { done(); onErr(e); });
    } else if (aiProvider === "gemini") {
      fetch(
        geminiUrl(effModel),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text:
                      sysp +
                      "\n\n" +
                      up,
                  },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 512 },
          }),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        },
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          done();
          if (d.error) throw providerError(d.error);
          // Guard against malformed / empty `candidates`
          // payloads (Gemini occasionally returns empty when safety
          // filters fire). Surface a readable error.
          var cand = d && Array.isArray(d.candidates) ? d.candidates[0] : null;
          var parts = cand && cand.content && Array.isArray(cand.content.parts)
            ? cand.content.parts[0] : null;
          var txt = parts && parts.text;
          if (typeof txt !== "string" || !String(txt).trim()) throw new Error(t("err_ai_empty_response"));
          parseAndApply(txt);
        })
        .catch(function (e) { done(); onErr(e); });
    } else {
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          // Haiku 4.5 is the default (fast enough on cellular).
          // The model is user-selectable per provider
          // (Settings → AI). `allowed_callers: ["direct"]` below is kept for
          // ALL Anthropic models — it's mandatory on Haiku (no PTC) and a
          // harmless restriction on Sonnet/Opus (they simply don't use PTC).
          model: effModel,
          max_tokens: 1024,
          system: sysp,
          tools: [
            // web_search_20260209 defaults to requiring programmatic
            // tool calling (PTC), which Haiku 4.5 doesn't support →
            // 400 "claude-haiku-4-5 does not support programmatic tool
            // calling". Explicitly pin `allowed_callers:
            // ["direct"]` to keep the tool on the direct-call path
            // (the exact escape hatch the API error message points to).
            // Dynamic filtering still only fires on Opus 4.6+ / Sonnet
            // 4.6, but the version string stays portable for the day
            // we revisit a smarter model.
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: 3,
              allowed_callers: ["direct"],
            },
          ],
          messages: [{ role: "user", content: up }],
        }),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          done();
          if (d.error) throw providerError(d.error);
          var at = "";
          (d.content || []).forEach(function (c: any) {
            if (c.type === "text")
              at +=
                c.text +
                "\n";
          });
          if (!String(at).trim()) throw new Error(t("err_ai_empty_response"));
          parseAndApply(at);
        })
        .catch(function (e) { done(); onErr(e); });
    }
  }

  // ── Label scan ───────────────────────────────────────────────────
  // Photo of the tin → vision request to the selected provider →
  // brand / name (+ blend when readable on the label) filled into the
  // tobacco or wishlist form. The answer must come from the image (no
  // web_search tool); the user then runs the normal "Chercher" to
  // complete the remaining fields. Scan overwrites brand/name (the
  // scan IS the user's intent) but only fills blend when empty.
  // LABEL-CONTRACT:start ai-tin-scan-upload — see scripts/label-contracts.json
  function aiScanLabel(kind: "tobacco" | "wish", file: File) {
    if (aiLoad) return;
    var scanModel = effectiveModel();
    if (!apiKey) {
      setAiErr(t("err_api_key"));
      return;
    }
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setAiErr(t("err_photo_size"));
      return;
    }
    setAiLoad(true);
    setAiErr("");
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId: any = null;
    if (ctrl) {
      var ctrlLocal = ctrl;
      timeoutId = setTimeout(function () { ctrlLocal.abort(); }, 45000);
    }
    function done() {
      if (timeoutId) clearTimeout(timeoutId);
    }
    function fail(e: any) {
      done();
      if (e && e.name === "AbortError") setAiErr(t("err_ai_timeout"));
      else if (isModelGoneError(e)) {
        if (isAutoModel()) { markModelDead(aiProvider, scanModel); setAiErr(t("ai_err_model_auto")); }
        else setAiErr(t("ai_err_model_gone"));
      }
      else setAiErr(String(aiErrMessage(String(redactApiKeys(String((e && e.message) || e))), t)).substring(0, 300));
      setAiLoad(false);
    }
    fileToScaledJpegBase64(file, 1024, 0.85)
      .then(function (b64) {
        var req = buildScanRequest(aiProvider, apiKey, b64, buildScanPrompt(lang), scanModel);
        return fetch(req.url, Object.assign({}, req.init, ctrl ? { signal: ctrl.signal } : {}));
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        done();
        if (d.error) throw providerError(d.error);
        var txt = "";
        if (aiProvider === "openai") {
          var ch = d && Array.isArray(d.choices) ? d.choices[0] : null;
          txt = (ch && ch.message && ch.message.content) || "";
        } else if (aiProvider === "gemini") {
          var cand = d && Array.isArray(d.candidates) ? d.candidates[0] : null;
          var parts = cand && cand.content && Array.isArray(cand.content.parts)
            ? cand.content.parts[0] : null;
          txt = (parts && parts.text) || "";
        } else {
          (d.content || []).forEach(function (c: any) {
            if (c.type === "text") txt += c.text + "\n";
          });
        }
        if (typeof txt !== "string" || !String(txt).trim()) throw new Error(t("err_ai_empty_response"));
        var parsed = parseScanResult(txt);
        if (!parsed) throw new Error(t("ai_scan_unreadable"));
        var res = parsed;
        var apply = function (f: any) {
          return Object.assign({}, f, {
            ...(res.brand ? { brand: res.brand } : {}),
            ...(res.name ? { name: res.name } : {}),
            ...(res.blend && !f.blend ? { blend: res.blend } : {}),
          });
        };
        if (kind === "wish") setWishForm(apply);
        else setForm(apply);
        // Chain the full auto-fill so ONE tap does
        // everything — the scan extracts brand + name from the photo,
        // the chained web search fills the rest (category, cut,
        // strength, aging…). The spinner stays on across both calls;
        // runAutoFill's completion paths clear it. The query comes
        // from the SCAN RESULT (not the form — its setState hasn't
        // re-rendered yet, the closure would read pre-scan values).
        runAutoFill(
          kind === "wish" ? "wish" : "tobacco",
          String((res.brand || "") + " " + (res.name || "") + " pipe tobacco").trim(),
          undefined,
          // Thread the scanned brand/name so the AI-failure DB
          // fallback in onErr uses them, not the stale pre-scan form.
          { brand: res.brand || "", name: res.name || "" },
        );
      })
      .catch(fail);
  }
  // LABEL-CONTRACT:end ai-tin-scan-upload

  // Cross-check actions for the "Vérifier avec l'IA" button.
  // After a DB hit (aiSource === "local"), the user can ask the AI to
  // look the blend up too. We capture the current form values (the DB
  // ones) and the AI response in `aiCompare`; AICard renders a small
  // diff Notice with two buttons.
  function aiCompareCheck(type: "tobacco" | "wish") {
    if (aiLoad) return;
    if (!apiKey) { setAiErr(t("err_api_key")); return; }
    var current = type === "wish" ? wishForm : form;
    setAiCompare(null);
    setAiErr("");
    // The "DB" column must reflect the actual DB
    // catalog values, not the current form values. If the user has
    // edited fields (or applied AI then re-clicked), reading from the
    // form would mis-label edited / AI-derived values as "DB". Look
    // the blend up directly in the DB at click time — guaranteed
    // genuine DB data, regardless of what's sitting in the form.
    tobaccoDbLookup(current.brand, current.name, lang).then(function (dbHit) {
      if (!dbHit) {
        setAiErr(t("ai_compare_no_db"));
        return;
      }
      var db = {
        category: dbHit.category,
        cut: dbHit.cut,
        blend: dbHit.blend,
        force: dbHit.force,
        roomNote: dbHit.roomNote,
        taste: dbHit.taste,
        agingMax: dbHit.agingMax,
      };
      runAutoFill(type, undefined, function (ai: any) {
        setAiCompare({ type: type, db: db, ai: ai });
      });
    });
  }
  function applyAiCompare() {
    if (!aiCompare) return;
    var setter = aiCompare.type === "wish" ? setWishForm : setForm;
    var ai = aiCompare.ai;
    setter(function (f: any) {
      return Object.assign({}, f, {
        category: ai.category || f.category,
        cut: ai.cut || f.cut,
        blend: ai.blend || f.blend,
        force: ai.force || f.force,
        roomNote: ai.roomNote || f.roomNote,
        taste: ai.taste || f.taste,
        agingMax: ai.agingMax || f.agingMax,
      });
    });
    setAiSource(aiProvider as any);
    setAiCompare(null);
  }
  function dismissAiCompare() { setAiCompare(null); }

  return {
    aiLoad,
    aiErr,
    setAiErr,
    apiKey,
    setApiKey,
    aiProvider,
    setAiProvider,
    excludeApiKey,
    setExcludeApiKey,
    saveApiKey,
    saveAiProvider,
    aiModel,
    aiModelResolved: effectiveModel(),
    modelProbe,
    probeModel,
    saveAiModel,
    aiAutoFill,
    aiScanLabel,
    aiSource,
    setAiSource,
    aiCompare,
    aiCompareCheck,
    applyAiCompare,
    dismissAiCompare,
  };
}
