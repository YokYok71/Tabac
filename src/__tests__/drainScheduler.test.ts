import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  drainSchedulerQueue,
  isSchedulerProbeInstalled,
  pendingImmediates,
  settleReactWork,
  suppressedAfterTeardown,
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

  // ── THE DRAIN IS A MITIGATION; THIS IS THE GUARD ─────────────────────────
  //
  // Everything above removes PRECONDITIONS: it gives queued work a chance to
  // finish while the environment is still alive. It cannot promise that nothing
  // is left, and the file's own header says so — the drain is BOUNDED on
  // purpose (a runaway chain must shorten it, never hang the suite), and work
  // scheduled on a delay longer than the one tick `settleReactWork` spends is
  // queued strictly after it. So the race stayed open: one run in ~five exited
  // 1 on a fully green suite.
  //
  // What closes it is the observation that the reported stack put the wrapper's
  // own callback ONE FRAME above the crash:
  //
  //     ReferenceError: window is not defined
  //      ❯ performWorkOnRootViaSchedulerTask   react-dom-client.development.js
  //      ❯ performWorkUntilDeadline            scheduler.development.js
  //      ❯ Immediate.<anonymous>               src/__tests__/drainScheduler.ts
  //
  // i.e. the leaked slice goes through code this module owns, so it can be
  // stopped at the moment it fires rather than raced to the exit.
  //
  // NOTHING OBSERVABLE IS LOST. A callback that fires after `window` has been
  // deleted belongs to a file that has ended; no assertion can depend on it,
  // and running it produces a `ReferenceError` and an exit code, never a
  // result. This is not error suppression: a genuine defect runs inside a live
  // file, with a window, and is untouched.
  describe("the post-teardown guard", () => {
    // Vitest's teardown, in miniature: delete the global, let the check phase
    // run, put it back. Restored in a `finally` so a failing assertion cannot
    // leave the rest of the file without a DOM.
    async function withTornDownEnvironment(fn: () => void) {
      const g = globalThis as unknown as Record<string, unknown>;
      const realWindow = g["window"];
      try {
        fn();
        delete g["window"];
        await new Promise<void>((r) => { setTimeout(r, 2); });
      } finally {
        g["window"] = realWindow;
      }
    }

    it("skips a callback whose environment was torn down under it", async () => {
      let ran = false;
      const before = suppressedAfterTeardown();
      await withTornDownEnvironment(() => {
        setImmediate(() => { ran = true; });
      });
      expect(ran, "the callback ran against a deleted `window` — the crash").toBe(false);
      expect(suppressedAfterTeardown(),
        "the skip is not reported, so nothing could ever measure it").toBe(before + 1);
    });

    it("releases the token, so the drain's accounting stays honest", async () => {
      // A skipped callback that kept its token would hold `pendingImmediates()`
      // above zero for ever and make every later file spend the full bound —
      // the same silent tax `clearImmediate` is wrapped to avoid.
      await withTornDownEnvironment(() => { setImmediate(() => {}); });
      expect(pendingImmediates()).toBe(0);
    });

    it("runs normally while the environment is alive", async () => {
      // Non-vacuity. Without this, a guard that skipped EVERYTHING would pass
      // the case above — and would silently disable the drain it sits inside.
      let ran = false;
      setImmediate(() => { ran = true; });
      await drainSchedulerQueue();
      expect(ran).toBe(true);
    });

    it("survives the REAL thing: a React slice in flight when the window goes", async () => {
      // The miniature above proves the rule; this proves it applies to the work
      // that actually crashes. A concurrent root rendered outside `act()` holds
      // a slice in the scheduler — the exact state the reported stack died in —
      // and here the environment is deleted under it.
      //
      // Without the guard this file fails as an UNHANDLED `ReferenceError:
      // window is not defined`, which is the reported failure verbatim: no
      // assertion catches it, because the throw happens inside a Node immediate
      // long after the test that queued it returned. That is why it is worth
      // reproducing rather than trusting the miniature.
      //
      // LAST in this block on purpose: the skipped slice leaves React's
      // scheduler believing work is still pending, so no later case here may
      // depend on a render completing.
      const host = document.createElement("div");
      document.body.appendChild(host);
      createRoot(host).render(React.createElement("p", null, "gone"));
      await Promise.resolve();                     // render() defers to a microtask
      expect(pendingImmediates(), "React queued nothing — fixture is stale")
        .toBeGreaterThan(0);

      const before = suppressedAfterTeardown();
      const g = globalThis as unknown as Record<string, unknown>;
      const realWindow = g["window"];
      try {
        delete g["window"];
        // BOUNDED WAIT ON THE CONDITION, never a fixed delay — and the reason is
        // a flake this file produced. It waited 2 ms; under CPU contention (the
        // suite running beside a build on a 4 vCPU box) the event loop had not
        // reached the queued immediate before `finally` put the window BACK, so
        // the slice ran into a live environment, was not suppressed, and the
        // case failed with `expected N to be N+1` — reporting "the guard let it
        // through" when the guard had simply never been given the chance.
        // Observed once, reproduced nowhere in isolation (5/5 green alone).
        //
        // The ASSERTION below is unchanged, so this is no weaker as a probe:
        // with the guard removed the slice runs into a dead environment and
        // throws the reported `ReferenceError` instead, which no wait can turn
        // green. The bound only stops a slow machine failing for being slow.
        const deadline = Date.now() + 500;
        while (suppressedAfterTeardown() === before && Date.now() < deadline) {
          await new Promise<void>((r) => { setTimeout(r, 2); });
        }
      } finally {
        g["window"] = realWindow;
      }

      expect(suppressedAfterTeardown(), "the React slice was let through").toBe(before + 1);
      expect(host.innerHTML, "it rendered into a dead environment").toBe("");
    });

    it("does not fire when there was never a window to lose", async () => {
      // The rule is "the environment DIED", not "there is no window". A node
      // environment has no `window` at either end, and its callbacks must run.
      const g = globalThis as unknown as Record<string, unknown>;
      const realWindow = g["window"];
      let ran = false;
      try {
        delete g["window"];
        setImmediate(() => { ran = true; });
        await new Promise<void>((r) => { setTimeout(r, 2); });
      } finally {
        g["window"] = realWindow;
      }
      expect(ran, "a callback queued outside jsdom was skipped").toBe(true);
    });
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
