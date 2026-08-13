/**
 * Error messages that reach the user must be translated.
 *
 * WHY THIS FILE EXISTS. The cloud hooks surface a caught error verbatim:
 *
 *     setGdriveStatus(t("err_prefix") + ": " + String(e.message).substring(0, 150))
 *
 * So any `throw new Error("<prose>")` upstream of one of those catches renders
 * That prose in every language. An earlier release fixed "Fichier corrompu" (a German
 * restoring a corrupt backup read "Fehler: Fichier corrompu") and "Google non
 * dispo"; a later pass found three more of the same shape in the other direction —
 * `"No token"` and `"invalid JSON"`, English technical prose shown to a French
 * user as "Erreur : No token".
 *
 * Both directions are the same defect: a literal in a language the reader may
 * not have. No lint rule sees it — `no-hardcoded-jsx-text` looks at JSX text,
 * and this is a function argument.
 *
 * WHAT IS DELIBERATELY ALLOWED. A bare HTTP STATUS (`"HTTP " + r.status`) is a
 * code, not prose: it reads the same in every language and is the one piece of
 * information that actually helps diagnose a failing request. Everything else
 * must come from `t()`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The files whose thrown messages are rendered verbatim to the user.
const RENDERS_MESSAGE = [
  "../hooks/useGdriveSync.ts",
  "../hooks/useGdriveAuth.ts",
  "../hooks/useDropboxAuth.ts",
];

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");


/**
 * The two literals that stay, each for a reason that is asserted below rather
 * than merely claimed — an unexplained exemption is what invites the next
 * sweep to either delete it or copy it.
 */
const EXEMPT: Record<string, string> = Object.assign(Object.create(null), {
  "no refresh token":
    "control flow, not a message: getToken() catches it and falls through to the " +
    "interactive redirect, so it can never reach a rendering catch. Asserted below.",
  "Web Crypto unavailable — cannot generate CSRF state":
    "a programmer-facing invariant failure in a module-level pure function with no " +
    "t() in scope. It fires only where crypto.getRandomValues is absent — impossible " +
    "in a browser running React 19 over the HTTPS this app forces — and the " +
    "alternative to throwing is a predictable CSRF state, which is a security bug. " +
    "Left in English deliberately.",
});

describe("user-facing error messages are translated", () => {
  it("the render-verbatim pattern still exists — or this whole file is moot", () => {
    // If the hooks stop echoing e.message, these assertions guard nothing and
    // somebody should be told rather than left with a green test.
    const s = src("../hooks/useGdriveSync.ts");
    expect(s, "useGdriveSync no longer renders e.message — re-scope this test")
      .toMatch(/setGdriveStatus\(t\("err_prefix"\)[^)]*e\.message/);
  });

  for (const f of RENDERS_MESSAGE) {
    it(`${f.split("/").pop()} throws no literal prose`, () => {
      const s = src(f);
      const bad: string[] = [];
      for (const m of s.matchAll(/new Error\(\s*"([^"]*)"/g)) {
        const msg = m[1]!;
        // A status code is universal and genuinely diagnostic.
        if (/^HTTP /.test(msg)) continue;
        // So is a SPACELESS kebab code ("photo-store-unreadable").
        // The point of this gate is that `e.message` is rendered verbatim, so it
        // must not be English PROSE — and prose always has spaces. Checked
        // against every historical defect this gate was written for: "No token",
        // "invalid JSON", "Fichier corrompu", "Google non dispo" and
        // "no refresh token" all contain a space and are all still flagged, so
        // the rule is not a loosening. The caller maps the code to a t() string
        // (see useExportImport.exportFailMsg).
        if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(msg)) continue;
        if (EXEMPT[msg]) continue;
        bad.push(msg);
      }
      expect(bad, `literal error prose: ${JSON.stringify(bad)}`).toEqual([]);
    });
  }

  it("the keys those messages now use exist in every language", () => {
    // A translated throw that resolves to a raw key would be worse than the
    // literal it replaced.
    const { LANGUAGES } = require("../i18n/languages.ts");
    for (const l of LANGUAGES) {
      const d = src(`../i18n/${l.code}.ts`);
      for (const k of ["err_drive_expired", "alert_invalid_file", "err_google_unavailable"]) {
        expect(d, `${k} missing from ${l.code}`).toMatch(new RegExp(`^\\s*${k}:"`, "m"));
      }
    }
  });

  it("the exempted Dropbox throw really is caught before it can render", () => {
    // The exemption rests entirely on this: if getToken ever stops catching,
    // "no refresh token" becomes user-visible English prose and the exemption
    // silently becomes wrong.
    const s = src("../hooks/useDropboxAuth.ts");
    expect(s, "getTokenSilent's rejection is no longer caught by getToken")
      .toMatch(/return getTokenSilent\(\)\.catch\(/);
  });

  it("every exemption states a reason", () => {
    for (const [msg, why] of Object.entries(EXEMPT)) {
      expect(why.length, `${msg} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The spaceless-code exemption must not become a way to shout prose past the
// gate. Pinned against every message this gate was originally written for.
describe("the code exemption is not a loosening", () => {
  const CODE = /^[a-z0-9]+(-[a-z0-9]+)+$/;

  it("accepts a kebab code", () => {
    for (const ok of ["photo-store-unreadable", "no-token", "quota-exceeded", "a-b"]) {
      expect(CODE.test(ok), ok).toBe(true);
    }
  });

  it("still rejects every historical defect, and prose in general", () => {
    // The four real ones, plus the documented exemption.
    for (const bad of [
      "No token", "invalid JSON", "Fichier corrompu", "Google non dispo",
      "no refresh token", "Web Crypto unavailable",
      "photo store unreadable (", "",              // the two shapes replaced
      "PHOTO-STORE-UNREADABLE",                    // shouting is not a code
      "photo store-unreadable",                    // one space is enough to be prose
    ]) {
      expect(CODE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("the export path maps the code to a translated sentence, never renders it raw", () => {
    const src = readFileSync(resolve(__dirname, "..", "hooks", "useExportImport.ts"), "utf8");
    expect(src).toContain('m === "photo-store-unreadable"');
    expect(src).toMatch(/t\("err_photos_unreadable"\)/);
    // …and the raw-message alert is gone from both export paths.
    expect((src.match(/alert\(exportFailMsg\(e\)\)/g) || []).length).toBe(2);
  });
});
