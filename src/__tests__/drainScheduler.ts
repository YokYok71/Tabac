/**
 * Drain React's scheduler before Vitest tears the jsdom environment down.
 *
 * WHY THIS EXISTS — the failure, with the stack trace it actually produced:
 *
 *     ReferenceError: window is not defined
 *      ❯ performWorkOnRootViaSchedulerTask react-dom-client.development.js:18936
 *      ❯ Immediate.performWorkUntilDeadline scheduler.development.js:45
 *      ❯ processImmediate                   node:internal/timers:504
 *
 * React's scheduler picks the first available of `setImmediate` →
 * `MessageChannel` → `setTimeout`. Under Vitest's jsdom environment
 * `setImmediate` IS defined — MEASURED: it is NODE's, and Vitest also exposes it
 * as `window.setImmediate` — so React yields through a **Node** immediate, and
 * closing the jsdom window does not cancel one. A concurrent render that has
 * yielded at least once therefore has work queued outside jsdom's lifetime;
 * when Vitest deletes `window` between test files, the next slice runs against
 * a global that is gone.
 *
 * The error is UNHANDLED, so Vitest exits 1 while reporting every test as
 * passed. On this repo `npm test` shares a workflow step with `npm run build`,
 * so the run then died three steps later on a misleading `dist/ not found` —
 * which is what made it hard to diagnose rather than merely rare.
 *
 * WHY IT IS FIXED HERE AND NOT IN A TEST FILE. The first attempt appended an
 * `act()` flush to `forgedImageUrl.test.ts`, the one file the report named. That
 * was wrong twice over: the mechanism belongs to React, not to that file, so any
 * render can re-open it; and the comment justified itself with "RTL's
 * auto-cleanup runs after this file and is too late", which is FALSE — RTL
 * registers `cleanup` on `afterEach`, i.e. per test. Recorded rather than
 * quietly deleted, because the wrong reason is what made the wrong scope look
 * sufficient.
 *
 * WHY NOT `act()`. It flushes React exactly, with no bound and no guessing —
 * but it needs `IS_REACT_ACT_ENVIRONMENT`, which only files importing RTL set,
 * so a global hook would have to branch on it and would warn where it is unset.
 * Yielding to the check phase needs no React import, no environment coupling,
 * and covers anything else queued the same way.
 *
 * ── THE FIRST VERSION SHIPPED A WORK BUDGET AND CALLED IT A DRAIN ────────────
 *
 * It ran a FIXED 20 turns and stopped, on the reasoning that immediates are FIFO
 * so one turn runs everything queued now and a handful more covers what React
 * re-schedules as it yields. The measurement behind it — a bare `root.render()`
 * of one element takes 2 turns — is real, and it is the measurement of an idle
 * machine. What 20 turns actually buys is **20 React slices**, and a slice is
 * bounded by `frameInterval = 5` in `scheduler.development.js`: ~100 ms of work,
 * total, however much there is to do. A real render on a contended CI runner
 * exceeds that, so the drain returned with work still queued and the crash came
 * back — reported as `4888 passed` and exit 1, exactly as described above.
 *
 * So the loop now stops on QUIESCENCE and the count is only a backstop. Knowing
 * whether anything is still queued needs a signal, and the scheduler gives none:
 * it captures its primitive ONCE, at module load
 * (`localSetImmediate = typeof setImmediate !== "undefined" ? setImmediate : null`),
 * so patching the global later is never observed. This module therefore wraps
 * `globalThis.setImmediate` AT IMPORT TIME — the setup file imports it, and
 * setup runs before a test file pulls in `react-dom`, so the scheduler captures
 * the wrapper. The wrapper only counts: it schedules through the real function
 * and holds a token in a Set until the callback runs, so `pendingImmediates()`
 * is the number of immediates queued by anyone other than this drain (its own
 * yields go through the captured original and are never counted).
 *
 * WHAT ONE DRAIN COVERS, and what it does not. The immediate path — the one in
 * the stack trace, and the one React yields through here. A `setTimeout(…, 0)`
 * queued during teardown is NOT covered by it: MEASURED, a drain turn takes
 * microseconds while a 0 ms timer is clamped to 1 ms, so no number of turns
 * crosses one — and the same measurement says the old twenty-turn loop never
 * crossed a timer either, though its shape suggested otherwise. That is what
 * `settleReactWork` below is for, and why the hook calls that and not this.
 *
 * `clearImmediate` is wrapped too. Without it a cancelled immediate would leave
 * its token behind for ever, and every later file would run the full bound —
 * bounded, so not a hang, but a silent tax that would look like the drain being
 * expensive rather than broken.
 *
 * The bound survives as the guarantee that a runaway chain SHORTENS the drain
 * instead of hanging the suite, and it can now be generous: with an early break
 * an idle file costs ONE turn (fewer than the twenty it used to pay), and the
 * larger budget is only ever spent where there is genuinely work to finish. If
 * the wrapper cannot be installed — a frozen global, a runtime with no
 * `setImmediate` — there is no quiescence signal and the loop degrades to the
 * fixed count, i.e. to the old behaviour.
 *
 * Returns the number of turns taken, so both the break and the bound are
 * observable to its test.
 */

