import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { APP_VERSION, APP_BUILD, APP_GENERATION } from "../constants";
import { readFileSync } from "node:fs";

/**
 * END-TO-END: version.json → banner → doUpdate → purge → reload.
 *
 * WHY THIS FILE EXISTS. Every link of the update chain had unit coverage and
 * the chain itself had none, which is how four consecutive releases each shipped
 * a different silent break in it. The unit tests answer "does this piece work";
 * this one answers the only question the user ever asks — "if a new build is
 * published, does my app end up running it?"
 *
 * THE LOAD-BEARING ASSERTION IS ORDER, NOT OCCURRENCE. doUpdate must unregister
 * the service workers and delete every Cache Storage entry BEFORE calling
 * reload. Reload first and the browser is served the OLD bundle from the cache
 * it was about to drop: the app comes back on the same build, having reported
 * success. That is invisible to any test that only checks each call happened —
 * and it is exactly the "I updated and nothing changed" failure this chain has
 * produced before (the iOS PWA stuck on a stale bundle).
 *
 * IndexedDB is asserted UNTOUCHED. It holds every local photo, and the purge
 * runs on a path the user did not consciously choose. CLAUDE.md states the
 * rule in capitals for the sibling recovery path; nothing enforced it here.
 */

// Ordered log of the real side effects, so the sequence can be asserted.
let steps: string[];
let reload: ReturnType<typeof vi.fn>;
let deleteDatabase: ReturnType<typeof vi.fn>;

function installEnvironment(opts: { waiting?: boolean; cacheKeys?: string[] } = {}) {
  const cacheKeys = opts.cacheKeys || ["cave-tabac-v1-5", "stale-chunk-cache"];
  const postMessage = vi.fn(() => steps.push("skip-waiting"));
  const registration: any = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    installing: null,
    waiting: opts.waiting ? { postMessage } : null,
    unregister: vi.fn(() => { steps.push("sw-unregister"); return Promise.resolve(true); }),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      controller: null,
      getRegistrations: vi.fn(() => Promise.resolve([registration])),
    },
  });
  vi.stubGlobal("caches", {
    keys: vi.fn(() => Promise.resolve(cacheKeys.slice())),
    delete: vi.fn((k: string) => { steps.push("cache-delete:" + k); return Promise.resolve(true); }),
  });
  // A reload the test can observe. Recorded in the same log as the purge so
  // the ordering assertion is a single array comparison.
  reload = vi.fn(() => steps.push("reload"));
  Object.defineProperty(window, "location", {
    configurable: true, writable: true,
    value: { ...window.location, reload },
  });
  // Nothing in the chain may touch the photo store.
  deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase, open: vi.fn() });
  return { registration, postMessage };
}

function serveVersion(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) })));
}

/** Flush the async chain: doUpdate awaits three times and races a 1 s timer. */
async function drainUpdate() {
  for (let i = 0; i < 4; i++) {
    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
  }
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

const NEWER = String(Number(APP_BUILD) + 1);

beforeEach(() => {
  steps = [];
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("update chain — the visible path, end to end", () => {
  it("goes from a published version.json all the way to a purged reload", async () => {
    const { postMessage } = installEnvironment({ waiting: true });
    serveVersion({ version: APP_VERSION, build: NEWER });

    const { result } = renderHook(() => useAppUpdate());
    await settle();

    // 1 — detection. Both the informational record and the banner.
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEWER });
    expect(result.current.updateAvailable).toEqual({ version: APP_VERSION, build: NEWER });
    expect(result.current.autoUpdateCountdown).toBe(10);
    expect(steps).toEqual([]);                    // nothing destructive yet

    // 2 — the countdown runs itself down. No user action anywhere.
    await act(async () => { vi.advanceTimersByTime(9000); });
    expect(result.current.autoUpdateCountdown).toBe(1);
    expect(reload).not.toHaveBeenCalled();

    // 3 — it fires, and the purge runs.
    await act(async () => { vi.advanceTimersByTime(1000); });
    await drainUpdate();

    // 4 — THE ORDERING GUARANTEE. Everything destructive precedes the reload,
    // or the browser re-serves the build we were replacing.
    expect(steps).toContain("reload");
    expect(steps.indexOf("skip-waiting")).toBeLessThan(steps.indexOf("sw-unregister"));
    expect(steps.indexOf("sw-unregister")).toBeLessThan(steps.indexOf("cache-delete:cave-tabac-v1-5"));
    expect(steps.filter((s) => s.startsWith("cache-delete:")))
      .toEqual(["cache-delete:cave-tabac-v1-5", "cache-delete:stale-chunk-cache"]);
    expect(Math.max(...steps.map((s, i) => (s === "reload" ? -1 : i))))
      .toBeLessThan(steps.indexOf("reload"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    // 5 — every local photo survives.
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("EVERY cache is dropped, not just the app's own", async () => {
    // The content-hashed chunks the user is stuck on can live in a cache this
    // build has never heard of — a rename, or an entry left by an older SW.
    installEnvironment({ cacheKeys: ["cave-tabac-v1-4", "cave-tabac-v1-5", "workbox-precache"] });
    serveVersion({ version: APP_VERSION, build: NEWER });
    renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(10000); });
    await drainUpdate();
    expect(steps.filter((s) => s.startsWith("cache-delete:")).length).toBe(3);
  });

  it("survives an environment with no service worker and no Cache Storage", async () => {
    // Safari private mode, a failed registration, a browser without SW: the
    // purge is best-effort but the RELOAD is not optional — it is what puts
    // the user on the new build (index.html is served network-first).
    installEnvironment();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    vi.stubGlobal("caches", undefined);
    serveVersion({ version: APP_VERSION, build: NEWER });
    renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(10000); });
    await drainUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads even when unregister and cache deletion both reject", async () => {
    // Each purge step is individually try/caught. A storage error must not
    // strand the user on the old build — that would turn a cosmetic failure
    // into a permanent one.
    const { registration } = installEnvironment();
    registration.unregister = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("caches", {
      keys: vi.fn(() => Promise.resolve(["x"])),
      delete: vi.fn(() => Promise.reject(new Error("denied"))),
    });
    serveVersion({ version: APP_VERSION, build: NEWER });
    renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(10000); });
    await drainUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("update chain — the silent path, end to end", () => {
  it("a data_only release reaches the same purged reload with no banner", async () => {
    installEnvironment();
    serveVersion({ version: APP_VERSION, build: NEWER, data_only: true });

    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.updateAvailable).toBeNull();          // no interruption
    expect(result.current.autoUpdateCountdown).toBeNull();
    expect(result.current.silentUpdatePending).toBeTruthy();
    expect(result.current.newerBuild).toBeTruthy();             // …but never hidden

    // It applies when the app goes away — pagehide is the iOS-standalone
    // teardown hook, where visibilitychange:hidden is unreliable.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      document.dispatchEvent(new Event("pagehide"));
    });
    await drainUpdate();

    expect(steps).toContain("reload");
    expect(steps.indexOf("sw-unregister")).toBeLessThan(steps.indexOf("reload"));
    expect(deleteDatabase).not.toHaveBeenCalled();
  });
});

