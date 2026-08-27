/**
 * Tests for three more doc-check gates (scripts/docChecks.cjs):
 * the repository-structure tree, the privacy-domain disclosure, and the
 * APP_BUILD bump gate.
 *
 * WHY THESE THREE. They are the gates whose logic is least obvious from
 * reading it — the tree parser carries a directory stack across lines, the
 * domain gate decides what "disclosed" means (including a prose mapping), and
 * the bump gate encodes a precedence that is wrong in both directions if
 * flipped. As with the i18n gates: what matters most is that they still FAIL
 * when they should, because a guard that quietly stops firing reads as
 * "verified" while verifying nothing.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";

const requireCjs = createRequire(import.meta.url);
const D = requireCjs("../../scripts/docChecks.cjs");

describe("extractTreePaths", () => {
  const tree = [
    "# heading",
    "",
    "## Repository Structure",
    "",
    "```",
    "/",
    "├── index.html            # Vite entry point",
    "├── package.json",
    "│",
    "├── src/",
    "│   ├── main.jsx          # React root",
    "│   ├── utils/",
    "│   │   ├── lotUtils.ts",
    "│   │   └── imgCache.ts   # IndexedDB cache",
    "│   └── App.tsx",
    "│",
    "└── public/",
    "    ├── sw.js",
    "    └── fonts/",
    "        └── dm-sans-var.woff2",
    "```",
    "",
    "## Next section",
  ].join("\n");

  it("resolves nested paths through the directory stack", () => {
    const { paths, errors } = D.extractTreePaths(tree);
    expect(errors).toEqual([]);
    const rels = paths.map((p: any) => p.rel);
    expect(rels).toContain("index.html");
    expect(rels).toContain("src/main.jsx");
    expect(rels).toContain("src/utils/lotUtils.ts");
    expect(rels).toContain("src/utils/imgCache.ts");
    expect(rels).toContain("src/App.tsx");           // back UP a level
    expect(rels).toContain("public/sw.js");
    expect(rels).toContain("public/fonts/dm-sans-var.woff2");
  });

  it("marks directories and strips their trailing slash from the path", () => {
    const { paths } = D.extractTreePaths(tree);
    const dir = paths.find((p: any) => p.rel === "src");
    expect(dir).toBeTruthy();
    expect(dir.isDir).toBe(true);
    expect(paths.find((p: any) => p.rel === "src/utils").isDir).toBe(true);
    expect(paths.find((p: any) => p.rel === "src/App.tsx").isDir).toBe(false);
  });

  it("strips inline comments, so a path is never a whole line", () => {
    const { paths } = D.extractTreePaths(tree);
    expect(paths.map((p: any) => p.rel)).not.toContain("index.html            # Vite entry point");
  });

  it("skips glob and brace entries — they are patterns, not files", () => {
    const globbed = tree.replace("│   └── App.tsx", "│   └── *.test.ts")
      .replace("        └── dm-sans-var.woff2", "        └── ibm-plex-mono-{400,700}.woff2");
    const rels = D.extractTreePaths(globbed).paths.map((p: any) => p.rel);
    expect(rels.some((r: string) => r.includes("*"))).toBe(false);
    expect(rels.some((r: string) => r.includes("{"))).toBe(false);
  });

  it("reports a missing heading or fence instead of throwing", () => {
    expect(D.extractTreePaths("# nothing here").errors[0]).toMatch(/not found/);
    expect(D.extractTreePaths("## Repository Structure\nno fence").errors[0]).toMatch(/fence/);
  });

  it("the SHIPPED tree parses, and every path it lists exists", () => {
    // The same assertion doc:check makes — here so a stale tree also breaks
    // `npm test`, and so this module is proven against the real document.
    // Le document est SEPT fichiers depuis le découpage : l'arbre a suivi la
    // narration dans `docs/architecture.md`, donc lire `CLAUDE.md` seul
    // mesurerait un document qui ne contient plus son sujet — et
    // `extractTreePaths` rapporterait « section not found », c'est-à-dire un
    // échec bruyant plutôt qu'une passe à vide. La concaténation est celle que
    // la porte elle-même construit.
    const md = D.DOC_FILES.map((f: string) => readFileSync(f, "utf8")).join("\n");
    const { paths, errors } = D.extractTreePaths(md);
    expect(errors).toEqual([]);
    expect(paths.length).toBeGreaterThan(50);
    const missing = paths.filter((p: any) => !existsSync(p.rel)).map((p: any) => p.rel);
    expect(missing).toEqual([]);
  });
});

describe("extractDomains", () => {
  it("finds every https host, including inside comments and templates", () => {
    const hosts = D.extractDomains(
      'const a = "https://api.anthropic.com/v1/messages";\n' +
      "// see https://developers.google.com/drive\n" +
      "const u = `https://content.dropboxapi.com/2/files/upload`;",
    );
    expect([...hosts].sort()).toEqual([
      "api.anthropic.com", "content.dropboxapi.com", "developers.google.com",
    ]);
  });

  it("ignores http:// and bare words", () => {
    const hosts = D.extractDomains('http://insecure.example "not a url" https://ok.test');
    expect([...hosts]).toEqual(["ok.test"]);
  });
});

describe("domainDisclosed / findUndisclosedDomains", () => {
  const policy = "We send blend names to Anthropic. Backups go to api.dropboxapi.com.";
  const evidence = { "api.anthropic.com": ["Anthropic"] };

  it("accepts a verbatim host and a prose mapping", () => {
    expect(D.domainDisclosed("api.dropboxapi.com", policy, evidence)).toBe(true);
    expect(D.domainDisclosed("api.anthropic.com", policy, evidence)).toBe(true);
  });

  it("FLAGS an undisclosed host — the corsproxy case", () => {
    // This is the gate's reason to exist: an image proxy lived in the pipeline
    // and was absent from the policy.
    expect(D.domainDisclosed("corsproxy.io", policy, evidence)).toBe(false);
    expect(D.findUndisclosedDomains(["corsproxy.io", "api.dropboxapi.com"], policy, { evidence }))
      .toEqual(["corsproxy.io"]);
  });

  it("honours the ignore list for placeholders and tapped links", () => {
    expect(D.findUndisclosedDomains(["example.com", "corsproxy.io"], policy, {
      ignore: new Set(["example.com"]), evidence,
    })).toEqual(["corsproxy.io"]);
    // An array is accepted as well as a Set.
    expect(D.findUndisclosedDomains(["example.com"], policy, { ignore: ["example.com"] })).toEqual([]);
  });

  it("is prototype-safe — a forged host cannot borrow Object.prototype", () => {
    // `hosts` comes from parsing source files, so the evidence lookup is
    // indexed by untrusted-ish strings.
    expect(D.domainDisclosed("constructor", "policy text", {})).toBe(false);
    expect(D.domainDisclosed("__proto__", "policy text", {})).toBe(false);
  });

  it("returns hosts sorted, so the report is stable", () => {
    expect(D.findUndisclosedDomains(["z.test", "a.test"], "", {})).toEqual(["a.test", "z.test"]);
  });
});

describe("findUserVisibleChanges (the APP_BUILD bump gate)", () => {
  // The real lists, in miniature.
  const VISIBLE = [/^src\/views\//, /^src\/hooks\//, /^src\/utils\//, /^src\/App\.tsx$/, /^public\/sw\.js$/];
  const NEVER = [/\.test\.(ts|tsx)$/, /^src\/__tests__\//, /^scripts\//, /^public\/changelog\.html$/];

  it("flags a changed view / hook / util / App.tsx", () => {
    const files = ["src/views/curator/HomeViewV2.tsx", "src/hooks/useGdriveSync.ts",
      "src/utils/lotUtils.ts", "src/App.tsx"];
    expect(D.findUserVisibleChanges(files, VISIBLE, NEVER)).toEqual(files);
  });

  it("NEVER-visible wins over visible — the precedence that matters", () => {
    // `src/utils/foo.test.ts` matches ^src/utils/ but is a test; flipping the
    // precedence would fail every test-only commit and train people to use
    // DOC_CHECK_SKIP_BUMP, which costs more than the gate is worth.
    expect(D.findUserVisibleChanges(["src/utils/lotUtils.test.ts"], VISIBLE, NEVER)).toEqual([]);
    expect(D.findUserVisibleChanges(["src/__tests__/curator/HomeViewV2.test.tsx"], VISIBLE, NEVER)).toEqual([]);
  });

  it("lets docs, scripts and CI through", () => {
    expect(D.findUserVisibleChanges(
      ["scripts/doc-check.cjs", "public/changelog.html", "CLAUDE.md", ".github/workflows/ci.yml"],
      VISIBLE, NEVER,
    )).toEqual([]);
  });

  it("returns only the offenders from a mixed batch", () => {
    expect(D.findUserVisibleChanges(
      ["CLAUDE.md", "src/views/curator/StatsView.tsx", "src/__tests__/x.test.ts", "public/sw.js"],
      VISIBLE, NEVER,
    )).toEqual(["src/views/curator/StatsView.tsx", "public/sw.js"]);
  });

  it("handles an empty batch and missing pattern lists", () => {
    expect(D.findUserVisibleChanges([], VISIBLE, NEVER)).toEqual([]);
    expect(D.findUserVisibleChanges(["src/App.tsx"], undefined, undefined)).toEqual([]);
  });
});

describe("resolveBumpSkip (the escape hatch is an acknowledgement, not a shortcut)", () => {
  // Written because the PROSE rule — "use the hatch only when the batch is
  // genuinely runtime-neutral" — was in CLAUDE.md and got broken twice in one
  // session, both times by taking the hatch without opening the diff. The
  // guard is enforced nowhere else: both workflows pass DOC_CHECK_SKIP_BUMP=1
  // unconditionally, so locally it is the only thing standing between a
  // user-visible change and a build number that never moves.
  const OFF = ["src/utils/userCatalogue.ts", "src/views/curator/WishFormView.tsx"];

  it("no flag — the gate runs", () => {
    expect(D.resolveBumpSkip({ raw: undefined, isCI: false, offenders: OFF }).skip).toBe(false);
    expect(D.resolveBumpSkip({ raw: "", isCI: false, offenders: OFF }).skip).toBe(false);
    expect(D.resolveBumpSkip({ raw: "   ", isCI: false, offenders: OFF }).skip).toBe(false);
  });

  it("a bare 1 is accepted in CI and REFUSED outside it", () => {
    // CI's skip has a different justification and stays: on a branch that has
    // not bumped, comparing against the last bump commit is meaningless, and
    // the checkout is shallow. A human gets no such excuse.
    expect(D.resolveBumpSkip({ raw: "1", isCI: true, offenders: OFF })).toEqual({
      skip: true, error: null,
    });
    const local = D.resolveBumpSkip({ raw: "1", isCI: false, offenders: OFF });
    expect(local.skip).toBe(false);
    expect(local.error).toBeTruthy();
  });

  it("the refusal PRINTS the list, so the next command cannot be typed blind", () => {
    const r = D.resolveBumpSkip({ raw: "1", isCI: false, offenders: OFF });
    for (const f of OFF) expect(r.error).toContain(f);
  });

  it("naming the flagged files exactly is what buys the skip", () => {
    expect(D.resolveBumpSkip({ raw: OFF.join(","), isCI: false, offenders: OFF })).toEqual({
      skip: true, error: null,
    });
    // Whitespace, mixed separators and stray spaces are all the same list —
    // the check is about having READ the names, not about typing punctuation.
    expect(D.resolveBumpSkip({ raw: OFF.join(" "), isCI: false, offenders: OFF }).skip).toBe(true);
    expect(D.resolveBumpSkip({ raw: " " + OFF.join(" ,  ") + " ", isCI: false, offenders: OFF }).skip).toBe(true);
    // Order is not part of the acknowledgement.
    expect(D.resolveBumpSkip({ raw: [...OFF].reverse().join(","), isCI: false, offenders: OFF }).skip).toBe(true);
  });

  it("an INCOMPLETE list is refused — acknowledging one file is not acknowledging two", () => {
    const r = D.resolveBumpSkip({ raw: OFF[0]!, isCI: false, offenders: OFF });
    expect(r.skip).toBe(false);
    expect(r.error).toContain("not acknowledged");
    expect(r.error).toContain(OFF[1]!);
  });

  it("a list naming something the gate did NOT flag is refused", () => {
    // Guards the obvious way round the rule: pasting a plausible-looking list
    // rather than the printed one. It also catches a genuinely stale list,
    // which is the honest case — the diff moved since it was read.
    const r = D.resolveBumpSkip({ raw: "src/App.tsx", isCI: false, offenders: OFF });
    expect(r.skip).toBe(false);
    expect(r.error).toContain("named but not flagged");
    expect(r.error).toContain("src/App.tsx");
  });

  it("an empty offender set short-circuits — a flag with nothing to skip is not an error", () => {
    // Failing here would be the over-strict mistake: the gate would not have
    // fired anyway, so complaining about a redundant flag teaches nothing and
    // makes the guard something people route around.
    for (const raw of ["1", "src/App.tsx", "anything at all"]) {
      expect(D.resolveBumpSkip({ raw, isCI: false, offenders: [] })).toEqual({
        skip: true, error: null,
      });
    }
  });

  it("survives a malformed call", () => {
    expect(D.resolveBumpSkip(undefined as any).skip).toBe(false);
    expect(D.resolveBumpSkip({} as any).skip).toBe(false);
    expect(D.resolveBumpSkip({ raw: "1", isCI: false, offenders: undefined } as any).skip).toBe(true);
    // A null in the list must not be acknowledged by an empty string.
    expect(D.resolveBumpSkip({ raw: "1", isCI: false, offenders: [null, "src/App.tsx"] } as any).skip).toBe(false);
  });
});

describe("checkVersions", () => {
  const ok = {
    constants: 'export var APP_VERSION = "1.5";\nexport var APP_BUILD = "29";\nexport var APP_GENERATION = 1;',
    versionJson: { version: "1.5", build: "29", generation: 1 },
    packageJson: { version: "1.5.0" },
    changelog: '<h2><span class="tag">v1.5 · Build 27</span> Something</h2>',
  };

  it("passes when all four agree and the changelog lags", () => {
    expect(D.checkVersions(ok)).toEqual([]);
  });

  it("catches each number drifting on its own", () => {
    expect(D.checkVersions({ ...ok, versionJson: { version: "1.4", build: "29" } })[0])
      .toMatch(/version\.json\.version/);
    expect(D.checkVersions({ ...ok, versionJson: { version: "1.5", build: "28" } })[0])
      .toMatch(/version\.json\.build/);
    expect(D.checkVersions({ ...ok, packageJson: { version: "9.9.9" } })[0])
      .toMatch(/package\.json\.version/);
  });

  it("pins the GENERATION too", () => {
    // The epoch that lets the version be renumbered DOWNWARD. isRemoteNewer
    // compares it BEFORE version and build, so a version.json disagreeing with
    // the bundle would either never offer an update (remote epoch looks older)
    // or offer one on every poll. Both silent.
    expect(D.checkVersions({ ...ok, versionJson: { version: "1.5", build: "29", generation: 2 } })[0])
      .toMatch(/version\.json\.generation/);
    // A version.json that simply omits it is a disagreement too, not a pass:
    // the field is ours to write and the running bundle always has one.
    expect(D.checkVersions({ ...ok, versionJson: { version: "1.5", build: "29" } })[0])
      .toMatch(/version\.json\.generation/);
    // …and an unparseable constants.ts must SAY so rather than skip the rule.
    expect(D.checkVersions({
      ...ok,
      constants: 'export var APP_VERSION = "1.5";\nexport var APP_BUILD = "29";',
    })[0]).toMatch(/Could not parse APP_GENERATION/);
  });

  it("accepts package.json as either X.Y or X.Y.0", () => {
    expect(D.checkVersions({ ...ok, packageJson: { version: "1.5" } })).toEqual([]);
  });

  it("is ASYMMETRIC about the changelog — lagging is fine, overshooting is not", () => {
    // A fix-only bump must not be forced to invent an entry (CLAUDE.md forbids
    // logging simple bug fixes), but an entry ahead of APP_BUILD is time travel.
    expect(D.checkVersions({ ...ok, changelog: '<h2><span class="tag">Build 1</span> x</h2>' })).toEqual([]);
    expect(D.checkVersions({ ...ok, changelog: '<h2><span class="tag">v1.5 · Build 30</span> x</h2>' })[0])
      .toMatch(/never overshoot/);
  });

  it("tolerates a tag with no version prefix, and reports a missing tag", () => {
    expect(D.checkVersions({ ...ok, changelog: '<h2><span class="tag">Build 29</span> x</h2>' })).toEqual([]);
    expect(D.checkVersions({ ...ok, changelog: "<h2>no tag here</h2>" })[0]).toMatch(/Could not find/);
  });

  it("reports unparseable constants instead of throwing", () => {
    expect(D.checkVersions({ ...ok, constants: "nothing here" })[0]).toMatch(/Could not parse/);
  });

  it("the SHIPPED version numbers agree", () => {
    expect(D.checkVersions({
      constants: readFileSync("src/constants.ts", "utf8"),
      versionJson: JSON.parse(readFileSync("public/version.json", "utf8")),
      packageJson: JSON.parse(readFileSync("package.json", "utf8")),
      changelog: readFileSync("public/changelog.html", "utf8"),
    })).toEqual([]);
  });
});

describe("checkHelpAnchors", () => {
  const IDS = [{ ids: { fr: "fr-tabac", en: "en-tobacco" } }];
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

  it("passes a well-formed page", () => {
    const doc = parse(
      '<div id="sec-fr"><h2 id="fr-tabac">Tabac</h2></div>' +
      '<div id="sec-en"><h2 id="en-tobacco">Tobacco</h2></div>',
    );
    expect(D.checkHelpAnchors(doc, IDS)).toEqual([]);
  });

  it("catches THE bug it was written for: an anchor ejected from its wrapper", () => {
    // A malformed tag auto-closes <div id="sec-fr">, so later h2s land at body
    // level and HelpView renders them as empty, title-less cards.
    const doc = parse(
      '<div id="sec-fr"></div><h2 id="fr-tabac">Tabac</h2>' +
      '<div id="sec-en"><h2 id="en-tobacco">Tobacco</h2></div>',
    );
    const out = D.checkHelpAnchors(doc, IDS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/landed outside/);
  });

  it("catches a missing anchor, a wrong tag and an empty title", () => {
    const missing = parse('<div id="sec-fr"></div><div id="sec-en"><h2 id="en-tobacco">T</h2></div>');
    expect(D.checkHelpAnchors(missing, IDS)[0]).toMatch(/is missing/);

    const wrongTag = parse(
      '<div id="sec-fr"><h3 id="fr-tabac">Tabac</h3></div>' +
      '<div id="sec-en"><h2 id="en-tobacco">T</h2></div>',
    );
    expect(D.checkHelpAnchors(wrongTag, IDS)[0]).toMatch(/expected <h2>/);

    const empty = parse(
      '<div id="sec-fr"><h2 id="fr-tabac"> </h2></div>' +
      '<div id="sec-en"><h2 id="en-tobacco">T</h2></div>',
    );
    expect(D.checkHelpAnchors(empty, IDS)[0]).toMatch(/has no text/);
  });

  it("requires the fr and en wrappers, but SKIPS a language not yet translated", () => {
    const noFr = parse('<div id="sec-en"><h2 id="en-tobacco">T</h2></div>');
    expect(D.checkHelpAnchors(noFr, IDS).some((e: string) => /sec-fr.*missing/.test(e))).toBe(true);

    // An es entry with no sec-es wrapper is "not translated yet", not an error.
    const withEs = [{ ids: { fr: "fr-tabac", en: "en-tobacco", es: "es-tobacco" } }];
    const doc = parse(
      '<div id="sec-fr"><h2 id="fr-tabac">Tabac</h2></div>' +
      '<div id="sec-en"><h2 id="en-tobacco">Tobacco</h2></div>',
    );
    expect(D.checkHelpAnchors(doc, withEs)).toEqual([]);
  });

  it("the SHIPPED help.html passes", () => {
    const doc = parse(readFileSync("public/help.html", "utf8"));
    // Mirror doc-check's list shape for the two mandatory languages.
    const ids = [
      { ids: { fr: "fr-install", en: "en-install" } },
      { ids: { fr: "fr-tabac", en: "en-tobacco" } },
      { ids: { fr: "fr-lots", en: "en-lots" } },
    ];
    expect(D.checkHelpAnchors(doc, ids)).toEqual([]);
  });
});

describe("findFallbackMismatches", () => {
  const ref = { btn_save: "Enregistrer", lbl_lots: "Les lots" };

  it("flags a fallback that diverged from fr", () => {
    const hits = D.findFallbackMismatches('<b>{t ? t("btn_save") : "Sauver"}</b>', ref, "X.tsx");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ key: "btn_save", literal: "Sauver", ref: "Enregistrer" });
    expect(hits[0].message).toContain("X.tsx");
  });

  it("passes an identical fallback", () => {
    expect(D.findFallbackMismatches('{t ? t("btn_save") : "Enregistrer"}', ref, "X")).toEqual([]);
  });

  it("compares the RAW escaped form, as the dictionary parser stores it", () => {
    // fr holds the escaped text, so the literal must match escape-for-escape.
    const escRef = { q: 'a \\"b\\"' };
    expect(D.findFallbackMismatches('{t ? t("q") : "a \\"b\\""}', escRef, "X")).toEqual([]);
  });

  it("ignores a key absent from the reference (the parity gate owns that)", () => {
    expect(D.findFallbackMismatches('{t ? t("unknown_key") : "whatever"}', ref, "X")).toEqual([]);
  });

  it("finds every site in a file, not just the first", () => {
    const src = '{t ? t("btn_save") : "Sauver"} … {t ? t("lbl_lots") : "Lots"}';
    expect(D.findFallbackMismatches(src, ref, "X").map((h: any) => h.key))
      .toEqual(["btn_save", "lbl_lots"]);
  });
});

/**
 * Gate 12 — the changelog carries FUNCTIONAL changes only.
 *
 * The rule is old; the enforcement is not. It was the last significant
 * convention in CLAUDE.md held up by prose alone, and fifteen of
 * the twenty-five entries in the current version's section were display polish,
 * internal work or plain fixes — five of them narrating the same photo-frame
 * decision being made and unmade across consecutive releases.
 *
 * The cases below lean on what must still FIRE and what must never fire: a
 * guard that quietly stops matching reports nothing, which reads exactly like a
 * clean changelog.
 */
