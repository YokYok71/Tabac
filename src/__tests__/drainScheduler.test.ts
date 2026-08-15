import { readFileSync } from "node:fs";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  drainSchedulerQueue,
  isSchedulerProbeInstalled,
  pendingImmediates,
  settleReactWork,
} from "./drainScheduler";

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

    // And the drain can SEE it — but not yet. React 19 defers `render()` to a
    // MICROTASK, and only that microtask reaches the scheduler, so the immediate
    // does not exist until the microtask queue has run once. MEASURED, and it is
    // the reason the drain must yield before it may conclude anything: a
    // quiescence test performed before the first turn would read "nothing
    // queued" on a root that has not started.
    expect(pendingImmediates()).toBe(0);
    await Promise.resolve();

    // The scheduler captures its yield primitive once, at module load, so this
    // only holds because the setup file imports the probe before a test file
    // pulls in react-dom. If that order ever breaks, the quiescence break
    // degrades to "stop after one turn" — silently — so the coupling is
    // asserted here rather than assumed.
    expect(pendingImmediates()).toBeGreaterThan(0);

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

  it("stops as soon as the queue is quiet, instead of spending its whole budget", async () => {
    // THE FIX. The first version ran a fixed 20 turns, so the count was a WORK
    // BUDGET — 20 React slices of `frameInterval = 5` ms — and a render that
    // needed more than ~100 ms on a contended CI runner returned with work
    // still queued, which is the crash this helper exists to prevent.
    expect(isSchedulerProbeInstalled()).toBe(true);   // else there is no signal
    expect(pendingImmediates()).toBe(0);

    const turns = await drainSchedulerQueue(50);

    // One turn to observe the empty queue, and no more. The drain's own yield
    // goes through the captured original, so it cannot count itself and loop
    // for ever.
    expect(turns).toBe(1);
  });

  it("counts what OTHERS queue, so the break cannot fire while work remains", async () => {
    // Non-vacuity for the case above: if the probe counted nothing, the drain
    // would break after one turn whether or not anything was pending — which is
    // the same defect as the fixed bound, arrived at from the other side.
    setImmediate(() => {});
    expect(pendingImmediates()).toBe(1);
    await drainSchedulerQueue();
    expect(pendingImmediates()).toBe(0);
  });

  it("does not leak a token when an immediate is cancelled", async () => {
    // A leaked token would keep `pendingImmediates()` above zero for ever, so
    // every later file would run the full bound — not a hang, but a silent tax
    // that reads as the drain being expensive rather than broken.
    clearImmediate(setImmediate(() => {}) as never);
    expect(pendingImmediates()).toBe(0);
    expect(await drainSchedulerQueue(50)).toBe(1);
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

  it("settles work a 0 ms timer schedules, which no number of drain turns can", async () => {
    // The gap the composed settle exists for: a drain turn takes microseconds
    // and a 0 ms timer is clamped to 1 ms, so the timer's React work is queued
    // strictly after every turn the bound allows.
    //
    // Non-vacuity is the PROBE, not a second assertion: removing the timer tick
    // from `settleReactWork` turns this red. Asserting `false` after a bare
    // drain first was tried and removed — it holds only while a turn stays
    // under a millisecond, i.e. it would introduce a flake into the fix for a
    // flake.
    let ran = false;
    setTimeout(() => { setImmediate(() => { ran = true; }); }, 0);

    await settleReactWork();
    expect(ran).toBe(true);
  });

  // The helper being correct guarantees nothing if nobody calls it — the
  // failure shape this repo keeps paying for (a well-tested helper behind
  // untested wiring). Source-level because a hook registered by the setup file
  // is not observable from inside a test that the same hook runs after.
  describe("wiring", () => {
    const setup = blankComments(readFileSync("src/__tests__/setup.ts", "utf8"));

    it("is registered on afterAll by the shared test setup", () => {
      expect(setup).toMatch(/afterAll\(\s*\(\s*\)\s*=>\s*settleReactWork\(\s*\)\s*\)/);
    });

    it("wires the composed settle, not the bare immediate drain", () => {
      // Draining immediates never crosses a 0 ms timer — MEASURED — and the
      // file CI named leaves no immediates queued at all, so the bare drain
      // would be wired against the one mechanism already known not to apply.
      expect(setup).not.toMatch(/afterAll\([^)]*drainSchedulerQueue/);
    });

    it("is NOT passed to afterAll by reference", () => {
      // Vitest hands hook callbacks a suite context. On the drain that arrives
      // as `maxTurns` and silently sets the bound to an object — truthy, so the
      // `turns < maxTurns` loop never runs and the drain is a no-op that still
      // looks wired.
      expect(setup).not.toMatch(/afterAll\(\s*(settleReactWork|drainSchedulerQueue)\s*[,)]/);
    });

    it("drains AFTER each test's unmount, never per test", () => {
      // RTL registers cleanup on afterEach, and unmounting itself schedules
      // React work — so an afterEach drain would run before the last unmount.
      expect(setup).not.toMatch(/afterEach\([^)]*(settleReactWork|drainSchedulerQueue)/);
    });
  });
});
