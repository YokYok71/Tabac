// Unit tests for src/views/curator/TastingBanner.tsx.
//
// Coverage focus (invariants #18 + a11y):
//   - Renders nothing when no tasting is active
//   - Renders the "in progress" banner on every non-tasting view
//   - Hidden on the dedicated tasting view (`view === "tasting"`)
//   - Overtime banner replaces the in-progress one (even on tasting view)
//   - Pause state changes the banner look + label
//   - Clicking the banner resumes/navigates
//   - topOffset shifts when the auto-update countdown banner is showing

import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorTastingBanner } from "../../views/curator/TastingBanner";

const runningTasting = {
  stage: "running",
  startTs: Date.now() - 60_000,
  pauseStartTs: null,
  pausedAccumMs: 0,
  tobaccoId: "1",
  pipeId: "1",
};

const pausedTasting = {
  ...runningTasting,
  pauseStartTs: Date.now() - 5_000,
};

describe("TastingBanner — visibility", () => {
  it("renders nothing when no tasting is active", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: null,
      tastingElapsedMs: () => 0,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tasting stage is 'setup' (not yet running)", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: { stage: "setup", tobaccoId: "1", pipeId: "1" },
      tastingElapsedMs: () => 0,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the in-progress banner on the home view", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 60_000,
      tastingOvertimePrompt: () => false,
    });
    expect(container.textContent).toMatch(/01:00|cours|progress|pause/i);
  });

  it("is hidden on the dedicated tasting view when not in overtime", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "tasting",
      tasting: runningTasting,
      tastingElapsedMs: () => 60_000,
      tastingOvertimePrompt: () => false,
    });
    expect(container.firstChild).toBeNull();
  });
});

describe("TastingBanner — overtime", () => {
  it("renders the overtime banner even on the tasting view", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "tasting",
      tasting: runningTasting,
      tastingElapsedMs: () => 90 * 60 * 1000,
      tastingOvertimePrompt: () => true,
      tastingOvertimeRemainingMs: () => 5 * 60 * 1000,
      tastingPostponeOvertime: vi.fn(),
      tastingEnd: vi.fn(),
    });
    expect(container.textContent).toMatch(/⚠|overtime|dépassement|Auto|Fin|End/);
  });

  // ── THESE TWO WERE VACUOUS, AND IN A WAY THE COMMENT ITSELF ADMITTED ─────
  //
  // They read `getByText(/Continuer|Extend/)` inside a try/catch, then wrapped
  // the click and the assertion in `if (btn) { … }`. The harness's `t` returns
  // the KEY, so the button renders as `tasting_overtime_extend` and that regex
  // could never match — `btn` was always null and both cases passed with ZERO
  // assertions, on the two controls of the prompt that closes a live tasting.
  //
  // The comment even said what the text "contains", which is what made it look
  // deliberate. Selecting on a translated string under a key-returning `t` is
  // the bug; the KEY is the stable contract, so that is what they target now —
  // and finding no button is a failure rather than a skip.
  function overtimeCtx(extra: any) {
    return {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 90 * 60 * 1000,
      tastingOvertimePrompt: () => true,
      tastingOvertimeRemainingMs: () => 5 * 60 * 1000,
      tastingPostponeOvertime: vi.fn(),
      tastingEnd: vi.fn(),
      ...extra,
    };
  }
  // Accepts the key (harness `t`) or the French fallback (no `t` at all), so
  // the selection survives either harness rather than silently skipping.
  const EXTEND = /tasting_overtime_extend|Continuer/;
  const END_NOW = /tasting_overtime_end_now|Terminer/;

  it("Extend button calls tastingPostponeOvertime", () => {
    const postpone = vi.fn();
    const { getByText } = renderWithCtx(
      <CuratorTastingBanner />, overtimeCtx({ tastingPostponeOvertime: postpone }));
    const btn = getByText(EXTEND);
    fireEvent.click(btn);
    expect(postpone).toHaveBeenCalled();
  });

  it("End-now button calls tastingEnd", () => {
    const end = vi.fn();
    const { getByText } = renderWithCtx(
      <CuratorTastingBanner />, overtimeCtx({ tastingEnd: end }));
    const btn = getByText(END_NOW);
    fireEvent.click(btn);
    expect(end).toHaveBeenCalled();
  });

  it("the two actions are DISTINCT controls, not one wired twice", () => {
    // The pair is « keep smoking » and « close the session now »: one handler
    // reached from both would silently end a tasting the user asked to
    // extend. Nothing checked they were different elements.
    const postpone = vi.fn();
    const end = vi.fn();
    const { getByText } = renderWithCtx(
      <CuratorTastingBanner />,
      overtimeCtx({ tastingPostponeOvertime: postpone, tastingEnd: end }));
    expect(getByText(EXTEND)).not.toBe(getByText(END_NOW));
    fireEvent.click(getByText(EXTEND));
    expect(postpone).toHaveBeenCalledTimes(1);
    expect(end, "extending also ended the tasting").not.toHaveBeenCalled();
  });
});

