// Smoke tests for src/views/curator/ThemeModeNoticeModal.tsx.
//
// The pop-up announces the light/dark mode + text size. It shows at every app
// open during a fixed window (EXPIRY_MS), defers to the welcome modal, and
// permanently opts out on "Ne plus afficher".
//
// The notice was retired early (EXPIRY_MS = 2026-07-24), so the mocked
// clocks below straddle THAT date: IN_WINDOW must stay before it for the
// show-path tests to exercise the mechanism.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorThemeModeNoticeModal } from "../../views/curator/ThemeModeNoticeModal";

const IN_WINDOW = Date.parse("2026-07-10T12:00:00Z");
const PAST_EXPIRY = Date.parse("2026-09-01T12:00:00Z");
const DISMISS_KEY = "cave-thememode-notice-dismissed-v2";
const WELCOME_KEY = "cave-curator-welcomed";

async function flushFrame() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(IN_WINDOW);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ThemeModeNoticeModal", () => {
  it("shows when welcomed, in-window, and not dismissed", async () => {
    localStorage.setItem(WELCOME_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });

  it("defers (no dialog) until the welcome modal is dismissed", async () => {
    // cave-curator-welcomed absent
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("does not show once permanently dismissed", async () => {
    localStorage.setItem(WELCOME_KEY, "1");
    localStorage.setItem(DISMISS_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("does not show after the window closes (the live state)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(PAST_EXPIRY);
    localStorage.setItem(WELCOME_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  // The notice is retired: EXPIRY_MS sits in the past, so the
  // REAL clock can never reopen it. This assertion only strengthens with time,
  // and fails the day someone pushes EXPIRY_MS back into the future — which is
  // exactly when they must consciously decide to re-broadcast (and bump the
  // DISMISS_KEY suffix so past opt-outs reset).
  it("stays retired against the real clock", async () => {
    vi.restoreAllMocks();                     // drop the Date.now() mock
    localStorage.setItem(WELCOME_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("'Ne plus afficher' sets the dismissed flag and closes", async () => {
    localStorage.setItem(WELCOME_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    const btn = Array.from(container.querySelectorAll("[role='button']"))
      .find((el) => /Ne plus afficher|Don't show again|thememode_notice_dismiss/i.test(el.textContent || ""));
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("plain close (primary CTA) does NOT set the dismissed flag", async () => {
    localStorage.setItem(WELCOME_KEY, "1");
    const { container } = renderWithCtx(<CuratorThemeModeNoticeModal />, {});
    await flushFrame();
    const cta = Array.from(container.querySelectorAll("[role='button']"))
      .find((el) => /C'est noté|Got it|welcome_got_it/i.test(el.textContent || ""));
    expect(cta).toBeTruthy();
    fireEvent.click(cta!);
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
  });
});
