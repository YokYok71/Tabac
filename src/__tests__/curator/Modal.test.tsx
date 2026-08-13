// Unit tests for src/components/curator/Modal.tsx.
//
// Coverage focus (a11y invariants):
//   1. role="dialog" + aria-modal="true" on the inner panel
//   2. aria-label / aria-labelledby propagation
//   3. Escape closes
//   4. Backdrop click closes; inner panel click does NOT bubble
//   5. Focus moves into the dialog on open
//   6. Focus is restored to the trigger element on close
//   7. Tab focus trap cycles within the dialog

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Modal } from "../../components/curator/Modal";

describe("Modal — ARIA", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>content</Modal>,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("sets role='dialog' and aria-modal='true' on the inner panel", () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="Test">
        <div>content</div>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("propagates ariaLabel to the dialog", () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="Settings dialog">
        <div>content</div>
      </Modal>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "Settings dialog",
    );
  });

  it("propagates ariaLabelledBy and clears aria-label when both are passed", () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="X" ariaLabelledBy="my-title">
        <h2 id="my-title">Heading</h2>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("my-title");
    // When labelledby is set, aria-label is intentionally null (the labelledby reference wins).
    expect(dialog.getAttribute("aria-label")).toBeNull();
  });
});

describe("Modal — close behavior", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} ariaLabel="X">
        <div>content</div>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open={true} onClose={onClose} ariaLabel="X">
        <div>content</div>
      </Modal>,
    );
    // Backdrop is the outer fixed-inset div containing role=dialog.
    const dialog = container.querySelector("[role='dialog']");
    const backdrop = dialog?.parentElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT call onClose when the inner panel is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} ariaLabel="X">
        <button data-testid="inner">click me</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("inner"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Modal — focus management", () => {
  it("moves focus into the dialog on open", async () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="X">
        <input data-testid="first-input" />
        <button>Save</button>
      </Modal>,
    );
    // The useEffect inside Modal schedules focus via requestAnimationFrame.
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(screen.getByTestId("first-input"));
  });

  // review modals (catalog QuickAdd) opt into focusing the
  // dialog panel instead of the first field, so the mobile keyboard
  // doesn't pop unprompted while the user reads pre-filled values.
  it("focuses the dialog panel (not the first field) when initialFocus='container'", async () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="X" initialFocus="container">
        <input data-testid="first-input" />
        <button>Save</button>
      </Modal>,
    );
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    const input = screen.getByTestId("first-input");
    expect(document.activeElement).not.toBe(input);
    // Focus landed on the role=dialog panel itself.
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(panel);
  });

  it("restores focus to the trigger element on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal open={true} onClose={() => {}} ariaLabel="X">
        <input data-testid="first-input" />
      </Modal>,
    );
    await act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });
    // Now close
    rerender(
      <Modal open={false} onClose={() => {}} ariaLabel="X">
        <input data-testid="first-input" />
      </Modal>,
    );
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});

describe("Modal — ghost-click defence", () => {
  // Earlier, `if (!open) return null` made the backdrop disappear
  // instantly on close. iOS/Android fire a synthetic click event ~150-300 ms
  // after a real tap; closing Settings via the X button (which sits above
  // HomeView's search icon vertically) had the ghost click land on the
  // search icon and silently open it. The fix keeps the backdrop in the
  // DOM for 320 ms after `open` flips false so it intercepts the ghost
  // click. Same pattern as the lightbox defence.
  it("keeps the backdrop in the DOM ~320ms after open flips to false", () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = render(
        <Modal open={true} onClose={() => {}} ariaLabel="X">
          <button>OK</button>
        </Modal>,
      );
      expect(container.querySelector("[role='dialog']")).toBeTruthy();
      // Close.
      rerender(
        <Modal open={false} onClose={() => {}} ariaLabel="X">
          <button>OK</button>
        </Modal>,
      );
      // Backdrop should STILL be in the DOM right after close (fade-out).
      expect(container.querySelector("[role='dialog']")).toBeTruthy();
      // Advance halfway — still mounted.
      act(() => { vi.advanceTimersByTime(150); });
      expect(container.querySelector("[role='dialog']")).toBeTruthy();
      // Past the 320ms threshold — now unmounted.
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector("[role='dialog']")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-opens cleanly during the deferred-close window without dropping a frame", () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = render(
        <Modal open={true} onClose={() => {}} ariaLabel="X">
          <button>OK</button>
        </Modal>,
      );
      // Close.
      rerender(
        <Modal open={false} onClose={() => {}} ariaLabel="X">
          <button>OK</button>
        </Modal>,
      );
      // Re-open BEFORE the 320 ms timer fires.
      act(() => { vi.advanceTimersByTime(100); });
      rerender(
        <Modal open={true} onClose={() => {}} ariaLabel="X">
          <button>OK</button>
        </Modal>,
      );
      // The dialog must still be present (and remain so after the original
      // 320 ms close-timer would have fired — the cleanup must cancel it).
      act(() => { vi.advanceTimersByTime(500); });
      expect(container.querySelector("[role='dialog']")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Modal — focus trap (presence check)", () => {
  // The actual Tab/Shift+Tab cycling can't be exercised under jsdom — the
  // focus-trap implementation filters focusables by `offsetWidth>0 ||
  // offsetHeight>0`, and jsdom doesn't compute layout (all dimensions are 0).
  // We assert presence of the handler by:
  //   - tabIndex=-1 on the dialog (so the focus-trap can land focus there
  //     before the first focusable is available)
  //   - keydown handler attached to window while open (covered indirectly
  //     by the Escape test above)
  it("makes the dialog itself focusable as a fallback (tabIndex=-1)", () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="X">
        <button>OK</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog").getAttribute("tabindex")).toBe("-1");
  });

  it("does not throw on Tab when the dialog is open", () => {
    render(
      <Modal open={true} onClose={() => {}} ariaLabel="X">
        <button data-testid="b1">B1</button>
      </Modal>,
    );
    expect(() => fireEvent.keyDown(window, { key: "Tab" })).not.toThrow();
    expect(() =>
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true }),
    ).not.toThrow();
  });
});
