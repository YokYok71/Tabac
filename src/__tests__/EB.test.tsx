// EB (Error Boundary) — chunk-load error detection &
// auto-recovery. Locks the three branches added on top of the legacy
// "Erreur de rendu" fallback:
//   1. unrelated error  → original render-error UI
//   2. chunk-load error, first hit within 30 s window  → "Recovering…"
//   3. chunk-load error, second hit within 30 s window  → manual
//      "Clear cache and reload" UI (auto-recovery suppressed)

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EB } from "../App.tsx";

// Stub the harsh side effects so the auto-recovery branch can run
// without actually reloading jsdom or wiping anything real.
beforeEach(() => {
  localStorage.clear();
  // Spy on console.error so React's "uncaught error" noise doesn't
  // pollute the test output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // jsdom has no caches API and no SW registration — the recovery
  // path silently no-ops, then calls location.reload(). Patch
  // reload so it doesn't throw "not implemented".
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

function ThrowOnRender({ error }: { error: any }): null {
  throw error;
}

describe("EB — render error fallback (legacy branch)", () => {
  it("renders the generic render-error UI for an unrelated error", () => {
    const err = new Error("Something broke in a view");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    // ENGLISH with no cave-lang (it was French once). English is the only
    // compiled-in dictionary and the app's stated fallback,
    // so the boundary must agree with App.tsx rather than keep the old "fr".
    expect(screen.getByText(/Render error/i)).toBeTruthy();
    expect(screen.getByText(/Something broke in a view/i)).toBeTruthy();
    // No chunk-flag was written.
    expect(localStorage.getItem("cave-eb-recovery-ts")).toBeNull();
  });

  it("falls back to ENGLISH — not French — when the active dictionary is absent", () => {
    // The case the boundary exists for: a chunk failed to load, so `LANG[lang]`
    // is missing. Earlier the fallback was `LANG.fr`, itself undefined since
    // The string table collapsed to {} and every label dropped to a
    // hardcoded FRENCH literal, shown to a German user.
    localStorage.setItem("cave-lang", "zz");
    render(
      <EB>
        <ThrowOnRender error={new Error("boom")} />
      </EB>
    );
    expect(screen.getByText(/Render error/i)).toBeTruthy();
    expect(screen.queryByText(/Erreur de rendu/i)).toBeNull();
  });
});

describe("EB — chunk load error auto-recovery", () => {
  it("detects 'Importing a module script failed' and shows the recovering UI", () => {
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
    // Flag was written for anti-loop (in componentDidCatch).
    expect(localStorage.getItem("cave-eb-recovery-ts")).not.toBeNull();
    // Recovery side-effect: location.reload was dispatched.
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("detects 'Failed to fetch dynamically imported module' likewise", () => {
    const err = new TypeError("Failed to fetch dynamically imported module: https://x/y.js");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });

  it("suppresses auto-recovery and shows manual UI when a recent flag exists", () => {
    // Simulate a previous purge-and-reload that already happened 10s ago.
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    // No "recovering" — instead the explicit retry button is offered.
    expect(screen.queryByText(/Passage à la dernière version|Switching to the latest/i)).toBeNull();
    expect(screen.getByText(/Mise à jour incomplète|Update incomplete/i)).toBeTruthy();
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("re-arms auto-recovery once the flag is older than 30 s", () => {
    // Old flag — well past the anti-loop window.
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 60_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
    // Flag was refreshed by componentDidCatch — within the last 2 s.
    const fresh = parseInt(localStorage.getItem("cave-eb-recovery-ts") || "0", 10);
    expect(Date.now() - fresh).toBeLessThan(2_000);
  });

  // A FUTURE stamp (clock corrected backward /
  // forged) must NOT permanently pin the manual screen — earlier `Date.now() -
  // last` was negative, so `>= 30000` was false → recovering stayed false
  // forever. Now an invalid/future stamp is treated as "no recent recovery".
  it("re-arms auto-recovery when the flag is in the FUTURE (clock skew)", () => {
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() + 60 * 60 * 1000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });

  it("re-arms auto-recovery when the flag is non-numeric garbage", () => {
    localStorage.setItem("cave-eb-recovery-ts", "not-a-number");
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    expect(screen.getByText(/Passage à la dernière version|Switching to the latest/i)).toBeTruthy();
  });
});

describe("EB — manual retry button", () => {
  it("invokes purgeCachesAndReload via location.reload when clicked", async () => {
    localStorage.setItem("cave-eb-recovery-ts", String(Date.now() - 10_000));
    const err = new TypeError("Importing a module script failed.");
    render(
      <EB>
        <ThrowOnRender error={err} />
      </EB>
    );
    const btn = screen.getByRole("button");
    await act(async () => {
      btn.click();
      // Wait for the async purgeCachesAndReload promise chain to settle.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.location.reload).toHaveBeenCalled();
  });
});

// ── offline must never destroy the installed app ─────────────────

describe("EB — a chunk miss while OFFLINE does not purge", () => {
  // AUDIT HIGH. The recovery is triggered by a failed dynamic import, and
  // offline a lazy chunk the user has never opened fails exactly that way (the
  // SW returns 503 on a cache miss it cannot fetch). So tapping an unvisited
  // tab on a plane deleted every Cache Storage entry and every SW registration,
  // then reloaded with no network to refill them — the working offline app,
  // gone, unbootable until connectivity returns. The identical guard already
  // existed at the sibling call site.
  const chunkErr = new Error("Importing a module script failed.");

  function offline(v: boolean) {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !v });
  }
  afterEach(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); });

  it("does not claim to be recovering when offline", () => {
    offline(true);
    localStorage.removeItem("cave-eb-recovery-ts");
    expect(EB.getDerivedStateFromError(chunkErr).recovering).toBe(false);
  });

  it("still auto-recovers when online", () => {
    offline(false);
    localStorage.removeItem("cave-eb-recovery-ts");
    expect(EB.getDerivedStateFromError(chunkErr).recovering).toBe(true);
  });
});
