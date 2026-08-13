/**
 * doc:check's gates are WIRED — not merely written and tested.
 *
 * WHY THIS EXISTS. An earlier release extracted the gate DECISIONS into three pure
 * modules (`scripts/docChecks.cjs`, `scripts/i18nChecks.cjs`,
 * `scripts/labelContracts.cjs`) precisely so they could be unit-tested, and
 * they are: neutralising any one of those 32 exported functions kills at least
 * one test. What no test could see is the layer BELOW that — `doc-check.cjs`
 * itself, which no test executes. Measured: deleting a whole gate's call site
 * (`docChecks.checkEnumCoverage(CONSTANTS, codes).forEach(err);`) left all 3672
 * tests green while that gate simply stopped running.
 *
 * That is the failure this repo already paid for twice — `npm run prune` red for
 * nine releases while CLAUDE.md asserted a clean baseline, and gate 14 verifying
 * that a row NAMES a language without ever looking at whether the map behind it
 * held anything. A guard that silently stops running reports "OK" exactly as
 * confidently as one that works.
 *
 * So this asserts REACHABILITY: every exported decision must be referenced from
 * the production call graph rooted at doc-check.cjs — either called there, or
 * called by a sibling export inside its own module. Comments are stripped
 * first: a call site deleted but still named in the prose above it would
 * otherwise keep passing, which is the precise case worth catching.
 *
 * It found one on its first run: `findParityGaps` had been exported and tested
 * while the parity gate kept an inline copy of the same
 * comparison — so the tested function guarded nothing and the running gate had
 * no test. doc-check.cjs now calls it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const MODULES = [
  "scripts/docChecks.cjs",
  "scripts/i18nChecks.cjs",
  "scripts/labelContracts.cjs",
] as const;

/** Blank out comments (length-preserving is not needed here — only presence). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * A FUNCTION export must be USED, not merely named — called, or bound to a
 * name. A DATA export keeps the plain word search.
 *
 * WHY THE DISTINCTION. A bare `\bname\b` search was defeated by a STRING: the
 * bump gate's failure message ends "See docChecks.resolveBumpSkip.", so
 * removing the call left the name in the file and reachability still passed —
 * the same hole the comment-stripping was written for, one syntax over, and
 * not hypothetical: a gate that names its own decision function in its error
 * message is good practice, not an accident.
 *
 * TWO NARROWER RULES WERE TRIED AND REJECTED, both measured on the real repo.
 * (1) Blanking string literals as well as comments: a hand-rolled scanner
 * mistakes an apostrophe inside a regex literal for a string opener and
 * swallowed whole regions, losing 20 genuine references. (2) Requiring a call
 * shape for everything: six exports are CONSTANTS (`RATIO_THRESHOLD`,
 * `FIX_HEADINGS`…) which are never followed by `(`, and `parseDictSource` is a
 * function legitimately bound as a value (`const parseBlock =
 * i18nChecks.parseDictSource`). Both would have reported a false
 * "unreachable" — the over-strict failure this repo keeps recording, where a
 * guard gets correct code rewritten to please it.
 *
 * So the shape is asked of functions only, and it admits binding as well as
 * calling. It needs no parsing, and it asks what the file is actually about:
 * not "is the name mentioned" but "is the decision used".
 */
function isFunctionExport(modSrc: string, name: string): boolean {
  return new RegExp("function\\s+" + name + "\\s*\\(").test(modSrc);
}

function usedRe(name: string, isFn: boolean): RegExp {
  if (!isFn) return new RegExp("\\b" + name + "\\b");
  // called: `name(` — or bound: `= …name`
  return new RegExp("\\b" + name + "\\s*\\(|=\\s*[A-Za-z0-9_.]*\\b" + name + "\\b");
}

function exportsOf(modSrc: string): string[] {
  const m = /module\.exports\s*=\s*\{([\s\S]*?)\};/.exec(modSrc);
  if (!m) return [];
  return [...m[1]!.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/gm)].map((x) => x[1]!);
}

const docCheck = stripComments(readFileSync("scripts/doc-check.cjs", "utf8"));

describe("doc:check gate wiring", () => {
  it("references every exported decision from the production call graph", () => {
    const unreachable: string[] = [];
    let examined = 0;
    let calledDirectly = 0;

    for (const mod of MODULES) {
      const raw = readFileSync(mod, "utf8");
      const stripped = stripComments(raw);
      for (const name of exportsOf(raw)) {
        examined++;
        const word = usedRe(name, isFunctionExport(raw, name));
        if (word.test(docCheck)) { calledDirectly++; continue; }
        // …or used by a sibling export: same module, outside its own
        // definition and outside the module.exports block.
        const body = stripped
          .replace(new RegExp("(?:function|const|var|let)\\s+" + name + "\\b", "g"), "DEF")
          .replace(/module\.exports[\s\S]*$/, "");
        if (word.test(body)) continue;
        unreachable.push(`${mod}: ${name}`);
      }
    }

    // Non-vacuity: the scan must actually have found the exports, and most of
    // them must reach doc-check.cjs directly. A parser that quietly returned
    // nothing would otherwise "pass".
    expect(examined).toBeGreaterThanOrEqual(30);
    expect(calledDirectly).toBeGreaterThanOrEqual(20);
    expect(unreachable).toEqual([]);
  });

  it("would notice a deleted call site (the comment-stripping is load-bearing)", () => {
    // The name survives in the comment above the call in doc-check.cjs, so a
    // raw substring search would still find it. After stripping, it must not.
    const withCallSiteRemoved = docCheck.replace(
      /docChecks\.checkEnumCoverage\([^)]*\)\.forEach\(err\);/, "");
    expect(/\bcheckEnumCoverage\b/.test(docCheck)).toBe(true);
    expect(/\bcheckEnumCoverage\b/.test(withCallSiteRemoved)).toBe(false);
  });

  it("a name that survives only in a STRING does not count as wired", () => {
    // The case that got past this test. doc-check.cjs's bump-gate failure
    // message ends "See docChecks.resolveBumpSkip.", so removing the call left
    // the name in the file and a bare word search kept finding it. Asserted on
    // the REAL source, because the point is that this message is genuinely
    // there and should stay — naming the decision function in the error is
    // exactly what makes the gate followable.
    const raw = stripComments(readFileSync("scripts/doc-check.cjs", "utf8"));
    expect(raw).toContain("See docChecks.resolveBumpSkip.");
    const noCall = raw.replace(/docChecks\.resolveBumpSkip\s*\(/, "NOPE(");
    expect(/\bresolveBumpSkip\b/.test(noCall)).toBe(true);   // the name is still there…
    expect(usedRe("resolveBumpSkip", true).test(noCall)).toBe(false); // …but nothing uses it
  });
});
