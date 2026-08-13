import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTastingSession,
  TASTING_KEY,
  formatTastingTime,
  OVERTIME_THRESHOLD_MS,
  OVERTIME_AUTO_END_MS,
} from "../hooks/useTastingSession";

// ── helpers ───────────────────────────────────────────────────────────────────

function deps(overrides: Record<string, any> = {}) {
  return {
    // Default to a successful persist so the legacy tests (which assert
    // the tasting state is cleared on tastingEnd) keep passing. Tests
    // that exercise the failure path override this with `vi.fn((_) => false)`.
    addSessionFromTasting: vi.fn((_form: any) => true),
    nav: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── formatTastingTime ─────────────────────────────────────────────────────────

describe("formatTastingTime", () => {
  it("formats seconds under a minute", () => {
    expect(formatTastingTime(7_000)).toBe("00:07");
  });
  it("formats minutes:seconds", () => {
    expect(formatTastingTime(72_000)).toBe("01:12");
  });
  it("formats hours:minutes:seconds", () => {
    expect(formatTastingTime(3_725_000)).toBe("1:02:05");
  });
  it("returns 00:00 for negative ms", () => {
    expect(formatTastingTime(-1234)).toBe("00:00");
  });
});

// ── initial state ─────────────────────────────────────────────────────────────

describe("useTastingSession — initial state", () => {
  it("starts with null tasting when nothing in storage", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("restores tasting from localStorage", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "setup",
        tobaccoId: "5",
        pipeId: "",
        lotId: "",
        weightG: "3",
        rating: 0,
        notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toMatchObject({ stage: "setup", tobaccoId: "5" });
  });

  it("ignores invalid stored payload", () => {
    localStorage.setItem(TASTING_KEY, JSON.stringify({ stage: "bogus" }));
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("ignores malformed JSON", () => {
    localStorage.setItem(TASTING_KEY, "{not json");
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  // reject a running blob whose
  // pauseStartTs is far in the FUTURE (forged / gross clock skew) — it would
  // make the "paused" elapsed absurd and the loading-gated auto-end would save
  // a phantom session with a multi-million-minute duration.
  it("rejects a running blob with a far-future pauseStartTs", () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00Z").getTime();
    vi.setSystemTime(now);
    localStorage.setItem(TASTING_KEY, JSON.stringify({
      stage: "running", tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3",
      startTs: now - 60_000, pausedAccumMs: 0,
      pauseStartTs: now + 5 * 24 * 60 * 60 * 1000, // 5 days in the future
    }));
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("rejects a running blob whose pauseStartTs precedes startTs", () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00Z").getTime();
    vi.setSystemTime(now);
    localStorage.setItem(TASTING_KEY, JSON.stringify({
      stage: "running", tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3",
      startTs: now - 60_000, pausedAccumMs: 0,
      pauseStartTs: now - 120_000, // before the session started
    }));
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });
});

// ── tastingStart ──────────────────────────────────────────────────────────────

describe("useTastingSession — tastingStart", () => {
  it("creates a setup-stage tasting and navigates to tasting view", () => {
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "2", lotId: "L1", weightG: "3" });
    });
    expect(result.current.tasting).toMatchObject({
      stage: "setup",
      tobaccoId: "1",
      pipeId: "2",
      lotId: "L1",
      weightG: "3",
    });
    expect(d.nav).toHaveBeenCalledWith("tasting");
  });

  it("persists the setup state to localStorage", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    const raw = localStorage.getItem(TASTING_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).stage).toBe("setup");
  });
});

// ── tastingSetupUpdate ────────────────────────────────────────────────────────

describe("useTastingSession — tastingSetupUpdate", () => {
  it("patches the setup payload", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingSetupUpdate({ tobaccoId: "9", lotId: "L9" });
    });
    expect(result.current.tasting).toMatchObject({ tobaccoId: "9", lotId: "L9" });
  });

  it("is a no-op once running", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    act(() => {
      result.current.tastingSetupUpdate({ tobaccoId: "999" });
    });
    expect((result.current.tasting as any).tobaccoId).toBe("1");
  });
});

// ── tastingIgnite ─────────────────────────────────────────────────────────────

describe("useTastingSession — tastingIgnite", () => {
  it("transitions setup → running with a startTs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    expect(result.current.tasting).toMatchObject({
      stage: "running",
      pausedAccumMs: 0,
      pauseStartTs: null,
      tobaccoId: "1",
    });
    expect((result.current.tasting as any).startTs).toBe(new Date("2026-01-01T12:00:00Z").getTime());
  });

  it("is a no-op when no setup exists", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingIgnite();
    });
    expect(result.current.tasting).toBeNull();
  });

  // Regression: tastingIgnite used to hand-roll the
  // running state field-by-field, which silently dropped any optional
  // field added later. The geo coords (lat/lng) were lost
  // between capture at setup and the saved session.
  it("preserves lat/lng captured during setup through the running stage", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingSetLocation(48.8566, 2.3522);
    });
    act(() => {
      result.current.tastingIgnite();
    });
    expect((result.current.tasting as any).lat).toBeCloseTo(48.8566);
    expect((result.current.tasting as any).lng).toBeCloseTo(2.3522);
    expect((result.current.tasting as any).stage).toBe("running");
  });
});

// ── pause / resume ───────────────────────────────────────────────────────────

