import { describe, it, expect, beforeEach } from "vitest";
import {
  SETTINGS_KEYS, FORBIDDEN,
  collectSettings, sanitizeSettings, applySettings,
} from "../utils/appSettings.ts";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const docChecks = createRequire(import.meta.url)("../../scripts/docChecks.cjs");

// Preferences travel with the backup.
//
// The POSITIVE half of this file is ordinary. The NEGATIVE half is the reason
// it exists: the same localStorage holds live credentials — the Drive access
// token, the Dropbox REFRESH token, the OAuth CSRF state, the AI API keys — and
// a JSON export is a file people mail to themselves and paste into support
// threads. The tempting implementation ("sweep every cave-* key") would put a
// working credential in that file, and it would look perfectly correct.

describe("the allowlist cannot leak a credential", () => {
  it("shares not one key with the forbidden list", () => {
    const overlap = (SETTINGS_KEYS as readonly string[])
      .filter((k) => (FORBIDDEN as readonly string[]).indexOf(k) !== -1);
    expect(overlap).toEqual([]);
  });

  it("refuses every forbidden key on the way IN, one by one", () => {
    // Fed individually so a failure names the key that got through.
    for (const k of FORBIDDEN) {
      const out = sanitizeSettings({ [k]: "valeur-secrete" });
      expect(Object.keys(out), `${k} must never be imported`).toEqual([]);
    }
  });

  it("carries no key whose name suggests a secret", () => {
    // Belt and braces: a future addition to SETTINGS_KEYS that merely LOOKS
    // like a credential should fail here rather than ship.
    const smell = /(^|-)(tk|token|rt|secret|state|verifier|api-key|hint|pending)($|-)/;
    expect((SETTINGS_KEYS as readonly string[]).filter((k) => smell.test(k))).toEqual([]);
  });

  it("names every storage key the app actually treats as a credential", () => {
    // The FORBIDDEN list is only worth having if it is COMPLETE. The OAuth and
    // token helpers are the only places allowed to write credentials (the
    // no-raw-storage-write rule confines them there), so their literal keys are
    // the ground truth — read them from source rather than from memory.
    const files = [
      "src/hooks/useGdriveAuth.ts",
      "src/hooks/useDropboxAuth.ts",
      "src/utils/dropboxAuthCore.ts",
    ].map((f) => readFileSync(resolve(__dirname, "..", "..", f), "utf8")).join("\n");
    const CRED = /"((?:gdrive|dropbox)-(?:tk|rt|state|verifier|account-hint))"/g;
    const found = new Set<string>();
    for (const m of files.matchAll(CRED)) found.add(m[1]!);
    expect(found.size, "expected to find credential keys in the auth modules").toBeGreaterThan(2);
    for (const k of found) {
      expect(FORBIDDEN as readonly string[], `${k} is written by an auth module and must be forbidden`)
        .toContain(k);
    }
  });

  it("keeps the API key on its own opt-out channel, not in here", () => {
    // `cave-exclude-apikey` defaults to EXCLUDE. Carrying the key a
    // second time through _settings would silently defeat that.
    for (const k of ["anthropic-api-key", "openai-api-key", "gemini-api-key"]) {
      expect(SETTINGS_KEYS as readonly string[]).not.toContain(k);
    }
  });

  it("excludes the device-local cloud routing keys", () => {
    // Copying these onto a second device makes both claim one auto-file — the
    // convergence bug three earlier releases were spent fixing.
    for (const k of ["cave-device-id", "gdrive-auto-fid", "dropbox-auto-fid", "cave-device-name"]) {
      expect(SETTINGS_KEYS as readonly string[]).not.toContain(k);
      expect(FORBIDDEN as readonly string[]).toContain(k);
    }
  });
});

