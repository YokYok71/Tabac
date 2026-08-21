// The Home "À entretenir" section may show five, but it must not PRETEND
// there are five.
//
// Reported from the app: « tu n'en listes que 5 alors que j'ai d'autres pipes
// qui ont eu des sessions ». `computePipeMaintenanceReminders` takes a `topN`
// that defaults to 5, and the Home passed 5 — so with twelve overdue pipes the
// section listed five, said nothing about the other seven, and offered no route
// to them. The pipes list computes the SAME set uncapped and chips every due
// card, but nothing narrowed to it, so the rest were reachable only by scanning
// a long list for amber chips.
//
// The cap itself is kept: this is a dashboard summary at the end of a long
// page. What changes is that the section now KNOWS the total — it asks for the
// uncapped set and slices at the render — so it can name what it holds back and
// hand over a filter that holds all of it.
//
// This is the same shape as the "À fumer rapidement" tile (a control naming a
// set and opening a subset) and the "À point" row (a row naming lots and
// opening all of them). Third instance, so the rule is worth stating plainly:
// a summary may be bounded, but the bound must be visible and have a way out.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computePipeMaintenanceReminders, PIPE_MAINT_SESSIONS_THRESHOLD } from "../utils/pipeMaint";

function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const HOME = blankComments(readFileSync("src/views/curator/HomeViewV2.tsx", "utf8"));
const APP = blankComments(readFileSync("src/App.tsx", "utf8"));
const LIST = blankComments(readFileSync("src/views/curator/PipesListView.tsx", "utf8"));

// Twelve active pipes, each smoked well past the threshold and never cleaned.
const PIPES = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, brand: "Halvorsen", name: `P${i + 1}`, status: "active" }));
const SESSIONS = PIPES.flatMap((p) =>
  Array.from({ length: PIPE_MAINT_SESSIONS_THRESHOLD + 2 }, (_, k) => ({
    id: p.id * 100 + k, pipeId: p.id, tobaccoId: 1, date: "2026-01-0" + ((k % 9) + 1),
  })),
);

describe("the reminder engine", () => {
  it("caps only when asked to, and topN 0 means uncapped", () => {
    expect(computePipeMaintenanceReminders(PIPES, SESSIONS, PIPE_MAINT_SESSIONS_THRESHOLD, 5).length).toBe(5);
    expect(computePipeMaintenanceReminders(PIPES, SESSIONS, PIPE_MAINT_SESSIONS_THRESHOLD, 0).length).toBe(12);
  });

  it("a pipe UNDER the threshold is not due — the count is not 'has sessions'", () => {
    // Worth pinning because the report phrased it as "other pipes that have had
    // sessions". Having sessions is not the rule; having `threshold` of them
    // since the last CLEANING is.
    const few = [{ id: 99, brand: "V", name: "Barely", status: "active" }];
    const two = [
      { id: 1, pipeId: 99, tobaccoId: 1, date: "2026-01-01" },
      { id: 2, pipeId: 99, tobaccoId: 1, date: "2026-01-02" },
    ];
    expect(computePipeMaintenanceReminders(few, two, PIPE_MAINT_SESSIONS_THRESHOLD, 0)).toEqual([]);
  });
});

describe("the Home section knows what it is holding back", () => {
  it("asks for the UNCAPPED set, then slices at the render", () => {
    // The defect was asking for 5 and never learning the total.
    expect(HOME).toMatch(/computePipeMaintenanceReminders\([^)]*maintReminderThreshold,\s*0,/);
    expect(HOME).toMatch(/maintReminders\s*=\s*maintAll\.slice\(0,\s*MAINT_SHOWN\)/);
    expect(HOME).toMatch(/maintHidden\s*=\s*maintAll\.length\s*-\s*maintReminders\.length/);
  });

  it("no longer asks the engine to truncate", () => {
    expect(HOME).not.toMatch(/computePipeMaintenanceReminders\([^)]*maintReminderThreshold,\s*5,/);
  });

  it("renders the count and a route, gated on there being a remainder", () => {
    expect(HOME).toMatch(/maintHidden > 0 &&/);
    expect(HOME).toMatch(/maint_see_all/);
    expect(HOME).toMatch(/navToPipesMaintDue\(\)/);
  });
});

describe("the route lands somewhere that holds all of them", () => {
  it("App implements the filter uncapped", () => {
    // A filter that capped would be the very defect this fixes.
    expect(APP).toMatch(/if \(pMaintFilter\) \{/);
    expect(APP).toMatch(/computePipeMaintenanceReminders\([\s\S]{0,160}?maintReminderThreshold,\s*0,/);
  });

  it("the drill shows ACTIVE pipes, or it lands empty", () => {
    // A retired pipe is never due, so leaving a "retired only" toggle on would
    // open an empty list from a section that just said seven were waiting.
    const fn = /function navToPipesMaintDue\(\)[\s\S]{0,700}?\n {2}\}/.exec(APP);
    expect(fn, "the helper moved").toBeTruthy();
    expect(fn![0]).toMatch(/setShowFinishedPipes\(false\)/);
    expect(fn![0]).toMatch(/setPMaintFilter\(true\)/);
    expect(fn![0]).toMatch(/pushDrillOrigin/);   // back returns to Home
  });

  it("every other pipe drill clears it, so it cannot silently narrow one", () => {
    // navHelperSymmetry enforces this for the value filters; the boolean has
    // the same hazard and none of its protection.
    for (const helper of ["navToPipesByTag", "navToPipesFiltered", "navToPipesFilteredByMaterial"]) {
      const fn = new RegExp(`function ${helper}\\([^)]*\\)[\\s\\S]{0,2000}?\\n {2}\\}`).exec(APP);
      expect(fn, helper).toBeTruthy();
      expect(fn![0], helper).toMatch(/setPMaintFilter\(false\)/);
    }
  });

  it("the narrowed list says it is narrowed", () => {
    // A filtered list that looks unfiltered is the rule this repo already
    // holds for every other chip.
    expect(LIST).toMatch(/\|\| pMaintFilter\) && \(/);
    expect(LIST).toMatch(/pMaintFilter && <ActiveFilterPill/);
    expect(LIST).toMatch(/setPMaintFilter && setPMaintFilter\(false\)/);
  });
});
