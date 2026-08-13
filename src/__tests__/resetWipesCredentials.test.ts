// « Effacer toutes les données » must actually erase
// everything, credentials included.
//
// Before this build the reset wiped the cellar and the photo store and left
// behind `dropbox-rt` — a refresh token that renews indefinitely — plus
// `gdrive-tk`, the three AI API keys, and `gdrive-account-hint`, which is an
// e-mail address. Tolerable while the app had one user; a mislabel for a
// public one, where this button is what someone taps before handing the phone
// on or before posting a support screenshot.
//
// THE LOAD-BEARING HALF OF THIS FILE IS NEGATIVE, and it is the mirror image
// of `appSettings.test.ts`. That file asserts every credential is REFUSED by
// the export allowlist; this one asserts every credential is REMOVED by the
// reset. Same list of secrets, opposite verdict, because the two answer
// different questions — what leaves the device versus what stays on it.
// So the sweep is derived from the same source of truth: the credential key
// literals are read out of the auth modules, exactly as `appSettings.test.ts`
// does, which is what keeps the guarantee COMPLETE rather than merely long.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { isAppOwnedKey, wipeAppStorage } from "../utils/appStorage";
import { FORBIDDEN, SETTINGS_KEYS } from "../utils/appSettings";
import { useExportImport } from "../hooks/useExportImport";
import { INIT } from "../constants";

const SRC = path.resolve(__dirname, "..");

/** Every `"…"` string literal in a file — used to harvest real key names. */
function literals(rel: string): string[] {
  const s = fs.readFileSync(path.join(SRC, rel), "utf8");
  return Array.from(s.matchAll(/"([^"\\\n]{3,60})"/g)).map((m) => m[1]!);
}

describe("the reset sweeps every app-owned key", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes the credentials the old reset left behind", () => {
    const secrets = [
      "dropbox-rt", "dropbox-tk", "gdrive-tk",
      "anthropic-api-key", "openai-api-key", "gemini-api-key",
      "gdrive-account-hint",
    ];
    secrets.forEach((k) => localStorage.setItem(k, "secret"));
    wipeAppStorage();
    secrets.forEach((k) => {
      expect(localStorage.getItem(k), `${k} must not survive a reset`).toBeNull();
    });
  });

  it("clears sessionStorage too — gdrive-tk lives there on every platform but iOS standalone", () => {
    sessionStorage.setItem("gdrive-tk", "tok");
    sessionStorage.setItem("cave-drive-expired-dismissed", "1");
    wipeAppStorage();
    expect(sessionStorage.getItem("gdrive-tk")).toBeNull();
    expect(sessionStorage.getItem("cave-drive-expired-dismissed")).toBeNull();
  });

  it("removes EVERY credential literal the auth + AI modules actually use", () => {
    // The completeness half. `appSettings.test.ts` reads these same files to
    // assert the export refuses them; if a seventh credential is introduced
    // there, this case starts failing too instead of silently not covering it.
    const harvested = [
      ...literals("hooks/useGdriveAuth.ts"),
      ...literals("hooks/useDropboxAuth.ts"),
      ...literals("utils/dropboxAuthCore.ts"),
      ...literals("hooks/useAiAutoFill.ts"),
    ]
      // A bare `"-api-key"` / `"ai-model-"` is a FRAGMENT the code concatenates
      // a provider onto, not a key. Dropped explicitly rather than by loosening
      // `isAppOwnedKey`, which must keep refusing a lone suffix.
      .filter((k) => !/^-|-$/.test(k))
      .filter((k) => /^(gdrive-|dropbox-)/.test(k) || /-api-key$/.test(k));

    expect(harvested.length, "harvest must not be vacuous").toBeGreaterThan(8);
    const missed = Array.from(new Set(harvested)).filter((k) => !isAppOwnedKey(k));
    expect(missed, "a credential the reset would not remove").toEqual([]);
  });

  it("removes every FORBIDDEN key — the export's do-not-leak list is also the reset's must-erase list", () => {
    (FORBIDDEN as readonly string[]).forEach((k) => {
      expect(isAppOwnedKey(k), `${k} escapes the reset`).toBe(true);
    });
  });

  it("removes every preference too — a reset is a fresh install, not a partial one", () => {
    (SETTINGS_KEYS as readonly string[]).forEach((k) => {
      expect(isAppOwnedKey(k), `${k} escapes the reset`).toBe(true);
    });
  });

  it("leaves a foreign key alone — the sweep is namespaced, not a blanket clear()", () => {
    localStorage.setItem("some-other-app", "keep me");
    localStorage.setItem("cave-lang", "de");
    wipeAppStorage();
    expect(localStorage.getItem("some-other-app")).toBe("keep me");
    expect(localStorage.getItem("cave-lang")).toBeNull();
  });

  it("collects before removing — Storage.key(i) re-indexes as the store shrinks", () => {
    // Removing inside the index loop skips every other entry. With ten keys
    // the naive version leaves five behind, so this fixture is sized to make
    // that failure unmistakable rather than marginal.
    for (let i = 0; i < 10; i++) localStorage.setItem("cave-k" + i, "v");
    expect(wipeAppStorage()).toBe(10);
    expect(localStorage.length).toBe(0);
  });

  it("survives storage being unavailable rather than throwing", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    expect(() => wipeAppStorage()).not.toThrow();
    if (real) Object.defineProperty(window, "localStorage", real);
  });
});

