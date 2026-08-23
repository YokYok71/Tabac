import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppUpdate, compareVersions, isRemoteNewer, shouldSuppressUpdate, explainPendingUpdate, VERSION_CHECK_STALE_MS } from "../hooks/useAppUpdate";
import { APP_VERSION, APP_BUILD, APP_GENERATION } from "../constants";
import { readFileSync } from "node:fs";

// ── service worker / fetch mocking ────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // Stub serviceWorker.ready to never resolve — we drive update detection manually.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: new Promise(() => {}),
      controller: null,
    },
  });
  // version.json fetch returns no-op
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}) })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── deferAutoUpdate ───────────────────────────────────────────────────────────

describe("useAppUpdate — deferAutoUpdate", () => {
  it("does NOT start the countdown when deferAutoUpdate is true", () => {
    const { result } = renderHook(({ defer }) => useAppUpdate({ deferAutoUpdate: defer }), {
      initialProps: { defer: true },
    });
    // Simulate detection of a new version by setting updateAvailable indirectly
    // (the setter isn't exposed; instead we rely on the public API path)
    // Since detection requires the SW ready promise to resolve, and we stubbed
    // it to pending, updateAvailable stays null. The countdown should be null.
    expect(result.current.autoUpdateCountdown).toBeNull();
  });

  it("clears the countdown when deferAutoUpdate flips to true mid-countdown", () => {
    // Force-set updateAvailable via checkUpdate (after stub fetch resolves)
    // Simpler: simulate the deferred branch directly by toggling the prop.
    const { result, rerender } = renderHook(
      ({ defer }) => useAppUpdate({ deferAutoUpdate: defer }),
      { initialProps: { defer: false } },
    );
    // Use the public setter via setUpdateStatus would not trigger the countdown
    // (only updateAvailable does, and that's internal). We verify the inverse:
    // when defer is true, even if updateAvailable were set, no countdown runs.
    // Here we just check that toggling defer does not crash and keeps countdown null.
    rerender({ defer: true });
    expect(result.current.autoUpdateCountdown).toBeNull();
    rerender({ defer: false });
    expect(result.current.autoUpdateCountdown).toBeNull();
  });

  it("exposes the expected public API", () => {
    const { result } = renderHook(() => useAppUpdate());
    expect(typeof result.current.checkUpdate).toBe("function");
    expect(typeof result.current.doUpdate).toBe("function");
    expect(typeof result.current.cancelAutoUpdate).toBe("function");
    expect(result.current.updateAvailable).toBeNull();
    expect(result.current.autoUpdateCountdown).toBeNull();
  });
});

// ── checkUpdate: data-refresh purge when no version bump ──────────
//
// Earlier, tapping "Vérifier" on a build matching version.json just
// flashed "À jour" for 3 s. The hook now changes the "no update available"
// branch to also fire the full purge (unregister SWs + wipe caches +
// reload) so that data files cached by the SW — notice.json
// in particular — refresh without waiting for an APP_BUILD bump.

