// Unit tests for src/utils/cryptoBackup.ts.
//
// Web Crypto API is available in jsdom 22+ (this project uses jsdom 29)
// so we test against the real implementation, not a mock. PBKDF2 with
// 600k iterations is slow (~1s per derivation) — most tests use small
// plaintext + a single round-trip to keep total runtime under control.

import { describe, it, expect } from "vitest";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedEnvelopeJSON,
  ENCRYPTION_VERSION,
  makeEncryptionVerifier,
  verifyPassphrase,
} from "../utils/cryptoBackup";

describe("cryptoBackup — round-trip", () => {
  it("encrypts then decrypts back to the original plaintext", async () => {
    const original = JSON.stringify({ tobaccos: [{ id: 1, name: "Duskfall" }] });
    const env = await encryptBackup(original, "correct horse battery staple");
    const recovered = await decryptBackup(env, "correct horse battery staple");
    expect(recovered).toBe(original);
  }, 30_000);

  it("handles unicode in plaintext (FR / EN / emojis)", async () => {
    const original = JSON.stringify({
      notes: "Café français · English · 🚬 · ⚠️ Important",
      pipe: "Pétèrson",
    });
    const env = await encryptBackup(original, "passphrase");
    const recovered = await decryptBackup(env, "passphrase");
    expect(recovered).toBe(original);
  }, 30_000);

  it("handles a long passphrase", async () => {
    const original = '{"x":1}';
    const long = "A very long passphrase with spaces and punctuation: 你好世界! 1234567890".repeat(3);
    const env = await encryptBackup(original, long);
    const recovered = await decryptBackup(env, long);
    expect(recovered).toBe(original);
  }, 30_000);
});

describe("cryptoBackup — envelope shape", () => {
  it("produces a JSON object with _encrypted = v1, KDF + cipher tags, and salt/iv/ciphertext", async () => {
    const env = JSON.parse(await encryptBackup('{"a":1}', "x"));
    expect(env._encrypted).toBe(ENCRYPTION_VERSION);
    expect(env._kdf).toBe("PBKDF2-SHA256-600000");
    expect(env._cipher).toBe("AES-GCM-256");
    expect(typeof env.salt).toBe("string");
    expect(typeof env.iv).toBe("string");
    expect(typeof env.ciphertext).toBe("string");
    expect(env.salt.length).toBeGreaterThan(0);
    expect(env.iv.length).toBeGreaterThan(0);
    expect(env.ciphertext.length).toBeGreaterThan(0);
  }, 30_000);

  it("same passphrase + same plaintext = DIFFERENT ciphertext (random salt + IV per call)", async () => {
    const env1 = await encryptBackup('{"a":1}', "pw");
    const env2 = await encryptBackup('{"a":1}', "pw");
    expect(env1).not.toBe(env2);
    const o1 = JSON.parse(env1);
    const o2 = JSON.parse(env2);
    expect(o1.salt).not.toBe(o2.salt);
    expect(o1.iv).not.toBe(o2.iv);
    expect(o1.ciphertext).not.toBe(o2.ciphertext);
  }, 60_000);
});

describe("cryptoBackup — wrong passphrase / tampering", () => {
  it("decrypt throws on wrong passphrase", async () => {
    const env = await encryptBackup('{"a":1}', "correct");
    await expect(decryptBackup(env, "wrong")).rejects.toThrow();
  }, 30_000);

  it("decrypt throws if ciphertext was tampered with", async () => {
    // Use a longer plaintext so the ciphertext is comfortably bigger
    // than the GCM 16-byte tag → flipping a char in the MIDDLE of the
    // base64 is guaranteed to mutate the payload (not the padding).
    // Previous "flip the second-to-last char" was flaky on CI because
    // the affected byte often fell inside base64 padding territory
    // (`=` / unused trailing bits), so the binary content was
    // sometimes unchanged and AES-GCM verified successfully.
    const env = JSON.parse(await encryptBackup('{"a":1,"padding":"' + "x".repeat(200) + '"}', "pw"));
    const ct = env.ciphertext as string;
    const mid = Math.floor(ct.length / 2);
    // Replace a single character in the middle with a different base64 char.
    const orig = ct[mid] as string;
    const replacement = orig === "A" ? "B" : "A";
    env.ciphertext = ct.slice(0, mid) + replacement + ct.slice(mid + 1);
    await expect(decryptBackup(JSON.stringify(env), "pw")).rejects.toThrow();
  }, 30_000);

  it("decrypt throws on missing salt / iv / ciphertext fields", async () => {
    const env = await encryptBackup('{"a":1}', "pw");
    const o = JSON.parse(env);
    delete o.iv;
    await expect(decryptBackup(JSON.stringify(o), "pw")).rejects.toThrow(/missing/);
  }, 30_000);

  it("decrypt throws when version tag is unknown", async () => {
    const env = JSON.parse(await encryptBackup('{"a":1}', "pw"));
    env._encrypted = "v999";
    await expect(decryptBackup(JSON.stringify(env), "pw")).rejects.toThrow(/version/);
  }, 30_000);

  it("decrypt throws on non-JSON input", async () => {
    await expect(decryptBackup("not json at all", "pw")).rejects.toThrow(/valid JSON/);
  });
});

