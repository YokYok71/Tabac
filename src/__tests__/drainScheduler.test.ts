import { readFileSync } from "node:fs";
import React from "react";
import { createRoot } from "react-dom/client";
import { drainSchedulerQueue } from "./drainScheduler";

// Blank comments (length-preserving) before any source assertion. A check that
// reads its own explanatory prose as data passes for the wrong reason — this
// repo has been caught by that three times.
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

// The guarantee this helper exists for: when a test file ends, React must have
// nothing left queued. Everything below is deterministic — the RACE it prevents
// (Vitest deleting `window` while a slice is in flight) is not reproducible on
// demand, so what is asserted is the PRECONDITION being removed, not the crash.
describe("drainSchedulerQueue", () => {
  it("runs React work that is still queued — the case that produced the crash", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    // Rendered OUTSIDE act(), exactly like the assertion in
    // forgedImageUrl.test.ts that the CI failure was attributed to.
    createRoot(host).render(React.createElement("p", null, "hello"));

    // A concurrent root DEFERS: nothing is in the DOM yet, so React is holding
    // work in the scheduler. This is the state a file must never end in.
    expect(host.innerHTML).toBe("");

    await drainSchedulerQueue();

    // The drain ran that work, while `window` still exists.
    expect(host.innerHTML).toBe("<p>hello</p>");
  });

  it("runs a whole self-rescheduling chain, not just what was queued at entry", async () => {
    // Models React yielding: each slice re-schedules the next one, so a single
    // check-phase turn is not enough.
    let slices = 0;
    const slice = () => { if (++slices < 8) setImmediate(slice); };
    setImmediate(slice);

    expect(slices).toBe(0);
    await drainSchedulerQueue();
    expect(slices).toBe(8);
  });

  it("is BOUNDED, so a runaway chain shortens the drain instead of hanging the suite", async () => {
    // This is what makes the hook safe to run unconditionally after every file.
    let stop = false;
    let slices = 0;
    const runaway = () => { slices++; if (!stop) setImmediate(runaway); };
    setImmediate(runaway);

    const turns = await drainSchedulerQueue(5);
    stop = true;   // never leave an endless chain behind for the next file

    expect(turns).toBe(5);
    // Non-vacuity: without this, a chain that had quietly died on its own would
    // give the same turn count, and the bound would be untested.
    expect(slices).toBeGreaterThan(0);
  });

  it("yields at least one turn even at the floor", async () => {
    let ran = false;
    setImmediate(() => { ran = true; });
    await drainSchedulerQueue(1);
    expect(ran).toBe(true);
  });

  // The helper being correct guarantees nothing if nobody calls it — the
  // failure shape this repo keeps paying for (a well-tested helper behind
  // untested wiring). Source-level because a hook registered by the setup file
  // is not observable from inside a test that the same hook runs after.
  describe("wiring", () => {
    const setup = blankComments(readFileSync("src/__tests__/setup.ts", "utf8"));

    it("is registered on afterAll by the shared test setup", () => {
      expect(setup).toMatch(/afterAll\(\s*\(\s*\)\s*=>\s*drainSchedulerQueue\(\s*\)\s*\)/);
    });

    it("is NOT passed to afterAll by reference", () => {
      // Vitest hands hook callbacks a suite context, which would arrive as
      // `maxTurns` and silently set the bound to an object — truthy, so the
      // `turns < maxTurns` loop would never run and the drain would be a no-op
      // that still looked wired.
      expect(setup).not.toMatch(/afterAll\(\s*drainSchedulerQueue\s*[,)]/);
    });

    it("drains AFTER each test's unmount, never per test", () => {
      // RTL registers cleanup on afterEach, and unmounting itself schedules
      // React work — so an afterEach drain would run before the last unmount.
      expect(setup).not.toMatch(/afterEach\([^)]*drainSchedulerQueue/);
    });
  });
});
