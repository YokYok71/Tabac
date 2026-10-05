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
