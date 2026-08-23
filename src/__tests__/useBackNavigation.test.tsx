// `useBackNavigation` had never been EXECUTED by a test.
//
// Two files name it and both only READ it as source (`resetPageHistory`
// checks it does not touch `scrollRestoration`; `scrollRestoration` checks it
// seeds history). `navHistory.test.ts` covers the routing engine — the pure
// half — and this hook is the other half: the TRANSPORT that turns the two
// system back inputs into one call.
//
// So the whole of it was unguarded: the popstate listener, the re-push that
// keeps a back entry available, the 400 ms debounce, the edge-swipe geometry,
// the latest-closure ref, and the teardown. Every one of those can break in a
// way that is invisible from the source — a listener registered on the wrong
// target is the exact defect found in `useAppUpdate` (`pagehide` on `document`
// rather than `window`, inert for six releases, with two tests dispatching at
// the wrong target so neither could see it).
//
// WHAT EACH PIECE COSTS IF IT BREAKS:
//   • no re-push          → the SECOND back press leaves the app entirely;
//   • no debounce         → a fast double-tap pops two levels in one frame;
//   • a stale closure ref → back routes against state from an earlier render,
//                           which is the "back goes to the wrong screen" class
//                           the whole nav rewrite was about;
//   • wrong edge geometry → either a dead gesture or a vertical scroll that
//                           navigates away mid-flick.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useBackNavigation } from "../hooks/useBackNavigation.ts";

function Harness({ onBack }: { onBack: () => void }) {
  useBackNavigation(onBack);
  return <div>host</div>;
}

// A touch list the hook can read: it takes `e.touches[0]` / `e.changedTouches[0]`.
function touch(type: "touchstart" | "touchend", x: number, y: number) {
  const e: any = new Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  e.touches = list;
  e.changedTouches = list;
  return e;
}

let nowSpy: any;
let t = 1_000_000;
beforeEach(() => {
  t = 1_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => t);
});
afterEach(() => { nowSpy.mockRestore(); });

describe("useBackNavigation — the popstate transport", () => {
  it("a browser/hardware back press calls onBack", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(onBack, "the listener is not installed on `window`").toHaveBeenCalledTimes(1);
  });

  it("re-pushes a history entry so a SECOND back press still has one to consume", () => {
    // Without the re-push the first back consumes the seeded entry and the
    // next one leaves the app. Counting pushes is what makes that visible;
    // the seeding itself is asserted separately below.
    const push = vi.spyOn(history, "pushState");
    render(<Harness onBack={() => {}} />);
    const afterMount = push.mock.calls.length;
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(push.mock.calls.length,
      "no entry re-pushed — the next back press exits the app").toBe(afterMount + 1);
    push.mockRestore();
  });

  it("seeds replaceState + pushState at mount", () => {
    const rep = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    render(<Harness onBack={() => {}} />);
    expect(rep, "nothing to go back FROM on the very first press").toHaveBeenCalled();
    expect(push).toHaveBeenCalled();
    rep.mockRestore(); push.mockRestore();
  });

  it("debounces at 400 ms — a fast double-tap pops ONE level, not two", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    t += 100;
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(onBack, "a double-tap popped two screens").toHaveBeenCalledTimes(1);
    // …and the gate opens again once the window has passed.
    t += 500;
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(onBack, "the debounce became a permanent lock").toHaveBeenCalledTimes(2);
  });

  it("calls the LATEST onBack, not the one captured at mount", () => {
    // The listeners are installed once (`[]` deps) and read `onBackRef`. Drop
    // the ref refresh and back routes against a stale render's state, which is
    // the "back goes to the wrong screen" class the nav rewrite existed to fix.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onBack={first} />);
    rerender(<Harness onBack={second} />);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first, "the listener still holds the mount-time closure").not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const onBack = vi.fn();
    const { unmount } = render(<Harness onBack={onBack} />);
    unmount();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    document.dispatchEvent(touch("touchstart", 10, 100));
    document.dispatchEvent(touch("touchend", 200, 100));
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("useBackNavigation — the edge-swipe transport", () => {
  function swipe(from: number, to: number, dy = 0) {
    document.dispatchEvent(touch("touchstart", from, 100));
    document.dispatchEvent(touch("touchend", to, 100 + dy));
  }

  it("a left-edge swipe far enough to the right calls onBack", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { swipe(10, 200); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a swipe starting away from the edge is ignored", () => {
    // 30 px is the edge band. Without it, any rightward drag anywhere on the
    // page would navigate — including a horizontal chip-row scroll.
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { swipe(120, 300); });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("a short drag from the edge is ignored", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { swipe(10, 50); });
    expect(onBack, "a 40 px twitch navigated").not.toHaveBeenCalled();
  });

  it("a mostly-VERTICAL drag from the edge is ignored", () => {
    // The one that matters in use: scrolling a list with a thumb resting near
    // the left edge must not navigate away.
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { swipe(10, 200, 200); });
    expect(onBack, "a vertical scroll from the edge navigated back").not.toHaveBeenCalled();
  });

  it("a touchend with no matching edge touchstart does nothing", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { document.dispatchEvent(touch("touchend", 300, 100)); });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("shares the 400 ms debounce with the popstate path", () => {
    // Both inputs mean the same thing, so a back press and a swipe within the
    // window must not pop twice.
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    t += 100;
    act(() => { swipe(10, 200); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