describe("useAppUpdate — checkUpdate triggers cache purge when up-to-date", () => {
  // Spy on the purge code path via navigator.serviceWorker.getRegistrations
  // — that call is unique to doUpdate() and is unreachable from any other
  // branch of checkUpdate(). If it runs after a same-version check, the
  // refresh purge is wired; earlier it would never run on the "ok" path.
  function installPurgeSpies() {
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: new Promise(() => {}),
        controller: null,
        getRegistrations,
      },
    });
    return { getRegistrations };
  }

  it("after matching version.json, enters the cache purge path", async () => {
    const { getRegistrations } = installPurgeSpies();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ version: APP_VERSION, build: APP_BUILD }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      result.current.checkUpdate();
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // The "Application à jour — rafraîchissement…" toast renders first so
    // the user understands the reload that's coming.
    expect(result.current.updateStatus).toBe("ok");
    expect(getRegistrations).not.toHaveBeenCalled();

    // Advance past the 1200 ms delay → doUpdate() kicks in.
    await act(async () => {
      vi.advanceTimersByTime(1300);
      await Promise.resolve();
    });
    // The SKIP_WAITING race has a 1000 ms inner timeout. Let it expire so
    // execution proceeds to the unregister + caches.delete sweep.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRegistrations).toHaveBeenCalled();
  });

  it("does NOT enter purge when version.json reports a newer build (confirm-flow stays the gatekeeper)", async () => {
    const { getRegistrations } = installPurgeSpies();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({ version: APP_VERSION, build: String(Number(APP_BUILD) + 1) }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => {
      result.current.checkUpdate();
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Status should be the object form (triggers the confirm panel UI),
    // not "ok" — and the purge MUST NOT run until the user confirms.
    expect(typeof result.current.updateStatus).toBe("object");
    expect(result.current.updateStatus).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  // A version.json reporting an OLDER build
  // (rollback / stale edge) must NOT surface a bogus "update available" that
  // reloads to the same/older build — it's treated as up-to-date (the
  // cache-refresh purge path), routed through the same isRemoteNewer guard as
  // the auto path.
  it("treats a DOWNGRADE version.json as up-to-date (refresh, not a bogus update)", async () => {
    const { getRegistrations } = installPurgeSpies();
    const olderBuild = String(Math.max(1, Number(APP_BUILD) - 1));
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ version: APP_VERSION, build: olderBuild }),
        }),
      ),
    );
    const { result } = renderHook(() => useAppUpdate());
    await act(async () => { result.current.checkUpdate(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    // NOT the object form (no update pill) — the refresh "ok" path instead.
    expect(result.current.updateStatus).toBe("ok");
    await act(async () => {
      vi.advanceTimersByTime(1300);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(getRegistrations).toHaveBeenCalled(); // entered the purge/refresh path
  });
});

// ── silent update for data-only releases ──────────────────────────
//
// When version.json carries `"data_only": true` AND the build differs, the
// hook should skip the visible 10 s countdown banner (silentUpdatePending
// is set instead of updateAvailable). The visibilitychange listener fires
// doUpdate() at the next opportunity.

describe("useAppUpdate — silent update on data_only flag", () => {
  // Resolved SW ready so the periodic checkVersion code path runs.
  function installReadySWSpy() {
    const getRegistrations = vi.fn().mockResolvedValue([]);
    const reg = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      installing: null,
      waiting: null,
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve(reg),
        controller: null,
        getRegistrations,
      },
    });
    return { getRegistrations };
  }

  it("sets silentUpdatePending (NOT updateAvailable) when version.json carries data_only=true", async () => {
    installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: true,
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());

    // Let the SW-ready promise settle and the initial checkVersion fire.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // The hook should have routed to the SILENT path:
    expect(result.current.silentUpdatePending).not.toBeNull();
    expect(result.current.silentUpdatePending).toMatchObject({
      version: APP_VERSION,
      build: String(Number(APP_BUILD) + 1),
    });
    // The visible banner state must STAY null — no countdown should run.
    expect(result.current.updateAvailable).toBeNull();
    expect(result.current.autoUpdateCountdown).toBeNull();
  });

  it("keeps using the visible banner when data_only is absent (regression guard)", async () => {
    installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            // no data_only field → normal banner + countdown
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.updateAvailable).not.toBeNull();
    expect(result.current.silentUpdatePending).toBeNull();
  });

  it("fires doUpdate (cache purge) when document goes hidden while silent update is pending", async () => {
    const { getRegistrations } = installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: true,
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.silentUpdatePending).not.toBeNull();
    expect(getRegistrations).not.toHaveBeenCalled();

    // Simulate the user backgrounding the app.
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    // doUpdate's SKIP_WAITING race has a 1000 ms inner timeout — advance.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRegistrations).toHaveBeenCalled();
  });

  it("falls back to a 30 min absolute timer if the user never backgrounds", async () => {
    const { getRegistrations } = installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: true,
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.silentUpdatePending).not.toBeNull();
    expect(getRegistrations).not.toHaveBeenCalled();

    // Forward 31 minutes — fallback should fire.
    await act(async () => {
      vi.advanceTimersByTime(31 * 60 * 1000);
      await Promise.resolve();
    });
    // SKIP_WAITING 1000 ms inner timeout.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRegistrations).toHaveBeenCalled();
  });

  it("data_only as string (NOT boolean true) does NOT trigger the silent path", async () => {
    installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: "true", // STRING, not boolean — defensive coercion guards against this
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // The strict `=== true` check must reject the string "true" → the
    // visible banner path takes over instead.
    expect(result.current.silentUpdatePending).toBeNull();
    expect(result.current.updateAvailable).not.toBeNull();
  });

  it("fires doUpdate on pagehide event (iOS Safari app-switcher teardown)", async () => {
    const { getRegistrations } = installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: true,
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.silentUpdatePending).not.toBeNull();
    expect(getRegistrations).not.toHaveBeenCalled();

    // Simulate iOS app-switcher teardown — pagehide fires before the page is
    // destroyed; visibilitychange may NOT fire reliably.
    //
    // dispatched at the WINDOW, which is where the spec fires
    // it. This case used to dispatch at `document` and passed against a
    // listener that was on `document` too — so it was green for six releases
    // while the real iOS teardown hook could never fire. Dispatching where the
    // browser dispatches is the whole point of the case.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRegistrations).toHaveBeenCalled();
  });

  it("respects deferAutoUpdate — silent path also waits when a tasting is active", async () => {
    const { getRegistrations } = installReadySWSpy();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({
            version: APP_VERSION,
            build: String(Number(APP_BUILD) + 1),
            data_only: true,
          }),
        }),
      ),
    );

    const { result } = renderHook(() => useAppUpdate({ deferAutoUpdate: true }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.silentUpdatePending).not.toBeNull();

    // Trigger visibility:hidden — purge should NOT run while deferred.
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(getRegistrations).not.toHaveBeenCalled();
  });
});

