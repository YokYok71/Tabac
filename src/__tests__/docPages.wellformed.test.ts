import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractLangSection, extractDocContent } from "../utils/docPage";
import { LANGUAGES } from "../i18n/languages";

// "blinder le bug du doc". The in-app doc pages (changelog /
// privacy / licenses, rendered by DocPageView, and help by HelpView) are
// SLICED out of the shipped public/*.html by language and injected via
// dangerouslySetInnerHTML. A single malformed tag (a stray </div>, an
// unclosed <ul>/<li>) silently ejects or merges entries — the classic
// "doc bug" that has bitten this project before. These tests parse the
// REAL shipped files (the source of truth) and fail if any language block
// is structurally broken, so the regression can't reach production again.

const PUB = resolve(process.cwd(), "public");
const read = (f: string) => readFileSync(resolve(PUB, f), "utf8");

// DERIVED from the registry, not a copy of it. An earlier release found six sites that
// each hardcoded the five codes and each fell back silently; a test file that
// does the same reports "5 languages are well-formed" while the sixth ships
// unparsed — the failure this whole file exists to prevent, one level up.
const LANGS = LANGUAGES.map((l) => l.code);

// Count opening vs closing occurrences of a tag in a raw HTML slice.
function balanced(html: string, tag: string): [number, number] {
  const open = (html.match(new RegExp(`<${tag}(\\s|>)`, "gi")) || []).length;
  const close = (html.match(new RegExp(`</${tag}>`, "gi")) || []).length;
  return [open, close];
}

describe("shipped doc pages — structural well-formedness", () => {
  for (const file of ["changelog.html", "privacy.html"]) {
    describe(file, () => {
      const html = read(file);

      for (const lang of LANGS) {
        it(`sec-${lang}: balanced div / ul / li / h2 / h3 tags`, () => {
          const region = extractLangSection(html, lang);
          expect(region).toBeTruthy();
          for (const tag of ["div", "ul", "ol", "li", "h2", "h3"]) {
            const [open, close] = balanced(region!, tag);
            expect(open, `<${tag}> open vs close in ${file} sec-${lang}`).toBe(close);
          }
        });

        it(`sec-${lang}: renders non-empty content with titled sections`, () => {
          const body = extractDocContent(html, lang);
          expect(body, `${file} sec-${lang} extracted empty`).toBeTruthy();
          const doc = new DOMParser().parseFromString(`<div>${body}</div>`, "text/html");
          const h2s = [...doc.querySelectorAll("h2")];
          expect(h2s.length, `${file} sec-${lang} has no <h2>`).toBeGreaterThan(0);
          // Every section heading must carry visible text — a title-less
          // card is the exact symptom of the ejection bug.
          for (const h2 of h2s) {
            expect((h2.textContent || "").trim().length, "empty <h2> title").toBeGreaterThan(0);
          }
        });
      }

      it("every language block has the SAME number of entries (no dropped/merged section)", () => {
        const counts = LANGS.map((lang) => {
          const body = extractDocContent(html, lang) || "";
          const doc = new DOMParser().parseFromString(`<div>${body}</div>`, "text/html");
          return doc.querySelectorAll("h2").length;
        });
        // all equal to the first
        for (const c of counts) expect(c).toBe(counts[0]);
      });
    });
  }

  it("licenses.html (English-only) extracts non-empty body", () => {
    const body = extractDocContent(read("licenses.html"), "fr");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });

  it("help.html: every language block has balanced tags", () => {
    const html = read("help.html");
    for (const lang of LANGS) {
      const region = extractLangSection(html, lang);
      expect(region).toBeTruthy();
      for (const tag of ["div", "ul", "ol", "li", "h2", "h3"]) {
        const [open, close] = balanced(region!, tag);
        expect(open, `<${tag}> open vs close in help.html sec-${lang}`).toBe(close);
      }
    }
  });
});

