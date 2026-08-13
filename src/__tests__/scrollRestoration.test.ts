import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The app owns scroll restoration; the browser must not also
// do it.
//
// Reported: open a blend in the catalogue, close it with a left-edge swipe, and
// you land at the TOP of the 1222-row list. The × and Escape are fine — only
// the swipe.
//
// The cause is not app code. Traced in a browser: `window.scrollTo` is never
// called, the document never shrinks (75 030 px, 1222 rows throughout), and
// `Modal`'s focus restore lands on the right row with the scroll still at
// 12 000. The jump happens after every handler has run — the browser restoring
// the position recorded on the history entry being returned to, which
// `useBackNavigation` seeds at mount when the scroll is 0.
//
// This is a SOURCE test on purpose. jsdom implements neither scroll nor
// `history.scrollRestoration` semantics, so nothing here can exercise the
// behaviour; what it can do is hold the two properties the fix depends on, both
// of which are easy to break by accident.

const MAIN = readFileSync(resolve(__dirname, "../main.jsx"), "utf8");

// Comments stripped — length-preserving, so line offsets survive. The
// paragraph above main.jsx's fix quotes 'auto' and 'manual' several times, and
// a check that reads prose as data reports itself (the lesson doc:check's gate
// 15 recorded, and that the own test file relearned).
const CODE = MAIN
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("history.scrollRestoration is handed to the app", () => {
  it("is set to manual", () => {
    expect(CODE).toMatch(/history\.scrollRestoration\s*=\s*['"]manual['"]/);
  });

  it("is feature-detected and cannot throw", () => {
    // Safari private mode and older engines: a bare assignment inside the
    // module body would abort the whole pre-mount block — which also seeds the
    // theme and the language — and the app would boot unstyled or wordless.
    const line = (CODE.match(/^.*history\.scrollRestoration.*$/m) || [""])[0];
    // `window.history`, not bare `history`: the .jsx config block does not
    // declare the browser globals, so a bare reference is a `no-undef` ERROR —
    // which is how two releases both failed their DEPLOY gate. (That is
    // the gate working: a lint error held the artifact back instead
    // of shipping it. The gate is the good news; missing it was mine, from
    // reading `eslint . | tail -1`, which truncates the summary.)
    expect(line).toMatch(/'scrollRestoration' in (window\.)?history/);
    expect(line).toContain("try {");
    expect(line).toContain("catch");
  });

  it("runs BEFORE React mounts", () => {
    // The load-bearing ordering, and the thing that made the first attempt at
    // this fix look like a refutation: `scrollRestoration` is a property of the
    // CURRENT history entry, so setting it after the app has seeded its entries
    // leaves the one you navigate BACK to on 'auto' and changes nothing.
    const at = CODE.indexOf("history.scrollRestoration");
    const mount = CODE.indexOf("createRoot");
    expect(at).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(-1);
    expect(at).toBeLessThan(mount);
  });

  it("runs before the back-navigation history seeding can reach it", () => {
    // useBackNavigation seeds replaceState + pushState at mount. main.jsx is
    // the only place that is guaranteed to run first.
    const back = readFileSync(resolve(__dirname, "../hooks/useBackNavigation.ts"), "utf8");
    expect(back).toMatch(/pushState|replaceState/);
    // …and it must NOT set scrollRestoration itself: two owners of a per-entry
    // property is how this class of bug returns.
    expect(back).not.toContain("scrollRestoration");
  });

  it("nothing else in src/ re-enables automatic restoration", () => {
    // A stray `= "auto"` anywhere would silently undo the fix for every entry
    // created after it.
    const files = [
      "../App.tsx", "../CuratorApp.tsx", "../hooks/useBackNavigation.ts",
      "../utils/navHistory.ts", "../utils.ts",
    ];
    files.forEach((f) => {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src).not.toMatch(/scrollRestoration\s*=\s*['"]auto['"]/);
    });
  });
});