describe("checkChangelogIsFunctional (gate 12)", () => {
  const entry = (build: string, h3: string, body: string, version = "1.5") =>
    `<h2><span class="tag">v${version} · Build ${build}</span> T <span class="date">x</span></h2>\n` +
    `<h3>${h3}</h3>\n<ul><li>${body}</li></ul>\n`;

  it("FAILS on an entry that sub-titles itself a fix, in any of the five languages", () => {
    for (const h of ["Correction", "Fix", "Corrección", "Behoben", "Correzione"]) {
      const r = D.checkChangelogIsFunctional(entry("46", h, "quelque chose"), "1.5");
      expect(r.errors.length, `"${h}" was not treated as a fix heading`).toBe(1);
      expect(r.errors[0]).toContain("Build 46");
    }
  });

  it("names the remedy, including that no entry at all is a valid outcome", () => {
    // The failure mode this gate exists to prevent is someone "fixing" the
    // error by rewording the heading instead of deleting the entry.
    const r = D.checkChangelogIsFunctional(entry("46", "Correction", "x"), "1.5");
    // Deliberately NOT a language COUNT — that phrasing went stale the day a
    // sixth language shipped. The remedy is "every language section".
    expect(r.errors[0]).toMatch(/EVERY language section/);
    expect(r.errors[0]).toMatch(/needs no entry at all/);
  });

  it("does not fail a genuine feature entry", () => {
    const r = D.checkChangelogIsFunctional(
      entry("22", "Nouveau", "Un nouveau filtre liste les tabacs achetés récemment."), "1.5");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("WARNS — never fails — on display or implementation prose", () => {
    // Judgement, not certainty: a real feature can legitimately mention colour.
    // Failing here would get correct prose deleted, which this repo has done
    // once already (the Cranmere catalogue name).
    const r = D.checkChangelogIsFunctional(
      entry("52", "Amélioration",
        "Mode clair : couleurs assombries pour le seuil de lisibilité, et l'opacité du cadre change."), "1.5");
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("Build 52");
  });

  it("needs TWO distinct terms, so one incidental mention is not enough", () => {
    // "Nouveau thème de couleurs" is a real feature that talks about colour.
    const r = D.checkChangelogIsFunctional(
      entry("239", "Nouveau", "Trois thèmes de couleurs au choix dans les préférences."), "1.5");
    expect(r.warnings).toEqual([]);
  });

  it("only looks at the CURRENT version — older sections are frozen history", () => {
    const older = entry("158", "Correction", "vieille correction", "1.4");
    expect(D.checkChangelogIsFunctional(older, "1.5").errors).toEqual([]);
    // …and would fire if that version WERE the current one, so the scoping is
    // the reason it stays quiet, not a broken matcher.
    expect(D.checkChangelogIsFunctional(older, "1.4").errors.length).toBe(1);
  });

  it("reports each build once, however many headings or terms it carries", () => {
    const doubled =
      `<h2><span class="tag">v1.5 · Build 9</span> T <span class="date">x</span></h2>\n` +
      `<h3>Correction</h3>\n<ul><li>a</li></ul>\n<h3>Fix</h3>\n<ul><li>b</li></ul>\n`;
    expect(D.checkChangelogIsFunctional(doubled, "1.5").errors.length).toBe(1);
  });

  it("the SHIPPED changelog passes its own gate", () => {
    // The point of the purge. If this goes red, an entry was added
    // that the rule excludes — delete it rather than relaxing the gate.
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const html = readFileSync(resolve(__dirname, "../../public/changelog.html"), "utf8");
    const version = JSON.parse(
      readFileSync(resolve(__dirname, "../../public/version.json"), "utf8")).version;
    const r = D.checkChangelogIsFunctional(html, version);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

/**
 * Gate 13 — per-language locale data is complete.
 *
 * An earlier release made the DICTIONARY additive. An audit that actually added a sixth
 * language found six OTHER sites hardcoding the five codes, every one falling
 * back SILENTLY: French number formatting, French place names, English months
 * and weekday initials, no catalogue prose, English AI output — with typecheck,
 * lint, doc:check and 3569 of 3571 tests green. A silent fallback is the worst
 * failure shape available, because the result reads as unfinished rather than
 * broken and nothing points at the cause.
 */
describe("checkLangAssets (gate 13)", () => {
  const row = (code: string, over: Record<string, string> = {}) => {
    const f: Record<string, string> = {
      numberLocale: '"xx-XX"', nominatim: '"xx"', aiPromptName: '"X"',
      monthsShort: '["a","b","c","d","e","f","g","h","i","j","k","l"]',
      dayInitials: '["A","","B","","C","",""]',
      ...over,
    };
    return `\n  ${code}: {\n    ${Object.entries(f).map(([k, v]) => `${k}: ${v},`).join("\n    ")}\n  },`;
  };
  const file = (...rows: string[]) => `export var LANG_ASSETS = {${rows.join("")}\n};`;

  it("passes when every dictionary has a complete row", () => {
    expect(D.checkLangAssets(file(row("fr"), row("en")), ["fr", "en"])).toEqual([]);
  });

  it("FAILS on a dictionary with no row, and says what would break", () => {
    const r = D.checkLangAssets(file(row("fr")), ["fr", "pt"]);
    expect(r.length).toBe(1);
    expect(r[0]).toContain('"pt"');
    // The message must name the CONSEQUENCE, not just the missing key — the
    // whole problem was that nobody knew this data existed.
    expect(r[0]).toMatch(/silently|number locale|English/i);
  });

  it("FAILS on a row missing any single field", () => {
    for (const f of D.LANG_ASSET_FIELDS) {
      const partial = row("fr").replace(new RegExp(`\\s*${f}: [^\\n]*\\n`), "\n");
      const r = D.checkLangAssets(file(partial), ["fr"]);
      expect(r.length, `dropping ${f} was not detected`).toBe(1);
      expect(r[0]).toContain(f);
    }
  });

  it("FAILS on a short month or weekday list — a silent off-by-one is worse than a gap", () => {
    expect(D.checkLangAssets(
      file(row("fr", { monthsShort: '["a","b","c"]' })), ["fr"])[0]).toMatch(/12 names/);
    expect(D.checkLangAssets(
      file(row("fr", { dayInitials: '["A","B"]' })), ["fr"])[0]).toMatch(/7 entries/);
  });

  it("FAILS on a stale row for a language whose dictionary is gone", () => {
    const r = D.checkLangAssets(file(row("fr"), row("xx")), ["fr"]);
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/no src\/i18n\/xx\.ts/);
  });

  it("FAILS loudly if LANG_ASSETS itself disappears, rather than passing vacuously", () => {
    const r = D.checkLangAssets("export var LANGUAGES = [];", ["fr"]);
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/not found/);
  });

  it("the SHIPPED languages.ts passes for every dictionary on disk", () => {
    const { readFileSync, readdirSync } = require("node:fs");
    const { resolve } = require("node:path");
    const dir = resolve(__dirname, "../i18n");
    const codes = readdirSync(dir)
      .filter((f: string) => /^[a-z]{2,3}\.ts$/.test(f) && f !== "languages.ts")
      .map((f: string) => f.replace(/\.ts$/, ""));
    expect(codes.length, "no dictionaries discovered — the check would pass vacuously")
      .toBeGreaterThanOrEqual(5);
    expect(D.checkLangAssets(readFileSync(resolve(dir, "languages.ts"), "utf8"), codes)).toEqual([]);
  });
});

/**
 * Gate 14 — enum labels exist for every language.
 *
 * The last silent fallback in the "add a language" path. Enum values are stored
 * canonical FRENCH and localised at render by `xl()`; a language absent from
 * `ENUM_TRANSLATIONS` gets the stored French. Measured with a trial Portuguese
 * dictionary: 130 values rendered in French across cards, fiches, filter chips
 * and chart aria-labels — with every gate green. The checklist had always
 * listed the step; nothing enforced it.
 */
describe("checkEnumTranslations (gate 14)", () => {
  const file = (rows: string) => `export var ENUM_TRANSLATIONS = new Map([\n${rows}\n]);`;
  const row = (name: string, codes: string[]) =>
    `  [${name}, { ${codes.map((c) => `${c}: ${name.replace("_EN", "")}_${c.toUpperCase()}`).join(", ")} }],`;

  it("passes when every row covers every non-canonical language", () => {
    expect(D.checkEnumTranslations(
      file(row("CATS_EN", ["en", "es"])), ["fr", "en", "es"])).toEqual([]);
  });

  it("never demands `fr` — it is the canonical stored form, xl() returns it as-is", () => {
    // A gate that required fr would force a redundant identity map into every
    // row and make the canonical-language design look like an omission.
    expect(D.checkEnumTranslations(file(row("CATS_EN", ["en"])), ["fr", "en"])).toEqual([]);
  });

  it("FAILS per row on a missing language, and names the consequence", () => {
    const r = D.checkEnumTranslations(
      file([row("CATS_EN", ["en"]), row("CUTS_EN", ["en"])].join("\n")), ["fr", "en", "pt"]);
    expect(r.length).toBe(2);
    expect(r[0]).toContain("CATS_EN");
    expect(r[0]).toContain("pt");
    expect(r[0]).toMatch(/FRENCH/);
  });

  it("FAILS loudly if the map disappears or stops parsing, never vacuously", () => {
    expect(D.checkEnumTranslations("export var X = 1;", ["fr", "en"])[0]).toMatch(/not found/);
    expect(D.checkEnumTranslations("export var ENUM_TRANSLATIONS = new Map([]);", ["fr", "en"])[0])
      .toMatch(/no parseable rows/);
  });

  it("the SHIPPED constants.ts covers every dictionary on disk", () => {
    const { readFileSync, readdirSync } = require("node:fs");
    const { resolve } = require("node:path");
    const codes = readdirSync(resolve(__dirname, "../i18n"))
      .filter((f: string) => /^[a-z]{2,3}\.ts$/.test(f) && f !== "languages.ts")
      .map((f: string) => f.replace(/\.ts$/, ""));
    const r = D.checkEnumTranslations(
      readFileSync(resolve(__dirname, "../constants.ts"), "utf8"), codes);
    expect(r).toEqual([]);
    // Non-vacuity: the real file must actually have rows to check.
    expect(D.checkEnumTranslations(
      readFileSync(resolve(__dirname, "../constants.ts"), "utf8"), [...codes, "zz"]).length)
      .toBeGreaterThanOrEqual(10);
  });
});

/**
 * Gate 16. Gate 14 above checks the ENUM_TRANSLATIONS ROW names a
 * language; it cannot see whether the map behind that name holds anything. The
 * maps are deliberately SPARSE — they list only the values that differ — so an
 * EMPTY one is indistinguishable from a complete one by row inspection.
 *
 * MEASURED before writing this: a trial seventh language wired with ten
 * `= {}` maps left gate 14 silent and the whole of doc:check green, while every
 * category, cut, shape, material, finish, accessory type and fuel would have
 * rendered in stored FRENCH.
 *
 * The EN map is the oracle: a value it leaves alone is language-neutral jargon
 * (Flake, Billiard, Latakia) and nobody needs it; a value it TRANSLATED is not
 * neutral and everybody does.
 */
describe("checkEnumCoverage (gate 16)", () => {
  const src = (maps: string) =>
    `${maps}\nexport var ENUM_TRANSLATIONS = new Map([\n  [CATS_EN, { en: CATS_EN, pt: CATS_PT }],\n]);`;
  const EN = `export var CATS_EN: Record<string, string> = {Anglais:"English",Latakia:"Latakia",Autre:"Other"};`;

  it("passes when the map covers every value EN had to translate", () => {
    const s = src(`${EN}\nexport var CATS_PT: Record<string, string> = {Anglais:"Inglês",Autre:"Outro"};`);
    expect(D.checkEnumCoverage(s, ["fr", "en", "pt"])).toEqual([]);
  });

  it("does NOT demand jargon EN itself left alone (Latakia is not French)", () => {
    // The whole point: a value absent from the EN map is absent BY DESIGN.
    // Demanding it would force a redundant identity entry for ~110 shape,
    // cut and material names in every language.
    const s = src(`${EN}\nexport var CATS_PT: Record<string, string> = {Anglais:"Inglês",Autre:"Outro"};`);
    expect(D.checkEnumCoverage(s, ["fr", "en", "pt"]).join(" ")).not.toContain("Latakia");
  });

  it("skips an IDENTITY override — EN saying `Bruyère: \"Bruyère\"` means the word travels", () => {
    const en = `export var CATS_EN: Record<string, string> = {"Bruyère":"Bruyère",Anglais:"English"};`;
    const s = src(`${en}\nexport var CATS_PT: Record<string, string> = {Anglais:"Inglês"};`);
    expect(D.checkEnumCoverage(s, ["fr", "en", "pt"])).toEqual([]);
  });

  it("FAILS on the empty map that gate 14 accepts, and names the values", () => {
    const s = src(`${EN}\nexport var CATS_PT: Record<string, string> = {};`);
    const r = D.checkEnumCoverage(s, ["fr", "en", "pt"]);
    expect(r.length).toBe(1);
    expect(r[0]).toContain("CATS_PT");
    expect(r[0]).toContain("Anglais");
    expect(r[0]).toMatch(/FRENCH/);
    // …and gate 14 is green on exactly this input, which is why 16 exists.
    expect(D.checkEnumTranslations(s, ["fr", "en", "pt"])).toEqual([]);
  });

  it("FAILS when the map is absent entirely rather than passing vacuously", () => {
    const r = D.checkEnumCoverage(src(EN), ["fr", "en", "pt"]);
    expect(r[0]).toMatch(/CATS_PT not found/);
  });

  it("parses quoted keys with accents, spaces and parentheses", () => {
    const en = `export var B_EN: Record<string, string> = {"Pierre (stéatite)":"Soapstone","Écossais":"Scottish"};`;
    const pt = `export var B_PT: Record<string, string> = {"Pierre (stéatite)":"Esteatite"};`;
    const s = `${en}\n${pt}\nexport var ENUM_TRANSLATIONS = new Map([\n  [B_EN, { en: B_EN, pt: B_PT }],\n]);`;
    const r = D.checkEnumCoverage(s, ["fr", "en", "pt"]);
    expect(r.length).toBe(1);
    expect(r[0]).toContain("Écossais");
    expect(r[0]).not.toContain("stéatite");
  });

  it("the SHIPPED constants.ts covers every dictionary on disk", () => {
    const { readFileSync, readdirSync } = require("node:fs");
    const { resolve } = require("node:path");
    const codes = readdirSync(resolve(__dirname, "../i18n"))
      .filter((f: string) => /^[a-z]{2,3}\.ts$/.test(f) && f !== "languages.ts")
      .map((f: string) => f.replace(/\.ts$/, ""));
    const real = readFileSync(resolve(__dirname, "../constants.ts"), "utf8");
    expect(D.checkEnumCoverage(real, codes)).toEqual([]);
    // Non-vacuity: an unknown language must produce one complaint per enum,
    // else a parse regression would make this pass while checking nothing.
    expect(D.checkEnumCoverage(real, [...codes, "zz"]).length).toBeGreaterThanOrEqual(10);
  });
});

/**
 * Gate 12 follow-up: "two distinct terms" must mean two distinct
 * WORDS. Several entries in the vocabulary list are substrings of others across
 * languages, so one word could satisfy the threshold alone — found when the
 * gate fired on the own changelog entry, where the Spanish "el contraste
 * con la IA" (a cross-CHECK) matched both "contraste" and "contrast".
 */
describe("checkChangelogIsFunctional — one word cannot count twice", () => {
  const entry = (body: string) =>
    `<h2><span class="tag">v1.5 · Build 9</span> T <span class="date">x</span></h2>\n` +
    `<h3>Amélioration</h3>\n<ul><li>${body}</li></ul>\n`;

  it("does not warn when a single word matches two overlapping terms", () => {
    expect(D.checkChangelogIsFunctional(
      entry("La comparación y el contraste con la IA."), "1.5").warnings).toEqual([]);
  });

  it("still warns on two genuinely different terms", () => {
    // The guard must not have been widened into uselessness by the fix.
    expect(D.checkChangelogIsFunctional(
      entry("Le contraste et l'opacité du cadre changent."), "1.5").warnings.length).toBe(1);
  });
});

/**
 * Gate 15 — the generalisation of gates 13 and 14.
 *
 * Those two guard ONE named map each. Adding Portuguese found four more
 * per-language axes that nothing enumerated: geo.ts's 79-row country table,
 * HelpView.SECTION_IDS, doc-check.cjs's own HELP_SECTION_IDS, and main.jsx's
 * pre-mount boot strings — the last of which I shipped incomplete
 * and only this gate caught. Every one failed the same way: silently.
 *
 * So the cases below lean on the two ways a shape-matching gate goes wrong.
 * Too loose and it misses the gap it exists for; too strict and it fires on
 * deliberate subsets, which gets correct code rewritten to please it — the
 * failure mode that cost this project the Cranmere catalogue name.
 */
describe("findLanguageAxisGaps (gate 15)", () => {
  const CODES = ["fr", "en", "es", "de", "it", "pt"];
  const gaps = (source: string) => D.findLanguageAxisGaps([{ path: "f.ts", source }], CODES);

  it("flags a map that lists five of six languages", () => {
    const out = gaps('const M = { fr: 1, en: 2, es: 3, de: 4, it: 5 };');
    expect(out.length).toBe(1);
    expect(out[0]).toContain("not pt");
  });

  it("says nothing when every code is present", () => {
    expect(gaps('const M = { fr: 1, en: 2, es: 3, de: 4, it: 5, pt: 6 };')).toEqual([]);
  });

  it("ignores a SINGLE-code literal — that is a default, not an axis", () => {
    // THE false positive to avoid: `LANG = { en: EN }` in i18n.ts is the one
    // statically-imported dictionary, and it is correct as it stands. This is
    // why the threshold is two codes and not one.
    expect(gaps('export var LANG: Record<string, Dict> = { en: EN };')).toEqual([]);
  });

  it("flags a two-code pair — the shape an older build leaves behind", () => {
    expect(gaps('const T = { fr: "oui", en: "yes" };').length).toBe(1);
  });

  it("accepts an acknowledgement on the literal's own line", () => {
    expect(gaps('const M = { fr: 1, en: 2 };  // lang-axis-ok: source languages')).toEqual([]);
  });

  it("accepts one above the DECLARATION, covering every row inside it", () => {
    // The scope that matters in practice: ENUM_TRANSLATIONS is ten separate
    // literals in one statement, and ten trailing comments would be noise.
    expect(gaps([
      "// lang-axis-ok: fr is the canonical stored value",
      "export var ROWS = new Map([",
      "  [A, { en: 1, es: 2, de: 3, it: 4, pt: 5 }],",
      "  [B, { en: 1, es: 2, de: 3, it: 4, pt: 5 }],",
      "]);",
    ].join("\n"))).toEqual([]);
  });

  it("does not let a comment further up leak its acknowledgement", () => {
    // The upward scan must stop at the first non-comment line, or one
    // acknowledgement anywhere in a file would silence the whole file.
    expect(gaps([
      "// lang-axis-ok: this belongs to the map above",
      "const OTHER = 1;",
      "const M = { fr: 1, en: 2, es: 3, de: 4, it: 5 };",
    ].join("\n")).length).toBe(1);
  });

  it("names the languages present and the ones missing", () => {
    // The message has to be actionable without opening the file: which axis,
    // and which readers fall back.
    const out = gaps('const M = { en: 1, pt: 2 };')[0]!;
    expect(out).toContain("f.ts:1");
    expect(out).toMatch(/lists en, pt/);
    expect(out).toMatch(/not fr, es, de, it/);
  });

  it("stands down when the registry has fewer than two languages", () => {
    // A single-language app has no axis to guard, and the gate must not invent
    // one from an unrelated two-key object.
    expect(D.findLanguageAxisGaps([{ path: "f.ts", source: 'const M = { fr: 1, en: 2 };' }], ["fr"]))
      .toEqual([]);
  });

  it("runs over the REAL production sources with no gap", () => {
    // A data regression (a new map, a language added to five of six places)
    // shows up in `npm test` too, not only in doc:check.
    const roots = ["src", "scripts", "eslint-rules"];
    const files: { path: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(abs); continue; }
        if (!/\.(ts|tsx|js|jsx|cjs)$/.test(e.name) || /\.test\./.test(e.name)) continue;
        if (/\/i18n\/[a-z]{2,3}\.ts$/.test(abs)) continue;
        files.push({ path: abs, source: readFileSync(abs, "utf8") });
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(50);
    expect(D.findLanguageAxisGaps(files, LANGUAGES.map((l) => l.code))).toEqual([]);
  });
});

/**
 * Gate 15 must not read PROSE as data.
 *
 * The audit agent hunting the remaining hardcoded languages had its own comment
 * — one quoting `["es","de","it"]` to explain a deliberate subset — reported
 * back at it by this gate. Benign in isolation, and exactly the failure this
 * family of gates exists to avoid: a false positive gets correct code rewritten
 * to please the guard. Comments are blanked before the scan, length-preserving
 * so every line number still points at the real file.
 */
describe("findLanguageAxisGaps ignores comments", () => {
  const CODES = ["fr", "en", "es", "de", "it", "pt"];
  const gaps = (source: string) => D.findLanguageAxisGaps([{ path: "f.ts", source }], CODES);

  it("a language list quoted in a line comment is prose, not an axis", () => {
    expect(gaps('// the archive cannot offer ["es","de","it"] back\nconst ok = 1;')).toEqual([]);
  });

  it("the same holds for a block comment", () => {
    expect(gaps('/* shaped like { fr: 1, en: 2 } */\nconst ok = 1;')).toEqual([]);
  });

  it("still reports the line the CODE is on, not the stripped offset", () => {
    // Blanking has to preserve length, or every finding points at the wrong
    // place and the message stops being actionable.
    expect(gaps('const a = 1;\n// filler\n\nconst M = ["fr","en"];')[0]).toContain("f.ts:4");
  });

  it("does not mistake a URL's slashes for a comment", () => {
    // `https://` would eat the rest of the line under a naive `//` rule, hiding
    // any real finding that shares it.
    expect(gaps('const u = "https://x.y"; const M = { fr: 1, en: 2 };').length).toBe(1);
  });

  it("still honours an acknowledgement, which lives in a comment itself", () => {
    // The ack is read from the RAW source; blanking must not silence it.
    expect(gaps('// lang-axis-ok: sources\nconst M = { fr: 1, en: 2 };')).toEqual([]);
  });
});

/**
 * The four gates, which close the language gaps the pass
 * NAMED but left open. Each is tested for what it must still FAIL on: all four
 * are green against the repo today, so the only thing that can rot is their
 * willingness to fire.
 */
describe("checkContractLanguageCoverage (gate 17)", () => {
  const CODES = ["fr", "en", "es", "de", "it", "pt"];
  const contract = (files: string[]) => ({
    numeric: [{ id: "c1", docs: files.map((f) => ({ file: f, patterns: ["{n}"] })) }],
  });

  it("passes when every dictionary is listed", () => {
    expect(D.checkContractLanguageCoverage(
      contract(CODES.map((c) => `src/i18n/${c}.ts`)), CODES)).toEqual([]);
  });

  it("fails when one language is missing, and names it", () => {
    const out = D.checkContractLanguageCoverage(
      contract(["fr", "en", "es", "de", "it"].map((c) => `src/i18n/${c}.ts`)), CODES);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("but not pt");
    expect(out[0]).toContain("c1");
  });

  it("ignores a contract with no dictionary axis at all", () => {
    // A claim that lives only in help.html has nothing to be incomplete about;
    // reporting it would make the gate noise on every help-only contract.
    expect(D.checkContractLanguageCoverage(contract(["public/help.html"]), CODES)).toEqual([]);
  });

  it("does not mistake a nested path for a dictionary", () => {
    expect(D.checkContractLanguageCoverage(contract(["src/i18n/sub/fr.ts"]), CODES)).toEqual([]);
  });

  it("the shipped registry covers every shipped dictionary", () => {
    const reg = JSON.parse(readFileSync("scripts/label-contracts.json", "utf8"));
    const codes = LANGUAGES.map((l) => l.code);
    expect(reg.numeric.length).toBeGreaterThan(0);
    expect(D.checkContractLanguageCoverage(reg, codes)).toEqual([]);
  });
});

describe("findMissingDocLangBlocks (gate 18)", () => {
  const CODES = ["fr", "en", "pt"];

  it("reports only the languages whose block is absent", () => {
    const out = D.findMissingDocLangBlocks(
      [{ file: "p.html", source: '<div id="sec-fr"></div><div id="sec-en"></div>' }], CODES);
    expect(out).toEqual([{ file: "p.html", missing: ["pt"] }]);
  });

  it("says nothing when every block is present", () => {
    const src = CODES.map((c) => `<div id="sec-${c}"></div>`).join("");
    expect(D.findMissingDocLangBlocks([{ file: "p.html", source: src }], CODES)).toEqual([]);
  });

  it("the shipped multilingual doc pages carry every language", () => {
    // privacy.html is the one this gate FAILS on (a legal page, one page long);
    // changelog.html only warns, but both are complete today.
    const codes = LANGUAGES.map((l) => l.code);
    const docs = ["public/privacy.html", "public/changelog.html", "public/help.html"]
      .map((f) => ({ file: f, source: readFileSync(f, "utf8") }));
    expect(D.findMissingDocLangBlocks(docs, codes)).toEqual([]);
  });
});

describe("findEnglishCopyDicts (gate 19)", () => {
  const mk = (v: (i: number) => string) =>
    Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, v(i)]));

  it("flags a dictionary that is a copy of English", () => {
    const en = mk((i) => `english ${i}`);
    const out = D.findEnglishCopyDicts({ en, nl: { ...en } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("100%");
    expect(out[0]).toContain("src/i18n/nl.ts");
  });

  it("leaves a real translation alone even with shared jargon", () => {
    const en = mk((i) => `english ${i}`);
    const nl = mk((i) => (i < 6 ? `english ${i}` : `vertaald ${i}`)); // 10% shared
    expect(D.findEnglishCopyDicts({ en, nl })).toEqual([]);
  });

  it("does not judge a dictionary too small to judge", () => {
    expect(D.findEnglishCopyDicts({ en: { a: "x" }, nl: { a: "x" } })).toEqual([]);
  });

  it("every shipped dictionary is far from the threshold", () => {
    // Measured when the gate was written: the highest legitimate overlap with
    // English is fr at 7.3%. If this ever approaches 50%, the gate is right and
    // the dictionary is wrong.
    const dicts: Record<string, Record<string, string>> = {};
    for (const { code } of LANGUAGES) {
      dicts[code] = Object.fromEntries(
        [...readFileSync(`src/i18n/${code}.ts`, "utf8")
          .matchAll(/^ {2}([A-Za-z0-9_]+):"((?:[^"\\]|\\.)*)"/gm)].map((m) => [m[1], m[2]]));
    }
    expect(D.findEnglishCopyDicts(dicts)).toEqual([]);
  });
});

describe("checkAnchorLanguage (gate 21)", () => {
  const page = (blocks: string) => blocks;

  it("flags a link that leaves its own language block", () => {
    const out = D.checkAnchorLanguage(
      '<div id="sec-pt"><a href="#en-lots">Lotes</a></div>', "help.html");
    expect(out.length).toBe(1);
    expect(out[0]).toContain("#en-lots");
  });

  it("says nothing when the anchor matches its block", () => {
    expect(D.checkAnchorLanguage(
      '<div id="sec-pt"><a href="#pt-lots">Lotes</a></div>', "help.html")).toEqual([]);
  });

  it("reports each foreign language once, not each link", () => {
    // 30 copied anchors must not produce 30 lines of noise.
    const many = Array.from({ length: 30 }, (_, i) => `<a href="#en-s${i}">x</a>`).join("");
    expect(D.checkAnchorLanguage(page(`<div id="sec-pt">${many}</div>`), "help.html").length).toBe(1);
  });

  it("scopes each block separately", () => {
    expect(D.checkAnchorLanguage(
      '<div id="sec-en"><a href="#en-a">x</a></div><div id="sec-pt"><a href="#pt-a">x</a></div>',
      "help.html")).toEqual([]);
  });

  it("ignores a page with no language blocks", () => {
    expect(D.checkAnchorLanguage('<a href="#en-a">x</a>', "licenses.html")).toEqual([]);
  });

  it("passes over the REAL shipped pages", () => {
    // A data regression shows up in `npm test` too, not only in doc:check.
    for (const f of ["help.html", "changelog.html", "privacy.html"]) {
      const html = readFileSync(`public/${f}`, "utf8");
      expect(D.checkAnchorLanguage(html, f), `${f} has a cross-language anchor`).toEqual([]);
    }
  });
});

/**
 * The last seven inline gates, extracted.
 *
 * A probe of every gate found the remaining third had its DECISION
 * written inline in `doc-check.cjs`. All of them bit — that was measured — but
 * the wiring test added there only stops a call site being DELETED. It cannot
 * notice a regex quietly narrowed, a filter inverted or a tolerance widened,
 * and a gate that reports nothing reads exactly like a clean repository.
 *
 * The cases below lean on the two ways each of these goes wrong: it stops
 * firing on the defect it exists for, or it starts firing on something
 * legitimate and gets itself disabled.
 */
describe("the extracted doc gates", () => {
  describe("findUndocumentedModules (gates 2 and 3)", () => {
    it("flags a module CLAUDE.md never names", () => {
      const out = D.findUndocumentedModules(["lotUtils.ts", "newThing.ts"], "… lotUtils …", "src/utils");
      expect(out).toEqual(["src/utils/newThing.ts not mentioned in CLAUDE.md"]);
    });

    it("matches on the basename, anywhere in the prose", () => {
      // Deliberately loose: the gate asks whether the doc KNOWS the file
      // exists, not whether it describes it correctly. A stricter form (a
      // path, a heading) fires on every legitimate way a file is discussed,
      // and a gate that cries wolf gets switched off.
      expect(D.findUndocumentedModules(["geo.ts"], "see `geo.ts`'s country table", "src/utils")).toEqual([]);
    });

    it("ignores non-TypeScript entries", () => {
      expect(D.findUndocumentedModules(["README.md", "x.json"], "", "src/utils")).toEqual([]);
    });

    it("names the directory it was given", () => {
      expect(D.findUndocumentedModules(["useX.ts"], "", "src/hooks")[0]).toContain("src/hooks/useX.ts");
    });
  });

  describe("storage keys (gate 4)", () => {
    it("extracts every literal key, deduplicated", () => {
      const keys = D.extractStorageKeys([
        'localStorage.getItem("cave-lang"); localStorage.setItem("cave-lang", x);',
        'localStorage.removeItem("gdrive-tk")',
      ]);
      expect(keys.sort()).toEqual(["cave-lang", "gdrive-tk"]);
    });

    it("flags a key the keys table does not carry", () => {
      expect(D.findUndocumentedStorageKeys(["cave-new"], "| `cave-lang` |")).toHaveLength(1);
    });

    it("accepts a key listed in backticks", () => {
      expect(D.findUndocumentedStorageKeys(["cave-lang"], "| `cave-lang` | localStorage |")).toEqual([]);
    });

    it("skips a TEMPLATED key fragment", () => {
      // `"cave-autosave-ts-" + provider` reaches the gate as a fragment ending
      // in a dash. The table documents the FAMILY, so demanding the fragment
      // would force a fake row — which is why the filter is anchored on
      // [a-zA-Z0-9_-]+ rather than "anything between quotes".
      expect(D.findUndocumentedStorageKeys(["cave-autosave-ts-", "a b"], "")).toEqual(
        D.findUndocumentedStorageKeys(["cave-autosave-ts-"], ""));
      expect(D.findUndocumentedStorageKeys(["a b"], "")).toEqual([]);
    });

    it("a key holding a regex metacharacter is skipped, not mis-matched", () => {
      // Probed and corrected in the same build: my first version asserted the
      // ESCAPING catches this. It cannot be reached — the [a-zA-Z0-9_-]+ filter
      // drops such a key before the regex is built, so "a.c" would otherwise
      // have matched the row `abc`. The escape stays as belt-and-braces should
      // that filter ever widen; the filter is what actually protects today.
      expect(D.findUndocumentedStorageKeys(["a.c"], "| `abc` |")).toEqual([]);
      expect(D.findUndocumentedStorageKeys(["a-c"], "| `abc` |")).toHaveLength(1);
    });
  });

  describe("t() keys (gates 9 and 11)", () => {
    it("finds keys through t(), tr() and the LANG[x]?.key form", () => {
      const keys = D.extractTKeys([
        't("btn_save"); tr("lbl_x", "…"); const s = LANG[lng]?.err_generic;',
      ]);
      expect(keys.sort()).toEqual(["btn_save", "err_generic", "lbl_x"]);
    });

    it("ne lit PAS un t(\"…\") écrit dans un COMMENTAIRE", () => {
      // Le défaut vécu : un commentaire expliquant pourquoi le code n'utilise
      // PAS une clé construite citait `t("prio_" + v)`, et la porte a exigé une
      // entrée « prio_ » dans les six dictionnaires. Une prose d'exemple n'est
      // pas une donnée — la leçon que la porte 15 avait déjà apprise, sur
      // elle-même, un build plus tôt.
      const keys = D.extractTKeys([
        [
          '// jamais appelée : t("ghost_line")',
          '/* ni celle-ci : t("ghost_block") */',
          't("real");',
        ].join("\n"),
      ]);
      expect(keys).toEqual(["real"]);
    });

    it("mais garde tous les VRAIS appels — sinon la porte cesserait de garder", () => {
      // Le contre-cas. Un blanchiment trop large silencierait des sites
      // d'appel réels, c'est-à-dire transformerait la correction d'un faux
      // positif en la perte de la garantie.
      const keys = D.extractTKeys(['const u = "https://x/y"; t("a"); t("b");']);
      expect(keys.sort()).toEqual(["a", "b"]);
    });

    it("LE DÉFAUT VÉCU : `/*` dans une CHAÎNE n'ouvre pas un commentaire", () => {
      // Reproduction fidèle d'AICard.tsx. La version à deux expressions
      // régulières lisait le `/*` de `accept="image/*"` comme une ouverture de
      // bloc, courant jusqu'au `*/` suivant — ici le commentaire JSX deux
      // lignes plus bas — et avalait ~29 lignes de JSX vivant avec lui.
      //
      // CE QUE ÇA COÛTE n'est pas l'avertissement de la porte 11 : la porte 9
      // (une clé appelée doit exister dans le dictionnaire) est une porte
      // d'ERREUR branchée sur la MÊME extraction, donc une région avalée est
      // une région où une clé mal tapée passe sans contrôle.
      const src = [
        '<input accept="image/*" />',
        '{t ? t("ai_scan_btn") : "Scanner la boîte"}',
        "{/* une vraie prose ici */}",
        't("apres");',
      ].join("\n");
      expect(D.extractTKeys([src]).sort()).toEqual(["ai_scan_btn", "apres"]);
    });

    it("…et `//` dans une chaîne non plus, même sans les deux-points", () => {
      // L'ancienne garde était `(^|[^:])//`, qui ne tenait que grâce au « : »
      // d'une URL. Un chemin relatif n'en a pas.
      expect(D.extractTKeys(['const p = "a//b"; t("apres");'])).toEqual(["apres"]);
    });

    it("un commentaire reste blanchi quand il SUIT du code sur la même ligne", () => {
      // Le sens inverse du cas ci-dessus : corriger le faux négatif ne doit pas
      // rouvrir le faux positif que tout ceci répare.
      expect(D.extractTKeys(['t("vrai"); // et pas t("faux")'])).toEqual(["vrai"]);
    });

    it("le blanchiment préserve longueurs et lignes", () => {
      // Porteur : les portes qui l'utilisent rapportent des NUMÉROS DE LIGNE.
      const src = 'a // x\n/* y\nz */\nb';
      expect(D.blankComments(src).length).toBe(src.length);
      expect(D.blankComments(src).split("\n").length).toBe(src.split("\n").length);
    });

    it("flags a called key missing from a dictionary — it renders RAW on screen", () => {
      expect(D.findMissingTKeys(["btn_save", "ghost"], ["btn_save"], "de"))
        .toEqual(['i18n: t("ghost") has no entry in src/i18n/de.ts']);
    });

    it("reports a defined-but-never-called key, minus the dynamic allowlist", () => {
      const unused = D.findUnusedTKeys(["a", "aroma_x", "b"], ["b"], (k: string) => k.startsWith("aroma_"));
      expect(unused).toEqual(["a"]);
    });

    it("treats a missing allowlist predicate as 'nothing is dynamic'", () => {
      expect(D.findUnusedTKeys(["a"], [], undefined)).toEqual(["a"]);
    });
  });

  describe("checkTestCountFreshness (gate 26)", () => {
    const line = (t: number, f: number) => `~${t} tests across ~${f} source files`;

    it("says nothing while both figures are within tolerance", () => {
      expect(D.checkTestCountFreshness(line(3678, 169), 169, 3678).warnings).toEqual([]);
    });

    it("warns when the FILE figure drifts past 10%", () => {
      expect(D.checkTestCountFreshness(line(3678, 100), 169, 3678).warnings).toHaveLength(1);
    });

    it("gives the case count a wider band — the static grep under-counts", () => {
      // `.each` and property tests expand at run time, so an exact match is
      // not achievable and a tight band would warn for ever.
      expect(D.checkTestCountFreshness(line(3200, 169), 169, 3678).warnings).toEqual([]);
      expect(D.checkTestCountFreshness(line(1000, 169), 169, 3678).warnings).toHaveLength(1);
    });

    it("warns when it finds NO figure at all — the vacuity case", () => {
      // The one that matters most: a reworded sentence would otherwise make
      // this gate silently examine nothing and keep reporting success.
      expect(D.checkTestCountFreshness("no figures here", 169, 3678).warnings[0])
        .toContain("was skipped");
    });

    it("checks every occurrence, not just the first", () => {
      // The figure appears twice in CLAUDE.md (Tech Stack + convention #5).
      const doc = line(3678, 169) + "\n\n" + line(3678, 20);
      expect(D.checkTestCountFreshness(doc, 169, 3678).warnings).toHaveLength(1);
    });

    it("counts static it()/test() cases, including .each", () => {
      expect(D.countTestCases(['it("a", ...); test("b", ...); it.each([])("c", ...)'])).toBe(3);
    });
  });

  it("every extracted decision is reachable from doc-check.cjs", () => {
    // Companion to docCheckWiring.test.ts, asserted here too because these
    // seven were inline until this build: extracting a decision and forgetting
    // to call it would leave the tests green and the gate switched off.
    const src = readFileSync("scripts/doc-check.cjs", "utf8");
    for (const fn of ["findUndocumentedModules", "findUndocumentedStorageKeys", "extractStorageKeys",
                      "extractTKeys", "findUnusedTKeys", "countTestCases", "checkTestCountFreshness"]) {
      expect(src, `${fn} is exported but never called`).toContain(fn + "(");
    }
  });
});

/**
 * gate 22: help.html's enum tables vs the real enums.
 *
 * The tables are PROSE, so nothing had ever read an enum out of them, and all
 * six had sat three categories behind the app for several releases. The gate
 * is deliberately two-strength: cuts are English jargon so every language must
 * list the SAME values (exact), categories are rendered per language so only
 * the CARDINALITY is checked — plus exact equality for French, the canonical
 * list. Asserting a spelling in the other five would be asserting an editorial
 * convention the prose does not follow mechanically, which is the over-strict
 * mistake this file keeps recording.
 */
describe("checkHelpEnumTables (gate 22)", () => {
  const CATS = ["Anglais", "Aromatique", "VaPer", "Virginia/Burley", "Autre"];
  const CUTS = ["Broken Flake", "Ready Rubbed", "Ribbon", "Autre"];
  const page = (lang: string, catList: string, cutList: string) =>
    `<div id="sec-${lang}"><table>` +
    `<tr><td>Type</td><td>${catList}</td></tr>` +
    `<tr><td>Cut</td><td>${cutList}</td></tr>` +
    `</table></div>`;
  const OK_CAT = "Anglais, Aromatique, VaPer, Virginia/Burley, Autre";
  const OK_CUT = "Broken Flake, Ready Rubbed, Ribbon, Autre";

  it("passes when both tables match", () => {
    expect(D.checkHelpEnumTables(page("fr", OK_CAT, OK_CUT), CATS, CUTS)).toEqual([]);
  });

  it("fires when a category is missing from the guide", () => {
    const f = D.checkHelpEnumTables(page("fr", "Anglais, VaPer, Virginia/Burley, Autre", OK_CUT), CATS, CUTS);
    expect(f.length).toBe(1);
    expect(f[0]).toMatch(/lists 4 values, the CATS enum has 5/);
  });

  it("fires when a cut is missing, and NAMES it", () => {
    const f = D.checkHelpEnumTables(page("de", OK_CAT, "Broken Flake, Ready Rubbed, Andere"), CATS, CUTS);
    expect(f.length).toBe(1);
    expect(f[0]).toContain("missing Ribbon");
  });

  it("accepts each language's own word for the trailing Autre", () => {
    for (const other of ["Other", "Otro", "Andere", "Altro", "Outro"]) {
      const html = page("en", "Anglais, Aromatique, VaPer, Virginia/Burley, " + other,
        "Broken Flake, Ready Rubbed, Ribbon, " + other);
      expect(D.checkHelpEnumTables(html, CATS, CUTS), other).toEqual([]);
    }
  });

  it("does NOT impose a spelling on a non-French category list", () => {
    // "Aromatic" / "Aromático" are how the guide really renders it; demanding
    // the canonical French there would get correct prose rewritten.
    const html = page("es", "Inglés, Aromático, VaPer, Virginia/Burley, Otro", OK_CUT);
    expect(D.checkHelpEnumTables(html, CATS, CUTS)).toEqual([]);
  });

  it("DOES impose it on French, which lists the canonical values", () => {
    const html = page("fr", "Anglais, Aromatic, VaPer, Virginia/Burley, Autre", OK_CUT);
    const f = D.checkHelpEnumTables(html, CATS, CUTS);
    expect(f.length).toBe(1);
    expect(f[0]).toContain("missing Aromatique");
  });

  it("ignores a parenthetical gloss rather than counting it as a value", () => {
    const html = page("en", "Anglais (English), Aromatic, VaPer, Virginia/Burley, Other", OK_CUT);
    expect(D.checkHelpEnumTables(html, CATS, CUTS)).toEqual([]);
  });

  it("checks EVERY language block, not just the first", () => {
    const html = page("fr", OK_CAT, OK_CUT) + page("it", "Anglais, VaPer, Virginia/Burley, Altro", OK_CUT);
    const f = D.checkHelpEnumTables(html, CATS, CUTS);
    expect(f.length).toBe(1);
    expect(f[0]).toContain("(it)");
  });

  it("reports a table it cannot FIND instead of passing silently", () => {
    const html = '<div id="sec-fr"><table><tr><td>Nom</td><td>libre</td></tr></table></div>';
    const f = D.checkHelpEnumTables(html, CATS, CUTS);
    expect(f.length).toBe(2);
    expect(f.join(" ")).toContain("no cut table found");
    expect(f.join(" ")).toContain("no category table found");
  });

  it("refuses to run against an unreadable enum rather than pass vacuously", () => {
    // The failure mode: a parse that degrades to [] makes every
    // comparison below succeed against nothing.
    expect(D.checkHelpEnumTables(page("fr", OK_CAT, OK_CUT), [], []).join("")).toMatch(/vacuously/);
  });

  it("holds on the REAL help.html", () => {
    const html = readFileSync("public/help.html", "utf8");
    const cs = readFileSync("src/constants.ts", "utf8");
    const enumOf = (n: string) => {
      const m = new RegExp("var " + n + "\\s*=\\s*\\[([^\\]]*)\\]").exec(cs);
      return m ? m[1]!.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
    };
    const cats = enumOf("CATS"), cuts = enumOf("CUTS");
    expect(cats.length, "CATS must be readable").toBeGreaterThan(10);
    expect(cuts.length, "CUTS must be readable").toBeGreaterThan(10);
    expect(D.checkHelpEnumTables(html, cats, cuts)).toEqual([]);
  });
});

// gate 23: every enum value the app can show must be NAMED in
// the guide, in the language that shows it.
//
// Gate 22 covers two tables and, for the five non-French languages, only their
// cardinality. A sweep of all ten enumerations found both holes occupied:
// FINISHES had never had a row in ANY language (the pipe form has offered the
// field — a missing FIELD, not a missing value), and the
// hand-translated material/fuel lists had drifted from the `_XX` maps the
// dropdown reads (de "Flüssigbrennstoff" vs the app's "Benzin", pt "Charuto"
// vs "Cigarro", four languages keeping the French "Ivoirite" against
// "Ivorite"). Cardinality is blind to a rename: the count was right every time.
describe("checkHelpEnumLabels (gate 23)", () => {
  const ENUMS = { FINISHES: ["Lisse", "Autre"] };
  const MAPS = { FINISHES: { fr: {}, de: { Lisse: "Glatt", Autre: "Andere" } } };
  const page = (fr: string, de: string) =>
    `<div id="sec-fr"><table>${fr}</table></div><div id="sec-de"><table>${de}</table></div>`;

  it("passes when every value is named in its own language, and does NOT demand the French spelling in a translated block", () => {
    // The sparse-map rule: a value absent from `_XX` is shown as-is, and one
    // present must be looked for in its translated form only. Asking for
    // "Lisse" in the German block was the bug in the first sweep I wrote —
    // hence the second half of this name: the German block below carries
    // "Glatt · Andere" and no French spelling at all, so a gate that regressed
    // to the canonical label would fail here. (A separate case asserting
    // exactly that lived below with a byte-identical body; probed, making
    // `labels` fall back to the canonical value reddens this one too.)
    expect(D.checkHelpEnumLabels(page("Lisse · Autre", "Glatt · Andere"), ENUMS, MAPS)).toEqual([]);
  });

  it("catches a value the guide never names", () => {
    const out = D.checkHelpEnumLabels(page("Lisse · Autre", "Andere"), ENUMS, MAPS);
    expect(out.length).toBe(1);
    expect(out[0]).toContain("(de)");
    expect(out[0], "the message must name the TRANSLATED label, which is what the reader looks for")
      .toContain("Glatt");
  });

  it("catches a RENAME, which cardinality cannot see", () => {
    // Same number of items, different word — the shape of every real defect
    // the sweep found.
    const out = D.checkHelpEnumLabels(page("Lisse · Autre", "Poliert · Andere"), ENUMS, MAPS);
    expect(out.length).toBe(1);
    expect(out[0]).toContain("Glatt");
  });

  it("refuses to pass vacuously on an unreadable enum or a block-less page", () => {
    expect(D.checkHelpEnumLabels(page("Lisse", "Glatt"), {}, {})[0]).toContain("vacuously");
    expect(D.checkHelpEnumLabels(page("x", "y"), { F: [] }, {})[0]).toContain("vacuously");
    expect(D.checkHelpEnumLabels("<p>no blocks</p>", ENUMS, MAPS)[0]).toContain("no <div");
  });

  // ── the gate's own KNOWN LIMIT bit ────────────────────────
  // `CATS_DE` holds both `Aromatisch` and `Englisch-Aromatisch`,
  // so the German guide printed the ENGLISH gloss `Aromatic` — a label the
  // German dropdown never shows — and the gate passed, because the compound
  // satisfied the substring search. MEASURED on the real file: "Aromatisch"
  // occurred exactly once, inside "Englisch-Aromatisch".
  describe("a compound sibling cannot answer for a value", () => {
    const E = { CATS: ["Aromatique", "Anglais aromatique"] };
    const M = { CATS: { de: { Aromatique: "Aromatisch", "Anglais aromatique": "Englisch-Aromatisch" } } };
    const de = (body: string) => `<div id="sec-de"><table>${body}</table></div>`;

    it("catches the value swallowed by its own longer sibling", () => {
      const out = D.checkHelpEnumLabels(de("Englisch-Aromatisch, Aromatic"), E, M);
      expect(out.length).toBe(1);
      expect(out[0]).toContain("Aromatisch");
    });

    it("still passes when the guide names BOTH", () => {
      expect(D.checkHelpEnumLabels(de("Englisch-Aromatisch, Aromatisch"), E, M)).toEqual([]);
      // order must not matter — masking is not positional
      expect(D.checkHelpEnumLabels(de("Aromatisch, Englisch-Aromatisch"), E, M)).toEqual([]);
    });

    it("does not fire when only the SHORT value is missing its own sibling", () => {
      // The compound absent, the short one present: the short one is fine and
      // the COMPOUND is the finding. Masking must not blame the wrong value.
      const out = D.checkHelpEnumLabels(de("Aromatisch"), E, M);
      expect(out.length).toBe(1);
      expect(out[0]).toContain("Englisch-Aromatisch");
      expect(out[0]).not.toContain(", Aromatisch");
    });
  });

  it("holds over the REAL shipped guide and the REAL enums", () => {
    const html = readFileSync("public/help.html", "utf8");
    const cts = readFileSync("src/constants.ts", "utf8");
    const enumOf = (n: string) => {
      const m = new RegExp("var " + n + "\\s*=\\s*\\[([^\\]]*)\\]").exec(cts);
      return m ? m[1]!.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
    };
    const mapOf = (n: string) => {
      const m = new RegExp("var " + n + ":\\s*Record<string, string>\\s*=\\s*\\{([^}]*)\\}").exec(cts);
      const o: Record<string, string> = {};
      if (m) for (const p of m[1]!.matchAll(/"?([^",:{]+)"?\s*:\s*"((?:[^"\\]|\\.)*)"/g)) o[p[1]!.trim()] = p[2]!;
      return o;
    };
    const names = ["CATS", "CUTS", "SHAPES", "BENDS", "FILTERS", "BOWL_MATS",
      "STEM_MATS", "FINISHES", "ACC_TYPES", "LIGHTER_FUELS"];
    const enums: any = {}, maps: any = {};
    for (const n of names) {
      enums[n] = enumOf(n);
      expect(enums[n].length, `${n} must be readable or the gate is vacuous`).toBeGreaterThan(2);
      maps[n] = {};
      for (const c of ["fr", "en", "es", "de", "it", "pt"]) {
        maps[n][c] = c === "fr" ? {} : mapOf(`${n}_${c.toUpperCase()}`);
      }
    }
    expect(D.checkHelpEnumLabels(html, enums, maps)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Two Portuguese group labels had drifted out of Portuguese — cat_fam_english
// still read "English & Latakia" while CATS_PT says "Inglês", and
// bowlmat_fam_wood read "Urze" against BOWL_MATS_PT["Bruyère"] = "Briar", the
// word researched and rejected. Neither was reachable by any gate:
// the identical-value gate compares every language to FRENCH, so a value left
// in ENGLISH is invisible to it by construction.
describe("extractGroupLabelKeys (gate 24)", () => {
  it("reads BOTH shapes — the stored labelKey and the BUILT shape_family_ key", () => {
    // SHAPE_FAMILIES stores no labelKey at all; the views concatenate
    // "shape_family_" + key, so a reader of constants.ts sees no i18n key
    // there. That is exactly the table the gate must not miss.
    const src = `
      export var CAT_FAMILIES = [{ labelKey: "cat_fam_english", cats: ["Anglais"] }];
      export var SHAPE_FAMILIES = [{ key: "billiard", shapes: ["Billiard"] }];
    `;
    expect(D.extractGroupLabelKeys(src)).toEqual(["cat_fam_english", "shape_family_billiard"]);
  });

  it("returns [] on a source it cannot parse — the caller must fail, not pass", () => {
    // A parse that degrades to nothing would make the whole gate silent, which
    // is the worst outcome and not the safest. The
    // emptiness is the signal; doc-check.cjs turns it into an error.
    expect(D.extractGroupLabelKeys("export var NOTHING = 1;")).toEqual([]);
    expect(D.extractGroupLabelKeys("")).toEqual([]);
    expect(D.extractGroupLabelKeys(null as unknown as string)).toEqual([]);
  });

  it("de-duplicates and sorts, so the caller's subset is stable", () => {
    const src = `{ labelKey: "fam_other" } { labelKey: "fam_other" } { key: "aaa", shapes: [] }`;
    expect(D.extractGroupLabelKeys(src)).toEqual(["fam_other", "shape_family_aaa"]);
  });

  it("covers the REAL table, and the real table is not empty", () => {
    // Guards against the gate quietly measuring nothing after a refactor of
    // constants.ts — the same non-vacuity check the runner makes.
    const real = D.extractGroupLabelKeys(
      readFileSync("src/constants.ts", "utf8"));
    expect(real.length).toBeGreaterThan(15);
    for (const k of ["cat_fam_english", "bowlmat_fam_wood", "shape_family_length"]) {
      expect(real).toContain(k);
    }
  });
});

describe("the bump gate covers the i18n DICTIONARIES, not just the registry", () => {
  // `^src/i18n\.ts$` is anchored, so it matches the loader and nothing under
  // `src/i18n/` — where every visible string in the app lives. Without the
  // second pattern a translation fix ships with no APP_BUILD bump, version.json
  // never moves, checkVersion never fires and nobody receives the new text.
  const LIVE = readFileSync("scripts/doc-check.cjs", "utf8");
  const arr = (name: string) => {
    const m = LIVE.match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);"));
    if (!m || !m[1]) throw new Error("could not read " + name + " out of doc-check.cjs");
    return eval(m[1]) as RegExp[];
  };
  const VIS = arr("USER_VISIBLE_RE");
  const NEVER = arr("NEVER_VISIBLE_RE");
  const visible = (f: string) => D.findUserVisibleChanges([f], VIS, NEVER).length > 0;

  it("treats a dictionary edit as user-visible", () => {
    expect(visible("src/i18n/pt.ts")).toBe(true);
    expect(visible("src/i18n/fr.ts")).toBe(true);
    expect(visible("src/i18n/languages.ts")).toBe(true);
    expect(visible("src/i18n.ts")).toBe(true);
  });

  it("still lets help.html through — served network-first, so no bump is needed", () => {
    // This exclusion is DELIBERATE and documented; the dictionaries differ
    // because they are bundled into content-hashed chunks, and a bump is the
    // only way they reach anyone.
    expect(visible("public/help.html")).toBe(false);
    expect(visible("public/changelog.html")).toBe(false);
    expect(visible("scripts/doc-check.cjs")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Gate 25 — changelog per-entry language parity
//
// CLAUDE.md has required "every entry in ALL language sections" since the
// changelog gained its second language, and NOTHING checked it: gate 1 reads
// the latest build number out of the FRENCH section only.
//
// Not theoretical. While writing the entries a DUPLICATE Portuguese
// block was inserted, the whole gate set passed, and it was caught by reading
// the file — which is exactly the method that does not scale.
//
// As with every gate here, what matters most is that it still FAILS when it
// should: a guard that quietly stops firing reads as "verified".
// ─────────────────────────────────────────────────────────────
describe("checkChangelogLanguageParity", () => {
  const entry = (b: string, body = "x") =>
    `<h2><span class="tag">v1.5 · Build ${b}</span> T</h2><p>${body}</p>`;
  const doc = (secs: Record<string, string[]>) =>
    Object.entries(secs)
      .map(([code, builds]) => `<div id="sec-${code}">${builds.map((b) => entry(b)).join("")}</div>`)
      .join("");

  it("passes when every language carries the same entries", () => {
    const html = doc({ fr: ["246", "242"], en: ["246", "242"], pt: ["246", "242"] });
    expect(D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "pt"])).toEqual([]);
  });

  it("names the build AND the language that is missing one", () => {
    const html = doc({ fr: ["246", "242"], en: ["246", "242"], pt: ["242"] });
    const errs = D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "pt"]);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("Build 246");
    expect(errs[0]).toContain("pt");
  });

  it("catches a DUPLICATE — the case that actually happened", () => {
    // A presence test cannot see this, which is why the count is compared.
    const html = doc({ fr: ["246"], en: ["246"], pt: ["246", "246"] });
    const errs = D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "pt"]);
    expect(errs.length, "one defect must produce one line").toBe(1);
    expect(errs[0]).toContain("2x");
    expect(errs[0]).toContain("pt");
  });

  it("a duplicate does not make its section the reference", () => {
    // The first version reported one Portuguese mistake as five lines blaming
    // every OTHER language, because the duplicated section had the most
    // entries and so became the yardstick. The reference counts DISTINCT
    // entries for exactly this reason.
    const html = doc({ fr: ["246"], en: ["246"], de: ["246"], it: ["246"], pt: ["246", "246"] });
    const errs = D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "de", "it", "pt"]);
    expect(errs.length).toBe(1);
    expect(errs.join(" ")).not.toContain("MISSING");
  });

  it("catches an entry only ONE language carries", () => {
    const html = doc({ fr: ["246"], en: ["246"], pt: ["246", "999"] });
    const errs = D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "pt"]);
    expect(errs.some((e: string) => e.includes("999") && e.includes("pt"))).toBe(true);
  });

  it("only judges the CURRENT version — older sections are frozen history", () => {
    // Several predate the sixth language; demanding parity there would fail
    // permanently on entries nobody should retro-translate.
    const html =
      `<div id="sec-fr">${entry("246")}<h2><span class="tag">v1.4 · Build 9</span> Old</h2></div>` +
      `<div id="sec-pt">${entry("246")}</div>`;
    expect(D.checkChangelogLanguageParity(html, "1.5", ["fr", "pt"])).toEqual([]);
  });

  it("reports a language section that is absent entirely", () => {
    const html = doc({ fr: ["246"], en: ["246"] });
    const errs = D.checkChangelogLanguageParity(html, "1.5", ["fr", "en", "pt"]);
    expect(errs.some((e: string) => e.includes('sec-pt'))).toBe(true);
  });

  it("REFUSES to pass vacuously", () => {
    // Both directions: no languages to compare, and a file it cannot parse.
    // Either would otherwise return [] and read as a clean bill of health.
    expect(D.checkChangelogLanguageParity(doc({ fr: ["246"] }), "1.5", []).length).toBe(1);
    expect(D.checkChangelogLanguageParity("not html at all", "1.5", ["fr", "pt"]).length).toBe(1);
  });

  it("runs green on the REAL changelog", () => {
    // The gate is only worth anything if it is true of the shipped file.
    const html = readFileSync("public/changelog.html", "utf8");
    const codes = readdirSync("src/i18n")
      .filter((f) => /^[a-z]{2,3}\.ts$/.test(f))
      .map((f) => f.replace(/\.ts$/, ""));
    expect(codes.length, "language list must not be empty").toBeGreaterThan(1);
    const version = JSON.parse(readFileSync("public/version.json", "utf8")).version;
    expect(D.checkChangelogLanguageParity(html, version, codes)).toEqual([]);
  });
});
