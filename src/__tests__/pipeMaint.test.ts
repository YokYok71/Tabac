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
