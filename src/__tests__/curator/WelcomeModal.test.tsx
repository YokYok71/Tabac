// Smoke tests for src/views/curator/WelcomeModal.tsx.
//
// Coverage focus:
//   - Doesn't render when cave-curator-welcomed is set
//   - Renders when the flag is absent
//   - Dismiss button sets the flag and closes

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorWelcomeModal } from "../../views/curator/WelcomeModal";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("WelcomeModal", () => {
  it("doesn't render the welcome dialog when the flag is set", async () => {
    localStorage.setItem("cave-curator-welcomed", "1");
    const { container } = renderWithCtx(<CuratorWelcomeModal />, {});
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    // role=dialog should be absent
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the welcome dialog when the flag is absent", async () => {
    const { container } = renderWithCtx(<CuratorWelcomeModal />, {});
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });

  it("dismissing the welcome sets the flag to '1' and removes the dialog", async () => {
    const { container } = renderWithCtx(<CuratorWelcomeModal />, {});
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    const dismiss = Array.from(container.querySelectorAll("[role='button']"))
      .find(el => /C'est noté|Got it|welcome_got_it/i.test(el.textContent || ""));
    expect(dismiss).toBeTruthy();
    fireEvent.click(dismiss!);
    expect(localStorage.getItem("cave-curator-welcomed")).toBe("1");
  });
});