describe("collect / sanitize / apply", () => {
  beforeEach(() => { localStorage.clear(); });

  it("collects the preferences that are set, and omits the rest", () => {
    localStorage.setItem("cave-lang", "de");
    localStorage.setItem("cave-weight-unit", "oz");
    const out = collectSettings();
    expect(out["cave-lang"]).toBe("de");
    expect(out["cave-weight-unit"]).toBe("oz");
    expect(Object.keys(out).sort()).toEqual(["cave-lang", "cave-weight-unit"]);
  });

  it("does not collect a credential even when one is present", () => {
    localStorage.setItem("cave-lang", "fr");
    localStorage.setItem("dropbox-rt", "un-refresh-token-vivant");
    localStorage.setItem("gdrive-tk", JSON.stringify({ t: "ya29.xxx", x: 9e12 }));
    const out = collectSettings();
    expect(JSON.stringify(out)).not.toContain("refresh-token");
    expect(JSON.stringify(out)).not.toContain("ya29");
    expect(Object.keys(out)).toEqual(["cave-lang"]);
  });

  it("survives a forged or hand-edited block", () => {
    for (const bad of [null, undefined, 42, "texte", [], [{ "cave-lang": "de" }]]) {
      expect(sanitizeSettings(bad)).toEqual({});
    }
    // prototype pollution attempt + wrong value types + an over-long value
    const out = sanitizeSettings({
      __proto__: { polluted: true },
      "cave-lang": "de",
      "cave-theme": 42,                    // not a string
      "cave-currency": "",                 // empty
      "cave-sections": "x".repeat(5000),   // over the cap
      "pipe-cellar-v6": "{}",              // the cellar itself
    });
    expect(out).toEqual({ "cave-lang": "de" });
    expect(({} as any).polluted).toBeUndefined();
  });

  it("writes only sanitised keys, and reports how many landed", () => {
    const n = applySettings({ "cave-lang": "it", "cave-theme": "steel", "gdrive-tk": "secret" });
    expect(n).toBe(2);
    expect(localStorage.getItem("cave-lang")).toBe("it");
    expect(localStorage.getItem("cave-theme")).toBe("steel");
    expect(localStorage.getItem("gdrive-tk")).toBeNull();
  });

  it("round-trips: what is collected is exactly what applies back", () => {
    const set = { "cave-lang": "pt", "cave-font-scale": "l", "cave-currency": "£" };
    for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
    const exported = collectSettings();
    localStorage.clear();
    applySettings(exported);
    for (const [k, v] of Object.entries(set)) expect(localStorage.getItem(k)).toBe(v);
  });
});

describe("every exported key is a documented preference", () => {
  it("appears in the CLAUDE.md storage-keys table", () => {
    // The keys table is the reference for what the app stores. A preference we
    // now COPY INTO USER FILES had better be described there.
    // La table des clés a suivi la narration dans `docs/storage-keys.md` au
    // découpage du document ; on lit la MÊME liste que la porte (`DOC_FILES`),
    // sinon ce cas passerait en mesurant un fichier qui ne porte plus sa table.
    const root = resolve(__dirname, "..", "..");
    const doc = (docChecks.DOC_FILES as string[])
      .map((f) => readFileSync(resolve(root, f), "utf8"))
      .join("\n");
    const missing = (SETTINGS_KEYS as readonly string[]).filter((k) => doc.indexOf("`" + k + "`") === -1);
    expect(missing).toEqual([]);
  });

  it("is read somewhere in src/ — no dead preference is exported", () => {
    const root = resolve(__dirname, "..");
    const skip = new Set(["__tests__", "data"]);
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const src = walk(root)
      .filter((f) => !f.endsWith("appSettings.ts"))
      .map((f) => readFileSync(f, "utf8")).join("\n");
    // Some keys are BUILT, never written as a literal: the per-provider AI model
    // slot is `"ai-model-" + provider` (CLAUDE.md documents it). Accept the
    // prefix for those, so the check keeps its meaning instead of being dropped.
    const BUILT: Record<string, string> = { "ai-model-anthropic": "ai-model-", "ai-model-openai": "ai-model-", "ai-model-gemini": "ai-model-" };
    const orphan = (SETTINGS_KEYS as readonly string[]).filter((k) => {
      if (src.indexOf('"' + k + '"') !== -1) return false;
      const pre = BUILT[k];
      return !(pre && src.indexOf('"' + pre + '"') !== -1);
    });
    expect(orphan).toEqual([]);
  });
});

