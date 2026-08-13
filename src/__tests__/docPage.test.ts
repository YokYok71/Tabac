// Language-agnostic doc-page extraction (changelog / privacy / licenses)
// + the shared pickLang fallback used by HelpView too.
import { describe, it, expect } from "vitest";
import {
  extractLangSection, extractBody, stripDocChrome, extractDocContent, pickLang,
} from "../utils/docPage.ts";

const BILINGUAL = `
<html><body>
  <script>var x=1;</script>
  <div id="sec-fr" class="section">
    <a class="back" href="./">← retour</a>
    <button class="lang-btn" onclick="switchLang()">EN</button>
    <h1>Titre FR</h1>
    <p class="subtitle">sous-titre</p>
    <h2>Section FR</h2>
    <p>Contenu FR.</p>
  </div>
  <div id="sec-en" class="section">
    <a class="back" href="./">← back</a>
    <h1>EN Title</h1>
    <h2>Section EN</h2>
    <p>EN content.</p>
  </div>
</body></html>`;

// A future third language needs NO code change — just a sec-<code> block.
const TRILINGUAL = BILINGUAL.replace(
  "</body>",
  `<div id="sec-es" class="section"><h1>ES</h1><h2>Sección ES</h2><p>Contenido ES.</p></div></body>`
);

const MONOLINGUAL = `
<html><head><style>x</style></head><body>
  <a class="back" href="./">← back</a>
  <h1>Licenses</h1>
  <h2>The app</h2>
  <p>MIT text.</p>
</body></html>`;

describe("extractLangSection", () => {
  it("slices the requested language block and stops at the next section", () => {
    const fr = extractLangSection(BILINGUAL, "fr")!;
    expect(fr).toContain("Section FR");
    expect(fr).toContain("Contenu FR");
    expect(fr).not.toContain("Section EN");
    expect(fr).not.toContain("EN content");
  });

  it("returns the EN block for lang=en", () => {
    const en = extractLangSection(BILINGUAL, "en")!;
    expect(en).toContain("Section EN");
    expect(en).not.toContain("Contenu FR");
  });

  it("falls back to en, then fr, for an untranslated language", () => {
    // BILINGUAL has no sec-de → falls back to en.
    expect(extractLangSection(BILINGUAL, "de")).toContain("Section EN");
    // A page with only fr → de falls all the way to fr.
    const frOnly = `<html><body><div id="sec-fr"><h2>F</h2><p>x</p></div></body></html>`;
    expect(extractLangSection(frOnly, "de")).toContain("<h2>F</h2>");
  });

  it("resolves a NEW language with zero code change (es)", () => {
    const es = extractLangSection(TRILINGUAL, "es")!;
    expect(es).toContain("Sección ES");
    expect(es).toContain("Contenido ES");
    expect(es).not.toContain("Section FR");
    expect(es).not.toContain("Section EN");
  });

  it("returns null on a page with no sec-* wrapper", () => {
    expect(extractLangSection(MONOLINGUAL, "fr")).toBeNull();
  });
});

describe("extractBody", () => {
  it("returns the whole body of a monolingual page", () => {
    const b = extractBody(MONOLINGUAL)!;
    expect(b).toContain("The app");
    expect(b).toContain("MIT text");
    expect(b).not.toContain("<style>");
  });
});

describe("stripDocChrome", () => {
  it("removes the wrapper open tag, script, back link, lang button and leading h1", () => {
    const s = stripDocChrome(extractLangSection(BILINGUAL, "fr")!);
    expect(s).not.toMatch(/class=["']back["']/);
    expect(s).not.toMatch(/class=["']lang-btn["']/);
    expect(s).not.toMatch(/<h1\b/);
    expect(s.trimStart().startsWith("<div")).toBe(false);
    // Real content survives.
    expect(s).toContain("Section FR");
    expect(s).toContain("sous-titre");
  });

  it("strips scripts via DOM parsing — no <script> element or payload survives", () => {
    // DOM parsing (vs the old single-pass `<script>…</script>` regex, flagged
    // by CodeQL js/bad-tag-filter) leaves no functional <script> behind.
    const s = stripDocChrome(
      `<div id="sec-fr"><script>window.evil=1</script><h2>OK</h2><p>keep</p></div>`,
    );
    expect(s).not.toContain("window.evil"); // payload gone
    expect(s).not.toMatch(/<script\b/i);
    expect(s).toContain("keep");
    expect(s).toContain("OK");
    // Re-parsing the cleaned output yields zero script elements.
    const reparsed = new DOMParser().parseFromString(s, "text/html");
    expect(reparsed.querySelectorAll("script").length).toBe(0);
  });
});

describe("extractDocContent", () => {
  it("bilingual: resolves language + strips chrome", () => {
    const fr = extractDocContent(BILINGUAL, "fr")!;
    expect(fr).toContain("Section FR");
    expect(fr).not.toMatch(/<h1\b/);
    expect(fr).not.toContain("Section EN");
  });

  it("monolingual: falls back to the whole body", () => {
    const lic = extractDocContent(MONOLINGUAL, "fr")!;
    expect(lic).toContain("The app");
    expect(lic).not.toMatch(/<h1\b/);
    expect(lic).not.toMatch(/class=["']back["']/);
  });

  it("returns null when there is no <body> and no sec-*", () => {
    expect(extractDocContent("<p>bare</p>", "fr")).toBeNull();
  });
});

describe("pickLang", () => {
  it("prefers the requested language", () => {
    expect(pickLang({ fr: "F", en: "E" }, "fr")).toBe("F");
    expect(pickLang({ fr: "F", en: "E" }, "en")).toBe("E");
  });
  it("falls back en → fr → first present", () => {
    expect(pickLang({ fr: "F", en: "E" }, "de")).toBe("E"); // en first
    expect(pickLang({ fr: "F" }, "de")).toBe("F");          // then fr
    expect(pickLang({ es: "S" }, "de")).toBe("S");          // then first
  });
  it("returns null for an empty map", () => {
    expect(pickLang({}, "fr")).toBeNull();
  });
});
