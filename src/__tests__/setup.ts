import "@testing-library/jest-dom";
import { afterAll } from "vitest";
import { ensureLang } from "../i18n";
import { LANGUAGES } from "../i18n/languages";
import { settleReactWork } from "./drainScheduler";

// Let React finish what it has queued BEFORE Vitest deletes `window`.
//
// React's scheduler yields through Node's `setImmediate`, which outlives the
// jsdom environment — so a render that yielded at least once can have a slice
// still in flight when the environment is torn down between files, and it dies
// with an UNHANDLED `ReferenceError: window is not defined` while every test
// reports as passed. See drainScheduler.ts for the trace and the measurements.
//
// `settleReactWork`, not `drainSchedulerQueue`: draining immediates alone never
// crosses a 0 ms timer, and the file CI named leaves no immediates queued at
// all — so the stray slice is scheduled on a delay. It drains, spends one timer
// tick, and drains again.
//
// `afterAll`, not `afterEach`: RTL's auto-cleanup unmounts per test, and
// unmounting itself schedules React work — so the drain has to come after it.
//
// The arrow is load-bearing: Vitest passes a suite context to hook callbacks,
// and passing the function by reference would land that context in its first
// parameter — which, on the drain itself, is the bound.
afterAll(() => settleReactWork());

// load every dictionary before the suite runs.
//
// Only English is compiled in now; the rest are fetched on demand, so
// `LANG.fr` is undefined until someone asks for it. That is correct at runtime
// — `main.jsx` awaits the active language before mounting React, and the
// language switcher awaits before flipping — but a test that renders a French
// view has no such await, and ~47 of them read `LANG.fr` directly.
//
// Loading all of them here reproduces the state the app is ALWAYS in by the
// time anything renders, rather than making every test file await. The
// alternative — asserting against English everywhere — would have quietly
// stopped testing the French copy, which is the reference dictionary.
//
// Top-level await: the setup file is ESM and Vitest waits for it.
await Promise.all(LANGUAGES.map((l) => ensureLang(l.code)));
