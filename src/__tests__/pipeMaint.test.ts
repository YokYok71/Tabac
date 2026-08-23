import { describe, it, expect } from "vitest";
import {
  computePipeMaintenanceReminders, isPipeMaintenanceDue,
  pipeSessionsSinceMaint, lastMaintDate, isCleaningMaint, PIPE_MAINT_SESSIONS_THRESHOLD,
} from "../utils/pipeMaint";

const pipe = (id: number, over: any = {}) => ({ id, name: "P" + id, brand: "B", status: "active", maintenance: [], ...over });
const sess = (pipeId: number, date: string, over: any = {}) => ({ id: Math.random(), pipeId, date, ...over });

// N sessions on pipe id, all dated after `from`.
const sessions = (pipeId: number, n: number, date = "2026-06-01") =>
  Array.from({ length: n }, () => sess(pipeId, date));

describe("isCleaningMaint", () => {
  it("is true only for light / full cleaning kinds", () => {
    expect(isCleaningMaint({ kind: "light" })).toBe(true);
    expect(isCleaningMaint({ kind: "full" })).toBe(true);
    expect(isCleaningMaint({ kind: "none" })).toBe(false);
    expect(isCleaningMaint({})).toBe(false);
    expect(isCleaningMaint(null)).toBe(false);
  });
});

describe("lastMaintDate", () => {
  it("returns the most recent CLEANING date, or null", () => {
    expect(lastMaintDate(pipe(1))).toBeNull();
    expect(lastMaintDate(pipe(1, { maintenance: [
      { id: 1, date: "2026-01-01", kind: "light", tasks: [], notes: "" },
      { id: 2, date: "2026-03-15", kind: "full", tasks: [], notes: "" },
    ] }))).toBe("2026-03-15");
  });

  it("skips 'none' entries so they never reset the counter", () => {
    // A later 'none' (repair/wax) entry must NOT count as the last cleaning.
    const p = pipe(1, { maintenance: [
      { id: 1, date: "2026-01-01", kind: "light", tasks: [], notes: "" },
      { id: 2, date: "2026-06-20", kind: "none", tasks: ["repair"], notes: "" },
    ] });
    expect(lastMaintDate(p)).toBe("2026-01-01");
  });

  it("ignores a FUTURE-dated cleaning when todayStr is given", () => {
    // A fat-fingered "2030-…" cleaning would otherwise park lastMaintDate past
    // every real session and suppress the reminder forever. With todayStr it's
    // skipped; the last REAL cleaning wins.
    const p = pipe(1, { maintenance: [
      { id: 1, date: "2026-01-01", kind: "full", tasks: [], notes: "" },
      { id: 2, date: "2030-06-20", kind: "full", tasks: [], notes: "" }, // future
    ] });
    expect(lastMaintDate(p, "2026-07-24")).toBe("2026-01-01");
    // Without todayStr the old unfiltered behaviour is preserved.
    expect(lastMaintDate(p)).toBe("2030-06-20");
  });
});

describe("future-dated cleaning no longer hides the reminder", () => {
  const futureClean = { id: 9, date: "2099-01-01", kind: "full", tasks: [], notes: "" };
  it("pipeSessionsSinceMaint counts every real session past a future cleaning", () => {
    const p = pipe(1, { maintenance: [futureClean] });
    const ss = sessions(1, 6, "2026-06-01");
    // With today() guard the future cleaning is ignored → all 6 count.
    expect(pipeSessionsSinceMaint(p, ss, "2026-07-24").sessionsSince).toBe(6);
    // Without the guard, the future cleaning parks lastMaintDate ahead of the
    // sessions → 0 counted (the bug).
    expect(pipeSessionsSinceMaint(p, ss).sessionsSince).toBe(0);
  });
  it("isPipeMaintenanceDue fires again with the guard", () => {
    const p = pipe(1, { maintenance: [futureClean] });
    const ss = sessions(1, 6, "2026-06-01");
    expect(isPipeMaintenanceDue(p, ss, 5, "2026-07-24")).toBe(true);
    expect(isPipeMaintenanceDue(p, ss, 5)).toBe(false); // bug: suppressed
  });
  it("computePipeMaintenanceReminders surfaces the pipe with the guard", () => {
    const p = pipe(1, { maintenance: [futureClean] });
    const ss = sessions(1, 6, "2026-06-01");
    expect(computePipeMaintenanceReminders([p], ss, 5, 5, "2026-07-24").map(x => x.pipeId)).toEqual(["1"]);
    expect(computePipeMaintenanceReminders([p], ss, 5, 5)).toEqual([]); // bug: hidden
  });
});