describe("useTastingSession — pause / unpause", () => {
  it("pause records pauseStartTs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(5000);
    act(() => {
      result.current.tastingPause();
    });
    expect((result.current.tasting as any).pauseStartTs).toBe(5000);
  });

  it("unpause accumulates paused duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(5000);
    act(() => {
      result.current.tastingPause();
    });
    vi.setSystemTime(8000);
    act(() => {
      result.current.tastingUnpause();
    });
    expect((result.current.tasting as any).pauseStartTs).toBeNull();
    expect((result.current.tasting as any).pausedAccumMs).toBe(3000);
  });

  it("double-pause is a no-op", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(5000);
    act(() => {
      result.current.tastingPause();
    });
    vi.setSystemTime(7000);
    act(() => {
      result.current.tastingPause();
    });
    expect((result.current.tasting as any).pauseStartTs).toBe(5000);
  });
});

// ── tastingElapsedMs ─────────────────────────────────────────────────────────

describe("useTastingSession — tastingElapsedMs", () => {
  it("returns 0 when not running", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tastingElapsedMs()).toBe(0);
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    expect(result.current.tastingElapsedMs()).toBe(0);
  });

  it("counts elapsed time since startTs minus paused accumulator", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(11_000);
    expect(result.current.tastingElapsedMs()).toBe(10_000);
  });

  it("freezes time while paused", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(6000);
    act(() => {
      result.current.tastingPause();
    });
    // Paused at +5s
    expect(result.current.tastingElapsedMs()).toBe(5000);
    vi.setSystemTime(60_000);
    // Still 5s — paused frozen
    expect(result.current.tastingElapsedMs()).toBe(5000);
  });
});

// ── tastingUpdate ────────────────────────────────────────────────────────────

describe("useTastingSession — tastingUpdate", () => {
  it("patches rating / notes / weightG", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    act(() => {
      result.current.tastingUpdate({ rating: 4, notes: "hello", weightG: "5" });
    });
    expect(result.current.tasting).toMatchObject({ rating: 4, notes: "hello", weightG: "5" });
  });
});

// ── tastingEnd ───────────────────────────────────────────────────────────────

describe("useTastingSession — tastingEnd", () => {
  it("calls addSessionFromTasting with the START date (not the end date) and computed minutes", () => {
    vi.useFakeTimers();
    // Anchor at NOON so the local date matches the UTC date in every
    // reasonable test runner timezone.
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    // Advance 30 minutes (still same day).
    vi.setSystemTime(new Date("2026-01-15T12:30:00Z").getTime());
    act(() => {
      result.current.tastingUpdate({ rating: 5, notes: "smooth" });
    });
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    const arg = d.addSessionFromTasting.mock.calls[0]![0];
    expect(arg.date).toBe("2026-01-15");
    expect(arg.duration).toBe("30");
    expect(arg.tobaccoId).toBe("t1");
    expect(arg.pipeId).toBe("p1");
    expect(arg.lotId).toBe("L1");
    expect(arg.weightG).toBe("3");
    expect(arg.rating).toBe(5);
    expect(arg.notes).toBe("smooth");
    expect(result.current.tasting).toBeNull();
    expect(localStorage.getItem(TASTING_KEY)).toBeNull();
  });

  // accounting OFF → tastingEnd records
  // weightG="" even for a tasting IGNITED (weight "3") before the toggle
  // flipped. Otherwise it would silently deduct while the UI says accounting
  // is off (and the running-stage weight field is hidden, so the user can't
  // zero it).
  it("records weightG='' when accounting is OFF (no deduction)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    const d = deps({ accountingEnabled: false });
    const { result } = renderHook(() => useTastingSession(d));
    act(() => { result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" }); });
    act(() => { result.current.tastingIgnite(); });
    vi.setSystemTime(new Date("2026-01-15T12:20:00Z").getTime());
    act(() => { result.current.tastingEnd(); });
    const arg = d.addSessionFromTasting.mock.calls[0]![0];
    expect(arg.weightG).toBe("");   // no deduction while accounting off
    expect(arg.lotId).toBe("L1");   // lot ref preserved (re-links if re-enabled)
  });

  it("keeps the recorded weightG when accounting is ON (default)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    const d = deps({ accountingEnabled: true });
    const { result } = renderHook(() => useTastingSession(d));
    act(() => { result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" }); });
    act(() => { result.current.tastingIgnite(); });
    vi.setSystemTime(new Date("2026-01-15T12:20:00Z").getTime());
    act(() => { result.current.tastingEnd(); });
    expect(d.addSessionFromTasting.mock.calls[0]![0].weightG).toBe("3");
  });

  it("regression: a tasting that crosses midnight keeps the START date", () => {
    // Ignite at noon, end >25 hours later. The end is GUARANTEED to be
    // on a different local date than the start in every reasonable
    // timezone, so this test exercises the start-date-wins rule
    // independently of the test runner's TZ.
    vi.useFakeTimers();
    const startMs = new Date("2026-01-15T12:00:00Z").getTime();
    vi.setSystemTime(startMs);
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    // Compute the expected LOCAL date the same way the production code does.
    function localIso(d: Date) {
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
    }
    const expectedDate = localIso(new Date(startMs));
    const endDate = localIso(new Date(startMs + 25 * 3600 * 1000));
    // Sanity: the test scenario must put end on a different local date.
    expect(endDate).not.toBe(expectedDate);
    vi.setSystemTime(startMs + 25 * 3600 * 1000);
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    expect(d.addSessionFromTasting.mock.calls[0]![0].date).toBe(expectedDate);
  });

  it("a missing/trashed lot records an untracked session (manual end no longer refuses)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    // The tobacco exists but its referenced lot is soft-deleted → treated as
    // missing. Earlier the MANUAL end refused (setSaveError + no save); now it
    // saves an honest session with weightG "" + lotId "".
    const setSaveError = vi.fn();
    const d = deps({
      setSaveError,
      data: {
        tobaccos: [{ id: "t1", lots: [{ id: "L1", deletedAt: "2026-01-15T11:00:00Z" }] }],
      },
    });
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(new Date("2026-01-15T12:30:00Z").getTime());
    act(() => {
      result.current.tastingEnd(); // manual
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    const arg = d.addSessionFromTasting.mock.calls[0]![0];
    expect(arg.lotId).toBe("L1");   // preserved for re-link if restored
    expect(arg.weightG).toBe("");   // no deduction against a gone lot
    expect(arg.tobaccoId).toBe("t1");
    expect(setSaveError).not.toHaveBeenCalled(); // no longer refused
    expect(result.current.tasting).toBeNull();   // state cleared on success
  });

  it("a lot re-sealed to cellar mid-session records an untracked session (weightG cleared)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    // The lot exists and is live but was flipped jar → cellar during the
    // tasting. _persistSession refuses a cellar lot with weight > 0, so the
    // recorded form must carry weightG "" (no deduction) so the session saves
    // instead of being lost when the auto-end clears the zombie state.
    const setSaveError = vi.fn();
    const d = deps({
      setSaveError,
      data: {
        tobaccos: [{ id: "t1", lots: [{ id: "L1", status: "cellar", weightG: "50" }] }],
      },
    });
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(new Date("2026-01-15T12:30:00Z").getTime());
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    const arg = d.addSessionFromTasting.mock.calls[0]![0];
    expect(arg.lotId).toBe("L1");   // preserved for a proper re-link later
    expect(arg.weightG).toBe("");   // no deduction against a sealed lot
    expect(result.current.tasting).toBeNull();
  });

  it("clamps duration to at least 1 minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    // 0s elapsed → still 1 min
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting.mock.calls[0]![0].duration).toBe("1");
  });

  it("does nothing when in setup stage", () => {
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting).not.toHaveBeenCalled();
    expect(result.current.tasting).toMatchObject({ stage: "setup" });
  });

  it("preserves the tasting state when addSessionFromTasting refuses the save", () => {
    // The persistence layer (_persistSession in useSessionStore) refuses
    // a few cases — most notably a lot that ended up in cellar status
    // mid-tasting. tastingEnd must keep the live tasting state intact so
    // the user can fix the underlying issue (open the lot, edit the
    // setup) without losing the elapsed time and notes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z").getTime());
    const d = deps({ addSessionFromTasting: vi.fn(() => false) });
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" });
    });
    act(() => {
      result.current.tastingIgnite();
    });
    vi.setSystemTime(new Date("2026-01-15T12:20:00Z").getTime());
    act(() => {
      result.current.tastingEnd();
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    // The save failed → tasting state remains untouched so the user can retry.
    expect(result.current.tasting).not.toBeNull();
    expect(result.current.tasting).toMatchObject({ stage: "running", tobaccoId: "t1" });
    expect(localStorage.getItem(TASTING_KEY)).not.toBeNull();
  });
});