// The language toggle must not narrow a global preference.
//
// Every doc page with a toggle ships the SAME inline script, and it writes the
// chosen language to `cave-lang`, i.e. it doubles as the app's language
// switcher. That is correct only while the page carries all five languages.
// A page carrying only fr/en used to ship, so an es/de/it reader who tapped the
// toggle had their WHOLE app switched to French by a page that could not offer
// their language back — the toggle only cycled fr↔en. Replaying the real logic
// confirmed it wrote cave-lang="fr".
//
// The rule: persist only when the stored language is one this page actually
// carries. Generic, so it costs nothing on the full-language pages — which is
// every doc page today, hence the SYNTHETIC subset fixture below.
describe("doc page language toggle", () => {
  const TOGGLE_PAGES = ["help.html", "changelog.html", "privacy.html"];
  const script = (f: string) => {
    const m = read(f).match(/<script>\s*\(function\(\)\{[\s\S]*?\}\)\(\);\s*<\/script>/);
    expect(m, `${f} should carry the shared toggle script`).toBeTruthy();
    return m![0];
  };

  it("is byte-identical across every page that has one", () => {
    // Several copies of one script is exactly the shape that drifts; a
    // per-page fix would have been the wrong shape for this bug. It has
    // caught a half-applied comment rewrite since.
    const scripts = TOGGLE_PAGES.map(script);
    for (const s of scripts) expect(s).toBe(scripts[0]);
  });

  // An earlier release asserted the SOURCE TEXT of the guard (a regex over
  // `var persist=c.indexOf(lang)>=0;`) and called that "locked". It proved only
  // that the line had been typed. The logic was wrong — `persist` read `lang`,
  // which the same function rewrites one line later, so every tap after the
  // first sailed through — and the test could never have noticed, because it
  // never RAN anything. These tests execute the shipped script instead.
  const runToggle = (file: string, stored: string, taps: number, asLangs?: string[]) => {
    const src = script(file);
    // `asLangs` runs the REAL shipped script against a HYPOTHETICAL page
    // carrying only those languages. The guard's whole purpose is a page that
    // is a language SUBSET, and no such page ships any more — so without this
    // the cases below would have no subject and would silently verify nothing.
    // Only the section list is synthetic; the code under test is the shipped one.
    const sections = asLangs ?? (read(file).match(/id="sec-([a-z]{2,3})"/g) || [])
      .map((m) => m.slice(8, -1));
    const store: Record<string, string> = {};
    if (stored) store["cave-lang"] = stored;
    // Minimal DOM + localStorage stand-ins: the script only needs the section
    // ids, the .lang-btn labels and documentElement.lang.
    const blocks = sections.map((c) => ({ id: "sec-" + c, className: "", }));
    // The stub must HONOUR the selector, not pattern-match its text. A first
    // version returned the blocks whenever the selector merely contained
    // "sec-", so changing the shipped selector to `.sec-block` — a class present
    // in none of the pages, which kills the toggle in a real browser — passed
    // all 29 tests. A test double that answers a question the real DOM would
    // refuse is worse than no double at all.
    const buttons = [{ textContent: "" }];
    const sandbox = {
      localStorage: {
        getItem: (k: string) => (k in store ? store[k]! : null),
        setItem: (k: string, v: string) => { store[k] = v; },
      },
      document: {
        querySelectorAll: (sel: string) => {
          if (sel === '[id^="sec-"]') return blocks;
          if (sel === ".lang-btn") return buttons;
          return [];
        },
        addEventListener: () => {},
        documentElement: { lang: "" },
      },
      window: {} as Record<string, any>,
    };
    const fn = new Function("localStorage", "document", "window", src.replace(/<\/?script>/g, ""));
    fn(sandbox.localStorage, sandbox.document, sandbox.window);
    const out: string[] = [];
    for (let i = 0; i < taps; i++) {
      sandbox.window.switchLang();
      out.push(store["cave-lang"] ?? "(unset)");
    }
    return out;
  };

  // A SUBSET page — the case the guard exists for. It is synthetic on purpose:
  // the fr/en archive that used to supply it was deleted with the version
  // reset, and a case whose subject has been deleted verifies nothing while
  // reading as if it did. Synthetic is also STRONGER than the archive was: the
  // old fixture would have gone silently vacuous the day someone translated
  // that page, which its own comment admitted.
  const SUBSET = ["fr", "en"];

  it("NEVER overwrites a global preference the page cannot offer — on any tap", () => {
    // The bug: tap 1 was guarded, tap 2 wrote "en". Four taps here so a
    // one-tap-deep fix cannot pass again.
    // Every language a fr/en page CANNOT offer back — derived from the registry
    // rather than listed, because a hardcoded list froze once already and left
    // the newest language, the likeliest to be narrowed away, unchecked.
    for (const stored of LANGS.filter((l) => !SUBSET.includes(l))) {
      const seen = runToggle("help.html", stored, 4, SUBSET);
      expect(new Set(seen), `subset page toggled ${stored} away: ${seen.join(",")}`)
        .toEqual(new Set([stored]));
    }
  });

  it("still follows a real choice made among the languages the page DOES carry", () => {
    // The guard must not freeze the toggle for a reader whose language IS there.
    expect(runToggle("help.html", "fr", 1, SUBSET)).toEqual(["en"]);
    expect(runToggle("help.html", "en", 1, SUBSET)).toEqual(["fr"]);
  });

  it("persists on a full-language page, including with no preference stored yet", () => {
    // An earlier release broke this second case: c.indexOf("") is -1, so a visitor arriving
    // from a bookmark or the "open the web version" link lost their first choice.
    //
    // Assert the VALUE, not merely that something was written. A first version
    // checked only `not.toBe("(unset)")`, so replacing the write with a constant
    // `setItem("cave-lang","fr")` — which switches a German reader to French on
    // one tap — passed.
    const codes = (read("help.html").match(/id="sec-([a-z]{2,3})"/g) || [])
      .map((m) => m.slice(8, -1));
    // Derived, not the literal 5 it used to be: this file exists so that a
    // sixth language cannot slip through unnoticed, and a hardcoded count is
    // exactly how it would have.
    expect(codes.length).toBe(LANGS.length);
    for (const stored of ["es", ""]) {
      const seen = runToggle("help.html", stored, 2);
      expect(seen[0], "nothing was persisted").not.toBe("(unset)");
      // It must land on one of the page's OWN languages...
      expect(codes).toContain(seen[0]);
      // ...and actually cycle, rather than writing a fixed value every time.
      expect(seen[1], `toggle wrote a constant: ${seen.join(",")}`).not.toBe(seen[0]);
    }
  });

  it("every shipped doc page carries EVERY UI language", () => {
    // So the guard never fires in production today — that is the point of the
    // case above being synthetic. Should a page ever ship a subset, it inherits
    // the protection automatically, because the script is shared and this file
    // asserts it is byte-identical everywhere.
    const sections = (f: string) => (read(f).match(/id="sec-([a-z]{2,3})"/g) || []).length;
    for (const f of TOGGLE_PAGES) {
      expect(sections(f), `${f} should carry every UI language`).toBe(LANGS.length);
    }
  });
});