describe("the wiring — every backup channel carries the preferences", () => {
  // These are source assertions on purpose. The four payload builders are deep
  // inside hooks with cloud mocks and photo resolution; what can rot here is
  // simply that a NEW export path forgets the block, and that is visible in the
  // source. Comments are blanked first — a check satisfied by the comment
  // explaining the fix stays green under probe, a trap this repo has hit
  // repeatedly (doc:check gate 15, gridTracksCanShrink, topBannerInset).
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  const read = (f: string) => strip(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

  it("JSON export and ZIP backup both include _settings", () => {
    const src = read("src/hooks/useExportImport.ts");
    expect((src.match(/_settings: collectSettings\(\)/g) || []).length).toBe(2);
  });

  it("both cloud saves include _settings — manual AND the silent auto-save", () => {
    // The auto-save is the one that would be missed: it is silent, so nobody
    // would notice its payload lacked the block.
    const src = read("src/hooks/useGdriveSync.ts");
    expect((src.match(/_settings: collectSettings\(\)/g) || []).length).toBe(2);
  });

  it("the import strips _settings out of the data blob", () => {
    // Left in, it would be saved as a phantom field on the cellar itself.
    const src = read("src/hooks/useImportConfirm.ts");
    expect(src).toContain("delete staged._settings");
  });

  it("applies the preferences on REPLACE only, never on MERGE", () => {
    // The load-bearing rule: combining two cellars is not a reason to inherit
    // the other device's language, theme and units.
    const src = read("src/hooks/useImportConfirm.ts");
    const i = src.indexOf('if (mode === "replace")');
    const j = src.indexOf("} else {", i);
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, j)).toContain("applySettings(settings)");
    // …and exactly one call site in the whole module.
    expect((src.match(/applySettings\(/g) || []).length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `cave-drive-encryption-enabled` was on the allowlist and
// it DISABLED A SAFETY CHECK. Its companion `cave-drive-enc-verifier` is
// correctly forbidden and the passphrase is memory-only by design, so a REPLACE
// restore of a PLAINTEXT export (local exports are never encrypted) left the
// target with encryption ON, no passphrase and no verifier — and
// maybeEncryptPayload reads the verifier only to REJECT a mismatch, so absent it
// takes the lenient branch. The protection against "a typo silently
// mints a permanently unrecoverable backup" was off on that device, for good.
describe("a flag whose companion secret cannot travel must not travel", () => {
  it("does not carry the drive-encryption flag", () => {
    expect(SETTINGS_KEYS as readonly string[]).not.toContain("cave-drive-encryption-enabled");
  });

  it("…and refuses it on the way in, like any other off-list key", () => {
    expect(sanitizeSettings({ "cave-drive-encryption-enabled": "1" })).toEqual({});
  });

  it("keeps its companion verifier forbidden — the pair is what makes the rule", () => {
    // If the verifier ever became exportable this reasoning would change, so
    // assert the premise rather than trusting it.
    expect(FORBIDDEN as readonly string[]).toContain("cave-drive-enc-verifier");
  });

  it("still carries the destination and the auto-save preference", () => {
    // Those are ordinary preferences with no companion secret: the cloud TOKEN
    // is forbidden, and lacking it degrades visibly (the auto-save diagnostic
    // records `no-token`) instead of silently switching a check off.
    expect(SETTINGS_KEYS as readonly string[]).toContain("cave-cloud-provider");
    expect(SETTINGS_KEYS as readonly string[]).toContain("cave-autosave");
  });

  it("the encryption path still reads the verifier only to REJECT", () => {
    // The mechanism this finding depends on: no verifier → lenient branch. That
    // is why the flag must not arrive without one, and the day it becomes
    // fail-closed this test should be revisited rather than deleted.
    const src = readFileSync(resolve(__dirname, "..", "hooks", "useGdriveSync.ts"), "utf8");
    expect(src).toMatch(/if \(marker\) \{/);
    expect(src).toMatch(/Legacy installs with no/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// sanitizeSettings validated the KEY and the value's type and length, never the
// VALUE, so a hand-edited backup could put "kg" into cave-weight-unit or "999"
// into cave-font-scale — bypassing the App setters, which do validate. Most
// readers degrade gracefully, but --cave-font-scale goes straight into a CSS
// variable, so one forged value renders the app unusable.
describe("enumerable preferences have their value checked", () => {
  it("refuses a value outside the closed set", () => {
    expect(sanitizeSettings({ "cave-weight-unit": "kg" })).toEqual({});
    expect(sanitizeSettings({ "cave-font-scale": "999" })).toEqual({});
    expect(sanitizeSettings({ "cave-theme-mode": "neon" })).toEqual({});
    expect(sanitizeSettings({ "ai-provider": "evilcorp" })).toEqual({});
    expect(sanitizeSettings({ "cave-cloud-provider": "ftp" })).toEqual({});
  });

  it("accepts every legitimate value", () => {
    for (const [k, v] of Object.entries({
      "cave-weight-unit": "oz", "cave-length-unit": "in", "cave-font-scale": "l",
      "cave-theme-mode": "light", "cave-date-format": "en", "cave-wish-sort": "brand",
      "ai-provider": "gemini", "cave-cloud-provider": "dropbox", "cave-autosave": "1",
      "cave-accounting-enabled": "0", "cave-settings-tab": "prefs",
    })) {
      expect(sanitizeSettings({ [k]: v }), `${k}=${v}`).toEqual({ [k]: v });
    }
  });

  it("leaves FREE-FORM preferences alone rather than inventing bounds", () => {
    // A threshold or the JSON section map has no enumerable answer, its readers
    // already coerce it, and bounds here would be a second source of truth for
    // the App setters to drift from.
    expect(sanitizeSettings({ "cave-watch-low-weight": "37" })).toEqual({ "cave-watch-low-weight": "37" });
    expect(sanitizeSettings({ "cave-sections": '{"stats":false}' })).toEqual({ "cave-sections": '{"stats":false}' });
    expect(sanitizeSettings({ "cave-currency": "£" })).toEqual({ "cave-currency": "£" });
  });

  it("a forged font scale can no longer reach the CSS variable", () => {
    localStorage.clear();
    applySettings({ "cave-font-scale": "999", "cave-lang": "fr" });
    expect(localStorage.getItem("cave-font-scale")).toBeNull();
    expect(localStorage.getItem("cave-lang")).toBe("fr");
  });
});