describe("update chain — the brakes actually stop it", () => {
  it("'Plus tard' cancels the countdown and nothing is destroyed", async () => {
    installEnvironment();
    serveVersion({ version: APP_VERSION, build: NEWER });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.autoUpdateCountdown).toBe(10);

    await act(async () => { result.current.cancelAutoUpdate(); });
    await act(async () => { vi.advanceTimersByTime(60000); });
    await drainUpdate();

    expect(result.current.autoUpdateCountdown).toBeNull();
    expect(steps).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    // …and it stays cancelled: the build stays visible in Settings so the
    // user can still choose it, but nothing re-arms behind their back.
    expect(result.current.newerBuild).toBeTruthy();
  });

  it("deferAutoUpdate blocks the chain outright — unsaved input is safe", async () => {
    // The predicate covering the forms/tasting/lot/wishlist/maintenance
    // surfaces is the ONLY protection for unsaved work: nothing
    // downstream asks the user for permission.
    installEnvironment();
    serveVersion({ version: APP_VERSION, build: NEWER });
    const { result } = renderHook(() => useAppUpdate({ deferAutoUpdate: true }));
    await settle();
    await act(async () => { vi.advanceTimersByTime(60000); });
    await drainUpdate();

    expect(result.current.updateAvailable).toBeTruthy();   // detected…
    expect(result.current.autoUpdateCountdown).toBeNull(); // …never counted down
    expect(steps).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("the anti-loop cap stops a partial deploy from reloading for ever", async () => {
    // version.json advertises a build the served bundle is not at. Three
    // reloads and the chain stands down — but the build stays reported, so
    // The user is never silently stuck.
    installEnvironment();
    // An earlier release prefixed the latch key with the GENERATION — after a renumber,
    // the same version+build on a new epoch is a different artifact.
    localStorage.setItem("cave-update-attempt",
      JSON.stringify({ k: APP_GENERATION + ":" + APP_VERSION + "/" + NEWER, n: 3, ts: Date.now() }));
    serveVersion({ version: APP_VERSION, build: NEWER });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(60000); });
    await drainUpdate();

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEWER });
  });
});

describe("update chain — the pill is the manual route, and it says so", () => {
  it("is keyed on newerBuild so it survives every brake", async () => {
    // It used to key on `updateAvailable`, which is only set on the path that
    // intends to count down — so the pill VANISHED in exactly the states where
    // a manual route matters most: deferred behind a form, stood down by the
    // anti-loop latch, or waiting on the silent data_only path.
    const SRC = readFileSync("src/views/curator/Overlays.tsx", "utf8");
    const pill = SRC.slice(SRC.indexOf("export function CuratorUpdatePill"),
                           SRC.indexOf("export function CuratorAutoUpdateBanner"));
    expect(pill).toContain("if (!newerBuild ||");
    expect(pill).not.toContain("if (!updateAvailable ||");
  });

  it("says what it does instead of showing a checkmark", () => {
    // "✓ v1.x" was the entire content. A CHECKMARK beside a version number
    // reads as "you are up to date" — the opposite of the message — and the
    // minor version is usually the one already running, so it carried no
    // information at all. Reported from the app as "that is all, not explicit".
    const SRC = readFileSync("src/views/curator/Overlays.tsx", "utf8");
    const pill = SRC.slice(SRC.indexOf("export function CuratorUpdatePill"),
                           SRC.indexOf("export function CuratorAutoUpdateBanner"));
    expect(pill).toContain('t("upd_do")');            // "Mettre à jour"
    expect(pill).toContain("newerBuild.build");       // the build, which changed
    expect(pill).not.toContain('name="check"');       // the misleading glyph
  });
});