describe("pipeSessionsSinceMaint", () => {
  it("counts ALL sessions when the pipe was never maintained", () => {
    const r = pipeSessionsSinceMaint(pipe(1), sessions(1, 4));
    expect(r).toEqual({ sessionsSince: 4, lastMaintDate: null, everMaintained: false });
  });

  it("counts only sessions strictly after the last maintenance", () => {
    const p = pipe(1, { maintenance: [{ id: 1, date: "2026-05-01", kind: "light", tasks: [], notes: "" }] });
    const ss = [
      sess(1, "2026-04-01"), // before → not counted
      sess(1, "2026-05-01"), // same day → not counted (cleaning resets)
      sess(1, "2026-06-01"),
      sess(1, "2026-06-02"),
    ];
    const r = pipeSessionsSinceMaint(p, ss);
    expect(r.sessionsSince).toBe(2);
    expect(r.lastMaintDate).toBe("2026-05-01");
    expect(r.everMaintained).toBe(true);
  });

  it("a 'none' entry does not reset the counter", () => {
    // Only a repair logged → the pipe was never actually cleaned, so all
    // sessions still count toward the reminder.
    const p = pipe(1, { maintenance: [{ id: 1, date: "2026-05-01", kind: "none", tasks: ["repair"], notes: "" }] });
    const ss = [sess(1, "2026-06-01"), sess(1, "2026-06-02"), sess(1, "2026-06-03")];
    const r = pipeSessionsSinceMaint(p, ss);
    expect(r.sessionsSince).toBe(3);
    expect(r.everMaintained).toBe(false);
  });

  it("ignores sessions of other pipes and trashed sessions", () => {
    const ss = [
      sess(1, "2026-06-01"),
      sess(2, "2026-06-01"),            // other pipe
      sess(1, "2026-06-02", { deletedAt: "x" }), // trashed
    ];
    expect(pipeSessionsSinceMaint(pipe(1), ss).sessionsSince).toBe(1);
  });
});

describe("isPipeMaintenanceDue", () => {
  it("is due at exactly the threshold, not below", () => {
    expect(isPipeMaintenanceDue(pipe(1), sessions(1, PIPE_MAINT_SESSIONS_THRESHOLD - 1))).toBe(false);
    expect(isPipeMaintenanceDue(pipe(1), sessions(1, PIPE_MAINT_SESSIONS_THRESHOLD))).toBe(true);
  });

  it("honours a custom threshold", () => {
    expect(isPipeMaintenanceDue(pipe(1), sessions(1, 3), 3)).toBe(true);
    expect(isPipeMaintenanceDue(pipe(1), sessions(1, 2), 3)).toBe(false);
  });

  it("never flags a finished or trashed pipe", () => {
    expect(isPipeMaintenanceDue(pipe(1, { status: "finished" }), sessions(1, 50))).toBe(false);
    expect(isPipeMaintenanceDue(pipe(1, { deletedAt: "x" }), sessions(1, 50))).toBe(false);
  });
});

describe("computePipeMaintenanceReminders", () => {
  it("returns only due active pipes, most-overdue first", () => {
    const pipes = [pipe(1), pipe(2), pipe(3, { status: "finished" })];
    const ss = [...sessions(1, 12), ...sessions(2, 10), ...sessions(3, 40)];
    const r = computePipeMaintenanceReminders(pipes, ss, 10);
    expect(r.map(x => x.pipeId)).toEqual(["1", "2"]); // 3 is finished → excluded
    expect(r[0]!.sessionsSince).toBe(12);
    expect(r[1]!.sessionsSince).toBe(10);
  });

  it("caps at topN", () => {
    const pipes = [1, 2, 3, 4, 5, 6].map(i => pipe(i));
    const ss = pipes.flatMap(p => sessions(p.id, 15));
    expect(computePipeMaintenanceReminders(pipes, ss, 10, 3)).toHaveLength(3);
  });

  it("returns [] when nothing is due", () => {
    expect(computePipeMaintenanceReminders([pipe(1)], sessions(1, 2), 10)).toEqual([]);
  });
});

