import { describe, it, expect, beforeEach } from "vitest";
import {
  recordViolations,
  getDiagnosticSnapshot,
  clearDiagnostic,
  DIAGNOSTIC_KEY,
  DIAGNOSTIC_MAX_RECENT,
} from "../utils/diagnostic";
import type { InvariantViolation } from "../utils/lotInvariants";

beforeEach(() => {
  localStorage.removeItem(DIAGNOSTIC_KEY);
});

function v(scope: "lot" | "session" | "pipe" | "accessory", rule: string): InvariantViolation {
  return { scope, rule, detail: rule + " — fake" } as InvariantViolation;
}

describe("diagnostic counter", () => {
  it("starts at 0 with no recent entries", () => {
    const s = getDiagnosticSnapshot();
    expect(s.count).toBe(0);
    expect(s.recent).toEqual([]);
  });

  it("records violations and increments the counter", () => {
    recordViolations([v("lot", "weightG-nonneg"), v("session", "session-lot-exists")]);
    const s = getDiagnosticSnapshot();
    expect(s.count).toBe(2);
    expect(s.recent.length).toBe(2);
    expect(s.firstSeen).toBeTruthy();
    expect(s.lastSeen).toBeTruthy();
  });

  it("appends across multiple calls and keeps the most recent first", () => {
    recordViolations([v("lot", "first")]);
    recordViolations([v("session", "second")]);
    const s = getDiagnosticSnapshot();
    expect(s.count).toBe(2);
    expect(s.recent[0]!.rule).toBe("second");
    expect(s.recent[1]!.rule).toBe("first");
  });

  it("caps the recent trail at DIAGNOSTIC_MAX_RECENT", () => {
    const big = Array.from({ length: DIAGNOSTIC_MAX_RECENT + 5 }).map((_, i) => v("lot", "r" + i));
    recordViolations(big);
    const s = getDiagnosticSnapshot();
    expect(s.recent.length).toBe(DIAGNOSTIC_MAX_RECENT);
    expect(s.count).toBe(DIAGNOSTIC_MAX_RECENT + 5); // counter unbounded
  });

  it("preserves firstSeen across calls", () => {
    recordViolations([v("lot", "a")]);
    const first = getDiagnosticSnapshot().firstSeen;
    // Two calls in the same millisecond would yield identical lastSeen
    // strings — just assert firstSeen stickiness, that's the contract.
    recordViolations([v("lot", "b")]);
    const after = getDiagnosticSnapshot();
    expect(after.firstSeen).toBe(first);
    expect(after.lastSeen >= first).toBe(true);
  });

  it("clearDiagnostic resets to zero state", () => {
    recordViolations([v("lot", "x")]);
    clearDiagnostic();
    const s = getDiagnosticSnapshot();
    expect(s.count).toBe(0);
    expect(s.recent).toEqual([]);
  });

  it("ignores empty violation arrays", () => {
    recordViolations([]);
    const s = getDiagnosticSnapshot();
    expect(s.count).toBe(0);
  });

  it("stores a ref shape per violation scope", () => {
    recordViolations([
      { scope: "lot", tobId: 1, lotId: "L1", lotIdx: 0, rule: "x", detail: "y" } as any,
      { scope: "session", sessionId: "S1", rule: "x", detail: "y" } as any,
      { scope: "pipe", pipeId: "P1", rule: "x", detail: "y" } as any,
      { scope: "accessory", accessoryId: "A1", rule: "x", detail: "y" } as any,
    ]);
    const s = getDiagnosticSnapshot();
    // Order: violations preserved as passed within a batch.
    expect(s.recent[0]!.ref).toMatch(/tob#1.*lot#L1/);
    expect(s.recent[1]!.ref).toMatch(/session#S1/);
    expect(s.recent[2]!.ref).toMatch(/pipe#P1/);
    expect(s.recent[3]!.ref).toMatch(/accessory#A1/);
  });
});
