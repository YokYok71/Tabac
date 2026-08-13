/**
 * The invariants have to be CALLED.
 *
 * `src/utils/lotInvariants.ts` is thoroughly tested as a module: every rule has
 * cases, and a mutation run over it comes back clean. None of that is worth
 * anything if nobody invokes it. There are exactly two call sites — `save()` in
 * App.tsx, which runs on every persist, and `useLotIntegrityProbe`, which
 * covers the user who opens the app with already-corrupted data and never
 * saves — and deleting the App.tsx one left the whole suite green.
 *
 * That is the failure mode this repo has hit before: an audit found a doc:check
 * gate whose call site could be removed with 3672 tests still passing, and
 * `prune` sat red for nine releases under a documented "zero findings" baseline.
 * A check that has silently stopped running reports success exactly as loudly
 * as one that passes.
 *
 * `save()` lives inside the App component behind ~50 hooks, so rendering it to
 * observe one call would test the harness more than the wiring. A source-level
 * assertion is the repo's established answer for this (navScrollGuard,
 * iosPwaDockGuard, docCheckWiring all do the same), and it fails for the one
 * reason that matters: the line is gone.
 *
 * The probe's own gating (`loading`, the stand-down branch) is covered
 * behaviourally by lotIntegrityProbeGating.test.tsx — this file only guards the
 * fact of the calls.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const APP_SRC = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const PROBE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../hooks/useLotIntegrityProbe.ts"),
  "utf8",
);

// Strip `//` and `/* */` comments, preserving length so any offset we report
// still points at the real file. A call that has been deleted but is still
// DESCRIBED in the comment above it is precisely the case to catch — the same
// property docCheckWiring.test.ts relies on.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// Body of `var save = useCallback(function (nd: any) { … })`, up to the
// matching close at the same indent level.
function extractSaveBody(src: string): string | null {
  const sig = "  var save = useCallback(function (nd: any) {";
  const at = src.indexOf(sig);
  if (at < 0) return null;
  const tail = src.slice(at + sig.length);
  const endM = tail.match(/\n {2}\},\s*\[/);
  if (!endM) return null;
  return tail.slice(0, tail.indexOf(endM[0]));
}

describe("runtime invariants are wired to the two paths that persist or load data", () => {
  it("App.tsx still defines the save() callback this guard inspects", () => {
    // Guards the guard: a rename of `save` must fail here loudly rather than
    // make the assertions below vacuous.
    expect(extractSaveBody(APP_SRC)).not.toBeNull();
  });

  it("save() calls assertLotInvariants on the payload it is about to persist", () => {
    const body = stripComments(extractSaveBody(APP_SRC)!);
    expect(body).toMatch(/\bassertLotInvariants\s*\(\s*nd\s*\)/);
  });

  it("save() checks BEFORE it commits, so a violation is attributed to its own write", () => {
    const body = stripComments(extractSaveBody(APP_SRC)!);
    const check = body.search(/\bassertLotInvariants\s*\(/);
    const commit = body.search(/\bsetData\s*\(\s*nd\s*\)/);
    expect(check).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(commit);
  });

  it("the assertion is unconditional — not behind a dev-only or sampled branch", () => {
    const body = stripComments(extractSaveBody(APP_SRC)!);
    const line = body
      .split("\n")
      .find((l) => /\bassertLotInvariants\s*\(/.test(l))!;
    expect(line).toBeTruthy();
    // The whole statement, alone on its line: no `if (…)`, no `&&`, no `?`.
    expect(line.trim()).toBe("assertLotInvariants(nd);");
  });

  it("the startup probe still asserts against the loaded data", () => {
    // The other half of the pair: save() only sees data the user writes, so a
    // cellar that arrives already corrupted (an old backup, a restore) is only
    // ever flagged by the probe.
    const body = stripComments(PROBE_SRC);
    expect(body).toMatch(/\bassertLotInvariants\s*\(/);
    expect(body).toMatch(/\bcheckAllInvariants\s*\(/);
  });
});
