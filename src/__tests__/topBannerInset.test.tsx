import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderWithCtx } from "./viewTestUtils";
import { CuratorOverlays } from "../views/curator/Overlays";
import { TOP_BANNER_ORDER } from "../utils/bannerStack";

// The top banners reserve their height, like the tasting
// banner always has.
//
// The shell has carried `paddingTop: bannerH` for the tasting banner for a
// long time, with the reason written on it: "Keeps the active view's TopBar
// icons tappable during a live tasting." The five `position: fixed; top: 0`
// banners never got the same treatment. They are z489-492 against the TopBar's
// sticky z20, so at the top of a page a banner covered it outright — MEASURED
// at 390 px in a device harness: the export reminder is 110 px tall and hides
// all 65 px of the TopBar, every one of its four buttons with it.
//
// Validated on the installed iOS PWA before shipping, because the safe-area
// inset and fixed-position behaviour are precisely what headless cannot
// reproduce — the rule this repo states for any change of this kind.

const ROOT = resolve(__dirname, "..");

// Comments are blanked before every source assertion below — length-preserving,
// so any offsets still line up. The first version of this file did NOT do that
// and reported itself: it counted the `querySelector("[data-top-banner]")` in
// the probe as a sixth banner root, and found the `? 44 : 0` inside the comment
// explaining that the term had been REMOVED. Same lesson doc:check's gate 15
// recorded when it flagged its own explanatory comment — a guard that reads
// prose as data produces confident nonsense, and the fix gets applied to
// correct code.
function code(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}
const shell = code("CuratorApp.tsx");
const overlays = code("views/curator/Overlays.tsx");
const tasting = code("views/curator/TastingBanner.tsx");

describe("every top:0 banner is measurable", () => {
  it("marks as many roots as bannerStack declares banners", () => {
    // A banner added to TOP_BANNER_ORDER without the attribute is invisible to
    // the probe, so it would silently go back to covering the TopBar — the
    // exact drift this pairing exists to prevent.
    const marked = overlays.split('data-top-banner=""').length - 1;
    expect(marked).toBe(TOP_BANNER_ORDER.length);
  });

  it("puts the attribute on a fixed top:0 root, not just anywhere", () => {
    const re = /data-top-banner=""\s*\n\s*style=\{\{\s*\n\s*position: "fixed", top: 0/g;
    expect((overlays.match(re) || []).length).toBe(TOP_BANNER_ORDER.length);
  });
});

describe("the probe reports the height, and clears it", () => {
  it("reports 0 when no banner is showing", () => {
    const onH = vi.fn();
    renderWithCtx(<CuratorOverlays onTopBannerHeight={onH} />, { lang: "fr" } as any);
    expect(onH).toHaveBeenCalledWith(0);
  });

  it("reports a height once a banner is up", () => {
    const onH = vi.fn();
    renderWithCtx(
      <CuratorOverlays onTopBannerHeight={onH} />,
      { saveError: "Échec de sauvegarde", lang: "fr", modalOpenTs: { current: 0 } } as any,
    );
    // jsdom lays nothing out, so the number is 0 here — what matters is that
    // the probe FOUND the node and measured it rather than short-circuiting.
    // The real number is exercised on a device; this asserts the wiring.
    expect(onH).toHaveBeenCalled();
    const marked = document.querySelectorAll("[data-top-banner]");
    expect(marked.length).toBe(1);
  });

  it("clears the reservation on unmount", () => {
    // Otherwise leaving a screen with a banner up would leave the shell
    // permanently padded — a gap at the top of every page, with nothing above
    // it to explain the gap.
    const onH = vi.fn();
    const { unmount } = renderWithCtx(
      <CuratorOverlays onTopBannerHeight={onH} />,
      { saveError: "Échec", lang: "fr", modalOpenTs: { current: 0 } } as any,
    );
    onH.mockClear();
    unmount();
    expect(onH).toHaveBeenCalledWith(0);
  });
});

describe("the shell reserves it, and the two banners stack", () => {
  it("sums the top-banner and tasting-banner heights", () => {
    // SUMMED, not maxed: the tasting banner is offset below whichever top
    // banner is up, so they occupy different rectangles. Maxing would let the
    // lower one hide under the upper one's reserved strip.
    expect(shell).toContain("paddingTop: (topBannerH + bannerH) || undefined");
  });

  it("feeds the measured height to the tasting banner as its offset", () => {
    expect(shell).toContain("topInset={topBannerH}");
    expect(tasting).toContain("const topOffset = topInset || 0;");
  });

  it("no longer offsets for the auto-update countdown", () => {
    // An earlier release turned that countdown from a ~15px strip at top:0 into a
    // centred Modal, so the 44px reserved for it had been holding space for
    // something that no longer exists.
    expect(tasting).not.toContain("? 44 : 0");
    expect(tasting).not.toContain("autoUpdateCountdown");
  });
});
