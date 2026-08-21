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
// The footer button and the pipes-list filter behind it went too, one build
// later: with everything on screen they answered a question nobody had. See
// the case that records it — the removal is deliberate, not an oversight.
//
// This is the same shape as the "À fumer rapidement" tile (a control naming a
// set and opening a subset) and the "À point" row (a row naming lots and
// opening all of them). Third instance, and the rule the user's correction
// sharpens: a summary that is bounded had better be a summary. When the list IS
// the task, show the task — and then the "see more" it needed stops existing.

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
const CTX = blankComments(readFileSync("src/AppContext.tsx", "utf8"));

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

  it("offers no way out, because there is nothing to go to", () => {
    // REMOVED, recorded rather than deleted in silence. Build 19 gave the
    // section a footer button opening the pipes list narrowed to the same set,
    // and build 20 kept it after the cap went. With every overdue pipe on
    // screen the button answered a question nobody had — « on peut enlever le
    // bouton vu qu'on les affiche toutes » — so it went, and the FILTER went
    // with it: that button was its only entrance, and a filter no control can
    // turn on is dead code that `knip` cannot see (it was ctx-wired).
    //
    // What that cost, stated so it can be weighed if it is ever wanted back:
    // the pipes list has no "à entretenir" filter, so working through the
    // chore there means reading the amber chips. That is what the Home
    // section is for now.
    expect(HOME).not.toMatch(/maint_see_all/);
    expect(HOME).not.toMatch(/navToPipesMaintDue/);
    expect(APP).not.toMatch(/pMaintFilter/);
    expect(APP).not.toMatch(/navToPipesMaintDue/);
    expect(LIST).not.toMatch(/pMaintFilter/);
  });

  it("leaves nothing dangling behind it", () => {
    // The removal spans four files plus six dictionaries; a leftover in any
    // one of them is exactly the dead code this repo's discipline forbids.
    expect(CTX).not.toMatch(/pMaintFilter|navToPipesMaintDue/);
    for (const code of ["fr", "en", "es", "de", "it", "pt"]) {
      expect(readFileSync(`src/i18n/${code}.ts`, "utf8"), code).not.toMatch(/maint_see_all/);
    }
  });
});