describe("resetAll is WIRED to the sweep", () => {
  // jsdom has no navigation, so a real `location.reload()` emits a
  // "Not implemented" notice that vitest intermittently surfaces as an
  // unhandled error — noise that erodes the signal of a clean run. Stubbed
  // rather than swallowed: the call is ASSERTED below, since the reload is
  // load-bearing (see the note on resetAll).
  const reload = vi.fn();
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: Object.assign(Object.create(Object.getPrototypeOf(window.location)),
        { ...window.location, reload }),
    });
  });

  // The lesson: a guarded decision whose call site nobody executes.
  // Every assertion above would stay green with the `wipeAppStorage()` line
  // deleted from `resetAll`, so this case drives the real hook.
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it("erases the credentials when the user confirms", async () => {
    localStorage.setItem("dropbox-rt", "refresh-forever");
    localStorage.setItem("anthropic-api-key", "sk-real");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() =>
      useExportImport({
        data: { ...INIT }, save: vi.fn(), withPhotos: vi.fn(), nav: vi.fn(),
        t: (k: string) => k, weightUnit: "g", lengthUnit: "mm",
        ageLabel: () => "", stageImport: vi.fn(),
      } as any),
    );
    act(() => { result.current.resetAll(); });
    await waitFor(() => expect(localStorage.getItem("dropbox-rt")).toBeNull());
    expect(localStorage.getItem("anthropic-api-key")).toBeNull();
    // The reload is not tidiness — main.jsx reads language, theme, mode and
    // font scale once pre-mount, and the terms gate keys on a flag read at
    // mount, so the running app would otherwise hold preferences that no
    // longer exist on disk.
    expect(reload, "the reset must restart the app").toHaveBeenCalled();
  });

  it("erases nothing when the user cancels", async () => {
    localStorage.setItem("dropbox-rt", "refresh-forever");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() =>
      useExportImport({
        data: { ...INIT }, save: vi.fn(), withPhotos: vi.fn(), nav: vi.fn(),
        t: (k: string) => k, weightUnit: "g", lengthUnit: "mm",
        ageLabel: () => "", stageImport: vi.fn(),
      } as any),
    );
    act(() => { result.current.resetAll(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("dropbox-rt")).toBe("refresh-forever");
  });
});

describe("the confirm names what it erases", () => {
  // A reset that silently takes the cloud connection and the API keys with it
  // is a surprise, and this is the last dialog before an irreversible action.
  const LANGS = ["fr", "en", "es", "de", "it", "pt"];

  it("every language states the cloud connection AND the API keys", () => {
    LANGS.forEach((code) => {
      const s = fs.readFileSync(path.join(SRC, "i18n", `${code}.ts`), "utf8");
      const m = s.match(/^ {2}confirm_reset:"(.*)",$/m);
      expect(m, `${code} has no confirm_reset`).toBeTruthy();
      const v = m![1]!;
      expect(v.length, `${code} confirm_reset is still the old one-liner`).toBeGreaterThan(80);
      expect(/api/i.test(v), `${code} does not mention the API keys`).toBe(true);
      expect(/cloud|nube|nuvem/i.test(v), `${code} does not mention the cloud`).toBe(true);
    });
  });
});
