// The app's PREFERENCES travel with the backup.
//
// Until now a backup carried the cellar and nothing else: restoring onto a new
// phone gave you your tobaccos back and left you to re-pick the language, the
// units, the currency, the theme, the text size, the thresholds — about twenty
// choices, several of them buried two taps deep in Settings.
//
// ── WHY THIS IS AN ALLOWLIST, AND MUST STAY ONE ─────────────────────────────
// The obvious implementation is "walk localStorage and take everything with our
// prefix". That would be a security defect, not a shortcut: the same storage
// holds LIVE CREDENTIALS — the Drive access token (`gdrive-tk`), the Dropbox
// refresh token (`dropbox-rt`, long-lived), the OAuth CSRF state, and the AI
// API keys. A JSON export is a file the user mails to themselves, drops in a
// cloud folder, or hands to a support thread. A blanket sweep would put a
// working credential in it, and no test would notice because the file would
// look correct.
//
// So: SETTINGS_KEYS is an explicit list of preferences, and `FORBIDDEN` names
// the classes that must never appear in it. `appSettings.test.ts` asserts the
// two are disjoint AND that every real credential key in the app is rejected —
// the negative half is the one that matters.
//
// ── WHY THE API KEY IS NOT HERE ─────────────────────────────────────────────
// It already has its own channel (`_apiKey` / `_apiKeyProvider`) with its own
// opt-out, defaulting to EXCLUDED (`cave-exclude-apikey`). Carrying
// it a second time through this block would silently defeat that opt-out.
//
// ── DEVICE-LOCAL KEYS ARE EXCLUDED TOO, for a different reason ──────────────
// `cave-device-id` and the per-provider file ids are how a device recognises
// its OWN cloud auto-file. Copying them onto a second device makes two devices
// claim one file and fight over it — the multi-device convergence bug builds
// 28/66/68 were spent fixing. `cave-device-name` is excluded on the same
// grounds: it names THIS device, so inheriting it would label the new phone
// with the old one's name.

import { lsGet, lsSet } from "./appStorage.ts";

/** Preferences that belong to the USER and are worth restoring. */
export const SETTINGS_KEYS = [
  // display
  "cave-lang", "cave-theme", "cave-theme-mode", "cave-font-scale",
  "cave-date-format", "cave-currency",
  // units
  "cave-weight-unit", "cave-length-unit",
  // cellar behaviour
  "cave-accounting-enabled", "cave-session-default-weight",
  "cave-watch-low-weight", "cave-maint-threshold", "cave-maint-reminders-enabled",
  // lists & UI choices
  "cave-default-grouped", "cave-wish-sort", "cave-sections", "cave-settings-tab",
  // AI preferences (the KEY itself travels separately — see the header)
  "cave-autofill-source", "ai-provider",
  "ai-model-anthropic", "ai-model-openai", "ai-model-gemini",
  // cloud preference: WHICH destination, never the credentials or the file ids
  "cave-cloud-provider", "cave-autosave",
] as const;

// ── WHY `cave-drive-encryption-enabled` IS NOT ON THAT LIST ──────────────────
// It was, for a while, and it disabled a safety check.
//
// The flag's companion — `cave-drive-enc-verifier` — is correctly FORBIDDEN, and
// the passphrase itself is memory-only by design and never exported. So a REPLACE
// restore of a PLAINTEXT JSON export taken on an encryption-enabled device (local
// exports are never encrypted — Phase 1) left the target with encryption ON, no
// cached passphrase and NO VERIFIER. `maybeEncryptPayload` reads the verifier only
// to REJECT a mismatch; absent, it takes the lenient legacy branch — so the
// protection against "a typo silently mints a permanently unrecoverable
// backup" was off on that device, for good. The verifier backfill cannot rescue it
// either: that runs in `maybeDecryptText` gated on the PRE-restore
// `driveEncryptionEnabled`, so it can never fire on the restore that turns
// encryption on — and a plaintext export has nothing to decrypt anyway.
//
// THE RULE, which is the part worth keeping: a PREFERENCE may travel; a flag
// whose companion SECRET cannot travel must not. Re-enabling encryption on the
// new device costs the user nothing extra, because they have to re-enter the
// passphrase there regardless.

/**
 * Key classes that must NEVER be exported. Kept as explicit values (not a
 * regex) so the test can feed each one in and assert it is refused.
 *
 * Credentials and CSRF state first, then the device-local routing keys, then
 * the ephemeral / diagnostic slots that would be meaningless or misleading on
 * another device.
 */
