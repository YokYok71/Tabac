import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { settleWithin } from "../i18n.ts";

// The app must MOUNT, whatever the network does.
//
// Reported from the installed iOS PWA: the pre-mount shell showing
// "Chargement…" for ever, with only the repair link as a way out.
//
// `main.jsx` gates ReactDOM.createRoot().render() on `ensureLang(active)`
// SETTLING. `ensureLang` had `.catch(() => false)`, which covers a REJECTED
// dynamic import — and nothing at all for a STALLED one. A request that hangs
// (dead cellular socket, a service worker that never answers, a fetch cut
// mid-deploy) settles neither way, so `.then`, `.catch` and `.finally` all stay
// unrun and the whole app sits behind a promise that will never resolve.
//
// The comment in main.jsx reasoned it out and stopped one case short: "it
// resolves false when the chunk cannot be fetched … so the failure path needs
// no special handling here". A stalled fetch IS "cannot be fetched", and it was
// the one form the contract did not actually honour.

afterEach(() => { vi.useRealTimers(); });

describe("settleWithin — a pending promise can never hold the app", () => {
  it("resolves FALSE when the promise never settles", async () => {
    vi.useFakeTimers();
    const never = new Promise<boolean>(() => { /* the stalled import */ });
    const raced = settleWithin(never, 6000);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(raced).resolves.toBe(false);
  });

  it("does not fire early — a slow chunk still wins if it arrives in time", async () => {
    vi.useFakeTimers();
    let settle!: (v: boolean) => void;
    const slow = new Promise<boolean>((r) => { settle = r; });
    const raced = settleWithin(slow, 6000);
    await vi.advanceTimersByTimeAsync(5000);
    settle(true);
    await expect(raced).resolves.toBe(true);
  });

  it("passes a real success straight through", async () => {
    await expect(settleWithin(Promise.resolve(true), 6000)).resolves.toBe(true);
    await expect(settleWithin(Promise.resolve(false), 6000)).resolves.toBe(false);
  });

  it("NEVER rejects — a rejected load resolves false", async () => {
    // Every caller's response to a failure is identical, so a rejection here
    // would only invite an unhandled one. This is the contract ensureLang
    // already rests on and main.jsx quotes.
    await expect(settleWithin(Promise.reject(new Error("boom")), 6000)).resolves.toBe(false);
  });

  it("ignores a late arrival instead of resolving twice", async () => {
    vi.useFakeTimers();
    let settle!: (v: boolean) => void;
    const late = new Promise<boolean>((r) => { settle = r; });
    const raced = settleWithin(late, 6000);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(raced).resolves.toBe(false);
    settle(true);                       // the chunk finally lands
    await expect(raced).resolves.toBe(false);   // the verdict does not change
  });

  it("clears its timer when the promise wins, so nothing is left pending", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "clearTimeout");
    await settleWithin(Promise.resolve(true), 6000);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the boot path is actually wired to it", () => {
  // The lesson: a well-tested helper behind untested wiring is the
  // shape that ships. Comments are blanked first — this repo has been caught
  // three times by a source check satisfied by the prose explaining the fix.
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("ensureLang races BOTH of its return paths", () => {
    const code = read("src/i18n.ts");
    // The fresh load and the shared in-flight promise are two separate returns;
    // guarding only one leaves the other able to hang for ever.
    const returns = code.match(/return\s+settleWithin\(/g) || [];
    expect(returns.length, "both the in-flight and the fresh-load return must be raced")
      .toBe(2);
    expect(code).not.toMatch(/if \(pending\) return pending;/);
  });

  it("keeps a finite timeout constant", () => {
    const code = read("src/i18n.ts");
    const m = /const LANG_LOAD_TIMEOUT_MS = (\d+);/.exec(code);
    expect(m, "the timeout must be a named constant, not a literal at the call site").toBeTruthy();
    const ms = Number(m![1]);
    expect(ms).toBeGreaterThan(1000);   // not so short it fires on a slow phone
    expect(ms).toBeLessThan(20000);     // not so long the boot screen looks hung
  });

  it("still mounts React unconditionally after the await", () => {
    // Whatever ensureLang answers, mount() must run on BOTH settlement paths —
    // the fulfilled handler and the rejection handler.
    const boot = read("src/main.jsx");
    expect(boot).toMatch(/ensureLang\(active\)\.then\(/);
    expect(boot, "the rejection path must still mount").toMatch(/\}, mount\)/);
    expect(boot).toMatch(/const mount = \(\) =>/);
  });
});
