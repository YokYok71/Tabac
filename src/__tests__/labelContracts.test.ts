// Tests for scripts/labelContracts.cjs — the label-truthfulness gates that
// back doc:check (extracted + tested).
//
// WHY THESE EXIST. The gates are themselves a guard, and a guard that stops
// firing is worse than no guard: it reads as "everything is verified" while
// verifying nothing. The gates were originally validated by hand (move a
// constant, edit a marked region, watch CI go red) — but nothing stopped a
// later refactor of labelContracts.cjs from making them vacuously green.
// These tests lock the failure behaviour, which is the only behaviour that
// matters for a guard.
//
// The module is pure — `readFile` is injected — so every case runs against
// an in-memory registry with no filesystem and no real doc files.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages";

const require_ = createRequire(import.meta.url);
const LC = require_("../../scripts/labelContracts.cjs");

/** Build an injected reader over a { path: content } map. */
function reader(files: Record<string, string>) {
  return (rel: string) => (rel in files ? files[rel]! : null);
}

const REGION = (id: string, body: string) =>
  `some prelude\n// LABEL-CONTRACT:start ${id}\n${body}\n// LABEL-CONTRACT:end ${id}\ntrailer\n`;

describe("numeric contracts", () => {
  const reg = {
    numeric: [{
      id: "retention",
      source: "src/constants.ts",
      match: "TRASH_RETENTION_DAYS\\s*=\\s*(\\d+)",
      docs: [{ file: "public/help.html", patterns: ["{n} jours", "{n} days"] }],
    }],
  };

  it("passes when the doc quotes the constant in every language", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/constants.ts": "export var TRASH_RETENTION_DAYS = 30;",
      "public/help.html": "corbeille 30 jours … trash 30 days",
    }));
    expect(errs).toEqual([]);
  });

  it("FAILS when the constant moves and the prose does not", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/constants.ts": "export var TRASH_RETENTION_DAYS = 45;",
      "public/help.html": "corbeille 30 jours … trash 30 days",
    }));
    expect(errs).toHaveLength(2);            // one per language pattern
    expect(errs[0]).toContain("says 45");
    expect(errs[0]).toContain('never says "45 jours"');
  });

  it("FAILS on the language that was forgotten, and only that one", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/constants.ts": "export var TRASH_RETENTION_DAYS = 45;",
      "public/help.html": "corbeille 45 jours … trash 30 days",   // EN not updated
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"45 days"');
  });

  it("FAILS loudly when the constant is renamed (rather than passing quietly)", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/constants.ts": "export var TRASH_KEEP_DAYS = 30;",
      "public/help.html": "corbeille 30 jours … trash 30 days",
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/no longer matches/);
  });

  it("reports a missing source or doc file instead of skipping it", () => {
    expect(LC.numericContractErrors(reg, reader({ "public/help.html": "x" }))[0])
      .toMatch(/source file src\/constants\.ts not found/);
    expect(LC.numericContractErrors(reg, reader({ "src/constants.ts": "TRASH_RETENTION_DAYS = 30;" }))[0])
      .toMatch(/doc file public\/help\.html not found/);
  });

  it("applies `divide` so a ms constant can back a claim in minutes", () => {
    const ms = {
      numeric: [{
        id: "overtime", source: "src/h.ts", match: "MS\\s*=\\s*(\\d+)", divide: 60000,
        docs: [{ file: "d.html", patterns: ["{n} min"] }],
      }],
    };
    expect(LC.numericContractErrors(ms, reader({ "src/h.ts": "var MS = 5400000;", "d.html": "après 90 min" }))).toEqual([]);
    expect(LC.numericContractErrors(ms, reader({ "src/h.ts": "var MS = 5400000;", "d.html": "après 60 min" }))).toHaveLength(1);
  });
});