// ── tastingCancel ────────────────────────────────────────────────────────────

describe("useTastingSession — tastingCancel", () => {
  it("clears state and navigates to journal", () => {
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "t1", pipeId: "", lotId: "", weightG: "" });
    });
    act(() => {
      result.current.tastingCancel();
    });
    expect(result.current.tasting).toBeNull();
    expect(localStorage.getItem(TASTING_KEY)).toBeNull();
    expect(d.nav).toHaveBeenCalledWith("journal");
  });
});

// ── tastingResume ────────────────────────────────────────────────────────────

describe("useTastingSession — tastingResume", () => {
  it("navigates back to the tasting view when a tasting exists", () => {
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingStart({ tobaccoId: "1", pipeId: "", lotId: "", weightG: "" });
    });
    d.nav.mockClear();
    act(() => {
      result.current.tastingResume();
    });
    expect(d.nav).toHaveBeenCalledWith("tasting");
  });

  it("is a no-op when nothing is active", () => {
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    act(() => {
      result.current.tastingResume();
    });
    expect(d.nav).not.toHaveBeenCalled();
  });
});

// ── overtime prompt ──────────────────────────────────────────────────────────

function startRunning(result: any, atMs = 1000) {
  vi.setSystemTime(atMs);
  act(() => {
    result.current.tastingStart({ tobaccoId: "t1", pipeId: "p1", lotId: "L1", weightG: "3" });
  });
  act(() => {
    result.current.tastingIgnite();
  });
}

describe("useTastingSession — overtime prompt", () => {
  it("constants are 90 and 5 minutes", () => {
    expect(OVERTIME_THRESHOLD_MS).toBe(90 * 60 * 1000);
    expect(OVERTIME_AUTO_END_MS).toBe(5 * 60 * 1000);
  });

  it("returns false before threshold elapsed", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTastingSession(deps()));
    startRunning(result);
    vi.setSystemTime(1000 + 89 * 60 * 1000);
    expect(result.current.tastingOvertimePrompt()).toBe(false);
    expect(result.current.tastingOvertimeRemainingMs()).toBe(0);
  });

  it("returns true within [threshold, threshold+5min)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTastingSession(deps()));
    startRunning(result);
    vi.setSystemTime(1000 + 91 * 60 * 1000); // 91 min elapsed
    expect(result.current.tastingOvertimePrompt()).toBe(true);
    // 4 min remaining (95 min - 91 min)
    expect(result.current.tastingOvertimeRemainingMs()).toBe(4 * 60 * 1000);
  });

  it("auto-ends once elapsed crosses threshold + 5 min", () => {
    vi.useFakeTimers();
    const d = deps();
    const { result } = renderHook(() => useTastingSession(d));
    startRunning(result);
    // Advance past auto-end threshold (96 min)
    act(() => {
      vi.setSystemTime(1000 + 96 * 60 * 1000);
    });
    // Force a tick (re-render) to trigger the effect
    act(() => {
      result.current.tastingPause();
      result.current.tastingUnpause();
    });
    expect(d.addSessionFromTasting).toHaveBeenCalledOnce();
    expect(result.current.tasting).toBeNull();
  });

  it("postpone bumps the threshold by another 90 min", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTastingSession(deps()));
    startRunning(result);
    vi.setSystemTime(1000 + 91 * 60 * 1000);
    expect(result.current.tastingOvertimePrompt()).toBe(true);
    act(() => {
      result.current.tastingPostponeOvertime();
    });
    // After postpone: threshold = 90 + 90 = 180 min. At 91 min elapsed, no prompt.
    expect(result.current.tastingOvertimePrompt()).toBe(false);
    expect((result.current.tasting as any).overtimeThresholdMs).toBe(180 * 60 * 1000);
  });

  it("postpone is a no-op when not running", () => {
    const { result } = renderHook(() => useTastingSession(deps()));
    act(() => {
      result.current.tastingPostponeOvertime();
    });
    expect(result.current.tasting).toBeNull();
  });

  it("paused timer freezes overtime — no prompt despite long real-time wait", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTastingSession(deps()));
    startRunning(result);
    // Pause at 5 min in
    vi.setSystemTime(1000 + 5 * 60 * 1000);
    act(() => {
      result.current.tastingPause();
    });
    // Fast-forward real time by 2 hours — elapsed stays at 5 min
    vi.setSystemTime(1000 + 5 * 60 * 1000 + 2 * 60 * 60 * 1000);
    expect(result.current.tastingOvertimePrompt()).toBe(false);
  });
});