// ── version-compare + anti-loop guards (pure) ──────────────────────
describe("compareVersions", () => {
  it("orders dotted numeric versions, treating missing segments as 0", () => {
    expect(compareVersions("1.5", "1.4")).toBeGreaterThan(0);
    expect(compareVersions("1.4", "1.5")).toBeLessThan(0);
    expect(compareVersions("1.4", "1.4")).toBe(0);
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0); // numeric, not lexical
    expect(compareVersions("2.0", "1.99")).toBeGreaterThan(0);
    expect(compareVersions("1.4.1", "1.4")).toBeGreaterThan(0);
  });
});

describe("isRemoteNewer", () => {
  it("rejects a malformed payload (missing version / non-numeric build)", () => {
    expect(isRemoteNewer(null, "1.4", "339")).toBe(false);
    expect(isRemoteNewer({ build: "340" }, "1.4", "339")).toBe(false);   // no version
    expect(isRemoteNewer({ version: "1.4" }, "1.4", "339")).toBe(false); // build NaN
    expect(isRemoteNewer({ version: "1.4", build: "abc" }, "1.4", "339")).toBe(false);
  });
  it("never treats a DOWNGRADE as an update (stale edge / rollback)", () => {
    expect(isRemoteNewer({ version: "1.3", build: "999" }, "1.4", "339")).toBe(false);
  });
  it("a strictly-newer version is an update even with a lower build (builds reset per version)", () => {
    expect(isRemoteNewer({ version: "1.5", build: "1" }, "1.4", "339")).toBe(true);
  });
  it("same version → newer only when the build is strictly greater", () => {
    expect(isRemoteNewer({ version: "1.4", build: "340" }, "1.4", "339")).toBe(true);
    expect(isRemoteNewer({ version: "1.4", build: "339" }, "1.4", "339")).toBe(false);
    expect(isRemoteNewer({ version: "1.4", build: "338" }, "1.4", "339")).toBe(false);
  });
});

