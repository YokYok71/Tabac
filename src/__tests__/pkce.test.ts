/**
 * Tests for `pkceGenerateVerifier` — the cryptographically-random
 * base64url string used as the OAuth CSRF state on the iOS standalone
 * redirect flow.
 *
 * The flow uses `response_type=token` (implicit grant) +
 * a CSRF state, NOT full PKCE. The historical `pkceChallengeFromVerifier`
 * helper was test-only dead code and was removed.
 *
 * Invariants:
 *   - verifier is 43+ chars of unreserved base64url alphabet
 *   - verifiers are unpredictable (crypto.getRandomValues, not Math.random)
 *   - each call returns a fresh verifier (collision rate effectively zero)
 */

import { describe, it, expect } from "vitest";
import { pkceGenerateVerifier } from "../hooks/useGdriveAuth";

const URL_SAFE = /^[A-Za-z0-9\-._~]+$/;

describe("pkceGenerateVerifier", () => {
  it("returns a string of at least 43 characters (RFC 7636 minimum)", () => {
    const v = pkceGenerateVerifier();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it("uses only base64url unreserved characters (no +, /, =, padding)", () => {
    for (let i = 0; i < 10; i++) {
      const v = pkceGenerateVerifier();
      expect(v).toMatch(URL_SAFE);
      expect(v).not.toContain("+");
      expect(v).not.toContain("/");
      expect(v).not.toContain("=");
    }
  });

  it("returns a different verifier on each call (uniqueness)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pkceGenerateVerifier());
    // 100 fresh 32-byte values must all be unique.
    expect(seen.size).toBe(100);
  });

  it("verifier is never the literal access token field — flow is response_type=token", () => {
    // Sanity guard: the verifier we generate is private to the client
    // and must NEVER end up in the URL fragment as if it were a Google
    // access token.
    const v = pkceGenerateVerifier();
    expect(v).not.toMatch(/^ya29\./); // Google access tokens start with ya29.
  });
});