// readTasting now validates numeric fields before accepting
// the payload. A forged `cave-tasting-active` with `startTs: Infinity`
// (or NaN, negative, non-number) would have propagated Infinity into
// the timer banner and triggered an infinite overtime loop.
describe("useTastingSession — readTasting payload validation", () => {
  it("rejects a running payload whose startTs is Infinity", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Infinity, // Note: JSON.stringify(Infinity) === "null" so this
        // case is unreachable through normal localStorage. But a
        // user editing localStorage by hand could set it.
        pausedAccumMs: 0,
        tobaccoId: "T1",
        pipeId: "P1",
        rating: 0,
        notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    // Infinity serialized as null → fails the `typeof === "number"`
    // check anyway. Tasting must NOT rehydrate.
    expect(result.current.tasting).toBeNull();
  });

  it("rejects a running payload with non-number startTs", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: "abc",
        pausedAccumMs: 0,
        tobaccoId: "T1", pipeId: "P1", rating: 0, notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("rejects a running payload with negative startTs", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: -1,
        pausedAccumMs: 0,
        tobaccoId: "T1", pipeId: "P1", rating: 0, notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("rejects a running payload with non-number pausedAccumMs", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: 1000,
        pausedAccumMs: "lots",
        tobaccoId: "T1", pipeId: "P1", rating: 0, notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("rejects a running payload with negative overtimeThresholdMs", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: 1000,
        pausedAccumMs: 0,
        overtimeThresholdMs: -1,
        tobaccoId: "T1", pipeId: "P1", rating: 0, notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).toBeNull();
  });

  it("accepts a valid running payload (regression on the validation gate)", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        // A RECENT start (not epoch+1s) — before the readTasting
        // pause-field defaulting, an absent pauseStartTs made tastingElapsedMs
        // return NaN, which froze the timer AND masked the auto-end. With the
        // fix an ancient startTs correctly auto-ends the zombie, so use a fresh
        // start to test acceptance in isolation.
        startTs: Date.now() - 60 * 1000,
        pausedAccumMs: 0,
        tobaccoId: "T1", pipeId: "P1",
        rating: 0, notes: "",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps()));
    expect(result.current.tasting).not.toBeNull();
    expect((result.current.tasting as any).stage).toBe("running");
    // The absent pauseStartTs is defaulted to null so the timer ticks.
    expect((result.current.tasting as any).pauseStartTs).toBeNull();
  });
});

// ── la séance oubliée ────────────────────────────────────────────