describe("cryptoBackup — envelope detection", () => {
  it("isEncryptedEnvelopeJSON returns true on a real envelope", async () => {
    const env = await encryptBackup('{"a":1}', "pw");
    expect(isEncryptedEnvelopeJSON(env)).toBe(true);
  }, 30_000);

  it("isEncryptedEnvelopeJSON returns false on plaintext backup JSON", () => {
    const plain = JSON.stringify({
      tobaccos: [], pipes: [], wishlist: [], accessories: [], sessions: [],
      _savedAt: "2026-05-23T20:00:00Z",
    });
    expect(isEncryptedEnvelopeJSON(plain)).toBe(false);
  });

  it("isEncryptedEnvelopeJSON returns false on garbage", () => {
    expect(isEncryptedEnvelopeJSON("")).toBe(false);
    expect(isEncryptedEnvelopeJSON("nope")).toBe(false);
    expect(isEncryptedEnvelopeJSON("{}")).toBe(false);
    expect(isEncryptedEnvelopeJSON(null as any)).toBe(false);
  });

  // REMOVED with `isEncryptedEnvelopeObject`, whose only consumer this was.
  // What it asserted — a real cellar payload is NOT mistaken for an envelope —
  // is still covered on the shipping predicate by the "returns false on
  // garbage" case above and by the round-trip cases.

  it("isEncryptedEnvelopeJSON accepts large envelopes (no size cap)", () => {
    // 2.5 MB envelope — must NOT be rejected on size alone. The
    // previous 2 MB short-circuit broke restore for any encrypted
    // backup containing photos (the photos are base64-embedded in the
    // plaintext, then base64-wrapped again as ciphertext — easily
    // multi-MB even for a modest cellar). See cryptoBackup.ts comment.
    const big = JSON.stringify({
      _encrypted: "v1",
      _kdf: "PBKDF2-SHA256-600000",
      _cipher: "AES-GCM-256",
      salt: "x",
      iv: "y",
      ciphertext: "a".repeat(2_500_000),
    });
    expect(isEncryptedEnvelopeJSON(big)).toBe(true);
  });

  it("isEncryptedEnvelopeJSON returns false on huge plaintext (no envelope marker)", () => {
    // Even at 2.5 MB, a plaintext backup without the "_encrypted"
    // marker is rejected fast via the indexOf prefix check — no
    // expensive JSON.parse is attempted.
    const hugePlain = '{"tobaccos":[' + ",".repeat(2_500_000) + "]}";
    expect(isEncryptedEnvelopeJSON(hugePlain)).toBe(false);
  });
});

describe("cryptoBackup — empty input rejection", () => {
  it("encryptBackup throws on empty plaintext", async () => {
    await expect(encryptBackup("", "pw")).rejects.toThrow(/empty plaintext/);
  });
  it("encryptBackup throws on empty passphrase", async () => {
    await expect(encryptBackup('{"a":1}', "")).rejects.toThrow(/empty passphrase/);
  });
  it("decryptBackup throws on empty envelope", async () => {
    await expect(decryptBackup("", "pw")).rejects.toThrow(/empty envelope/);
  });
  it("decryptBackup throws on empty passphrase", async () => {
    await expect(decryptBackup('{"_encrypted":"v1"}', "")).rejects.toThrow(/empty passphrase/);
  });
});

describe("cryptoBackup — passphrase verifier", () => {
  it("accepts the SAME passphrase and rejects a different one", async () => {
    const marker = await makeEncryptionVerifier("correct horse");
    expect(await verifyPassphrase(marker, "correct horse")).toBe(true);
    expect(await verifyPassphrase(marker, "wrong horse")).toBe(false);
  });
  it("rejects a garbage / non-envelope marker instead of throwing", async () => {
    expect(await verifyPassphrase("not-an-envelope", "x")).toBe(false);
    expect(await verifyPassphrase('{"_encrypted":"v1"}', "x")).toBe(false);
  });
  it("the verifier is itself a valid encrypted envelope", async () => {
    const marker = await makeEncryptionVerifier("pw");
    expect(isEncryptedEnvelopeJSON(marker)).toBe(true);
  });
});