// The Home shows the FIRST FIVE of this list, so the order decides which
// pipes a user is told to clean. Nothing covered it, which is how the tiebreak
// below came to be meaningless without anyone noticing: every case above uses
// distinct session counts, so the tie branch was never reached.
describe("the order among equally-overdue pipes", () => {
  const cleaned = (id: number, date: string) =>
    pipe(id, { maintenance: [{ id: 1, date, kind: "full", tasks: [], notes: "" }] });
  // Equal session counts on purpose — a tie is the NORMAL case, not a corner:
  // at the default threshold most overdue pipes sit on the same small count,
  // and at a threshold of 1 nearly all of them do.
  const tied = (pipes: any[]) =>
    computePipeMaintenanceReminders(
      pipes, pipes.flatMap(p => sessions(p.id, 3, "2026-07-01")), 1, 0, "2026-08-21",
    ).map(x => x.pipeId);

  it("puts the pipe cleaned LONGEST ago first", () => {
    expect(tied([
      cleaned(1, "2026-06-15"),
      cleaned(2, "2026-01-10"),   // oldest cleaning → most due
      cleaned(3, "2026-05-01"),
    ])).toEqual(["2", "3", "1"]);
  });

  it("puts a NEVER-cleaned pipe ahead of every cleaned one", () => {
    expect(tied([cleaned(1, "2026-01-10"), pipe(2), cleaned(3, "2026-02-02")]))
      .toEqual(["2", "1", "3"]);
  });

  it("no longer orders a tie by the id read as TEXT", () => {
    // THE defect. The tiebreak was `String(pipeId).localeCompare(...)`, so
    // `"11" < "3"` and the Home systematically favoured pipes whose id begins
    // with a low digit — measured in a browser as 11 · 15 · 19 · 03 · 07 on
    // twenty equally-overdue pipes. Deterministic, and meaningless.
    const order = tied([
      cleaned(3, "2026-01-01"),    // cleaned first → most due
      cleaned(11, "2026-06-01"),
    ]);
    expect(order, "the older cleaning wins, whatever the ids read like").toEqual(["3", "11"]);
  });

  it("still falls back to the id when nothing else separates them", () => {
    // The order must stay TOTAL and stable: two pipes cleaned the same day
    // with the same session count would otherwise sit in input order, which
    // shifts whenever the collection is re-saved — the list would reshuffle
    // between launches for no reason the user can see.
    expect(tied([cleaned(2, "2026-03-03"), cleaned(1, "2026-03-03")])).toEqual(["1", "2"]);
  });

  it("sessions still outrank everything — the tiebreak is only a tiebreak", () => {
    // A pipe smoked more since its cleaning is more due than one cleaned
    // longer ago but barely smoked. Asserted so a future pass cannot promote
    // the date into the primary key.
    const pipes = [
      cleaned(1, "2020-01-01"),   // ancient cleaning, few bowls
      cleaned(2, "2026-08-01"),   // recent cleaning, many bowls
    ];
    const ss = [...sessions(1, 2, "2026-08-10"), ...sessions(2, 9, "2026-08-10")];
    expect(computePipeMaintenanceReminders(pipes, ss, 1, 0, "2026-08-21").map(x => x.pipeId))
      .toEqual(["2", "1"]);
  });
});

// The session index is built ONCE for the whole collection, not once per pipe.
//
// Delegating the count to `pipeSessionsSinceMaint` was right — one rule, one
// implementation — but it dropped the map the loop used to hoist, so the
// reminder went quadratic: 30 pipes × 5000 sessions measured 62.7 ms against
// 3.8 ms hoisted, on every data write, and on views the user is not looking at
// (CuratorApp mounts them all and both memos evaluate above their `return
// null`). Nothing covered it: every fixture above is small enough that the
// difference is invisible in wall-clock terms.
//
// So this counts WORK rather than time — a timing assertion would be flaky on
// shared CI, and what matters is the shape, not the milliseconds.
describe("the reminder does not walk the sessions once per pipe", () => {
  it("touches each session a constant number of times", () => {
    let reads = 0;
    const pipes = Array.from({ length: 20 }, (_, i) =>
      pipe(i + 1, { maintenance: [{ id: 1, date: "2026-01-01", kind: "full", tasks: [], notes: "" }] }));
    // A getter on `pipeId` counts how often the index pass reads each row.
    const sessions = Array.from({ length: 200 }, (_, i) => {
      const raw = { id: i, date: "2026-06-01", _p: (i % 20) + 1 };
      return Object.defineProperty(raw, "pipeId", {
        get() { reads++; return (this as any)._p; }, enumerable: true,
      });
    });
    computePipeMaintenanceReminders(pipes, sessions, 1, 0, "2026-08-21");
    // One pass over 200 sessions reads each row a small, PIPE-INDEPENDENT
    // number of times. Rebuilding per pipe multiplies it by 20 — the probe
    // that fails here is exactly the regression.
    expect(reads, `expected one index pass, got ${reads} reads for 200 sessions`)
      .toBeLessThan(200 * 3);
  });

  it("gives the same answer with and without the precomputed index", () => {
    // The optimisation must not become a second implementation: the optional
    // parameter has to be a pure accelerator.
    const p = pipe(1, { maintenance: [{ id: 1, date: "2026-06-15", kind: "full", tasks: [], notes: "" }] });
    const ss = [...sessions(1, 4, "2026-07-01"), ...sessions(1, 2, "2026-05-01")];
    const viaLoop = computePipeMaintenanceReminders([p], ss, 1, 0, "2026-08-21")[0]!;
    const direct = pipeSessionsSinceMaint(p, ss, "2026-08-21");
    expect(viaLoop.sessionsSince).toBe(direct.sessionsSince);
    expect(direct.sessionsSince).toBe(4);
  });
});