describe("useTastingSession — une séance oubliée ne dure pas 10 h", () => {
  // Signalement : « l'arrêt automatique après 90+5 minutes ne fonctionne pas,
  // la dernière a duré plus de 10 heures ». Reproduit : l'arrêt DÉCLENCHAIT
  // bien, il enregistrait 600 minutes et ne disait rien. Le contrôle ne peut
  // tourner que si du JS tourne, et une PWA installée est suspendue dès que le
  // téléphone se verrouille — la clôture n'est donc constatée qu'au lancement
  // suivant, des heures après l'instant où elle était due.
  const KEY = "cave-tasting-active";
  function seedForgotten(hours: number, extra: Record<string, any> = {}) {
    localStorage.setItem(KEY, JSON.stringify({
      stage: "running",
      startTs: Date.now() - hours * 3600 * 1000,
      pausedAccumMs: 0, pauseStartTs: null,
      tobaccoId: "T1", pipeId: "P1", lotId: "L1",
      rating: 0, notes: "", weightG: "3",
      ...extra,
    }));
  }
  const DATA = {
    tobaccos: [{ id: "T1", lots: [{ id: "L1", status: "jar", weightG: "50" }] }],
    pipes: [], sessions: [],
  };

  it("plafonne la durée à 95 min au lieu d'enregistrer les 10 h dormies", () => {
    seedForgotten(10);
    const add = vi.fn(() => true);
    renderHook(() => useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    expect(add).toHaveBeenCalled();
    const form = (add.mock.calls[0] as unknown as [any])[0];
    const cap = (OVERTIME_THRESHOLD_MS + OVERTIME_AUTO_END_MS) / 60000;
    expect(Number(form.duration)).toBe(cap);
  });

  it("honore un report : deux « Continuer » repoussent le plafond d'autant", () => {
    // Le report est un acte délibéré ; l'app doit le respecter plutôt que
    // ramener la séance à 95 min.
    seedForgotten(10, { overtimeThresholdMs: OVERTIME_THRESHOLD_MS * 3 });
    const add = vi.fn(() => true);
    renderHook(() => useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    const form = (add.mock.calls[0] as unknown as [any])[0];
    expect(Number(form.duration)).toBe((OVERTIME_THRESHOLD_MS * 3 + OVERTIME_AUTO_END_MS) / 60000);
  });

  it("ne touche PAS au chemin manuel — l'utilisateur était là, la durée est vraie", () => {
    seedForgotten(0.5); // 30 min, sous le seuil : aucun arrêt auto
    const add = vi.fn(() => true);
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    expect(add).not.toHaveBeenCalled();
    act(() => { result.current.tastingEnd(); });
    const form = (add.mock.calls[0] as unknown as [any])[0];
    expect(Number(form.duration)).toBe(30);
  });

  it("le dit à l'utilisateur — l'arrêt auto était muet quand le lot existait", () => {
    // C'est ce silence qui rendait le défaut indiscernable de « ça ne marche
    // pas » : la dégustation disparaissait et une séance apparaissait.
    seedForgotten(10);
    const setSaveWarn = vi.fn();
    const setSaveError = vi.fn();
    renderHook(() => useTastingSession(deps({
      data: DATA, loading: false, setSaveWarn, setSaveError, lang: "fr",
    })));
    expect(setSaveWarn).toHaveBeenCalled();
    const msg = (setSaveWarn.mock.calls[0] as unknown as [string])[0];
    expect(msg).toMatch(/automatiquement/i);
    expect(msg).toContain("95");          // la durée réellement enregistrée
    expect(msg).not.toContain("{n}");     // le gabarit doit être interpolé
    expect(setSaveError).not.toHaveBeenCalled();  // ce n'est pas une erreur
  });

  it("garde le canal ERREUR pour le cas dégradé : le lot a disparu", () => {
    seedForgotten(10, { lotId: "9999" });
    const setSaveWarn = vi.fn();
    const setSaveError = vi.fn();
    renderHook(() => useTastingSession(deps({
      data: DATA, loading: false, setSaveWarn, setSaveError, lang: "fr",
    })));
    expect(setSaveError).toHaveBeenCalled();
    expect(setSaveWarn).not.toHaveBeenCalled();
  });

  it("le message est traduit dans les six langues et porte le nombre", () => {
    for (const lang of ["fr", "en", "de", "it", "es", "pt"]) {
      localStorage.clear();
      seedForgotten(10);
      const setSaveWarn = vi.fn();
      renderHook(() => useTastingSession(deps({ data: DATA, loading: false, setSaveWarn, lang })));
      const msg = (setSaveWarn.mock.calls[0] as unknown as [string])[0];
      expect(msg, lang).toContain("95");
      expect(msg, lang).not.toContain("{n}");
      expect(msg, lang).not.toBe("tasting_autoend_notice");
    }
  });
});

// ── la même règle s'applique à la PAUSE ─────────────────────────

describe("useTastingSession — une séance en pause s'arrête aussi", () => {
  // Une version antérieure avait divulgué le trou : l'elapsed gèle sur pauseStartTs, donc le
  // seuil n'est jamais franchi et une séance mise en pause puis oubliée reste
  // indéfiniment. Décidé : la règle 90 + 5 vaut aussi pour la pause elle-même.
  const KEY = "cave-tasting-active";
  const MIN = 60 * 1000;
  function seedPaused(ranMin: number, pausedMin: number) {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify({
      stage: "running",
      startTs: now - (ranMin + pausedMin) * MIN,
      pausedAccumMs: 0,
      pauseStartTs: now - pausedMin * MIN,
      tobaccoId: "T1", pipeId: "P1", lotId: "L1",
      rating: 0, notes: "", weightG: "3",
    }));
  }
  const DATA = {
    tobaccos: [{ id: "T1", lots: [{ id: "L1", status: "jar", weightG: "50" }] }],
    pipes: [], sessions: [],
  };

  it("clôture une séance en pause depuis plus de 95 min", () => {
    seedPaused(20, 600);            // 20 min fumées, en pause depuis 10 h
    const add = vi.fn(() => true);
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    expect(add).toHaveBeenCalled();
    expect(result.current.tasting).toBeNull();
  });

  it("enregistre la durée FUMÉE, pas la durée de pause", () => {
    // C'est la vérité : l'utilisateur a fumé 20 minutes puis a mis en pause.
    // Plafonner à 95 inventerait 75 minutes qui n'ont pas eu lieu.
    seedPaused(20, 600);
    const add = vi.fn(() => true);
    renderHook(() => useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    const form = (add.mock.calls[0] as unknown as [any])[0];
    expect(Number(form.duration)).toBe(20);
  });

  it("ne clôture PAS une pause courte", () => {
    seedPaused(20, 10);
    const add = vi.fn(() => true);
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    expect(add).not.toHaveBeenCalled();
    expect(result.current.tasting).not.toBeNull();
  });

  it("montre la bannière pendant la pause AVANT de clôturer — même règle, pas plus dure", () => {
    seedPaused(20, 92);             // dans [90, 95[
    const { result } = renderHook(() =>
      useTastingSession(deps({ data: DATA, loading: false })));
    expect(result.current.tastingOvertimePrompt()).toBe(true);
    const rest = result.current.tastingOvertimeRemainingMs();
    expect(rest).toBeGreaterThan(0);
    expect(rest).toBeLessThanOrEqual(3 * MIN + 1000);
  });

  it("« Continuer » repousse aussi le compte de la pause", () => {
    seedPaused(20, 92);
    const add = vi.fn(() => true);
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    expect(result.current.tastingOvertimePrompt()).toBe(true);
    act(() => { result.current.tastingPostponeOvertime(); });
    expect(result.current.tastingOvertimePrompt()).toBe(false);   // seuil repoussé à 180
    expect(add).not.toHaveBeenCalled();
    expect(result.current.tasting).not.toBeNull();
  });

  it("le tick continue pendant la pause — sinon rien ne re-déclenche l'effet", () => {
    // Une séance mise en pause avec l'app LAISSÉE OUVERTE : aucune dépendance
    // de l'effet ne bouge, donc sans tick elle ne se fermerait jamais.
    vi.useFakeTimers();
    try {
      seedPaused(20, 94);           // clôture due dans ~1 min
      const add = vi.fn(() => true);
      const { result } = renderHook(() =>
        useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
      expect(add).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(90 * 1000); });
      expect(add).toHaveBeenCalled();
      expect(result.current.tasting).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("une séance qui TOURNE garde son plafond à 95 min", () => {
    // Non-régression : l'horloge unique ne doit pas changer
    // le comportement du cas en marche.
    localStorage.setItem(KEY, JSON.stringify({
      stage: "running", startTs: Date.now() - 600 * MIN,
      pausedAccumMs: 0, pauseStartTs: null,
      tobaccoId: "T1", pipeId: "P1", lotId: "L1", rating: 0, notes: "", weightG: "3",
    }));
    const add = vi.fn(() => true);
    renderHook(() => useTastingSession(deps({ addSessionFromTasting: add, data: DATA, loading: false })));
    const form = (add.mock.calls[0] as unknown as [any])[0];
    expect(Number(form.duration)).toBe((OVERTIME_THRESHOLD_MS + OVERTIME_AUTO_END_MS) / 60000);
  });
});

// ── zombie session auto-end ───────────────────────────────────────



describe("useTastingSession — auto-end overrides the missing-lot block", () => {
  // An earlier release added a re-attempt on `data` change and on visibility-
  // change. But the inner refLot check in tastingEnd does an early
  // return WITHOUT clearing the zombie — so a tasting whose lot was
  // deleted (or recreated with a new id) stays stuck forever.
  //
  // Auto-end now passes `{ auto: true }` to tastingEnd, which:
  //   1. Saves the session with weightG="" (no deduction since the
  //      lot reference can't be honored).
  //   2. Clears the tasting state regardless of persist success
  //      (the user already lost the accurate session minutes — a
  //      stuck zombie is worse than a partial record).
  //   3. Surfaces a softer saveError describing the auto-end.

  function seedZombieWithDanglingLot() {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() - 6 * 3600 * 1000,
        pausedAccumMs: 0,
        pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1",
        lotId: "9999",  // ← no lot with this id exists in the inventory
        rating: 0, notes: "", weightG: "3",
      }),
    );
  }

  it("auto-ends a zombie session even when the lot id no longer matches", () => {
    seedZombieWithDanglingLot();
    const addSessionFromTasting = vi.fn(() => true);
    const setSaveError = vi.fn();
    const data = {
      // The tobacco exists but its lots no longer contain id "9999".
      tobaccos: [{ id: "T1", lots: [{ id: "1111", status: "jar", weightG: "50" }] }],
      pipes: [], sessions: [],
    };
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, setSaveError, data })),
    );
    // Auto-end fired at mount: session saved with weightG="" and
    // zombie cleared.
    expect(addSessionFromTasting).toHaveBeenCalled();
    const firstCall = addSessionFromTasting.mock.calls[0] as unknown as [any];
    const form = firstCall[0];
    expect(form.weightG).toBe("");
    expect(form.lotId).toBe("9999"); // preserved for future re-link
    expect(result.current.tasting).toBeNull();
    expect(setSaveError).toHaveBeenCalled();
    const seCall0 = setSaveError.mock.calls[0] as unknown as [string];
    const msg = seCall0[0];
    expect(typeof msg).toBe("string");
    expect(msg.toLowerCase()).toMatch(/auto|automat/);
  });

  it("manual tastingEnd now SAVES an untracked session when the lot is missing", () => {
    seedZombieWithDanglingLot();
    const addSessionFromTasting = vi.fn(() => true);
    const setSaveError = vi.fn();
    const data = {
      tobaccos: [{ id: "T1", lots: [{ id: "1111", status: "jar", weightG: "50" }] }],
      pipes: [], sessions: [],
    };
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, setSaveError, data })),
    );
    // Mount-time auto-end has already cleared the state for a zombie
    // (6 h elapsed >> 95 min threshold). To test the manual path we
    // need a non-zombie session whose lot is missing — reseed with a
    // short elapsed time.
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() - 10 * 60 * 1000, // only 10 min in
        pausedAccumMs: 0,
        pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "9999",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    addSessionFromTasting.mockClear();
    setSaveError.mockClear();
    const r2 = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, setSaveError, data })),
    );
    act(() => { r2.result.current.tastingEnd(); });
    // No longer refused — records an honest, untracked session.
    expect(addSessionFromTasting).toHaveBeenCalledOnce();
    const arg = addSessionFromTasting.mock.calls[0] as unknown as [any];
    expect(arg[0].lotId).toBe("9999"); // preserved for re-link if restored
    expect(arg[0].weightG).toBe("");
    expect(r2.result.current.tasting).toBeNull(); // state cleared on success
    expect(setSaveError).not.toHaveBeenCalled();
    void result.current; // ref the outer hook to silence lint on the dual-render scaffold
  });
});