describe("numeric contracts — sum mode (derived claims)", () => {
  // "Tasting auto-ended after 95 min" is really THRESHOLD (90) + GRACE (5).
  // Pinning 95 to one of them would silently miss a change to the other,
  // which is the whole reason this mode exists.
  const reg = {
    numeric: [{
      id: "autoend",
      sum: [
        { source: "src/t.ts", match: "THRESHOLD\\s*=\\s*(\\d+)" },
        { source: "src/t.ts", match: "GRACE\\s*=\\s*(\\d+)" },
      ],
      docs: [{ file: "src/i18n/fr.ts", patterns: ["{n} min"] }],
    }],
  };
  const src = (t: number, g: number) => `var THRESHOLD = ${t}; var GRACE = ${g};`;

  it("adds the terms and passes when the doc quotes the total", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/t.ts": src(90, 5), "src/i18n/fr.ts": 'k:"après 95 min"',
    }))).toEqual([]);
  });

  it("FAILS when only the SECOND term moves — the case a single source misses", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/t.ts": src(90, 8), "src/i18n/fr.ts": 'k:"après 95 min"',
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("says 98");
  });

  it("FAILS when only the FIRST term moves", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/t.ts": src(120, 5), "src/i18n/fr.ts": 'k:"après 95 min"',
    }))).toHaveLength(1);
  });

  it("propagates a broken term instead of silently summing what it found", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/t.ts": "var THRESHOLD = 90; var DELAY = 5;",   // GRACE renamed
      "src/i18n/fr.ts": 'k:"après 95 min"',
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/no longer matches/);
  });

  it("names its terms in the failure message rather than 'undefined'", () => {
    const label = LC.sourceLabel(reg.numeric[0]);
    expect(label).toContain("the sum of");
    expect(label).not.toContain("undefined");
    expect(LC.sourceLabel({ source: "src/a.ts" })).toBe("src/a.ts");
    expect(LC.sourceLabel({})).toBe("?");
  });
});

describe("numeric contracts — atLeast mode (floor claims)", () => {
  // A floor claim — "over N items" — stays true as the collection grows and
  // must break the moment it shrinks below what is advertised. That is the one
  // shape `exact` cannot express, which is why `mode: "atLeast"` and
  // `sourceJson` are KEPT even though no live contract uses either today
  // (see the note on `scripts/labelContracts.cjs`). The fixture used to name
  // `src/data/db.json`, the bundled catalogue — a path deleted from the repo
  // when the catalogue became the user's own file — so it read as coverage of
  // something that no longer exists. Renamed to a neutral path, like the
  // `src/t.ts` / `src/c.ts` fixtures elsewhere in this file; the mechanism
  // under test is unchanged.
  const reg = {
    numeric: [{
      id: "catalog",
      sourceJson: "src/j.json",
      jsonArrayPath: "blends",
      mode: "atLeast",
      docs: [{ file: "help.html", patterns: ["plus de (\\d+) blends"] }],
    }],
  };
  const db = (n: number) => JSON.stringify({ blends: Array.from({ length: n }, (_, i) => i) });

  it("passes while the real count exceeds the advertised floor", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/j.json": db(1222), "help.html": "plus de 1200 blends",
    }))).toEqual([]);
  });

  it("FAILS when the catalogue shrinks below the advertised floor", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/j.json": db(800), "help.html": "plus de 1200 blends",
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("advertises 1200");
    expect(errs[0]).toContain("only has 800");
  });

  it("FAILS when the claim's wording moved out from under the pattern", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/j.json": db(1222), "help.html": "environ 1200 mélanges",
    }));
    expect(errs[0]).toMatch(/no longer contains a claim matching/);
  });

  it("counts an object map as well as an array", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/j.json": JSON.stringify({ blends: { a: 1, b: 2 } }),
      "help.html": "plus de 2 blends",
    }))).toEqual([]);
  });

  // EVERY occurrence, not just the first. `doc.match` without
  // the `g` flag returned one match, so a claim repeated in six languages was
  // checked in ONE of them: raising the French to a truthful figure and leaving
  // the German overstated passed the gate. Measured by probe on the real
  // help.html before the fix — es/de/it/pt were each set to 9999 in turn and
  // doc:check stayed green every time, because the French match came first.
  it("checks EVERY occurrence, not only the first", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/j.json": db(1400),
      // first claim truthful, second overstated — the shape a six-language
      // doc takes when only one section was updated.
      "help.html": "plus de 1400 blends … et ailleurs plus de 9999 blends",
    }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("advertises 9999");
  });

  it("reports each overstatement separately", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/j.json": db(1400),
      "help.html": "plus de 9998 blends … plus de 9999 blends",
    }));
    expect(errs).toHaveLength(2);
  });

  it("reports malformed JSON rather than treating it as an empty catalogue", () => {
    const errs = LC.numericContractErrors(reg, reader({
      "src/j.json": "{not json", "help.html": "plus de 1200 blends",
    }));
    expect(errs[0]).toMatch(/not valid JSON/);
  });
});

