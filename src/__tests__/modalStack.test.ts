import { describe, it, expect, beforeEach, vi } from "vitest";
import { pushModalClose, hasOpenModal, closeTopModal, isTopModalClose, _resetModalStack } from "../utils/modalStack";

beforeEach(() => { _resetModalStack(); });

describe("modalStack", () => {
  it("reports no open modal initially", () => {
    expect(hasOpenModal()).toBe(false);
    expect(closeTopModal()).toBe(false);
  });

  it("closes the TOP-most modal (LIFO) and reports open state", () => {
    const a = vi.fn(), b = vi.fn();
    pushModalClose(a);
    pushModalClose(b);
    expect(hasOpenModal()).toBe(true);
    expect(closeTopModal()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("unregister removes THIS entry even after others were pushed", () => {
    const a = vi.fn(), b = vi.fn();
    const offA = pushModalClose(a);
    pushModalClose(b);
    offA(); // a closed out of order
    expect(hasOpenModal()).toBe(true);
    closeTopModal();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(hasOpenModal()).toBe(false);
  });

  it("goes empty after closing/unregistering everything", () => {
    const off = pushModalClose(vi.fn());
    off();
    expect(hasOpenModal()).toBe(false);
  });

  it("isTopModalClose identifies only the top-most entry (Escape guard)", () => {
    const a = vi.fn(), b = vi.fn();
    pushModalClose(a);
    pushModalClose(b);
    // Only the top (b) is the top-most → only b's Escape listener should act.
    expect(isTopModalClose(b)).toBe(true);
    expect(isTopModalClose(a)).toBe(false);
    expect(isTopModalClose(null)).toBe(false);
    expect(isTopModalClose(vi.fn())).toBe(false); // an unregistered fn
    closeTopModal(); // b closes
    expect(isTopModalClose(a)).toBe(true); // a is now top
  });
});