describe("useTastingSession — auto-end happy path", () => {
  it("auto-ends with the normal weightG and clears the state when the lot is still there", () => {
    // Zombie session with a lot that still exists in the inventory.
    // The auto-end should behave EXACTLY like the manual path: save
    // with the recorded weightG, clear the state, no saveError.
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() - 2 * 3600 * 1000, // 2 h past threshold
        pausedAccumMs: 0,
        pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "1111",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    const addSessionFromTasting = vi.fn(() => true);
    const setSaveError = vi.fn();
    const data = {
      tobaccos: [{ id: "T1", lots: [{ id: "1111", status: "jar", weightG: "61" }] }],
      pipes: [], sessions: [],
    };
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, setSaveError, data })),
    );
    expect(addSessionFromTasting).toHaveBeenCalledTimes(1);
    const firstCall = addSessionFromTasting.mock.calls[0] as unknown as [any];
    const form = firstCall[0];
    expect(form.weightG).toBe("3");          // preserved — lot exists
    expect(form.lotId).toBe("1111");
    expect(result.current.tasting).toBeNull();
    expect(setSaveError).not.toHaveBeenCalled();
  });
});

// ── audit regression locks ────────────────────────────────────────────────────

describe("useTastingSession — audit fixes", () => {
  function seedOvertimeZombie(lotId = "1111") {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() - 6 * 3600 * 1000, // 6 h >> 95 min threshold
        pausedAccumMs: 0,
        pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId,
        rating: 0, notes: "", weightG: "3",
      }),
    );
  }

  // 🔴 The loading gate: the auto-end effect must NOT fire while App.tsx's load()
  // is still in flight. On a cold start `data` is INIT (empty), so firing
  // tastingEnd would save a phantom session against the empty cellar and
  // overwrite localStorage before the real data loads.
  it("does NOT auto-end an overtime zombie while loading=true (🔴 data-loss guard)", () => {
    seedOvertimeZombie();
    const addSessionFromTasting = vi.fn(() => true);
    // `data` is the empty INIT shell that App renders during load().
    const emptyInit: any = { tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [] };
    const { result, rerender } = renderHook(
      (props: { data: any; loading: boolean }) => useTastingSession(deps({
        addSessionFromTasting,
        data: props.data,
        loading: props.loading,
      })),
      { initialProps: { data: emptyInit, loading: true } as { data: any; loading: boolean } },
    );
    // Loading → the zombie is still "running", nothing was persisted.
    expect(addSessionFromTasting).not.toHaveBeenCalled();
    expect(result.current.tasting).not.toBeNull();

    // load() completes: loading flips false, the REAL cellar is in `data`.
    const realData: any = {
      tobaccos: [{ id: "T1", lots: [{ id: "1111", status: "jar", weightG: "50" }] }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    };
    act(() => { rerender({ data: realData, loading: false }); });
    // NOW the auto-end fires — against the real cellar, not INIT.
    expect(addSessionFromTasting).toHaveBeenCalledTimes(1);
    expect(result.current.tasting).toBeNull();
  });

  // The trashed lot: a lot soft-deleted mid-session (still present in RAW data
  // with deletedAt) must be treated as missing — the auto path saves with
  // weightG="" (no deduction from a lot the user trashed).
  it("treats a soft-deleted lot as missing on auto-end (no deduction)", () => {
    seedOvertimeZombie("1111");
    const addSessionFromTasting = vi.fn(() => true);
    const data = {
      tobaccos: [{ id: "T1", lots: [
        { id: "1111", status: "jar", weightG: "50", deletedAt: "2026-01-01T00:00:00.000Z" },
      ] }],
      pipes: [], sessions: [],
    };
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, data, loading: false })),
    );
    expect(addSessionFromTasting).toHaveBeenCalledTimes(1);
    const form = (addSessionFromTasting.mock.calls[0] as unknown as [any])[0];
    expect(form.weightG).toBe("");      // trashed lot → no deduction
    expect(form.lotId).toBe("1111");    // preserved for re-link if restored
    expect(result.current.tasting).toBeNull();
  });

  // Manual path: a trashed lot is treated as missing; and
  // the manual path now SAVES an untracked session instead of refusing.
  it("manual tastingEnd saves an untracked session against a soft-deleted lot", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() - 10 * 60 * 1000, // 10 min — not a zombie
        pausedAccumMs: 0, pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "1111",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    const addSessionFromTasting = vi.fn(() => true);
    const setSaveError = vi.fn();
    const data = {
      tobaccos: [{ id: "T1", lots: [
        { id: "1111", status: "jar", weightG: "50", deletedAt: "2026-01-01T00:00:00.000Z" },
      ] }],
      pipes: [], sessions: [],
    };
    const { result } = renderHook(() =>
      useTastingSession(deps({ addSessionFromTasting, setSaveError, data, loading: false })),
    );
    act(() => { result.current.tastingEnd(); });
    expect(addSessionFromTasting).toHaveBeenCalledOnce();
    const form = (addSessionFromTasting.mock.calls[0] as unknown as [any])[0];
    expect(form.weightG).toBe(""); // trashed lot → no deduction
    expect(form.lotId).toBe("1111"); // preserved for re-link if restored
    expect(result.current.tasting).toBeNull();
    expect(setSaveError).not.toHaveBeenCalled();
  });

  // The future startTs: a startTs far in the future (forged / gross clock skew) is
  // rejected by readTasting so the timer can't freeze at 00:00 forever.
  it("rejects a running blob whose startTs is >24 h in the future", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() + 48 * 3600 * 1000, // 2 days ahead
        pausedAccumMs: 0, pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "1111",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps({ loading: false })));
    expect(result.current.tasting).toBeNull();
  });

  it("accepts a startTs within the 24 h future margin (small skew self-corrects)", () => {
    localStorage.setItem(
      TASTING_KEY,
      JSON.stringify({
        stage: "running",
        startTs: Date.now() + 60 * 1000, // 1 min skew
        pausedAccumMs: 0, pauseStartTs: null,
        tobaccoId: "T1", pipeId: "P1", lotId: "1111",
        rating: 0, notes: "", weightG: "3",
      }),
    );
    const { result } = renderHook(() => useTastingSession(deps({ loading: false })));
    expect(result.current.tasting).not.toBeNull();
  });
});

