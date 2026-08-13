// Smoke tests for src/views/curator/LightboxOverlay.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderWithCtx } from "../viewTestUtils";
import { AppCtx, type AppCtxType } from "../../AppContext";
import { CuratorLightboxOverlay } from "../../views/curator/LightboxOverlay";

// close is deferred 260 ms to absorb the iOS "ghost
// click" that would otherwise leak through to the trash icon
// sitting at the same screen coordinates underneath. Fake timers
// let the tests assert the eventual setLightbox(null) call without
// real-time waits.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LightboxOverlay", () => {
  it("doesn't render when lightbox is null", () => {
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog when lightbox URL/key is set", () => {
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: "https://example.com/img.jpg",
    });
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });

  it("renders the <img> when src is provided", () => {
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: "https://example.com/img.jpg",
    });
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://example.com/img.jpg");
  });

  it("close (×) clears lightbox after the close-transition delay", () => {
    const setLightbox = vi.fn();
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: "https://example.com/img.jpg",
      setLightbox,
    });
    const close = Array.from(container.querySelectorAll("button"))
      .find(b => /Fermer|Close|btn_close/i.test(b.getAttribute("aria-label") || ""));
    fireEvent.click(close!);
    // setLightbox(null) is deferred ~260 ms so the
    // ghost click after touchend lands on the still-mounted
    // backdrop, not the trash icon below. Synchronous assert
    // would be false; advance the fake timers first.
    expect(setLightbox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setLightbox).toHaveBeenCalledWith(null);
  });

  it("backdrop click clears lightbox after the close-transition delay", () => {
    const setLightbox = vi.fn();
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: "https://example.com/img.jpg",
      setLightbox,
    });
    // The role=dialog itself is the backdrop in LightboxOverlay (no inner Modal).
    fireEvent.click(container.querySelector("[role='dialog']")!);
    expect(setLightbox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setLightbox).toHaveBeenCalledWith(null);
  });

  // regression guard for the ghost-click bug. Multiple
  // taps during the close transition must only schedule ONE
  // setLightbox(null) call — and the backdrop must keep absorbing
  // events until the unmount.
  it("a second click during the close transition does not schedule a second unmount", () => {
    const setLightbox = vi.fn();
    const { container } = renderWithCtx(<CuratorLightboxOverlay />, {
      lightbox: "https://example.com/img.jpg",
      setLightbox,
    });
    const close = Array.from(container.querySelectorAll("button"))
      .find(b => /Fermer|Close|btn_close/i.test(b.getAttribute("aria-label") || ""));
    fireEvent.click(close!);
    fireEvent.click(container.querySelector("[role='dialog']")!);
    fireEvent.click(close!);
    vi.advanceTimersByTime(300);
    expect(setLightbox).toHaveBeenCalledTimes(1);
  });

  // An earlier release regression (hook-order trap): the overlay is ALWAYS mounted, so
  // when the user taps a photo the ctx flips lightbox null → set on the SAME
  // instance. If the on-demand-photo useState/useEffect sit below the
  // `if (!lightbox) return null` early return, that transition grows the hook
  // count and React throws "Rendered more hooks than during the previous
  // render". This test reproduces the transition on one mounted instance.
  it("survives the lightbox null → set transition on a mounted instance", () => {
    const base = {
      t: (k: string) => k, xl: (v: string) => v, lang: "fr",
      imgLocal: {}, setLightbox: vi.fn(),
      data: { wishlist: [], tobaccos: [], pipes: [], accessories: [], sessions: [] },
    };
    const { container, rerender } = render(
      <AppCtx.Provider value={{ ...base, lightbox: null } as unknown as AppCtxType}>
        <CuratorLightboxOverlay />
      </AppCtx.Provider>,
    );
    expect(container.firstChild).toBeNull();
    // A plain URL keeps the effect a no-op (no imgCache/IndexedDB call) while
    // still exercising the added hooks — the crash was purely about hook count.
    expect(() => {
      rerender(
        <AppCtx.Provider value={{ ...base, lightbox: "https://example.com/img.jpg" } as unknown as AppCtxType}>
          <CuratorLightboxOverlay />
        </AppCtx.Provider>,
      );
    }).not.toThrow();
    expect(container.querySelector("[role='dialog']")).toBeTruthy();
  });
});
