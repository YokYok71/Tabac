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
 * Immediates run FIFO, so ONE turn runs everything queued right now; the loop
 * exists for the work React re-schedules as it yields (MEASURED: a bare
 * `root.render()` of one element takes 2 turns). The bound is what makes this
 * safe to run unconditionally after every file — a runaway chain shortens the
 * drain instead of hanging the suite. ~20 turns is ~0.2 ms per file.
 *
 * Returns the number of turns taken, so the bound is observable to its test.
 */
export async function drainSchedulerQueue(maxTurns: number = 20): Promise<number> {
  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
  return turns;
}
