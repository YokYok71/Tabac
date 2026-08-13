import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// `public/reset.html` must REPLACE itself, never push.
//
// Reported from the installed iOS PWA: after using the repair link, a
// left-edge swipe back landed on "✅ Cache nettoyé ! Redirection…" — the reset
// page — which purged the caches again and redirected forward. Going back
// answered with an action the user had not asked for a second time.
//
// Cause: the page ended with `window.location.href = './?_v=' + Date.now()`,
// an ordinary navigation, so it PUSHED the app on top of itself and stayed in
// history right behind it. A repair-and-redirect page is an ACTION, not a
// place: it must never be a back target.
//
// The app's own back handling was never at fault — `useBackNavigation`'s
// popstate handler re-pushes a state immediately, so an in-app back cannot
// exhaust the document's entries. That is asserted here too, because it is the
// other half of "back never leaves the app unexpectedly".

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("reset.html — an action, not a back target", () => {
  const html = read("public/reset.html");
  // Strip comments so the assertions read the CODE, not the prose explaining
  // it — this repo has been caught several times by a check satisfied by its
  // own explanatory comment.
  const code = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("redirects with location.replace", () => {
    expect(code).toMatch(/location\.replace\(/);
  });

  it("never assigns location.href / location.assign", () => {
    // Either would push, which is exactly the reported defect.
    expect(code).not.toMatch(/location\.href\s*=/);
    expect(code).not.toMatch(/location\.assign\(/);
  });

  it("still cache-busts the destination, so the reload cannot be served stale", () => {
    // The whole point of the page is to escape a bad cache; redirecting to a
    // cacheable URL would undo it.
    expect(code).toMatch(/location\.replace\(\s*['"]\.\/\?_v=['"]\s*\+/);
  });

  it("still deletes the caches before redirecting", () => {
    expect(code).toMatch(/caches\.delete\(/);
  });

  it("does NOT delete IndexedDB — the photos must survive a repair", () => {
    // Same contract as the EB recovery and doUpdate: purge the service worker
    // and Cache Storage, never the user's data.
    expect(code).not.toMatch(/deleteDatabase/);
  });
});

describe("the app's own back never exhausts its history", () => {
  const nav = read("src/hooks/useBackNavigation.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("re-pushes a state on every popstate", () => {
    // Without this, each system back consumes one entry and the document is
    // eventually left — which is how a page sitting behind the app becomes
    // reachable at all.
    const onPop = /function _onPop\(\)\s*\{([\s\S]*?)\n\s{4}\}/.exec(nav);
    expect(onPop, "the popstate handler must be findable").toBeTruthy();
    expect(onPop![1]).toMatch(/history\.pushState\(/);
  });

  it("seeds an entry at mount so the first back has something to consume", () => {
    expect(nav).toMatch(/history\.replaceState\(/);
    expect(nav).toMatch(/history\.pushState\(/);
  });
});
