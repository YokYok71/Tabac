import { describe, it, expect } from "vitest";
import {
  lastSessionDateByPipe,
  pipeRestDays,
  computePipeRest,
  isPipeRested,
  PIPE_REST_TARGET_DAYS,
  sessionStartMs,
  pipeHoursSinceLastSession,
  PIPE_REST_MIN_HOURS,
} from "../utils/rotation";

// Fixed "now": 2026-06-12 12:00 UTC.
const NOW = new Date("2026-06-12T12:00:00Z").getTime();

describe("lastSessionDateByPipe", () => {
  it("returns an empty map for null / empty sessions", () => {
    expect(Object.keys(lastSessionDateByPipe(null))).toHaveLength(0);
    expect(Object.keys(lastSessionDateByPipe([]))).toHaveLength(0);
  });

  it("keeps the most recent date per pipe", () => {
    const map = lastSessionDateByPipe([
      { pipeId: 1, date: "2026-06-01" },
      { pipeId: 1, date: "2026-06-10" },
      { pipeId: 1, date: "2026-05-20" },
      { pipeId: 2, date: "2026-06-05" },
    ]);
    expect(map["1"]).toBe("2026-06-10");
    expect(map["2"]).toBe("2026-06-05");
  });

  it("skips sessions without pipeId or with malformed dates", () => {
    const map = lastSessionDateByPipe([
      { pipeId: "", date: "2026-06-01" },
      { pipeId: 1, date: "" },
      { pipeId: 1, date: "garbage" },
      { pipeId: 1, date: 42 },
      null,
    ]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("is immune to prototype-key pipe ids", () => {
    const map = lastSessionDateByPipe([
      { pipeId: "toString", date: "2026-06-01" },
    ]);
    expect(map["toString"]).toBe("2026-06-01");
    expect(typeof map["hasOwnProperty"]).toBe("undefined");
  });
});

describe("pipeRestDays", () => {
  const sessions = [
    { pipeId: 1, date: "2026-06-09" }, // 3 days before NOW
    { pipeId: 2, date: "2026-06-12" }, // same day
  ];

  it("computes days since the last session", () => {
    expect(pipeRestDays(1, sessions, NOW)).toBe(3);
  });

  it("returns 0 for a pipe smoked today", () => {
    expect(pipeRestDays(2, sessions, NOW)).toBe(0);
  });

  it("returns null for a never-smoked pipe", () => {
    expect(pipeRestDays(99, sessions, NOW)).toBeNull();
  });

  it("clamps future-dated sessions to 0 (clock skew defence)", () => {
    expect(pipeRestDays(3, [{ pipeId: 3, date: "2026-07-01" }], NOW)).toBe(0);
  });

  it("matches ids across string/number representations", () => {
    expect(pipeRestDays("1", sessions, NOW)).toBe(3);
    expect(pipeRestDays(1, [{ pipeId: "1", date: "2026-06-09" }], NOW)).toBe(3);
  });
});

describe("computePipeRest", () => {
  it("maps every pipe, null for never-smoked", () => {
    const pipes = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const sessions = [
      { pipeId: 1, date: "2026-06-10" },
      { pipeId: 2, date: "2026-06-12" },
    ];
    const map = computePipeRest(pipes, sessions, NOW);
    expect(map["1"]).toBe(2);
    expect(map["2"]).toBe(0);
    expect(map["3"]).toBeNull();
  });

  it("tolerates null inputs", () => {
    expect(Object.keys(computePipeRest(null, null, NOW))).toHaveLength(0);
  });

  it("skips pipes without an id", () => {
    const map = computePipeRest([{ id: undefined }, null, { id: 5 }], [], NOW);
    expect(Object.keys(map)).toEqual(["5"]);
  });
});

describe("isPipeRested", () => {
  it("treats never-smoked as rested", () => {
    expect(isPipeRested(null)).toBe(true);
  });

  it("uses the PIPE_REST_TARGET_DAYS threshold", () => {
    expect(isPipeRested(PIPE_REST_TARGET_DAYS)).toBe(true);
    expect(isPipeRested(PIPE_REST_TARGET_DAYS - 1)).toBe(false);
    expect(isPipeRested(0)).toBe(false);
    expect(isPipeRested(30)).toBe(true);
  });
});

// sub-day rest helpers for the session-form "not rested" warning.
describe("sessionStartMs", () => {
  it("combines date + HH:MM (local)", () => {
    expect(sessionStartMs({ date: "2026-06-12", time: "20:30" }))
      .toBe(new Date("2026-06-12T20:30:00").getTime());
  });
  it("falls back to noon when time is missing / malformed", () => {
    expect(sessionStartMs({ date: "2026-06-12" }))
      .toBe(new Date("2026-06-12T12:00:00").getTime());
    expect(sessionStartMs({ date: "2026-06-12", time: "bad" }))
      .toBe(new Date("2026-06-12T12:00:00").getTime());
  });
  it("returns NaN when the date is missing", () => {
    expect(Number.isNaN(sessionStartMs({ time: "10:00" }))).toBe(true);
    expect(Number.isNaN(sessionStartMs(null))).toBe(true);
  });
});

describe("pipeHoursSinceLastSession", () => {
  const ref = new Date("2026-06-12T20:00:00").getTime();

  it("returns null when the pipe has no earlier session", () => {
    expect(pipeHoursSinceLastSession(1, [], ref)).toBeNull();
    // A session AT or AFTER the reference doesn't count.
    expect(pipeHoursSinceLastSession(1, [{ pipeId: 1, date: "2026-06-12", time: "21:00" }], ref)).toBeNull();
  });

  it("computes hours since the most recent prior session", () => {
    const ss = [
      { id: 1, pipeId: 1, date: "2026-06-12", time: "09:00" }, // 11 h before ref
      { id: 2, pipeId: 1, date: "2026-06-10", time: "09:00" }, // older
      { id: 3, pipeId: 2, date: "2026-06-12", time: "19:00" }, // other pipe
    ];
    expect(pipeHoursSinceLastSession(1, ss, ref)).toBeCloseTo(11, 5);
    // < 24 h → the warning fires.
    expect(pipeHoursSinceLastSession(1, ss, ref)! < PIPE_REST_MIN_HOURS).toBe(true);
  });

  it("is ≥ 24 h (no warning) when the pipe rested a full day", () => {
    const ss = [{ id: 1, pipeId: 1, date: "2026-06-11", time: "09:00" }]; // 35 h before ref
    expect(pipeHoursSinceLastSession(1, ss, ref)! >= PIPE_REST_MIN_HOURS).toBe(true);
  });

  it("excludes the edited session + trashed sessions", () => {
    const ss = [
      { id: 7, pipeId: 1, date: "2026-06-12", time: "09:00" },              // the one being edited
      { id: 8, pipeId: 1, date: "2026-06-12", time: "10:00", deletedAt: "x" }, // trashed
    ];
    expect(pipeHoursSinceLastSession(1, ss, ref, 7)).toBeNull();
  });
});

// Day counting across month boundaries — regression guard for the
// naive "subtract dates" approach.
describe("month/year boundary", () => {
  it("counts rest across a month boundary", () => {
    const now = new Date("2026-07-02T08:00:00Z").getTime();
    expect(pipeRestDays(1, [{ pipeId: 1, date: "2026-06-29" }], now)).toBe(3);
  });

  it("counts rest across a year boundary", () => {
    const now = new Date("2027-01-03T08:00:00Z").getTime();
    expect(pipeRestDays(1, [{ pipeId: 1, date: "2026-12-30" }], now)).toBe(4);
  });
});
