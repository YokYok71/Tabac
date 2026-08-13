/**
 * The 30-day trash purge — the third sibling, and the one with no lock.
 *
 * A critical closure bug was fixed in THREE startup effects at once: the
 * orphan-photo GC, the lot-integrity probe, and this one. Each was
 * `useEffect(fn, [])` reading `data` from the mount-time closure, which is
 * the empty `INIT` shell (load() is async). Two of the three got a
 * regression lock — `imgGcGating.test.tsx` and `lotIntegrityProbeGating.test.tsx`
 * — because they had been extracted into hooks and could be mounted. This one
 * stayed inline in App.tsx and got none.
 *
 * Audited, measured rather than assumed. Four separate re-injections
 * against the full suite, all SURVIVED with 3760/3760 green:
 *   • removing `if (loading) return;`           → purge runs against INIT
 *   • reverting the dep array to `[]`           → bound to the mount snapshot
 *   • reading `data` instead of the ref         → the bug verbatim
 *   • flipping the cutoff sign to `Date.now() +`→ hard-deletes EVERY trashed
 *     row on the next launch, 30 days early, with no user action
 *
 * The last one is why this file exists rather than a TODO. The purge is the
 * only code path in the app that permanently removes user data without the
 * user asking; a sign flip there is unrecoverable and silent, and nothing in
 * 3760 tests noticed.
 *
 * App.tsx's own comment already claims "the regression test
 * (trashPurgeGating.test) locks the loading-gated form". Until this file it
 * did not exist — a cited guard that was never written, which reads as
 * verified to anyone who checks by reading.
 *
 * WHY SOURCE-LEVEL, and what that does NOT buy. The effect lives inside the
 * App component behind ~50 hooks, so mounting it to observe one setTimeout
 * would test the harness more than the wiring; the repo's established answer
 * is a source assertion (invariantWiring, navScrollGuard, iosPwaDockGuard,
 * docCheckWiring all do this). The honest limitation: this locks the SHAPE of
 * the four invariants, not their behaviour — a semantically-equivalent rewrite
 * would fail here even though it is correct, and a novel way to break the
 * purge would pass. The strong version is the extraction its two siblings got
 * (`useOrphanPhotoGC`, `useLotIntegrityProbe`), which would let the real code
 * be mounted; that is a production change and a CLAUDE.md structure entry, so
 * it is recorded here as the next step rather than taken.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const APP_SRC = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

// Blank comments while preserving length, so an assertion can never be
// satisfied by prose ABOUT the code — the exact case docCheckWiring relies on,
// and the one that matters most here, since App.tsx describes this effect at
// length directly above it.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// The effect, from its refs down to and including its dependency array.
function extractPurgeEffect(src: string): string | null {
  const start = src.indexOf("var trashPurgeRanRef");
  if (start < 0) return null;
  const tail = src.slice(start);
  const endM = tail.match(/\n {2}\}, \[[^\]]*\]\);/);
  if (!endM) return null;
  return tail.slice(0, (endM.index as number) + endM[0].length);
}

const EFFECT = extractPurgeEffect(APP_SRC);
const BODY = EFFECT === null ? "" : stripComments(EFFECT);

describe("startup trash purge — the gating invariants", () => {
  it("App.tsx still contains the purge effect this guard inspects", () => {
    // Guards the guard: a rename or an extraction into a hook must fail HERE,
    // loudly, rather than turn every assertion below into a vacuous pass.
    expect(EFFECT).not.toBeNull();
    expect(BODY).toMatch(/sweepExpiredTrash\s*\(/);
  });

  it("is gated on loading === false, so it never runs against the INIT shell", () => {
    // Without this the purge fires during load(), sees an empty cellar, and
    // `changed` is always false — the 30-day retention silently never runs
    // (the symptom: soft-deleted rows lived forever in every backup).
    expect(BODY).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
  });

  it("depends on [loading] — never [] , which binds it to the mount snapshot", () => {
    const dep = BODY.match(/\n {2}\}, \[([^\]]*)\]\);/);
    expect(dep).not.toBeNull();
    expect(dep![1]!.trim()).toBe("loading");
  });

  it("reads the LATEST data through the ref, not the effect's closure", () => {
    expect(BODY).toMatch(/sweepExpiredTrash\s*\(\s*trashPurgeDataRef\.current/);
    // And the ref is actually kept current on every render.
    expect(stripComments(APP_SRC)).toMatch(
      /useEffect\s*\(\s*function\s*\(\)\s*\{\s*trashPurgeDataRef\.current\s*=\s*data;\s*\}\s*\)\s*;/,
    );
  });

  it("computes the cutoff in the PAST — a sign flip would purge everything", () => {
    // `Date.now() + retention` makes every trashed row "older than the cutoff",
    // so the next launch hard-deletes the entire trash 30 days early. This is
    // the only unprompted permanent deletion in the app.
    const line = BODY.split("\n").find((l) => /cutoffMs\s*=/.test(l));
    expect(line).toBeTruthy();
    expect(line!).toMatch(/Date\.now\(\)\s*-\s*TRASH_RETENTION_DAYS/);
    expect(line!).not.toMatch(/Date\.now\(\)\s*\+/);
  });

  it("saves only when the sweep actually changed something", () => {
    // An unconditional save() would rewrite localStorage on every launch and,
    // worse, persist a payload the sweep never touched.
    expect(BODY).toMatch(/if\s*\(\s*res\.changed\s*\)\s*save\s*\(\s*res\.next\s*\)/);
  });

  it("runs once — the ran-ref guard survives a later loading toggle", () => {
    expect(BODY).toMatch(/if\s*\(\s*trashPurgeRanRef\.current\s*\)\s*return\s*;/);
    expect(BODY).toMatch(/trashPurgeRanRef\.current\s*=\s*true\s*;/);
  });

  it("clears its timer on unmount", () => {
    expect(BODY).toMatch(/clearTimeout\s*\(/);
  });
});

describe("the two sibling startup effects keep their own gates", () => {
  // Stated here as well as in their own files because the three were ONE bug
  // and are only ever re-broken as a set: whoever "simplifies" one dep array
  // reaches for the others in the same pass.
  const GC_SRC = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../hooks/useOrphanPhotoGC.ts"), "utf8"),
  );
  const PROBE_SRC = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../hooks/useLotIntegrityProbe.ts"), "utf8"),
  );

  it("useOrphanPhotoGC is loading-gated and keyed on [loading]", () => {
    expect(GC_SRC).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
    expect(GC_SRC).toMatch(/\}, \[loading\]\);/);
  });

  it("useLotIntegrityProbe is loading-gated and keyed on [loading]", () => {
    expect(PROBE_SRC).toMatch(/if\s*\(\s*loading\s*\)\s*return\s*;/);
    expect(PROBE_SRC).toMatch(/\}, \[loading\]\);/);
  });
});
