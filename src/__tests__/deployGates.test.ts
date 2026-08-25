import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The gates must gate the DEPLOY, not merely exist.
//
// The finding this locks: typecheck / lint / prune lived in
// `checks.yml` and size:check in `lighthouse.yml`, both running IN PARALLEL
// with `deploy.yml`. Neither could stop it. A push that failed any of them
// still uploaded its Pages artifact and shipped; the red X arrived afterwards,
// on a build users already had. An earlier release fixed "these gates run nowhere"; it
// did not fix "they gate nothing", and the difference is invisible in a green
// dashboard — which is why it survived.
//
// Deliberately NOT parsed as YAML: no YAML parser is a dependency here (adding
// one only for this would be flagged by knip), and the property under test is
// positional — does the gate appear before the upload? — which the raw text
// answers directly and without a schema to keep in sync.

const ROOT = resolve(__dirname, "../..");
const deploy = readFileSync(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8");
const checks = readFileSync(resolve(ROOT, ".github/workflows/checks.yml"), "utf8");

const UPLOAD = "upload-pages-artifact";

// Every gate that must hold the artifact back. `npm test` and `doc:check` are
// already in deploy.yml and pre-date this test; they are included so the list
// is the complete set of what gates a deploy, not just the part added last.
const GATES = [
  "npm test",
  "npm run doc:check",
  "npm run typecheck",
  "npm run lint",
  "npm run prune",
  "npm run size:check",
];
// `npm run catalogue:check` was a sixth gate. It read the
// catalogue the app shipped; the app ships none, so the script now REQUIRES a
// `--csv` argument and is a reviewer tool run against a delivery, not a gate
// with an input. A gate whose input no longer exists would either fail every
// push or pass having examined nothing — the vacuous pass this file is written
// against.

describe("deploy.yml — the gates gate the deploy", () => {
  it("uploads the Pages artifact exactly once (the anchor these assertions need)", () => {
    // Non-vacuity: if the upload step were renamed or removed, every
    // "appears before the upload" assertion below would pass trivially.
    const n = deploy.split(UPLOAD).length - 1;
    expect(n).toBe(1);
  });

  GATES.forEach((cmd) => {
    it(`runs \`${cmd}\` BEFORE the artifact upload`, () => {
      const at = deploy.indexOf(cmd);
      expect(at, `${cmd} is not in deploy.yml at all`).toBeGreaterThan(-1);
      expect(at).toBeLessThan(deploy.indexOf(UPLOAD));
    });
  });

  it("keeps checks.yml running on pull_request — it is the ONLY gate there", () => {
    // deploy.yml runs on push only. Dropping the pull_request trigger from
    // checks.yml while "the gates are in deploy.yml now" would leave PRs
    // completely unguarded — a plausible cleanup, so it is pinned.
    expect(checks).toMatch(/^\s*pull_request:\s*$/m);
  });

  it("does not let a failing gate be skipped by an earlier failure", () => {
    // Each gate carries `!cancelled()` so one push reports every class at
    // once. Without it, the first failure short-circuits the rest and a
    // commit needs one re-run per problem.
    const tail = deploy.slice(deploy.indexOf("npm run typecheck") - 400, deploy.indexOf(UPLOAD));
    const gateSteps = tail.split(/\n {6}- name: /).slice(1);
    // Four (catalogue:check was the fifth). Derived from
    // GATES minus the two that pre-date the block, so the number cannot drift
    // from the list above.
    expect(gateSteps.length).toBeGreaterThanOrEqual(GATES.length - 2);
    gateSteps.forEach((s) => expect(s).toContain("!cancelled()"));
  });

  // The one exception to "every gate runs regardless", and it earns it.
  //
  // `npm test` and `npm run build` share ONE step, so a failing test means
  // dist/ was never produced. size:check then printed `dist/ not found` — the
  // LAST error in the job log, and therefore the first thing a reader sees. A
  // flaky test in the suite was diagnosed as a build problem because of it.
  //
  // This does NOT weaken the `!cancelled()` intent: the gate is skipped only
  // when its input cannot exist, and every other class is still reported on the
  // same push.
  describe("the bundle-size gate does not report a phantom failure", () => {
    const stepIdx = deploy.indexOf("- name: Bundle size budget");
    const step = deploy.slice(stepIdx, deploy.indexOf("run:", stepIdx));

    it("is anchored (non-vacuity)", () => {
      expect(stepIdx).toBeGreaterThan(-1);
    });

    it("runs only when the build step SUCCEEDED", () => {
      expect(step).toContain("steps.build.outcome == 'success'");
    });

    it("still carries !cancelled(), so it is skipped for that reason alone", () => {
      expect(step).toContain("!cancelled()");
    });

    it("keeps the id on the build step that the condition keys on", () => {
      // Without the id the condition silently evaluates to an empty string and
      // the gate never runs at all — worse than the defect it fixes.
      expect(deploy).toMatch(/- name: Build \(Vite\)[^\n]*\n\s+id: build\n/);
    });
  });

  // ── Les deux vérifications NAVIGATEUR sont enfin lancées quelque part ──────
  //
  // Elles voient ce qu'aucune autre porte ne voit — une étiquette rognée, un
  // conteneur qui glisse latéralement, une paire de couleurs illisible — et
  // elles étaient opt-in parce qu'elles coûtaient ~55 min et ~45 min. Elles
  // tournaient donc quelques fois par an, à la main : l'état que ce dépôt
  // nomme « une porte que personne ne lance est de la documentation ».
  //
  // Ce qui a changé est mesuré : le fan-out (un processus par langue, un par
  // palette, sur un serveur d'aperçu partagé) les ramène à ~10 min et ~3 min
  // sur une machine 4 vCPU — la forme d'`ubuntu-latest`. Ce bloc épingle le
  // câblage, parce que c'est LUI qui pourrit : la campagne peut rester
  // parfaite pendant qu'un déclencheur disparaît, et un tableau de bord vert
  // ne dit rien de ce qui n'a pas tourné.
  describe("the two browser checks run in CI", () => {
    const jobIdx = checks.indexOf("\n  browser:");
    const job = jobIdx < 0 ? "" : checks.slice(jobIdx);

    it("the job exists (non-vacuity — every assertion below reads it)", () => {
      expect(jobIdx, "the `browser` job is gone from checks.yml").toBeGreaterThan(-1);
    });

    it("runs BOTH campaigns, in full", () => {
      // Narrowing an axis is legitimate while iterating and is exactly what
      // must not become the CI default: a run over `--langs de` reports green
      // having measured one language of six, and reads as full coverage.
      expect(job).toContain("npm run theme:contrast");
      expect(job).toContain("npm run i18n:layout");
      expect(job, "an axis is narrowed — CI would report on a slice")
        .not.toMatch(/--langs|--scales|--widths|THEME_CONTRAST_THEMES|THEME_CONTRAST_MODES/);
    });

    it("builds first — both checks REFUSE a stale dist/", () => {
      const build = job.indexOf("npm run build");
      expect(build, "no build step").toBeGreaterThan(-1);
      expect(build).toBeLessThan(job.indexOf("npm run theme:contrast"));
    });

    it("installs the browser, which is deliberately not a dependency", () => {
      expect(job).toContain("npm i --no-save playwright-core");
      expect(job, "the checks skip the headless shell, so chromium is required")
        .toMatch(/playwright-core install[^\n]*chromium/);
    });

    it("each campaign reports even when the other failed", () => {
      const after = job.slice(job.indexOf("Contrast"));
      expect((after.match(/!cancelled\(\)/g) || []).length,
        "one failing campaign hides the other").toBeGreaterThanOrEqual(2);
    });

    it("fires on PUSH as well as on pull_request", () => {
      // The convention here is to push straight to main, so a
      // pull-request-only browser gate would fire almost never — which is the
      // state this job exists to end. Both triggers, or it is decoration.
      expect(checks).toMatch(/^\s*push:\s*$/m);
      expect(checks).toMatch(/^\s*pull_request:\s*$/m);
    });

    it("stays OUT of the deploy path, and that is a decision", () => {
      // deploy.yml is where a gate can hold the artifact back, and this one is
      // deliberately not there: ~15 min on EVERY deploy, permanently, for a
      // class that is visible and re-pushable — unlike a type error. If a
      // layout regression ever reaches users on main, move it and pay it.
      expect(deploy).not.toContain("npm run i18n:layout");
      expect(deploy).not.toContain("npm run theme:contrast");
    });

    it("is its OWN job, so it never delays the fast lane", () => {
      // Appended to `checks` it would put a 15-minute build-and-browser run in
      // front of gates that answer in seconds.
      const fast = checks.indexOf("\n  checks:");
      expect(fast).toBeGreaterThan(-1);
      expect(fast, "the browser steps were folded into the fast job")
        .toBeLessThan(jobIdx);
      expect(checks.slice(fast, jobIdx),
        "the fast job now builds — it does not need to").not.toContain("npm run build");
    });
  });
});
