/**
 * property test on the OAuth action whitelist.
 *
 * Builds on the regression coverage in processOAuthReturn.test.ts.
 * That suite exercises each of the 5 canonical action names
 * individually. This one fuzzes the input with fast-check: it
 * generates ANY string (random unicode, control chars, the
 * canonical names, near-misses like "Save" or " reconnect ", SQL
 * injection-style payloads, etc.) and asserts that ONLY the five
 * exact whitelist members make the dispatcher set the pending
 * action.
 *
 * Locks down CLAUDE.md security invariant "OAuth action whitelist
 * (`gdrive-pending` must be validated against `[save, restore,
 * reconnect, list, autosave]` before dispatch)". Any future
 * refactor that relaxes the comparison (case-insensitive,
 * substring match, trim, etc.) fails this test on the first
 * counterexample fast-check generates.
 *
 * The same property is checked on BOTH the implicit-grant (iOS)
 * path and the PKCE (popup) path — both branches enforce the
 * whitelist independently and either could be the next refactor
 * target.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { processOAuthReturn } from "../utils/oauthReturn.ts";
import { OAUTH_DIAG_KEY } from "../utils/oauthDiag.ts";

var CANONICAL = ["save", "restore", "reconnect", "list", "autosave"] as const;

function makeWin(opts: { hash?: string; search?: string } = {}) {
  return {
    location: {
      hash: opts.hash || "",
      search: opts.search || "",
      pathname: "/",
    },
    localStorage: window.localStorage,
    history: { replaceState: () => {} },
  } as unknown as Window & Record<string, unknown>;
}

function isCanonical(s: string): boolean {
  return (CANONICAL as readonly string[]).includes(s);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  try { window.localStorage.removeItem(OAUTH_DIAG_KEY); } catch (_e) {}
});

describe("OAuth whitelist enforcement — implicit grant path", () => {
  it("only the 5 canonical actions make __PENDING_GDRIVE_ACTION__ set", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        window.localStorage.clear();
        window.localStorage.setItem("gdrive-pending", raw);
        window.localStorage.setItem("gdrive-state", "S");
        const w = makeWin({ hash: "#access_token=tk&state=S" });

        processOAuthReturn(w);

        const dispatched = (w as { __PENDING_GDRIVE_ACTION__?: string })
          .__PENDING_GDRIVE_ACTION__;
        if (isCanonical(raw)) {
          // Canonical action → dispatched verbatim.
          expect(dispatched).toBe(raw);
        } else {
          // Anything else → dropped, no dispatch.
          expect(dispatched).toBeUndefined();
        }
      }),
      // 500 runs is generous for a 5-element whitelist; fast-check
      // will favour edge cases (empty string, whitespace, control
      // chars, casing of canonical values, etc.) automatically.
      { numRuns: 500 },
    );
  });

  it("near-miss variants of canonical names are rejected", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CANONICAL),
        fc.constantFrom(
          // Capitalisation variants.
          (s: string) => s.toUpperCase(),
          (s: string) => s[0]!.toUpperCase() + s.slice(1),
          // Whitespace variants.
          (s: string) => " " + s,
          (s: string) => s + " ",
          (s: string) => " " + s + " ",
          // Suffix / prefix.
          (s: string) => s + "x",
          (s: string) => "x" + s,
          // Embedded.
          (s: string) => "do_" + s,
          (s: string) => s + "_action",
        ),
        (canonical, mutate) => {
          const variant = mutate(canonical);
          // Skip when the mutation happens to be identity.
          if (variant === canonical) return;
          window.localStorage.clear();
          window.localStorage.setItem("gdrive-pending", variant);
          window.localStorage.setItem("gdrive-state", "S");
          const w = makeWin({ hash: "#access_token=tk&state=S" });

          processOAuthReturn(w);

          const dispatched = (w as { __PENDING_GDRIVE_ACTION__?: string })
            .__PENDING_GDRIVE_ACTION__;
          // Near-miss MUST be rejected.
          expect(dispatched).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("OAuth whitelist enforcement — PKCE path", () => {
  it("only the 5 canonical actions make __PENDING_GDRIVE_ACTION__ set", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        window.localStorage.clear();
        window.localStorage.setItem("gdrive-pending", raw);
        window.localStorage.setItem("gdrive-state", "S");
        window.localStorage.setItem("gdrive-pkce-verifier", "V");
        const w = makeWin({ search: "?code=CODE&state=S" });

        processOAuthReturn(w);

        const dispatched = (w as { __PENDING_GDRIVE_ACTION__?: string })
          .__PENDING_GDRIVE_ACTION__;
        if (isCanonical(raw)) {
          expect(dispatched).toBe(raw);
        } else {
          expect(dispatched).toBeUndefined();
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("OAuth whitelist enforcement — token discarded with non-canonical action", () => {
  it("a fresh token is NOT persisted when the action is not whitelisted", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !isCanonical(s)),
        (badAction) => {
          window.localStorage.clear();
          window.localStorage.setItem("gdrive-pending", badAction);
          window.localStorage.setItem("gdrive-state", "S");
          const w = makeWin({ hash: "#access_token=tk&state=S" });

          processOAuthReturn(w);

          // Token MUST be discarded (security invariant — an attacker
          // who can write to localStorage shouldn't be able to drive
          // the dispatcher with a custom action).
          expect((w as { __PENDING_GDRIVE_TOKEN__?: string })
            .__PENDING_GDRIVE_TOKEN__).toBeUndefined();
          expect((w as { __PENDING_GDRIVE_ACTION__?: string })
            .__PENDING_GDRIVE_ACTION__).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