// The captured original. Also the drain's own yield, so its turns never count
// toward the pending total they are measuring.
const realSetImmediate: typeof setImmediate | null =
  typeof setImmediate === "function" ? setImmediate : null;

const live = new Set<unknown>();
let probeInstalled = false;

if (realSetImmediate) {
  const g = globalThis as unknown as Record<string, unknown>;
  const realClear = typeof clearImmediate === "function" ? clearImmediate : null;

  const wrappedSetImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    // The callback needs the token to release it, and the token only exists
    // once the call returns — hence the cell rather than a self-referencing
    // binding. It cannot run before the assignment: an immediate is queued for
    // the next check phase, and this is all one synchronous statement.
    const cell: { token?: unknown } = {};
    cell.token = realSetImmediate(((...a: unknown[]) => {
      live.delete(cell.token);
      return fn(...a);
    }) as never, ...(args as never[]));
    live.add(cell.token);
    return cell.token;
  };

  try {
    g["setImmediate"] = wrappedSetImmediate;
    if (realClear) {
      g["clearImmediate"] = (token: unknown) => {
        live.delete(token);
        return realClear(token as never);
      };
    }
    probeInstalled = true;
  } catch {
    probeInstalled = false;
  }
}

/** Immediates queued by anyone other than the drain itself. */
export function pendingImmediates(): number {
  return live.size;
}

/** True when the quiescence signal is available; false means the fixed bound. */
export function isSchedulerProbeInstalled(): boolean {
  return probeInstalled;
}

export async function drainSchedulerQueue(maxTurns: number = 200): Promise<number> {
  const yieldOnce = realSetImmediate ?? setImmediate;
  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    await new Promise<void>((resolve) => { yieldOnce(resolve as never); });
    if (probeInstalled && live.size === 0) break;
  }
  return turns;
}

/**
 * What the shared `afterAll` actually calls: drain, cross the timers phase once,
 * drain again.
 *
 * WHY THE SECOND PHASE. The failure was attributed by CI to a file that, MEASURED
 * on this machine, leaves NOTHING queued at `afterAll` — zero pending immediates
 * after the render and zero over the following second, cleanup included. So a
 * single immediate drain cannot be the thing that was missing; whatever schedules
 * the stray slice does it on a DELAY, and the only way to give a 0 ms timer its
 * turn is to spend the millisecond it is clamped to.
 *
 * Stated honestly, because a mitigation described as a fix is how the next reader
 * stops looking: the race is not reproducible on demand — one run in ten — and
 * this does not prove it closed. What it does is remove two demonstrated
 * preconditions instead of one. A longer wait would cover more and cost real
 * time on every one of ~236 files; one tick is the cheap end of that trade.
 */
export async function settleReactWork(): Promise<void> {
  await drainSchedulerQueue();
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  await drainSchedulerQueue();
}
