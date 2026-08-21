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
});