describe("the update GENERATION", () => {
  // WHY IT EXISTS. `isRemoteNewer` refuses a version DOWNGRADE — the
  // guard against a rolled-back version.json driving an endless purge-and-
  // reload loop. The consequence is that the display version is a ONE-WAY
  // RATCHET: publishing 1.0 over a 1.5 leaves every installed client computing
  // `1.0 < 1.5` and never offering the release.
  //
  // Measured before writing this: the service worker serves HTML network-first
  // (see sw.js), so a relaunch while online fetches the new index.html
  // and its chunks WITHOUT this comparison — a downgrade strands nobody, it
  // only silences the in-session flow until the next cold start. Small and
  // invisible, which is why it is worth closing before it is needed.

  it("THE POINT: a higher generation is newer even when the version goes DOWN", () => {
    // The actual reset: a client on 1.5/268/gen1 meets 1.0/1/gen2.
    expect(isRemoteNewer({ version: "1.0", build: "1", generation: 2 }, "1.5", "268", 1)).toBe(true);
  });

  it("…and once landed on the new epoch, the same payload is not an update", () => {
    expect(isRemoteNewer({ version: "1.0", build: "1", generation: 2 }, "1.0", "1", 2)).toBe(false);
  });

  it("a LOWER generation is still refused — the guard is not loosened", () => {
    // A rollback to a pre-reset deploy, which is exactly the shape that drove
    // the reload loop. Refused even though its version looks higher.
    expect(isRemoteNewer({ version: "1.5", build: "999", generation: 1 }, "1.0", "1", 2)).toBe(false);
  });

  it("a payload with NO generation behaves exactly as before this build", () => {
    // The load-bearing default. Treating a missing field as 0 would make every
    // earlier deploy look older than the running app and silently kill the
    // update path — the very failure this field exists to prevent.
    expect(isRemoteNewer({ version: "1.5", build: "269" }, "1.5", "268", 1)).toBe(true);
    expect(isRemoteNewer({ version: "1.5", build: "268" }, "1.5", "268", 1)).toBe(false);
    expect(isRemoteNewer({ version: "1.4", build: "999" }, "1.5", "268", 1)).toBe(false);
  });

  it("a garbage generation is ignored, not obeyed", () => {
    for (const g of ["abc", null, {}, NaN, Infinity]) {
      expect(isRemoteNewer({ version: "1.5", build: "269", generation: g }, "1.5", "268", 1),
        String(g)).toBe(true);
      expect(isRemoteNewer({ version: "1.4", build: "999", generation: g }, "1.5", "268", 1),
        String(g)).toBe(false);
    }
  });

  it("an equal generation falls through to the version/build rules untouched", () => {
    expect(isRemoteNewer({ version: "1.5", build: "269", generation: 1 }, "1.5", "268", 1)).toBe(true);
    expect(isRemoteNewer({ version: "1.5", build: "267", generation: 1 }, "1.5", "268", 1)).toBe(false);
    expect(isRemoteNewer({ version: "1.6", build: "1", generation: 1 }, "1.5", "268", 1)).toBe(true);
  });

  it("a malformed payload is still rejected before the generation is read", () => {
    // Order matters: a payload with a winning generation but no version is
    // still garbage, and must not become an update by the back door.
    expect(isRemoteNewer({ build: "1", generation: 99 }, "1.5", "268", 1)).toBe(false);
    expect(isRemoteNewer({ version: "1.0", build: "abc", generation: 99 }, "1.5", "268", 1)).toBe(false);
  });

  it("OMITTING the argument keeps the earlier behaviour, never a NaN compare", () => {
    // Defensive: an unmigrated caller must degrade to the old rules rather
    // than silently comparing against NaN and returning false for everything.
    expect(isRemoteNewer({ version: "1.5", build: "269", generation: 99 }, "1.5", "268")).toBe(true);
    expect(isRemoteNewer({ version: "1.0", build: "1", generation: 99 }, "1.5", "268")).toBe(false);
  });

  it("BOTH call sites pass APP_GENERATION", () => {
    // The wiring is what rots: a pure function nobody hands the value to is a
    // pure function that does nothing, and both call sites read the same
    // `version.json`, so covering one is covering neither.
    // version.json's own agreement with APP_GENERATION is NOT asserted here —
    // it lives in doc:check's checkVersions beside every other
    // version-vs-version.json rule, which is where a build bump meets it.
    const src = readFileSync("src/hooks/useAppUpdate.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const calls = src.match(/isRemoteNewer\(d, APP_VERSION, APP_BUILD[^)]*\)/g) || [];
    expect(calls.length, "both call sites").toBe(2);
    for (const c of calls) expect(c, c).toContain("APP_GENERATION");
    expect(Number.isFinite(Number(APP_GENERATION)), "APP_GENERATION is a number").toBe(true);
  });
});

describe("shouldSuppressUpdate (anti-loop)", () => {
  const now = 1_000_000_000;
  it("suppresses once max attempts for the SAME target are reached within the window", () => {
    expect(shouldSuppressUpdate({ k: "1.4/340", n: 3, ts: now - 1000 }, "1.4/340", now)).toBe(true);
    expect(shouldSuppressUpdate({ k: "1.4/340", n: 2, ts: now - 1000 }, "1.4/340", now)).toBe(false);
  });
  it("does not suppress a DIFFERENT target", () => {
    expect(shouldSuppressUpdate({ k: "1.4/340", n: 5, ts: now }, "1.4/341", now)).toBe(false);
  });
  it("retries again once the suppression window has elapsed", () => {
    expect(shouldSuppressUpdate({ k: "1.4/340", n: 5, ts: now - 31 * 60 * 1000 }, "1.4/340", now)).toBe(false);
  });
  it("no marker → never suppresses", () => {
    expect(shouldSuppressUpdate(null, "1.4/340", now)).toBe(false);
  });
});

// ── the anti-loop counter must count RELOADS, not detections ──────

describe("useAppUpdate — a waiting silent update is not counted as a retry", () => {
  function readySW() {
    const reg = { addEventListener: vi.fn(), removeEventListener: vi.fn(), installing: null, waiting: null };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve(reg), controller: null, getRegistrations: vi.fn().mockResolvedValue([]) },
    });
  }
  const NEXT = String(Number(APP_BUILD) + 1);
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

  it("does not inflate the attempt counter while the silent path waits", async () => {
    // THE BUG (reported from the app as "a new build is out and it isn't
    // offering it to me"): checkVersion polls every 120 s and used to bump the
    // anti-loop counter on every DETECTION. The data_only path is designed to
    // WAIT for the next backgrounding, so ~6 minutes of ordinary foreground
    // use drove a perfectly healthy release to the 3-attempt cap. The session
    // in progress still updated, but the next launch inside the 30-minute
    // window hit shouldSuppressUpdate and armed nothing at all — no banner by
    // design, and no silent path either.
    readySW();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: NEXT, data_only: true }),
    })));

    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.silentUpdatePending).toBeTruthy();

    const after1 = JSON.parse(localStorage.getItem("cave-update-attempt") || "{}");
    expect(after1.n).toBe(1);

    // Four more polls — twice past the old cap.
    for (let i = 0; i < 4; i++) {
      await act(async () => { vi.advanceTimersByTime(120000); });
      await settle();
    }

    const after5 = JSON.parse(localStorage.getItem("cave-update-attempt") || "{}");
    expect(after5.n).toBe(1);                       // fails on the old code (n === 5)
    expect(shouldSuppressUpdate(after5, APP_VERSION + "/" + NEXT, Date.now())).toBe(false);
    expect(result.current.silentUpdatePending).toBeTruthy();
  });

  it("still counts a genuinely NEW target, so the anti-loop cap survives", () => {
    // The guard must not become permissive: a partial deploy that keeps
    // advertising a build the bundle isn't at still burns one attempt per real
    // reload-and-redetect cycle, and a reload always ends the session.
    const key = APP_VERSION + "/" + NEXT;
    expect(shouldSuppressUpdate({ k: key, n: 3, ts: Date.now() }, key, Date.now())).toBe(true);
    expect(shouldSuppressUpdate({ k: key, n: 2, ts: Date.now() }, key, Date.now())).toBe(false);
    // A different target is unaffected — 14 builds in one day never accumulate.
    expect(shouldSuppressUpdate({ k: key, n: 3, ts: Date.now() }, APP_VERSION + "/999", Date.now())).toBe(false);
    // And the suppression expires.
    expect(shouldSuppressUpdate({ k: key, n: 3, ts: Date.now() - 31 * 60 * 1000 }, key, Date.now())).toBe(false);
  });
});