describe("TastingBanner — interaction", () => {
  it("clicking the in-progress banner calls tastingResume when set", () => {
    const resume = vi.fn();
    const nav = vi.fn();
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
      tastingResume: resume,
      nav,
    });
    fireEvent.click(container.firstChild as HTMLElement);
    expect(resume).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it("falls back to nav('tasting') when tastingResume is not provided", () => {
    const nav = vi.fn();
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
      tastingResume: undefined,
      nav,
    });
    fireEvent.click(container.firstChild as HTMLElement);
    expect(nav).toHaveBeenCalledWith("tasting");
  });
});

describe("TastingBanner — paused state", () => {
  it("renders with pause styling and label when pauseStartTs is set", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: pausedTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
      t: (k: string) => k,
    });
    // The "tasting_paused" i18n key is used; fallback is "En pause"
    expect(container.textContent).toMatch(/tasting_paused|pause|paused/i);
  });
});

// THIS BLOCK RECORDS A REVERSAL. Read it before "fixing" it.
//
// It used to assert `top: 44px` when `autoUpdateCountdown` was non-null, and
// that was right when it was written: the countdown was a ~15 px full-width
// strip pinned at top:0, so the tasting banner had to sit below it.
//
// An earlier release turned that countdown into a centred `Modal` (maxWidth 380, its own
// backdrop). From that day the 44 px reserved space for something that no
// longer existed — the tasting banner simply dropped 44 px for nothing whenever
// the dialog was up — and this test went on pinning it for twenty-two releases.
//
// The offset now comes from `topInset`: the MEASURED height of whichever
// `top: 0` banner is showing, so the tasting banner sits below a save failure
// or a quota warning instead of painting over it at z2001.
describe("TastingBanner — top offset comes from the measured banner above it", () => {
  it("sits below the top banner by its measured height", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner topInset={110} />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
    });
    const banner = container.firstChild as HTMLElement;
    expect(banner.style.top).toBe("110px");
  });

  it("uses top:0 when no top banner is showing", () => {
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
    });
    const banner = container.firstChild as HTMLElement;
    expect(banner.style.top).toBe("0px");
  });

  it("ignores autoUpdateCountdown entirely", () => {
    // The reversal itself, asserted: the countdown is a dialog now, so it must
    // NOT move this banner. Restoring the old 44 px turns this red.
    const { container } = renderWithCtx(<CuratorTastingBanner />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
      autoUpdateCountdown: 7,
    });
    const banner = container.firstChild as HTMLElement;
    expect(banner.style.top).toBe("0px");
  });
});

// The banner is position:fixed and used to overlay each view's
// TopBar, hiding the search / settings / cloud / trash icons while a
// tasting ran. It now reports its content height via onHeight so CuratorApp
// reserves that much top padding on the scroll column; 0 when hidden.
describe("TastingBanner — onHeight reporting", () => {
  it("reports 0 when no tasting is running", () => {
    const onHeight = vi.fn();
    renderWithCtx(<CuratorTastingBanner onHeight={onHeight} />, {
      view: "home",
      tasting: null,
      tastingElapsedMs: () => 0,
    });
    expect(onHeight).toHaveBeenLastCalledWith(0);
  });

  it("reports a numeric height while a tasting runs on a non-tasting view", () => {
    const onHeight = vi.fn();
    renderWithCtx(<CuratorTastingBanner onHeight={onHeight} />, {
      view: "home",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
    });
    expect(onHeight).toHaveBeenCalled();
    const last = onHeight.mock.calls[onHeight.mock.calls.length - 1]![0];
    expect(typeof last).toBe("number");
    expect(last).toBeGreaterThanOrEqual(0);
  });

  it("reports 0 on the dedicated tasting screen (in-progress banner hidden)", () => {
    const onHeight = vi.fn();
    renderWithCtx(<CuratorTastingBanner onHeight={onHeight} />, {
      view: "tasting",
      tasting: runningTasting,
      tastingElapsedMs: () => 30_000,
      tastingOvertimePrompt: () => false,
    });
    expect(onHeight).toHaveBeenLastCalledWith(0);
  });

  it("reports a height on /tasting when in overtime (banner shows everywhere)", () => {
    const onHeight = vi.fn();
    renderWithCtx(<CuratorTastingBanner onHeight={onHeight} />, {
      view: "tasting",
      tasting: runningTasting,
      tastingElapsedMs: () => 90 * 60 * 1000,
      tastingOvertimePrompt: () => true,
      tastingOvertimeRemainingMs: () => 5 * 60 * 1000,
      tastingPostponeOvertime: vi.fn(),
      tastingEnd: vi.fn(),
    });
    const last = onHeight.mock.calls[onHeight.mock.calls.length - 1]![0];
    expect(typeof last).toBe("number");
    expect(last).toBeGreaterThanOrEqual(0);
  });
});
