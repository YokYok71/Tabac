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
});
