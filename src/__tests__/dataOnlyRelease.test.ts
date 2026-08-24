// The data-only release writer — tested because NOTHING CALLED IT.
//
// `scripts/data-only-release.cjs` bumps APP_BUILD and writes a
// `version.json` carrying `data_only: true`, so the running app applies the
// release silently instead of counting down at the user. It went a long
// stretch with no caller and no test, and in that time a new REQUIRED field
// (`generation`, compared before version and build, and pinned by doc:check)
// was added to version.json — this writer was never taught to emit it. It
// therefore produced a file the gate rejects, and nobody found out, because
// the only way to find out was to run it.
//
// That is the shape this file exists to stop: a build tool nobody invokes rots
// silently, and it rots in the direction of shipping a broken release.
//
// It also had a hardcoded `"1.2"` fallback if APP_VERSION failed to parse —
// a version OLDER than anything shipping, which `isRemoteNewer` refuses as a
// downgrade, so the release would simply never have been offered. A parse
// failure must stop the release, not invent one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_VERSION, APP_BUILD, APP_GENERATION } from "../constants";

const require_ = createRequire(import.meta.url);
const SCRIPT = "scripts/data-only-release.cjs";

// The script writes into the REAL tree (that is its job), so drive it against
// a copy: snapshot both files, run, assert, restore.
const CONSTANTS = "src/constants.ts";
const VERSION = "public/version.json";
let constBak = "", verBak = "";

beforeEach(() => {
  constBak = readFileSync(CONSTANTS, "utf8");
  verBak = readFileSync(VERSION, "utf8");
});
afterEach(() => {
  writeFileSync(CONSTANTS, constBak);
  writeFileSync(VERSION, verBak);
});

function run(opts?: { silent?: boolean }) {
  delete require_.cache[require_.resolve("../../" + SCRIPT)];
  const mod = require_("../../" + SCRIPT);
  const res = mod.bumpDataOnly(opts || {});
  return { res, version: JSON.parse(readFileSync(VERSION, "utf8")) };
}

describe("a silent release is a COMPLETE version.json", () => {
  it("carries version, build, generation AND the data_only marker", () => {
    const { res, version } = run();
    expect(res.prevBuild).toBe(Number(APP_BUILD));
    expect(res.nextBuild).toBe(String(Number(APP_BUILD) + 1));
    expect(version).toEqual({
      version: APP_VERSION,
      build: String(Number(APP_BUILD) + 1),
      generation: Number(APP_GENERATION),
      data_only: true,
    });
  });

  it("THE DEFECT: the generation is not optional", () => {
    // doc:check pins version.json's generation to APP_GENERATION, so a file
    // without it fails the gate; and `isRemoteNewer` reads it BEFORE version
    // and build. Asserted on its own so the reason is legible when it breaks.
    const { version } = run();
    expect(version.generation, "absent = the pre-repair behaviour")
      .toBe(Number(APP_GENERATION));
  });

  it("bumps APP_BUILD in constants.ts by exactly one", () => {
    run();
    const src = readFileSync(CONSTANTS, "utf8");
    const m = src.match(/APP_BUILD\s*=\s*"(\d+)"/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(Number(APP_BUILD) + 1);
  });

  it("…and the two files AGREE, which is the whole point of the writer", () => {
    const { version } = run();
    const src = readFileSync(CONSTANTS, "utf8");
    expect(version.build).toBe(src.match(/APP_BUILD\s*=\s*"(\d+)"/)![1]);
    expect(String(version.version)).toBe(src.match(/APP_VERSION\s*=\s*"([^"]+)"/)![1]);
    expect(String(version.generation)).toBe(src.match(/APP_GENERATION\s*=\s*(\d+)/)![1]);
  });
});

describe("--visible bumps without the silent marker", () => {
  it("omits data_only, so the ordinary countdown fires", () => {
    const { version } = run({ silent: false });
    expect(version.data_only).toBeUndefined();
    expect(version.generation).toBe(Number(APP_GENERATION));
    expect(version.build).toBe(String(Number(APP_BUILD) + 1));
  });
});

describe("a parse failure STOPS the release, it does not invent one", () => {
  // Both fields used to degrade: APP_VERSION fell back to a hardcoded "1.2"
  // (older than anything shipping, so `isRemoteNewer` would refuse it as a
  // downgrade and the release would never be offered), and APP_GENERATION was
  // simply not read.
  //
  // Asserted on the SOURCE, with comments blanked FIRST. The first version of
  // this block searched the raw file for the old fallback and matched the
  // comment explaining its removal — a source assertion satisfied by the prose
  // describing the fix is no assertion at all.
  const code = () => readFileSync(SCRIPT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("throws on an unparseable APP_VERSION rather than writing 1.2", () => {
    expect(code(), "the 1.2 fallback is gone").not.toContain('"1.2"');
    expect(code()).toMatch(/could not parse APP_VERSION/);
  });

  it("throws on an unparseable APP_GENERATION", () => {
    expect(code()).toMatch(/could not parse APP_GENERATION/);
  });

  it("throws on an unparseable APP_BUILD", () => {
    expect(code()).toMatch(/could not parse APP_BUILD/);
  });
});

describe("the script is REACHABLE", () => {
  it("package.json exposes it, so it stops being a file nobody runs", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const hit = Object.values(pkg.scripts as Record<string, string>)
      .filter((v) => v.includes("data-only-release"));
    expect(hit.length, "no npm script points at it").toBeGreaterThan(0);
  });

  it("and its header no longer names a script that was deleted", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src, "import-tobacco-db.cjs is gone").not.toContain("import-tobacco-db");
  });
});

