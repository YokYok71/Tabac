// Phase 1 of optional Drive backup encryption.
//
// Encrypts a JSON-serialized backup payload with a user-chosen passphrase
// using PBKDF2-SHA256 (600 000 iterations, OWASP-2023 floor) for key
// derivation and AES-GCM-256 for authenticated encryption — both via the
// Web Crypto API (no third-party dep).
//
// The envelope is itself a JSON object so it slots cleanly into the same
// Drive upload path that handles plaintext backups today. `isEncrypted*`
// helpers let the restore path detect which kind of payload it just
// downloaded and prompt for a passphrase only when needed.
//
// Threat model — what this protects:
//   ✅ Drive backups visible only to ciphertext-readers (a third party
//      who gains access to the user's Google Drive sees an opaque blob)
//   ✅ Authenticated encryption (AES-GCM) — tampering with the ciphertext
//      makes decryption fail rather than producing garbage
//   ✅ Per-backup salt + IV — same passphrase, every backup is a fresh
//      ciphertext (no replay analysis)
//
// What this does NOT protect:
//   ❌ Local data in localStorage / IndexedDB stays plaintext — the user
//      already trusts the device, and adding local encryption would
//      block every read of the entire app
//   ❌ Forgotten passphrase = lost backup. There is NO recovery. The UI
//      must warn the user clearly before enabling. (A passphrase TYPO is
//      mitigated — a verifier rejects a mismatched passphrase at save
//      time — but a genuinely forgotten passphrase is still unrecoverable.)
//   ❌ The backup FILENAME is not encrypted — an observer with Drive/Dropbox
//      access still sees per-kind counts (t/p/w/a/j), save timestamps, and the
//      device id + cadence. Only the file CONTENTS are opaque.

const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard

/** Envelope tag stamped in the JSON. Bump if we change the algorithm
 *  family — `decryptBackup` rejects unknown versions to refuse silently
 *  downgrading. */
export const ENCRYPTION_VERSION = "v1";

export interface EncryptedEnvelope {
  _encrypted: typeof ENCRYPTION_VERSION;
  _kdf: "PBKDF2-SHA256-600000";
  _cipher: "AES-GCM-256";
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = String(binary).charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a JSON-serialized backup string with the given passphrase.
 *  Returns the JSON-stringified envelope ready to upload. */
export async function encryptBackup(plaintextJSON: string, passphrase: string): Promise<string> {
  if (!plaintextJSON) throw new Error("encryptBackup: empty plaintext");
  if (!passphrase) throw new Error("encryptBackup: empty passphrase");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintextJSON),
  );
  const envelope: EncryptedEnvelope = {
    _encrypted: ENCRYPTION_VERSION,
    _kdf: "PBKDF2-SHA256-600000",
    _cipher: "AES-GCM-256",
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ciphertext: bufToB64(ciphertext),
  };
  return JSON.stringify(envelope);
}

/** Decrypt a JSON-stringified envelope back into the original
 *  plaintext JSON. Throws on wrong passphrase or tampered ciphertext
 *  (AES-GCM tag verification fails). */
export async function decryptBackup(envelopeJSON: string, passphrase: string): Promise<string> {
  if (!envelopeJSON) throw new Error("decryptBackup: empty envelope");
  if (!passphrase) throw new Error("decryptBackup: empty passphrase");
  let env: any;
  try {
    env = JSON.parse(envelopeJSON);
  } catch (_e) {
    // TS target is ES2020 — Error.cause (ES2022) not in the lib.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("decryptBackup: envelope is not valid JSON");
  }
  if (!env || typeof env !== "object" || env._encrypted !== ENCRYPTION_VERSION) {
    throw new Error("decryptBackup: not an encrypted envelope (or unsupported version)");
  }
  if (typeof env.salt !== "string" || typeof env.iv !== "string" || typeof env.ciphertext !== "string") {
    throw new Error("decryptBackup: missing salt/iv/ciphertext");
  }
  const salt = b64ToBuf(env.salt);
  const iv = b64ToBuf(env.iv);
  const ciphertext = b64ToBuf(env.ciphertext);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

/** Cheap detection: does this string look like one of our encrypted
 *  envelopes? Used by the restore path to branch between "decrypt" and
 *  "parse plaintext" without forcing the user to choose. */
export function isEncryptedEnvelopeJSON(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  // Cheap prefix check first — `indexOf` on a 10 MB string is still
  // sub-millisecond. If the marker isn't there it's definitely not
  // an envelope and we skip the (more expensive) JSON.parse.
  //
  // Removed the previous `s.length > 2_000_000` short-
  // circuit. Encrypted backups containing photos easily exceed 2 MB
  // (the photos themselves are base64-embedded inside the plaintext
  // we encrypt, then the whole thing is base64-wrapped again as
  // ciphertext) and the false-negative made the restore path treat
  // such envelopes as "plaintext" → `JSON.parse` succeeded → no
  // `.tobaccos` field → user saw "Fichier invalide" / "Invalid file".
  if (s.indexOf("\"_encrypted\"") === -1) return false;
  try {
    const o = JSON.parse(s);
    return !!(o && typeof o === "object" && o._encrypted === ENCRYPTION_VERSION);
  } catch (_e) {
    return false;
  }
}

/** Same predicate on an already-parsed object — saves a re-parse when
 *  the caller already has the parsed payload. */
export function isEncryptedEnvelopeObject(o: any): boolean {
  return !!(o && typeof o === "object" && o._encrypted === ENCRYPTION_VERSION);
}

// Passphrase VERIFIER. The design stores no passphrase, so a
// typo at unlock/save time (after a reload cleared the in-memory passphrase)
// would silently encrypt a NEW backup under a passphrase the user doesn't
// know — a permanently unrecoverable backup, with no error shown. A verifier is
// the encryption of a fixed token; it lets the save path REJECT a mismatched
// passphrase WITHOUT ever storing the secret. Stored at setup, checked at
// unlock. A wrong passphrase makes decryptBackup throw (GCM tag mismatch) or
// yields a different token → false. Legacy installs (no verifier) skip the
// check — this only ever tightens, never blocks a correct passphrase.
const VERIFIER_TOKEN = "cave-drive-enc-verify-v1";
export async function makeEncryptionVerifier(passphrase: string): Promise<string> {
  return encryptBackup(VERIFIER_TOKEN, passphrase);
}
export async function verifyPassphrase(marker: string, passphrase: string): Promise<boolean> {
  try {
    const tok = await decryptBackup(marker, passphrase);
    return tok === VERIFIER_TOKEN;
  } catch (_e) {
    return false;
  }
}