describe("docText — HTML is compared on its text layer", () => {
  // A claim is routinely split by inline markup, which a source-level match
  // misses even though the sentence the user reads is intact. This is not a
  // cosmetic nicety: it was the reason the gdrive-max-manual contract failed
  // on all five languages while every sentence was in fact correct.
  const reg = {
    numeric: [{
      id: "manual-backups", source: "src/c.ts", match: "MAX\\s*=\\s*(\\d+)",
      docs: [{ file: "public/help.html", patterns: ["jusqu'à {n} sauvegardes"] }],
    }],
  };

  it("matches a claim split by a tag", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/c.ts": "var MAX = 3;",
      "public/help.html": "<p>jusqu'à <strong>3</strong> sauvegardes manuelles</p>",
    }))).toEqual([]);
  });

  it("still fails when the split claim quotes the wrong number", () => {
    expect(LC.numericContractErrors(reg, reader({
      "src/c.ts": "var MAX = 5;",
      "public/help.html": "<p>jusqu'à <strong>3</strong> sauvegardes manuelles</p>",
    }))).toHaveLength(1);
  });

  it("ignores script/style bodies so a stray literal there can't satisfy a claim", () => {
    const t = LC.docText('<script>var s = "jusqu\'à 3 sauvegardes";</script><p>texte</p>', "help.html");
    expect(t).not.toContain("sauvegardes");
  });

  it("leaves non-HTML docs byte-exact, and honours raw:true", () => {
    expect(LC.docText("a  <b>  c", "notes.md")).toBe("a  <b>  c");
    expect(LC.docText("a  <b>  c", "help.html", true)).toBe("a  <b>  c");
  });
});

describe("domainCoverageErrors", () => {
  // Closes the scheme's last blind spot: nothing forced anyone to CREATE a
  // contract, so a new endpoint could ship disclosed but uncoupled.
  const reg = {
    prose: [
      { id: "osm", domains: ["nominatim.openstreetmap.org"] },
      { id: "cdn", domains: ["cdnjs.cloudflare.com"] },
    ],
  };

  it("passes when every contacted host is claimed", () => {
    expect(LC.domainCoverageErrors(reg,
      new Set(["nominatim.openstreetmap.org", "cdnjs.cloudflare.com"]), new Set())).toEqual([]);
  });

  it("FAILS on a newly contacted host that no contract claims", () => {
    const errs = LC.domainCoverageErrors(reg,
      new Set(["nominatim.openstreetmap.org", "cdnjs.cloudflare.com", "api.newthing.com"]), new Set());
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"api.newthing.com" but no prose contract claims it');
  });

  it("honours the ignore set for placeholders and tapped links", () => {
    expect(LC.domainCoverageErrors(reg,
      new Set(["nominatim.openstreetmap.org", "cdnjs.cloudflare.com", "example.com"]),
      new Set(["example.com"]))).toEqual([]);
  });

  it("FAILS on a claimed host the app no longer contacts (stale, may over-disclose)", () => {
    const errs = LC.domainCoverageErrors(reg, new Set(["nominatim.openstreetmap.org"]), new Set());
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("no longer contacts it");
  });

  it("FAILS when two contracts claim the same host, so failures name one region", () => {
    const dup = { prose: [{ id: "a", domains: ["x.com"] }, { id: "b", domains: ["x.com"] }] };
    const errs = LC.domainCoverageErrors(dup, new Set(["x.com"]), new Set());
    expect(errs.some((e: string) => /claimed by two prose contracts/.test(e))).toBe(true);
  });

  it("tolerates an absent domains field rather than throwing", () => {
    expect(LC.domainCoverageErrors({ prose: [{ id: "a" }] }, new Set(), new Set())).toEqual([]);
    expect(LC.domainCoverageErrors({}, undefined, undefined)).toEqual([]);
  });
});

