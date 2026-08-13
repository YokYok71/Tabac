import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractLangSection } from "../utils/docPage";
import { LANGUAGES } from "../i18n/languages";

// Anti-drift guard for the multilingual shipped doc pages (public/*.html).
//
// docPages.wellformed.test.ts locks each file's STRUCTURE per language
// (balanced tags, section anchors). This test locks CONTENT PARITY between
// the five language sections of the SAME file — the drift docPages and
// doc:check can't see:
//
//   • Value parity — the guide/privacy page quote concrete facts (25 g
//     threshold, ~1200-blend catalog, AES-GCM-256 + PBKDF2, the third-party
//     hosts). Same fact in every language ⇒ same occurrence count in every
//     language section. A value edited in one language only (the classic
//     "25 g became 50 g in German but nowhere else") diverges and fails.
//   • Structural parity — every language must carry the same number of
//     <h2>/<h3> blocks. A section/subsection dropped or added in one
//     language only diverges and fails.
//   • Changelog build parity — the set of "Build N" tags must be identical
//     across languages, so a changelog entry added to one language but
//     forgotten in the others is caught.

const PUB = resolve(process.cwd(), "public");
// Derived from the registry. It was the literal five codes, so
// this suite silently stopped covering a sixth language the day one was
// added — a guard reporting success on the languages it happened to look at.
const LANGS = LANGUAGES.map((l) => l.code);
const read = (f: string) => readFileSync(resolve(PUB, f), "utf8");

function sectionsOf(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LANGS) out[l] = extractLangSection(html, l) ?? "";
  return out;
}
const countOf = (hay: string, needle: string) => hay.split(needle).length - 1;
const tagCount = (hay: string, tag: string) => (hay.match(new RegExp(`<${tag}\\b`, "g")) || []).length;

// Per-file language-neutral value tokens (numbers, ratios, hosts) that
// carry the same fact in every language. NEVER add a token that legitimately
// differs per language (e.g. "90 min" — German phrases it "90 Minuten").
// (`catalogueFigure()` lived here — it derived the catalogue-size
// claim (« plus de N ») from the French section so every language had to quote
// The same number, saw a pinned literal fail for the wrong
// reason. The app ships no catalogue and the help no longer states a size: it
// is the user's own file, of whatever size they gave it.)

const VALUE_TOKENS: Record<string, string[]> = {
  "help.html": [
    "25 g",                          // low-stock / watch-list threshold
    "AES-GCM-256",                   // cloud-backup cipher
    "PBKDF2",                        // key derivation
    "nominatim.openstreetmap.org",   // reverse-geocoding host
    "console.anthropic.com",         // AI provider key host
    "smokingpipes.com",              // AI source priority #1
    "tobaccoreviews.com",            // AI source priority #2
    "OpenStreetMap",                 // map provider name
    "OAuth",                         // cloud auth
  ],
  "privacy.html": [
    "nominatim.openstreetmap.org",   // reverse geocoding
    "dropboxapi.com",                // Dropbox backup host
    "cdnjs.cloudflare.com",          // JSZip CDN
    "t-cellar.app",                  // canonical origin
  ],
};

describe("shipped doc pages — cross-language content parity", () => {
  for (const [file, tokens] of Object.entries(VALUE_TOKENS)) {
    describe(file, () => {
      const secs = sectionsOf(read(file));

      it("resolves all five language sections", () => {
        for (const l of LANGS) {
          expect(secs[l]!.length, `sec-${l} should be non-empty`).toBeGreaterThan(500);
        }
      });

      it("carries the same number of <h2>/<h3> blocks in every language", () => {
        const h2 = tagCount(secs.fr!, "h2");
        const h3 = tagCount(secs.fr!, "h3");
        for (const l of LANGS) {
          expect(tagCount(secs[l]!, "h2"), `<h2> count in sec-${l}`).toBe(h2);
          expect(tagCount(secs[l]!, "h3"), `<h3> count in sec-${l}`).toBe(h3);
        }
      });

      for (const token of tokens) {
        it(`"${token}" appears the same number of times in every language`, () => {
          const ref = countOf(secs.fr!, token);
          expect(ref, `"${token}" missing from the French reference`).toBeGreaterThan(0);
          for (const l of LANGS) {
            expect(
              countOf(secs[l]!, token),
              `"${token}" count in sec-${l} must match the French reference (${ref})`,
            ).toBe(ref);
          }
        });
      }
    });
  }

  describe("changelog.html", () => {
    const secs = sectionsOf(read("changelog.html"));
    const buildsOf = (html: string) =>
      [...html.matchAll(/Build (\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);

    it("resolves all five language sections", () => {
      for (const l of LANGS) {
        expect(secs[l]!.length, `sec-${l} should be non-empty`).toBeGreaterThan(500);
      }
    });

    it("carries the same number of <h2>/<h3> blocks in every language", () => {
      const h2 = tagCount(secs.fr!, "h2");
      const h3 = tagCount(secs.fr!, "h3");
      for (const l of LANGS) {
        expect(tagCount(secs[l]!, "h2"), `<h2> count in sec-${l}`).toBe(h2);
        expect(tagCount(secs[l]!, "h3"), `<h3> count in sec-${l}`).toBe(h3);
      }
    });

    it("lists the exact same set of Build numbers in every language", () => {
      const ref = buildsOf(secs.fr!);
      expect(ref.length, "French changelog should list at least one build").toBeGreaterThan(0);
      for (const l of LANGS) {
        expect(
          buildsOf(secs[l]!),
          `Build set in sec-${l} must match the French reference`,
        ).toEqual(ref);
      }
    });
  });
});