export const FORBIDDEN = [
  // live credentials + CSRF
  "gdrive-tk", "dropbox-tk", "dropbox-rt",
  "gdrive-state", "dropbox-state", "dropbox-verifier",
  "gdrive-pkce-verifier", "gdrive-pkce-redirect",
  "anthropic-api-key", "openai-api-key", "gemini-api-key",
  "gdrive-account-hint",
  // device-local cloud routing — copying these makes two devices fight over
  // one auto-file (the convergence bug three releases were spent on)
  "cave-device-id", "cave-device-name",
  "gdrive-fid", "gdrive-auto-fid", "dropbox-fid", "dropbox-auto-fid",
  "cave-auto-stamped",
  // ephemeral / per-device state
  "pipe-cellar-v6", "cave-tasting-active", "cave-pending-sync",
  "cave-autosave-diag", "cave-cloudcheck-diag", "cave-oauth-diag",
  "cave-diagnostic-v1", "cave-eb-recovery-ts", "cave-sugg-rot",
  "cave-drive-enc-verifier", "cave-version-check-ok", "cave-update-attempt",
  "gdrive-pending", "dropbox-pending", "cave-backup-delete-pending",
] as const;

/** Longest value we will carry for one preference. `cave-sections` is JSON. */
const MAX_VALUE_LEN = 4096;

/**
 * The ENUMERABLE preferences also have their value checked.
 *
 * `sanitizeSettings` validated the KEY and the value's type and length, never the
 * value itself, so a hand-edited backup could put `cave-weight-unit: "kg"` or
 * `cave-font-scale: "999"` into storage — bypassing the App setters, which do
 * validate. Most readers degrade gracefully (`THEMES` is null-proto and falls
 * back to brass), but `--cave-font-scale: 999` is written straight into a CSS
 * variable, so one forged value renders the app unusable.
 *
 * Only keys with a genuinely CLOSED set are listed. A free-form value (a
 * threshold, a default weight, the JSON section map) is deliberately absent: it
 * has no enumerable answer, its readers already coerce it, and inventing bounds
 * here would be a second source of truth for the App setters to drift from.
 * Null-proto: the key comes from an untrusted file.
 */
const ALLOWED_VALUES: Record<string, readonly string[]> = Object.assign(Object.create(null), {
  "cave-theme-mode": ["dark", "light"],
  "cave-font-scale": ["s", "m", "l"],
  // lang-axis-ok: not a per-language map — `cave-date-format` has exactly two
  // FORMATS (dd.mm.yyyy / Mon D, YYYY) which happen to be labelled fr and en, and
  // is deliberately decoupled from `cave-lang` so a French UI can show English
  // dates. Adding a code here per UI language would invent formats that do not
  // exist.
  "cave-date-format": ["fr", "en"],
  "cave-weight-unit": ["g", "oz"],
  "cave-length-unit": ["mm", "in"],
  "cave-accounting-enabled": ["0", "1"],
  "cave-maint-reminders-enabled": ["0", "1"],
  "cave-default-grouped": ["0", "1"],
  "cave-wish-sort": ["name", "brand"],
  "cave-autofill-source": ["local", "ai"],
  "ai-provider": ["anthropic", "openai", "gemini"],
  "cave-cloud-provider": ["gdrive", "dropbox"],
  "cave-autosave": ["0", "1"],
  "cave-settings-tab": ["data", "prefs", "app", "help"],
});

/** Read the exportable preferences off this device. Absent keys are omitted. */
export function collectSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTINGS_KEYS) {
    const v = lsGet(k);
    if (v == null) continue;
    const s = String(v);
    if (!s.length || s.length > MAX_VALUE_LEN) continue;
    out[k] = s;
  }
  return out;
}

/**
 * Validate an INCOMING `_settings` block. Untrusted input — a backup file can
 * be hand-edited or forged, so this drops anything not on the allowlist rather
 * than trusting what it is handed.
 */
export function sanitizeSettings(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const allowed = new Set<string>(SETTINGS_KEYS as readonly string[]);
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) continue;                 // covers FORBIDDEN by construction
    const v = (raw as any)[k];
    if (typeof v !== "string" || !v.length || v.length > MAX_VALUE_LEN) continue;
    var okVals = ALLOWED_VALUES[k];
    if (okVals && okVals.indexOf(v) === -1) continue;   // closed-set values only
    out[k] = v;
  }
  return out;
}

/**
 * Write sanitised preferences to this device. Returns how many landed.
 *
 * The caller decides WHETHER to call this: a REPLACE restore adopts the
 * backup's preferences (the user asked to make this device look like that
 * backup), a MERGE does not — merging two cellars is not a reason to inherit
 * the other device's language and theme. That split lives in useImportConfirm.
 *
 * Several of these are read once at startup (`cave-lang` pre-mount,
 * `cave-theme` in main.jsx), so they can ONLY take effect on a reload.
 *
 * CORRECTION: this comment used to say "the caller reloads after a
 * restore — which the restore path already does". It did not. Nothing in the app
 * reloaded, so for seven releases a replace-restore wrote every preference to
 * storage and left the running app on the old ones. `useImportConfirm` now
 * reloads after a REPLACE that actually applied preferences (and only then) —
 * see the reload block at the tail of `_runImport` for why a reload beats
 * routing the ~20 App setters.
 */
export function applySettings(raw: any): number {
  const clean = sanitizeSettings(raw);
  let n = 0;
  for (const k of Object.keys(clean)) { if (lsSet(k, clean[k]!)) n++; }
  return n;
}