describe("fingerprintRegion", () => {
  it("hashes only the marked region", () => {
    const a = LC.fingerprintRegion(REGION("x", "return 1;"), "x");
    const b = LC.fingerprintRegion("different prelude\n" + REGION("x", "return 1;"), "x");
    expect(a.hash).toBe(b.hash);            // prelude/trailer are excluded
  });

  it("is stable under reformatting but not under a semantic edit", () => {
    const tight = LC.fingerprintRegion(REGION("x", "if (a) { return 1; }"), "x");
    const loose = LC.fingerprintRegion(REGION("x", "if (a) {\n    return 1;\n  }"), "x");
    expect(loose.hash).toBe(tight.hash);    // whitespace-collapsed
    const changed = LC.fingerprintRegion(REGION("x", "if (b) { return 1; }"), "x");
    expect(changed.hash).not.toBe(tight.hash);
  });

  it("errors when the markers are missing, inverted, or the file is absent", () => {
    expect(LC.fingerprintRegion("no markers here", "x").error).toMatch(/not found/);
    expect(LC.fingerprintRegion(
      "// LABEL-CONTRACT:end x\n// LABEL-CONTRACT:start x\n", "x").error).toMatch(/not found/);
    expect(LC.fingerprintRegion(null, "x").error).toMatch(/not found/);
  });
});