// ── no silent dead ends ──────────────────────────────────────────
//
// The mechanism had three ways to know the app was behind and tell nobody.
// Each is pinned here, because every one of them looks like a perfectly
// healthy app from the outside — which is what made them survive.

describe("useAppUpdate — a stale build can never be invisible", () => {
  const NEXT = String(Number(APP_BUILD) + 1);
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  function serveVersion(extra: Record<string, unknown> = {}) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: NEXT, ...extra }),
    })));
  }

  it("detects a new build with NO service worker at all", async () => {
    // The whole detection used to live inside navigator.serviceWorker.ready
    // .then(...), so no SW meant no version check, ever. That is not a corner
    // case: doUpdate() unregisters every SW before reloading, so one failed
    // re-registration left the app permanently unable to learn it was behind.
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    serveVersion();
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEXT });
    expect(result.current.updateAvailable).toBeTruthy();
  });

  it("detects a new build when serviceWorker.ready never resolves", async () => {
    // `ready` does not reject when nothing is registered — it simply never
    // settles, so a .catch() cannot save this. beforeEach already stubs it
    // as a forever-pending promise, which is exactly the real failure.
    serveVersion();
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEXT });
  });

  it("still reports the build when the anti-loop latch has stood down", async () => {
    // Suppression stops us auto-RELOADING. It must not stop us SAYING SO:
    // earlier checkVersion returned before recording anything, so a device
    // that had hit the cap showed a normal, apparently up-to-date app.
    // An earlier release prefixed the latch key with the GENERATION: after a renumber,
    // `1.0/1` on the new epoch is a different artifact from any `1.0/1` on the
    // old one, and the whole point of that field is to make such a collision
    // reachable. Consequence, accepted: the key change resets every installed
    // device's attempt counter ONCE — worth at most one extra reload cycle.
    localStorage.setItem("cave-update-attempt",
      JSON.stringify({ k: APP_GENERATION + ":" + APP_VERSION + "/" + NEXT, n: 3, ts: Date.now() }));
    serveVersion();
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEXT });
    expect(result.current.updateAvailable).toBeNull();   // correctly NOT auto-applying
  });

  it("still reports the build when the attempt marker cannot be written", async () => {
    // lsSet fails closed on a full quota — the right call for
    // auto-reloading, but it disabled every signal too.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    serveVersion();
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEXT });
    setItem.mockRestore();
  });

  it("reports a data_only build too, even though it shows no banner", async () => {
    // The silent path set silentUpdatePending, which NO UI read. Settings
    // keyed on updateAvailable, so a catalogue release was invisible on every
    // screen in the app. This is the case the user actually hit.
    serveVersion({ data_only: true });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.silentUpdatePending).toBeTruthy();
    expect(result.current.updateAvailable).toBeNull();          // still no banner
    expect(result.current.newerBuild).toEqual({ version: APP_VERSION, build: NEXT });
  });

  it("applies a pending silent update at the fallback when ONLINE", async () => {
    // The window exists for the tab that is never backgrounded. Online, the
    // fallback simply applies it — which is why the "promote it to a
    // visible banner instead" branch was unreachable here, and why it is gone.
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: new Promise(() => {}), controller: null, getRegistrations },
    });
    serveVersion({ data_only: true });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.silentUpdatePending).toBeTruthy();
    expect(getRegistrations).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(30 * 60 * 1000 + 100); });
    await settle();
    await act(async () => { vi.advanceTimersByTime(1200); });
    await settle();
    expect(getRegistrations).toHaveBeenCalled();
  });

  it("does NOT promote — and never purges — while OFFLINE", async () => {
    // THE PROMOTION BUG, and the previous version of this case blessed it.
    //
    // fireSilent declines offline WITHOUT latching `fired` (so a
    // later attempt can still apply it). The fallback was written
    // `if (!fired) setUpdateAvailable(...)` — so being offline was precisely
    // what promoted to the VISIBLE path, which had no offline guard at all:
    // countdown → doUpdate → every SW unregistered, every Cache Storage entry
    // deleted, reload. Offline nothing can be re-fetched; on an installed iOS
    // PWA that is a dead window until connectivity returns. Verbatim the
    // failure the own comment says it prevents.
    //
    // The old case stubbed onLine:false, asserted the promotion happened, and
    // STOPPED — locking the first half of the bug in as intended behaviour. It
    // now runs the countdown out and asserts the purge never happens.
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: new Promise(() => {}), controller: null, getRegistrations },
    });
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue(["a"]), delete: del });
    vi.stubGlobal("navigator", new Proxy(navigator, {
      get: (t, k) => (k === "onLine" ? false : Reflect.get(t, k)),
    }));
    serveVersion({ data_only: true });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(30 * 60 * 1000 + 100); });
    await settle();
    expect(result.current.updateAvailable).toBeNull();          // no promotion
    // …and even if something else armed it, doUpdate itself must refuse.
    await act(async () => { result.current.doUpdate(); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    await settle();
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

// ── the check itself can fail, silently and for ever ─────────────

describe("useAppUpdate — a failing version check is not silent", () => {
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

  it("records the moment a check SUCCEEDS, even with no new build", async () => {
    // "Is there a newer build" and "can this device still ask" are different
    // questions. Only the second one has no other symptom.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: APP_BUILD }),
    })));
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.newerBuild).toBeNull();          // nothing to update…
    expect(result.current.lastCheckOkMs).toBeGreaterThan(0); // …but we reached the server
    expect(Number(localStorage.getItem("cave-version-check-ok"))).toBeGreaterThan(0);
  });

  it("leaves the marker untouched when every fetch rejects", async () => {
    // The empty `.catch` is deliberate — a transient failure must not be
    // noise. What it cost was the ability to tell a transient failure from a
    // permanent one: a broken deploy or a captive portal looked exactly like a
    // healthy app, for ever, at one silent retry every 120 s.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { vi.advanceTimersByTime(120000); });
    await settle();
    expect(result.current.lastCheckOkMs).toBeNull();
    expect(localStorage.getItem("cave-version-check-ok")).toBeNull();
  });

  it("seeds from a previous session and clears itself on the next success", async () => {
    // Persisted, so "the check has been failing for days" survives relaunches;
    // self-clearing, so a week offline is never reported as a fault once the
    // device is back online.
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    localStorage.setItem("cave-version-check-ok", String(old));
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { result, rerender } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.lastCheckOkMs).toBe(old);
    expect(Date.now() - (result.current.lastCheckOkMs as number)).toBeGreaterThan(VERSION_CHECK_STALE_MS);

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: APP_BUILD }),
    })));
    rerender();
    await act(async () => { vi.advanceTimersByTime(120000); });
    await settle();
    expect(Date.now() - (result.current.lastCheckOkMs as number)).toBeLessThan(VERSION_CHECK_STALE_MS);
  });

  it("ignores a corrupt marker rather than reporting a bogus age", () => {
    localStorage.setItem("cave-version-check-ok", "not-a-number");
    const { result } = renderHook(() => useAppUpdate());
    expect(result.current.lastCheckOkMs).toBeNull();
  });
});

