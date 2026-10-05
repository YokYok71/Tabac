// The DOM and accessibility matchers, typed for vitest 5.
//
// `setup.ts` imports `@testing-library/jest-dom`, whose types extend the
// global `jest.Matchers`. Vitest 4 bridged that namespace into its own
// `Assertion` (its JestAssertion extended `jest.Matchers<void, T>`); vitest 5
// dropped the bridge, so every `toBeInTheDocument` / `toHaveTextContent` /
// `toHaveNoViolations` became a type error while the tests still ran — 34 of
// them, which is what failed Dependabot PR #30. The package's own `/vitest`
// entry cannot replace this: it re-declares `Assertion<T = any>`, and vitest
// 5's `Assertion<R, T>` has two type parameters, so the two cannot merge.
// `Matchers<R, T>` is the extension point vitest 5 provides for exactly this.
//
// A DECISION CHANGE, ON THE USER'S CALL (5 October 2026). Issue #15 had
// decided NOT to write this file — it hides an upstream lag in the very file
// whose job is to catch type errors, and has to be maintained and then
// remembered to be removed — and to wait for a jest-dom release instead. It
// was written anyway without that issue having been read; asked, the user
// chose to keep vitest 5 (docs/history.md). WHAT REMAINS TRUE FROM #15 IS THE
// EXIT: delete this file as soon as `npm view @testing-library/jest-dom
// version` shows a release after 7.0.1 that types vitest 5's matchers, then
// re-run `npm run typecheck` — green without this file means it is done.
//
// PROBED, not assumed: removing `toHaveNoViolations` below brings its seven
// errors back, and a wrong call (`toHaveTextContent` with four arguments, an
// invented `toBeInTheDocumentX`) is refused — so these are real types, not an
// `any` that would let everything through.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // The type parameters are copied VERBATIM from vitest's declaration, `T`
  // included: a declaration merge needs them identical, names and all, so the
  // unused `T` can be neither dropped nor renamed `_T`.
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above: required for the merge
    T = unknown,
  > extends TestingLibraryMatchers<any, R> {
    /** jest-axe, registered with `expect.extend(toHaveNoViolations)`. */
    toHaveNoViolations(): R;
  }
}