describe("prose contracts", () => {
  const mk = () => ({
    prose: [{
      id: "merge", region: "src/m.ts",
      labels: ["import_merge_desc (5 languages)"],
      why: "the merge appends lots to an existing blend",
      fingerprint: "",
    }],
  });
  const files = (body: string) => reader({ "src/m.ts": REGION("merge", body) });

  it("records the fingerprint on the first run", () => {
    const reg = mk();
    const recorded: string[] = [];
    const res = LC.proseContractResults(reg, files("v1"), [], (id: string) => recorded.push(id));
    expect(res.errors).toEqual([]);
    expect(res.updated).toBe(true);
    expect(recorded).toEqual(["merge"]);
    expect(reg.prose[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("stays green while the region is untouched", () => {
    const reg = mk();
    LC.proseContractResults(reg, files("v1"), []);
    expect(LC.proseContractResults(reg, files("v1"), []).errors).toEqual([]);
  });

  it("FAILS when the documented code changes, naming the labels to re-read", () => {
    const reg = mk();
    LC.proseContractResults(reg, files("v1"), []);
    const res = LC.proseContractResults(reg, files("v2 — behaviour moved"), []);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("the code it documents changed");
    expect(res.errors[0]).toContain("import_merge_desc (5 languages)");
    expect(res.errors[0]).toContain("the merge appends lots to an existing blend");
    expect(res.errors[0]).toContain("--accept merge");
    // Crucially: drift does NOT silently re-record the fingerprint, or the
    // next run would go green on its own and the re-read never happens.
    expect(res.updated).toBe(false);
  });

  it("only clears the failure once the id is explicitly accepted", () => {
    const reg = mk();
    LC.proseContractResults(reg, files("v1"), []);
    expect(LC.proseContractResults(reg, files("v2"), ["other-id"]).errors).toHaveLength(1);
    const ok = LC.proseContractResults(reg, files("v2"), ["merge"]);
    expect(ok.errors).toEqual([]);
    expect(ok.updated).toBe(true);
    expect(LC.proseContractResults(reg, files("v2"), []).errors).toEqual([]);
  });

  it("`--accept all` acknowledges every entry", () => {
    const reg = mk();
    LC.proseContractResults(reg, files("v1"), []);
    expect(LC.proseContractResults(reg, files("v2"), ["all"]).errors).toEqual([]);
  });

  it("FAILS when the markers are removed rather than passing silently", () => {
    const reg = mk();
    LC.proseContractResults(reg, files("v1"), []);
    const res = LC.proseContractResults(reg, reader({ "src/m.ts": "markers stripped" }), []);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/markers .* not found/);
  });
});

describe("parseAcceptFlags", () => {
  it("collects repeated --accept ids and ignores everything else", () => {
    expect(LC.parseAcceptFlags(["--accept", "a", "--verbose", "--accept", "b"])).toEqual(["a", "b"]);
    expect(LC.parseAcceptFlags(["--accept"])).toEqual([]);   // dangling flag
    expect(LC.parseAcceptFlags([])).toEqual([]);
    expect(LC.parseAcceptFlags(undefined as any)).toEqual([]);
  });
});

describe("the real registry", () => {
  // Guards against the registry itself rotting into decoration.
  const reg = require_("../../scripts/label-contracts.json");

  it("carries contracts in both gates", () => {
    expect(reg.numeric.length).toBeGreaterThan(0);
    expect(reg.prose.length).toBeGreaterThan(0);
  });

  it("has a recorded fingerprint, a region, labels and a why for every prose entry", () => {
    for (const c of reg.prose) {
      expect(c.fingerprint, `${c.id} fingerprint`).toMatch(/^[0-9a-f]{16}$/);
      expect(c.region, `${c.id} region`).toBeTruthy();
      expect(c.labels?.length, `${c.id} labels`).toBeGreaterThan(0);
      expect(c.why, `${c.id} why`).toBeTruthy();
    }
  });

  // Vendor model line-ups move every few months and each refresh silently
  // invalidates the help's "Choix du modèle" note — one pass found the app's
  // own Gemini DEFAULT four months dead. Nothing in the other
  // gates stops someone DELETING a coupling, so the highest-churn one is
  // pinned here: the contract must exist, and its markers must actually wrap
  // the model maps (markers left behind on the wrong lines fingerprint the
  // wrong code and quietly stop firing).
  it("keeps the AI model catalogue coupled to the help note", () => {
    const c = reg.prose.find((x: any) => x.id === "ai-model-catalogue");
    expect(c, "the ai-model-catalogue coupling was removed").toBeTruthy();
    expect(c.labels.join(" ")).toMatch(/help\.html/);
    const src = readFileSync(c.region, "utf8");
    const start = src.indexOf("LABEL-CONTRACT:start ai-model-catalogue");
    const end = src.indexOf("LABEL-CONTRACT:end ai-model-catalogue");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = src.slice(start, end);
    // The three maps a model refresh touches must all be INSIDE the region.
    for (const sym of ["AI_MODEL_DEFAULTS", "AI_MODEL_OPTIONS", "AI_MODEL_ALIASES"]) {
      expect(region, `${sym} fell outside the fingerprinted region`).toContain(sym);
    }
  });

  it("claims every host at most once, so a failure names one region", () => {
    const hosts = reg.prose.flatMap((c: any) => c.domains || []);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("has unique ids and at least one doc pattern per numeric entry", () => {
    const ids = [...reg.numeric, ...reg.prose].map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of reg.numeric) {
      expect(c.docs?.length, `${c.id} docs`).toBeGreaterThan(0);
      for (const d of c.docs) expect(d.patterns?.length, `${c.id} patterns`).toBeGreaterThan(0);
    }
  });

  it("gives every numeric entry a readable source label (no 'undefined says N')", () => {
    for (const c of reg.numeric) {
      expect(LC.sourceLabel(c), `${c.id} source label`).not.toContain("undefined");
      expect(LC.sourceLabel(c), `${c.id} source label`).not.toBe("?");
    }
  });

  it("guards the i18n dictionaries, not just help.html", () => {
    // The asymmetry: the same numbers appear in the dictionaries, and
    // for three claims (photo cap, search minimum, auto-close total) the dicts
    // are the ONLY place they appear.
    const targets = new Set(reg.numeric.flatMap((c: any) => (c.docs || []).map((d: any) => d.file)));
    for (const lang of LANGUAGES.map((l) => l.code)) {   // derived, never copied
      expect(targets.has(`src/i18n/${lang}.ts`), `dictionary ${lang} guarded`).toBe(true);
    }
    expect(targets.has("public/help.html")).toBe(true);
  });
});
