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
// THE FIRST FIX KEPT THE CAP AND MADE IT VISIBLE — five listed, "voir les 7
// autres", a filter behind it. The user overruled that outright: « Pas 12.
// Toutes !!!! 5 et toutes les autres ensuite ». So the section lists EVERY
// overdue pipe now, and the reasoning that defended the cap ("a dashboard
// summary at the foot of a long page") is recorded as rejected rather than
// quietly dropped: a pipe needing cleaning is a chore you work through, not a
// highlight reel, and a list that stops short is one you cannot trust to be the
// whole job. The ORDER already delivers what the cap was reaching for — most
// overdue first — so the urgent ones lead and the rest follow.
//
// This is the same shape as the "À fumer rapidement" tile (a control naming a
// set and opening a subset) and the "À point" row (a row naming lots and
// opening all of them). Third instance, and the rule the user's correction
// sharpens: a summary that is bounded had better be a summary. When the list IS
// the task, show the task.

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

describe("the Home section holds back nothing", () => {
  it("asks for the UNCAPPED set and renders it whole", () => {
    expect(HOME).toMatch(/computePipeMaintenanceReminders\([^)]*maintReminderThreshold,\s*0,/);
    expect(HOME).toMatch(/maintReminders\s*=\s*maintAll\s*;/);
  });

  it("no cap survives anywhere on the path", () => {
    // REVERSED, recorded on the assertion. The first fix asked for the
    // uncapped set and then sliced it at the render, keeping five on screen
    // behind a "voir les N autres". The user rejected the cap itself, so BOTH
    // forms are now forbidden: asking the engine to truncate, and slicing
    // afterwards.
    expect(HOME).not.toMatch(/computePipeMaintenanceReminders\([^)]*maintReminderThreshold,\s*5,/);
    expect(HOME).not.toMatch(/maintAll\.slice\(/);
    expect(HOME).not.toMatch(/MAINT_SHOWN/);
    expect(HOME).not.toMatch(/maintHidden/);
  });

  it("still offers the pipe list, which is where the chore is worked through", () => {
    // Not a "show more" — nothing is hidden. It is also the only entrance to
    // the filter, so dropping it would leave that filter unreachable.
    expect(HOME).toMatch(/maint_see_all/);
    expect(HOME).toMatch(/navToPipesMaintDue\(\)/);
  });

  it("that label promises no hidden items", () => {
    // It read "Voir les {n} autres" while five of twelve were held back. With
    // nothing held back, a count would be a second lie in the other direction.
    const dict = readFileSync("src/i18n/fr.ts", "utf8");
    const v = /^\s*maint_see_all:"((?:[^"\\]|\\.)*)"/m.exec(dict);
    expect(v, "maint_see_all missing").toBeTruthy();
    expect(v![1]).not.toMatch(/\{n\}/);
    expect(v![1]).not.toMatch(/autres/i);
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
