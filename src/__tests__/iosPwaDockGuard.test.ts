import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// "blinder le bug du menu du bas qui flotte" (iOS-standalone PWA).
// The floating-bottom-dock fix is a set of CSS/layout guardrails that unit
// tests can't exercise (the bug reproduces ONLY in the installed iOS PWA,
// never in Chromium/Safari-browser). It has silently regressed once already
// (the fixes were undone by a later roll-back), so we lock the
// exact source invariants here — a future revert fails CI at the source
// level instead of shipping a broken dock to the installed app.
//
// Root cause (documented in CLAUDE.md "Layout / scroll model"): on iOS Safari,
// `overflow-x:hidden` on <body> turns <body> into a scroll container, so the
// `position:fixed` dock positions against that scroll box and floats to the
// middle on scroll. `overflow-x:clip` clips identically WITHOUT creating a
// scroll container. `width:100vw` adds a horizontal-overflow sliver that makes
// it worse; the shell must use `width:100%`. And mutating the viewport meta on
// nav (the pinch-zoom reset) dislodges the fixed dock in standalone — skip it.

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("iOS-PWA floating-dock guardrails", () => {
  it("index.html <body> uses overflow-x:clip, never overflow-x:hidden", () => {
    const html = read("index.html");
    expect(html, "body must clip (not hidden) horizontal overflow").toMatch(/overflow-x:\s*clip/);
    expect(html, "overflow-x:hidden turns <body> into a scroll container → floating dock").not.toMatch(/overflow-x:\s*hidden/);
  });

  it("CuratorApp shell uses width:100% (not 100vw — the scrollbar overflow sliver)", () => {
    const src = read("src/CuratorApp.tsx");
    expect(src, "100vw ignores the scrollbar and overflows horizontally → floating dock").not.toMatch(/width:\s*["']100vw["']/);
  });

  it("BottomDock is PORTALED to document.body (escapes ancestor containing-block traps)", () => {
    // The decisive fix, applied once and re-applied after a roll-back: a position:fixed
    // dock trapped inside the app column drops into flow the moment ANY
    // ancestor gains a containing-block property (transform / filter /
    // backdrop-filter / contain / will-change) — which the recessed-tone
    // surfaces do — floating it mid-page on the installed iOS PWA. Portaling
    // it under <body> makes it immune. This must never be un-portaled again.
    const src = read("src/CuratorApp.tsx");
    expect(src, "CuratorApp must import createPortal").toMatch(/createPortal/);
    expect(src, "the dock must be portaled to document.body").toMatch(/<BottomDock[\s\S]*?document\.body/);
  });

  it("nav() viewport-meta swap is skipped in the iOS standalone PWA", () => {
    const app = read("src/App.tsx");
    // Target the actual setAttribute content string (not the comment prose,
    // which also mentions "user-scalable=no").
    const metaIdx = app.indexOf("maximum-scale=1.0, user-scalable=no");
    expect(metaIdx, "expected the nav() viewport-meta reset to exist").toBeGreaterThan(-1);
    // The meta mutation must be preceded (in source order) by a !IS_IOS_STANDALONE guard.
    const guardIdx = app.lastIndexOf("!IS_IOS_STANDALONE", metaIdx);
    expect(guardIdx, "the viewport-meta swap must be guarded by !IS_IOS_STANDALONE").toBeGreaterThan(-1);
  });

  // The drift is GONE on the installed iOS PWA. Why is NOT settled.
  //
  // The dock was reported drifting mid-screen DURING a scroll, while sitting
  // correctly over the content at rest, so not the in-flow bug the four
  // guardrails prevent but the WebKit main-thread paint lag. `translateZ(0)`
  // promotes it to its own compositing layer.
  //
  // THE FIRST EXPLANATION WRITTEN HERE WAS WRONG, and it is recorded rather
  // than deleted because the mistake is the instructive part. The build was
  // reported as still drifting, then as fixed « après avoir fermé complètement
  // l'app », and that was written up as a DELIVERY lesson — the PWA must have
  // been running the previous build, since a resume from the app switcher does
  // not reload. The user corrected it flatly: they were ALREADY on this build
  // before closing. So the property alone did not clear it; destroying and
  // recreating the web view did. Two readings survive, separable only by TIME:
  // the promotion is the fix and a long-lived WKWebView had to be recycled
  // before it took hold, or the recycling alone is the fix and the property is
  // inert. If the drift returns with no code change, it is the second.
  //
  // The lesson that DOES hold: "the reporter must have been on the old build"
  // is the shape of guess to distrust — it explains a report by assuming the
  // person making it was mistaken.
  //
  // THE RESIDUAL RISK IS CLEARED. The pill's `backdrop-filter` samples a
  // backdrop root, and WebKit has been inconsistent about whether a
  // transformed ancestor becomes one — so the property was shipped with an
  // explicit instruction to revert it if the frosted glass went flat. Checked
  // on the installed PWA: still blurred. WebKit does NOT treat this transform
  // as a backdrop root, so a compositing promotion on the outer strip is
  // compatible with a backdrop-filter on the pill inside it. Worth knowing
  // before anyone reaches for the same trick elsewhere in this app.
  it("the fixed strip is promoted to its own layer (see comment)", () => {
    const src = read("src/components/curator/BottomDock.tsx");
    expect(src, "the outer position:fixed strip carries a compositing promotion")
      .toMatch(/transform:\s*["']translateZ\(0\)["']/);
    // The promotion belongs on the OUTER strip, never on the pill: on the pill
    // it would sit between the backdrop-filter and its backdrop, which is the
    // exact risk the property is already suspected of carrying.
    const pillIdx = src.indexOf("backdropFilter");
    const promoIdx = src.indexOf("translateZ(0)");
    expect(promoIdx, "promotion must appear BEFORE the pill's backdropFilter")
      .toBeLessThan(pillIdx);
  });
});