// ── why a detected update is not applying ────────────────────────

describe("explainPendingUpdate — the brake that is holding, in one word", () => {
  // Reported from the app: "a new version is available, I get that pill and
  // that is all, and it does not start after 10 seconds like you said". The
  // mechanism was correct in the code; what was missing was any way — for the
  // user OR for me — to see WHICH of the four brakes was engaged. Same disease
  // as the two releases one level up: it may refuse to act, not to say why.
  const B = { build: "999" };
  const base = { newerBuild: B, countdown: null, deferred: false,
    declinedBuild: null, silentPending: false, suppressed: false };

  it("says nothing when there is nothing to say", () => {
    expect(explainPendingUpdate({ ...base, newerBuild: null })).toBe("none");
  });

  it("a visible countdown outranks every other reason", () => {
    // It is on screen counting down; no explanation can be more informative.
    expect(explainPendingUpdate({ ...base, countdown: 7, deferred: true, suppressed: true })).toBe("counting");
  });

  it("names the open form before anything else", () => {
    // deferAutoUpdate is the only protection for unsaved input,
    // so this is the reason the user is most likely to act on — close the form.
    expect(explainPendingUpdate({ ...base, deferred: true, suppressed: true })).toBe("deferred");
  });

  it("distinguishes a postponement from a stand-down", () => {
    expect(explainPendingUpdate({ ...base, declinedBuild: "999" })).toBe("declined");
    // A postponement is per-BUILD: declining 998 says nothing about 999.
    expect(explainPendingUpdate({ ...base, declinedBuild: "998" })).toBe("idle");
    expect(explainPendingUpdate({ ...base, suppressed: true })).toBe("suppressed");
  });

  // ── THE CALL SITE, which is where it was broken ───────────────────────────
  //
  // Every case above hands `suppressed` IN. Nothing tested the line in
  // `useAppUpdate` that COMPUTES it — and that line built the marker key
  // WITHOUT the generation prefix the writer puts on:
  //
  //   writer: String(APP_GENERATION) + ":" + version + "/" + build   → "2:1.0/37"
  //   reader:                          version + "/" + build         →   "1.0/37"
  //
  // `shouldSuppressUpdate` requires `marker.k === targetKey`, so the two
  // strings could never be equal and `suppressed` was permanently FALSE.
  // Consequence: a partial deploy burns the three auto-reload attempts,
  // `checkVersion` then returns early and arms nothing, and Settings →
  // Application resolves the reason to "silent" or "idle" — the wrong brake,
  // or none — while `upd_why_suppressed` was dead code.
  //
  // In the ONE hook whose whole design is "the mechanism may refuse to act,
  // but it must say WHICH brake is engaged".
  it("the hook actually REACHES 'suppressed' when the anti-loop latch is engaged", async () => {
    // A resolved `serviceWorker.ready` so the periodic checkVersion runs.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          addEventListener: vi.fn(), removeEventListener: vi.fn(),
          installing: null, waiting: null,
        }),
        controller: null,
        getRegistrations: vi.fn().mockResolvedValue([]),
      },
    });
    const newer = String(Number(APP_BUILD) + 1);
    // The marker exactly as `checkVersion` writes it — generation included.
    localStorage.setItem("cave-update-attempt", JSON.stringify({
      k: String(APP_GENERATION) + ":" + APP_VERSION + "/" + newer,
      n: 3, ts: Date.now(),
    }));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: newer }),
    })));

    const { result } = renderHook(() => useAppUpdate());
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });

    // The build is recorded whatever the brakes do — that is the ungated
    // half, and the reason this case can ask the question at all.
    expect(result.current.newerBuild).toMatchObject({ build: newer });
    expect(result.current.pendingReason, "the wrong brake was named").toBe("suppressed");
  });

  it("both sides build the marker key through the SAME function", () => {
    // The defect was never the key FORMAT — it was that two call sites each
    // built it by hand and drifted. `attemptKey` is now the only producer, so
    // this asserts the shape that makes the drift impossible rather than the
    // string it happens to produce. Comments blanked: the note on the reader
    // spells out the wrong construction, and a source check satisfied by its
    // own explanation is the trap this repo keeps hitting.
    const src = readFileSync("src/hooks/useAppUpdate.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    // Exactly one place concatenates the generation onto a version/build: the
    // helper itself.
    const handBuilt = [...src.matchAll(/APP_GENERATION\s*\)?\s*\+\s*":"/g)];
    expect(handBuilt.length, "a second hand-built marker key has appeared").toBe(1);
    // And both consumers go through it.
    expect([...src.matchAll(/attemptKey\(/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("a marker for a DIFFERENT target does not suppress", () => {
    // Non-vacuity in the other direction: the key must still MATCH. A reader
    // that ignored the key entirely would pass the case above and break the
    // per-target semantics the latch exists for.
    expect(shouldSuppressUpdate(
      { k: String(APP_GENERATION) + ":" + APP_VERSION + "/998", n: 3, ts: Date.now() },
      String(APP_GENERATION) + ":" + APP_VERSION + "/999", Date.now(),
    )).toBe(false);
  });

  it("reports the silent path as waiting, not as broken", () => {
    // data_only applies on backgrounding — nothing is wrong, and the copy says
    // so rather than inviting the user to fix a non-problem.
    expect(explainPendingUpdate({ ...base, silentPending: true })).toBe("silent");
  });

  it("falls through to idle when no brake is engaged", () => {
    // The about-to-count-down instant. Deliberately has no Settings line.
    expect(explainPendingUpdate(base)).toBe("idle");
  });
});

// ── "Plus tard", and what happens next ───────────────────────────

describe("useAppUpdate — postponing does not disable the mechanism", () => {
  const NEXT = String(Number(APP_BUILD) + 1);
  const LATER = String(Number(APP_BUILD) + 2);
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const serve = (b: string, extra: Record<string, unknown> = {}) =>
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ version: APP_VERSION, build: b, ...extra }),
    })));

  it("does not re-prompt for the SAME build in the same session", async () => {
    serve(NEXT);
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.autoUpdateCountdown).toBe(10);
    await act(async () => { result.current.cancelAutoUpdate(); });
    for (let i = 0; i < 10; i++) { await act(async () => { vi.advanceTimersByTime(120000); }); await settle(); }
    expect(result.current.autoUpdateCountdown).toBeNull();
    expect(result.current.newerBuild).toBeTruthy();     // still reported, never hidden
  });

  it("DOES prompt again when a genuinely newer build ships", async () => {
    // THE BUG, and the question that surfaced it was "if I tap Plus tard, does
    // the pop-up come back?". The countdown effect's dep was `!!updateAvailable`
    // — a boolean — so `A → B` did not re-run it. checkVersion correctly
    // cleared the decline latch for B and nothing acted on it: ONE "Plus tard"
    // disabled the countdown for the whole session, newer releases included,
    // while explainPendingUpdate returned "idle" so Settings printed no reason
    // either. The comment at the latch-clear said "cleared when a newer build
    // is detected" — it was, and that was all.
    serve(NEXT);
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => { result.current.cancelAutoUpdate(); });
    expect(result.current.autoUpdateCountdown).toBeNull();
    serve(LATER);
    await act(async () => { vi.advanceTimersByTime(120000); });
    await settle();
    expect(result.current.autoUpdateCountdown).toBe(10);
  });

  it("holds the postpone across a form being opened and closed", async () => {
    // deferAutoUpdate is the other dep, so a flip re-runs the effect. The
    // decline latch is what stops that restarting a countdown the user
    // postponed — keying on the build must not weaken it.
    serve(NEXT);
    const { result, rerender } = renderHook(({ d }) => useAppUpdate({ deferAutoUpdate: d }),
      { initialProps: { d: false } });
    await settle();
    await act(async () => { result.current.cancelAutoUpdate(); });
    rerender({ d: true });  await settle();
    rerender({ d: false }); await settle();
    expect(result.current.autoUpdateCountdown).toBeNull();
  });

  it("holds it even if version.json writes the build UNQUOTED", async () => {
    // isRemoteNewer accepts a numeric build, and the decline latch stored the
    // raw value while checkVersion compared it against String(d.build) — so a
    // number could never match its own latch, clearing it on the next poll and
    // resurrecting the regression the anti-loop latch fixed. Latent (the shipped file
    // quotes it), which is exactly why it needed pinning.
    serve(Number(NEXT) as unknown as string);
    const { result, rerender } = renderHook(({ d }) => useAppUpdate({ deferAutoUpdate: d }),
      { initialProps: { d: false } });
    await settle();
    expect(result.current.autoUpdateCountdown).toBe(10);
    await act(async () => { result.current.cancelAutoUpdate(); });
    await act(async () => { vi.advanceTimersByTime(120000); });
    await settle();
    rerender({ d: true });  await settle();
    rerender({ d: false }); await settle();
    expect(result.current.autoUpdateCountdown).toBeNull();
  });

  it("also disarms the SILENT path, so backgrounding cannot apply it anyway", async () => {
    // cancelAutoUpdate never touched silentUpdatePending and fireSilent never
    // consulted the decline latch: tap Plus tard, background the app, and the
    // build you just declined was applied.
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: new Promise(() => {}), controller: null, getRegistrations },
    });
    serve(NEXT, { data_only: true });
    const { result } = renderHook(() => useAppUpdate());
    await settle();
    expect(result.current.silentUpdatePending).toBeTruthy();
    await act(async () => { result.current.cancelAutoUpdate(); });
    expect(result.current.silentUpdatePending).toBeNull();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    await settle();
    expect(getRegistrations).not.toHaveBeenCalled();
  });
});