// THE TEST USED TO WRITE THE REAL TREE, AND THAT COST A WORKING COPY.
//
// `beforeEach` snapshots `src/constants.ts` + `public/version.json`, the script
// bumps them, `afterEach` restores. That holds only while the process survives
// to the restore AND is the only writer. Neither held: a run interrupted
// between the two leaves the repo with APP_BUILD already bumped, and three
// concurrent checkouts of this repo (git worktrees, each running its own suite)
// resolve `CONSTANTS` against `process.cwd()` while the script resolves its own
// paths against `__dirname` — so the copies read and wrote each other's files.
// MEASURED: `src/constants.ts` came back TRUNCATED and `public/version.json`
// EMPTY, in a working tree with real uncommitted work in it, and the failure
// surfaced as "could not parse APP_BUILD" — an error about the repo, not about
// the script.
//
// The repo's own answer to ambient state is injection: `applyCataloguePlan`
// takes `nowIso`, `catalogueSave` takes `nowMs`, `useUserCatalogue` is handed
// `dlFile`. So the writer takes a ROOT. The default is unchanged (`..` from the
// script), so the CLI and `npm run release:data` behave exactly as before —
// this only gives a caller that must not touch the tree a way to say so.
describe("the writer can be pointed somewhere that is not the repo", () => {
  it("writes under the given root and leaves the real tree alone", () => {
    const realConst = readFileSync(CONSTANTS, "utf8");
    const realVer = readFileSync(VERSION, "utf8");
    const root = mkdtempSync(join(tmpdir(), "release-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, "src", "constants.ts"), realConst);
    writeFileSync(join(root, "public", "version.json"), realVer);

    delete require_.cache[require_.resolve("../../" + SCRIPT)];
    const res = require_("../../" + SCRIPT).bumpDataOnly({ root });

    // It did the job — over there.
    expect(res.nextBuild).toBe(String(Number(APP_BUILD) + 1));
    const wrote = JSON.parse(readFileSync(join(root, "public", "version.json"), "utf8"));
    expect(wrote.build).toBe(String(Number(APP_BUILD) + 1));
    expect(wrote.generation).toBe(Number(APP_GENERATION));
    expect(readFileSync(join(root, "src", "constants.ts"), "utf8"))
      .toMatch(new RegExp('APP_BUILD\\s*=\\s*"' + (Number(APP_BUILD) + 1) + '"'));

    // …and NOT here. This is the assertion the whole block exists for: the
    // `afterEach` above would hide a write to the real tree, so it is checked
    // before the hook can paper over it.
    expect(readFileSync(CONSTANTS, "utf8"), "the real constants.ts was written").toBe(realConst);
    expect(readFileSync(VERSION, "utf8"), "the real version.json was written").toBe(realVer);
    rmSync(root, { recursive: true, force: true });
  });

  it("still defaults to the repo when no root is given", () => {
    // Non-vacuity: a `root` that silently became mandatory, or a default that
    // pointed anywhere else, would make `npm run release:data` write nothing
    // where the release actually has to happen — and no other case would notice,
    // because they all restore what they clobber.
    run();
    expect(Number(readFileSync(CONSTANTS, "utf8").match(/APP_BUILD\s*=\s*"(\d+)"/)![1]))
      .toBe(Number(APP_BUILD) + 1);
  });
});