// ── the two effects key on [stage, pauseStartTs] ──────────────────────────────
//
// The same audit: the loading gate, the trashed lot and the future startTs
// each had a regression lock above. The effect deps had none —
// reverting BOTH dep arrays to `[tasting]` left all 3754 tests green, which is
// the shape this repo keeps finding: the fix landed, the guard did not.
//
// Why it matters, in the user's terms rather than the effect's: `tasting` is
// rewritten on every keystroke in the live notes / weight field (tastingUpdate
// spreads a new object into state). Keying either effect on the whole object
// therefore runs its CLEANUP per character — tearing down the 1 s tick that
// drives the displayed clock AND the auto-end re-check, and releasing the
// screen wake lock the tasting screen exists to hold. Neither is visible in a
// test that only checks the timer's arithmetic, because the arithmetic is
// derived from Date.now() and stays correct while the interval churns.
describe("useTastingSession — effect deps survive live typing", () => {
  function runningDeps(extra: Record<string, any> = {}) {
    return deps({ loading: false, ...extra });
  }

  it("typing in the live notes does NOT tear down and recreate the 1 s tick", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const { result } = renderHook(() => useTastingSession(runningDeps()));
      act(() => {
        result.current.tastingStart({ tobaccoId: "T1", pipeId: "P1", lotId: "L1", weightG: "3" });
      });
      act(() => { result.current.tastingIgnite(); });

      // One interval for the running session, nothing torn down yet.
      const afterIgnite = setSpy.mock.calls.length;
      const clearedAfterIgnite = clearSpy.mock.calls.length;
      expect(afterIgnite).toBeGreaterThan(0);

      // Five keystrokes in the notes field.
      act(() => { result.current.tastingUpdate({ notes: "b" }); });
      act(() => { result.current.tastingUpdate({ notes: "bo" }); });
      act(() => { result.current.tastingUpdate({ notes: "bon" }); });
      act(() => { result.current.tastingUpdate({ notes: "bonn" }); });
      act(() => { result.current.tastingUpdate({ notes: "bonne" }); });

      // The stage and the pause state never changed, so the effect must not
      // have re-run: no new interval, and nothing cleared.
      expect(setSpy.mock.calls.length).toBe(afterIgnite);
      expect(clearSpy.mock.calls.length).toBe(clearedAfterIgnite);
      expect(result.current.tasting).toMatchObject({ stage: "running", notes: "bonne" });
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it("pausing DOES re-run the tick effect (the deps are not simply frozen)", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const { result } = renderHook(() => useTastingSession(runningDeps()));
      act(() => {
        result.current.tastingStart({ tobaccoId: "T1", pipeId: "P1", lotId: "L1", weightG: "3" });
      });
      act(() => { result.current.tastingIgnite(); });
      const before = clearSpy.mock.calls.length;
      act(() => { result.current.tastingPause(); });
      // pauseStartTs IS in the dep array, so the interval must be torn down.
      expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
    } finally {
      clearSpy.mockRestore();
    }
  });

  it("typing in the live notes does NOT release + re-request the screen wake lock", async () => {
    const release = vi.fn(() => Promise.resolve());
    const lock = { release, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const request = vi.fn(() => Promise.resolve(lock));
    const navAny = navigator as any;
    const hadWakeLock = "wakeLock" in navAny;
    const prev = navAny.wakeLock;
    Object.defineProperty(navAny, "wakeLock", { value: { request }, configurable: true });
    try {
      const { result } = renderHook(() => useTastingSession(runningDeps()));
      act(() => {
        result.current.tastingStart({ tobaccoId: "T1", pipeId: "P1", lotId: "L1", weightG: "3" });
      });
      await act(async () => { result.current.tastingIgnite(); });
      // The lock is held once the session is running.
      expect(request).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();

      // Five keystrokes.
      for (const notes of ["b", "bo", "bon", "bonn", "bonne"]) {
        await act(async () => { result.current.tastingUpdate({ notes }); });
      }

      // Still exactly one lock, never released: the screen must not be allowed
      // to sleep between two characters of a tasting note.
      expect(request).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
    } finally {
      if (hadWakeLock) {
        Object.defineProperty(navAny, "wakeLock", { value: prev, configurable: true });
      } else {
        delete navAny.wakeLock;
      }
    }
  });

  it("pausing DOES release the wake lock (the deps are not simply frozen)", async () => {
    const release = vi.fn(() => Promise.resolve());
    const lock = { release, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const request = vi.fn(() => Promise.resolve(lock));
    const navAny = navigator as any;
    const hadWakeLock = "wakeLock" in navAny;
    const prev = navAny.wakeLock;
    Object.defineProperty(navAny, "wakeLock", { value: { request }, configurable: true });
    try {
      const { result } = renderHook(() => useTastingSession(runningDeps()));
      act(() => {
        result.current.tastingStart({ tobaccoId: "T1", pipeId: "P1", lotId: "L1", weightG: "3" });
      });
      await act(async () => { result.current.tastingIgnite(); });
      expect(release).not.toHaveBeenCalled();
      await act(async () => { result.current.tastingPause(); });
      expect(release).toHaveBeenCalled();
    } finally {
      if (hadWakeLock) {
        Object.defineProperty(navAny, "wakeLock", { value: prev, configurable: true });
      } else {
        delete navAny.wakeLock;
      }
    }
  });
});
